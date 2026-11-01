"""Pure logic: deciding when speech ended, and where sentences end."""

import re
from enum import Enum, auto

from .protocols import FRAME_SECONDS

SPEECH_THRESHOLD = 0.5
SILENCE_TO_END_S = 0.7  # F28
HARD_CAP_S = 20.0  # F28
#: Someone who pressed the button but said nothing should not hold the mic open.
NO_SPEECH_TIMEOUT_S = 6.0


class Endpoint(Enum):
    CONTINUE = auto()
    SPEECH_ENDED = auto()
    NO_SPEECH = auto()


class Endpointer:
    """Turns per-frame speech probabilities into "keep listening" or "that was it"."""

    def __init__(self, frame_seconds: float = FRAME_SECONDS) -> None:
        self.frame_seconds = frame_seconds
        self.elapsed = 0.0
        self.silence = 0.0
        self.heard_speech = False

    def feed(self, probability: float) -> Endpoint:
        self.elapsed += self.frame_seconds
        if probability >= SPEECH_THRESHOLD:
            self.heard_speech = True
            self.silence = 0.0
        else:
            self.silence += self.frame_seconds

        if self.heard_speech:
            if self.silence >= SILENCE_TO_END_S or self.elapsed >= HARD_CAP_S:
                return Endpoint.SPEECH_ENDED
        elif self.elapsed >= NO_SPEECH_TIMEOUT_S:
            return Endpoint.NO_SPEECH
        return Endpoint.CONTINUE


_SENTENCE_END = re.compile(r"(.+?[.!?…]+)(\s+|$)", re.S)


class SentenceBuffer:
    """Collects streamed text and hands out whole sentences, so TTS can start early (F31).

    A sentence only counts as finished when whitespace follows its punctuation, because a
    stream can stop halfway through "3.5" or "e.g.".
    """

    def __init__(self) -> None:
        self.buffer = ""

    def push(self, text: str) -> list[str]:
        self.buffer += text
        sentences = []
        while True:
            match = _SENTENCE_END.match(self.buffer)
            if not match or not match.group(2):
                return sentences
            sentences.append(match.group(1).strip())
            self.buffer = self.buffer[match.end() :]

    def flush(self) -> str | None:
        rest = self.buffer.strip()
        self.buffer = ""
        return rest or None
