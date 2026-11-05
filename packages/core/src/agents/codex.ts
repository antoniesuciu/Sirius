/**
 * `codex exec` (ADR-5). Flags checked against the installed CLI, see docs/verified.md.
 *
 * ADR-7 needs more care here than for Claude. `--sandbox read-only` still lets the shell
 * tool read files, so the tools themselves are switched off. `--ignore-user-config` keeps the
 * user's `notify` hook and MCP servers out of the turn while auth still works, which replaces
 * the spec's dedicated CODEX_HOME (that would have needed a copy of the credentials).
 *
 * `code_mode_host` must stay on: this Codex exposes every tool, MCP included, through its
 * code-mode `exec` function, so disabling it leaves the agent with no sirius tools at all.
 * With shell_tool off, code mode has nothing to reach the filesystem with, and
 * bench/agents.ts proves that against a canary file.
 */

import { agentCatalog } from '@sirius/contracts';
import { commandExists, probe, spawnLines } from './spawn.ts';
import {
  type AdapterOptions,
  type AgentAdapter,
  type AgentStreamEvent,
  type AgentTurn,
  calmError,
  TOOLS_UNAVAILABLE,
} from './types.ts';

const DISABLED_FEATURES = [
  'shell_tool',
  'unified_exec',
  'shell_snapshot',
  'view_image',
  'image_generation',
  'multi_agent',
  'apps',
  'browser_use',
  'browser_use_external',
  'in_app_browser',
  'computer_use',
  'goals',
  'hooks',
  'plugins',
  'skill_search',
  'tool_suggest',
  'sleep_tool',
];

/** TOML basic strings share JSON's escapes, so JSON.stringify is a correct encoder. */
const toml = (value: string) => JSON.stringify(value);

export function codexArgs(turn: AgentTurn, options: AdapterOptions): string[] {
  const preset = agentCatalog.codex.models.find((m) => m.id === turn.model);
  const { command, args, env } = options.mcp('codex');
  const envPairs = Object.entries(env).map(([k, v]) => `${k}=${toml(v)}`);
  const config = [
    'sandbox_mode="read-only"',
    'approval_policy="never"',
    'web_search="disabled"',
    // The spec's "6.1 Sol Light" is the model at low effort (docs/verified.md).
    `model_reasoning_effort=${toml(preset?.effort ?? 'low')}`,
    `developer_instructions=${toml(options.systemPrompt)}`,
    `mcp_servers.sirius.command=${toml(command)}`,
    `mcp_servers.sirius.args=[${args.map(toml).join(',')}]`,
    `mcp_servers.sirius.env={${envPairs.join(',')}}`,
    'mcp_servers.sirius.default_tools_approval_mode="approve"',
  ];
  return [
    'exec',
    ...(turn.sessionId ? ['resume', turn.sessionId] : []),
    '--json',
    '--skip-git-repo-check',
    '--ignore-user-config',
    '--ignore-rules',
    '-m',
    preset?.model ?? turn.model,
    ...config.flatMap((c) => ['-c', c]),
    ...DISABLED_FEATURES.flatMap((f) => ['--disable', f]),
    turn.prompt,
  ];
}

interface CodexLine {
  type?: string;
  thread_id?: string;
  message?: string;
  error?: { message?: string };
  item?: { type?: string; text?: string; server?: string; tool?: string };
}

export interface CodexParseState {
  sessionId?: string;
}

/** Maps one JSONL line to at most one event. Codex sends whole messages, not deltas. */
export function parseCodexLine(line: string, state: CodexParseState): AgentStreamEvent | null {
  let data: CodexLine;
  try {
    data = JSON.parse(line) as CodexLine;
  } catch {
    return null;
  }
  switch (data.type) {
    case 'thread.started':
      if (data.thread_id) state.sessionId = data.thread_id;
      return null;
    case 'item.completed':
      if (data.item?.type === 'agent_message' && data.item.text) {
        return { type: 'text', delta: data.item.text };
      }
      return null;
    case 'item.started':
      if (data.item?.type === 'mcp_tool_call' && data.item.server === 'sirius') {
        return { type: 'tool', name: data.item.tool ?? '' };
      }
      return null;
    case 'turn.completed':
      return { type: 'done', ...(state.sessionId ? { sessionId: state.sessionId } : {}) };
    case 'turn.failed':
      return { type: 'error', message: data.error?.message ?? 'turn failed' };
    case 'error':
      return { type: 'error', message: data.message ?? 'failed' };
    default:
      return null;
  }
}

export function createCodexAdapter(options: AdapterOptions): AgentAdapter {
  return {
    id: 'codex',

    async available() {
      if (!commandExists(options.mcp('codex').command)) {
        return { ok: false, reason: calmError('codex', TOOLS_UNAVAILABLE) };
      }
      const { ok, output } = await probe(options.bin, ['login', 'status'], options.cwd);
      if (ok) return { ok: true };
      return { ok: false, reason: calmError('codex', output || 'not logged in') };
    },

    async *run(turn) {
      const { lines, finished } = spawnLines(options.bin, codexArgs(turn, options), {
        cwd: options.cwd,
        signal: turn.signal,
      });
      const state: CodexParseState = turn.sessionId ? { sessionId: turn.sessionId } : {};
      let ended = false;
      for await (const line of lines) {
        const event = parseCodexLine(line, state);
        if (!event) continue;
        ended ||= event.type === 'done' || event.type === 'error';
        yield event;
      }
      const { code, stderr, spawnError } = await finished;
      if (!ended && !turn.signal.aborted) {
        yield { type: 'error', message: spawnError ?? (stderr || `exit ${code}`) };
      }
    },
  };
}
