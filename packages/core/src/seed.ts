/** The mockup's data, created through ordinary ops. For demos and end-to-end tests. */
import { EVERY_DAY } from '@sirius/contracts';
import type { Core } from './core.ts';

export function seedDemo(core: Core): void {
  const { dispatcher } = core;
  const user = { actor: 'user', via: 'ui' } as const;
  if (dispatcher.run('list_goals', {}, user).length > 0) return;

  for (const title of [
    'Derive the covariance update',
    'Ten pages of Abbott',
    'Walk before sunset',
  ]) {
    dispatcher.run('add_task', { title, tier: 'priority' }, user);
  }
  for (const title of ['Reply to the lab email', 'Buy tomatoes and rice', 'Tidy the desk']) {
    dispatcher.run('add_task', { title }, user);
  }

  const goals: Array<[string, string, number]> = [
    ['Understand stochastic calculus', 'Long term · 2027', 1],
    ['Summer internship in quantitative research', 'Applications by March', 2],
    ['Finish the localization component', 'This month', 4],
  ];
  for (const [title, horizon_text, done] of goals) {
    const milestones = [1, 2, 3, 4, 5].map((n) => ({ title: `Milestone ${n}` }));
    const goal = dispatcher.run('add_goal', { title, horizon_text, milestones }, user);
    for (const m of goal.milestones.slice(0, done)) {
      dispatcher.run('complete_milestone', { id: m.id }, user);
    }
  }

  const roadmaps: Array<[string, string, Array<{ title: string; est_minutes?: number }>]> = [
    [
      'Real analysis',
      'Abbott · chapter 2 of 8',
      [{ title: 'Sequences and limits, §2.4', est_minutes: 30 }],
    ],
    [
      'Probability theory',
      'After analysis, with no hurry',
      [{ title: 'Measure basics, one section' }],
    ],
    [
      'Stochastic processes',
      'Markov chains, martingales, Brownian motion',
      [{ title: 'Discrete-time Markov chains, one chapter' }],
    ],
    ['Stochastic calculus', 'Later, for quantitative finance', []],
  ];
  for (const [title, subtitle, steps] of roadmaps) {
    dispatcher.run('add_roadmap', { title, subtitle, steps }, user);
  }

  const reminders = [
    ['Midday pause', 'prayer', '12:30'],
    ['Evening prayer or reflection', 'prayer', '17:40'],
    ['Stand up and stretch', 'wellbeing', '16:30'],
  ] as const;
  for (const [label, kind, time_local] of reminders) {
    dispatcher.run('set_reminder', { label, kind, time_local, weekdays: EVERY_DAY }, user);
  }
}
