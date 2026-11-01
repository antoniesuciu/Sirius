import { describe, expect, test } from 'vitest';
import type { AgentStreamEvent } from '../src/agents/types.ts';
import { codeOf, fakeAgent, harness, NOON_ISH } from './harness.ts';

function setup(...scripts: AgentStreamEvent[][]) {
  const claude = fakeAgent('claude', scripts);
  const codex = fakeAgent('codex');
  const h = harness(NOON_ISH, { claude: claude.adapter, codex: codex.adapter });
  const finished = () =>
    new Promise<void>((resolve) => {
      const stop = h.core.bus.subscribe((e) => {
        if (e.type === 'chat' && (e.kind === 'done' || e.kind === 'error')) {
          stop();
          resolve();
        }
      });
    });
  const turn = async (text: string) => {
    const done = finished();
    const result = h.run('send_chat', { text });
    await done;
    return result;
  };
  return { h, claude, codex, turn };
}

const texts = (h: ReturnType<typeof harness>) =>
  h.run('get_conversation', {}).messages.map((m) => [m.role, m.text]);

describe('a turn', () => {
  test('streams text and persists both sides', async () => {
    const { h, turn } = setup([
      { type: 'text', delta: 'Hel' },
      { type: 'text', delta: 'lo.' },
      { type: 'done', sessionId: 's1' },
    ]);
    await turn('hi');
    const deltas = h.events.flatMap((e) =>
      e.type === 'chat' && e.kind === 'text' ? [e.delta] : [],
    );
    expect(deltas).toEqual(['Hel', 'lo.']);
    expect(texts(h)).toEqual([
      ['user', 'hi'],
      ['assistant', 'Hello.'],
    ]);
  });

  test('follow-ups resume the CLI session (F21)', async () => {
    const { claude, turn } = setup(
      [{ type: 'done', sessionId: 's1' }],
      [{ type: 'done', sessionId: 's1' }],
    );
    await turn('one');
    await turn('two');
    expect(claude.prompts[0]?.sessionId).toBeUndefined();
    expect(claude.prompts[1]?.sessionId).toBe('s1');
  });

  test('New conversation clears context', async () => {
    const { h, claude, turn } = setup(
      [{ type: 'done', sessionId: 's1' }],
      [{ type: 'done', sessionId: 's2' }],
    );
    await turn('one');
    h.run('new_conversation', {});
    expect(h.run('get_conversation', {}).messages).toEqual([]);
    await turn('two');
    expect(claude.prompts[1]?.sessionId).toBeUndefined();
  });

  test('switching agent starts fresh, since sessions do not transfer', async () => {
    const { h, claude, codex, turn } = setup([{ type: 'done', sessionId: 's1' }]);
    await turn('one');
    h.run('select_agent', { agent: 'codex' });
    await turn('two');
    expect(claude.prompts.length).toBe(1);
    expect(codex.prompts[0]?.sessionId).toBeUndefined();
    expect(texts(h)).toEqual([['user', 'two']]);
  });

  test('uses the selected model', async () => {
    const { h, claude, turn } = setup([{ type: 'done' }]);
    h.run('select_agent', { agent: 'claude', model: 'claude-sonnet-5-5' });
    await turn('hi');
    expect(claude.prompts[0]?.model).toBe('claude-sonnet-5-5');
  });

  test('voice asks for a speakable answer', async () => {
    const { h, claude } = setup([{ type: 'done' }]);
    h.run('send_chat', { text: 'hi', via: 'voice' });
    await Bun.sleep(10);
    expect(claude.prompts[0]?.prompt).toContain('read well aloud');
  });

  test('only one turn runs at a time', async () => {
    const { h } = setup([{ type: 'text', delta: 'x' }, { type: 'done' }]);
    h.run('send_chat', { text: 'one' });
    expect(codeOf(() => h.run('send_chat', { text: 'two' }))).toBe('conflict');
  });

  test('the agent shows as working during a turn', async () => {
    const { h, turn } = setup([{ type: 'text', delta: 'x' }, { type: 'done' }]);
    const running = turn('hi');
    expect(h.run('get_agents', {}).agents[0]?.status).toBe('working');
    await running;
    expect(h.run('get_agents', {}).agents[0]?.status).toBe('idle');
  });

  test('cancelling keeps what arrived and frees the agent', async () => {
    const { h } = setup([
      { type: 'text', delta: 'Partial' },
      { type: 'text', delta: ' more' },
      { type: 'done' },
    ]);
    const { turn_id } = h.run('send_chat', { text: 'hi' });
    h.run('cancel_chat', { turn_id });
    await Bun.sleep(20);
    expect(h.run('get_conversation', {}).active_turn_id).toBeNull();
  });
});

describe('when things go wrong (F22)', () => {
  test('a CLI error becomes one calm sentence in the chat', async () => {
    const { h, turn } = setup([{ type: 'error', message: 'Please run /login' }]);
    await turn('hi');
    expect(texts(h).at(-1)).toEqual([
      'assistant',
      'Claude needs you to log in first. Running claude login will do it.',
    ]);
  });

  test('tool markup written as text is never shown or stored', async () => {
    const markup =
      '<tool_call>{"name": "add_goal", "arguments": {"title": "Read twelve books"}}</tool_call>';
    const { h, turn } = setup([{ type: 'text', delta: markup }, { type: 'done' }]);
    await turn('add a goal');
    const streamed = h.events.flatMap((e) =>
      e.type === 'chat' && e.kind === 'text' ? [e.delta] : [],
    );
    expect(streamed).toEqual([]);
    expect(texts(h).at(-1)).toEqual([
      'assistant',
      "My tools aren't connected, so nothing changed. Running sirius doctor will show why.",
    ]);
    expect(h.run('list_goals', {})).toEqual([]);
  });

  test('an unavailable agent says why, without spending a turn', async () => {
    const claude = fakeAgent('claude');
    claude.adapter.available = async () => ({ ok: false, reason: 'Claude needs you to log in.' });
    const h = harness(NOON_ISH, { claude: claude.adapter, codex: fakeAgent('codex').adapter });
    await h.core.chat.refreshAvailability();
    h.run('send_chat', { text: 'hi' });
    await Bun.sleep(10);
    expect(texts(h).at(-1)).toEqual(['assistant', 'Claude needs you to log in.']);
    expect(claude.prompts).toEqual([]);
  });

  test('once the agent is fixed, the next message just works', async () => {
    const claude = fakeAgent('claude', [[{ type: 'text', delta: 'Hello.' }, { type: 'done' }]]);
    let ready = false;
    claude.adapter.available = async () => ({ ok: ready, reason: 'not yet' });
    const h = harness(NOON_ISH, { claude: claude.adapter, codex: fakeAgent('codex').adapter });
    await h.core.chat.refreshAvailability();
    ready = true;
    h.run('send_chat', { text: 'hi' });
    await Bun.sleep(20);
    expect(texts(h).at(-1)).toEqual(['assistant', 'Hello.']);
  });

  test('an adapter that throws is contained', async () => {
    const claude = fakeAgent('claude');
    claude.adapter.run = () => {
      throw new Error('boom');
    };
    const h = harness(NOON_ISH, { claude: claude.adapter, codex: fakeAgent('codex').adapter });
    h.run('send_chat', { text: 'hi' });
    await Bun.sleep(10);
    expect(texts(h).at(-1)?.[0]).toBe('assistant');
    expect(h.run('add_task', { title: 'still works' }).title).toBe('still works');
  });
});
