import { describe, expect, test } from 'vitest';
import { type Copy, sync, theirChanges } from './milestoneCopy.ts';

const base: Copy = { title: 'T', description: 'D', notes: 'N', rev: 1 };

describe('milestone copy sync', () => {
  test('an older or equal rev changes nothing', () => {
    expect(sync(base, base, { ...base, notes: 'x' })).toEqual({ kind: 'same' });
  });
  test('with no unsaved edits the newer copy is taken', () => {
    expect(sync(base, base, { ...base, notes: 'agent', rev: 2 })).toEqual({
      kind: 'merge',
      fields: { title: 'T', description: 'D', notes: 'agent' },
    });
  });
  test('a change to other fields is taken and the unsaved text kept', () => {
    expect(sync({ ...base, notes: 'mine' }, base, { ...base, title: 'T2', rev: 2 })).toEqual({
      kind: 'merge',
      fields: { title: 'T2', description: 'D', notes: 'mine' },
    });
  });
  test('an unsaved edit against a change to the same field is a conflict', () => {
    expect(sync({ ...base, notes: 'mine' }, base, { ...base, notes: 'agent', rev: 2 })).toEqual({
      kind: 'conflict',
    });
  });
  test('both sides making the same edit is not a conflict', () => {
    expect(sync({ ...base, notes: 'same' }, base, { ...base, notes: 'same', rev: 2 }).kind).toBe(
      'merge',
    );
  });
  test('only the changed fields are listed', () => {
    expect(theirChanges(base, { ...base, notes: 'agent' })).toEqual([
      { label: 'Progress notes', value: 'agent' },
    ]);
  });
});
