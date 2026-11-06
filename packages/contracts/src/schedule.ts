/** Schedule helpers shared by the core, the UI and the calendar feed (F37). */
import type { ScheduleEvent, ScheduleOccurrence } from './schemas.ts';
import { happensOn } from './time.ts';

export function occurrencesOn(events: ScheduleEvent[], date: string): ScheduleOccurrence[] {
  return events
    .filter((event) => event.deleted_at === null && happensOn(event, date))
    .sort((a, b) => a.start_local.localeCompare(b.start_local))
    .map((event) => ({
      event_id: event.id,
      title: event.title,
      location: event.location,
      date,
      start_local: event.start_local,
      end_local: event.end_local,
    }));
}

export const WEEKDAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** "Mon, Wed" or "every day", for a weekly mask. */
export function describeWeekdays(mask: number): string {
  if (mask === 127) return 'every day';
  if (mask === 31) return 'weekdays';
  return WEEKDAY_NAMES.filter((_, i) => mask & (1 << i)).join(', ');
}

/** Minutes before a schedule event that it is announced, the same on the laptop and the phone. */
export const REMIND_BEFORE_MIN = 10;
