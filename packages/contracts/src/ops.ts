/**
 * The operation registry: the single definition of everything Sirius can do.
 *
 * REST routes, the OpenAPI document, the typed client and the MCP tool list are all
 * derived from this table, so a new operation is one entry here plus one handler in
 * `packages/core/src/ops/`.
 *
 * `class` decides who may run an operation directly (F19, ADR-7):
 * - `read`: anyone.
 * - `additive`: applies immediately, including single-item edits (spec section 7).
 * - `bulk_or_destructive`: the user directly; agents only through `propose_changes`.
 * - `proposal`: the `propose_changes` entry point itself.
 * - `system`: plumbing that is not a domain change. Never exposed as an MCP tool.
 *
 * `userOnly` marks operations an agent must never reach, even over REST.
 */

import { z } from 'zod';
import { ThemeId } from './appearance.ts';
import {
  AddTaskInput,
  AgentEvent,
  AgentEventKind,
  AgentId,
  AgentsView,
  ConversationView,
  Goal,
  GoalView,
  Id,
  IdInput,
  ListItem,
  LocalDate,
  Milestone,
  MilestoneDraft,
  Proposal,
  ProposedOp,
  Reminder,
  ReminderKind,
  ReminderView,
  Roadmap,
  RoadmapStep,
  RoadmapView,
  ScheduleEvent,
  StepDraft,
  Task,
  TimeLocal,
  Title,
  TodayView,
  VoiceRoute,
  VoiceState,
  Weekdays,
} from './schemas.ts';

export type OpClass = 'read' | 'additive' | 'bulk_or_destructive' | 'proposal' | 'system';
export type HttpMethod = 'get' | 'post' | 'delete';

export interface OpDefinition<
  I extends z.ZodObject = z.ZodObject,
  O extends z.ZodType = z.ZodType,
> {
  class: OpClass;
  summary: string;
  /** `path` is relative to /v1. `{name}` segments are filled from the input. */
  http: { method: HttpMethod; path: string };
  input: I;
  output: O;
  userOnly?: boolean;
  /** Exposes a system op to agents. Other system ops stay out of their tool list. */
  agentTool?: boolean;
}

function op<I extends z.ZodObject, O extends z.ZodType>(def: OpDefinition<I, O>) {
  return def;
}

const NoInput = z.object({});
const Ok = z.object({ ok: z.literal(true) });
const Rejected = z.object({ ok: z.literal(true), proposal: Proposal });

export const UndoResult = z.object({ ok: z.literal(true), reverted: z.number().int() });

export const SendChatInput = z.object({
  text: z.string().trim().min(1).max(8000),
  via: z.enum(['ui', 'voice']).optional().describe('voice asks for a short, speakable answer'),
  /** Files read by the core first, through POST /v1/attachments (F36). */
  attachment_ids: z.array(z.string().min(1).max(64)).max(3).optional(),
});
export const SendChatResult = z.object({ turn_id: z.string(), conversation_id: Id });

export const VoiceUtteranceInput = z.object({
  transcript: z.string().trim().min(1).max(2000),
  lang: z.string().min(2).max(8),
  latency_ms: z.record(z.string(), z.number()).optional(),
});
export const VoiceUtteranceResult = z.object({
  route: VoiceRoute,
  turn_id: z.string(),
  intent: z.string().nullable(),
  /** Set on the fast path: the sentence to speak straight away. Null means stay silent. */
  reply: z.string().nullable(),
});

export const VoiceStateView = z.object({
  state: VoiceState,
  transcript: z.string().nullable(),
  mic_open: z.boolean(),
  /** Set when the service reports a coarse TTS level (0 to 1) for the speaking avatar. */
  level: z.number().min(0).max(1).nullable(),
});
export type VoiceStateView = z.infer<typeof VoiceStateView>;

export const HealthView = z.object({
  ok: z.literal(true),
  version: z.string(),
  mode: z.enum(['local', 'remote']),
});

export const ops = {
  // Reads -------------------------------------------------------------------
  get_today: op({
    class: 'read',
    summary: "Today's tasks, quiet mode and the next reminder.",
    http: { method: 'get', path: '/today' },
    input: NoInput,
    output: TodayView,
  }),
  list_goals: op({
    class: 'read',
    summary: 'All goals with their milestones.',
    http: { method: 'get', path: '/goals' },
    input: NoInput,
    output: z.array(GoalView),
  }),
  list_learning: op({
    class: 'read',
    summary: 'All learning roadmaps with their steps.',
    http: { method: 'get', path: '/learning' },
    input: NoInput,
    output: z.array(RoadmapView),
  }),
  get_list: op({
    class: 'read',
    summary: 'The list of things to remember or buy, oldest first. Ticked items are left out.',
    http: { method: 'get', path: '/list' },
    input: NoInput,
    output: z.array(ListItem),
  }),
  add_to_list: op({
    class: 'additive',
    summary: 'Put something on the list, such as something to buy. Not for things to do today.',
    http: { method: 'post', path: '/list' },
    input: z.object({ text: Title }),
    output: ListItem,
  }),
  tick_list_item: op({
    class: 'additive',
    summary: 'Tick one thing off the list.',
    http: { method: 'post', path: '/list/{id}/tick' },
    input: IdInput,
    output: ListItem,
  }),
  list_schedule: op({
    class: 'read',
    summary: 'The schedule: fixed commitments, weekly or one-off, by start time.',
    http: { method: 'get', path: '/schedule' },
    input: NoInput,
    output: z.array(ScheduleEvent),
  }),
  add_schedule_event: op({
    class: 'additive',
    summary:
      'Add a fixed commitment to the schedule, such as a lecture or a shift. Give weekdays for a weekly one, or date for a one-off. Not for tasks.',
    http: { method: 'post', path: '/schedule' },
    input: z.object({
      title: Title,
      location: z.string().trim().max(200).optional(),
      weekdays: Weekdays.optional(),
      date: LocalDate.optional(),
      start_local: TimeLocal,
      end_local: TimeLocal.optional(),
      starts_on: LocalDate.optional(),
      ends_on: LocalDate.optional(),
    }),
    output: ScheduleEvent,
  }),
  update_schedule_event: op({
    class: 'additive',
    summary: 'Change one schedule event. Only the fields given change.',
    http: { method: 'post', path: '/schedule/{id}' },
    input: z.object({
      id: Id,
      title: Title.optional(),
      location: z.string().trim().max(200).nullable().optional(),
      weekdays: Weekdays.optional(),
      date: LocalDate.nullable().optional(),
      start_local: TimeLocal.optional(),
      end_local: TimeLocal.nullable().optional(),
      starts_on: LocalDate.nullable().optional(),
      ends_on: LocalDate.nullable().optional(),
    }),
    output: ScheduleEvent,
  }),
  delete_schedule_event: op({
    class: 'bulk_or_destructive',
    summary: 'Remove one event from the schedule.',
    http: { method: 'post', path: '/schedule/{id}/delete' },
    input: IdInput,
    output: z.object({ ok: z.literal(true) }),
  }),
  list_reminders: op({
    class: 'read',
    summary: 'All reminders with their next fire time.',
    http: { method: 'get', path: '/reminders' },
    input: NoInput,
    output: z.array(ReminderView),
  }),
  list_proposals: op({
    class: 'read',
    summary: 'Proposals waiting for a decision.',
    http: { method: 'get', path: '/proposals' },
    input: NoInput,
    output: z.array(Proposal),
  }),

  // Tasks -------------------------------------------------------------------
  add_task: op({
    class: 'additive',
    summary: 'Add a task. Defaults to a small task for today.',
    http: { method: 'post', path: '/tasks' },
    input: AddTaskInput,
    output: Task,
  }),
  complete_task: op({
    class: 'additive',
    summary: 'Mark one task done. Completes its roadmap step if it has one.',
    http: { method: 'post', path: '/tasks/{id}/complete' },
    input: IdInput,
    output: Task,
  }),
  reopen_task: op({
    class: 'additive',
    summary: 'Reopen one done task.',
    http: { method: 'post', path: '/tasks/{id}/reopen' },
    input: IdInput,
    output: Task,
  }),
  reschedule_task: op({
    class: 'additive',
    summary: 'Move one task to another date.',
    http: { method: 'post', path: '/tasks/{id}/reschedule' },
    input: z.object({ id: Id, date: LocalDate }),
    output: Task,
  }),
  rename_task: op({
    class: 'additive',
    summary: 'Rename one task.',
    http: { method: 'post', path: '/tasks/{id}/rename' },
    input: z.object({ id: Id, title: Title }),
    output: Task,
  }),
  reschedule_tasks: op({
    class: 'bulk_or_destructive',
    summary: 'Move several tasks to another date.',
    http: { method: 'post', path: '/tasks/reschedule' },
    input: z.object({ ids: z.array(Id).min(1), date: LocalDate }),
    output: z.array(Task),
  }),
  drop_task: op({
    class: 'bulk_or_destructive',
    summary: 'Let go of one task without doing it.',
    http: { method: 'post', path: '/tasks/{id}/drop' },
    input: IdInput,
    output: Task,
  }),
  delete_task: op({
    class: 'bulk_or_destructive',
    summary: 'Delete one task.',
    http: { method: 'delete', path: '/tasks/{id}' },
    input: IdInput,
    output: Ok,
  }),

  // Goals -------------------------------------------------------------------
  add_goal: op({
    class: 'additive',
    summary: 'Add a goal, optionally with milestones.',
    http: { method: 'post', path: '/goals' },
    input: z.object({
      title: Title,
      horizon_text: z.string().trim().max(200).optional(),
      target_date: LocalDate.optional(),
      milestones: z.array(MilestoneDraft).max(50).optional(),
    }),
    output: GoalView,
  }),
  rename_goal: op({
    class: 'additive',
    summary: 'Rename one goal.',
    http: { method: 'post', path: '/goals/{id}/rename' },
    input: z.object({ id: Id, title: Title }),
    output: Goal,
  }),
  delete_goal: op({
    class: 'bulk_or_destructive',
    summary: 'Delete a goal and its milestones.',
    http: { method: 'delete', path: '/goals/{id}' },
    input: IdInput,
    output: Ok,
  }),
  add_milestone: op({
    class: 'additive',
    summary: 'Add a milestone to a goal.',
    http: { method: 'post', path: '/goals/{goal_id}/milestones' },
    input: z.object({ goal_id: Id, title: Title }),
    output: Milestone,
  }),
  complete_milestone: op({
    class: 'additive',
    summary: 'Mark one milestone done.',
    http: { method: 'post', path: '/milestones/{id}/complete' },
    input: IdInput,
    output: Milestone,
  }),
  reopen_milestone: op({
    class: 'additive',
    summary: 'Reopen one done milestone.',
    http: { method: 'post', path: '/milestones/{id}/reopen' },
    input: IdInput,
    output: Milestone,
  }),
  delete_milestone: op({
    class: 'bulk_or_destructive',
    summary: 'Delete one milestone.',
    http: { method: 'delete', path: '/milestones/{id}' },
    input: IdInput,
    output: Ok,
  }),

  // Learning ----------------------------------------------------------------
  add_roadmap: op({
    class: 'additive',
    summary: 'Add a learning roadmap, optionally with ordered steps.',
    http: { method: 'post', path: '/roadmaps' },
    input: z.object({
      title: Title,
      subtitle: z.string().trim().max(300).optional(),
      steps: z.array(StepDraft).max(100).optional(),
    }),
    output: RoadmapView,
  }),
  rename_roadmap: op({
    class: 'additive',
    summary: 'Rename one roadmap.',
    http: { method: 'post', path: '/roadmaps/{id}/rename' },
    input: z.object({ id: Id, title: Title }),
    output: Roadmap,
  }),
  delete_roadmap: op({
    class: 'bulk_or_destructive',
    summary: 'Delete a roadmap and its steps.',
    http: { method: 'delete', path: '/roadmaps/{id}' },
    input: IdInput,
    output: Ok,
  }),
  add_roadmap_step: op({
    class: 'additive',
    summary: 'Add a step to the end of a roadmap.',
    http: { method: 'post', path: '/roadmaps/{roadmap_id}/steps' },
    input: z.object({
      roadmap_id: Id,
      title: Title,
      est_minutes: z.number().int().positive().max(1440).optional(),
    }),
    output: RoadmapStep,
  }),
  update_roadmap_step: op({
    class: 'additive',
    summary:
      'Update a roadmap milestone, its description, progress notes or completion. Linked tasks follow completion changes.',
    http: { method: 'post', path: '/steps/{id}/update' },
    input: z.object({
      id: Id,
      title: Title.optional(),
      description: z.string().max(10000).optional(),
      notes: z.string().max(20000).optional(),
      status: z.enum(['todo', 'done']).optional(),
    }),
    output: RoadmapStep,
  }),
  step_to_today: op({
    class: 'additive',
    summary: "Put a roadmap step in Today as a linked task. It's a no-op if it is already there.",
    http: { method: 'post', path: '/steps/{id}/to-today' },
    input: IdInput,
    output: Task,
  }),
  delete_roadmap_step: op({
    class: 'bulk_or_destructive',
    summary: 'Delete one roadmap step.',
    http: { method: 'delete', path: '/steps/{id}' },
    input: IdInput,
    output: Ok,
  }),

  // Reminders ---------------------------------------------------------------
  set_reminder: op({
    class: 'additive',
    summary: 'Add a reminder at a local time on some weekdays.',
    http: { method: 'post', path: '/reminders' },
    input: z.object({
      label: Title,
      kind: ReminderKind,
      time_local: TimeLocal,
      weekdays: Weekdays.refine((v) => v > 0, 'Pick at least one weekday'),
      once: z.boolean().optional().describe('Fire one time, then turn off'),
    }),
    output: Reminder,
  }),
  snooze_reminder: op({
    class: 'additive',
    summary: 'Snooze one reminder until a given time (epoch ms).',
    http: { method: 'post', path: '/reminders/{id}/snooze' },
    input: z.object({ id: Id, until: z.number().int().positive() }),
    output: Reminder,
  }),
  set_reminder_enabled: op({
    class: 'additive',
    summary: 'Turn one reminder on or off.',
    http: { method: 'post', path: '/reminders/{id}/enabled' },
    input: z.object({ id: Id, enabled: z.boolean() }),
    output: Reminder,
  }),
  delete_reminder: op({
    class: 'bulk_or_destructive',
    summary: 'Delete one reminder.',
    http: { method: 'delete', path: '/reminders/{id}' },
    input: IdInput,
    output: Ok,
  }),

  // Day state ---------------------------------------------------------------
  set_quiet_mode: op({
    class: 'additive',
    summary: 'Turn quiet mode on or off. On lasts until 04:00 the next day.',
    http: { method: 'post', path: '/quiet-mode' },
    input: z.object({ on: z.boolean() }),
    output: z.object({ quiet_mode: z.boolean() }),
  }),

  // Proposals and undo ------------------------------------------------------
  propose_changes: op({
    class: 'proposal',
    summary:
      'Propose bulk moves, edits of several items, or any delete. Nothing changes until the user confirms.',
    http: { method: 'post', path: '/proposals' },
    input: z.object({
      summary: z.string().trim().min(1).max(300),
      ops: z.array(ProposedOp).min(1).max(100),
    }),
    output: Proposal,
  }),
  confirm_proposal: op({
    class: 'system',
    userOnly: true,
    summary: 'Apply a pending proposal.',
    http: { method: 'post', path: '/proposals/{id}/confirm' },
    input: IdInput,
    output: Rejected,
  }),
  reject_proposal: op({
    class: 'system',
    userOnly: true,
    summary: 'Decline a pending proposal.',
    http: { method: 'post', path: '/proposals/{id}/reject' },
    input: IdInput,
    output: Rejected,
  }),
  undo: op({
    class: 'system',
    userOnly: true,
    summary: 'Revert a change within 30 seconds of it applying.',
    http: { method: 'post', path: '/undo/{change_id}' },
    input: z.object({ change_id: Id }),
    output: UndoResult,
  }),

  // Sirius chat -------------------------------------------------------------
  get_agents: op({
    class: 'system',
    summary: 'Agent availability, status and model selection.',
    http: { method: 'get', path: '/agents' },
    input: NoInput,
    output: AgentsView,
  }),
  select_agent: op({
    class: 'system',
    userOnly: true,
    summary: 'Pick the active agent and, optionally, its model.',
    http: { method: 'post', path: '/agents/select' },
    input: z.object({ agent: AgentId, model: z.string().min(1).optional() }),
    output: AgentsView,
  }),
  get_conversation: op({
    class: 'system',
    summary: 'The current conversation and its messages.',
    http: { method: 'get', path: '/conversation' },
    input: NoInput,
    output: ConversationView,
  }),
  new_conversation: op({
    class: 'system',
    userOnly: true,
    summary: 'Start a new conversation, clearing context.',
    http: { method: 'post', path: '/conversations' },
    input: NoInput,
    output: ConversationView,
  }),
  send_chat: op({
    class: 'system',
    userOnly: true,
    summary: 'Start or continue a turn. The reply streams over /v1/events.',
    http: { method: 'post', path: '/chat' },
    input: SendChatInput,
    output: SendChatResult,
  }),
  start_phone_pairing: op({
    class: 'system',
    userOnly: true,
    summary: 'Show a one-time code that lets a phone pair with this laptop.',
    http: { method: 'post', path: '/phones/pairing' },
    input: NoInput,
    output: z.object({ code: z.string(), expires_at: z.number() }),
  }),
  forget_phones: op({
    class: 'system',
    userOnly: true,
    summary: 'Sign out every paired phone.',
    http: { method: 'post', path: '/phones/forget' },
    input: NoInput,
    output: z.object({ forgotten: z.number() }),
  }),
  set_appearance: op({
    class: 'system',
    agentTool: true,
    summary:
      'Change the colour theme, which the wolf takes its colours from. Themes: paper, midnight (Midnight Blue), night-owl (Night Owl, Ubuntu font), graphite, sage, ember.',
    http: { method: 'post', path: '/appearance' },
    // No theme just reports the current one.
    input: z.object({ theme: ThemeId.optional() }),
    output: z.object({ theme: ThemeId }),
  }),
  remember: op({
    class: 'system',
    agentTool: true,
    summary: 'Keep one lasting fact about the person, for every future session and agent.',
    http: { method: 'post', path: '/memory' },
    input: z.object({ fact: z.string().trim().min(1).max(300) }),
    output: z.object({ saved: z.boolean() }),
  }),
  cancel_chat: op({
    class: 'system',
    userOnly: true,
    summary: 'Cancel the running turn.',
    http: { method: 'post', path: '/chat/{turn_id}/cancel' },
    input: z.object({ turn_id: z.string().min(1) }),
    output: Ok,
  }),

  // Agent attention ---------------------------------------------------------
  post_agent_event: op({
    class: 'system',
    summary: 'Record that an agent elsewhere on the machine needs attention.',
    http: { method: 'post', path: '/agent-events' },
    input: z.object({
      source: AgentId,
      kind: AgentEventKind,
      project: z.string().trim().max(200).optional(),
      message: z.string().trim().max(500).optional(),
      /** Desktop app id of the terminal the agent runs in, so the alert can focus it. */
      terminal: z
        .string()
        .regex(/^[\w.-]{1,100}$/)
        .optional(),
    }),
    output: AgentEvent,
  }),
  resolve_agent_events: op({
    class: 'system',
    summary:
      'An agent elsewhere is no longer waiting, for example because a permission was answered.',
    http: { method: 'post', path: '/agent-events/resolve' },
    input: z.object({
      source: AgentId,
      project: z.string().trim().max(200).optional(),
    }),
    output: z.object({ resolved: z.number().int() }),
  }),
  post_agent_activity: op({
    class: 'system',
    summary:
      'An agent session in any terminal is working (a prompt or a tool) or has stopped. Shown as its status.',
    http: { method: 'post', path: '/agent-activity' },
    input: z.object({
      source: AgentId,
      project: z.string().trim().max(200).optional(),
      working: z.boolean(),
    }),
    output: Ok,
  }),
  list_agent_events: op({
    class: 'system',
    summary: 'Agent events that have not been acknowledged.',
    http: { method: 'get', path: '/agent-events' },
    input: NoInput,
    output: z.array(AgentEvent),
  }),
  ack_agent_event: op({
    class: 'system',
    userOnly: true,
    summary: 'Acknowledge an agent event ("Got it").',
    http: { method: 'post', path: '/agent-events/{id}/ack' },
    input: IdInput,
    output: AgentEvent,
  }),

  // Voice -------------------------------------------------------------------
  voice_utterance: op({
    class: 'system',
    summary: 'Route a final transcript to the fast path or an agent turn.',
    http: { method: 'post', path: '/voice/utterance' },
    input: VoiceUtteranceInput,
    output: VoiceUtteranceResult,
  }),
  set_voice_state: op({
    class: 'system',
    summary: 'Report what the voice service is doing. Drives the avatar.',
    http: { method: 'post', path: '/voice/state' },
    input: VoiceStateView,
    output: Ok,
  }),
  get_voice_state: op({
    class: 'system',
    summary: 'What the voice service is doing.',
    http: { method: 'get', path: '/voice/state' },
    input: NoInput,
    output: VoiceStateView,
  }),
  voice_ptt: op({
    class: 'system',
    userOnly: true,
    summary: 'Push-to-talk: start listening, or stop if already listening.',
    http: { method: 'post', path: '/voice/ptt' },
    input: NoInput,
    output: Ok,
  }),
  voice_stop: op({
    class: 'system',
    userOnly: true,
    summary: 'Abort listening or speaking (Esc).',
    http: { method: 'post', path: '/voice/stop' },
    input: NoInput,
    output: Ok,
  }),
  create_backup: op({
    class: 'system',
    userOnly: true,
    summary: 'Take a database snapshot now.',
    http: { method: 'post', path: '/backups' },
    input: NoInput,
    output: z.object({ path: z.string() }),
  }),
  get_settings: op({
    class: 'system',
    summary: 'All settings.',
    http: { method: 'get', path: '/settings' },
    input: NoInput,
    output: z.record(z.string(), z.unknown()),
  }),
  set_setting: op({
    class: 'system',
    userOnly: true,
    summary: 'Change one setting.',
    http: { method: 'post', path: '/settings/{key}' },
    input: z.object({ key: z.string().min(1).max(100), value: z.unknown() }),
    output: Ok,
  }),
} as const;

export type Ops = typeof ops;
export type OpName = keyof Ops;
export type OpInput<N extends OpName> = z.input<Ops[N]['input']>;
export type OpOutput<N extends OpName> = z.output<Ops[N]['output']>;

export const opNames = Object.keys(ops) as OpName[];

export function isOpName(name: string): name is OpName {
  return Object.hasOwn(ops, name);
}

/** Operations an agent may place inside `propose_changes`. */
export function isProposable(name: string): name is OpName {
  if (!isOpName(name)) return false;
  const def = ops[name] as OpDefinition;
  return (def.class === 'additive' || def.class === 'bulk_or_destructive') && !def.userOnly;
}

/** Operations an agent may call directly as MCP tools. */
export function isAgentTool(name: OpName): boolean {
  const def = ops[name] as OpDefinition;
  return (
    !def.userOnly &&
    (def.class === 'read' ||
      def.class === 'additive' ||
      def.class === 'proposal' ||
      def.agentTool === true)
  );
}
