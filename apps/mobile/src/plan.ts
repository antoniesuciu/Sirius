/**
 * Which notifications the phone schedules for itself, so reminders and the schedule still
 * arrive while the laptop is off. Pure: the same rules as the laptop's Scheduler, from the
 * data the core already sends. No React Native here, so it is tested with bun.
 */
import {
  addDays,
  formatDate,
  localParts,
  logicalDate,
  occurrencesOn,
  REMIND_BEFORE_MIN,
  type ReminderView,
  type ScheduleEvent,
  weekdayOf,
  zonedInstant,
} from '@sirius/contracts';

export interface Planned {
  /** Stable, so a reschedule replaces rather than duplicates. */
  id: string;
  at: number;
  title: string;
  body: string;
  /** The phone tab a tap opens. */
  tab: 'today' | 'list';
}

export interface PlanInput {
  reminders: ReminderView[];
  schedule: ScheduleEvent[];
  now: number;
  timeZone: string;
  /** Quiet mode holds everything until the day rolls over (04:00). */
  quietToday: boolean;
  days?: number;
}

/** Android keeps at most 500 alarms per app; a week ahead is far below that. */
const MAX = 64;

/** The laptop's Scheduler counts reminders and the schedule by calendar day, not logical day. */
function calendarDate(ms: number, timeZone: string): string {
  const p = localParts(ms, timeZone);
  return formatDate(p.year, p.month, p.day);
}

export function planNotifications(input: PlanInput): Planned[] {
  const { now, timeZone } = input;
  const days = input.days ?? 7;
  const today = calendarDate(now, timeZone);
  const logical = logicalDate(now, timeZone);
  const quietUntil = input.quietToday ? zonedInstant(addDays(logical, 1), '04:00', timeZone) : 0;
  const out: Planned[] = [];

  for (const reminder of input.reminders) {
    if (!reminder.enabled || reminder.next_fire_at === null) continue;
    const first = reminder.next_fire_at;
    const times = [first];
    if (!reminder.once) {
      const firstDate = calendarDate(first, timeZone);
      for (let d = 1; d < days; d++) {
        const date = addDays(firstDate, d);
        if (reminder.weekdays & (1 << weekdayOf(date))) {
          times.push(zonedInstant(date, reminder.time_local, timeZone));
        }
      }
    }
    for (const at of times) {
      out.push({
        id: `reminder:${reminder.id}:${at}`,
        at,
        title: 'Sirius',
        body: reminder.label,
        tab: 'list',
      });
    }
  }

  for (let d = 0; d < days; d++) {
    const date = addDays(today, d);
    for (const o of occurrencesOn(input.schedule, date)) {
      const at = zonedInstant(date, o.start_local, timeZone) - REMIND_BEFORE_MIN * 60_000;
      const where = o.location ? `, ${o.location}` : '';
      out.push({
        id: `schedule:${o.event_id}:${date}`,
        at,
        title: 'Sirius',
        body: `${o.title} at ${o.start_local}${where}`,
        tab: 'today',
      });
    }
  }

  return out
    .filter((p) => p.at > now && p.at >= quietUntil)
    .sort((a, b) => a.at - b.at)
    .slice(0, MAX);
}
