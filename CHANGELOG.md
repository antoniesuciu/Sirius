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
