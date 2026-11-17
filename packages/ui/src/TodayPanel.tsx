import type { Task } from '@sirius/contracts';
import type { FormEvent } from 'react';
import { useEffect, useRef, useState } from 'react';
import { FoldTitle } from './Fold.tsx';
import { CheckIcon, CloseIcon, PlusIcon, SproutIcon } from './Icons.tsx';
import { useEntrance, useLeaving } from './motion.ts';

export interface TodayPanelProps {
  tasks: Task[];
  restingTomorrow: number;
  dimmed: boolean;
  onToggle(task: Task): void;
  onAdd(title: string): void;
  onDrop(task: Task): void;
  /** False while the data is still loading, so the empty line waits. */
  loaded?: boolean;
}

const PLANTED_MS = 2200;

/** "Added to Today.": `at` replays its entrance on each add; `shown` false lets it fade out. */
interface Planted {
  at: number;
  shown: boolean;
}

function TaskRow({
  task,
  small,
  seen,
  onToggle,
  onDrop,
}: {
  task: Task;
  small: boolean;
  seen: Set<string>;
  onToggle(task: Task): void;
  onDrop(row: HTMLElement | null, task: Task): void;
}) {
  const done = task.status === 'done';
  // A row the core has not stored yet: nothing to tick or drop until it answers.
  const pending = 'pending' in task && task.pending === true;
  const className = ['task', small && 'task-small', done && 'task-done'].filter(Boolean).join(' ');
  const entrance = useEntrance(seen, task.title);
  const row = useRef<HTMLLIElement>(null);
  return (
    <li
      ref={row}
      className={`task-row ${entrance.className}`}
      onAnimationEnd={entrance.onAnimationEnd}
    >
      <button
        type="button"
        className={className}
        aria-label={`${done ? 'Mark not done' : 'Mark done'}: ${task.title}`}
        disabled={pending}
        onClick={() => onToggle(task)}
      >
        <span className="task-check">
          {done && (
            <CheckIcon size={small ? 11 : 13} stroke={small ? 'var(--muted)' : 'var(--ink)'} />
          )}
        </span>
        <span className="task-text">{task.title}</span>
      </button>
      {!done && (
        <button
          type="button"
          className="task-drop"
          aria-label={`Let go of: ${task.title}`}
          disabled={pending}
          onClick={() => onDrop(row.current, task)}
        >
          <CloseIcon size={18} />
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
  loaded = true,
}: TodayPanelProps) {
  const [draft, setDraft] = useState('');
  const [planted, setPlanted] = useState<Planted | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const seen = useRef(new Set<string>()).current;
  const leave = useLeaving();
  const drop = (row: HTMLElement | null, task: Task) => leave(row, () => onDrop(task));

  const priorities = tasks.filter((t) => t.tier === 'priority');
  const smalls = tasks.filter((t) => t.tier === 'small');

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const clean = draft.trim();
    if (!clean) return;
    onAdd(clean);
    setDraft('');
    setPlanted({ at: Date.now(), shown: true });
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setPlanted((p) => p && { ...p, shown: false }), PLANTED_MS);
  };

  // Only something worth knowing goes here. The old slogans read as filler.
  const meta = restingTomorrow > 0 ? `${restingTomorrow} moved to tomorrow` : null;

  return (
    <section className={`panel panel-dimmable rise d1 ${dimmed ? 'panel-dim' : ''}`}>
      <div className="panel-head">
        <h2>
          <FoldTitle>Today</FoldTitle>
        </h2>
        {meta && <span className="label">{meta}</span>}
      </div>
      <ul className="tasks">
        {priorities.map((t) => (
          <TaskRow
            key={t.id}
            task={t}
            small={false}
            seen={seen}
            onToggle={onToggle}
            onDrop={drop}
          />
        ))}
      </ul>
      {loaded && tasks.length === 0 && <p className="empty-line">Nothing for today yet.</p>}
      {smalls.length > 0 && (
        <div className="smalls">
          <ul className="tasks">
            {smalls.map((t) => (
              <TaskRow key={t.id} task={t} small seen={seen} onToggle={onToggle} onDrop={drop} />
            ))}
          </ul>
        </div>
      )}
      <form className="quick-add" onSubmit={submit}>
        <input
          type="text"
          aria-label="Add a task"
          placeholder="Add a task"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
        <button type="submit" className="round" aria-label="Add task">
          <PlusIcon />
        </button>
        {/* Over the empty input, so its coming and going never resizes the card. */}
        {planted && (
          <div
            className="planted"
            key={planted.at}
            data-shown={(planted.shown && !draft) || undefined}
          >
            <SproutIcon />
            <span>Added to Today.</span>
          </div>
        )}
      </form>
    </section>
  );
}
