/**
 * Calendar logic shared by the core and the UI.
 *
 * The Sirius day runs from 04:00 to 04:00 (F4, F8), so "today" is a logical date, not
 * the calendar date. Everything here takes an explicit time zone and instant, which
 * keeps it deterministic in tests and correct when the core runs on a remote host.
 */

export const ROLLOVER_HOUR = 4;

export interface LocalParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  /** 0 is Monday, 6 is Sunday. Matches the bit order of `reminders.weekdays`. */
  weekday: number;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-GB', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      weekday: 'short',
      hourCycle: 'h23',
    });
    formatters.set(timeZone, f);
  }
  return f;
}

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export function localParts(ms: number, timeZone: string): LocalParts {
  const parts: Record<string, string> = {};
  for (const p of formatterFor(timeZone).formatToParts(ms)) parts[p.type] = p.value;
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    weekday: WEEKDAYS.indexOf(parts.weekday ?? ''),
  };
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

export function formatDate(year: number, month: number, day: number): string {
  return `${year}-${pad(month)}-${pad(day)}`;
}

/** Adds whole days to a YYYY-MM-DD string. Pure calendar arithmetic, so DST cannot shift it. */
export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return formatDate(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

/** The logical date at an instant: before 04:00 local still belongs to yesterday. */
export function logicalDate(ms: number, timeZone: string): string {
  const p = localParts(ms, timeZone);
  const date = formatDate(p.year, p.month, p.day);
  return p.hour < ROLLOVER_HOUR ? addDays(date, -1) : date;
}

const DAY_MS = 86_400_000;

/** Local wall clock at an instant, expressed as if it were UTC. */
function wallClockAsUtc(ms: number, timeZone: string): number {
  const p = localParts(ms, timeZone);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
}

/**
 * The instant a local wall-clock time occurs. The offsets a day either side bracket
 * any DST change, so one of them is right unless the time does not exist. A time
 * skipped by spring-forward resolves to just after the gap, and a time repeated by
 * fall-back to its first occurrence, which is the sensible reading for a reminder.
 */
export function zonedInstant(date: string, time: string, timeZone: string): number {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const [hh, mm] = time.split(':').map(Number) as [number, number];
  const wall = Date.UTC(y, m - 1, d, hh, mm);
  const before = wallClockAsUtc(wall - DAY_MS, timeZone) - (wall - DAY_MS);
  const after = wallClockAsUtc(wall + DAY_MS, timeZone) - (wall + DAY_MS);
  const candidates = [wall - before, wall - after].sort((a, b) => a - b);
  return candidates.find((c) => wallClockAsUtc(c, timeZone) === wall) ?? wall - before;
}

/** Weekday of a YYYY-MM-DD date: 0 is Monday, 6 is Sunday. */
export function weekdayOf(date: string): number {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
}

/** Next time a weekly schedule fires strictly after `after`, or null for an empty mask. */
export function nextOccurrence(
  time: string,
  weekdays: number,
  after: number,
  timeZone: string,
): number | null {
  if (weekdays === 0) return null;
  const p = localParts(after, timeZone);
  const start = formatDate(p.year, p.month, p.day);
  // Eight days covers a full week plus today's slot having already passed.
  for (let i = 0; i <= 8; i += 1) {
    const date = addDays(start, i);
    if (!(weekdays & (1 << weekdayOf(date)))) continue;
    const at = zonedInstant(date, time, timeZone);
    if (at > after) return at;
  }
  return null;
}

export const EVERY_DAY = 0b1111111;
