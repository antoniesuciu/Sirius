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

/** An entry with no end time is taken to last this long. */
const DEFAULT_LENGTH_MIN = 60;

const minutes = (hhmm: string) => {
  const [h = 0, m = 0] = hhmm.split(':').map(Number);
  return h * 60 + m;
};

/**
 * Whether an occurrence still belongs on screen at `now`: until its end, or an hour after its
 * start when it has none. Only `today` (the logical day, which runs to 04:00) can be over;
 * before 04:00 the clock counts on past 24:00, so last evening's entries do not come back.
 */
export function notOver(occurrence: ScheduleOccurrence, today: string, now: Date): boolean {
  if (occurrence.date !== today) return true;
  const clock =
    (now.getHours() + (now.getHours() < ROLLOVER_HOUR ? 24 : 0)) * 60 + now.getMinutes();
  const end = occurrence.end_local
    ? minutes(occurrence.end_local)
    : minutes(occurrence.start_local) + DEFAULT_LENGTH_MIN;
  return end > clock;
}
