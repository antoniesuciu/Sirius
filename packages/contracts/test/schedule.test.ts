import { describe, expect, test } from 'vitest';
import { notOver } from '../src/schedule.ts';

const at = (date: string, start: string, end: string | null = null) => ({
  event_id: 'e',
  title: 'Lecture',
  location: null,
  date,
  start_local: start,
  end_local: end,
});

describe('a schedule entry goes once it is over', () => {
  const today = '2026-11-06';
  const clock = (hhmm: string) => new Date(`2026-11-06T${hhmm}:00`);

  test('it stays until its end, then goes', () => {
    expect(notOver(at(today, '10:00', '12:00'), today, clock('11:30'))).toBe(true);
    expect(notOver(at(today, '10:00', '12:00'), today, clock('12:00'))).toBe(false);
  });

  test('without an end, it goes once it has started', () => {
    expect(notOver(at(today, '18:00'), today, clock('17:59'))).toBe(true);
    expect(notOver(at(today, '18:00'), today, clock('18:00'))).toBe(false);
  });

  test('other days are never over yet', () => {
    expect(notOver(at('2026-11-07', '08:00'), today, clock('23:00'))).toBe(true);
  });

  test('after midnight the day is still the old one until 04:00, and all of it is over', () => {
    // At 01:30 on the 7th the logical day is still the 6th: last evening must not come back.
    expect(notOver(at(today, '18:00', '20:00'), today, new Date('2026-11-07T01:30:00'))).toBe(
      false,
    );
  });
});
