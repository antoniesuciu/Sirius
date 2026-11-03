/** The schedule (F37): fixed commitments, kept apart from today's tasks. */
import { occurrencesOn, type ScheduleEvent, type ScheduleOccurrence } from '@sirius/contracts';
import { isNull } from 'drizzle-orm';
import { schedule_events } from '../db/schema.ts';
import { DomainError, notFound } from '../errors.ts';
import type { Handlers, OpContext } from './context.ts';

const invalid = (message: string) => new DomainError(400, 'invalid_schedule', message);

export function allScheduleEvents(ctx: OpContext): ScheduleEvent[] {
  return ctx.tx.db
    .select()
    .from(schedule_events)
    .where(isNull(schedule_events.deleted_at))
    .orderBy(schedule_events.start_local)
    .all();
}

export function scheduleOn(ctx: OpContext, date: string): ScheduleOccurrence[] {
  return occurrencesOn(allScheduleEvents(ctx), date);
}

/** Weekly or once, never both or neither, and an end that comes after the start. */
function check(
  event: Pick<
    ScheduleEvent,
    'weekdays' | 'date' | 'start_local' | 'end_local' | 'starts_on' | 'ends_on'
  >,
) {
  if (event.weekdays > 0 === (event.date !== null)) {
    throw invalid('Give weekdays for a weekly event, or a date for a one-off, not both.');
  }
  if (event.end_local !== null && event.end_local <= event.start_local) {
    throw invalid('The end time has to be after the start time.');
  }
  if (event.starts_on && event.ends_on && event.ends_on < event.starts_on) {
    throw invalid('The schedule cannot end before it starts.');
  }
}

export const scheduleHandlers: Handlers<
  'list_schedule' | 'add_schedule_event' | 'update_schedule_event' | 'delete_schedule_event'
> = {
  list_schedule: (_input, ctx) => allScheduleEvents(ctx),

  add_schedule_event(input, ctx) {
    const event = {
      title: input.title,
      location: input.location || null,
      weekdays: input.weekdays ?? 0,
      date: input.date ?? null,
      start_local: input.start_local,
      end_local: input.end_local ?? null,
      starts_on: input.starts_on ?? null,
      ends_on: input.ends_on ?? null,
    };
    check(event);
    return ctx.tx.insert('schedule_events', event);
  },

  update_schedule_event({ id, ...patch }, ctx) {
    const current = ctx.tx.peek('schedule_events', id);
    if (!current || current.deleted_at !== null) throw notFound('Schedule event');
    const changes = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
    check({ ...current, ...changes });
    return ctx.tx.update('schedule_events', id, changes);
  },

  delete_schedule_event({ id }, ctx) {
    const current = ctx.tx.peek('schedule_events', id);
    if (!current || current.deleted_at !== null) throw notFound('Schedule event');
    ctx.tx.softDelete('schedule_events', id);
    return { ok: true };
  },
};
