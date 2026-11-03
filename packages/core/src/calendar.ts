/**
 * The schedule as an iCalendar feed (F37, RFC 5545). An Android calendar app such as ICSx⁵
 * subscribes to it over Tailscale and copies it into the phone's own calendar. That gives the
 * phone a home-screen widget and alarms that ring with the laptop off, neither of which a web
 * app can have.
 */
import {
  addDays,
  logicalDate,
  type ScheduleEvent,
  weekdayOf,
  zonedInstant,
} from '@sirius/contracts';

const BYDAY = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'];
/** Matches the desktop notification, so phone and laptop remind at the same moment. */
export const REMIND_BEFORE_MIN = 10;

function escape(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

/** Lines longer than 75 octets continue on the next line after a space (RFC 5545 3.1). */
function fold(line: string): string {
  const bytes = new TextEncoder().encode(line);
  if (bytes.length <= 75) return line;
  const parts: string[] = [];
  let current = '';
  for (const char of line) {
    const limit = parts.length === 0 ? 75 : 74;
    if (new TextEncoder().encode(current + char).length > limit) {
      parts.push(current);
      current = char;
    } else {
      current += char;
    }
  }
  parts.push(current);
  return parts.join('\r\n ');
}

const local = (date: string, time: string) =>
  `${date.replaceAll('-', '')}T${time.replace(':', '')}00`;

function utc(ms: number): string {
  return new Date(ms)
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '');
}

/** A weekly event starts on the first of its weekdays on or after it took effect. */
function firstDate(event: ScheduleEvent, timeZone: string): string {
  let date = event.starts_on ?? logicalDate(event.created_at, timeZone);
  for (let i = 0; i < 7 && !(event.weekdays & (1 << weekdayOf(date))); i++) date = addDays(date, 1);
  return date;
}

function vevent(event: ScheduleEvent, timeZone: string): string[] {
  const date = event.date ?? firstDate(event, timeZone);
  const lines = [
    'BEGIN:VEVENT',
    `UID:${event.id}@sirius`,
    `DTSTAMP:${utc(event.updated_at)}`,
    `SUMMARY:${escape(event.title)}`,
    `DTSTART;TZID=${timeZone}:${local(date, event.start_local)}`,
  ];
  if (event.end_local) lines.push(`DTEND;TZID=${timeZone}:${local(date, event.end_local)}`);
  if (event.location) lines.push(`LOCATION:${escape(event.location)}`);
  if (!event.date) {
    const days = BYDAY.filter((_, i) => event.weekdays & (1 << i)).join(',');
    // With a zoned DTSTART, UNTIL has to be in UTC.
    const until = event.ends_on
      ? `;UNTIL=${utc(zonedInstant(event.ends_on, '23:59', timeZone))}`
      : '';
    lines.push(`RRULE:FREQ=WEEKLY;BYDAY=${days}${until}`);
  }
  lines.push(
    'BEGIN:VALARM',
    'ACTION:DISPLAY',
    `DESCRIPTION:${escape(event.title)}`,
    `TRIGGER:-PT${REMIND_BEFORE_MIN}M`,
    'END:VALARM',
    'END:VEVENT',
  );
  return lines;
}

export function toIcs(events: ScheduleEvent[], timeZone: string): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Sirius//Schedule//EN',
    'CALSCALE:GREGORIAN',
    'X-WR-CALNAME:Sirius',
    `X-WR-TIMEZONE:${timeZone}`,
    ...events.filter((e) => e.deleted_at === null).flatMap((e) => vevent(e, timeZone)),
    'END:VCALENDAR',
  ];
  return `${lines.map(fold).join('\r\n')}\r\n`;
}
