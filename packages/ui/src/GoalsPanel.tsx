import type { GoalView } from '@sirius/contracts';
import { type FormEvent, useState } from 'react';
import { PlusIcon } from './Icons.tsx';
import { InlineEdit } from './InlineEdit.tsx';

export interface GoalsPanelProps {
  goals: GoalView[];
  dimmed: boolean;
  onRename(id: string, title: string): void;
  onDelete(id: string): void;
  onAdd(title: string): void;
}

const MAX_DOTS = 5;

function whenLabel(goal: GoalView): string {
  if (goal.horizon_text) return goal.horizon_text;
  if (goal.target_date) {
    const date = new Date(`${goal.target_date}T12:00:00`);
    return `By ${date.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}`;
  }
  return 'No deadline yet';
}

/** F9: one dot per milestone, up to five, then the latest five. Never a percentage. */
function Dots({ goal }: { goal: GoalView }) {
  const visible = goal.milestones.slice(-MAX_DOTS);
  if (visible.length === 0) return null;
  const done = goal.milestones.filter((m) => m.done_at !== null).length;
  return (
    <div
      className="goal-dots"
      role="img"
      aria-label={`${done} of ${goal.milestones.length} milestones reached`}
    >
      {visible.map((m) => (
        <span key={m.id} className={`goal-dot ${m.done_at !== null ? 'goal-dot-on' : ''}`} />
      ))}
    </div>
  );
}

export function GoalsPanel({ goals, dimmed, onRename, onDelete, onAdd }: GoalsPanelProps) {
  const [draft, setDraft] = useState('');
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const clean = draft.trim();
    if (!clean) return;
    onAdd(clean);
    setDraft('');
  };
  return (
    <section className={`panel panel-goals panel-dimmable rise d2 ${dimmed ? 'panel-dim' : ''}`}>
      <div className="panel-head">
        <h2>Goals</h2>
      </div>
      {goals.map((goal) => (
        <div className="goal msg" key={goal.id}>
          <InlineEdit
            title={goal.title}
            noun="goal"
            onRename={(title) => onRename(goal.id, title)}
            onDelete={() => onDelete(goal.id)}
          >
            <div className="goal-text">
              <span className="goal-title">{goal.title}</span>
              <span className="goal-when">{whenLabel(goal)}</span>
            </div>
          </InlineEdit>
          <Dots goal={goal} />
        </div>
      ))}
      <form className="quick-add" onSubmit={submit}>
        <input
          type="text"
          aria-label="Add a goal"
          placeholder="Add a goal"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
        <button type="submit" className="round" aria-label="Add goal">
          <PlusIcon />
        </button>
      </form>
    </section>
  );
}
