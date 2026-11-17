import threading
import time

import numpy as np
import pytest

from sirius_voice.protocols import FRAME_SAMPLES
from sirius_voice.session import Phase, VoiceSession, _Shutdown
from sirius_voice.text import Endpoint, Endpointer, SentenceBuffer

SPEECH = np.ones(FRAME_SAMPLES, dtype=np.float32)
SILENCE = np.zeros(FRAME_SAMPLES, dtype=np.float32)


class FakeMic:
    def __init__(self, frames):
        self.scripted = frames
        self.closed = 0
        self.opened = 0

    def frames(self):
        self.opened += 1
        yield from self.scripted

    def close(self):
        self.closed += 1


class FakeVad:
    def reset(self):
        pass

    def speech_probability(self, frame):
        return float(frame[0])


class FakeStt:
    def __init__(self, text="add buy rice to today", lang="en"):
        self.result = (text, lang)
        self.audio = None

    def prepare(self):
        pass

    def transcribe(self, audio):
        self.audio = audio
        return self.result

    def idle(self):
        return False


class FakeTts:
    def __init__(self):
        self.said = []

    def prepare(self):
        pass

    def release_if_idle(self):
        pass

    def synthesize(self, text, lang):
        self.said.append((text, lang))
        return [np.zeros(10, dtype=np.float32)], 22050


class FakeSpeaker:
    def __init__(self):
        self.stopped = threading.Event()
        self.hold = False

    def play(self, chunks, rate, on_level):
        list(chunks)
        on_level(0.5)
        if self.hold:
            self.stopped.wait(2)
            return not self.stopped.is_set()
        return True

    def stop(self):
        self.stopped.set()

    def reset(self):
        pass  # `stopped` is kept as a record of what was stopped; the real flag is tested below.


class FakeCore:
    def __init__(self, result=None, enabled=True, fail=False):
        self.result = result or {
            "route": "fast_path",
            "turn_id": "t",
            "intent": "add_task",
            "reply": "Added it.",
        }
        self.enabled = enabled
        self.fail = fail
        self.states = []
        self.sent = []

    def set_state(self, state, *, mic_open, transcript=None, level=None):
        self.states.append((state, mic_open))

    def utterance(self, transcript, lang, latency_ms):
        if self.fail:
            raise RuntimeError("core down")
        self.sent.append((transcript, lang))
        return self.result

    def voice_enabled(self):
        return self.enabled


def build(frames=None, **overrides):
    parts = {
        "mic": FakeMic(frames if frames is not None else [SPEECH] * 5 + [SILENCE] * 30),
        "vad": FakeVad(),
        "stt": FakeStt(),
        "tts": FakeTts(),
        "speaker": FakeSpeaker(),
        "core": FakeCore(),
    }
    parts.update(overrides)
    return VoiceSession(**parts), parts


def drive(session, *steps):
    """Runs the worker, plays each step, then shuts it down cleanly."""
    worker = threading.Thread(target=session.run, daemon=True)
    worker.start()
    for step in steps:
        step()
        time.sleep(0.05)
    session.inbox.put(_Shutdown())
    worker.join(3)
    assert not worker.is_alive()


class TestEndpointer:
    FRAME = 0.1

    def run(self, probabilities):
        endpointer = Endpointer(frame_seconds=self.FRAME)
        for i, p in enumerate(probabilities):
            outcome = endpointer.feed(p)
            if outcome is not Endpoint.CONTINUE:
                return outcome, i
        return Endpoint.CONTINUE, len(probabilities)

    def test_ends_after_700_ms_of_silence(self):
        assert self.run([1, 1] + [0] * 6) == (Endpoint.CONTINUE, 8)
        assert self.run([1, 1] + [0] * 8)[0] is Endpoint.SPEECH_ENDED

    def test_a_short_pause_does_not_end_it(self):
        assert self.run([1, 0, 0, 0, 1, 0, 0, 0, 1])[0] is Endpoint.CONTINUE

    def test_hard_cap_at_20_seconds(self):
        outcome, frame = self.run([1] * 300)
        assert outcome is Endpoint.SPEECH_ENDED
        assert frame == pytest.approx(199, abs=1)

    def test_gives_up_when_nobody_speaks(self):
        assert self.run([0] * 100)[0] is Endpoint.NO_SPEECH


class TestSentenceBuffer:
    def test_splits_as_text_arrives(self):
        buffer = SentenceBuffer()
        assert buffer.push("Hello the") == []
        assert buffer.push("re. How are") == ["Hello there."]
        assert buffer.push(" you? ") == ["How are you?"]
        assert buffer.flush() is None

    def test_waits_for_space_after_punctuation(self):
        buffer = SentenceBuffer()
        assert buffer.push("It costs 3.") == []
        assert buffer.push("5 euro. ") == ["It costs 3.5 euro."]

    def test_flush_returns_the_tail(self):
        buffer = SentenceBuffer()
        buffer.push("No full stop")
        assert buffer.flush() == "No full stop"


class TestPushToTalk:
    def test_fast_path_speaks_the_reply(self):
        session, parts = build()
        drive(session, session.ptt)
        assert parts["core"].sent == [("add buy rice to today", "en")]
        assert parts["tts"].said == [("Added it.", "en")]
        assert parts["core"].states[0] == ("listening", True)
        assert parts["core"].states[-1] == ("idle", False)

    def test_mic_is_closed_before_transcribing(self):
        session, parts = build()
        drive(session, session.ptt)
        assert parts["mic"].closed >= 1
        states = parts["core"].states
        assert states[states.index(("listening", True)) + 1] == ("thinking", False)

    def test_replies_in_the_language_heard(self):
        session, parts = build(stt=FakeStt("adaugă orez", "ro"))
        drive(session, session.ptt)
        assert parts["tts"].said[0][1] == "ro"

    def test_silence_transcribes_nothing(self):
        session, parts = build(frames=[SILENCE] * 300)
        drive(session, session.ptt)
        assert parts["stt"].audio is None
        assert parts["core"].states[-1] == ("idle", False)

    def test_pressing_again_ends_the_utterance(self):
        session, parts = build(frames=[SPEECH] * 2)
        session.phase = Phase.LISTENING
        session.ptt()
        assert session.end_early.is_set()
        assert session.inbox.empty()

    def test_esc_before_capture_starts_cancels_the_session(self):
        session, parts = build()
        session.ptt()
        session.stop()  # Queued behind the press while the models were still loading.
        drive(session)
        assert parts["mic"].opened == 0
        assert ("listening", True) not in parts["core"].states
        assert parts["core"].states[-1] == ("idle", False)
        assert session.phase is Phase.IDLE and not session.abort.is_set()

    def test_esc_while_the_models_load_cancels_the_session(self):
        class EscDuringPrepare(FakeStt):
            def prepare(self):
                session.stop()

        session, parts = build(stt=EscDuringPrepare())
        drive(session, session.ptt)
        assert parts["mic"].opened == 0
        assert parts["core"].sent == []
        assert session.phase is Phase.IDLE

    def test_a_second_press_before_capture_starts_does_not_start_a_second_session(self):
        class PressDuringPrepare(FakeStt):
            def prepare(self):
                session.ptt()

        session, parts = build(stt=PressDuringPrepare())
        drive(session, session.ptt)
        assert parts["mic"].opened == 1
        assert parts["core"].states.count(("listening", True)) == 1
        assert session.phase is Phase.IDLE

    def test_esc_while_thinking_suppresses_the_fast_path_reply(self):
        class EscDuringTranscribe(FakeStt):
            def transcribe(self, audio):
                session.stop()
                return super().transcribe(audio)

        session, parts = build(stt=EscDuringTranscribe())
        drive(session, session.ptt)
        assert parts["core"].sent == [("add buy rice to today", "en")]
        assert parts["tts"].said == []
        assert parts["core"].states[-1] == ("idle", False)
        assert session.phase is Phase.IDLE

    def test_voice_off_never_opens_the_mic(self):
        session, parts = build(core=FakeCore(enabled=False))
        drive(session, session.ptt)
        assert parts["mic"].opened == 0

    def test_an_empty_reply_stays_silent(self):
        core = FakeCore({"route": "fast_path", "turn_id": "t", "intent": "cancel", "reply": None})
        session, parts = build(core=core)
        drive(session, session.ptt)
        assert parts["tts"].said == []

    def test_a_failure_closes_the_mic_and_keeps_running(self):
        session, parts = build(core=FakeCore(fail=True))
        drive(session, session.ptt, session.ptt)
        assert parts["core"].states[-1] == ("idle", False)
        assert parts["mic"].opened == 2


class TestAgentReplies:
    agent = {"route": "agent", "turn_id": "turn-1", "intent": None, "reply": None}

    def test_speaks_sentence_by_sentence_as_it_streams(self):
        session, parts = build(core=FakeCore(self.agent))
        drive(
            session,
            session.ptt,
            lambda: session.reply("turn-1", "First one. Sec", "en", False),
            lambda: session.reply("turn-1", "ond one.", "en", False),
            lambda: session.reply("turn-1", "", "en", True),
        )
        assert [t for t, _ in parts["tts"].said] == ["First one.", "Second one."]
        assert parts["core"].states[-1] == ("idle", False)

    def test_ignores_turns_it_did_not_start(self):
        session, parts = build(core=FakeCore(self.agent))
        drive(session, session.ptt, lambda: session.reply("other", "Not mine. ", "en", False))
        assert parts["tts"].said == []


def test_barge_in_stops_speaking_and_listens_again():
    speaker = FakeSpeaker()
    speaker.hold = True
    session, parts = build(speaker=speaker)
    drive(session, session.ptt, lambda: time.sleep(0.05), session.ptt, lambda: time.sleep(0.1))
    assert speaker.stopped.is_set()
    assert parts["mic"].opened == 2


def test_esc_aborts_listening():
    class AbortingMic(FakeMic):
        def frames(self):
            yield SPEECH
            session.stop()
            yield SPEECH

    session, parts = build(mic=AbortingMic([]))
    drive(session, session.ptt)
    assert parts["stt"].audio is None
    assert parts["core"].sent == []
    assert parts["core"].states[-1] == ("idle", False)


def test_goes_back_to_idle_memory_after_a_quiet_period(monkeypatch):
    monkeypatch.setattr("sirius_voice.session.IDLE_CHECK_S", 0.01)
    stt = FakeStt()
    stt.idle = lambda: True
    restarted = threading.Event()
    session, _ = build(stt=stt)
    session.on_idle = restarted.set
    drive(session, lambda: restarted.wait(1))
    assert restarted.is_set()


def test_no_audio_reaches_disk(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    session, _ = build()
    drive(session, session.ptt)
    assert list(tmp_path.iterdir()) == []


def test_pace_stretches_the_voice_it_is_applied_to(tmp_path):
    from types import SimpleNamespace

    from sirius_voice.engines import PiperTts

    class Voice:
        config = SimpleNamespace(sample_rate=22_050, length_scale=1.2)

        def synthesize(self, text, syn_config):
            self.used = syn_config
            return []

    tts = PiperTts(tmp_path, "en", "ro", pace=1.5)
    tts._voices["en"] = voice = Voice()
    chunks, rate = tts.synthesize("hello", "en")
    list(chunks)
    assert rate == 22_050
    assert voice.used.length_scale == pytest.approx(1.8)


class FakeProcess:
    """Stands in for pw-play: records what was written and exits at once."""

    def __init__(self, *args, **kwargs):
        self.written = []
        self.stdin = self

    def write(self, data):
        self.written.append(data)

    def flush(self):
        pass

    def close(self):
        pass

    def poll(self):
        return 0


def real_speaker(monkeypatch):
    from sirius_voice import engines

    processes = []

    def popen(*args, **kwargs):
        processes.append(FakeProcess())
        return processes[-1]

    monkeypatch.setattr(engines.subprocess, "Popen", popen)
    return engines.PipeWireSpeaker(), processes


def test_esc_between_the_abort_check_and_play_is_honored(monkeypatch):
    speaker, processes = real_speaker(monkeypatch)

    class EscWhileSynthesizing(FakeTts):
        def synthesize(self, text, lang):
            session.stop()  # After _speak's abort check, before play() starts.
            return super().synthesize(text, lang)

    agent = {"route": "agent", "turn_id": "turn-1", "intent": None, "reply": None}
    session, parts = build(speaker=speaker, tts=EscWhileSynthesizing(), core=FakeCore(agent))
    drive(session, session.ptt, lambda: session.reply("turn-1", "Hello there. ", "en", False))
    assert [p.written for p in processes] == [[]]  # Started, but nothing was played.
    assert session.phase is Phase.IDLE


def test_a_stop_does_not_silence_the_next_utterance(monkeypatch):
    speaker, processes = real_speaker(monkeypatch)
    speaker.stop()  # Esc or a barge-in with nothing playing.
    speaker.reset()
    assert speaker.play([np.zeros(10, dtype=np.float32)], 22050, lambda _level: None)
    assert processes[0].written


def test_a_failure_does_not_swallow_a_press_that_arrived_during_it():
    phases = []

    class FailingTts(FakeTts):
        def synthesize(self, text, lang):
            if not self.said:
                self.said.append((text, lang))
                session.ptt()  # Barge-in while this reply is being synthesized.
                raise RuntimeError("tts down")
            return super().synthesize(text, lang)

    class RecordingCore(FakeCore):
        def set_state(self, state, **kwargs):
            if state == "idle":
                phases.append(session.phase)
            super().set_state(state, **kwargs)

    agent = {"route": "agent", "turn_id": "turn-1", "intent": None, "reply": None}
    session, parts = build(tts=FailingTts(), core=RecordingCore(agent))
    drive(session, session.ptt, lambda: session.reply("turn-1", "Hello there. ", "en", False))
    assert phases[0] is Phase.REQUESTED  # Not reset to IDLE under the queued press.
    assert parts["mic"].opened == 2


def test_a_failure_before_capture_releases_its_own_press():
    class BrokenStt(FakeStt):
        def prepare(self):
            raise RuntimeError("model missing")

    session, parts = build(stt=BrokenStt())
    drive(session, session.ptt)
    assert session.phase is Phase.IDLE
