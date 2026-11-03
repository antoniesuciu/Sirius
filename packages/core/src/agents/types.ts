import type { AgentId } from '@sirius/contracts';

export interface AgentTurn {
  prompt: string;
  model: string;
  /** Set when continuing a conversation: the CLI's own session id. */
  sessionId?: string;
  signal: AbortSignal;
}

export type AgentStreamEvent =
  | { type: 'text'; delta: string }
  | { type: 'tool'; name: string }
  | { type: 'done'; sessionId?: string }
  | { type: 'error'; message: string };

/** Spec section 8. A new way of reaching a model is one more file implementing this. */
export interface AgentAdapter {
  id: AgentId;
  available(): Promise<{ ok: boolean; reason?: string }>;
  run(turn: AgentTurn): AsyncIterable<AgentStreamEvent>;
}

/** How a spawned agent reaches the `sirius` MCP server. */
export interface McpCommand {
  command: string;
  args: string[];
  env: Record<string, string>;
}

export interface AdapterOptions {
  bin: string;
  cwd: string;
  systemPrompt: string;
  /** Builds the MCP command for this agent, so the core sees the right actor. */
  mcp: (agent: AgentId) => McpCommand;
}

/** The sirius MCP server did not start, so the agent would be working blind. */
export const TOOLS_UNAVAILABLE = 'sirius tools unavailable';

const LOGIN_PATTERN = /log ?in|logged (out|in)|unauthori[sz]ed|authenticat|invalid api key|401/i;
const QUOTA_PATTERN = /usage limit|rate limit|quota|limit reached|credit|too many requests|429/i;

/** F22: whatever a CLI printed becomes one plain sentence with the fix in it. */
export function calmError(agent: AgentId, raw: string): string {
  const name = agent === 'claude' ? 'Claude' : 'Codex';
  const login = agent === 'claude' ? 'claude login' : 'codex login';
  if (raw === TOOLS_UNAVAILABLE) {
    return "My tools aren't connected, so nothing changed. Running sirius doctor will show why.";
  }
  if (/ENOENT|command not found|no such file/i.test(raw)) {
    return `${name} isn't installed here yet. Everything else still works.`;
  }
  if (QUOTA_PATTERN.test(raw)) return `${name} has hit its usage limit. It resets later.`;
  if (LOGIN_PATTERN.test(raw))
    return `${name} needs you to log in first. Running ${login} will do it.`;
  return `${name} ran into a problem, so nothing changed. Try again.`;
}
