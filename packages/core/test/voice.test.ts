import { describe, expect, test } from 'vitest';
import { isCancelWord, normalise, parseIntent, parseTime } from '../src/voice/intents.ts';
import { VOICE_CONFIRM_WINDOW_MS } from '../src/voice/router.ts';
import { CLAUDE, fakeAgent, harness, NOON_ISH } from './harness.ts';

describe('grammar: English (F30)', () => {
  test.each([
    ['add buy rice to today', { kind: 'add_task', title: 'Buy rice' }],
    ['Add buy rice to today.', { kind: 'add_task', title: 'Buy rice' }],
    ['add water the plants', { kind: 'add_task', title: 'Water the plants' }],
    ['Hey Sirius, add buy rice to today.', { kind: 'add_task', title: 'Buy rice' }],
    ['remind me at 5 pm to call mum', { kind: 'remind', time: '17:00', label: 'Call mum' }],
    ['remind me to stretch at 17:40', { kind: 'remind', time: '17:40', label: 'Stretch' }],
    ["what's next", { kind: 'whats_next' }],
    ['What is next?', { kind: 'whats_next' }],
    ['what time is it', { kind: 'what_time' }],
    ['start breathing', { kind: 'start_breathing' }],
    ["I'm done for today", { kind: 'done_for_today' }],
    ['snooze that', { kind: 'snooze' }],
    ['confirm', { kind: 'confirm' }],
    ['Yes.', { kind: 'confirm' }],
    ['cancel', { kind: 'cancel' }],
  ])('%s', (text, intent) => {
    expect(parseIntent(text)).toEqual(intent);
  });
});

describe('grammar: Romanian (F29)', () => {
  test.each([
    ['adaugă cumpără orez la azi', { kind: 'add_task', title: 'Cumpără orez' }],
    ['Adaugă cumpără orez.', { kind: 'add_task', title: 'Cumpără orez' }],
    ['amintește-mi la 17:40 să mă rog', { kind: 'remind', time: '17:40', label: 'Mă rog' }],
    ['ce urmează', { kind: 'whats_next' }],
    ['cât e ceasul', { kind: 'what_time' }],
    ['începe respirația', { kind: 'start_breathing' }],
    ['am terminat pe azi', { kind: 'done_for_today' }],
    ['amână asta', { kind: 'snooze' }],
    ['confirmă', { kind: 'confirm' }],
    ['da', { kind: 'confirm' }],
    ['anulează', { kind: 'cancel' }],
  ])('%s', (text, intent) => {
    expect(parseIntent(text)).toEqual(intent);
  });

  test('handles the cedilla forms Whisper sometimes writes', () => {
    expect(parseIntent('aminteşte-mi la 9 să sun')).toMatchObject({
      kind: 'remind',
      time: '09:00',
    });
  });
});

describe('grammar: everything else is for the agent', () => {
  test.each(['why is the sky blue', 'tell me about my goals', 'move my tasks to tomorrow'])(
    '%s',
    (text) => {
      expect(parseIntent(text)).toBeNull();
    },
  );

  test('a bad time falls through instead of guessing', () => {
    expect(parseIntent('remind me at noonish to eat')).toBeNull();
  });
});

describe('helpers', () => {
  test.each([
    ['5', '05:00'],
    ['5 pm', '17:00'],
    ['5 p.m.', '17:00'],
    ['12 am', '00:00'],
    ['12 pm', '12:00'],
    ['17:40', '17:40'],
    ['9.30', '09:30'],
  ])('parseTime %s', (raw, time) => {
    expect(parseTime(raw)).toBe(time);
  });
  test('rejects impossible times', () => {
    expect(parseTime('25:00')).toBeNull();
    expect(parseTime('9:75')).toBeNull();
  });
  test('normalise strips the wake word and punctuation', () => {
    expect(normalise('Hey, Sirius! add milk.')).toBe('add milk');
  });
  test('cancel words abort in both languages (F28)', () => {
    expect(isCancelWord('Cancel.')).toBe(true);
    expect(isCancelWord('anulează')).toBe(true);
    expect(isCancelWord('cancel my dentist appointment')).toBe(false);
  });
});

const say = (h: ReturnType<typeof harness>, transcript: string, lang = 'en') =>
  h.run('voice_utterance', { transcript, lang }, { actor: 'user', via: 'voice' });

describe('routing', () => {
  test('a fast-path add lands in Today and answers in English', () => {
    const h = harness();
    const result = say(h, 'add buy rice to today');
    expect(result).toMatchObject({
      route: 'fast_path',
      intent: 'add_task',
      reply: 'Added Buy rice to today.',
    });
    expect(h.run('get_today', {}).tasks[0]).toMatchObject({ title: 'Buy rice', source: 'user' });
  });

  test('it answers in the language of the request (F29)', () => {
    const h = harness();
    expect(say(h, 'adaugă cumpără orez la azi', 'ro').reply).toBe(
      'Am adăugat Cumpără orez la azi.',
    );
  });

  test('anything else becomes a voice agent turn', async () => {
    const claude = fakeAgent('claude', [[{ type: 'text', delta: 'Hello. ' }, { type: 'done' }]]);
    const h = harness(NOON_ISH, { claude: claude.adapter, codex: fakeAgent('codex').adapter });
    const result = say(h, 'why is the sky blue');
    expect(result).toMatchObject({ route: 'agent', reply: null });
    await Bun.sleep(20);
    expect(claude.prompts[0]?.prompt).toContain('read well aloud');
    const replies = h.events.filter((e) => e.type === 'voice_reply');
    expect(replies.map((e) => e.type === 'voice_reply' && [e.text, e.final])).toEqual([
      ['Hello. ', false],
      ['', true],
    ]);
  });

  test('chat text from the keyboard is not spoken', async () => {
    const claude = fakeAgent('claude', [[{ type: 'text', delta: 'Hi' }, { type: 'done' }]]);
    const h = harness(NOON_ISH, { claude: claude.adapter, codex: fakeAgent('codex').adapter });
    h.run('send_chat', { text: 'hi' });
    await Bun.sleep(20);
    expect(h.events.some((e) => e.type === 'voice_reply')).toBe(false);
  });

  test('voice turns are recorded as text, with no audio field to fill (F33)', () => {
    const h = harness();
    say(h, 'what time is it');
    const row = h.core.sqlite.all<{ transcript: string; route: string }>(
      'SELECT transcript, route FROM voice_turns',
    )[0];
    expect(row).toEqual({ transcript: 'what time is it', route: 'fast_path' });
  });
});

describe('commands', () => {
  test('what time is it reads the local clock', () => {
    expect(say(harness(), 'what time is it').reply).toBe("It's 15:45.");
  });

  test("what's next prefers a priority", () => {
    const h = harness();
    h.run('add_task', { title: 'small one' });
    h.run('add_task', { title: 'the big one', tier: 'priority' });
    expect(say(h, "what's next").reply).toBe('Next is the big one.');
  });

  test("what's next on an empty day suggests rest", () => {
    expect(say(harness(), "what's next").reply).toContain('rest');
  });

  test("I'm done for today turns quiet mode on", () => {
    const h = harness();
    say(h, "I'm done for today");
    expect(h.run('get_today', {}).quiet_mode).toBe(true);
  });

  test('start breathing tells the UI', () => {
    const h = harness();
    say(h, 'start breathing');
    expect(h.events).toContainEqual({ type: 'ui_action', action: 'start_breathing' });
  });

  test('a spoken reminder fires once and turns itself off', () => {
    const h = harness();
    say(h, 'remind me at 17:00 to call mum');
    h.now.value = Date.parse('2026-11-01T17:00:00Z');
    h.core.scheduler.tick();
    expect(h.notified.map((n) => n.body)).toEqual(['Call mum']);
    expect(h.run('list_reminders', {})[0]?.enabled).toBe(false);
  });

  test('a time already gone today means tomorrow', () => {
    const h = harness();
    say(h, 'remind me at 09:00 to call mum');
    expect(h.run('list_reminders', {})[0]?.next_fire_at).toBe(Date.parse('2026-11-02T09:00:00Z'));
  });

  test('snooze that delays the reminder that just fired', () => {
    const h = harness();
    h.run('set_reminder', {
      label: 'Stretch',
      kind: 'wellbeing',
      time_local: '16:00',
      weekdays: 127,
    });
    h.now.value = Date.parse('2026-11-01T16:00:00Z');
    h.core.scheduler.tick();
    expect(say(h, 'snooze that').reply).toBe('Stretch can wait an hour.');
    expect(h.run('list_reminders', {})[0]?.snoozed_until).toBe(h.now.value + 3_600_000);
  });
});

describe('proposals by voice (F32)', () => {
  const pending = (h: ReturnType<typeof harness>, op = 'reschedule_tasks') => {
    const task = h.run('add_task', { title: 'a' });
    const goal = h.run('add_goal', { title: 'g' });
    const ops =
      op === 'delete_goal'
        ? [{ op, input: { id: goal.id } }]
        : [{ op, input: { ids: [task.id], date: '2026-11-02' } }];
    return h.run('propose_changes', { summary: 'Change', ops }, CLAUDE);
  };

  test('yes within 15 seconds confirms', () => {
    const h = harness();
    pending(h);
    h.advance(VOICE_CONFIRM_WINDOW_MS - 1);
    expect(say(h, 'yes').reply).toBe('Done.');
    expect(h.run('get_today', {}).resting_tomorrow).toBe(1);
  });

  test('yes after 15 seconds does not', () => {
    const h = harness();
    pending(h);
    h.advance(VOICE_CONFIRM_WINDOW_MS + 1);
    expect(say(h, 'confirm').reply).toContain('passed');
    expect(h.run('list_proposals', {}).length).toBe(1);
  });

  test('a delete always needs a tap', () => {
    const h = harness();
    pending(h, 'delete_goal');
    expect(say(h, 'yes').reply).toContain('tap');
    expect(h.run('list_goals', {}).length).toBe(1);
  });

  test('no declines it', () => {
    const h = harness();
    pending(h);
    expect(say(h, 'no').reply).toBe("Alright, I'll leave it as it is.");
    expect(h.run('list_proposals', {})).toEqual([]);
  });

  test('yes with nothing pending says so', () => {
    expect(say(harness(), 'yes').reply).toBe('There is nothing to confirm.');
  });
});

test('voice_ptt reaches the voice service over the bus', () => {
  const h = harness();
  h.run('voice_ptt', {});
  expect(h.events).toContainEqual({ type: 'voice_command', command: 'ptt' });
});
