/**
 * An in-memory backend with the mockup's data (M0). It lets the dashboard run with no
 * core at all: open the app with `?fixtures`. Chat is a small script, not an agent.
 */
import {
  type AgentEvent,
  type AgentId,
  type AgentsView,
  ApiError,
  addDays,
  agentCatalog,
  type EntityName,
  EVERY_DAY,
  type EventHandlers,
  type GoalView,
  type ListItem,
  logicalDate,
  type Message,
  nextOccurrence,
  type OpInput,
  type OpName,
  type OpOutput,
  occurrencesOn,
  type Proposal,
  type ReminderView,
  type RoadmapView,
  type ScheduleEvent,
  type SiriusClient,
  type SiriusEvent,
  type Task,
} from '@sirius/contracts';

const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;

let nextId = 1;
const newId = () => `f${nextId++}`;

function common() {
  const now = Date.now();
  return { id: newId(), created_at: now, updated_at: now, deleted_at: null, rev: 1 };
}

function task(title: string, tier: Task['tier'], date: string, position: number): Task {
  return {
    ...common(),
    title,
    tier,
    scheduled_for: date,
    status: 'open',
    position,
    completed_at: null,
    source: 'user',
    roadmap_step_id: null,
  };
}

function scheduleEvent(
  title: string,
  weekdays: number,
  start: string,
  end: string | null,
  location: string | null,
): ScheduleEvent {
  return {
    ...common(),
    title,
    location,
    weekdays,
    date: null,
    start_local: start,
    end_local: end,
    starts_on: null,
    ends_on: null,
  };
}

function goal(title: string, horizon: string, done: number): GoalView {
  const g = {
    ...common(),
    title,
    horizon_text: horizon,
    target_date: null,
    status: 'active' as const,
    position: 0,
    stepped_on: null,
  };
  const milestones = [0, 1, 2, 3, 4].map((i) => ({
    ...common(),
    goal_id: g.id,
    title: `Milestone ${i + 1}`,
    position: i,
    done_at: i < done ? Date.now() : null,
  }));
  return { ...g, milestones, stepped_today: false };
}

function roadmap(
  title: string,
  subtitle: string,
  status: RoadmapView['status'],
  steps: Array<[string, number | null]>,
): RoadmapView {
  const r = { ...common(), title, subtitle, status, position: 0 };
  return {
    ...r,
    steps: steps.map(([stepTitle, est], i) => ({
      ...common(),
      roadmap_id: r.id,
      description: '',
      notes: '',
      title: stepTitle,
      est_minutes: est,
      position: i,
      status: 'todo' as const,
      done_at: null,
      worked_on: [],
    })),
  };
}

function reminder(label: string, kind: ReminderView['kind'], time: string): ReminderView {
  return {
    ...common(),
    label,
    kind,
    time_local: time,
    weekdays: EVERY_DAY,
    enabled: true,
    once: false,
    snoozed_until: null,
    last_fired_on: null,
    next_fire_at: nextOccurrence(time, EVERY_DAY, Date.now(), zone),
  };
}

export interface FixtureOptions {
  toastAfterMs: number;
  /** A round trip, as from a phone over Tailscale; 0 answers at once. */
  latencyMs?: number;
}

export function createFixtureClient(options: FixtureOptions): SiriusClient {
  const today = logicalDate(Date.now(), zone);
  const tomorrow = addDays(today, 1);
  const state = {
    tasks: [
      task('Derive the covariance update', 'priority', today, 0),
      task('Ten pages of Abbott', 'priority', today, 1),
      task('Walk before sunset', 'priority', today, 2),
      task('Reply to the lab email', 'small', today, 3),
      task('Buy tomatoes and rice', 'small', today, 4),
      task('Tidy the desk', 'small', today, 5),
    ],
    goals: [
      goal('Understand stochastic calculus', 'Long term · 2027', 1),
      goal('Summer internship in quantitative research', 'Applications by March', 2),
      goal('Finish the localization component', 'This month', 4),
    ],
    roadmaps: [
      roadmap('Real analysis', 'Abbott · chapter 2 of 8', 'active', [
        ['The real numbers', 25],
        ['Sequences and limits, §2.4', 30],
        ['Series and convergence', 40],
        ['Continuity', 35],
        ['Differentiation', 45],
      ]),
      roadmap('Probability theory', 'After real analysis', 'later', [
        ['Measure basics, one section', null],
      ]),
      roadmap('Stochastic processes', 'Markov chains, martingales, Brownian motion', 'later', [
        ['Discrete-time Markov chains, one chapter', null],
      ]),
      roadmap('Stochastic calculus', 'Later, for quantitative finance', 'later', []),
    ],
    list: [] as ListItem[],
    schedule: [
      scheduleEvent('Real analysis lecture', 0b0000101, '10:00', '11:30', 'Room 2.14'),
      scheduleEvent('Gym', 0b0001010, '18:00', '19:00', null),
    ],
    reminders: [
      reminder('Midday pause', 'prayer', '12:30'),
      reminder('Evening prayer or reflection', 'prayer', '17:40'),
      reminder('Stand up and stretch', 'wellbeing', '16:30'),
    ],
    quiet: false,
    selected: 'claude' as AgentId,
    models: {
      claude: agentCatalog.claude.defaultModel,
      codex: agentCatalog.codex.defaultModel,
    },
    messages: [] as Message[],
    settings: {} as Record<string, unknown>,
    proposals: [] as Proposal[],
    events: [] as AgentEvent[],
  };

  const first = state.roadmaps[0]?.steps[0];
  if (first) {
    first.status = 'done';
    first.done_at = Date.now();
    first.notes = 'Reviewed completeness and the least upper bound property.';
  }

  const listeners = new Set<EventHandlers>();
  const emit = (event: SiriusEvent) => {
    for (const l of listeners) l.onEvent(event);
  };
  const changed = (entity: EntityName) =>
    emit({ type: 'change', entity, id: 'x', op: 'update', rev: 1, actor: 'user', change_id: 'x' });

  const pushMessage = (role: Message['role'], text: string, meta: Message['meta'] = null) => {
    state.messages.push({ ...common(), conversation_id: 'c1', role, text, meta });
  };
  const attachedNames = new Map<string, string>();

  /** Streams a scripted reply through the same events a real turn produces. */
  const replyWith = (turnId: string, text: string, after?: () => void, tools: string[] = []) => {
    emit({ type: 'chat', kind: 'start', turn_id: turnId, agent: state.selected });
    setTimeout(() => {
      emit({ type: 'chat', kind: 'text', turn_id: turnId, delta: text });
      setTimeout(() => {
        pushMessage('assistant', text, { tools });
        after?.();
        emit({ type: 'chat', kind: 'done', turn_id: turnId });
      }, 200);
    }, 500);
  };

  const propose = (summary: string, ids: string[], date: string) => {
    state.proposals.push({
      ...common(),
      actor: state.selected,
      summary,
      ops: [{ op: 'reschedule_tasks', input: { ids, date } }],
      status: 'pending',
      decided_at: null,
      expires_at: Date.now() + 3_600_000,
    });
    changed('proposals');
  };

  const script = (turnId: string, text: string) => {
    const lower = text.toLowerCase();
    if (lower === 'fail fast') {
      // A real turn can end before its send_chat response arrives. This reproduces that order.
      emit({ type: 'chat', kind: 'start', turn_id: turnId, agent: state.selected });
      pushMessage('assistant', 'That failed straight away.');
      emit({ type: 'chat', kind: 'error', turn_id: turnId, message: 'failed' });
      return;
    }
    const goalMatch = text.match(/^add\s+(?:a\s+)?goal[:\s]+(.+)/i);
    if (goalMatch?.[1]) {
      const title = goalMatch[1].trim();
      state.goals.push({ ...goal(title, 'No deadline yet', 0), milestones: [] });
      changed('goals');
      return replyWith(turnId, `Added the goal “${title}”, with no deadline.`, undefined, [
        'list_goals',
        'add_goal',
      ]);
    }
    // "theme midnight": what the real agent does through set_appearance.
    const look = text.match(/^theme\s+([\w-]+)$/i);
    if (look?.[1]) {
      const value = look[1].toLowerCase();
      state.settings['ui.theme'] = value;
      changed('settings');
      return replyWith(turnId, `Switched the theme to ${value}.`, undefined, ['set_appearance']);
    }
    const learnMatch = text.match(/^learn[:\s]+(.+)/i);
    if (learnMatch?.[1]) {
      const title = learnMatch[1].trim();
      state.roadmaps.push(roadmap(title, 'Added just now', 'later', []));
      changed('roadmaps');
      return replyWith(turnId, `Added ${title} to Learning, at the end of the path.`, undefined, [
        'add_roadmap',
      ]);
    }
    if (/(overwhelm|tired|lighter|too much|tomorrow)/.test(lower)) {
      const open = state.tasks.filter((t) => t.scheduled_for === today && t.status === 'open');
      const keep = open.find((t) => t.tier === 'priority');
      const rest = open.filter((t) => t !== keep).map((t) => t.id);
      return replyWith(
        turnId,
        "Then let's make today small. I can keep one priority and let the rest rest until tomorrow.",
        () => propose('Keep one priority, rest the others until tomorrow', rest, tomorrow),
      );
    }
    return replyWith(turnId, 'Noted. This is the fixture backend, so that is all I can do.');
  };

  const find = <T extends { id: string }>(items: T[], id: string): T => {
    const item = items.find((x) => x.id === id);
    if (!item) throw new ApiError(404, 'not_found', 'Not found');
    return item;
  };

  const agentsView = (): AgentsView => ({
    selected: state.selected,
    agents: (['claude', 'codex'] as const).map((id) => ({
      id,
      label: agentCatalog[id].label,
      model: state.models[id],
      models: agentCatalog[id].models,
      status: state.quiet
        ? 'resting'
        : state.events.some((e) => e.source === id && !e.acknowledged_at)
          ? 'waiting'
          : 'idle',
      reason: null,
    })),
  });

  const handlers: { [N in OpName]?: (input: OpInput<N>) => OpOutput<N> } = {
    get_today: () => ({
      date: today,
      tasks: state.tasks.filter((t) => t.scheduled_for === today && t.status !== 'dropped'),
      quiet_mode: state.quiet,
      next_reminder: null,
      resting_tomorrow: state.tasks.filter(
        (t) => t.scheduled_for === tomorrow && t.status === 'open',
      ).length,
      schedule: occurrencesOn(state.schedule, today),
    }),
    list_schedule: () => state.schedule.filter((e) => e.deleted_at === null),
    add_schedule_event: (input) => {
      const event: ScheduleEvent = {
        ...scheduleEvent(
          input.title,
          input.weekdays ?? 0,
          input.start_local,
          input.end_local ?? null,
          input.location ?? null,
        ),
        date: input.date ?? null,
      };
      state.schedule.push(event);
      changed('schedule_events');
      return event;
    },
    update_schedule_event: ({ id, ...patch }) => {
      const event = find(state.schedule, id);
      Object.assign(
        event,
        Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)),
      );
      changed('schedule_events');
      return event;
    },
    delete_schedule_event: ({ id }) => {
      find(state.schedule, id).deleted_at = Date.now();
      changed('schedule_events');
      return { ok: true as const };
    },
    list_goals: () => state.goals,
    list_learning: () => state.roadmaps,
    list_reminders: () => state.reminders,
    add_goal: ({ title }) => {
      const added = { ...goal(title, 'No deadline yet', 0), milestones: [] };
      state.goals.push(added);
      changed('goals');
      return added;
    },
    get_list: () => state.list.filter((item) => item.done_at === null),
    add_to_list: ({ text }) => {
      const item: ListItem = { ...common(), text, done_at: null };
      state.list.push(item);
      changed('list_items');
      return item;
    },
    tick_list_item: ({ id }) => {
      const item = find(state.list, id);
      item.done_at = Date.now();
      changed('list_items');
      return item;
    },
    list_proposals: () => state.proposals.filter((p) => p.status === 'pending'),
    list_agent_events: () => state.events.filter((e) => !e.acknowledged_at),
    get_agents: agentsView,
    get_conversation: () => ({
      conversation: null,
      messages: state.messages,
      active_turn_id: null,
    }),
    get_voice_state: () => ({ state: 'idle', transcript: null, mic_open: false, level: null }),
    get_settings: () => ({ ...state.settings }),
    set_appearance: ({ theme }) => {
      if (theme) state.settings['ui.theme'] = theme;
      changed('settings');
      return { theme: (state.settings['ui.theme'] as 'paper') ?? 'paper' };
    },
    voice_ptt: () => {
      throw new ApiError(503, 'voice_unavailable', "Voice isn't running right now.");
    },
    new_conversation: () => {
      state.messages = [];
      return { conversation: null, messages: [], active_turn_id: null };
    },
    add_task: ({ title }) => {
      const t = task(title, 'small', today, state.tasks.length);
      state.tasks.push(t);
      changed('tasks');
      return t;
    },
    complete_task: ({ id }) => {
      const t = find(state.tasks, id);
      t.status = 'done';
      t.completed_at = Date.now();
      changed('tasks');
      return t;
    },
    reopen_task: ({ id }) => {
      const t = find(state.tasks, id);
      t.status = 'open';
      t.completed_at = null;
      changed('tasks');
      return t;
    },
    drop_task: ({ id }) => {
      const t = find(state.tasks, id);
      t.status = 'dropped';
      changed('tasks');
      return t;
    },
    rename_goal: ({ id, title }) => {
      const g = find(state.goals, id);
      g.title = title;
      changed('goals');
      return g;
    },
    step_goal: ({ id }) => {
      const g = find(state.goals, id);
      g.stepped_today = !g.stepped_today;
      g.stepped_on = g.stepped_today ? new Date().toISOString().slice(0, 10) : null;
      changed('goals');
      return g;
    },
    delete_goal: ({ id }) => {
      state.goals = state.goals.filter((g) => g.id !== id);
      changed('goals');
      return { ok: true };
    },
    rename_roadmap: ({ id, title }) => {
      const r = find(state.roadmaps, id);
      r.title = title;
      changed('roadmaps');
      return r;
    },
    delete_roadmap: ({ id }) => {
      state.roadmaps = state.roadmaps.filter((r) => r.id !== id);
      changed('roadmaps');
      return { ok: true };
    },
    update_roadmap_step: ({ id, ...fields }) => {
      const step = find(
        state.roadmaps.flatMap((r) => r.steps),
        id,
      );
      Object.assign(step, fields);
      if (fields.status) step.done_at = fields.status === 'done' ? Date.now() : null;
      changed('roadmap_steps');
      return step;
    },
    add_roadmap_step: ({ roadmap_id, title, est_minutes }) => {
      const r = find(state.roadmaps, roadmap_id);
      const step = {
        ...common(),
        roadmap_id,
        title,
        description: '',
        notes: '',
        est_minutes: est_minutes ?? null,
        position: r.steps.length,
        status: 'todo' as const,
        done_at: null,
        worked_on: [],
      };
      r.steps.push(step);
      changed('roadmap_steps');
      return step;
    },
    step_to_today: ({ id }) => {
      const step = state.roadmaps.flatMap((r) => r.steps).find((s) => s.id === id);
      if (!step) throw new ApiError(404, 'not_found', 'Not found');
      const t = task(step.title, 'small', today, state.tasks.length);
      state.tasks.push(t);
      changed('tasks');
      return t;
    },
    set_reminder_enabled: ({ id, enabled }) => {
      const r = find(state.reminders, id);
      r.enabled = enabled;
      changed('reminders');
      return r;
    },
    snooze_reminder: ({ id, until }) => {
      const r = find(state.reminders, id);
      r.snoozed_until = until;
      r.next_fire_at = until;
      changed('reminders');
      return r;
    },
    set_quiet_mode: ({ on }) => {
      state.quiet = on;
      changed('day_state');
      return { quiet_mode: on };
    },
    remember: () => ({ saved: true }),
    start_phone_pairing: () => ({ code: '123456', expires_at: Date.now() + 300_000 }),
    forget_phones: () => ({ forgotten: 0 }),
    select_agent: ({ agent, model }) => {
      state.selected = agent;
      if (model) state.models[agent] = model;
      return agentsView();
    },
    ack_agent_event: ({ id }) => {
      const e = find(state.events, id);
      e.acknowledged_at = Date.now();
      return e;
    },
    confirm_proposal: ({ id }) => {
      const p = find(state.proposals, id);
      p.status = 'applied';
      for (const op of p.ops) {
        const { ids, date } = op.input as { ids: string[]; date: string };
        for (const taskId of ids) find(state.tasks, taskId).scheduled_for = date;
      }
      pushMessage('assistant', 'Done. One thing for today. That is enough.');
      changed('proposals');
      changed('tasks');
      return { ok: true, proposal: p };
    },
    reject_proposal: ({ id }) => {
      const p = find(state.proposals, id);
      p.status = 'rejected';
      pushMessage('assistant', "Alright, I'll leave it as it is.");
      changed('proposals');
      return { ok: true, proposal: p };
    },
    send_chat: ({ text, attachment_ids }) => {
      const turnId = newId();
      const names = (attachment_ids ?? []).map((id) => attachedNames.get(id) ?? id);
      pushMessage(
        'user',
        text,
        names.length ? { attachments: names.map((name) => ({ name, chars: 0 })) } : null,
      );
      script(turnId, text);
      return { turn_id: turnId, conversation_id: 'c1' };
    },
  };

  setTimeout(() => {
    const event: AgentEvent = {
      ...common(),
      source: 'claude',
      kind: 'needs_input',
      project: 'quant-lab',
      message: 'Claude needs your permission to run a command',
      acknowledged_at: null,
    };
    state.events.push(event);
    emit({ type: 'agent', event });
  }, options.toastAfterMs);

  return {
    push: {
      async key() {
        // A valid P-256 point, so a browser accepts it; nothing is ever sent with it.
        return 'BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8';
      },
      async subscribe(subscription) {
        (globalThis as { pushSubscriptions?: unknown[] }).pushSubscriptions ??= [];
        (globalThis as { pushSubscriptions?: unknown[] }).pushSubscriptions?.push(subscription);
      },
    },
    /** Every recording is heard as the same command, done at once like the voice fast path. */
    async speak(audio) {
      if (audio.size === 0) return { transcript: '', lang: 'en', reply: null };
      const title = 'Water the basil';
      state.tasks.push(task(title, 'small', today, state.tasks.length));
      changed('tasks');
      return {
        transcript: 'add water the basil to today',
        lang: 'en',
        route: 'fast_path',
        turn_id: newId(),
        intent: 'add_task',
        reply: `Added ${title.toLowerCase()} to today.`,
      };
    },
    async attach(file, name) {
      const text = name.toLowerCase().endsWith('.pdf') ? 'x'.repeat(4200) : await file.text();
      const id = `file-${Date.now()}`;
      attachedNames.set(id, name);
      return {
        id,
        name,
        chars: text.length,
        truncated: false,
        pages: name.toLowerCase().endsWith('.pdf') ? 3 : null,
      };
    },
    async call(name, input) {
      const handler = handlers[name] as ((i: typeof input) => OpOutput<typeof name>) | undefined;
      if (!handler) throw new ApiError(501, 'not_implemented', `Fixture has no ${name}`);
      if (options.latencyMs) await new Promise((r) => setTimeout(r, options.latencyMs));
      // Cloned so React Query never shares objects with this mutable store.
      return structuredClone(handler(input));
    },
    subscribe(l) {
      listeners.add(l);
      l.onConnected?.();
      return () => listeners.delete(l);
    },
  };
}
