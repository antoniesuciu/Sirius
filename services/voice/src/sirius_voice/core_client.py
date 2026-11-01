"""Talks to the Sirius core: HTTP for calls, SSE for commands and streamed replies."""

import json
import logging
import os
import time
from pathlib import Path

import httpx

log = logging.getLogger(__name__)

MAX_BACKOFF_S = 30


class CoreClient:
    def __init__(self, base_url: str, token_file: Path) -> None:
        self.base_url = base_url
        self.token_file = token_file
        self.http = httpx.Client(base_url=base_url, headers=self._headers(), timeout=5)

    def _headers(self) -> dict[str, str]:
        token = self.token_file.read_text().strip()
        # Without the actor and via headers these would count as UI calls.
        return {"authorization": f"Bearer {token}", "x-sirius-via": "voice"}

    def set_state(
        self,
        state: str,
        *,
        mic_open: bool,
        transcript: str | None = None,
        level: float | None = None,
    ) -> None:
        body = {"state": state, "mic_open": mic_open, "transcript": transcript, "level": level}
        try:
            self.http.post("/v1/voice/state", json=body)
        except httpx.HTTPError as error:
            log.warning("could not report voice state: %s", error)

    def utterance(self, transcript: str, lang: str, latency_ms: dict[str, float]) -> dict:
        response = self.http.post(
            "/v1/voice/utterance",
            json={"transcript": transcript, "lang": lang, "latency_ms": latency_ms},
            timeout=10,
        )
        response.raise_for_status()
        return response.json()

    def voice_enabled(self) -> bool:
        """F33: one setting turns voice off. If the core cannot say, stay on the safe side."""
        try:
            settings = self.http.get("/v1/settings").json()
        except httpx.HTTPError:
            return False
        return settings.get("voice.enabled") is not False

    def events(self, on_event, should_stop) -> None:
        """Delivers events until told to stop, reconnecting with capped backoff."""
        backoff = 1
        headers = {"accept": "text/event-stream", "x-sirius-client": "voice-service"}
        while not should_stop():
            try:
                with self.http.stream("GET", "/v1/events", headers=headers, timeout=None) as stream:
                    stream.raise_for_status()
                    backoff = 1
                    log.info("connected to core at %s", self.base_url)
                    for line in stream.iter_lines():
                        if should_stop():
                            return
                        if line.startswith("data:"):
                            on_event(json.loads(line[5:]))
            except (httpx.HTTPError, json.JSONDecodeError) as error:
                log.info("event stream lost: %s", error)
            time.sleep(backoff)
            backoff = min(backoff * 2, MAX_BACKOFF_S)


def from_env(data_dir: Path) -> CoreClient:
    port = os.environ.get("SIRIUS_PORT", "7337")
    url = os.environ.get("SIRIUS_CORE_URL", f"http://127.0.0.1:{port}")
    token = Path(os.environ.get("SIRIUS_TOKEN_FILE", data_dir / "token"))
    return CoreClient(url, token)
