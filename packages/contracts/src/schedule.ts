/** Schedule helpers shared by the core, the UI and the calendar feed (F37). */
import type { ScheduleEvent, ScheduleOccurrence } from './schemas.ts';
import { happensOn, ROLLOVER_HOUR } from './time.ts';

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

/**
 * Whether an occurrence still belongs on screen at `now`: until its end, or its start when it
 * has none. Only `today` (the logical day, which runs to 04:00) can be over; before 04:00 the
 * clock reads as 24:00 and later, so last evening's entries do not come back after midnight.
 */
export function notOver(occurrence: ScheduleOccurrence, today: string, now: Date): boolean {
  if (occurrence.date !== today) return true;
  const hours = now.getHours() + (now.getHours() < ROLLOVER_HOUR ? 24 : 0);
  const time = `${String(hours).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  return (occurrence.end_local ?? occurrence.start_local) > time;
}
