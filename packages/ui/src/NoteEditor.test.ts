import { expect, test } from 'bun:test';
import {
  changesFrom,
  composeText,
  editorReducer,
  type Outcome,
  saveOnClose,
  splitText,
  UNTITLED,
} from './NoteEditor.tsx';

const copy = { title: 'Plan', body: 'one', folder_id: null, pinned: false, rev: 1 };
const start = () =>
  editorReducer(
    {
      text: '',
      folder_id: null,
      pinned: false,
      base: { ...copy, rev: 0 },
      status: { kind: 'saved' },
    },
    { type: 'arrived', note: copy },
  );

test('F42: the first line is the title, an empty one is Untitled, and it round-trips', () => {
  expect(splitText('Plan\none\ntwo')).toEqual({ title: 'Plan', body: 'one\ntwo' });
  expect(splitText('\nbody')).toEqual({ title: UNTITLED, body: 'body' });
  expect(composeText(UNTITLED, '')).toBe('');
  expect(splitText(composeText('Plan', 'one'))).toEqual({ title: 'Plan', body: 'one' });
});

test('F42: only changed fields are sent', () => {
  const s = editorReducer(start(), { type: 'type', text: 'Plan\nthree' });
  expect(changesFrom(s, s.base)).toEqual({ body: 'three' });
  expect(s.status.kind).toBe('editing');
});

test('F42: a newer copy is taken when nothing is unsaved, and kept back when something is', () => {
  const newer = { ...copy, body: 'theirs', rev: 2 };
  expect(editorReducer(start(), { type: 'arrived', note: newer }).text).toBe('Plan\ntheirs');
  const typed = editorReducer(start(), { type: 'type', text: 'Plan\nmine' });
  expect(editorReducer(typed, { type: 'arrived', note: newer }).text).toBe('Plan\nmine');
});

test('F42: a conflict keeps the local text, then Keep mine or Take theirs settles it', () => {
  const theirs = { ...copy, body: 'theirs', rev: 3 };
  let s = editorReducer(start(), { type: 'type', text: 'Plan\nmine' });
  s = editorReducer(s, { type: 'sending' });
  s = editorReducer(s, { type: 'conflict', theirs });
  expect(s.status.kind).toBe('conflict');
  expect(s.text).toBe('Plan\nmine');
  const kept = editorReducer(s, { type: 'keep_mine' });
  expect(kept.status).toEqual({ kind: 'editing', soon: true });
  expect(changesFrom(kept, kept.base)).toEqual({ body: 'mine' });
  const taken = editorReducer(s, { type: 'take_theirs' });
  expect(taken.text).toBe('Plan\ntheirs');
  expect(taken.status.kind).toBe('saved');
});

test('F42: a first line past 500 characters keeps its overflow and round-trips', () => {
  const long = `${'a'.repeat(500)}${'b'.repeat(100)}`;
  const one = splitText(long);
  expect(one.title).toBe('a'.repeat(500));
  expect(one.body).toBe('b'.repeat(100));
  const two = splitText(`${long}\nrest`);
  expect(two.body).toBe(`${'b'.repeat(100)}\nrest`);
  // Reopening composes title and body again; nothing is lost and the split is stable.
  const reopened = composeText(two.title, two.body);
  expect(reopened.replace('\n', '')).toBe(`${long}\nrest`);
  expect(splitText(reopened)).toEqual(two);
});

test('F42: Keep mine saves against the rev it just saw', () => {
  const theirs = { ...copy, body: 'theirs', rev: 3 };
  let s = editorReducer(start(), { type: 'type', text: 'Plan\nmine' });
  s = editorReducer(editorReducer(s, { type: 'sending' }), { type: 'conflict', theirs });
  expect(editorReducer(s, { type: 'keep_mine' }).base.rev).toBe(3);
});

const saved = { ...copy, body: 'mine', rev: 2 };
const typed = (text: string) => editorReducer(start(), { type: 'type', text });
const harness = (result: Outcome = saved) => {
  const calls: { changes: unknown; rev: number }[] = [];
  const rescued: string[] = [];
  return {
    calls,
    rescued,
    io: {
      save: async (changes: unknown, rev: number) => {
        calls.push({ changes, rev });
        return result;
      },
      rescue: (text: string) => void rescued.push(text),
    },
  };
};

test('F42: closing waits for the request in flight, then sends the rest with the new rev', async () => {
  const t = harness();
  const sending = editorReducer(typed('Plan\nmine'), { type: 'sending' });
  const more = editorReducer(sending, { type: 'type', text: 'Plan\nmine, more' });
  await saveOnClose(more, Promise.resolve(saved), t.io);
  expect(t.calls).toEqual([{ changes: { body: 'mine, more' }, rev: 2 }]);
  expect(t.rescued).toEqual([]);
});

test('F42: closing with nothing new, or a deleted note, sends nothing', async () => {
  const t = harness();
  await saveOnClose(start(), null, t.io);
  await saveOnClose(editorReducer(typed('Plan\nx'), { type: 'gone' }), null, t.io);
  expect(t.calls).toEqual([]);
});

test('F42: closing in a conflict keeps the text as a new note instead of dropping it', async () => {
  const theirs = { ...copy, body: 'theirs', rev: 3 };
  const t = harness();
  const sending = editorReducer(typed('Plan\nmine'), { type: 'sending' });
  await saveOnClose(editorReducer(sending, { type: 'conflict', theirs }), null, t.io);
  expect(t.rescued).toEqual(['Plan\nmine']);
  expect(t.calls).toEqual([]);
});

test('F42: a conflict met while closing is rescued, from the request out or the last send', async () => {
  const outConflict = harness();
  await saveOnClose(typed('Plan\nx'), Promise.resolve('conflict'), outConflict.io);
  expect(outConflict.rescued).toEqual(['Plan\nx']);
  expect(outConflict.calls).toEqual([]);
  const lateConflict = harness('conflict');
  await saveOnClose(typed('Plan\nlate'), null, lateConflict.io);
  expect(lateConflict.calls).toEqual([{ changes: { body: 'late' }, rev: 1 }]);
  expect(lateConflict.rescued).toEqual(['Plan\nlate']);
});
