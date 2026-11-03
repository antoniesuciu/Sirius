/** Drizzle schema: spec section 6, with the ADR-3 conventions on every row. */
import type { ProposedOp } from '@sirius/contracts';
import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

const stamps = () => ({
  created_at: integer('created_at').notNull(),
  updated_at: integer('updated_at').notNull(),
  deleted_at: integer('deleted_at'),
  rev: integer('rev').notNull().default(1),
});

const common = () => ({ id: text('id').primaryKey(), ...stamps() });

const json = <T>(name: string) => text(name, { mode: 'json' }).$type<T>();

export const tasks = sqliteTable(
  'tasks',
  {
    ...common(),
    title: text('title').notNull(),
    tier: text('tier', { enum: ['priority', 'small'] }).notNull(),
    scheduled_for: text('scheduled_for').notNull(),
    status: text('status', { enum: ['open', 'done', 'dropped'] }).notNull(),
    position: integer('position').notNull(),
    completed_at: integer('completed_at'),
    source: text('source', { enum: ['user', 'sirius', 'mcp', 'roadmap'] }).notNull(),
    roadmap_step_id: text('roadmap_step_id'),
  },
  (t) => [index('tasks_scheduled_for').on(t.scheduled_for)],
);

export const goals = sqliteTable('goals', {
  ...common(),
  title: text('title').notNull(),
  horizon_text: text('horizon_text'),
  target_date: text('target_date'),
  status: text('status', { enum: ['active', 'paused', 'done'] }).notNull(),
  position: integer('position').notNull(),
});

export const milestones = sqliteTable(
  'milestones',
  {
    ...common(),
    goal_id: text('goal_id').notNull(),
    title: text('title').notNull(),
    position: integer('position').notNull(),
    done_at: integer('done_at'),
  },
  (t) => [index('milestones_goal').on(t.goal_id)],
);

export const roadmaps = sqliteTable('roadmaps', {
  ...common(),
  title: text('title').notNull(),
  subtitle: text('subtitle'),
  status: text('status', { enum: ['active', 'later', 'done'] }).notNull(),
  position: integer('position').notNull(),
});

export const roadmap_steps = sqliteTable(
  'roadmap_steps',
  {
    ...common(),
    roadmap_id: text('roadmap_id').notNull(),
    title: text('title').notNull(),
    est_minutes: integer('est_minutes'),
    position: integer('position').notNull(),
    status: text('status', { enum: ['todo', 'done'] }).notNull(),
    done_at: integer('done_at'),
  },
  (t) => [index('roadmap_steps_roadmap').on(t.roadmap_id)],
);

export const reminders = sqliteTable('reminders', {
  ...common(),
  kind: text('kind', { enum: ['prayer', 'wellbeing', 'custom'] }).notNull(),
  label: text('label').notNull(),
  time_local: text('time_local').notNull(),
  weekdays: integer('weekdays').notNull(),
  enabled: integer('enabled', { mode: 'boolean' }).notNull(),
  /** Fires one time and then turns itself off. "Remind me at 5" is not a weekly habit. */
  once: integer('once', { mode: 'boolean' }).notNull().default(false),
  snoozed_until: integer('snoozed_until'),
  last_fired_on: text('last_fired_on'),
});

export const schedule_events = sqliteTable('schedule_events', {
  ...common(),
  title: text('title').notNull(),
  location: text('location'),
  weekdays: integer('weekdays').notNull(),
  date: text('date'),
  start_local: text('start_local').notNull(),
  end_local: text('end_local'),
  starts_on: text('starts_on'),
  ends_on: text('ends_on'),
});

export const list_items = sqliteTable('list_items', {
  ...common(),
  text: text('text').notNull(),
  done_at: integer('done_at'),
});

export const day_state = sqliteTable('day_state', {
  date: text('date').primaryKey(),
  ...stamps(),
  quiet_mode: integer('quiet_mode', { mode: 'boolean' }).notNull(),
  quiet_since: integer('quiet_since'),
});

export const proposals = sqliteTable('proposals', {
  ...common(),
  actor: text('actor', { enum: ['claude', 'codex'] }).notNull(),
  summary: text('summary').notNull(),
  ops: json<ProposedOp[]>('ops').notNull(),
  status: text('status', { enum: ['pending', 'applied', 'rejected', 'expired'] }).notNull(),
  decided_at: integer('decided_at'),
  expires_at: integer('expires_at').notNull(),
});

export const agent_events = sqliteTable('agent_events', {
  ...common(),
  source: text('source', { enum: ['claude', 'codex'] }).notNull(),
  kind: text('kind', { enum: ['needs_input', 'turn_complete', 'error'] }).notNull(),
  project: text('project'),
  message: text('message'),
  acknowledged_at: integer('acknowledged_at'),
});

export const conversations = sqliteTable('conversations', {
  ...common(),
  agent: text('agent', { enum: ['claude', 'codex'] }).notNull(),
  model: text('model').notNull(),
  cli_session_id: text('cli_session_id'),
  /** Turns on the current CLI session. Long sessions cost usage, so they are replaced. */
  session_turns: integer('session_turns').notNull().default(0),
  title: text('title'),
});

export const messages = sqliteTable(
  'messages',
  {
    ...common(),
    conversation_id: text('conversation_id').notNull(),
    role: text('role', { enum: ['user', 'assistant', 'tool'] }).notNull(),
    text: text('text').notNull(),
    meta: json<Record<string, unknown>>('meta'),
  },
  (t) => [index('messages_conversation').on(t.conversation_id)],
);

export const voice_turns = sqliteTable('voice_turns', {
  ...common(),
  conversation_id: text('conversation_id'),
  lang: text('lang').notNull(),
  transcript: text('transcript').notNull(),
  route: text('route', { enum: ['fast_path', 'agent'] }).notNull(),
  intent: text('intent'),
  latency_ms: json<Record<string, number>>('latency_ms'),
});

export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  ...stamps(),
  value: json<unknown>('value'),
});

export const change_log = sqliteTable(
  'change_log',
  {
    id: text('id').primaryKey(),
    /** All rows written by one operation, so undo can revert it as a unit. */
    batch_id: text('batch_id').notNull(),
    entity: text('entity').notNull(),
    entity_id: text('entity_id').notNull(),
    op: text('op', { enum: ['create', 'update', 'delete'] }).notNull(),
    actor: text('actor', { enum: ['user', 'claude', 'codex', 'system'] }).notNull(),
    payload: json<{ before: Record<string, unknown> | null; after: Record<string, unknown> }>(
      'payload',
    ).notNull(),
    at: integer('at').notNull(),
  },
  (t) => [index('change_log_batch').on(t.batch_id), index('change_log_at').on(t.at)],
);
