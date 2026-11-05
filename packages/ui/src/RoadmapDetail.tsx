import type { OpInput, RoadmapView } from '@sirius/contracts';
import { useEffect, useRef, useState } from 'react';
import { MilestoneEditor } from './MilestoneEditor.tsx';
import { RoadmapRoute } from './RoadmapRoute.tsx';

export interface RoadmapActions {
  onStepToToday(id: string): void;
  onUpdateStep(input: OpInput<'update_roadmap_step'>): Promise<unknown>;
  onAddStep(input: OpInput<'add_roadmap_step'>): Promise<unknown>;
}

export function RoadmapDetail({
  roadmap,
  onClose,
  onUpdateStep,
  onAddStep,
  onStepToToday,
}: RoadmapActions & { roadmap: RoadmapView; onClose(): void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [selected, setSelected] = useState(
    () => roadmap.steps.find((s) => s.status === 'todo')?.id ?? roadmap.steps[0]?.id,
  );
  const [title, setTitle] = useState('');
  const [error, setError] = useState('');
  const [adding, setAdding] = useState(false);
  const done = roadmap.steps.filter((s) => s.status === 'done').length;
  const current = roadmap.steps.find((s) => s.status === 'todo');
  useEffect(() => {
    const el = dialog.current;
    el?.showModal();
    return () => el?.close();
  }, []);
  const selectedStep = roadmap.steps.find((s) => s.id === selected) ?? current ?? roadmap.steps[0];
  return (
    <dialog
      ref={dialog}
      className="roadmap-dialog"
      aria-labelledby="roadmap-heading"
      onCancel={onClose}
    >
      <header className="roadmap-detail-head">
        <div>
          <p className="label">Learning / Roadmap</p>
          <h2 id="roadmap-heading">{roadmap.title}</h2>
        </div>
        <button type="button" className="pill" onClick={onClose} aria-label="Close roadmap">
          ← Dashboard
        </button>
      </header>
      {roadmap.subtitle && <p className="roadmap-subtitle">{roadmap.subtitle}</p>}
      <div className="roadmap-position">
        <span>
          {done} of {roadmap.steps.length} milestones complete
        </span>
        <strong>
          {current
            ? `You are here: ${current.title}`
            : roadmap.steps.length
              ? 'Route complete'
              : 'Build your route'}
        </strong>
      </div>
      <div className="roadmap-explorer">
        <RoadmapRoute
          steps={roadmap.steps}
          currentId={current?.id}
          selectedId={selectedStep?.id}
          onSelect={(id) => {
            setSelected(id);
            if (window.matchMedia('(max-width: 700px)').matches)
              dialog.current?.querySelector('.checkpoint-detail')?.scrollIntoView({
                behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches
                  ? 'instant'
                  : 'smooth',
              });
          }}
        />
        <aside className="checkpoint-detail" aria-label="Selected milestone">
          <p className="label">
            Checkpoint{' '}
            {selectedStep ? String(roadmap.steps.indexOf(selectedStep) + 1).padStart(2, '0') : '01'}
          </p>
          {roadmap.steps.map((step) => (
            <div key={step.id} hidden={step.id !== selectedStep?.id}>
              <MilestoneEditor
                step={step}
                current={step.id === current?.id}
                onUpdate={onUpdateStep}
                onStepToToday={onStepToToday}
              />
            </div>
          ))}
          <form
            className="milestone-add"
            onSubmit={async (e) => {
              e.preventDefault();
              if (!title.trim()) return;
              setAdding(true);
              setError('');
              try {
                await onAddStep({ roadmap_id: roadmap.id, title: title.trim() });
                setTitle('');
              } catch (e) {
                setError(e instanceof Error ? e.message : 'Could not add milestone.');
              } finally {
                setAdding(false);
              }
            }}
          >
            <label htmlFor="milestone-title">Add a milestone</label>
            <div>
              <input
                id="milestone-title"
                value={title}
                maxLength={240}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="What comes next?"
                required
              />
              <button className="pill" type="submit" disabled={adding}>
                {adding ? 'Adding…' : 'Add milestone'}
              </button>
            </div>
            {error && <p role="alert">{error}</p>}
          </form>
        </aside>
      </div>
    </dialog>
  );
}
