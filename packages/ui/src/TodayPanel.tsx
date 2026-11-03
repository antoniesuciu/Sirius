import type { Task } from '@sirius/contracts';
import type { FormEvent } from 'react';
import { useEffect, useRef, useState } from 'react';
import { CheckIcon, PlusIcon, SproutIcon } from './Icons.tsx';

export interface TodayPanelProps {
  tasks: Task[];
  restingTomorrow: number;
  dimmed: boolean;
  onToggle(task: Task): void;
  onAdd(title: string): void;
  onDrop(task: Task): void;
}

const PLANTED_MS = 2200;

function TaskRow({
  task,
  small,
  onToggle,
  onDrop,
}: {
  task: Task;
  small: boolean;
  onToggle(task: Task): void;
  onDrop(task: Task): void;
}) {
  const done = task.status === 'done';
  const className = ['task', small && 'task-small', done && 'task-done'].filter(Boolean).join(' ');
  return (
    <li className="msg task-row">
      <button
        type="button"
        className={className}
        aria-label={`${done ? 'Mark not done' : 'Mark done'}: ${task.title}`}
        onClick={() => onToggle(task)}
      >
        <span className="task-check">
          {done && <CheckIcon size={small ? 11 : 13} stroke={small ? '#5F5849' : '#1A1814'} />}
        </span>
        <span className="task-text">{task.title}</span>
      </button>
      {!done && (
        <button
          type="button"
          className="task-drop"
          aria-label={`Let go of: ${task.title}`}
          onClick={() => onDrop(task)}
        >
          ×
        </button>
      )}
    </li>
  );
}

export function TodayPanel({
  tasks,
  restingTomorrow,
  dimmed,
  onToggle,
  onAdd,
  onDrop,
}: TodayPanelProps) {
  const [draft, setDraft] = useState('');
  const [plantedAt, setPlantedAt] = useState<number | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  const priorities = tasks.filter((t) => t.tier === 'priority');
  const smalls = tasks.filter((t) => t.tier === 'small');

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const clean = draft.trim();
    if (!clean) return;
    onAdd(clean);
    setDraft('');
    setPlantedAt(Date.now());
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setPlantedAt(null), PLANTED_MS);
  };

  // Only something worth knowing goes here. The old slogans read as filler.
  const meta = restingTomorrow > 0 ? `${restingTomorrow} resting until tomorrow` : null;

  return (
    <section className={`panel panel-dimmable rise d1 ${dimmed ? 'panel-dim' : ''}`}>
      <div className="panel-head">
        <h2>Today</h2>
        {meta && <span className="label">{meta}</span>}
      </div>
      <ul className="tasks">
        {priorities.map((t) => (
          <TaskRow key={t.id} task={t} small={false} onToggle={onToggle} onDrop={onDrop} />
        ))}
      </ul>
      {smalls.length > 0 && (
        <div className="smalls">
          <ul className="tasks">
            {smalls.map((t) => (
              <TaskRow key={t.id} task={t} small onToggle={onToggle} onDrop={onDrop} />
            ))}
          </ul>
        </div>
      )}
      <form className="quick-add" onSubmit={submit}>
        <input
          type="text"
          aria-label="Add a task"
          placeholder="Add something small"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
        <button type="submit" className="round" aria-label="Add task">
          <PlusIcon />
        </button>
      </form>
      {plantedAt !== null && (
        <div className="planted" key={plantedAt}>
          <SproutIcon />
          <span>Planted in Today.</span>
        </div>
      )}
    </section>
  );
}
