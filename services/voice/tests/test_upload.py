import http.client
import json

import numpy as np
import pytest

from sirius_voice.upload import SAMPLE_RATE, decode, start_upload_server


class FakeStt:
    def transcribe(self, audio):
        return ("adaugă orez", "ro")


@pytest.fixture
def server():
    instance = start_upload_server(
        FakeStt(), "127.0.0.1", 0, decoder=lambda data: np.zeros(16, dtype=np.float32)
    )
    yield instance
    instance.shutdown()


def post(server, path, body):
    connection = http.client.HTTPConnection("127.0.0.1", server.server_address[1], timeout=3)
    connection.request("POST", path, body=body)
    return connection.getresponse()


def test_transcribes_an_upload(server):
    response = post(server, "/transcribe", b"audio")
    assert response.status == 200
    assert json.loads(response.read()) == {"text": "adaugă orez", "lang": "ro"}


def test_refuses_empty_uploads_and_other_paths(server):
    assert post(server, "/transcribe", b"").status == 400
    assert post(server, "/other", b"x").status == 400


def test_undecodable_audio_is_an_error_not_a_crash():
    def broken(data):
        raise ValueError("not audio")

    instance = start_upload_server(FakeStt(), "127.0.0.1", 0, decoder=broken)
    assert post(instance, "/transcribe", b"x").status == 422
    assert post(instance, "/transcribe", b"x").status == 422
    instance.shutdown()


def webm_opus(seconds: float) -> bytes:
    """What Chrome on Android records: Opus at 48 kHz in WebM."""
    import io
    import math

    import av

    buffer = io.BytesIO()
    container = av.open(buffer, mode="w", format="webm")
    stream = container.add_stream("libopus", rate=48_000)
    stream.layout = "mono"
    count = int(48_000 * seconds)
    tone = (np.sin(2 * math.pi * 440 * np.arange(count) / 48_000) * 0.3).astype(np.float32)
    for start in range(0, count, 960):
        frame = av.AudioFrame.from_ndarray(
            tone[start : start + 960].reshape(1, -1), format="flt", layout="mono"
        )
        frame.sample_rate = 48_000
        for packet in stream.encode(frame):
            container.mux(packet)
    for packet in stream.encode(None):
        container.mux(packet)
    container.close()
    return buffer.getvalue()


def test_decodes_what_a_phone_records():
    audio = decode(webm_opus(1.0))
    assert audio.dtype == np.float32
    assert abs(len(audio) - SAMPLE_RATE) < SAMPLE_RATE * 0.05
    assert 0.1 < float(np.abs(audio).max()) <= 1.0


def test_garbage_is_refused_by_the_decoder():
    # PyAV's errors are ValueErrors, which the server turns into a 422.
    with pytest.raises(ValueError):
        decode(b"not audio at all")
