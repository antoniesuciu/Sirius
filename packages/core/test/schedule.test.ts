import { occurrencesOn, weekdayOf } from '@sirius/contracts';
import { describe, expect, test } from 'vitest';
import { toIcs } from '../src/calendar.ts';
import { createApp } from '../src/http/app.ts';
import { CLAUDE, codeOf, harness, TZ } from './harness.ts';

const MON_WED = 0b0000101;

describe('the schedule (F37)', () => {
  test('a weekly event shows on its days, and only in term', () => {
    const h = harness();
    h.run('add_schedule_event', {
      title: 'Real analysis',
      weekdays: MON_WED,
      start_local: '10:00',
      end_local: '11:30',
      starts_on: '2026-11-01',
      ends_on: '2026-12-18',
    });
    const events = h.run('list_schedule', {});
    expect(occurrencesOn(events, '2026-11-02').map((o) => o.title)).toEqual(['Real analysis']);
    expect(occurrencesOn(events, '2026-11-03')).toEqual([]);
    expect(occurrencesOn(events, '2026-12-21')).toEqual([]);
    expect(weekdayOf('2026-11-02')).toBe(0);
  });

  test('a one-off happens on its date only', () => {
    const h = harness();
    h.run('add_schedule_event', { title: 'Dentist', date: '2026-11-05', start_local: '09:00' });
    const events = h.run('list_schedule', {});
    expect(occurrencesOn(events, '2026-11-05')).toHaveLength(1);
    expect(occurrencesOn(events, '2026-11-12')).toHaveLength(0);
  });

  test('weekly or once, never both or neither, and the end after the start', () => {
    const h = harness();
    const both = { title: 'x', weekdays: 1, date: '2026-11-05', start_local: '09:00' };
    expect(codeOf(() => h.run('add_schedule_event', both))).toBe('invalid_schedule');
    expect(codeOf(() => h.run('add_schedule_event', { title: 'x', start_local: '09:00' }))).toBe(
      'invalid_schedule',
    );
    const backwards = { title: 'x', weekdays: 1, start_local: '10:00', end_local: '09:00' };
    expect(codeOf(() => h.run('add_schedule_event', backwards))).toBe('invalid_schedule');
  });

  test("today's events come with the day, apart from its tasks", () => {
    const h = harness();
    const today = h.run('get_today', {}).date;
    h.run('add_schedule_event', { title: 'Lab', date: today, start_local: '14:00' });
    const view = h.run('get_today', {});
    expect(view.schedule.map((o) => o.title)).toEqual(['Lab']);
    expect(view.tasks.some((t) => t.title === 'Lab')).toBe(false);
  });

  test('an agent can add and change the schedule, but a delete needs a proposal', () => {
    const h = harness();
    const event = h.run(
      'add_schedule_event',
      { title: 'Gym', weekdays: 2, start_local: '18:00' },
      CLAUDE,
    );
    h.run('update_schedule_event', { id: event.id, start_local: '18:30' }, CLAUDE);
    expect(h.run('list_schedule', {})[0]?.start_local).toBe('18:30');
    expect(codeOf(() => h.run('delete_schedule_event', { id: event.id }, CLAUDE))).toBe(
      'requires_proposal',
    );
    h.run('delete_schedule_event', { id: event.id });
    expect(h.run('list_schedule', {})).toEqual([]);
  });
});

describe('reminding before an event (F37)', () => {
  test('notifies ten minutes before, once', () => {
    const h = harness();
    const today = h.run('get_today', {}).date;
    h.run('add_schedule_event', {
      title: 'Lab',
      location: 'Room 2',
      date: today,
      start_local: '14:00',
    });
    // Lisbon is on UTC in November, so these instants are local times too.
    h.now.value = Date.parse(`${today}T13:49:00Z`);
    h.core.scheduler.tick();
    expect(h.notified.filter((n) => n.body.includes('Lab'))).toHaveLength(0);
    h.now.value = Date.parse(`${today}T13:51:00Z`);
    h.core.scheduler.tick();
    h.core.scheduler.tick();
    expect(h.notified.filter((n) => n.body.includes('Lab')).map((n) => n.body)).toEqual([
      'Lab at 14:00, Room 2',
    ]);
  });

  test('stays silent in quiet mode', () => {
    const h = harness();
    const today = h.run('get_today', {}).date;
    h.run('add_schedule_event', { title: 'Lab', date: today, start_local: '14:00' });
    h.run('set_quiet_mode', { on: true });
    h.now.value = Date.parse(`${today}T13:55:00Z`);
    h.core.scheduler.tick();
    expect(h.notified.filter((n) => n.body.includes('Lab'))).toHaveLength(0);
  });
});

describe('the calendar feed (F37)', () => {
  test('weekly events repeat on their days until the term ends, with an alarm', () => {
    const h = harness();
    h.run('add_schedule_event', {
      title: 'Real analysis, lecture',
      location: 'Room 2.14',
      weekdays: MON_WED,
      start_local: '10:00',
      end_local: '11:30',
      starts_on: '2026-11-01',
      ends_on: '2026-12-18',
    });
    const ics = toIcs(h.run('list_schedule', {}), 'Europe/Lisbon');
    expect(ics).toContain('BEGIN:VCALENDAR\r\n');
    expect(ics).toContain('SUMMARY:Real analysis\\, lecture');
    expect(ics).toContain('DTSTART;TZID=Europe/Lisbon:20261102T100000');
    expect(ics).toContain('DTEND;TZID=Europe/Lisbon:20261102T113000');
    expect(ics).toMatch(/RRULE:FREQ=WEEKLY;BYDAY=MO,WE;UNTIL=20261218T\d{6}Z/);
    expect(ics).toContain('TRIGGER:-PT10M');
    for (const line of ics.split('\r\n'))
      expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
  });

  test('is served only with the right token, outside the API login', async () => {
    const h = harness();
    h.run('add_schedule_event', { title: 'Gym', weekdays: 2, start_local: '18:00' });
    const app = createApp(h.core, {
      token: 't',
      mode: 'local',
      version: 'x',
      calendarToken: 'feed-secret',
    });
    const ok = await app.request('/calendar/feed-secret.ics');
    expect(ok.status).toBe(200);
    expect(ok.headers.get('content-type')).toContain('text/calendar');
    expect(await ok.text()).toContain('SUMMARY:Gym');
    expect((await app.request('/calendar/guess.ics')).status).toBe(404);
  });

  test('the time zone is the one Sirius runs in', () => {
    expect(TZ).toBeTruthy();
  });
});
