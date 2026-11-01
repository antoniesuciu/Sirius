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
