/**
 * `sirius notify`, called from agent hooks. Hooks must never block or fail an agent, so
 * every path exits 0 and the request gives up quickly when the core is down (spec section 9).
 */
import { basename } from 'node:path';
import type { AgentEventKind, OpInput } from '@sirius/contracts';

type AgentEventInput = OpInput<'post_agent_event'>;

const projectOf = (cwd: unknown) => (typeof cwd === 'string' && cwd ? basename(cwd) : undefined);

/** Claude Code sends the hook input as JSON on stdin. Null means not worth an alert. */
export function fromClaudeHook(raw: string, kind: AgentEventKind): AgentEventInput | null {
  const data = JSON.parse(raw) as {
    cwd?: string;
    message?: string;
    notification_type?: string;
    hook_event_name?: string;
    tool_name?: string;
  };
  // An idle session is not waiting on anything. Older hook setups still send these.
  if (data.notification_type === 'idle_prompt') return null;
  if (
    !data.notification_type &&
    (!data.hook_event_name || data.hook_event_name === 'Notification') &&
    /waiting for your input/i.test(data.message ?? '')
  )
    return null;
  let message = data.message;
  if (data.hook_event_name === 'PermissionRequest') message = 'Claude Code needs your approval';
  if (data.hook_event_name === 'PreToolUse' && data.tool_name === 'AskUserQuestion') {
    message = 'Claude Code has a question for you';
  }
  return {
    source: 'claude',
    kind,
    ...(projectOf(data.cwd) ? { project: projectOf(data.cwd) } : {}),
    ...(message ? { message: message.slice(0, 500) } : {}),
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
export function fromCodexJson(raw: string): AgentEventInput | null {
  const data = JSON.parse(raw) as { type?: string; cwd?: string };
  if (data.type !== 'agent-turn-complete') return null;
  return {
    source: 'codex',
    kind: 'turn_complete',
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
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      read,
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
    // A timed-out async iterator still holds stdin open unless it is destroyed.
    process.stdin.destroy();
  }
  return Buffer.concat(chunks).toString('utf8');
}
