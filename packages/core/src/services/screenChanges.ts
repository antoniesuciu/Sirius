/**
 * What the person changed on the dashboard themselves since the agent last replied. A CLI
 * session only knows what it said and did, so without this it reports stale state as fact,
 * such as a proposal "still waiting" that was confirmed on the screen minutes earlier.
 */
import { and, asc, eq, gt } from 'drizzle-orm';
import { change_log } from '../db/schema.ts';
import type { Store } from '../store.ts';

type Row = Record<string, unknown> | null;

const NOUNS: Record<string, string> = {
  tasks: 'task',
  goals: 'goal',
  milestones: 'milestone',
  roadmaps: 'roadmap',
  roadmap_steps: 'step',
  reminders: 'reminder',
  list_items: 'item on the list',
};
/** Enough to set the agent straight without swamping a prompt. */
const MAX_LINES = 8;

function nameOf(row: Row): string {
  const name = row?.title ?? row?.text ?? row?.label ?? row?.summary;
  return typeof name === 'string' ? `“${name}”` : '';
}

export function describeChange(entity: string, op: string, before: Row, after: Row): string | null {
  if (entity === 'proposals') {
    if (before?.status !== 'pending') return null;
    if (after?.status === 'applied') return `confirmed your proposal ${nameOf(after)}`;
    if (after?.status === 'rejected') return `turned down your proposal ${nameOf(after)}`;
    return null;
  }
  if (entity === 'day_state' && before?.quiet_mode !== after?.quiet_mode) {
    return after?.quiet_mode ? 'turned quiet mode on' : 'turned quiet mode off';
  }
  const noun = NOUNS[entity];
  if (!noun) return null;
  const name = nameOf(after ?? before);
  if (op === 'create') return `added the ${noun} ${name}`;
  if (after?.deleted_at && !before?.deleted_at) return `deleted the ${noun} ${name}`;
  if (after?.status === 'done' && before?.status !== 'done') return `completed the ${noun} ${name}`;
  if (after?.done_at && !before?.done_at) return `ticked off the ${noun} ${name}`;
  return `changed the ${noun} ${name}`;
}

export function screenChangesSince(store: Store, since: number): string[] {
  const rows = store.db
    .select()
    .from(change_log)
    .where(and(eq(change_log.actor, 'user'), gt(change_log.at, since)))
    .orderBy(asc(change_log.at))
    .all();
  const lines = rows
    .map((r) => describeChange(r.entity, r.op, r.payload.before, r.payload.after))
    .filter((line): line is string => line !== null)
    .map((line) => line.trim());
  const unique = [...new Set(lines)];
  return unique.length > MAX_LINES
    ? [...unique.slice(-MAX_LINES), `and ${unique.length - MAX_LINES} earlier changes`]
    : unique;
}
