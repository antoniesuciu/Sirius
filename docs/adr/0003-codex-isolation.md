# ADR 0003: isolate Codex with flags, not a dedicated CODEX_HOME

Status: accepted, 2026-11-01.

Spec section 8 registers the `sirius` MCP server in a dedicated `CODEX_HOME`. Auth lives in
`CODEX_HOME` too, so that would mean copying the user's credentials, which ADR-5 argues
against in spirit.

Decision: `--ignore-user-config` drops `config.toml` (including the user's `notify` hook and
MCP servers) while auth still works, and the server is declared with `-c mcp_servers.sirius.*`
on each run. Nothing on disk changes.

ADR-7 also needs more than the spec's `--sandbox read-only`, because a read-only sandbox still
lets the shell tool read files. `shell_tool`, `unified_exec` and the other tool features are
disabled. `code_mode_host` must stay on: this Codex exposes every tool, MCP included, through
code mode, and disabling it leaves the agent with no sirius tools. `bench/agents.ts` checks the
result against a canary file on every run, because the feature list is not a stable contract.

Trade-off: a Codex upgrade can change these feature names. The canary check is how that shows up.
