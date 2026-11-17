import type { ListItem } from '@sirius/contracts';
import { type FormEvent, useRef, useState } from 'react';
import { FoldTitle } from './Fold.tsx';
import { PlusIcon } from './Icons.tsx';
import { useEntrance, useLeaving } from './motion.ts';

export interface ListPanelProps {
  items: ListItem[];
  onAdd(text: string): void;
  onTick(item: ListItem): void;
  /** False while the data is still loading, so the empty line waits. */
  loaded?: boolean;
}

function ListRow({
  item,
  seen,
  onTick,
}: {
  item: ListItem;
  seen: Set<string>;
  onTick(row: HTMLElement | null, item: ListItem): void;
}) {
  const entrance = useEntrance(seen, item.text);
  const row = useRef<HTMLLIElement>(null);
  return (
    <li
      ref={row}
      className={`task-row ${entrance.className}`}
      onAnimationEnd={entrance.onAnimationEnd}
    >
      <button
        type="button"
        className="task task-small"
        aria-label={`Tick off: ${item.text}`}
        // Not stored by the core yet, so there is nothing to tick.
        disabled={'pending' in item && item.pending === true}
        onClick={() => onTick(row.current, item)}
      >
        <span className="task-check" />
        <span className="task-text">{item.text}</span>
      </button>
    </li>
  );
}

/** F35: things to remember or buy. No day, no time: ticking one off simply clears it. */
export function ListPanel({ items, onAdd, onTick, loaded = true }: ListPanelProps) {
  const [draft, setDraft] = useState('');
  const seen = useRef(new Set<string>()).current;
  const leave = useLeaving();
  const tick = (row: HTMLElement | null, item: ListItem) => leave(row, () => onTick(item));
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const clean = draft.trim();
    if (!clean) return;
    onAdd(clean);
    setDraft('');
  };

  return (
    // Not dimmed in quiet mode: a shopping list is not work (F4 dims Today and Goals only).
    <section className="panel panel-list rise d4">
      <div className="panel-head">
        <h2>
          <FoldTitle>To remember</FoldTitle>
        </h2>
      </div>
      {items.length > 0 ? (
        <ul className="tasks">
          {items.map((item) => (
            <ListRow key={item.id} item={item} seen={seen} onTick={tick} />
          ))}
        </ul>
      ) : (
        loaded && <p className="empty-line">Nothing to remember.</p>
      )}
      <form className="quick-add" onSubmit={submit}>
        <input
          type="text"
          aria-label="Add to the list"
          placeholder="Milk, a birthday card…"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
        <button type="submit" className="round" aria-label="Add to list">
          <PlusIcon />
        </button>
      </form>
    </section>
  );
}
