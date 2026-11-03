import { EVERY_DAY } from '@sirius/contracts';
import { describe, expect, test } from 'vitest';
import { NOTIFY_WINDOW_MS, notifySendArgs } from '../src/notifier.ts';
import { harness, NOON_ISH } from './harness.ts';

const at = (iso: string) => Date.parse(iso);

describe('rollover (F8)', () => {
  test('moves unfinished tasks silently at 04:00, leaving done ones behind', () => {
    const h = harness();
    const open = h.run('add_task', { title: 'open', tier: 'priority' });
    const done = h.run('add_task', { title: 'done' });
    h.run('complete_task', { id: done.id });
    h.now.value = at('2026-11-02T04:00:00Z');
    h.core.scheduler.tick();
    const today = h.run('get_today', {});
    expect(today.date).toBe('2026-11-02');
    expect(today.tasks.map((t) => [t.id, t.tier])).toEqual([[open.id, 'priority']]);
    expect(h.notified).toEqual([]);
  });

  test('does nothing at 03:59', () => {
    const h = harness();
    h.run('add_task', { title: 'a' });
    h.now.value = at('2026-11-02T03:59:00Z');
    h.core.scheduler.tick();
    expect(h.run('get_today', {}).date).toBe('2026-11-01');
  });

  test('catches up after days powered off', () => {
    const h = harness();
    h.run('add_task', { title: 'a' });
    h.now.value = at('2026-11-05T09:00:00Z');
    h.core.scheduler.tick();
    expect(h.run('get_today', {}).tasks[0]?.scheduled_for).toBe('2026-11-05');
  });

  test('a dropped task stays dropped', () => {
    const h = harness();
    const { id } = h.run('add_task', { title: 'a' });
    h.run('drop_task', { id });
    h.now.value = at('2026-11-02T04:00:00Z');
    h.core.scheduler.tick();
    expect(h.run('get_today', {}).tasks).toEqual([]);
  });
});

describe('the day turning over', () => {
  test('tells open windows even when no task had to move', () => {
    const h = harness();
    h.core.scheduler.tick();
    h.now.value = at('2026-11-02T04:00:00Z');
    h.core.scheduler.tick();
    expect(h.events).toContainEqual({ type: 'day_changed', date: '2026-11-02' });
  });

  test('says nothing within a day', () => {
    const h = harness();
    h.core.scheduler.tick();
    h.advance(60_000);
    h.core.scheduler.tick();
    expect(h.events.some((e) => e.type === 'day_changed')).toBe(false);
  });
});

describe('reminders (F13)', () => {
  const remind = (h: ReturnType<typeof harness>, time = '17:40', weekdays = EVERY_DAY) =>
    h.run('set_reminder', { label: 'Pray', kind: 'prayer', time_local: time, weekdays });

  test('fires once at its time', () => {
    const h = harness();
    remind(h);
    h.now.value = at('2026-11-01T17:39:00Z');
    h.core.scheduler.tick();
    expect(h.notified).toEqual([]);
    h.now.value = at('2026-11-01T17:40:00Z');
    h.core.scheduler.tick();
    h.advance(60_000);
    h.core.scheduler.tick();
    expect(h.notified.map((n) => n.body)).toEqual(['Pray']);
  });

  test('respects weekdays: Sunday only stays silent on Monday', () => {
    const h = harness(at('2026-11-02T09:00:00Z'));
    remind(h, '10:00', 0b1000000);
    h.now.value = at('2026-11-02T10:00:00Z');
    h.core.scheduler.tick();
    expect(h.notified).toEqual([]);
  });

  test('a snooze delays it, then it fires once', () => {
    const h = harness();
    const { id } = remind(h);
    const until = at('2026-11-01T18:30:00Z');
    h.run('snooze_reminder', { id, until });
    h.now.value = at('2026-11-01T17:40:00Z');
    h.core.scheduler.tick();
    expect(h.notified).toEqual([]);
    h.now.value = until;
    h.core.scheduler.tick();
    h.advance(60_000);
    h.core.scheduler.tick();
    expect(h.notified.length).toBe(1);
  });

  test('a reminder missed while the laptop slept is let go', () => {
    const h = harness();
    remind(h);
    h.now.value = at('2026-11-01T17:50:00Z');
    h.core.scheduler.tick();
    expect(h.notified).toEqual([]);
  });

  test('turning one off stops it', () => {
    const h = harness();
    const { id } = remind(h);
    h.run('set_reminder_enabled', { id, enabled: false });
    h.now.value = at('2026-11-01T17:40:00Z');
    h.core.scheduler.tick();
    expect(h.notified).toEqual([]);
    expect(h.run('list_reminders', {})[0]?.next_fire_at).toBeNull();
  });

  test('reports when it next fires', () => {
    const h = harness();
    remind(h);
    expect(h.run('get_today', {}).next_reminder?.next_fire_at).toBe(at('2026-11-01T17:40:00Z'));
  });
});

describe('quiet mode (F4, F24)', () => {
  test('lasts until 04:00 the next day', () => {
    const h = harness();
    h.run('set_quiet_mode', { on: true });
    h.now.value = at('2026-11-02T03:59:00Z');
    expect(h.run('get_today', {}).quiet_mode).toBe(true);
    h.now.value = at('2026-11-02T04:00:00Z');
    expect(h.run('get_today', {}).quiet_mode).toBe(false);
  });

  test('silences reminders, and they do not fire late', () => {
    const h = harness();
    h.run('set_reminder', {
      label: 'x',
      kind: 'custom',
      time_local: '17:40',
      weekdays: EVERY_DAY,
    });
    h.run('set_quiet_mode', { on: true });
    h.now.value = at('2026-11-01T17:40:00Z');
    h.core.scheduler.tick();
    h.run('set_quiet_mode', { on: false });
    h.advance(60_000);
    h.core.scheduler.tick();
    expect(h.notified).toEqual([]);
  });

  test('queues agent events and shows them on Welcome back', () => {
    const h = harness();
    h.run('set_quiet_mode', { on: true });
    h.advance(1000);
    h.run('post_agent_event', { source: 'claude', kind: 'needs_input', project: 'quant-lab' });
    expect(h.notified).toEqual([]);
    expect(h.events.some((e) => e.type === 'agent')).toBe(false);
    h.run('set_quiet_mode', { on: false });
    expect(h.notified.length).toBe(1);
    expect(h.events.some((e) => e.type === 'agent_queue_released')).toBe(true);
  });

  test('several queued events become one notification', () => {
    const h = harness();
    h.run('set_quiet_mode', { on: true });
    h.run('post_agent_event', { source: 'claude', kind: 'needs_input', project: 'a' });
    h.run('post_agent_event', { source: 'codex', kind: 'needs_input', project: 'b' });
    h.run('set_quiet_mode', { on: false });
    expect(h.notified.map((n) => n.body)).toEqual([
      '2 things came in while you were away. No rush.',
    ]);
  });

  test('queued events also surface when quiet mode ends at rollover', () => {
    const h = harness();
    h.core.scheduler.tick();
    h.run('set_quiet_mode', { on: true });
    h.run('post_agent_event', { source: 'claude', kind: 'needs_input' });
    h.now.value = at('2026-11-02T04:00:00Z');
    h.core.scheduler.tick();
    expect(h.notified.length).toBe(1);
  });
});

describe('agent attention (F23, F25)', () => {
  const event = { source: 'claude', kind: 'needs_input', project: 'quant-lab' } as const;

  test('reads as one calm sentence', () => {
    const h = harness();
    h.run('post_agent_event', { ...event, message: 'Claude needs your permission to use Bash' });
    expect(h.notified[0]?.body).toBe(
      'Claude is waiting for an approval in quant-lab. No rush, it will keep.',
    );
  });

  test('duplicates coalesce into one event and one notification', () => {
    const h = harness();
    h.run('post_agent_event', event);
    h.run('post_agent_event', event);
    expect(h.run('list_agent_events', {}).length).toBe(1);
    expect(h.notified.length).toBe(1);
  });

  test('at most one notification per source per two minutes', () => {
    const h = harness();
    h.run('post_agent_event', { ...event, project: 'a' });
    h.run('post_agent_event', { ...event, project: 'b' });
    expect(h.notified.length).toBe(1);
    h.advance(120_000);
    h.run('post_agent_event', { ...event, project: 'c' });
    expect(h.notified.length).toBe(2);
  });

  test('the status line follows, and Got it clears it', () => {
    const h = harness();
    const { id } = h.run('post_agent_event', event);
    const status = () => h.run('get_agents', {}).agents.find((a) => a.id === 'claude')?.status;
    expect(status()).toBe('waiting');
    h.run('ack_agent_event', { id });
    expect(status()).toBe('idle');
  });
});

describe('turn_complete (Codex only ever sends this)', () => {
  const finished = { source: 'codex', kind: 'turn_complete', project: 'lab' } as const;

  test('notifies, but leaves no toast or waiting status behind', () => {
    const h = harness();
    h.run('post_agent_event', finished);
    expect(h.notified.map((n) => n.body)).toEqual(['Codex finished in lab.']);
    expect(h.run('list_agent_events', {})).toEqual([]);
    expect(h.events.some((e) => e.type === 'agent')).toBe(false);
  });

  test('clears an earlier waiting event for the same project', () => {
    const h = harness();
    h.run('post_agent_event', { source: 'codex', kind: 'needs_input', project: 'lab' });
    h.run('post_agent_event', finished);
    expect(h.run('list_agent_events', {})).toEqual([]);
  });

  test('leaves other projects waiting', () => {
    const h = harness();
    h.run('post_agent_event', { source: 'codex', kind: 'needs_input', project: 'other' });
    h.run('post_agent_event', finished);
    expect(h.run('list_agent_events', {}).length).toBe(1);
  });

  test('stays silent in quiet mode', () => {
    const h = harness();
    h.run('set_quiet_mode', { on: true });
    h.run('post_agent_event', finished);
    expect(h.notified).toEqual([]);
  });
});

test('the agent choice and model persist', () => {
  const h = harness(NOON_ISH);
  h.run('select_agent', { agent: 'codex', model: 'gpt-6.1-terra' });
  const view = h.run('get_agents', {});
  expect(view.selected).toBe('codex');
  expect(view.agents.find((a) => a.id === 'codex')?.model).toBe('gpt-6.1-terra');
});

describe('alerts that have to be seen', () => {
  const prompt = { source: 'claude', kind: 'needs_input', project: 'tmp' } as const;

  test('a second prompt in a project alerts again, while staying one event (F25)', () => {
    const h = harness();
    h.run('post_agent_event', prompt);
    h.advance(NOTIFY_WINDOW_MS);
    h.run('post_agent_event', prompt);
    expect(h.notified.length).toBe(2);
    expect(h.run('list_agent_events', {}).length).toBe(1);
  });

  test('prompts in a burst still notify only once (F25)', () => {
    const h = harness();
    h.run('post_agent_event', prompt);
    h.run('post_agent_event', prompt);
    expect(h.notified.length).toBe(1);
  });

  test('quiet mode keeps a repeat silent too (F24)', () => {
    const h = harness();
    h.run('set_quiet_mode', { on: true });
    h.run('post_agent_event', prompt);
    h.advance(NOTIFY_WINDOW_MS);
    h.run('post_agent_event', prompt);
    expect(h.notified).toEqual([]);
  });

  test('GNOME shows a banner, which it never does at low urgency', () => {
    const args = notifySendArgs('Sirius', 'Claude needs you');
    expect(args).toContain('--urgency=normal');
    expect(args.slice(-2)).toEqual(['Sirius', 'Claude needs you']);
  });
});
