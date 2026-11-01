/**
 * `sirius notify`, called from agent hooks. Hooks must never block or fail an agent, so
 * every path exits 0 and the request gives up quickly when the core is down (spec section 9).
 */
import { basename } from 'node:path';
import type { AgentEventKind, AgentId, OpInput } from '@sirius/contracts';

type AgentEventInput = OpInput<'post_agent_event'>;

const projectOf = (cwd: unknown) => (typeof cwd === 'string' && cwd ? basename(cwd) : undefined);

/** Claude Code sends the hook input as JSON on stdin. */
export function fromClaudeHook(raw: string, kind: AgentEventKind): AgentEventInput {
  const data = JSON.parse(raw) as { cwd?: string; message?: string };
  return {
    source: 'claude',
    kind,
    ...(projectOf(data.cwd) ? { project: projectOf(data.cwd) } : {}),
    ...(data.message ? { message: data.message.slice(0, 500) } : {}),
  };
}

/** Codex passes one JSON argument. `agent-turn-complete` is the only documented type. */
export function fromCodexJson(raw: string): AgentEventInput {
  const data = JSON.parse(raw) as { type?: string; cwd?: string };
  return {
    source: 'codex',
    kind: data.type === 'agent-turn-complete' ? 'turn_complete' : 'needs_input',
    ...(projectOf(data.cwd) ? { project: projectOf(data.cwd) } : {}),
  };
}

/** Reads stdin without ever waiting long: a hook with no input must not hang the agent. */
export async function readStdin(timeoutMs = 500): Promise<string> {
  if (process.stdin.isTTY) return '';
  const chunks: Buffer[] = [];
  const read = (async () => {
    for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  })();
  await Promise.race([read, Bun.sleep(timeoutMs)]);
  return Buffer.concat(chunks).toString('utf8');
}
