import { ApiError, holdConflicts, type Note, type NotesView } from '@sirius/contracts';
import { useEffect, useReducer, useRef } from 'react';
import { PinIcon } from './Icons.tsx';
import { noteTime } from './noteText.ts';

export interface NoteChanges {
  title?: string;
  body?: string;
  folder_id?: string | null;
  pinned?: boolean;
}

/** Typing saves after this pause, so a closed app or a switched note loses at most a moment. */
const SAVE_AFTER_MS = 800;
/** The contract's longest title. */
const TITLE_MAX = 500;
/** Stored for an empty first line, so the contract's non-empty title holds; shown as empty. */
export const UNTITLED = 'Untitled';

/** What the core holds, as far as the editor knows. */
interface Copy {
  title: string;
  body: string;
  folder_id: string | null;
  pinned: boolean;
  rev: number;
}

/**
 * F42's save lifecycle. `editing`: unsaved changes wait for the pause (`soon` skips it, for a
 * folder or pin change). `saving`: one request is out (saves are single-flight); later typing
 * waits for its answer so the next save carries the new rev, and every save sends it. `conflict`: the note changed elsewhere while there was unsaved
 * text here. `gone`: deleted, nothing more to save.
 */
type Status =
  | { kind: 'saved' }
  | { kind: 'editing'; soon: boolean }
  | { kind: 'saving' }
  | { kind: 'failed' }
  | { kind: 'conflict'; theirs: Copy }
  | { kind: 'gone' };

interface State {
  /** The one writing surface: the first line is the title, the rest the body. */
  text: string;
  folder_id: string | null;
  pinned: boolean;
  base: Copy;
  status: Status;
}

type Action =
  | { type: 'type'; text: string }
  | { type: 'set'; folder_id?: string | null; pinned?: boolean }
  | { type: 'sending' }
  | { type: 'sent'; note: Copy }
  | { type: 'failed' }
  | { type: 'conflict'; theirs: Copy }
  | { type: 'arrived'; note: Copy }
  | { type: 'keep_mine' }
  | { type: 'take_theirs' }
  | { type: 'gone' };

export function copyOf(note: Note): Copy {
  return {
    title: note.title,
    body: note.body,
    folder_id: note.folder_id,
    pinned: note.pinned_at != null,
    rev: note.rev,
  };
}

export function composeText(title: string, body: string): string {
  const first = title === UNTITLED ? '' : title;
  return body ? `${first}\n${body}` : first;
}

/** A first line past 500 characters keeps its overflow at the start of the body, never dropped. */
export function splitText(text: string): { title: string; body: string } {
  const at = text.indexOf('\n');
  const line = (at < 0 ? text : text.slice(0, at)).trim();
  const rest = at < 0 ? '' : text.slice(at + 1);
  const overflow = line.slice(TITLE_MAX);
  return {
    title: line.slice(0, TITLE_MAX).trim() || UNTITLED,
    body: overflow ? (rest ? `${overflow}\n${rest}` : overflow) : rest,
  };
}

/** Only the fields that differ from `from` are sent. */
export function changesFrom(
  state: Pick<State, 'text' | 'folder_id' | 'pinned'>,
  from: Copy,
): NoteChanges {
  const { title, body } = splitText(state.text);
  const changes: NoteChanges = {};
  if (title !== from.title) changes.title = title;
  if (body !== from.body) changes.body = body;
  if (state.folder_id !== from.folder_id) changes.folder_id = state.folder_id;
  if (state.pinned !== from.pinned) changes.pinned = state.pinned;
  return changes;
}

const adopt = (note: Copy): State => ({
  text: composeText(note.title, note.body),
  folder_id: note.folder_id,
  pinned: note.pinned,
  base: note,
  status: { kind: 'saved' },
});

const dirty = (state: State) => Object.keys(changesFrom(state, state.base)).length > 0;

export function editorReducer(state: State, action: Action): State {
  const { status } = state;
  if (status.kind === 'gone') return state;
  switch (action.type) {
    case 'type':
    case 'set': {
      const next =
        action.type === 'type'
          ? { ...state, text: action.text }
          : {
              ...state,
              folder_id: action.folder_id !== undefined ? action.folder_id : state.folder_id,
              pinned: action.pinned ?? state.pinned,
            };
      // In flight or in conflict, the change just waits; the answer decides what happens next.
      if (status.kind === 'saving' || status.kind === 'conflict') return next;
      return {
        ...next,
        status: dirty(next) ? { kind: 'editing', soon: action.type === 'set' } : { kind: 'saved' },
      };
    }
    case 'sending':
      return { ...state, status: { kind: 'saving' } };
    case 'sent': {
      const next = { ...state, base: action.note };
      return {
        ...next,
        status: dirty(next) ? { kind: 'editing', soon: false } : { kind: 'saved' },
      };
    }
    case 'failed':
      return { ...state, status: { kind: 'failed' } };
    case 'conflict': {
      // Nothing of ours differs from theirs: just take the newer copy.
      if (Object.keys(changesFrom(state, action.theirs)).length === 0) return adopt(action.theirs);
      return { ...state, status: { kind: 'conflict', theirs: action.theirs } };
    }
    case 'arrived':
      if (action.note.rev <= state.base.rev) return state;
      if (status.kind === 'saved') return adopt(action.note);
      if (status.kind === 'conflict')
        return { ...state, status: { kind: 'conflict', theirs: action.note } };
      // Unsaved text here: the next save carries the old rev and comes back as a conflict.
      return state;
    case 'keep_mine':
      if (status.kind !== 'conflict') return state;
      // An explicit overwrite, but of the copy just seen: the save sends that rev, so a third
      // edit in between comes back as a conflict instead of being clobbered.
      return { ...state, base: status.theirs, status: { kind: 'editing', soon: true } };
    case 'take_theirs':
      return status.kind === 'conflict' ? adopt(status.theirs) : state;
    case 'gone':
      return { ...state, status: { kind: 'gone' } };
  }
}

/** What a save request came to. */
export type Outcome = Copy | 'conflict' | 'failed';

export interface CloseIo {
  save(changes: NoteChanges, expected_rev: number): Promise<Outcome>;
  /** Keep text that cannot be saved over the note (it changed elsewhere) as a note of its own. */
  rescue(text: string, folder_id: string | null): void;
}

/**
 * Closing keeps what was typed: it waits for the request in flight, then sends the rest against
 * the rev that request returned. Text that conflicts with a newer copy is rescued, never dropped.
 */
export async function saveOnClose(
  s: State,
  pending: Promise<Outcome> | null,
  io: CloseIo,
): Promise<void> {
  if (s.status.kind === 'gone') return;
  if (s.status.kind === 'conflict') return io.rescue(s.text, s.folder_id);
  let from = s.base;
  if (pending) {
    const out = await pending;
    if (out === 'conflict') return io.rescue(s.text, s.folder_id);
    if (out !== 'failed') from = out;
  }
  const changes = changesFrom(s, from);
  if (Object.keys(changes).length === 0) return;
  if ((await io.save(changes, from.rev)) === 'conflict') io.rescue(s.text, s.folder_id);
}

function words(text: string): number {
  const clean = text.trim();
  return clean ? clean.split(/\s+/).length : 0;
}

function saveText(status: Status, offline: boolean): string {
  switch (status.kind) {
    case 'saved':
      return 'Saved';
    case 'editing':
    case 'saving':
      return offline ? 'Offline, will save' : 'Saving';
    case 'failed':
      return 'Not saved yet';
    default:
      return '';
  }
}

export interface NoteEditorProps {
  note: Note;
  folders: NotesView['folders'];
  offline: boolean;
  /** Focus the writing surface at once, as for a note just made. */
  autoFocus: boolean;
  /** Resolves to the saved note; `expected_rev` guards against overwriting a newer edit. */
  onSave(changes: NoteChanges, expected_rev: number): Promise<Note>;
  /** The note changed elsewhere and was closed with unsaved text: keep that text as a new note. */
  onRescue(text: string, folder_id: string | null): void;
  onDelete(): void;
}

/** F42: one writing surface per note, saving itself as you go. */
export function NoteEditor({
  note,
  folders,
  offline,
  autoFocus,
  onSave,
  onRescue,
  onDelete,
}: NoteEditorProps) {
  const [state, dispatch] = useReducer(editorReducer, copyOf(note), adopt);
  // The latest state and callbacks, for the timer and the unmount flush.
  const current = useRef({ state, onSave, onRescue });
  current.current = { state, onSave, onRescue };
  // The one request in flight, which a close waits for.
  const inflight = useRef<Promise<Outcome> | null>(null);

  const request = (changes: NoteChanges, rev: number): Promise<Outcome> =>
    current.current
      .onSave(changes, rev)
      .then(copyOf, (error: unknown) =>
        error instanceof ApiError && error.code === 'conflict' ? 'conflict' : 'failed',
      );

  const flush = () => {
    const s = current.current.state;
    if (s.status.kind !== 'editing') return;
    const changes = changesFrom(s, s.base);
    if (Object.keys(changes).length === 0) return;
    dispatch({ type: 'sending' });
    const sent = request(changes, s.base.rev);
    inflight.current = sent;
    void sent.then((out) => {
      inflight.current = null;
      if (out === 'conflict') dispatch({ type: 'conflict', theirs: latest.current });
      else if (out === 'failed') dispatch({ type: 'failed' });
      else dispatch({ type: 'sent', note: out });
    });
  };

  // The newest copy from the list, which refetches after every change.
  const latest = useRef(copyOf(note));
  latest.current = copyOf(note);
  useEffect(() => {
    dispatch({ type: 'arrived', note: copyOf(note) });
  }, [note.rev]);

  const { status } = state;
  useEffect(() => {
    if (status.kind !== 'editing') return;
    const timer = setTimeout(() => flush(), status.soon ? 0 : SAVE_AFTER_MS);
    return () => clearTimeout(timer);
  }, [state.text, state.folder_id, state.pinned, status]);
  // Closing, or switching notes mid-sentence, still keeps what was typed. The editor answers
  // this note's conflicts until its last save settles, so the queue does not rescue twice.
  useEffect(() => {
    const release = holdConflicts(note.id);
    return () => {
      const { state: s, onRescue: rescue } = current.current;
      void saveOnClose(s, inflight.current, { save: request, rescue }).finally(release);
    };
  }, []);

  const { title } = splitText(state.text);
  return (
    <div className="note-editor">
      {status.kind === 'conflict' && (
        <div className="note-conflict" role="status">
          <span>This note changed somewhere else.</span>
          <button
            type="button"
            className="text-button"
            onClick={() => dispatch({ type: 'keep_mine' })}
          >
            Keep mine
          </button>
          <button
            type="button"
            className="text-button"
            onClick={() => dispatch({ type: 'take_theirs' })}
          >
            Take theirs
          </button>
        </div>
      )}
      <textarea
        className="note-surface"
        aria-label="Note"
        placeholder={'Title\nThen write anything…'}
        value={state.text}
        autoFocus={autoFocus}
        onChange={(e) => dispatch({ type: 'type', text: e.target.value })}
      />
      <div className="note-meta">
        <span className="note-save">{saveText(status, offline)}</span>
        <span>{words(state.text) === 1 ? '1 word' : `${words(state.text)} words`}</span>
        <span>Created {noteTime(note.created_at, true)}</span>
        <span>Edited {noteTime(note.updated_at, true)}</span>
      </div>
      <div className="note-actions">
        <label className="note-folder">
          <span>Folder</span>
          <select
            value={state.folder_id ?? ''}
            onChange={(e) => dispatch({ type: 'set', folder_id: e.target.value || null })}
          >
            <option value="">None</option>
            {folders.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="note-pin"
          aria-pressed={state.pinned}
          onClick={() => dispatch({ type: 'set', pinned: !state.pinned })}
        >
          <PinIcon />
          {state.pinned ? 'Pinned' : 'Pin'}
        </button>
        <button
          type="button"
          className="text-button"
          aria-label={`Delete note: ${title}`}
          onClick={() => {
            // Nothing left to save into once it is gone.
            dispatch({ type: 'gone' });
            current.current.state = { ...current.current.state, status: { kind: 'gone' } };
            onDelete();
          }}
        >
          Delete
        </button>
      </div>
    </div>
  );
}
