import type { OpInput, RoadmapStep } from '@sirius/contracts';
import { useState } from 'react';

export function MilestoneEditor({
  step,
  current,
  onUpdate,
  onStepToToday,
}: {
  step: RoadmapStep;
  current: boolean;
  onUpdate(input: OpInput<'update_roadmap_step'>): Promise<unknown>;
  onStepToToday(id: string): void;
}) {
  const [title, setTitle] = useState(step.title);
  const [description, setDescription] = useState(step.description);
  const [notes, setNotes] = useState(step.notes);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const save = async (input: OpInput<'update_roadmap_step'>) => {
    setSaving(true);
    setError('');
    setMessage('');
    try {
      await onUpdate(input);
      setMessage('Saved');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save milestone.');
    } finally {
      setSaving(false);
    }
  };
  return (
    <details className="milestone-editor" open>
      <summary>
        <span>{step.title}</span>
        <small>
          {step.status === 'done' ? 'Complete' : current ? 'You are here' : 'Upcoming'}
          {step.est_minutes ? ` · ${step.est_minutes} min` : ''}
        </small>
      </summary>
      {step.done_at && (
        <p className="roadmap-subtitle">Completed {new Date(step.done_at).toLocaleDateString()}</p>
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
          <button type="submit" className="pill" disabled={saving || !title.trim()}>
            {saving ? 'Saving…' : 'Save notes'}
          </button>
          <button
            type="button"
            className="text-button"
            disabled={saving}
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
