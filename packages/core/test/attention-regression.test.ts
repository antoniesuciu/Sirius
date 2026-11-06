import { describe, expect, test } from 'vitest';
import { harness } from './harness.ts';

describe('prompts repeated during quiet mode', () => {
  const prompt = {
    source: 'claude',
    kind: 'needs_input',
    project: 'lab',
    message: 'Approve?',
  } as const;

  for (const message of ['Approve?', 'Another approval?']) {
    test(`Welcome back releases a repeated prompt (${message})`, () => {
      const h = harness();
      h.run('post_agent_event', prompt);
      h.advance(1000);
      h.run('set_quiet_mode', { on: true });
      h.advance(1000);
      h.run('post_agent_event', { ...prompt, message });
      h.advance(1000);
      h.run('set_quiet_mode', { on: false });
      expect(h.notified).toHaveLength(2);
      expect(h.events.filter((e) => e.type === 'agent_queue_released')).toHaveLength(1);
      expect(h.run('list_agent_events', {})).toHaveLength(1);
    });
  }

  test('a repeated prompt answered in quiet mode is not replayed', () => {
    const h = harness();
    h.run('post_agent_event', prompt);
    h.advance(1000);
    h.run('set_quiet_mode', { on: true });
    h.run('post_agent_event', prompt);
    h.run('resolve_agent_events', { source: 'claude', project: 'lab' });
    h.run('set_quiet_mode', { on: false });
    expect(h.notified).toHaveLength(1);
    expect(h.run('list_agent_events', {})).toEqual([]);
    expect(h.events.some((e) => e.type === 'agent_queue_released')).toBe(false);
  });
});

test('question notifications explain what is waiting', () => {
  const h = harness();
  h.run('post_agent_event', {
    source: 'claude',
    kind: 'needs_input',
    project: 'lab',
    message: 'Claude Code has a question for you',
  });
  expect(h.notified[0]?.body).toBe('Claude Code has a question for you in the lab folder.');
});

describe('sessions in any terminal show as working (F23)', () => {
  const status = (h: ReturnType<typeof harness>) =>
    h.run('get_agents', {}).agents.find((a) => a.id === 'claude')?.status;

  test('a prompt or a tool marks it working, a stopped turn idle, with one event each way', () => {
    const h = harness();
    expect(status(h)).not.toBe('working');
    h.run('post_agent_activity', { source: 'claude', project: 'lab', working: true });
    h.run('post_agent_activity', { source: 'claude', project: 'lab', working: true });
    expect(status(h)).toBe('working');
    h.run('post_agent_activity', { source: 'claude', project: 'lab', working: false });
    expect(status(h)).not.toBe('working');
    const changes = h.events.filter((e) => e.type === 'agent_activity');
    expect(changes).toEqual([
      { type: 'agent_activity', source: 'claude', working: true },
      { type: 'agent_activity', source: 'claude', working: false },
    ]);
  });

  test('two folders: the agent stays working until both have stopped', () => {
    const h = harness();
    h.run('post_agent_activity', { source: 'claude', project: 'lab', working: true });
    h.run('post_agent_activity', { source: 'claude', project: 'sirius', working: true });
    h.run('post_agent_activity', { source: 'claude', project: 'lab', working: false });
    expect(status(h)).toBe('working');
  });

  test('a session that went silent, such as a closed terminal, stops counting after 15 minutes', () => {
    const h = harness();
    h.run('post_agent_activity', { source: 'claude', project: 'lab', working: true });
    h.advance(15 * 60 * 1000);
    expect(status(h)).not.toBe('working');
  });

  test('waiting for you wins over working', () => {
    const h = harness();
    h.run('post_agent_activity', { source: 'claude', project: 'lab', working: true });
    h.run('post_agent_event', { source: 'claude', kind: 'needs_input', project: 'lab' });
    expect(status(h)).toBe('waiting');
  });
});
