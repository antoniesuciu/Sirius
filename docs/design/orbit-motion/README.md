# Orbit motion studies

Standalone GSAP 3.15.1 + SVG prototypes. Nothing is imported by the desktop app;
the application's UI, dependencies, and voice orb are unchanged.

```sh
bun install --cwd docs/design/orbit-motion
bun run --cwd docs/design/orbit-motion dev
```

Open http://127.0.0.1:5186. Includes five simultaneous studies, a larger interactive
preview, subtle/expressive motion, a state sequence, pause, dark/light canvases,
and manual or explicitly simulated voice amplitude. No audio is recorded.

| State | Motion |
| --- | --- |
| `idle` | Star twinkle with a quiet interval |
| `listening` | DrawSVG light arc reveals and rotates slowly |
| `thinking` | Short highlight sweeps around the orbit |
| `speaking` | Amplitude controls star scale and glow; zero returns to rest |
| `needs_input` | Repeating amber pulse until the state changes |

The supplied PNG is retained as `orbit.png`. An SVG clip separates the body from
the star, which is redrawn as a vector for independent transforms. The crescent
and wolf remain fused in the original image; the moving ring is a separate SVG
light arc. This is not a full vector tracing or silhouette morph.

Animations stop while hidden or paused, and respect changes to reduced-motion
preferences. The needs-input color remains visible with motion disabled.
Speaking takes a normalized `level` prop; actual audio integration is deferred.

Build: `bun run --cwd docs/design/orbit-motion build`.

With the repo's development dependencies and Playwright Chromium installed,
start the preview above and run:

```sh
bun docs/design/orbit-motion/verify.ts
```

Checks browser errors, state selection, amplitude/silence, highlight motion,
pause, reduced motion, and phone overflow. Captures are in `captures/`.
`--capture` also writes 60 animation-strip frames to `/tmp/sirius-orbit-frames/`.

GSAP's no-charge license and plugins: https://gsap.com/standard-license/
