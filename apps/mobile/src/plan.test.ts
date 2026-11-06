import { describe, expect, test } from 'bun:test';
import type { ReminderView, ScheduleEvent } from '@sirius/contracts';
import { planNotifications } from './plan.ts';

const TZ = 'Europe/Lisbon';
// Thursday 5 November 2026, 09:00 in Lisbon (UTC+0 in winter).
const NOW = Date.UTC(2026, 10, 5, 9, 0);
const common = { created_at: 0, updated_at: 0, deleted_at: null, rev: 1 };
const EVERY_DAY = 0b1111111;

const reminder = (over: Partial<ReminderView>): ReminderView => ({
  ...common,
  id: 'r1',
  kind: 'custom',
  label: 'Midday pause',
  time_local: '12:30',
  weekdays: EVERY_DAY,
  enabled: true,
  once: false,
  snoozed_until: null,
  last_fired_on: null,
  next_fire_at: Date.UTC(2026, 10, 5, 12, 30),
  ...over,
});
const lecture: ScheduleEvent = {
  ...common,
  id: 'e1',
  title: 'Real analysis',
  location: 'Room 2.14',
  weekdays: 1 << 3, // Thursday, Monday = bit 0
  date: null,
  start_local: '10:00',
  end_local: '11:30',
  starts_on: null,
  ends_on: null,
};
const plan = (over: Partial<Parameters<typeof planNotifications>[0]> = {}) =>
  planNotifications({
    reminders: [],
    schedule: [],
    now: NOW,
    timeZone: TZ,
    quietToday: false,
    ...over,
  });

describe('planNotifications', () => {
  test('a daily reminder is planned for each of the next seven days, starting at next_fire_at', () => {
    const out = plan({ reminders: [reminder({})] });
    expect(out).toHaveLength(7);
    expect(out[0]).toMatchObject({
      at: Date.UTC(2026, 10, 5, 12, 30),
      body: 'Midday pause',
      tab: 'list',
    });
    expect(out[1]?.at).toBe(Date.UTC(2026, 10, 6, 12, 30));
    expect(new Set(out.map((p) => p.id)).size).toBe(7);
  });

  test('a snoozed or one-off reminder fires once, at the time the core gives', () => {
    const snoozed = Date.UTC(2026, 10, 5, 9, 20);
    expect(plan({ reminders: [reminder({ once: true, next_fire_at: snoozed })] })).toEqual([
      expect.objectContaining({ at: snoozed }),
    ]);
  });

  test('a disabled reminder, or one that never fires again, plans nothing', () => {
    expect(
      plan({
        reminders: [reminder({ enabled: false }), reminder({ id: 'r2', next_fire_at: null })],
      }),
    ).toEqual([]);
  });

  test('a schedule event is announced ten minutes before, only on its weekdays', () => {
    const out = plan({ schedule: [lecture], days: 8 });
    expect(out.map((p) => p.at)).toEqual([
      Date.UTC(2026, 10, 5, 9, 50),
      Date.UTC(2026, 10, 12, 9, 50),
    ]);
    expect(out[0]).toMatchObject({ body: 'Real analysis at 10:00, Room 2.14', tab: 'today' });
  });

  test('nothing in the past is planned', () => {
    expect(plan({ schedule: [lecture], now: Date.UTC(2026, 10, 5, 9, 55), days: 1 })).toEqual([]);
  });

  test('quiet mode holds everything until 04:00 tomorrow', () => {
    const out = plan({ reminders: [reminder({})], schedule: [lecture], quietToday: true, days: 2 });
    expect(out.map((p) => p.at)).toEqual([Date.UTC(2026, 10, 6, 12, 30)]);
  });

  test('a reminder at 02:00 is not doubled by the 04:00 rollover', () => {
    const out = plan({
      reminders: [reminder({ time_local: '02:00', next_fire_at: Date.UTC(2026, 10, 6, 2, 0) })],
      days: 3,
    });
    expect(out.map((p) => p.at)).toEqual([
      Date.UTC(2026, 10, 6, 2, 0),
      Date.UTC(2026, 10, 7, 2, 0),
      Date.UTC(2026, 10, 8, 2, 0),
    ]);
  });
});
