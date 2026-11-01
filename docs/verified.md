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

Not yet verified: the licence attribution text for the avatar (spec section 13, item 8), the
WebKitGTK DMA-BUF behaviour on the LOQ, and everything under voice.
