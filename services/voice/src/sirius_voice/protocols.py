"""The engine seams (ADR-10). Anything that fits these can be swapped by configuration."""

from collections.abc import Iterable, Iterator
from typing import Protocol

import numpy as np

SAMPLE_RATE = 16_000
#: Silero expects exactly this many samples per frame at 16 kHz, about 32 ms.
FRAME_SAMPLES = 512
FRAME_SECONDS = FRAME_SAMPLES / SAMPLE_RATE


class Mic(Protocol):
    def frames(self) -> Iterator[np.ndarray]:
        """Yields float32 mono frames of FRAME_SAMPLES until closed. Opens the device."""
        ...

    def close(self) -> None:
        """Releases the device. Safe to call from another thread, and more than once."""
        ...


class Vad(Protocol):
    def reset(self) -> None:
        """Forgets state, ready for a new utterance."""
        ...

    def speech_probability(self, frame: np.ndarray) -> float: ...


class Stt(Protocol):
    def prepare(self) -> None:
        """Starts loading the model, so it is ready by the time speech ends."""
        ...

    def transcribe(self, audio: np.ndarray) -> tuple[str, str]:
        """Returns (text, language) for one utterance of float32 16 kHz audio."""
        ...

    def idle(self) -> bool:
        """True once a loaded model has gone unused for a while."""
        ...


class Tts(Protocol):
    def prepare(self) -> None:
        """Starts loading voices, so the first reply is not delayed."""
        ...

    def synthesize(self, text: str, lang: str) -> tuple[Iterable[np.ndarray], int]:
        """Returns float32 chunks and their sample rate."""
        ...


class Speaker(Protocol):
    def play(self, chunks: Iterable[np.ndarray], sample_rate: int, on_level) -> bool:
        """Plays to the end, returning False if stopped. Calls on_level(0..1) about 10 Hz."""
        ...

    def stop(self) -> None:
        """Stops at once. Safe to call from another thread."""
        ...


class Core(Protocol):
    def set_state(
        self,
        state: str,
        *,
        mic_open: bool,
        transcript: str | None = None,
        level: float | None = None,
    ) -> None: ...

    def utterance(self, transcript: str, lang: str, latency_ms: dict[str, float]) -> dict: ...

    def voice_enabled(self) -> bool: ...
