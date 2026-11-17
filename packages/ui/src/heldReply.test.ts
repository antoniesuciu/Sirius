import { expect, test } from 'bun:test';
import {
  type Live,
  liveReducer,
  NO_LIVE,
  newestStoredAt,
  storedReplies,
  wroteAgain,
} from './heldReply.ts';

const stream = (text: string | null, after = 100, mine = 1) =>
  ({ kind: 'stream', text, after, mine }) as const;

const hold = (): Live => {
  let live = liveReducer(NO_LIVE, stream('Hel', 100));
  live = liveReducer(live, stream('Hello', 999)); // the anchor is taken when the stream begins
  return liveReducer(live, stream(null, 999, 1));
};

test('a finished stream is held, anchored where it began', () => {
  expect(hold()).toEqual({ kind: 'held', text: 'Hello', after: 100, mine: 1, typed: false });
});

test('nothing changed returns the same state, so it can step while rendering', () => {
  const live = liveReducer(NO_LIVE, stream('Hi'));
  expect(liveReducer(live, stream('Hi'))).toBe(live);
  expect(liveReducer(NO_LIVE, stream(null))).toBe(NO_LIVE);
  const held = hold();
  expect(liveReducer(held, stream(null))).toBe(held);
});

test('an empty stream that ends holds nothing', () => {
  expect(liveReducer(liveReducer(NO_LIVE, stream('')), stream(null))).toBe(NO_LIVE);
});

test('a new stream replaces the held reply', () => {
  expect(liveReducer(hold(), stream('Next', 300))).toEqual({
    kind: 'streaming',
    text: 'Next',
    after: 300,
  });
});

test('only a stored line not mine, newer than the anchor, is the stored reply', () => {
  const held = hold();
  const lines = [
    { id: 'old', mine: false, storedAt: 100 },
    { id: 'me', mine: true, storedAt: 150 },
    // The error line and a spoken reply were never stored by the core.
    { id: 'error', mine: false },
    { id: 'heard', mine: false },
  ];
  expect(storedReplies(held, lines).size).toBe(0);
  expect(storedReplies(held, [...lines, { id: 'reply', mine: false, storedAt: 200 }])).toEqual(
    new Set(['reply']),
  );
  expect(storedReplies(NO_LIVE, [{ id: 'reply', mine: false, storedAt: 200 }]).size).toBe(0);
});

test('writing again ends the hold', () => {
  const held = hold();
  expect(wroteAgain(held, [{ id: 'a', mine: true }])).toBe(false);
  expect(
    wroteAgain(held, [
      { id: 'a', mine: true },
      { id: 'pending', mine: true },
    ]),
  ).toBe(true);
});

test('typed and cleared', () => {
  const typed = liveReducer(hold(), { kind: 'typed' });
  expect(typed).toMatchObject({ kind: 'held', typed: true });
  expect(liveReducer(typed, { kind: 'typed' })).toBe(typed);
  expect(liveReducer(typed, { kind: 'cleared' })).toBe(NO_LIVE);
  expect(liveReducer(NO_LIVE, { kind: 'typed' })).toBe(NO_LIVE);
});

test('the anchor is the newest stored time, ignoring unstored lines', () => {
  expect(newestStoredAt([])).toBe(0);
  expect(
    newestStoredAt([
      { id: 'a', mine: true, storedAt: 5 },
      { id: 'b', mine: false, storedAt: 9 },
      { id: 'c', mine: false },
    ]),
  ).toBe(9);
});
