import { nextOccurrence, type ReminderView } from '@sirius/contracts';
import { isNull } from 'drizzle-orm';
import { reminders } from '../db/schema.ts';
import type { Row } from '../store.ts';
import type { Handlers, OpContext } from './context.ts';

export function toView(reminder: Row<'reminders'>, ctx: OpContext): ReminderView {
  const { snoozed_until: snoozed, enabled, time_local, weekdays } = reminder;
  const pending = snoozed !== null && snoozed > ctx.tx.now;
  const regular = nextOccurrence(time_local, weekdays, ctx.tx.now, ctx.timeZone);
  return {
    ...reminder,
    next_fire_at: !enabled ? null : pending ? snoozed : regular,
  };
}

export function allReminders(ctx: OpContext): ReminderView[] {
  return ctx.tx.db
    .select()
    .from(reminders)
    .where(isNull(reminders.deleted_at))
    .orderBy(reminders.time_local)
    .all()
    .map((r) => toView(r, ctx));
}

export const reminderHandlers: Handlers<
  'list_reminders' | 'set_reminder' | 'snooze_reminder' | 'set_reminder_enabled' | 'delete_reminder'
> = {
  list_reminders: (_input, ctx) => allReminders(ctx),

  set_reminder({ label, kind, time_local, weekdays, once }, ctx) {
    return ctx.tx.insert('reminders', {
      label,
      kind,
      time_local,
      weekdays,
      enabled: true,
      once: once ?? false,
    });
  },

  snooze_reminder({ id, until }, ctx) {
    return ctx.tx.update('reminders', id, { snoozed_until: until });
  },

  set_reminder_enabled({ id, enabled }, ctx) {
    return ctx.tx.update('reminders', id, {
      enabled,
      ...(enabled ? {} : { snoozed_until: null }),
    });
  },

  delete_reminder({ id }, ctx) {
    ctx.tx.softDelete('reminders', id);
    return { ok: true };
  },
};
