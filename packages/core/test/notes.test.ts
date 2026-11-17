import { describe, expect, test } from 'vitest';
import { CLAUDE, codeOf, harness } from './harness.ts';

describe('notes (F42)', () => {
  test('keep long text in a folder, newest change first', () => {
    const h = harness();
    const stocks = h.run('add_note_folder', { name: 'Stocks' });
    const long = 'Thesis. '.repeat(5000);
    const nvda = h.run('add_note', { title: 'NVDA', body: long, folder_id: stocks.id });
    h.run('add_note', { title: 'Loose thought' });
    h.advance(1000);
    h.run('update_note', { id: nvda.id, body: `${long}Exit below 100.` });

    const view = h.run('list_notes', {});
    expect(view.folders.map((f) => f.name)).toEqual(['Stocks']);
    expect(view.notes.map((n) => n.title)).toEqual(['NVDA', 'Loose thought']);
    expect(view.notes[0]?.body.endsWith('Exit below 100.')).toBe(true);
    expect(view.notes[0]?.folder_id).toBe(stocks.id);
    expect(view.notes[1]?.folder_id).toBeNull();
  });

  test('a note moves between folders and out of them, but not into one that is gone', () => {
    const h = harness();
    const a = h.run('add_note_folder', { name: 'A' });
    const note = h.run('add_note', { title: 'x', folder_id: a.id });
    expect(h.run('update_note', { id: note.id, folder_id: null }).folder_id).toBeNull();
    expect(codeOf(() => h.run('update_note', { id: note.id, folder_id: 'gone' }))).toBe(
      'not_found',
    );
    expect(codeOf(() => h.run('add_note', { title: 'y', folder_id: 'gone' }))).toBe('not_found');
  });

  test('deleting a folder takes its notes with it, and one undo brings both back', () => {
    const h = harness();
    const stocks = h.run('add_note_folder', { name: 'Stocks' });
    h.run('add_note', { title: 'NVDA', folder_id: stocks.id });
    h.run('add_note', { title: 'Elsewhere' });
    const { change_id } = h.run('delete_note_folder', { id: stocks.id });
    expect(h.run('list_notes', {}).notes.map((n) => n.title)).toEqual(['Elsewhere']);

    // The change the notes page offers for Undo.
    h.run('undo', { change_id });
    const view = h.run('list_notes', {});
    expect(view.folders.map((f) => f.name)).toEqual(['Stocks']);
    expect(view.notes.map((n) => n.title).sort()).toEqual(['Elsewhere', 'NVDA']);
  });

  test('an agent writes and edits notes, but deletes need a proposal', () => {
    const h = harness();
    const note = h.run('add_note', { title: 'From Claude', body: 'a' }, CLAUDE);
    h.run('update_note', { id: note.id, body: 'b' }, CLAUDE);
    expect(codeOf(() => h.run('delete_note', { id: note.id }, CLAUDE))).toBe('requires_proposal');
    expect(h.run('list_notes', {}).notes[0]?.body).toBe('b');
  });
  test('pinned notes list first, the latest pin on top, and unpinning puts one back', () => {
    const h = harness();
    const a = h.run('add_note', { title: 'A' });
    h.advance(1000);
    const b = h.run('add_note', { title: 'B' });
    h.advance(1000);
    h.run('add_note', { title: 'C' });
    h.advance(1000);
    h.run('update_note', { id: a.id, pinned: true });
    h.advance(1000);
    const pinnedB = h.run('update_note', { id: b.id, pinned: true });
    expect(pinnedB.pinned_at).not.toBeNull();
    // An edit to a pinned note does not move it above a later pin.
    h.advance(1000);
    h.run('update_note', { id: a.id, body: 'edited' });
    expect(h.run('list_notes', {}).notes.map((n) => n.title)).toEqual(['B', 'A', 'C']);
    // Pinning again keeps the first pin time.
    expect(h.run('update_note', { id: b.id, pinned: true }).pinned_at).toBe(pinnedB.pinned_at);
    h.run('update_note', { id: b.id, pinned: false });
    expect(h.run('list_notes', {}).notes.map((n) => n.title)).toEqual(['A', 'B', 'C']);
  });

  test('an edit made from a stale copy is refused, and one without a rev still goes through', () => {
    const h = harness();
    const note = h.run('add_note', { title: 'Plan', body: 'one' });
    h.run('update_note', { id: note.id, body: 'two' }, CLAUDE);
    expect(
      codeOf(() => h.run('update_note', { id: note.id, body: 'mine', expected_rev: note.rev })),
    ).toBe('conflict');
    expect(h.run('list_notes', {}).notes[0]?.body).toBe('two');
    const fresh = h.run('list_notes', {}).notes[0];
    if (!fresh) throw new Error('no note');
    expect(h.run('update_note', { id: note.id, body: 'three', expected_rev: fresh.rev }).body).toBe(
      'three',
    );
    expect(h.run('update_note', { id: note.id, body: 'mine' }).body).toBe('mine');
  });

  test('the user deletes a note and undoes it with the change id the delete returns', () => {
    const h = harness();
    const note = h.run('add_note', { title: 'Keep me' });
    const { change_id } = h.run('delete_note', { id: note.id });
    expect(h.run('list_notes', {}).notes).toEqual([]);
    h.run('undo', { change_id });
    expect(h.run('list_notes', {}).notes.map((n) => n.title)).toEqual(['Keep me']);
  });
});
