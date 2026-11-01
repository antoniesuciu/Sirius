import { describe, expect, test } from 'vitest';
import { AGENT_EDITS_PER_MINUTE } from '../src/dispatcher.ts';
import { CLAUDE, codeOf, harness } from './harness.ts';

const moveTwo = (h: ReturnType<typeof harness>) => {
  const a = h.run('add_task', { title: 'a' });
  const b = h.run('add_task', { title: 'b' });
  return {
    a,
    b,
    proposal: h.run(
      'propose_changes',
      {
        summary: 'Move both to tomorrow',
        ops: [{ op: 'reschedule_tasks', input: { ids: [a.id, b.id], date: '2026-11-02' } }],
      },
      CLAUDE,
    ),
  };
};

describe('classification is enforced by the core (F19, ADR-7)', () => {
  test('additive single operations apply immediately for an agent', () => {
    const h = harness();
    const task = h.run('add_task', { title: 'a' }, CLAUDE);
    expect(h.run('complete_task', { id: task.id }, CLAUDE).status).toBe('done');
  });

  test.each([
    ['delete_task', { id: 'x' }],
    ['drop_task', { id: 'x' }],
    ['delete_goal', { id: 'x' }],
    ['delete_roadmap', { id: 'x' }],
    ['delete_reminder', { id: 'x' }],
    ['reschedule_tasks', { ids: ['x'], date: '2026-11-02' }],
  ] as const)('%s is refused for an agent, before it even looks', (name, input) => {
    const h = harness();
    expect(codeOf(() => h.run(name, input as never, CLAUDE))).toBe('requires_proposal');
  });

  test.each([
    ['confirm_proposal', { id: 'x' }],
    ['reject_proposal', { id: 'x' }],
    ['undo', { change_id: 'x' }],
    ['set_setting', { key: 'k', value: 1 }],
  ] as const)('%s is out of reach for an agent', (name, input) => {
    const h = harness();
    expect(codeOf(() => h.run(name, input as never, CLAUDE))).toBe('forbidden');
  });

  test('the same operations work for the user', () => {
    const h = harness();
    const { id } = h.run('add_task', { title: 'a' });
    expect(h.run('delete_task', { id })).toEqual({ ok: true });
  });

  test('many single edits in a row become a proposal too', () => {
    const h = harness();
    const ids = Array.from(
      { length: AGENT_EDITS_PER_MINUTE + 1 },
      (_, i) => h.run('add_task', { title: `t${i}` }).id,
    );
    for (const id of ids.slice(0, AGENT_EDITS_PER_MINUTE)) {
      h.run('complete_task', { id }, CLAUDE);
    }
    const last = ids.at(-1) as string;
    expect(codeOf(() => h.run('complete_task', { id: last }, CLAUDE))).toBe('requires_proposal');
    h.advance(61_000);
    expect(h.run('complete_task', { id: last }, CLAUDE).status).toBe('done');
  });

  test('adding things is never limited', () => {
    const h = harness();
    for (let i = 0; i < AGENT_EDITS_PER_MINUTE * 3; i += 1) {
      h.run('add_task', { title: `t${i}` }, CLAUDE);
    }
    expect(h.run('get_today', {}).tasks.length).toBe(AGENT_EDITS_PER_MINUTE * 3);
  });
});

describe('proposals', () => {
  test('nothing changes until Confirm', () => {
    const h = harness();
    const { a, proposal } = moveTwo(h);
    expect(proposal.status).toBe('pending');
    expect(h.run('list_proposals', {}).map((p) => p.id)).toEqual([proposal.id]);
    expect(h.run('get_today', {}).tasks.map((t) => t.id)).toContain(a.id);
  });

  test('Confirm applies everything, attributed to the agent', () => {
    const h = harness();
    const { proposal } = moveTwo(h);
    const before = h.events.length;
    expect(h.run('confirm_proposal', { id: proposal.id }).proposal.status).toBe('applied');
    expect(h.run('get_today', {}).tasks).toEqual([]);
    expect(h.run('get_today', {}).resting_tomorrow).toBe(2);
    const actors = h.events
      .slice(before)
      .flatMap((e) => (e.type === 'change' && e.entity === 'tasks' ? [e.actor] : []));
    expect(actors).toEqual(['claude', 'claude']);
  });

  test('Reject changes nothing and cannot be confirmed afterwards', () => {
    const h = harness();
    const { proposal } = moveTwo(h);
    h.run('reject_proposal', { id: proposal.id });
    expect(h.run('get_today', {}).tasks.length).toBe(2);
    expect(codeOf(() => h.run('confirm_proposal', { id: proposal.id }))).toBe('conflict');
  });

  test('it applies all or nothing', () => {
    const h = harness();
    const a = h.run('add_task', { title: 'a' });
    const proposal = h.run(
      'propose_changes',
      {
        summary: 'Two moves',
        ops: [
          { op: 'reschedule_task', input: { id: a.id, date: '2026-11-02' } },
          { op: 'reschedule_task', input: { id: 'gone', date: '2026-11-02' } },
        ],
      },
      CLAUDE,
    );
    expect(codeOf(() => h.run('confirm_proposal', { id: proposal.id }))).toBe('conflict');
    expect(h.run('get_today', {}).tasks.map((t) => t.id)).toEqual([a.id]);
    expect(h.run('list_proposals', {})).toEqual([]);
  });

  test('a proposal cannot smuggle in a user-only operation', () => {
    const h = harness();
    for (const op of ['confirm_proposal', 'undo', 'propose_changes', 'get_today', 'bogus']) {
      expect(
        codeOf(() => h.run('propose_changes', { summary: 's', ops: [{ op, input: {} }] }, CLAUDE)),
      ).toBe('invalid_proposal');
    }
  });

  test('a malformed input is refused when proposed, not at Confirm', () => {
    const h = harness();
    const ops = [{ op: 'reschedule_tasks', input: { ids: [], date: 'soon' } }];
    expect(codeOf(() => h.run('propose_changes', { summary: 's', ops }, CLAUDE))).toBe(
      'invalid_proposal',
    );
  });

  test('a proposal lapses at the next rollover', () => {
    const h = harness();
    const { proposal } = moveTwo(h);
    h.now.value = Date.parse('2026-11-02T04:00:00Z');
    h.core.scheduler.tick();
    expect(h.run('list_proposals', {})).toEqual([]);
    expect(codeOf(() => h.run('confirm_proposal', { id: proposal.id }))).toBe('conflict');
  });
});

describe('undo (F20)', () => {
  const lastChange = (h: ReturnType<typeof harness>) => {
    const change = h.events.findLast((e) => e.type === 'change' && e.entity !== 'proposals');
    if (change?.type !== 'change') throw new Error('no change recorded');
    return change.change_id;
  };

  test('reverts an agent-added task', () => {
    const h = harness();
    h.run('add_task', { title: 'a' }, CLAUDE);
    h.run('undo', { change_id: lastChange(h) });
    expect(h.run('get_today', {}).tasks).toEqual([]);
  });

  test('reverts a whole goal with its milestones as one', () => {
    const h = harness();
    h.run('add_goal', { title: 'G', milestones: [{ title: 'a' }, { title: 'b' }] }, CLAUDE);
    expect(h.run('undo', { change_id: lastChange(h) }).reverted).toBe(3);
    expect(h.run('list_goals', {})).toEqual([]);
  });

  test('reverts a confirmed proposal in one click', () => {
    const h = harness();
    const { a, proposal } = moveTwo(h);
    h.run('confirm_proposal', { id: proposal.id });
    h.run('undo', { change_id: lastChange(h) });
    expect(h.run('get_today', {}).tasks.map((t) => t.id)).toContain(a.id);
    expect(h.run('list_proposals', {})).toEqual([]);
  });

  test('restores a deleted goal through its proposal', () => {
    const h = harness();
    const goal = h.run('add_goal', { title: 'G', milestones: [{ title: 'a' }] });
    const proposal = h.run(
      'propose_changes',
      { summary: 'Delete it', ops: [{ op: 'delete_goal', input: { id: goal.id } }] },
      CLAUDE,
    );
    h.run('confirm_proposal', { id: proposal.id });
    expect(h.run('list_goals', {})).toEqual([]);
    h.run('undo', { change_id: lastChange(h) });
    expect(h.run('list_goals', {})[0]?.milestones.length).toBe(1);
  });

  test('expires after 30 seconds', () => {
    const h = harness();
    h.run('add_task', { title: 'a' }, CLAUDE);
    const id = lastChange(h);
    h.advance(30_001);
    expect(codeOf(() => h.run('undo', { change_id: id }))).toBe('undo_expired');
  });

  test('refuses when the row has moved on, and undoes nothing else', () => {
    const h = harness();
    const task = h.run('add_task', { title: 'a' }, CLAUDE);
    const id = lastChange(h);
    h.run('rename_task', { id: task.id, title: 'mine now' });
    expect(codeOf(() => h.run('undo', { change_id: id }))).toBe('conflict');
    expect(h.run('get_today', {}).tasks[0]?.title).toBe('mine now');
  });

  test('cannot be done twice', () => {
    const h = harness();
    h.run('add_task', { title: 'a' }, CLAUDE);
    const id = lastChange(h);
    h.run('undo', { change_id: id });
    expect(codeOf(() => h.run('undo', { change_id: id }))).toBe('conflict');
  });
});
