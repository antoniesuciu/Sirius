import { describe, expect, test } from 'vitest';
import { harness } from './harness.ts';

describe('goals', () => {
  test('add_goal creates ordered milestones', () => {
    const h = harness();
    const goal = h.run('add_goal', {
      title: 'G',
      milestones: [{ title: 'one' }, { title: 'two' }],
    });
    h.run('add_milestone', { goal_id: goal.id, title: 'three' });
    const [listed] = h.run('list_goals', {});
    expect(listed?.milestones.map((m) => [m.title, m.position])).toEqual([
      ['one', 0],
      ['two', 1],
      ['three', 2],
    ]);
  });

  test('deleting a goal takes its milestones with it', () => {
    const h = harness();
    const goal = h.run('add_goal', { title: 'G', milestones: [{ title: 'one' }] });
    h.run('delete_goal', { id: goal.id });
    expect(h.run('list_goals', {})).toEqual([]);
    expect(() => h.run('complete_milestone', { id: goal.milestones[0]?.id ?? '' })).toThrow();
  });

  test('a step closer ticks the goal for today only, and leaves the milestones alone', () => {
    const h = harness();
    const goal = h.run('add_goal', { title: 'Run a 10k', milestones: [{ title: '5k' }] });
    const stepped = h.run('step_goal', { id: goal.id });
    expect(stepped.stepped_today).toBe(true);
    expect(stepped.milestones.map((m) => m.done_at)).toEqual([null]);
    expect(h.run('list_goals', {})[0]?.stepped_today).toBe(true);
    // The next day it is gone by itself.
    h.advance(24 * 60 * 60 * 1000);
    expect(h.run('list_goals', {})[0]?.stepped_today).toBe(false);
    // A second tap on the same day takes the tick back.
    h.run('step_goal', { id: goal.id });
    expect(h.run('step_goal', { id: goal.id }).stepped_today).toBe(false);
  });

  test('a milestone needs a real goal', () => {
    expect(() => harness().run('add_milestone', { goal_id: 'nope', title: 'x' })).toThrow();
  });
});

describe('learning', () => {
  const twoRoadmaps = () => {
    const h = harness();
    const first = h.run('add_roadmap', {
      title: 'Analysis',
      steps: [{ title: 'Limits', est_minutes: 30 }],
    });
    const second = h.run('add_roadmap', { title: 'Probability', steps: [{ title: 'Measure' }] });
    return { h, first, second, step: first.steps[0]?.id as string };
  };

  test('roadmaps progress independently', () => {
    const { first, second } = twoRoadmaps();
    expect([first.status, second.status]).toEqual(['active', 'active']);
  });

  test('putting a step in Today creates a linked task (F12)', () => {
    const { h, step } = twoRoadmaps();
    expect(h.run('step_to_today', { id: step })).toMatchObject({
      title: 'Limits, 30 minutes',
      source: 'roadmap',
      roadmap_step_id: step,
      scheduled_for: '2026-11-01',
    });
  });

  test('pressing it twice does not duplicate the task', () => {
    const { h, step } = twoRoadmaps();
    const a = h.run('step_to_today', { id: step });
    expect(h.run('step_to_today', { id: step }).id).toBe(a.id);
  });

  test('ticking the linked task logs a day worked on, and the step stays open (F12)', () => {
    const { h, step } = twoRoadmaps();
    const task = h.run('step_to_today', { id: step });
    h.run('complete_task', { id: task.id });
    const [first] = h.run('list_learning', {});
    expect(first?.steps[0]?.status).toBe('todo');
    expect(first?.steps[0]?.worked_on).toEqual([task.scheduled_for]);
    expect(first?.status).toBe('active');
    // The next day it can go into Today again, and that day is logged too.
    h.advance(24 * 60 * 60 * 1000);
    const next = h.run('step_to_today', { id: step });
    expect(next.id).not.toBe(task.id);
    h.run('complete_task', { id: next.id });
    expect(h.run('list_learning', {})[0]?.steps[0]?.worked_on).toEqual([
      task.scheduled_for,
      next.scheduled_for,
    ]);
  });

  test('unticking the task takes the day back off', () => {
    const { h, step } = twoRoadmaps();
    const task = h.run('step_to_today', { id: step });
    h.run('complete_task', { id: task.id });
    h.run('reopen_task', { id: task.id });
    expect(h.run('list_learning', {})[0]?.steps[0]?.worked_on).toEqual([]);
  });

  test('finishing a roadmap leaves the other roadmap active', () => {
    const { h, step } = twoRoadmaps();
    h.run('update_roadmap_step', { id: step, status: 'done' });
    expect(h.run('list_learning', {}).map((r) => r.status)).toEqual(['done', 'active']);
  });
});

test('milestone notes persist; finishing closes its open task, reopening keeps the history', () => {
  const h = harness();
  const r = h.run('add_roadmap', { title: 'Independent route', steps: [{ title: 'First' }] });
  const id = r.steps[0]!.id;
  const task = h.run('step_to_today', { id });
  h.run('update_roadmap_step', {
    id,
    description: 'Read chapter 1',
    notes: 'Worked exercises 1–4',
    status: 'done',
  });
  expect(h.run('list_learning', {})[0]?.steps[0]).toMatchObject({
    description: 'Read chapter 1',
    notes: 'Worked exercises 1–4',
    status: 'done',
  });
  expect(h.run('get_today', {}).tasks.find((t) => t.id === task.id)?.status).toBe('done');
  h.run('update_roadmap_step', { id, status: 'todo' });
  expect(h.run('list_learning', {})[0]).toMatchObject({ status: 'active' });
  expect(h.run('list_learning', {})[0]?.steps[0]).toMatchObject({
    notes: 'Worked exercises 1–4',
    status: 'todo',
    done_at: null,
  });
  // The day it was worked on stays in its history.
  expect(h.run('get_today', {}).tasks.find((t) => t.id === task.id)?.status).toBe('done');
  h.run('update_roadmap_step', { id, status: 'done' });
  h.run('add_roadmap_step', { roadmap_id: r.id, title: 'Second' });
  expect(h.run('list_learning', {})[0]?.status).toBe('active');
  expect(() => h.run('update_roadmap_step', { id: 'missing', notes: 'x' })).toThrow();
});
