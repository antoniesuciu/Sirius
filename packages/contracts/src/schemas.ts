/**
 * Domain schemas shared by the UI, core, MCP adapter and CLI.
 *
 * Field names are snake_case on purpose: they match the columns in spec section 6,
 * so a row, its JSON form and its change-log payload all look the same.
 */
import { z } from 'zod';

// Scalars ---------------------------------------------------------------------

export const Id = z.string().min(1).describe('Row id (UUIDv7)');
export const EpochMs = z.number().int().nonnegative();
export const LocalDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD')
  .describe('Calendar date, YYYY-MM-DD');
export const TimeLocal = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Expected HH:MM')
  .describe('Local time, HH:MM');
/** Bit 0 is Monday, bit 6 is Sunday. */
export const Weekdays = z
  .number()
  .int()
  .min(0)
  .max(127)
  .describe('Bitmask: bit 0 Monday … bit 6 Sunday');
const Title = z.string().trim().min(1).max(500);

// Enums -----------------------------------------------------------------------

export const TaskTier = z.enum(['priority', 'small']);
export const TaskStatus = z.enum(['open', 'done', 'dropped']);
export const TaskSource = z.enum(['user', 'sirius', 'mcp', 'roadmap']);
export const GoalStatus = z.enum(['active', 'paused', 'done']);
export const RoadmapStatus = z.enum(['active', 'later', 'done']);
export const StepStatus = z.enum(['todo', 'done']);
export const ReminderKind = z.enum(['prayer', 'wellbeing', 'custom']);
export const AgentId = z.enum(['claude', 'codex']);
export const AgentEventKind = z.enum(['needs_input', 'turn_complete', 'error']);
export const ProposalStatus = z.enum(['pending', 'applied', 'rejected', 'expired']);
export const MessageRole = z.enum(['user', 'assistant', 'tool']);
export const ChangeOp = z.enum(['create', 'update', 'delete']);
export const VoiceRoute = z.enum(['fast_path', 'agent']);
export const VoiceState = z.enum(['idle', 'listening', 'thinking', 'speaking']);
/** Who caused a change. `system` is the scheduler (rollover and expiry). */
export const Actor = z.enum(['user', 'claude', 'codex', 'system']);
/** Which surface a request came through. Drives `tasks.source`. */
export const Via = z.enum(['ui', 'chat', 'mcp', 'voice', 'system']);

export type TaskTier = z.infer<typeof TaskTier>;
export type TaskStatus = z.infer<typeof TaskStatus>;
export type TaskSource = z.infer<typeof TaskSource>;
export type GoalStatus = z.infer<typeof GoalStatus>;
export type RoadmapStatus = z.infer<typeof RoadmapStatus>;
export type StepStatus = z.infer<typeof StepStatus>;
export type ReminderKind = z.infer<typeof ReminderKind>;
export type AgentId = z.infer<typeof AgentId>;
export type AgentEventKind = z.infer<typeof AgentEventKind>;
export type ProposalStatus = z.infer<typeof ProposalStatus>;
export type MessageRole = z.infer<typeof MessageRole>;
export type ChangeOp = z.infer<typeof ChangeOp>;
export type VoiceRoute = z.infer<typeof VoiceRoute>;
export type VoiceState = z.infer<typeof VoiceState>;
export type Actor = z.infer<typeof Actor>;
export type Via = z.infer<typeof Via>;

// Rows ------------------------------------------------------------------------

/** ADR-3: every row carries these. */
const Common = {
  id: Id,
  created_at: EpochMs,
  updated_at: EpochMs,
  deleted_at: EpochMs.nullable(),
  rev: z.number().int(),
};

export const Task = z.object({
  ...Common,
  title: z.string(),
  tier: TaskTier,
  scheduled_for: LocalDate,
  status: TaskStatus,
  position: z.number().int(),
  completed_at: EpochMs.nullable(),
  source: TaskSource,
  roadmap_step_id: Id.nullable(),
});
export type Task = z.infer<typeof Task>;

export const Goal = z.object({
  ...Common,
  title: z.string(),
  horizon_text: z.string().nullable(),
  target_date: LocalDate.nullable(),
  status: GoalStatus,
  position: z.number().int(),
});
export type Goal = z.infer<typeof Goal>;

export const Milestone = z.object({
  ...Common,
  goal_id: Id,
  title: z.string(),
  position: z.number().int(),
  done_at: EpochMs.nullable(),
});
export type Milestone = z.infer<typeof Milestone>;

export const Roadmap = z.object({
  ...Common,
  title: z.string(),
  subtitle: z.string().nullable(),
  status: RoadmapStatus,
  position: z.number().int(),
});
export type Roadmap = z.infer<typeof Roadmap>;

export const RoadmapStep = z.object({
  ...Common,
  roadmap_id: Id,
  title: z.string(),
  est_minutes: z.number().int().nullable(),
  position: z.number().int(),
  status: StepStatus,
  done_at: EpochMs.nullable(),
});
export type RoadmapStep = z.infer<typeof RoadmapStep>;

export const Reminder = z.object({
  ...Common,
  kind: ReminderKind,
  label: z.string(),
  time_local: TimeLocal,
  weekdays: Weekdays,
  enabled: z.boolean(),
  snoozed_until: EpochMs.nullable(),
  /** Date the reminder last fired on, so a restart inside the same minute cannot double-fire. */
  last_fired_on: LocalDate.nullable(),
});
export type Reminder = z.infer<typeof Reminder>;

export const ProposedOp = z.object({
  op: z.string().describe('Name of a mutating operation, for example reschedule_tasks'),
  input: z.record(z.string(), z.unknown()).describe('Input for that operation'),
});
export type ProposedOp = z.infer<typeof ProposedOp>;

export const Proposal = z.object({
  ...Common,
  actor: AgentId,
  summary: z.string(),
  ops: z.array(ProposedOp),
  status: ProposalStatus,
  decided_at: EpochMs.nullable(),
  expires_at: EpochMs,
});
export type Proposal = z.infer<typeof Proposal>;

export const AgentEvent = z.object({
  ...Common,
  source: AgentId,
  kind: AgentEventKind,
  project: z.string().nullable(),
  message: z.string().nullable(),
  acknowledged_at: EpochMs.nullable(),
});
export type AgentEvent = z.infer<typeof AgentEvent>;

export const Conversation = z.object({
  ...Common,
  agent: AgentId,
  model: z.string(),
  cli_session_id: z.string().nullable(),
  title: z.string().nullable(),
});
export type Conversation = z.infer<typeof Conversation>;

export const Message = z.object({
  ...Common,
  conversation_id: Id,
  role: MessageRole,
  text: z.string(),
  meta: z.record(z.string(), z.unknown()).nullable(),
});
export type Message = z.infer<typeof Message>;

// Read models -----------------------------------------------------------------

export const ReminderView = Reminder.extend({
  next_fire_at: EpochMs.nullable().describe('When it next fires, or null if it never will'),
});
export type ReminderView = z.infer<typeof ReminderView>;

export const TodayView = z.object({
  date: LocalDate.describe('Logical date: the day rolls over at 04:00 local'),
  tasks: z.array(Task),
  quiet_mode: z.boolean(),
  next_reminder: ReminderView.nullable(),
  resting_tomorrow: z.number().int().describe('Open tasks scheduled for tomorrow'),
});
export type TodayView = z.infer<typeof TodayView>;

export const GoalView = Goal.extend({ milestones: z.array(Milestone) });
export type GoalView = z.infer<typeof GoalView>;

export const RoadmapView = Roadmap.extend({ steps: z.array(RoadmapStep) });
export type RoadmapView = z.infer<typeof RoadmapView>;

export const AgentStatusValue = z.enum(['idle', 'working', 'waiting', 'resting', 'unavailable']);
export type AgentStatusValue = z.infer<typeof AgentStatusValue>;

export const AgentInfo = z.object({
  id: AgentId,
  label: z.string(),
  model: z.string(),
  models: z.array(z.object({ id: z.string(), label: z.string() })),
  status: AgentStatusValue,
  reason: z.string().nullable().describe('One calm sentence when the agent is unavailable'),
});
export type AgentInfo = z.infer<typeof AgentInfo>;

export const AgentsView = z.object({ selected: AgentId, agents: z.array(AgentInfo) });
export type AgentsView = z.infer<typeof AgentsView>;

export const ConversationView = z.object({
  conversation: Conversation.nullable(),
  messages: z.array(Message),
  active_turn_id: z.string().nullable(),
});
export type ConversationView = z.infer<typeof ConversationView>;

// Inputs that several operations share ----------------------------------------

export const IdInput = z.object({ id: Id });

export const MilestoneDraft = z.object({ title: Title });
export const StepDraft = z.object({
  title: Title,
  est_minutes: z.number().int().positive().max(1440).optional(),
});

export const AddTaskInput = z.object({
  title: Title,
  tier: TaskTier.optional().describe('Defaults to small'),
  date: LocalDate.optional().describe('Defaults to today'),
});

export { Title };
