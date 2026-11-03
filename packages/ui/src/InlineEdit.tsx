import type { FormEvent, KeyboardEvent, ReactNode } from 'react';
import { useState } from 'react';

export interface InlineEditProps {
  title: string;
  /** Names the item for screen readers, e.g. "goal". */
  noun: string;
  onRename(title: string): void;
  onDelete(): void;
  children: ReactNode;
}

/** F10: the only editing UI goals and roadmaps get. Everything else goes through Sirius. */
export function InlineEdit({ title, noun, onRename, onDelete, children }: InlineEditProps) {
  const [draft, setDraft] = useState<string | null>(null);
  // A delete has no undo for the user, so it asks once more.
  const [confirming, setConfirming] = useState(false);

  const save = (e: FormEvent) => {
    e.preventDefault();
    const clean = draft?.trim();
    if (clean && clean !== title) onRename(clean);
    setDraft(null);
    setConfirming(false);
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      setDraft(null);
      setConfirming(false);
    }
  };

  if (draft === null) {
    return (
      <div className="editable">
        {children}
        <button
          type="button"
          className="text-button edit-trigger"
          aria-label={`Edit ${noun}: ${title}`}
          onClick={() => setDraft(title)}
        >
          Edit
        </button>
      </div>
    );
  }
  return (
    <form className="inline-edit" onSubmit={save}>
      <input
        aria-label={`Rename ${noun}`}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={onKey}
        autoFocus
      />
      {confirming ? (
        <>
          <span className="confirm-question">Delete for good?</span>
          <button type="button" className="text-button" onClick={onDelete}>
            Yes, delete
          </button>
          <button type="button" className="text-button" onClick={() => setConfirming(false)}>
            Keep
          </button>
        </>
      ) : (
        <>
          <button type="submit" className="text-button">
            Save
          </button>
          <button type="button" className="text-button" onClick={() => setConfirming(true)}>
            Delete
          </button>
        </>
      )}
    </form>
  );
}
