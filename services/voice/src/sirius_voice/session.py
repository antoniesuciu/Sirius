"""The voice session: one worker thread that owns the mic and the speaker.

Commands and streamed replies arrive on other threads and go through a queue, so at most one
thing touches the audio devices at a time. Audio only ever lives in memory here (F33): it is
appended to a list, handed to STT and dropped.
"""

import logging
import queue
import threading
import time
from dataclasses import dataclass, field

import numpy as np

from .protocols import Core, Mic, Speaker, Stt, Tts, Vad
from .text import Endpoint, Endpointer, SentenceBuffer

log = logging.getLogger(__name__)

IDLE_CHECK_S = 30


@dataclass
class _Ptt:
    pass


@dataclass
class _Stop:
    pass


@dataclass
class _Reply:
    turn_id: str
    text: str
    lang: str
    final: bool


@dataclass
class _Shutdown:
    pass


@dataclass
class _Turn:
    """An agent reply being spoken as it streams."""

    turn_id: str
    sentences: SentenceBuffer = field(default_factory=SentenceBuffer)


class VoiceSession:
    def __init__(
        self,
        mic: Mic,
        vad: Vad,
        stt: Stt,
        tts: Tts,
        speaker: Speaker,
        core: Core,
        earcon=lambda: None,
        on_idle=lambda: None,
    ) -> None:
        self.mic = mic
        self.vad = vad
        self.stt = stt
        self.tts = tts
        self.speaker = speaker
        self.core = core
        self.earcon = earcon
        self.on_idle = on_idle
        self.inbox: queue.Queue = queue.Queue()
        self.listening = threading.Event()
        self.end_early = threading.Event()
        self.abort = threading.Event()
        self.speaking = threading.Event()
        self.turn: _Turn | None = None

    # Called from the event thread. These must not block.

    def ptt(self) -> None:
        if self.listening.is_set():
            self.end_early.set()  # Pressed again: that was the whole sentence.
            return
        if self.speaking.is_set():
            self.speaker.stop()  # Barge-in (F31).
        self.inbox.put(_Ptt())

    def stop(self) -> None:
        self.abort.set()
        self.speaker.stop()
        self.inbox.put(_Stop())

    def reply(self, turn_id: str, text: str, lang: str, final: bool) -> None:
        self.inbox.put(_Reply(turn_id, text, lang, final))

    def shutdown(self) -> None:
        self.stop()
        self.inbox.put(_Shutdown())

    # The worker.

    def run(self) -> None:
        while True:
            try:
                item = self.inbox.get(timeout=IDLE_CHECK_S)
            except queue.Empty:
                if self.stt.idle():
                    self.on_idle()
                continue
            match item:
                case _Shutdown():
                    return
                case _Ptt():
                    self._safely(self._listen_and_route)
                case _Stop():
                    self.turn = None
                    self.abort.clear()
                    self.core.set_state("idle", mic_open=False)
                case _Reply() as reply:
                    self._safely(lambda r=reply: self._speak_stream(r))

    def _safely(self, step) -> None:
        """One failed utterance must leave the mic closed and the service alive."""
        try:
            step()
        except Exception:
            log.exception("voice step failed")
            self.mic.close()
            self.listening.clear()
            self.core.set_state("idle", mic_open=False)

    def _capture(self) -> np.ndarray | None:
        """Records until speech ends. Returns None when there is nothing to transcribe."""
        endpointer = Endpointer()
        frames: list[np.ndarray] = []
        self.vad.reset()
        self.end_early.clear()
        self.abort.clear()
        self.listening.set()
        try:
            for frame in self.mic.frames():
                if self.abort.is_set():
                    return None
                frames.append(frame)
                if self.end_early.is_set():
                    break
                outcome = endpointer.feed(self.vad.speech_probability(frame))
                if outcome is Endpoint.SPEECH_ENDED:
                    break
                if outcome is Endpoint.NO_SPEECH:
                    return None
        finally:
            self.mic.close()
            self.listening.clear()
        return np.concatenate(frames) if frames else None

    def _listen_and_route(self) -> None:
        if not self.core.voice_enabled():
            return
        self.turn = None
        self.stt.prepare()
        self.tts.prepare()
        self.core.set_state("listening", mic_open=True)
        self.earcon()

        audio = self._capture()
        if audio is None:
            self.core.set_state("idle", mic_open=False)
            return

        self.core.set_state("thinking", mic_open=False)
        started = time.perf_counter()
        text, lang = self.stt.transcribe(audio)
        stt_ms = (time.perf_counter() - started) * 1000
        del audio
        if not text:
            self.core.set_state("idle", mic_open=False)
            return

        self.core.set_state("thinking", mic_open=False, transcript=text)
        result = self.core.utterance(text, lang, {"stt": round(stt_ms)})
        if result["route"] == "agent":
            self.turn = _Turn(result["turn_id"])
            return  # The reply arrives over SSE and is spoken from run().
        if result.get("reply"):
            self._speak(result["reply"], lang)
        self.core.set_state("idle", mic_open=False)

    def _speak_stream(self, reply: _Reply) -> None:
        if not self.turn or self.turn.turn_id != reply.turn_id:
            return  # Barged in, or a turn that voice did not start.
        for sentence in self.turn.sentences.push(reply.text):
            if self.turn is None or not self._speak(sentence, reply.lang):
                self.turn = None
                return
        if reply.final:
            rest = self.turn.sentences.flush()
            self.turn = None
            if rest:
                self._speak(rest, reply.lang)
            self.core.set_state("idle", mic_open=False)

    def _speak(self, text: str, lang: str) -> bool:
        self.core.set_state("speaking", mic_open=False, level=0.0)
        self.speaking.set()
        try:
            chunks, rate = self.tts.synthesize(text, lang)
            return self.speaker.play(
                chunks,
                rate,
                lambda level: self.core.set_state("speaking", mic_open=False, level=level),
            )
        finally:
            self.speaking.clear()
