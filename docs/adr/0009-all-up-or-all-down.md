# ADR 0009: Sirius is all up or all down

Status: accepted, 2026-11-03. Decided by the owner, after killing one process left the window
showing "Load failed" with no core behind it.

Decision, for a local core only:

- The app going away by any route, including SIGKILL, stops the core 10 seconds later. The core
  sees this as the desktop's event stream closing, so no signal handling is needed.
- A clean core exit is final, so `Restart=on-failure` returns. Voice is bound to the core and stops
  with it. A crash still restarts, and the app waits 15 seconds before deciding the core has gone.
- Opening the app starts a stopped core, which brings voice back.

Two exceptions. Closing with the X hides to the tray and keeps everything running. Killing voice
alone restarts voice, because `sirius voice off` has to be able to stop it without stopping Sirius.

Cost: after a real Quit, reminders and agent alerts stop until the app is opened again, which
narrows F24 to a window closed to the tray. If the app never connected, as on a login where it
did not start, the core keeps running. A remote core ignores all of this, because it serves other
devices.

Amended 2026-11-03, decided by the owner: once a phone is paired (ADR 0010) the laptop is its
server, so the app leaving no longer stops the core. Stopping or killing the core still takes
voice and the window with it, and opening the app still starts everything. With no phone paired,
the rules above apply unchanged. `sirius forget-phones` returns to them.
