"""`python -m sirius_voice.selftest`: the real engines in a loop, no microphone needed.

Piper speaks each phrase, the audio is resampled and run through Silero and Whisper, and the
transcript is compared with what was said. It proves the models load and measures latency.
"""

import resource
import sys
import time

import numpy as np

from .core_client import from_env
from .engines import PiperTts, PipeWireSpeaker, SileroVad, WhisperStt, data_dir
from .protocols import FRAME_SAMPLES, SAMPLE_RATE
from .session import VoiceSession, _Ptt, _Shutdown
from .text import Endpoint, Endpointer

PHRASES = [
    ("en", "Add buy rice to today."),
    ("en", "What is next?"),
    ("en", "Remind me at five to call mum."),
    ("ro", "Adaugă cumpără orez la azi."),
    ("ro", "Cât e ceasul?"),
    ("ro", "Amintește-mi la cinci să sun acasă."),
]


def resample(audio: np.ndarray, rate: int) -> np.ndarray:
    count = int(len(audio) * SAMPLE_RATE / rate)
    return np.interp(
        np.linspace(0, len(audio), count, endpoint=False), np.arange(len(audio)), audio
    )


def endpoint(vad: SileroVad, audio: np.ndarray) -> tuple[Endpoint, float]:
    """Runs the audio plus a second of silence, returning when the utterance was judged over."""
    padded = np.concatenate([audio, np.zeros(SAMPLE_RATE, dtype=np.float32)]).astype(np.float32)
    vad.reset()
    endpointer = Endpointer()
    for start in range(0, len(padded) - FRAME_SAMPLES, FRAME_SAMPLES):
        outcome = endpointer.feed(vad.speech_probability(padded[start : start + FRAME_SAMPLES]))
        if outcome is not Endpoint.CONTINUE:
            return outcome, start / SAMPLE_RATE
    return Endpoint.CONTINUE, len(padded) / SAMPLE_RATE


def main() -> int:
    base = data_dir()
    tts = PiperTts(base / "voices", "en_US-lessac-medium", "ro_RO-mihai-medium")
    vad = SileroVad()
    stt = WhisperStt("small")

    started = time.perf_counter()
    stt.transcribe(np.zeros(SAMPLE_RATE, dtype=np.float32))
    print(f"whisper load and first run: {time.perf_counter() - started:.1f} s")

    failures = 0
    for lang, phrase in PHRASES:
        started = time.perf_counter()
        chunks, rate = tts.synthesize(phrase, lang)
        audio = resample(np.concatenate(list(chunks)), rate).astype(np.float32)
        tts_s = time.perf_counter() - started

        outcome, ended_at = endpoint(vad, audio)
        started = time.perf_counter()
        text, heard = stt.transcribe(audio)
        stt_s = time.perf_counter() - started

        ok = outcome is Endpoint.SPEECH_ENDED and heard == lang
        failures += not ok
        print(
            f"{'ok ' if ok else 'BAD'} {lang}->{heard} tts {tts_s:.2f}s stt {stt_s:.2f}s "
            f"audio {len(audio) / SAMPLE_RATE:.1f}s end@{ended_at:.1f}s  {phrase!r} -> {text!r}"
        )

    peak = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024
    print(f"peak memory with everything loaded: {peak:.0f} MB")
    return 1 if failures else 0


class ScriptedMic:
    """Plays audio into the session as if someone were speaking, then a silence."""

    def __init__(self, audio: np.ndarray) -> None:
        self.audio = np.concatenate([audio, np.zeros(SAMPLE_RATE * 2, dtype=np.float32)])

    def frames(self):
        for start in range(0, len(self.audio) - FRAME_SAMPLES, FRAME_SAMPLES):
            yield self.audio[start : start + FRAME_SAMPLES].astype(np.float32)

    def close(self) -> None:
        pass


def full_pipeline() -> int:
    """`--core`: spoken text through the real session and real core, ending on the speakers."""
    base = data_dir()
    core = from_env(base)
    tts = PiperTts(base / "voices", "en_US-lessac-medium", "ro_RO-mihai-medium")
    stt = WhisperStt("small")
    stt.transcribe(np.zeros(SAMPLE_RATE, dtype=np.float32))  # Warm, as after the first press.
    speaker = PipeWireSpeaker()
    failures = 0
    for lang, phrase, expected in (
        ("en", "Add water the basil to today.", "basil"),
        ("ro", "Adaugă udă florile la azi.", "flori"),
    ):
        chunks, rate = tts.synthesize(phrase, lang)
        audio = resample(np.concatenate(list(chunks)), rate).astype(np.float32)
        session = VoiceSession(ScriptedMic(audio), SileroVad(), stt, tts, speaker, core)
        started = time.perf_counter()
        session.inbox.put(_Ptt())
        session.inbox.put(_Shutdown())
        session.run()
        total = time.perf_counter() - started
        tasks = core.http.get("/v1/today").json()["tasks"]
        titles = [t["title"] for t in tasks]
        ok = any(expected in title.lower() for title in titles)
        failures += not ok
        print(f"{'ok ' if ok else 'BAD'} {lang}: {phrase!r} -> {titles[-1:]} in {total:.1f} s")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(full_pipeline() if "--core" in sys.argv else main())
