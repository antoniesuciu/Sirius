import type { Note, NotesView as NotesData } from '@sirius/contracts';
import {
  type FormEvent,
  type KeyboardEvent,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { BackIcon, PlusIcon } from './Icons.tsx';
import { reveal } from './motion.ts';
import { type NoteChanges, NoteEditor, splitText, UNTITLED } from './NoteEditor.tsx';
import { noteMatches, notePreview, noteTime } from './noteText.ts';

/**
 * F42's notes page, at `?notes` (the list) or `?notes=<id>` (one note open), like the roadmap
 * page at `?roadmap=<id>`. On a phone width the list and the editor take turns.
 */
export type NotesPane = { kind: 'list' } | { kind: 'note'; id: string };

/** Same width as dashboard.css's phone breakpoint. */
const NARROW = '(max-width: 900px)';
/** The core's undo window (F20). */
const UNDO_MS = 30_000;

function paneFromUrl(): NotesPane | null {
  const params = new URLSearchParams(location.search);
  if (!params.has('notes')) return null;
  const id = params.get('notes');
  return id ? { kind: 'note', id } : { kind: 'list' };
}

function urlFor(pane: NotesPane | null): URL {
  const url = new URL(location.href);
  if (pane) url.searchParams.set('notes', pane.kind === 'note' ? pane.id : '');
  else url.searchParams.delete('notes');
  return url;
}

/** The notes page's place in the address, so a reload or the back button keeps it. */
export function useNotesRoute() {
  const [pane, setPane] = useState(paneFromUrl);
  useEffect(() => {
    const pop = () => setPane(paneFromUrl());
    window.addEventListener('popstate', pop);
    return () => window.removeEventListener('popstate', pop);
  }, []);
  return {
    pane,
    open(id?: string) {
      const next: NotesPane = id ? { kind: 'note', id } : { kind: 'list' };
      history.pushState({ siriusNotes: true }, '', urlFor(next));
      setPane(next);
    },
    /** Moving inside the page replaces the entry, so Back still leaves it in one step. */
    show(next: NotesPane) {
      history.replaceState(history.state, '', urlFor(next));
      setPane(next);
    },
    close() {
      if (history.state?.siriusNotes) history.back();
      else {
        history.replaceState(null, '', urlFor(null));
        setPane(null);
      }
    },
  };
}

/** The last delete, offered for Undo. */
interface Deleted {
  change_id: string;
  what: string;
}

/** The folder filter: every note, notes in no folder, or one folder by id. */
type Shown = 'all' | 'loose' | string;

export interface NotesActions {
  /** Resolves to the new folder, so the page can open it. */
  onAddFolder(name: string): Promise<{ id: string }>;
  onRenameFolder(id: string, name: string): void;
  /** Resolves to the change to pass to `onUndo`; undo brings the folder's notes back too. */
  onDeleteFolder(id: string): Promise<{ change_id: string }>;
  onAddNote(title: string, folder_id: string | null, body?: string): Promise<Note>;
  onUpdateNote(id: string, changes: NoteChanges, expected_rev?: number): Promise<Note>;
  /** Resolves to the change to pass to `onUndo`. */
  onDeleteNote(id: string): Promise<{ change_id: string }>;
  onUndo(change_id: string): void;
}

export interface NotesViewProps extends NotesActions {
  view: NotesData;
  pane: NotesPane;
  offline: boolean;
  onShow(pane: NotesPane): void;
  onClose(): void;
}

const count = (n: number) => (n === 1 ? '1 note' : `${n} notes`);

/**
 * A folder's name, typed in place in the folder list. Enter calls `onDone(name, true)`; leaving
 * the field `onDone(name, false)`; Escape `onDone(null, false)`. It calls once.
 */
function FolderName({
  label,
  initial,
  onDone,
}: {
  label: string;
  initial: string;
  onDone(name: string | null, open: boolean): void;
}) {
  const [draft, setDraft] = useState(initial);
  const done = useRef(false);
  const finish = (name: string | null, open: boolean) => {
    if (done.current) return;
    done.current = true;
    onDone(name, open);
  };
  return (
    <form
      className="notes-folder-naming"
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        finish(draft, true);
      }}
    >
      <input
        aria-label={label}
        placeholder="Folder name"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => finish(draft, false)}
        onKeyDown={(e: KeyboardEvent) => {
          if (e.key !== 'Escape') return;
          // Only the name closes, not the whole page.
          e.preventDefault();
          e.stopPropagation();
          finish(null, false);
        }}
        onFocus={(e) => e.currentTarget.select()}
        autoFocus
      />
    </form>
  );
}

function FolderPane({
  view,
  shown,
  onShow,
  onAddFolder,
  onRenameFolder,
  onDeleteFolder,
  onDeleted,
}: Pick<NotesActions, 'onAddFolder' | 'onRenameFolder' | 'onDeleteFolder'> & {
  view: NotesData;
  shown: Shown;
  onShow(shown: Shown): void;
  onDeleted(deleted: Deleted): void;
}) {
  // One small form at a time: a new folder, a rename, or the delete warning.
  const [form, setForm] = useState<
    { kind: 'none' } | { kind: 'add' } | { kind: 'rename' } | { kind: 'delete' }
  >({ kind: 'none' });
  const folder = view.folders.find((f) => f.id === shown);
  const inFolder = (id: string | null) => view.notes.filter((n) => n.folder_id === id).length;
  const rows: Array<{ id: Shown; name: string; n: number }> = [
    { id: 'all', name: 'All notes', n: view.notes.length },
    ...view.folders.map((f) => ({ id: f.id, name: f.name, n: inFolder(f.id) })),
  ];

  // Enter keeps the name and, for a new folder, opens it; clicking away keeps it too; an empty
  // name or Escape drops it.
  const commit = (name: string | null, open: boolean) => {
    const clean = name?.trim();
    if (clean && form.kind === 'add') {
      void onAddFolder(clean).then((made) => open && onShow(made.id));
    }
    if (clean && form.kind === 'rename' && folder && clean !== folder.name) {
      onRenameFolder(folder.id, clean);
    }
    setForm({ kind: 'none' });
  };
  const row = (r: { id: Shown; name: string; n: number }) =>
    form.kind === 'rename' && folder && r.id === folder.id ? (
      <li key={r.id}>
        <FolderName label={`New name for ${folder.name}`} initial={folder.name} onDone={commit} />
      </li>
    ) : (
      <li key={r.id}>
        <button
          type="button"
          className="notes-folder-row"
          aria-pressed={shown === r.id}
          onClick={() => {
            onShow(r.id);
            setForm({ kind: 'none' });
          }}
        >
          <span className="notes-folder-name">{r.name}</span>
          <span className="notes-folder-count">{r.n}</span>
        </button>
      </li>
    );

  return (
    <nav className="notes-folders" aria-label="Folders">
      <ul>
        {rows.map(row)}
        {/* A new folder's name is typed where the folder will show: after the others. */}
        {form.kind === 'add' && (
          <li key="new">
            <FolderName label="New folder name" initial="" onDone={commit} />
          </li>
        )}
        {row({ id: 'loose', name: 'No folder', n: inFolder(null) })}
      </ul>
      {form.kind === 'delete' && folder ? (
        <div className="notes-folder-warning" role="group" aria-label="Delete folder">
          <p>
            Deleting {folder.name} also deletes the {count(inFolder(folder.id))} in it.
          </p>
          <button
            type="button"
            className="text-button"
            onClick={() => {
              void onDeleteFolder(folder.id).then(({ change_id }) =>
                onDeleted({ change_id, what: 'Folder deleted.' }),
              );
              onShow('all');
              setForm({ kind: 'none' });
            }}
          >
            Delete folder and notes
          </button>
          <button type="button" className="text-button" onClick={() => setForm({ kind: 'none' })}>
            Keep
          </button>
        </div>
      ) : (
        <div className="notes-folder-actions">
          <button type="button" className="text-button" onClick={() => setForm({ kind: 'add' })}>
            New folder
          </button>
          {folder && (
            <>
              <button
                type="button"
                className="text-button"
                aria-label={`Rename folder: ${folder.name}`}
                onClick={() => setForm({ kind: 'rename' })}
              >
                Rename
              </button>
              <button
                type="button"
                className="text-button"
                aria-label={`Delete folder: ${folder.name}`}
                onClick={() => setForm({ kind: 'delete' })}
              >
                Delete
              </button>
            </>
          )}
        </div>
      )}
    </nav>
  );
}

/** F42: the notes page. Folders | notes | the open note, or list then note on a phone. */
export function NotesView({
  view,
  pane,
  offline,
  onShow,
  onClose,
  onAddNote,
  onUpdateNote,
  onDeleteNote,
  onUndo,
  ...folderActions
}: NotesViewProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const [shown, setShown] = useState<Shown>('all');
  const [query, setQuery] = useState('');
  const [made, setMade] = useState<string | null>(null);
  const [deleted, setDeleted] = useState<Deleted | null>(null);

  useEffect(() => {
    const el = dialog.current;
    el?.showModal();
    return () => el?.close();
  }, []);
  useEffect(() => {
    if (!deleted) return;
    const timer = setTimeout(() => setDeleted(null), UNDO_MS);
    return () => clearTimeout(timer);
  }, [deleted]);

  // A folder deleted elsewhere falls back to every note.
  const folder = view.folders.find((f) => f.id === shown);
  const filter: Shown = shown === 'all' || shown === 'loose' || folder ? shown : 'all';
  const inFolder = view.notes.filter((n) =>
    filter === 'all' ? true : filter === 'loose' ? n.folder_id === null : n.folder_id === filter,
  );
  // The core lists pinned notes first, then the latest edit.
  const notes = inFolder.filter((n) => noteMatches(n, query));
  const open = pane.kind === 'note' ? view.notes.find((n) => n.id === pane.id) : undefined;
  const folderName = (id: string | null) => view.folders.find((f) => f.id === id)?.name;

  // Another folder's notes come in row by row (Web Animations, so WebKitGTK and Android's
  // WebView play it too). Not on first paint: the page has its own entrance.
  const listPane = useRef<HTMLElement>(null);
  const lastFilter = useRef(filter);
  useLayoutEffect(() => {
    if (lastFilter.current === filter) return;
    lastFilter.current = filter;
    const pane = listPane.current;
    if (pane) reveal(pane.querySelectorAll('.note-list > li, .notes-empty'), true);
  }, [filter]);

  const newNote = () => {
    void onAddNote(UNTITLED, folder?.id ?? null).then((note) => {
      setMade(note.id);
      onShow({ kind: 'note', id: note.id });
    });
  };

  const onKeyDown = (e: KeyboardEvent) => {
    const mod = e.ctrlKey || e.metaKey;
    const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement;
    if ((mod && e.key.toLowerCase() === 'f') || (e.key === '/' && !mod && !typing)) {
      e.preventDefault();
      search.current?.focus();
    } else if (mod && e.key === 'Enter') {
      e.preventDefault();
      newNote();
    }
  };
  // Escape steps back one level: the note to the list on a phone, the search, then the page.
  const onCancel = (e: { preventDefault(): void }) => {
    e.preventDefault();
    if (pane.kind === 'note' && window.matchMedia?.(NARROW).matches) onShow({ kind: 'list' });
    else if (query) setQuery('');
    else onClose();
  };

  const empty =
    view.notes.length === 0
      ? 'No notes yet. Start one with New note.'
      : inFolder.length === 0
        ? 'Nothing in this folder yet.'
        : notes.length === 0
          ? `No notes match "${query.trim()}".`
          : null;

  return (
    <dialog
      ref={dialog}
      className="notes-dialog"
      aria-labelledby="notes-heading"
      data-pane={pane.kind}
      onCancel={onCancel}
      onKeyDown={onKeyDown}
    >
      <header className="notes-head">
        <h2 id="notes-heading">Notes</h2>
        <button type="button" className="pill notes-close" onClick={onClose}>
          <BackIcon />
          Dashboard
        </button>
      </header>
      <div className="notes-panes">
        <FolderPane
          view={view}
          shown={filter}
          onShow={(next) => {
            setShown(next);
            onShow({ kind: 'list' });
          }}
          {...folderActions}
          onDeleted={setDeleted}
        />
        <section ref={listPane} className="notes-list-pane" aria-label="Note list">
          <div className="notes-list-tools">
            <input
              ref={search}
              type="search"
              className="notes-search"
              aria-label="Search notes"
              placeholder="Search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <button type="button" className="round" aria-label="New note" onClick={newNote}>
              <PlusIcon />
            </button>
          </div>
          {deleted && (
            <div className="notes-undo" role="status">
              <span>{deleted.what}</span>
              <button
                type="button"
                className="text-button"
                onClick={() => {
                  onUndo(deleted.change_id);
                  setDeleted(null);
                }}
              >
                Undo
              </button>
            </div>
          )}
          {empty ? (
            <p className="notes-empty">{empty}</p>
          ) : (
            <ul className="note-list">
              {notes.map((note) => (
                <li key={note.id}>
                  <button
                    type="button"
                    className="note-row"
                    aria-current={note.id === open?.id || undefined}
                    onClick={() => onShow({ kind: 'note', id: note.id })}
                  >
                    <span className="note-row-title">
                      {note.title === UNTITLED && !note.body ? 'New note' : note.title}
                    </span>
                    {note.pinned_at != null && <span className="note-row-tag">Pinned</span>}
                    {filter === 'all' && note.folder_id && (
                      <span className="note-row-tag">{folderName(note.folder_id)}</span>
                    )}
                    <span className="note-row-time">{noteTime(note.updated_at)}</span>
                    {note.body.trim() && (
                      <span className="note-row-preview">{notePreview(note.body)}</span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="notes-editor-pane" aria-label="Open note">
          {pane.kind === 'note' && (
            <button
              type="button"
              className="pill notes-back"
              onClick={() => onShow({ kind: 'list' })}
            >
              <BackIcon />
              Notes
            </button>
          )}
          {open ? (
            <NoteEditor
              key={open.id}
              note={open}
              folders={view.folders}
              offline={offline}
              autoFocus={open.id === made}
              onSave={(changes, rev) => onUpdateNote(open.id, changes, rev)}
              onRescue={(text, folder_id) => {
                const { title, body } = splitText(text);
                // One request, so an offline failure cannot leave the rescued note with only its title.
                void onAddNote(title, folder_id, body || undefined);
              }}
              onDelete={() => {
                void onDeleteNote(open.id).then(({ change_id }) =>
                  setDeleted({ change_id, what: 'Note deleted.' }),
                );
                onShow({ kind: 'list' });
              }}
            />
          ) : (
            <p className="notes-empty">
              {pane.kind === 'note'
                ? 'That note is not here any more.'
                : 'Pick a note, or start one with New note.'}
            </p>
          )}
        </section>
      </div>
    </dialog>
  );
}
