/** Notes (F42): free text kept for later, optionally in a folder. Deletes go through undo. */
import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm';
import { change_log, note_folders, notes } from '../db/schema.ts';
import { conflict } from '../errors.ts';
import type { Handlers, OpContext } from './context.ts';

/** A note may only point at a folder that is still there. */
function checkFolder(ctx: OpContext, folder_id: string | null | undefined) {
  if (folder_id) ctx.tx.get('note_folders', folder_id);
}

const liveNotes = (ctx: OpContext) =>
  ctx.tx.db
    .select()
    .from(notes)
    .where(isNull(notes.deleted_at))
    // Pinned first, the latest pin on top; then the latest edit.
    .orderBy(
      sql`${notes.pinned_at} is null`,
      desc(notes.pinned_at),
      desc(notes.updated_at),
      desc(notes.id),
    )
    .all();

export const noteHandlers: Handlers<
  | 'list_notes'
  | 'add_note_folder'
  | 'rename_note_folder'
  | 'delete_note_folder'
  | 'add_note'
  | 'update_note'
  | 'delete_note'
> = {
  list_notes: (_input, ctx) => ({
    folders: ctx.tx.db
      .select()
      .from(note_folders)
      .where(isNull(note_folders.deleted_at))
      .orderBy(asc(note_folders.name))
      .all(),
    notes: liveNotes(ctx),
  }),

  add_note_folder: ({ name }, ctx) => ctx.tx.insert('note_folders', { name }),

  rename_note_folder({ id, name }, ctx) {
    ctx.tx.get('note_folders', id);
    return ctx.tx.update('note_folders', id, { name });
  },

  delete_note_folder({ id }, ctx) {
    ctx.tx.get('note_folders', id);
    for (const note of liveNotes(ctx)) {
      if (note.folder_id === id) ctx.tx.softDelete('notes', note.id);
    }
    ctx.tx.softDelete('note_folders', id);
    // Undo reverts the whole batch, so the folder's notes come back with it.
    return { ok: true, change_id: deleteChange(ctx, 'note_folders', id) };
  },

  add_note({ title, body, folder_id }, ctx) {
    checkFolder(ctx, folder_id);
    return ctx.tx.insert('notes', { title, body: body ?? '', folder_id: folder_id ?? null });
  },

  update_note({ id, pinned, expected_rev, ...patch }, ctx) {
    const current = ctx.tx.get('notes', id);
    // F42: an editor open on an older copy must not silently overwrite a newer edit.
    if (expected_rev !== undefined && current.rev !== expected_rev) {
      throw conflict('That note changed somewhere else since you opened it.');
    }
    checkFolder(ctx, patch.folder_id);
    const changes = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
    // Re-pinning keeps the original pin time, so the order does not jump.
    const pinned_at = pinned ? (current.pinned_at ?? ctx.tx.now) : null;
    return ctx.tx.update('notes', id, pinned === undefined ? changes : { ...changes, pinned_at });
  },

  delete_note({ id }, ctx) {
    ctx.tx.softDelete('notes', id);
    return { ok: true, change_id: deleteChange(ctx, 'notes', id) };
  },
};

/** The delete's change-log row, so the user can undo it (F20's 30-second window). */
function deleteChange(ctx: OpContext, entity: 'notes' | 'note_folders', id: string): string {
  const row = ctx.tx.db
    .select({ id: change_log.id })
    .from(change_log)
    .where(
      and(
        eq(change_log.batch_id, ctx.tx.batchId),
        eq(change_log.entity, entity),
        eq(change_log.entity_id, id),
      ),
    )
    .get();
  if (!row) throw new Error(`deleting ${entity} wrote no change log`);
  return row.id;
}
