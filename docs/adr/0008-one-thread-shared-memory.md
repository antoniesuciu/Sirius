# ADR 0008: one thread, disposable sessions, memory in a Markdown file

Status: accepted, 2026-11-02. The owner asked for one lasting conversation that is refreshed from
time to time to save usage, with memory kept outside the agents, perhaps in Obsidian.

Both agents already shared everything on the dashboard, but not the chat: a CLI session cannot move
between agents, and a resumed session resends its whole history, so length costs usage.

Decision: a conversation is the thread and lasts until "New conversation". The CLI session under
it is disposable, dropped on a change of agent or model and after 20 turns. The next session is
told the last 12 lines of the thread and the contents of the memory file.

Memory is one Markdown file at `SIRIUS_MEMORY_FILE`, set in `deployment.env`. Agents add to it with
a `remember` tool. They never receive its path, and the person edits it by hand to correct or
forget something, which is also why it is not a table.

Rejected: giving the agents the Obsidian MCP server. It would need Obsidian open for every turn,
would not work from a remote core, and would hand both agents the whole vault, undoing the file
isolation that the canary check in `bench/agents.ts` proves. The core writing one file gets the same
result, in Obsidian, without any of that.

Cost: 20 turns is a judgement call rather than a measurement. A replaced session forgets detail
older than 12 lines unless it reached the memory file. A remote core writes the file in its own
data folder, not the vault.
