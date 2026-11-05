# Sirius logo playgrounds

Two animated versions of the layered logo, side by side for comparison. Both render the app's
own components from `packages/ui/src`, with the app's theme tokens.

| Page | Component | States |
| --- | --- | --- |
| `mark.html` | `SiriusMark.tsx`, in the app now | idle, listening, thinking, speaking, asleep |
| `logo.html` | `SiriusLogo.tsx`, ported from the spec | startup, idle, listening, thinking, working, speaking, notify, error, sleep |
| `playground.html` | the owner's original standalone spec | the same nine |

```sh
bun install --cwd docs/design/sirius-logo
bun run --cwd docs/design/sirius-logo dev   # http://127.0.0.1:5187, keys 1–9 switch state
```

`sirius.svg` is the source of the layers. After regenerating it with
`uv run scripts/logo_to_layers.py <logo.png> docs/design/sirius-logo/sirius.svg`, run
`bun scripts/orbit-paths.ts` to update `packages/ui/src/avatar/orbit.gen.ts`.

`verify.ts` steps both playgrounds through every state, fails on page errors and writes
`captures/`.
