import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { claudeArgs, createClaudeAdapter, parseClaudeLine } from '../src/agents/claude.ts';
import { codexArgs, createCodexAdapter, parseCodexLine } from '../src/agents/codex.ts';
import { type AdapterOptions, calmError, TOOLS_UNAVAILABLE } from '../src/agents/types.ts';

const fixture = (name: string) =>
  readFileSync(join(import.meta.dir, 'fixtures', name), 'utf8')
    .trim()
    .split('\n');

const options: AdapterOptions = {
  bin: 'unused',
  cwd: tmpdir(),
  systemPrompt: 'Be calm. "Always"',
  mcp: (agent) => ({
    command: '/bin/true',
    args: ['--agent', agent],
    env: { SIRIUS_VIA: 'chat' },
  }),
};
const turn = { prompt: 'hi', model: 'm', signal: new AbortController().signal };

/** A stand-in CLI: records its argv and prints a canned stream. */
function fakeCli(lines: string[], exit = 0, linger = 0): { bin: string; argv: () => string[] } {
  const dir = mkdtempSync(join(tmpdir(), 'sirius-cli-'));
  const out = join(dir, 'stream');
  const argvFile = join(dir, 'argv');
  writeFileSync(out, `${lines.join('\n')}\n`);
  const bin = join(dir, 'cli');
  writeFileSync(
    bin,
    `#!/bin/sh\nfor a in "$@"; do printf '%s\\0' "$a"; done > ${argvFile}\ncat ${out}\nsleep ${linger}\nexit ${exit}\n`,
  );
  chmodSync(bin, 0o755);
  return { bin, argv: () => readFileSync(argvFile, 'utf8').split('\0').slice(0, -1) };
}

async function collect<T>(stream: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const item of stream) out.push(item);
  return out;
}

describe('claude adapter', () => {
  test('parses a recorded real turn into text and done', () => {
    const events = fixture('claude-text-turn.jsonl').flatMap((l) => parseClaudeLine(l) ?? []);
    expect(events).toEqual([
      { type: 'text', delta: 'hello from sirius' },
      { type: 'done', sessionId: '00000000-0000-7000-8000-000000000001' },
    ]);
  });

  test('names a tool call without the MCP prefix', () => {
    const line = JSON.stringify({
      type: 'stream_event',
      event: {
        type: 'content_block_start',
        content_block: { type: 'tool_use', name: 'mcp__sirius__add_goal' },
      },
    });
    expect(parseClaudeLine(line)).toEqual({ type: 'tool', name: 'add_goal' });
  });

  test('turns a failed result and a rejected rate limit into errors', () => {
    const failed = JSON.stringify({ type: 'result', is_error: true, result: 'Please run /login' });
    expect(parseClaudeLine(failed)).toEqual({ type: 'error', message: 'Please run /login' });
    const limited = JSON.stringify({
      type: 'rate_limit_event',
      rate_limit_info: { status: 'rejected' },
    });
    expect(parseClaudeLine(limited)?.type).toBe('error');
    const allowed = JSON.stringify({
      type: 'rate_limit_event',
      rate_limit_info: { status: 'allowed' },
    });
    expect(parseClaudeLine(allowed)).toBeNull();
  });

  test('a failed sirius server is an error, a connected one is not', () => {
    const init = (status: string) =>
      JSON.stringify({
        type: 'system',
        subtype: 'init',
        mcp_servers: [{ name: 'sirius', status, source: 'dynamic' }],
      });
    expect(parseClaudeLine(init('failed'))).toEqual({ type: 'error', message: TOOLS_UNAVAILABLE });
    expect(parseClaudeLine(init('connected'))).toBeNull();
  });

  test('stops reading after the tools fail, so nothing the model writes gets through', async () => {
    const cli = fakeCli([
      JSON.stringify({
        type: 'system',
        subtype: 'init',
        mcp_servers: [{ name: 'sirius', status: 'failed' }],
      }),
      JSON.stringify({
        type: 'stream_event',
        event: {
          type: 'content_block_delta',
          delta: { type: 'text_delta', text: '<tool_call>{}' },
        },
      }),
    ]);
    const adapter = createClaudeAdapter({ ...options, bin: cli.bin });
    expect(await collect(adapter.run(turn))).toEqual([
      { type: 'error', message: TOOLS_UNAVAILABLE },
    ]);
  });

  test('reports unavailable when the MCP server cannot start', async () => {
    const cli = fakeCli(['{"loggedIn": true}']);
    const missing = {
      ...options,
      bin: cli.bin,
      mcp: () => ({ ...options.mcp('claude'), command: '/nope' }),
    };
    const result = await createClaudeAdapter(missing).available();
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('sirius doctor');
  });

  test('ignores junk rather than failing the turn', () => {
    expect(parseClaudeLine('not json')).toBeNull();
    expect(parseClaudeLine('{"type":"system","subtype":"init"}')).toBeNull();
  });

  test('passes the isolation flags (ADR-7)', () => {
    const args = claudeArgs(turn, options);
    expect(args[args.indexOf('--tools') + 1]).toBe('');
    expect(args).toContain('--strict-mcp-config');
    expect(args[args.indexOf('--allowedTools') + 1]).toBe('mcp__sirius__*');
    expect(args[args.indexOf('--setting-sources') + 1]).toBe('');
    expect(args).not.toContain('--resume');
  });

  test('resumes a session', () => {
    const args = claudeArgs({ ...turn, sessionId: 'abc' }, options);
    expect(args[args.indexOf('--resume') + 1]).toBe('abc');
  });

  test('runs a real process and survives shell metacharacters in the prompt', async () => {
    const cli = fakeCli(fixture('claude-text-turn.jsonl'));
    const nasty = 'x"; rm -rf ~; echo "$(whoami)';
    const adapter = createClaudeAdapter({ ...options, bin: cli.bin });
    const events = await collect(adapter.run({ ...turn, prompt: nasty }));
    expect(events.map((e) => e.type)).toEqual(['text', 'done']);
    expect(cli.argv()[1]).toBe(nasty);
  });

  test('the turn ends at the result, not when the CLI gets round to exiting', async () => {
    const cli = fakeCli(fixture('claude-text-turn.jsonl'), 0, 5);
    const adapter = createClaudeAdapter({ ...options, bin: cli.bin });
    const started = Date.now();
    expect((await collect(adapter.run(turn))).map((e) => e.type)).toEqual(['text', 'done']);
    expect(Date.now() - started).toBeLessThan(2000);
  });

  test('a process that dies without a result reports an error', async () => {
    const cli = fakeCli(['not a result'], 1);
    const adapter = createClaudeAdapter({ ...options, bin: cli.bin });
    expect((await collect(adapter.run(turn))).at(-1)?.type).toBe('error');
  });

  test('a missing binary reports an error instead of throwing', async () => {
    const adapter = createClaudeAdapter({ ...options, bin: '/nonexistent/claude' });
    const events = await collect(adapter.run(turn));
    expect(events.at(-1)?.type).toBe('error');
  });

  test('reports unavailable when logged out', async () => {
    const cli = fakeCli(['{"loggedIn": false}']);
    const adapter = createClaudeAdapter({ ...options, bin: cli.bin });
    expect((await adapter.available()).ok).toBe(false);
  });
});

describe('codex adapter', () => {
  test('parses a recorded-shape turn', () => {
    const state = {};
    const lines = [
      { type: 'thread.started', thread_id: 't1' },
      { type: 'turn.started' },
      {
        type: 'item.started',
        item: { type: 'mcp_tool_call', server: 'sirius', tool: 'add_goal' },
      },
      { type: 'item.completed', item: { type: 'agent_message', text: 'Added it.' } },
      { type: 'turn.completed', usage: {} },
    ];
    const events = lines.flatMap((l) => parseCodexLine(JSON.stringify(l), state) ?? []);
    expect(events).toEqual([
      { type: 'tool', name: 'add_goal' },
      { type: 'text', delta: 'Added it.' },
      { type: 'done', sessionId: 't1' },
    ]);
  });

  test('ignores tool calls from the built-in server', () => {
    const line = JSON.stringify({
      type: 'item.started',
      item: { type: 'mcp_tool_call', server: 'codex', tool: 'list_mcp_resources' },
    });
    expect(parseCodexLine(line, {})).toBeNull();
  });

  test('switches the shell off, not just the sandbox (ADR-7)', () => {
    const args = codexArgs(turn, options);
    for (const feature of ['shell_tool', 'unified_exec', 'hooks']) {
      expect(args[args.indexOf(feature) - 1]).toBe('--disable');
    }
    // Code mode is how this Codex reaches MCP tools, so it has to stay available.
    expect(args).not.toContain('code_mode_host');
    expect(args).toContain('sandbox_mode="read-only"');
    expect(args).toContain('--ignore-user-config');
  });

  test('Sol Medium selects the real model slug and medium reasoning', () => {
    const args = codexArgs({ ...turn, model: 'gpt-6.1-sol-medium' }, options);
    expect(args[args.indexOf('-m') + 1]).toBe('gpt-6.1-sol');
    expect(args).toContain('model_reasoning_effort="medium"');
    expect(codexArgs({ ...turn, model: 'gpt-6-luna' }, options)).toContain(
      'model_reasoning_effort="low"',
    );
  });

  test('encodes the system prompt as a valid TOML string', () => {
    const args = codexArgs(turn, options);
    expect(args).toContain('developer_instructions="Be calm. \\"Always\\""');
  });

  test('resumes through the subcommand', () => {
    expect(codexArgs({ ...turn, sessionId: 'abc' }, options).slice(0, 3)).toEqual([
      'exec',
      'resume',
      'abc',
    ]);
  });

  test('runs a real process', async () => {
    const cli = fakeCli([
      JSON.stringify({ type: 'thread.started', thread_id: 't' }),
      JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'ok' } }),
      JSON.stringify({ type: 'turn.completed' }),
    ]);
    const adapter = createCodexAdapter({ ...options, bin: cli.bin });
    expect(await collect(adapter.run(turn))).toEqual([
      { type: 'text', delta: 'ok' },
      { type: 'done', sessionId: 't' },
    ]);
  });
});

describe('plain errors (F22)', () => {
  test.each([
    ['Please run /login', 'Claude needs you to log in first. Running claude login will do it.'],
    ['HTTP 401 Unauthorized', 'Claude needs you to log in first. Running claude login will do it.'],
    ['usage limit reached', 'Claude has hit its usage limit. It resets later.'],
    ['spawn claude ENOENT', "Claude isn't installed here yet. Everything else still works."],
    ['segfault', 'Claude ran into a problem, so nothing changed. Try again.'],
  ])('%s', (raw, sentence) => {
    expect(calmError('claude', raw)).toBe(sentence);
  });

  test('names the right login command for Codex', () => {
    expect(calmError('codex', 'not logged in')).toContain('codex login');
  });
});
