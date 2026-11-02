import http.client
import json

import numpy as np
import pytest

from sirius_voice.upload import start_upload_server


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
