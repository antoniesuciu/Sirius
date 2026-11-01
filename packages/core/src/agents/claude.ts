/** `claude -p` (ADR-5). Flags checked against Claude Code 2.1.316, see docs/verified.md. */

import { probe, spawnLines } from './spawn.ts';
import {
  type AdapterOptions,
  type AgentAdapter,
  type AgentStreamEvent,
  type AgentTurn,
  calmError,
} from './types.ts';

const TOOL_PREFIX = 'mcp__sirius__';

export function claudeArgs(turn: AgentTurn, options: AdapterOptions): string[] {
  const { command, args, env } = options.mcp('claude');
  const mcpConfig = { mcpServers: { sirius: { command, args, env } } };
  return [
    '-p',
    turn.prompt,
    '--model',
    turn.model,
    '--output-format',
    'stream-json',
    '--verbose',
    '--include-partial-messages',
    '--system-prompt',
    options.systemPrompt,
    // ADR-7: no built-in tools, only the sirius server.
    '--tools',
    '',
    '--strict-mcp-config',
    '--mcp-config',
    JSON.stringify(mcpConfig),
    '--allowedTools',
    `${TOOL_PREFIX}*`,
    // Skips user hooks and CLAUDE.md, so a chat turn cannot notify Sirius about itself.
    '--setting-sources',
    '',
    ...(turn.sessionId ? ['--resume', turn.sessionId] : []),
  ];
}

interface StreamLine {
  type?: string;
  subtype?: string;
  session_id?: string;
  is_error?: boolean;
  result?: string;
  event?: {
    type?: string;
    delta?: { type?: string; text?: string };
    content_block?: { type?: string; name?: string };
  };
  rate_limit_info?: { status?: string };
}

/** Maps one stream-json line to at most one event. Unknown lines are ignored. */
export function parseClaudeLine(line: string): AgentStreamEvent | null {
  let data: StreamLine;
  try {
    data = JSON.parse(line) as StreamLine;
  } catch {
    return null;
  }
  if (data.type === 'stream_event') {
    const { event } = data;
    if (event?.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
      return event.delta.text ? { type: 'text', delta: event.delta.text } : null;
    }
    if (event?.type === 'content_block_start' && event.content_block?.type === 'tool_use') {
      return { type: 'tool', name: (event.content_block.name ?? '').replace(TOOL_PREFIX, '') };
    }
    return null;
  }
  if (data.type === 'rate_limit_event' && data.rate_limit_info?.status === 'rejected') {
    return { type: 'error', message: 'usage limit reached' };
  }
  if (data.type === 'result') {
    if (data.is_error) return { type: 'error', message: data.result ?? data.subtype ?? 'failed' };
    return { type: 'done', ...(data.session_id ? { sessionId: data.session_id } : {}) };
  }
  return null;
}

export function createClaudeAdapter(options: AdapterOptions): AgentAdapter {
  return {
    id: 'claude',

    async available() {
      const { ok, output } = await probe(options.bin, ['auth', 'status'], options.cwd);
      if (ok && /"loggedIn":\s*true/.test(output)) return { ok: true };
      return { ok: false, reason: calmError('claude', output || 'not logged in') };
    },

    async *run(turn) {
      const { lines, finished } = spawnLines(options.bin, claudeArgs(turn, options), {
        cwd: options.cwd,
        signal: turn.signal,
      });
      let ended = false;
      for await (const line of lines) {
        const event = parseClaudeLine(line);
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
