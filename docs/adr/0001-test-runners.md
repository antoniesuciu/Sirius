# ADR 0001: `bun test` for server packages, Vitest for browser code

Status: accepted, 2026-11-01.

The spec names Vitest for unit and integration tests. Vitest 5 cannot load `bun:sqlite`:
its worker loader rejects the `bun:` scheme in the `forks` and `threads` pools, and the
`vmThreads` pool cannot resolve it (tried under `bunx --bun vitest`).

Decision: `contracts`, `core`, `mcp` and `cli` run under `bun test`. Their tests still
import from `vitest`, which Bun's runner maps to its own API, so they stay portable.
Vitest remains the runner for code that needs Vite transforms.

Rejected: a `node:sqlite` shim behind the runtime seam. It would keep one runner but test
against a driver production never uses, and that is the code most worth testing for real.
