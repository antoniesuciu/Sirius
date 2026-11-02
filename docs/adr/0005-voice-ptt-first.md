# ADR 0005: v1 voice is push-to-talk only

Status: accepted, 2026-11-01. Decided by the owner. The wake word's target moved from M7 to M9 in ADR 0006.

M6 originally included the "Hey Sirius" wake word. The owner deferred it to the later
milestones (M7), so M6 ships push-to-talk through the mic button and `sirius voice ptt`.

The wake word needs a custom trained model and a measured false-accept rate over real work
sessions, neither of which is needed to make voice useful. Dropping it also means the mic is
closed unless the user opened it, which simplifies F33: no always-on capture in v1.

The `WakeWord` protocol arrives with M7, so
nothing for it is built now. F26 stays in the spec, marked deferred.

Audio goes through `pw-record` and `pw-play` rather than PortAudio, as ADR-10 allows. They need
no system package, and the mic is a process that only exists during a session, which makes F33
easy to check: no process, no capture.
