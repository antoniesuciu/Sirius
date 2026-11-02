"""Transcribes audio recorded elsewhere, for phone push-to-talk (ADR-10, M8).

Off unless SIRIUS_VOICE_PORT is set. The audio is decoded in memory and never written to disk.
"""

import io
import json
import logging
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from .protocols import Stt

log = logging.getLogger(__name__)

MAX_BYTES = 10 * 1024 * 1024


def decode(data: bytes):
    from faster_whisper import decode_audio

    return decode_audio(io.BytesIO(data))


def start_upload_server(stt: Stt, host: str, port: int, decoder=decode) -> ThreadingHTTPServer:
    class Handler(BaseHTTPRequestHandler):
        def do_POST(self) -> None:
            length = int(self.headers.get("content-length") or 0)
            if self.path != "/transcribe" or not 0 < length <= MAX_BYTES:
                self.send_error(400)
                return
            try:
                text, lang = stt.transcribe(decoder(self.rfile.read(length)))
            except Exception:
                log.exception("could not transcribe an upload")
                self.send_error(422)
                return
            body = json.dumps({"text": text, "lang": lang}).encode()
            self.send_response(200)
            self.send_header("content-type", "application/json")
            self.send_header("content-length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, format: str, *args) -> None:
            pass  # Requests are not worth a log line, and nothing here should record speech.

    server = ThreadingHTTPServer((host, port), Handler)
    threading.Thread(target=server.serve_forever, daemon=True, name="uploads").start()
    return server
