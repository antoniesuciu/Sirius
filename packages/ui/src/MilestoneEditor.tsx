import { ApiError, holdConflicts, type OpInput, type StepView } from '@sirius/contracts';
import { useEffect, useState } from 'react';
import { type Copy, sync, theirChanges } from './milestoneCopy.ts';

const copyOf = (step: StepView): Copy => ({
  title: step.title,
  description: step.description,
  notes: step.notes,
  rev: step.rev,
});

export function MilestoneEditor({
  step,
  number,
  current,
  onUpdate,
  onStepToToday,
}: {
  step: StepView;
  /** Such as "2 of 6": where it sits on the route. */
  number: string;
  current: boolean;
  onUpdate(input: OpInput<'update_roadmap_step'>): Promise<unknown>;
  onStepToToday(id: string): void;
}) {
  // `base` is the copy the form was read from: its rev guards Save against an agent's edit.
  const [base, setBase] = useState(() => copyOf(step));
  const [title, setTitle] = useState(step.title);
  const [description, setDescription] = useState(step.description);
  const [notes, setNotes] = useState(step.notes);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const incoming = copyOf(step);
  const form = { title, description, notes };
  const outcome = sync(form, base, incoming);
  // While open, this editor answers its step's conflicts; once closed, the queue keeps the text.
  useEffect(() => holdConflicts(step.id), [step.id]);
  useEffect(() => {
    if (outcome.kind !== 'merge') return;
    setBase(incoming);
    setTitle(outcome.fields.title);
    setDescription(outcome.fields.description);
    setNotes(outcome.fields.notes);
  }, [step.rev]);
  const conflict = outcome.kind === 'conflict';
  const save = async (input: OpInput<'update_roadmap_step'>) => {
    setSaving(true);
    setError('');
    setMessage('');
    try {
      const saved = await onUpdate({ ...input, expected_rev: base.rev });
      // The returned rev, so a second Save before the refetch does not conflict with itself.
      const rev = saved && typeof saved === 'object' && 'rev' in saved ? saved.rev : undefined;
      if (typeof rev === 'number') setBase({ ...form, rev });
      setMessage('Saved');
    } catch (e) {
      // The step prop catches up and shows the choice below; Save waits for it.
      setError(
        e instanceof ApiError && e.code === 'conflict'
          ? 'This milestone changed somewhere else.'
          : e instanceof Error
            ? e.message
            : 'Could not save milestone.',
      );
    } finally {
      setSaving(false);
    }
  };
  return (
    <details className="milestone-editor" open>
      <summary>
        <span>{step.title}</span>
        <span className="milestone-meta">
          <small>Milestone {number}</small>
          <small>
            {step.status === 'done' ? 'Complete' : current ? 'You are here' : 'Upcoming'}
          </small>
          {step.est_minutes ? <small>{step.est_minutes} min</small> : null}
        </span>
      </summary>
      {step.done_at && (
        <p className="roadmap-subtitle">Completed {new Date(step.done_at).toLocaleDateString()}</p>
      )}
      {step.worked_on.length > 0 && (
        <p className="roadmap-subtitle">{workedOnLabel(step.worked_on)}</p>
      )}
      {conflict && (
        <div className="note-conflict" role="status">
          <span>This milestone changed somewhere else.</span>
          <button type="button" className="text-button" onClick={() => setBase(incoming)}>
            Keep mine
          </button>
          <button
            type="button"
            className="text-button"
            onClick={() => {
              setBase(incoming);
              setTitle(incoming.title);
              setDescription(incoming.description);
              setNotes(incoming.notes);
            }}
          >
            Take theirs
          </button>
          <ul>
            {theirChanges(base, incoming).map((c) => (
              <li key={c.label}>
                {c.label}: {c.value}
              </li>
            ))}
          </ul>
        </div>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void save({ id: step.id, title: title.trim(), description, notes });
        }}
      >
        <label>
          Milestone
          <input
            value={title}
            maxLength={240}
            required
            onChange={(e) => {
              setTitle(e.target.value);
              setMessage('');
            }}
          />
        </label>
        <label>
          What to cover
          <textarea
            value={description}
            maxLength={10000}
            rows={2}
            placeholder="Topics, resources, and what finishing means."
            onChange={(e) => {
              setDescription(e.target.value);
              setMessage('');
            }}
          />
        </label>
        <label>
          Progress notes
          <textarea
            value={notes}
            maxLength={20000}
            rows={3}
            placeholder="What you did, what you learned, and what's left."
            onChange={(e) => {
              setNotes(e.target.value);
              setMessage('');
            }}
          />
        </label>
        <div className="milestone-actions">
          <button type="submit" className="pill" disabled={saving || conflict || !title.trim()}>
            {saving ? 'Saving…' : 'Save notes'}
          </button>
          <button
            type="button"
            className="text-button"
            disabled={saving || conflict}
            onClick={() =>
              void save({
                id: step.id,
                title: title.trim(),
                description,
                notes,
                status: step.status === 'done' ? 'todo' : 'done',
              })
            }
          >
            {step.status === 'done' ? 'Reopen milestone' : 'Mark complete'}
          </button>
          {step.status === 'todo' && (
            <button type="button" className="text-button" onClick={() => onStepToToday(step.id)}>
              Put it in Today
            </button>
          )}
        </div>
        <span role="status">{message}</span>
        {error && <p role="alert">{error}</p>}
      </form>
    </details>
  );
}

/** "Worked on 3 days, last on 7 November": the history of ticks in Today. */
export function workedOnLabel(days: string[]): string {
  const last = new Date(`${days.at(-1)}T12:00:00`).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
  });
  return days.length === 1
    ? `Worked on it on ${last}`
    : `Worked on ${days.length} days, last on ${last}`;
}
