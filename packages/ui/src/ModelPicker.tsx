import type { KeyboardEvent } from 'react';
import { useEffect, useRef, useState } from 'react';
import { CheckIcon } from './Icons.tsx';

export interface ModelPickerProps {
  models: Array<{ id: string; label: string }>;
  value: string;
  onChange(id: string): void;
}

/** A listbox of its own, because a native select's popup is drawn by GTK and ignores the page. */
export function ModelPicker({ models, value, onChange }: ModelPickerProps) {
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(0);
  const button = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const chosen = models.find((model) => model.id === value);

  useEffect(() => {
    if (open) list.current?.focus();
  }, [open]);

  const show = () => {
    setCursor(Math.max(0, models.indexOf(chosen as (typeof models)[number])));
    setOpen(true);
  };
  const close = () => {
    setOpen(false);
    button.current?.focus();
  };
  const pick = (id: string) => {
    if (id !== value) onChange(id);
    close();
  };

  const onListKey = (event: KeyboardEvent) => {
    const moves: Record<string, number> = { ArrowDown: 1, ArrowUp: -1 };
    const move = moves[event.key];
    if (move) {
      event.preventDefault();
      setCursor((at) => (at + move + models.length) % models.length);
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      const model = models[cursor];
      if (model) pick(model.id);
    } else if (event.key === 'Escape') {
      close();
    } else if (event.key === 'Tab') {
      setOpen(false);
    }
  };

  return (
    <div
      className="model-picker"
      // Focus leaving the picker is what closes it, whether by click or by keyboard.
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
    >
      <button
        ref={button}
        type="button"
        className="model-button"
        aria-label={`Model: ${chosen?.label ?? 'none'}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => (open ? close() : show())}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            show();
          }
        }}
      >
        <span className="model-label">{chosen?.label ?? '—'}</span>
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
          <path d="M2 3.5l3 3 3-3" />
        </svg>
      </button>
      {open && (
        <ul
          ref={list}
          className="model-list"
          role="listbox"
          aria-label="Model"
          tabIndex={-1}
          aria-activedescendant={`model-${models[cursor]?.id}`}
          onKeyDown={onListKey}
        >
          {models.map((model, index) => (
            // Keyboard use lives on the listbox above, through aria-activedescendant.
            <li
              key={model.id}
              id={`model-${model.id}`}
              role="option"
              aria-selected={model.id === value}
              className={index === cursor ? 'cursor' : undefined}
              onClick={() => pick(model.id)}
              onMouseEnter={() => setCursor(index)}
            >
              {model.label}
              {model.id === value && <CheckIcon size={14} stroke="var(--accent)" />}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
