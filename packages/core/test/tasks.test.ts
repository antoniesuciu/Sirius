import { describe, expect, test } from 'vitest';
import { harness } from './harness.ts';

describe('add_task', () => {
  test('defaults to a small task today, from the user', () => {
    const h = harness();
    const task = h.run('add_task', { title: 'Water the basil' });
    expect(task).toMatchObject({
      tier: 'small',
      scheduled_for: '2026-11-01',
      status: 'open',
      source: 'user',
      rev: 1,
    });
  });

  test('an agent turn is sourced as sirius, an external session as mcp', () => {
    const h = harness();
    expect(h.run('add_task', { title: 'a' }, { actor: 'claude', via: 'chat' }).source).toBe(
      'sirius',
    );
    expect(h.run('add_task', { title: 'b' }, { actor: 'codex', via: 'mcp' }).source).toBe('mcp');
  });

  test('before 04:00 it lands on the logical day, not the calendar day', () => {
    const h = harness(Date.parse('2026-11-02T03:00:00Z'));
    expect(h.run('add_task', { title: 'Late' }).scheduled_for).toBe('2026-11-01');
  });

  test('rejects an empty title', () => {
    expect(() => harness().run('add_task', { title: '   ' })).toThrow();
  });
});

describe('get_today', () => {
  test('lists priorities and smalls in order, hides dropped, counts tomorrow', () => {
    const h = harness();
    const a = h.run('add_task', { title: 'A', tier: 'priority' });
    const b = h.run('add_task', { title: 'B' });
    h.run('add_task', { title: 'Later', date: '2026-11-02' });
    h.run('drop_task', { id: b.id });
    const today = h.run('get_today', {});
    expect(today.tasks.map((t) => t.id)).toEqual([a.id]);
    expect(today.resting_tomorrow).toBe(1);
    expect(today.date).toBe('2026-11-01');
  });

  test('done tasks stay visible for the rest of the day (F7)', () => {
    const h = harness();
    const task = h.run('add_task', { title: 'A' });
    h.run('complete_task', { id: task.id });
    expect(h.run('get_today', {}).tasks[0]?.status).toBe('done');
  });
});

describe('complete and reopen', () => {
  test('complete sets the time, reopen clears it', () => {
    const h = harness();
    const { id } = h.run('add_task', { title: 'A' });
    expect(h.run('complete_task', { id }).completed_at).toBe(h.now.value);
    expect(h.run('reopen_task', { id })).toMatchObject({ status: 'open', completed_at: null });
  });

  test('completing twice writes once', () => {
    const h = harness();
    const { id } = h.run('add_task', { title: 'A' });
    const first = h.run('complete_task', { id });
    h.advance(1000);
    expect(h.run('complete_task', { id }).rev).toBe(first.rev);
  });
});

test('every write bumps rev and records who did it (ADR-3)', () => {
  const h = harness();
  const { id } = h.run('add_task', { title: 'A' });
  h.advance(5);
  const renamed = h.run('rename_task', { id, title: 'B' });
  expect(renamed).toMatchObject({ rev: 2, updated_at: h.now.value });
  const changes = h.events.filter((e) => e.type === 'change');
  expect(changes.map((e) => e.type === 'change' && [e.op, e.rev, e.actor])).toEqual([
    ['create', 1, 'user'],
    ['update', 2, 'user'],
  ]);
});

test('a failed operation leaves no row and announces nothing', () => {
  const h = harness();
  const before = h.events.length;
  expect(() => h.run('reschedule_tasks', { ids: ['missing'], date: '2026-11-02' })).toThrow();
  expect(h.events.length).toBe(before);
});

test('soft delete hides a task but keeps the row', () => {
  const h = harness();
  const { id } = h.run('add_task', { title: 'A' });
  h.run('delete_task', { id });
  expect(h.run('get_today', {}).tasks).toEqual([]);
  expect(h.core.store.write('user', (tx) => tx.peek('tasks', id))?.deleted_at).toBe(h.now.value);
});
