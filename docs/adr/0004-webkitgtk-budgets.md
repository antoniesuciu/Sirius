# ADR 0004: keep Tauri, and let decoration rest

Status: proposed, 2026-11-01. Measured on the Lenovo LOQ (Ubuntu, GNOME 46, Wayland).

ADR-1 makes Electron the fallback if WebKitGTK fails the section 4.1 budgets, and asks for
the result to be recorded here. Results are in `docs/verified.md`.

Any running CSS animation costs about 22% of a core, and removing the falling leaves changes
nothing. One bobbing wolf costs as much as nine leaves, because WebKitGTK composites the whole
window at 60 fps while anything moves. So animating only cheap properties, which is what the
spec asks for, cannot reach the "under 1%, leaves on" target on this engine.

Decision: decoration stops 30 s after the last input, or when the window loses focus, and
returns on the next input. Breathing, the listening ring and a thinking avatar keep going.

Disabling the DMA-BUF renderer or compositing, the spec's suggested workaround, raised CPU to
over 80% here, so neither is set.
