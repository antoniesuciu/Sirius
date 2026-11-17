import { describe, expect, test } from 'bun:test';
import { type Turn, type TurnEvent, turnReducer } from './useLive.ts';

const run = (events: TurnEvent[], from: Turn = { kind: 'idle' }) =>
  events.reduce(turnReducer, from);
const chat = { type: 'chat' } as const;
const start = (turn_id: string): TurnEvent => ({
  ...chat,
  kind: 'start',
  turn_id,
  agent: 'claude',
});
const text = (turn_id: string, delta: string): TurnEvent => ({
  ...chat,
  kind: 'text',
  turn_id,
  delta,
});
const tool = (turn_id: string): TurnEvent => ({ ...chat, kind: 'tool', turn_id, name: 'x' });
const done = (turn_id: string): TurnEvent => ({ ...chat, kind: 'done', turn_id });
const resynced = (activeTurnId: string | null): TurnEvent => ({ kind: 'resynced', activeTurnId });

describe('the chat turn', () => {
  test('start, text, tool, text, done', () => {
    expect(run([start('a')])).toEqual({ kind: 'thinking', turnId: 'a', text: '' });
    expect(run([start('a'), text('a', 'Hi'), tool('a')])).toEqual({
      kind: 'tool',
      turnId: 'a',
      text: 'Hi',
    });
    expect(run([start('a'), text('a', 'Hi'), tool('a'), text('a', ' there')])).toEqual({
      kind: 'streaming',
      turnId: 'a',
      text: 'Hi there',
    });
    expect(run([start('a'), text('a', 'Hi'), done('a')])).toEqual({ kind: 'idle' });
  });

  test('an end for another turn is ignored', () => {
    const turn = run([start('a'), text('a', 'Hi')]);
    expect(run([done('b')], turn)).toBe(turn);
    expect(run([done('b')])).toEqual({ kind: 'idle' });
  });

  test('text for a turn whose start was missed follows that turn', () => {
    expect(run([start('a'), text('a', 'old'), text('b', 'new')])).toEqual({
      kind: 'streaming',
      turnId: 'b',
      text: 'new',
    });
    expect(run([text('b', 'new')])).toEqual({ kind: 'streaming', turnId: 'b', text: 'new' });
  });

  test('a resync for the same turn keeps what was received', () => {
    const turn = run([start('a'), text('a', 'Hi')]);
    expect(run([resynced('a')], turn)).toBe(turn);
    expect(run([resynced('a'), text('a', '!')], turn)).toEqual({
      kind: 'streaming',
      turnId: 'a',
      text: 'Hi!',
    });
  });

  test('a resync to another turn starts it empty, and to none ends it', () => {
    const turn = run([start('a'), text('a', 'Hi')]);
    expect(run([resynced('b')], turn)).toEqual({ kind: 'thinking', turnId: 'b', text: '' });
    expect(run([resynced('b')])).toEqual({ kind: 'thinking', turnId: 'b', text: '' });
    expect(run([resynced(null)], turn)).toEqual({ kind: 'idle' });
  });
});
