/**
 * `sirius notify`, called from agent hooks. Hooks must never block or fail an agent, so
 * every path exits 0 and the request gives up quickly when the core is down (spec section 9).
 */
import { basename } from 'node:path';
import type { AgentEventKind, AgentId, OpInput } from '@sirius/contracts';

type AgentEventInput = OpInput<'post_agent_event'>;

const projectOf = (cwd: unknown) => (typeof cwd === 'string' && cwd ? basename(cwd) : undefined);

/** Claude Code sends the hook input as JSON on stdin. Null means not worth an alert. */
export function fromClaudeHook(raw: string, kind: AgentEventKind): AgentEventInput | null {
  const data = JSON.parse(raw) as { cwd?: string; message?: string; notification_type?: string };
  // An idle session is not waiting on anything. Older hook setups still send these.
  if (data.notification_type === 'idle_prompt') return null;
  if (/waiting for your input/i.test(data.message ?? '')) return null;
  return {
    source: 'claude',
    kind,
    ...(projectOf(data.cwd) ? { project: projectOf(data.cwd) } : {}),
    ...(data.message ? { message: data.message.slice(0, 500) } : {}),
  };
}

/** The folder a Claude hook ran in, for clearing that folder's alert. Never throws. */
export function projectFromHook(raw: string): string | undefined {
  try {
    return projectOf((JSON.parse(raw) as { cwd?: unknown }).cwd);
  } catch {
    return undefined;
  }
}

/** A Codex PermissionRequest hook: Codex is about to ask for an approval in this folder. */
export function fromCodexHook(raw: string): AgentEventInput {
  const project = projectFromHook(raw);
  return {
    source: 'codex',
    kind: 'needs_input',
    ...(project ? { project } : {}),
    message: 'Codex needs your approval',
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
