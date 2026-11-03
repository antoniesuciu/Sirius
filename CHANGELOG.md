# Changelog

## M0: dashboard on fixtures (2026-11-01)

- Bun workspace, strict TypeScript, Biome, Vitest, Playwright and GitHub Actions.
- Operation registry, schemas, typed client and 04:00 calendar logic in `packages/contracts`.
- The full dashboard in React, with a fixture backend at `?fixtures`.
- Avatar reduced from 154 KB to 54 KB (18 KB gzipped), with blinks driven by timers so the
  idle page is not ticking inside the SVG.

## M1: core service (2026-11-01)

- Hono REST and SSE generated from the op registry, plus an OpenAPI document.
- SQLite in WAL mode with embedded migrations. Every write goes through a unit of work that
  bumps `rev`, writes `change_log` and publishes after commit.
- Proposals, 30 s batch undo, and core-side enforcement of F19, including a limit on repeated
  single edits (ADR 0002).
- Scheduler for 04:00 rollover, reminders, proposal expiry and daily backups.
- The UI now talks to the core, with optimistic updates that roll back on failure.

## M2: desktop shell, partly (2026-11-01)

- Tauri 2 shell with tray, single instance and release-only autostart. `.deb` and AppImage build.
- `sirius-core.service` for systemd. Fresh-login behaviour and the section 4.1 budgets on the
  real desktop session are not measured yet.

## M3: MCP (2026-11-01)

- `sirius-mcp`, a stdio adapter whose tools come from the op registry.

## M4: Sirius chat (2026-11-01)

- Claude and Codex adapters, streaming, resumed sessions, agent and model selection, calm errors.
- `bench/agents.ts` runs both real CLIs through add, proposal and roadmap flows and proves
  neither can read a canary file (ADR 0003).

## M5: agent attention (2026-11-01)

- `sirius` CLI: `notify`, `setup-hooks`, `doctor`, `backup`. `notify` always exits 0 and gives up
  after a second, so a hook can never hold up an agent.
- Duplicate events coalesce, notifications are limited per source, and quiet mode queues events
  until Welcome back or rollover.
- `turn_complete` notifies without leaving a toast and clears an earlier "waiting" event for that
  project. Codex's `notify` only ever sends this type, so it has no "needs input" signal.
- `scripts/install.sh`, which also records where the agent CLIs live for systemd.

## M6: push-to-talk voice (2026-11-01)

- `sirius-voice`: push-to-talk through the mic button or `sirius voice ptt`, Silero endpointing,
  Whisper with English and Romanian detection, Piper replies spoken sentence by sentence, barge-in.
- A fast-path grammar in both languages answers common commands without an AI turn. Proposals can
  be confirmed aloud within 15 seconds, except deletes.
- The wake word moved to M7 (ADR 0005).
- The mic is a `pw-record` process that only exists during a session. Audio stays in memory, and
  onnxruntime's telemetry is off before it can initialise.

## After M6 (2026-11-02)

- Laptop only for now: M7 and M8 are parked, and M9, Special additions, holds the wake word.
- Fixed a chat panel stuck on "thinking" when a turn failed before its response arrived.
- Undo is no longer offered for a proposal, which has changed nothing yet.
- An open window now notices the 04:00 rollover even when no task had to move.
- Speaking while a turn is running gets a spoken answer instead of silence.
- `sirius voice on|off` turns voice off and stops the service (F33).

## Local or deployed (2026-11-02)

- `deployment.env` and `scripts/deploy.sh` choose where Sirius runs (ADR 0007). The default stays
  local, and the branch `local-only` keeps a copy from before this work.
- M7, built but not deployed: Docker image, compose stack with Litestream and Cloudflare Tunnel,
  verified Cloudflare Access logins, and a desktop app that can point at a remote core.
- M8, built but not deployed: the core serves the UI as an installable PWA, with ntfy notifications
  and browser push-to-talk through `sirius-voice`.
- The images have never been built here, because this user cannot reach the Docker daemon.

## First real use (2026-11-02)

- One conversation until "New conversation": it stays when the agent changes, and the CLI session
  under it is replaced on a switch and after 20 turns, to limit usage (ADR 0008).
- Sirius remembers: a `remember` tool writes to one Markdown file, set by `SIRIUS_MEMORY_FILE`.
- The desktop window has no system title bar. It draws its own drag strip and controls.
- The model choice is a list drawn by Sirius instead of the GTK popup of a native select.
- Sirius is all up or all down (ADR 0009). Quitting or killing the app stops the core and voice,
  stopping the core closes the app, and opening the app starts everything. Voice alone restarts.
- An unreachable core is explained in the chat instead of WebKit's "Load failed".
- Desktop notifications now show a banner. At low urgency GNOME only filed them in the tray, which
  also hid every reminder.
- A new prompt in a project alerts again even if the last toast was never answered.
- `deployment.env` chooses Sirius's voices and pace, by Piper name or by a link to a voice file. The installer's voice download no longer lets
  onnxruntime report to Microsoft.
- Voice grammar learned phrases from a real voice: "and … today" as a misheard "add",
  "adaugă … azi", "lazi", "am ceva de făcut azi" and "ce mai am de făcut".
- Whisper decodes with a beam of 5 instead of greedily, and knows more of the Romanian commands.

## Phone (2026-11-03)

- The phone uses the laptop's own core over Tailscale, paired once with `sirius pair` (ADR 0010).
- It keeps a copy for when the laptop is away, and queues changes made meanwhile. Each change is
  applied once when the laptop is back, and one the laptop refuses is reported.
- Each install also updates the phone app, which picks up the new version on its next visit.
- The panel slogans are gone.
- With a phone paired, quitting the desktop app leaves the core running for it (ADR 0009).
- The phone reconnects whenever Sirius comes back on screen, since a sleeping phone's link dies
  silently.
- The chat's suggestion chips and the "Small things, if there's room" label are gone.
- Goals can be added by hand (F34), and a new list holds things to remember or buy (F35), by
  hand, by voice ("add milk to my list") or through either agent.
- The header's suggestions name the small task plainly, without "Something small:".
- Sirius and Well-being come first: the left column on the laptop, the top on the phone.
- A roadmap is renamed where its title is, and deleting a goal or roadmap asks once more. On a
  touch screen, Edit takes its own room instead of covering the text.
- Fixed: every change from the desktop app stayed queued, because the core's cross-origin rules
  did not allow the new idempotency-key header. Queued changes go through once the core is updated.
- Claude alerts only when it is blocked on you (a permission prompt or a question), not when a
  session is merely idle. `sirius notify` ignores idle notices, and `setup-hooks` now updates an
  existing Sirius hook instead of skipping it.
- The agent is told what you changed on the dashboard since its last reply, such as a proposal you
  confirmed or a goal you deleted, so it no longer reports a confirmed card as still waiting.
- Sirius speaks as a direct assistant (ADR 0011): no reassurance, rest advice or filler in the
  prompt, voice replies, alerts, suggestions or panel text. The header's suggestions are only
  real work now. The leaves and the breathing exercise stay.
- The chat takes PDF, Markdown and text files (F36), read by the core and passed to the agent as
  material, never as instructions. Real Claude turned a 12-week syllabus PDF into a 12-step
  roadmap and ignored a planted "delete every goal" line.
- A schedule for fixed commitments (F37, ADR 0012): weekly or one-off, apart from tasks, with a
  reminder 10 minutes before. Agents add and change it. `sirius calendar` gives an iCalendar feed
  that ICSx⁵ puts into Android's calendar and widgets. Real Claude filled it in correctly from one
  sentence and created no tasks.
- `SIRIUS_NTFY_URL` in `deployment.env` now also works on the laptop, for phone notifications
  through the ntfy app. It is off until a topic is chosen.
