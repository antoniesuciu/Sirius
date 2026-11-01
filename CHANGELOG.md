# Changelog

## M0: dashboard on fixtures (2026-11-01)

- Bun workspace, strict TypeScript, Biome, Vitest, Playwright and GitHub Actions.
- Operation registry, schemas, typed client and 04:00 calendar logic in `packages/contracts`.
- The full dashboard in React, with a fixture backend at `?fixtures`.
- Avatar reduced from 154 KB to 54 KB (18 KB gzipped), with blinks driven by timers so the
  idle page is not ticking inside the SVG.
