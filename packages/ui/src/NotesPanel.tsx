import type { NotesView } from '@sirius/contracts';
import { type FormEvent, useState } from 'react';
import { FoldTitle } from './Fold.tsx';
import { PlusIcon } from './Icons.tsx';
import { UNTITLED } from './NoteEditor.tsx';
import { notePreview, noteTime } from './noteText.ts';

export interface NotesPanelProps {
  view: NotesView;
  onAddNote(title: string, folder_id: string | null): Promise<unknown>;
  /** Opens the notes page (F42), on one note when given. */
  onOpen(id?: string): void;
}

/** The card shows only the latest few; the notes page has the rest. */
const RECENT = 4;

/** F42: notes to keep, in folders such as "Stocks". The card is the doorway to the notes page. */
export function NotesPanel({ view, onAddNote, onOpen }: NotesPanelProps) {
  const [draft, setDraft] = useState('');
  // The core lists pinned notes first, then the latest edit.
  const recent = view.notes.slice(0, RECENT);

  const addNote = (e: FormEvent) => {
    e.preventDefault();
    const clean = draft.trim();
    if (!clean) return;
    setDraft('');
    void onAddNote(clean, null);
  };

  return (
    <section className="panel panel-notes rise d4">
      <div className="panel-head">
        <h2>
          <FoldTitle>Notes</FoldTitle>
        </h2>
        <button type="button" className="text-button" onClick={() => onOpen()}>
          {view.notes.length > RECENT ? `All ${view.notes.length} notes` : 'Open notes'}
        </button>
      </div>

      {recent.length > 0 ? (
        <ul className="note-list">
          {recent.map((note) => (
            <li key={note.id}>
              <button type="button" className="note-row" onClick={() => onOpen(note.id)}>
                <span className="note-row-title">
                  {note.title === UNTITLED && !note.body ? 'New note' : note.title}
                </span>
                {note.pinned_at != null && <span className="note-row-tag">Pinned</span>}
                <span className="note-row-time">{noteTime(note.updated_at)}</span>
                {note.body.trim() && (
                  <span className="note-row-preview">{notePreview(note.body)}</span>
                )}
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="notes-empty">No notes yet. Write one below.</p>
      )}

      <form className="quick-add" onSubmit={addNote}>
        <input
          type="text"
          aria-label="New note"
          placeholder="New note"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
        <button type="submit" className="round" aria-label="Add note">
          <PlusIcon />
        </button>
      </form>
    </section>
  );
}
