import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { type AgentId, createHttpClient } from '@sirius/contracts';
import { createApp, createCore } from '@sirius/core';
import { beforeEach, describe, expect, test } from 'vitest';
import { createMcpServer } from '../src/server.ts';

const TOKEN = 't';
type Result = { content: Array<{ text: string }>; isError?: boolean };

let core: ReturnType<typeof createCore>;
let mcp: Client;

async function connect(actor: AgentId, via: 'chat' | 'mcp' = 'mcp') {
  const app = createApp(core, { token: TOKEN, mode: 'local', version: 't' });
  const siriusClient = createHttpClient({
    baseUrl: 'http://core',
    token: TOKEN,
    actor,
    via,
    fetch: ((input: string, init?: RequestInit) => app.request(input, init)) as typeof fetch,
  });
  const [serverSide, clientSide] = InMemoryTransport.createLinkedPair();
  await createMcpServer(siriusClient).connect(serverSide);
  const client = new Client({ name: 'test', version: '0' });
  await client.connect(clientSide);
  return client;
}

const call = async (name: string, args: Record<string, unknown> = {}) =>
  (await mcp.callTool({ name, arguments: args })) as Result;

beforeEach(async () => {
  const adapter = (id: AgentId) => ({
    id,
    available: async () => ({ ok: true }),
    async *run() {},
  });
  core = createCore({
    dbPath: ':memory:',
    timeZone: 'UTC',
    notifier: { notify() {} },
    adapters: { claude: adapter('claude'), codex: adapter('codex') },
  });
  mcp = await connect('claude');
});

describe('tool list', () => {
  test('offers the spec tools and nothing destructive', async () => {
    const names = (await mcp.listTools()).tools.map((t) => t.name);
    expect(names).toContain('add_goal');
    expect(names).toContain('propose_changes');
    expect(names).toContain('remember');
    for (const hidden of [
      'delete_goal',
      'reschedule_tasks',
      'confirm_proposal',
      'undo',
      'set_setting',
      'create_backup',
    ]) {
      expect(names).not.toContain(hidden);
    }
  });

  test('tells the agent what it can put inside a proposal', async () => {
    const { tools } = await mcp.listTools();
    const propose = tools.find((t) => t.name === 'propose_changes');
    expect(propose?.description).toContain('reschedule_tasks(ids, date)');
  });

  test('publishes real input schemas', async () => {
    const { tools } = await mcp.listTools();
    const add = tools.find((t) => t.name === 'add_task');
    expect(add?.inputSchema.properties).toHaveProperty('title');
  });
});

describe('calls', () => {
  test('an added goal lands in the core as the agent', async () => {
    const result = await call('add_goal', { title: 'Read twelve books' });
    expect(result.isError).toBeFalsy();
    const user = { actor: 'user', via: 'ui' } as const;
    expect(core.dispatcher.run('list_goals', {}, user)[0]?.title).toBe('Read twelve books');
  });

  test('a chat turn is sourced as sirius', async () => {
    mcp = await connect('codex', 'chat');
    const result = await call('add_task', { title: 'x' });
    expect(JSON.parse(result.content[0]?.text ?? '')).toMatchObject({ source: 'sirius' });
  });

  test('a bulk move creates a proposal and changes nothing', async () => {
    await call('add_task', { title: 'a' });
    const before = JSON.parse((await call('get_today')).content[0]?.text ?? '{}');
    const id = before.tasks[0].id;
    await call('propose_changes', {
      summary: 'Move it',
      ops: [{ op: 'reschedule_tasks', input: { ids: [id], date: '2099-01-01' } }],
    });
    const after = JSON.parse((await call('get_today')).content[0]?.text ?? '{}');
    expect(after.tasks[0].id).toBe(id);
    const proposals = JSON.parse((await call('list_proposals')).content[0]?.text ?? '[]');
    expect(proposals[0]).toMatchObject({ status: 'pending', actor: 'claude' });
  });

  test('core errors come back as tool errors the agent can read', async () => {
    const result = await call('complete_task', { id: 'missing' });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('not found');
  });

  test('bad input is refused before it reaches the core', async () => {
    const result = await call('add_task', { title: 42 });
    expect(result.isError).toBe(true);
  });
});
