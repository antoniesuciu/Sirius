"""`sirius-voice`: wires the real engines together and runs until stopped."""

import logging
import os
import signal
import sys
import threading
import time

from .core_client import from_env
from .engines import (
    PiperTts,
    PipeWireMic,
    PipeWireSpeaker,
    SileroVad,
    WhisperStt,
    data_dir,
    earcon,
)
from .session import VoiceSession

log = logging.getLogger("sirius_voice")


def wait_for_token(path, timeout: float = 60) -> None:
    """At login the voice service can start before the core has created the token."""
    deadline = time.monotonic() + timeout
    while not path.exists() and time.monotonic() < deadline:
        time.sleep(0.5)


def restart_to_free_memory() -> None:
    """Loaded CUDA libraries cannot be unloaded, so 600 MB would stay resident after the first
    use. A quiet restart is the one reliable way back to the idle budget of under 150 MB."""
    log.info("idle: restarting to release the models")
    os.execv(sys.executable, [sys.executable, "-m", "sirius_voice"])


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(name)s: %(message)s")
    # Voice state is posted ten times a second while speaking, which is not worth a log line.
    logging.getLogger("httpx").setLevel(logging.WARNING)
    base = data_dir()
    wait_for_token(base / "token")
    core = from_env(base)
    speaker = PipeWireSpeaker()
    tts = PiperTts(
        base / "voices",
        os.environ.get("SIRIUS_VOICE_EN", "en_US-lessac-medium"),
        os.environ.get("SIRIUS_VOICE_RO", "ro_RO-mihai-medium"),
    )
    session = VoiceSession(
        mic=PipeWireMic(),
        vad=SileroVad(),
        stt=WhisperStt(os.environ.get("SIRIUS_STT_MODEL", "small")),
        tts=tts,
        speaker=speaker,
        core=core,
        earcon=lambda: earcon(speaker),
        on_idle=restart_to_free_memory,
    )

    stopping = threading.Event()

    def on_event(event: dict) -> None:
        match event.get("type"):
            case "voice_command" if event["command"] == "ptt":
                session.ptt()
            case "voice_command":
                session.stop()
            case "voice_reply":
                session.reply(event["turn_id"], event["text"], event["lang"], event["final"])

    def on_signal(*_args) -> None:
        stopping.set()
        session.shutdown()

    signal.signal(signal.SIGTERM, on_signal)
    signal.signal(signal.SIGINT, on_signal)

    threading.Thread(
        target=core.events, args=(on_event, stopping.is_set), daemon=True, name="events"
    ).start()
    log.info("ready; the microphone stays closed until push-to-talk")
    session.run()


if __name__ == "__main__":
    main()
