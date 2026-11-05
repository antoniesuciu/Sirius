# Sirius logo playgrounds

Two animated versions of the layered logo, side by side for comparison. Both render the app's
own components from `packages/ui/src`, with the app's theme tokens.

| Page | Component | States |
| --- | --- | --- |
| `logo.html` | `SiriusLogo.tsx`, ported from the spec, in the app | startup, idle, listening, thinking, working, speaking, notify, error, sleep |
| `mark.html` | `SiriusMark.tsx`, the earlier five-state version, kept to compare | idle, listening, thinking, speaking, asleep |
| `playground.html` | the owner's original standalone spec | the same nine |

```sh
bun install --cwd docs/design/sirius-logo
bun run --cwd docs/design/sirius-logo dev   # http://127.0.0.1:5187, keys 1–9 switch state
```

`sirius.svg` is the source of the layers. After regenerating it with
`uv run scripts/logo_to_layers.py <logo.png> docs/design/sirius-logo/sirius.svg`, run
`bun scripts/orbit-paths.ts` to update `packages/ui/src/avatar/orbit.gen.ts`.

In the app: startup plays once at launch; listening, thinking and speaking follow the voice
and the chat; working shows while a Claude or Codex session runs (`sirius notify`); notify
plays on a new `turn_complete` or `needs_input` event (not in quiet mode); error on an agent
error or a failed send; sleep in quiet mode. Ambient idle is off (ADR 0004), so idle only
blinks, every 20–40 s.

`verify.ts` steps both playgrounds through every state, fails on page errors and writes
`captures/`.
