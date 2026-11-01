import { describe, expect, test } from 'vitest';
import {
  addDays,
  EVERY_DAY,
  localParts,
  logicalDate,
  nextOccurrence,
  weekdayOf,
  zonedInstant,
} from '../src/time.ts';

const LISBON = 'Europe/Lisbon';
const ms = (iso: string) => Date.parse(iso);

describe('logical day', () => {
  test('before 04:00 local still belongs to the previous day', () => {
    expect(logicalDate(ms('2026-11-02T03:59:00Z'), LISBON)).toBe('2026-11-01');
  });
  test('04:00 local starts the new day', () => {
    expect(logicalDate(ms('2026-11-02T04:00:00Z'), LISBON)).toBe('2026-11-02');
  });
  test('follows the time zone, not UTC', () => {
    // 03:30 UTC in July is 04:30 in Lisbon (WEST, UTC+1).
    expect(logicalDate(ms('2026-07-10T03:30:00Z'), LISBON)).toBe('2026-07-10');
  });
});

describe('calendar arithmetic', () => {
  test('addDays crosses month and year ends', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2028-03-01', -1)).toBe('2028-02-29');
  });
  test('weekday 0 is Monday', () => {
    expect(weekdayOf('2026-11-02')).toBe(0);
    expect(weekdayOf('2026-11-01')).toBe(6);
  });
  test('localParts reports the local weekday', () => {
    expect(localParts(ms('2026-11-01T15:45:00Z'), LISBON)).toMatchObject({
      hour: 15,
      minute: 45,
      weekday: 6,
    });
  });
});

describe('zonedInstant', () => {
  test('resolves a summer wall time', () => {
    expect(zonedInstant('2026-07-10', '17:40', LISBON)).toBe(ms('2026-07-10T16:40:00Z'));
  });
  test('resolves a winter wall time', () => {
    expect(zonedInstant('2026-12-10', '17:40', LISBON)).toBe(ms('2026-12-10T17:40:00Z'));
  });
  test('a time skipped by spring-forward lands just after the gap', () => {
    // Lisbon jumps from 01:00 to 02:00 on 2027-03-28.
    const at = zonedInstant('2027-03-28', '01:30', LISBON);
    expect(localParts(at, LISBON)).toMatchObject({ hour: 2, minute: 30 });
  });
  test('a time repeated by fall-back resolves to its first occurrence', () => {
    // Lisbon falls back from 02:00 to 01:00 on 2026-10-25; 01:30 happens twice.
    expect(zonedInstant('2026-10-25', '01:30', LISBON)).toBe(ms('2026-10-25T00:30:00Z'));
  });
});

describe('nextOccurrence', () => {
  test('later today when the slot has not passed', () => {
    const after = ms('2026-11-01T15:45:00Z');
    expect(nextOccurrence('17:40', EVERY_DAY, after, LISBON)).toBe(ms('2026-11-01T17:40:00Z'));
  });
  test('tomorrow when today has passed', () => {
    const after = ms('2026-11-01T18:00:00Z');
    expect(nextOccurrence('17:40', EVERY_DAY, after, LISBON)).toBe(ms('2026-11-02T17:40:00Z'));
  });
  test('skips to the next enabled weekday', () => {
    const monday = 0b0000001;
    const after = ms('2026-11-03T10:00:00Z'); // a Tuesday
    expect(nextOccurrence('09:00', monday, after, LISBON)).toBe(ms('2026-11-09T09:00:00Z'));
  });
  test('wraps a whole week when the only weekday is today and has passed', () => {
    const sunday = 0b1000000;
    const after = ms('2026-11-01T18:00:00Z'); // a Sunday
    expect(nextOccurrence('09:00', sunday, after, LISBON)).toBe(ms('2026-11-08T09:00:00Z'));
  });
  test('an empty mask never fires', () => {
    expect(nextOccurrence('09:00', 0, 0, LISBON)).toBeNull();
  });
});
