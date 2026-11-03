/**
 * Everything that flows over `GET /v1/events` (ADR-4).
 *
 * `change` drives React Query invalidation. `chat` carries the streaming reply.
 * `agent` and `voice` drive the toast and the avatar.
 */
import { z } from 'zod';
import { VoiceStateView } from './ops.ts';
import { Actor, AgentEvent, AgentId, ChangeOp, Id } from './schemas.ts';

export const EntityName = z.enum([
  'tasks',
  'goals',
  'milestones',
  'roadmaps',
  'roadmap_steps',
  'reminders',
  'list_items',
  'day_state',
  'proposals',
  'agent_events',
  'conversations',
  'messages',
  'voice_turns',
  'settings',
]);
export type EntityName = z.infer<typeof EntityName>;

export const ChangeEvent = z.object({
  type: z.literal('change'),
  entity: EntityName,
  id: Id,
  op: ChangeOp,
  rev: z.number().int(),
  actor: Actor,
  /** Pass to `undo` to revert the whole batch this row belongs to. */
  change_id: Id,
});

export const ChatEvent = z.discriminatedUnion('kind', [
  z.object({
    type: z.literal('chat'),
    kind: z.literal('start'),
    turn_id: z.string(),
    agent: AgentId,
  }),
  z.object({
    type: z.literal('chat'),
    kind: z.literal('text'),
    turn_id: z.string(),
    delta: z.string(),
  }),
  z.object({
    type: z.literal('chat'),
    kind: z.literal('tool'),
    turn_id: z.string(),
    name: z.string(),
  }),
  z.object({ type: z.literal('chat'), kind: z.literal('done'), turn_id: z.string() }),
  z.object({
    type: z.literal('chat'),
    kind: z.literal('error'),
    turn_id: z.string(),
    message: z.string(),
  }),
]);

export const AgentAttentionEvent = z.object({
  type: z.literal('agent'),
  event: AgentEvent,
});

export const QueueReleasedEvent = z.object({
  type: z.literal('agent_queue_released'),
  events: z.array(AgentEvent),
});

export const VoiceEvent = z.object({
  type: z.literal('voice'),
  state: VoiceStateView,
});

/** Spoken by the voice service; also what makes the UI start breathing on command. */
export const VoiceReplyEvent = z.object({
  type: z.literal('voice_reply'),
  turn_id: z.string(),
  text: z.string(),
  lang: z.string(),
  final: z.boolean(),
});

/** Tells the voice service what to do. PTT arrives at the core, not at the service. */
export const VoiceCommandEvent = z.object({
  type: z.literal('voice_command'),
  command: z.enum(['ptt', 'stop']),
});

/** The logical day turned over at 04:00. Everything keyed to "today" is out of date. */
export const DayChangedEvent = z.object({ type: z.literal('day_changed'), date: z.string() });

export const UiActionEvent = z.object({
  type: z.literal('ui_action'),
  action: z.enum(['start_breathing']),
});

export const SiriusEvent = z.union([
  ChangeEvent,
  ChatEvent,
  AgentAttentionEvent,
  QueueReleasedEvent,
  VoiceEvent,
  VoiceReplyEvent,
  VoiceCommandEvent,
  DayChangedEvent,
  UiActionEvent,
]);
export type SiriusEvent = z.infer<typeof SiriusEvent>;
export type ChangeEvent = z.infer<typeof ChangeEvent>;
export type ChatEvent = z.infer<typeof ChatEvent>;

/**
 * Whether a change is worth offering Undo for (F20): something an agent actually did. A
 * proposal row is only a question, and undo skips proposals, so offering it would do nothing.
 */
export function isUndoableChange(event: ChangeEvent): boolean {
  return (event.actor === 'claude' || event.actor === 'codex') && event.entity !== 'proposals';
}
