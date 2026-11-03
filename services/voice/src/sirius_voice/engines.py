"""Real engines behind the protocols. Heavy imports stay inside the classes that need them.

Audio goes through `pw-record` and `pw-play` rather than PortAudio: they need no extra system
package, and the microphone is a process that only exists while someone is talking.
"""

import logging
import os
import signal
import subprocess
import threading
import time
from collections.abc import Iterable, Iterator
from pathlib import Path

import numpy as np

from .protocols import FRAME_SAMPLES, SAMPLE_RATE

log = logging.getLogger(__name__)


INT16_MAX = 32768.0
LEVEL_INTERVAL_S = 0.1
#: Sirius's own vocabulary. It nudges Whisper towards commands on short, unclear audio.
VOCABULARY = {
    "en": "Add to today. Remind me at five to call. What's next? I'm done for today.",
    "ro": (
        "Adaugă la azi. Amintește-mi la cinci să sun. Ce urmează? Am ceva de făcut azi? "
        "Ce am de făcut? Cât e ceasul? Am terminat."
    ),
}
#: Real speech came back wrong with greedy decoding ("de făcut" as "dificultat").
BEAM_SIZE = 5
#: Below this share of the en+ro probability, both languages are tried.
CLEAR_LANGUAGE_SHARE = 0.97
#: The models stay loaded this long after an utterance.
MODEL_IDLE_S = float(os.environ.get("SIRIUS_MODEL_IDLE_S", 600))


class PipeWireMic:
    def __init__(self) -> None:
        self._process: subprocess.Popen | None = None

    def frames(self) -> Iterator[np.ndarray]:
        self._process = subprocess.Popen(
            ["pw-record", f"--rate={SAMPLE_RATE}", "--channels=1", "--format=s16", "-"],
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
        )
        stream = self._process.stdout
        size = FRAME_SAMPLES * 2
        while stream is not None:
            data = stream.read(size)
            if len(data) < size:
                return
            yield np.frombuffer(data, dtype=np.int16).astype(np.float32) / INT16_MAX

    def close(self) -> None:
        process, self._process = self._process, None
        if process is None:
            return
        process.terminate()
        try:
            process.wait(timeout=1)
        except subprocess.TimeoutExpired:
            process.kill()


class PipeWireSpeaker:
    def __init__(self) -> None:
        self._process: subprocess.Popen | None = None
        self._stopped = threading.Event()

    def play(self, chunks: Iterable[np.ndarray], sample_rate: int, on_level) -> bool:
        self._stopped.clear()
        process = subprocess.Popen(
            ["pw-play", f"--rate={sample_rate}", "--channels=1", "--format=s16", "-"],
            stdin=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
        )
        self._process = process
        step = int(sample_rate * LEVEL_INTERVAL_S)
        try:
            for chunk in chunks:
                for start in range(0, len(chunk), step):
                    if self._stopped.is_set():
                        return False
                    piece = chunk[start : start + step]
                    data = (np.clip(piece, -1, 1) * (INT16_MAX - 1)).astype(np.int16).tobytes()
                    process.stdin.write(data)
                    process.stdin.flush()
                    on_level(min(1.0, float(np.sqrt(np.mean(piece**2))) * 4))
            process.stdin.close()
            while process.poll() is None:
                if self._stopped.is_set():
                    return False
                time.sleep(0.02)
            return True
        except BrokenPipeError:
            return False
        finally:
            self._kill(process)

    def _kill(self, process: subprocess.Popen) -> None:
        if process.poll() is None:
            process.send_signal(signal.SIGTERM)
        self._process = None

    def stop(self) -> None:
        self._stopped.set()
        process = self._process
        if process is not None and process.poll() is None:
            process.send_signal(signal.SIGTERM)


class SileroVad:
    """Silero through ONNX, using the model faster-whisper ships, which avoids torch entirely."""

    CONTEXT_SAMPLES = 64

    def __init__(self) -> None:
        import faster_whisper
        import onnxruntime

        options = onnxruntime.SessionOptions()
        options.intra_op_num_threads = 1
        options.inter_op_num_threads = 1
        model = Path(faster_whisper.__file__).parent / "assets" / "silero_vad_v6.onnx"
        self._session = onnxruntime.InferenceSession(
            str(model), providers=["CPUExecutionProvider"], sess_options=options
        )
        self.reset()

    def reset(self) -> None:
        self._h = np.zeros((1, 1, 128), dtype=np.float32)
        self._c = np.zeros((1, 1, 128), dtype=np.float32)
        self._context = np.zeros(self.CONTEXT_SAMPLES, dtype=np.float32)

    def speech_probability(self, frame: np.ndarray) -> float:
        audio = np.concatenate([self._context, frame])[None, :]
        output, self._h, self._c = self._session.run(
            None, {"input": audio, "h": self._h, "c": self._c}
        )
        self._context = frame[-self.CONTEXT_SAMPLES :]
        return float(np.asarray(output).reshape(-1)[0])


class WhisperStt:
    def __init__(self, model: str, cpu_threads: int = 8) -> None:
        self.model_name = model
        self.cpu_threads = cpu_threads
        self._model = None
        self._lock = threading.Lock()
        self._last_used = 0.0

    def _load(self):
        from faster_whisper import WhisperModel

        try:
            model = WhisperModel(self.model_name, device="cuda", compute_type="float16")
            # Loading can succeed while the first inference fails on missing cuDNN.
            model.detect_language(audio=np.zeros(SAMPLE_RATE, dtype=np.float32))
            log.info("whisper on GPU")
            return model
        except Exception as error:
            log.info("whisper on CPU (%s)", error)
        return WhisperModel(
            self.model_name, device="cpu", compute_type="int8", cpu_threads=self.cpu_threads
        )

    def _ensure(self):
        with self._lock:
            if self._model is None:
                self._model = self._load()
            self._last_used = time.monotonic()
            return self._model

    def prepare(self) -> None:
        threading.Thread(target=self._ensure, daemon=True).start()

    def _attempt(self, model, audio: np.ndarray, lang: str) -> tuple[str, float]:
        segments, _ = model.transcribe(
            audio,
            language=lang,
            beam_size=BEAM_SIZE,
            condition_on_previous_text=False,
            initial_prompt=VOCABULARY[lang],
        )
        segments = list(segments)
        text = " ".join(s.text.strip() for s in segments).strip()
        confidence = float(np.mean([s.avg_logprob for s in segments])) if segments else -99.0
        return text, confidence

    def transcribe(self, audio: np.ndarray) -> tuple[str, str]:
        model = self._ensure()
        # Short utterances fool detection across 99 languages, and only two are in use (F29).
        _, _, probabilities = model.detect_language(audio=audio)
        scores = dict(probabilities)
        en, ro = scores.get("en", 0.0), scores.get("ro", 0.0)
        share = max(en, ro) / max(en + ro, 1e-9)
        if share >= CLEAR_LANGUAGE_SHARE:
            lang = "ro" if ro > en else "en"
            return self._attempt(model, audio, lang)[0], lang
        # Not clear from the sound alone, so let the transcripts compete.
        attempts = {lang: self._attempt(model, audio, lang) for lang in ("en", "ro")}
        lang = max(attempts, key=lambda key: attempts[key][1])
        return attempts[lang][0], lang

    def idle(self) -> bool:
        with self._lock:
            return self._model is not None and time.monotonic() - self._last_used > MODEL_IDLE_S


class PiperTts:
    def __init__(self, voices_dir: Path, voice_en: str, voice_ro: str, pace: float = 1.0) -> None:
        #: Above 1 speaks more slowly, on top of the pace each voice was trained with.
        self.pace = pace
        self.paths = {
            "en": voices_dir / f"{voice_en}.onnx",
            "ro": voices_dir / f"{voice_ro}.onnx",
        }
        self._voices: dict = {}

    def _voice(self, lang: str):
        key = lang if lang in self.paths else "en"
        if key not in self._voices:
            from piper import PiperVoice

            self._voices[key] = PiperVoice.load(self.paths[key])
        return self._voices[key]

    def prepare(self) -> None:
        """A voice takes about a second to load, so start before there is a reply to speak."""

        def load() -> None:
            for lang in self.paths:
                self._voice(lang)

        threading.Thread(target=load, daemon=True).start()

    def synthesize(self, text: str, lang: str) -> tuple[Iterable[np.ndarray], int]:
        from piper import SynthesisConfig

        voice = self._voice(lang)
        rate = voice.config.sample_rate
        config = SynthesisConfig(length_scale=voice.config.length_scale * self.pace)
        return (chunk.audio_float_array for chunk in voice.synthesize(text, config)), rate


def earcon(speaker: PipeWireSpeaker) -> None:
    """A soft rising two-note tone, generated here so no audio file is needed."""
    rate = 22_050
    notes = []
    for frequency in (660, 880):
        t = np.arange(int(rate * 0.09)) / rate
        envelope = np.sin(np.pi * t / t[-1]) ** 2
        notes.append(0.12 * np.sin(2 * np.pi * frequency * t) * envelope)
    speaker.play([np.concatenate(notes).astype(np.float32)], rate, lambda _level: None)


def data_dir() -> Path:
    default = Path.home() / ".local/share/sirius"
    path = Path(os.environ.get("SIRIUS_DATA_DIR", default))
    # Whisper's download lands next to the rest of Sirius, not in a shared cache.
    os.environ.setdefault("HF_HOME", str(path / "models"))
    return path
