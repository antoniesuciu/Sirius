import type { ListItem } from '@sirius/contracts';
import { type FormEvent, useState } from 'react';
import { PlusIcon } from './Icons.tsx';

export interface ListPanelProps {
  items: ListItem[];
  onAdd(text: string): void;
  onTick(item: ListItem): void;
}

/** F35: things to remember or buy. No day, no time: ticking one off simply clears it. */
export function ListPanel({ items, onAdd, onTick }: ListPanelProps) {
  const [draft, setDraft] = useState('');
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
        <h2>To remember</h2>
      </div>
      {items.length > 0 && (
        <ul className="tasks">
          {items.map((item) => (
            <li className="msg task-row" key={item.id}>
              <button
                type="button"
                className="task task-small"
                aria-label={`Tick off: ${item.text}`}
                onClick={() => onTick(item)}
              >
                <span className="task-check" />
                <span className="task-text">{item.text}</span>
              </button>
            </li>
          ))}
        </ul>
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
