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

  test('the first roadmap is current and later ones wait', () => {
    const { first, second } = twoRoadmaps();
    expect([first.status, second.status]).toEqual(['active', 'later']);
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

  test('completing the linked task completes the step (F12)', () => {
    const { h, step } = twoRoadmaps();
    const task = h.run('step_to_today', { id: step });
    h.run('complete_task', { id: task.id });
    expect(h.run('list_learning', {})[0]?.steps[0]?.status).toBe('done');
  });

  test('finishing the last step moves the path to the next roadmap', () => {
    const { h, step } = twoRoadmaps();
    h.run('complete_task', { id: h.run('step_to_today', { id: step }).id });
    expect(h.run('list_learning', {}).map((r) => r.status)).toEqual(['done', 'active']);
  });

  test('reopening the task reopens the step and its roadmap', () => {
    const { h, step } = twoRoadmaps();
    const task = h.run('step_to_today', { id: step });
    h.run('complete_task', { id: task.id });
    h.run('reopen_task', { id: task.id });
    const [first] = h.run('list_learning', {});
    expect(first?.status).toBe('active');
    expect(first?.steps[0]?.status).toBe('todo');
  });
});
