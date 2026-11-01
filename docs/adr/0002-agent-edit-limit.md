# ADR 0002: agents get five single-item edits a minute

Status: accepted, 2026-11-01.

F19 sends bulk changes to a proposal, but classifies by operation. An agent can move
twenty tasks with twenty `reschedule_task` calls, each one "additive, single item", and no
proposal ever appears. Spec ADR-7 says safety lives in the core and not in the prompt, so a
loop like that cannot be left to the agent's good behaviour.

Decision: the dispatcher counts an agent's edit operations over the last minute. Past five,
further edits of existing items are refused with `requires_proposal`, and the error tells
the agent to use `propose_changes`. Adding things is never limited, because it destroys
nothing and undo covers it.

It counts operations rather than rows, because completing a task can also touch its step and
roadmap. Five leaves ordinary work alone: "mark these three done" still applies at once.

Rejected: a per-turn budget. The core would have to know where a turn starts, and an external
MCP session has no turns.
