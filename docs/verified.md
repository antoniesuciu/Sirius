# Verified vendor facts

Things the spec marked **[verify]**, checked against the installed tools. Dates matter:
re-check after upgrading a CLI.

## 2026-11-01

| Item | Finding | Source |
|---|---|---|
| Claude CLI | 2.1.316 | `claude --version` |
| Disable built-in tools | `--tools ""` | `claude --help` |
| MCP isolation | `--mcp-config <file>` with `--strict-mcp-config` | `claude --help` |
| Streaming | `--output-format stream-json`, `--include-partial-messages` for deltas | `claude --help` |
| Resume | `--resume <session-id>` | `claude --help` |
| Claude model id | `claude-haiku-5-5` | model list for this release |
| Codex headless | `codex exec`, `-m <model>`, `-s read-only`, `-c key=value` | `codex exec --help` |
| Codex resume | `codex exec resume <SESSION_ID> [PROMPT]` | `codex exec resume --help` |
| Codex model ids | `gpt-6.1-sol`, `gpt-6.1-terra`, `gpt-6-astra`, `gpt-6-sol`, `gpt-6-luna`, … | `~/.codex/models_cache.json` |

**"6.1 Sol Light" is an inference.** No such slug exists. `gpt-6.1-sol` has `low` as its
default reasoning level, so "Light" is read as that model at low effort. Adding or changing
models is one line in `packages/contracts/src/models.ts`.

Measured against the real CLIs with `bench/agents.ts`, 2026-11-01:

| | First text | Whole turn with one tool call |
|---|---|---|
| Claude Haiku 5.5 | 2.5 s | 3.5 s |
| Codex gpt-6.1-sol, low effort | 4.0 s | 9.0 s |

Both completed add, proposal and roadmap flows, and neither could read a canary file in the
agent working directory.

Things found the hard way:

- `claude -p` waits 3 s for stdin when given a pipe, so spawn it with `/dev/null`.
- `--bare` looks ideal but ignores subscription auth. Use `--setting-sources ""` instead.
  `apiKeySource: none` in the init event confirms the turn is on the subscription.
- `codex exec resume` has no `-s` or `-C`, so set `sandbox_mode` with `-c` and use the process cwd.
- `--ephemeral` disables resume, so it cannot be used for chat.
- Codex returns whole messages, not deltas. The UI's smoothing handles both.
- The Codex launcher is `#!/usr/bin/env node`. Inside `bun run`, `node` is really Bun and the
  launcher's `process.execve` silently exits 0 with no output.
- Under systemd the core does not inherit the login PATH, and `codex` lives under nvm, so
  the installer records the real paths in `~/.config/sirius/env`.

Desktop app on the LOQ, GNOME 46 on Wayland, measured with `bench/desktop.ts`:

| Variant | Idle CPU | Memory (PSS, process tree) |
|---|---|---|
| Default, decoration moving | 22.6% | 304 MB |
| Leaves off | 22.9% | 306 MB |
| `WEBKIT_DISABLE_DMABUF_RENDERER=1` | 89.6% | 231 MB |
| `WEBKIT_DISABLE_COMPOSITING_MODE=1` | 82.0% | 231 MB |
| Decoration resting (ADR 0004) | 0.1% | 292 MB |

The window renders on this machine with the defaults, so the NVIDIA workaround is not needed.

Voice on the LOQ, measured with `python -m sirius_voice.selftest` on Piper's synthetic speech:

| | Whisper `small` |
|---|---|
| GPU (RTX 4050, float16) | about 0.18 s per utterance |
| CPU (8 threads, int8) | about 1.5 s per utterance |

Service memory: 98 MB with the mic closed, about 970 MB with models loaded. Back to 98 MB after
10 quiet minutes, by restarting, because loaded CUDA libraries cannot be unloaded.

Things found the hard way:

- The `silero-vad` package needs torch. faster-whisper ships the same model as ONNX.
- `openwakeword` depends on `tflite-runtime`, which has no Python 3.12 wheels. This matters for M9.
- onnxruntime 1.31 reports to `mobile.events.data.microsoft.com` by default on Linux.
  `ORT_DISABLE_TELEMETRY=1` must be set before it initialises;
  `disable_telemetry_events()` alone does not stop it.
- faster-whisper re-validates its model online unless `HF_HUB_OFFLINE=1` is set.
- CUDA works from pip packages in the venv (2.2 GB) plus `LD_LIBRARY_PATH`, with no system install.
- Detection across 99 languages fails on short audio, so only `en` and `ro` compete, and when
  detection is unclear both are transcribed and the more confident one wins.
- PortAudio is not installed here. `pw-record` and `pw-play` need nothing extra.

Not verified with a real human voice yet: accuracy, and the 1.5 s end-to-end budget.

