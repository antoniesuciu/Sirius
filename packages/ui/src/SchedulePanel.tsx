import {
  addDays,
  occurrencesOn,
  type ScheduleEvent,
  type ScheduleOccurrence,
  WEEKDAY_NAMES,
  weekdayOf,
} from '@sirius/contracts';
import { type FormEvent, useState } from 'react';
import { InlineEdit } from './InlineEdit.tsx';

export interface NewScheduleEvent {
  title: string;
  weekdays?: number;
  date?: string;
  start_local: string;
  end_local?: string;
  location?: string;
}

export interface SchedulePanelProps {
  events: ScheduleEvent[];
  /** The logical date the dashboard is showing. */
  today: string;
  onAdd(event: NewScheduleEvent): void;
  onRename(id: string, title: string): void;
  onDelete(id: string): void;
}

const FULL_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

function Row({
  occurrence,
  onRename,
  onDelete,
}: {
  occurrence: ScheduleOccurrence;
  onRename(id: string, title: string): void;
  onDelete(id: string): void;
}) {
  const time = occurrence.end_local
    ? `${occurrence.start_local}–${occurrence.end_local}`
    : occurrence.start_local;
  return (
    <li className="sched-row msg">
      <InlineEdit
        title={occurrence.title}
        noun="schedule item"
        onRename={(title) => onRename(occurrence.event_id, title)}
        onDelete={() => onDelete(occurrence.event_id)}
      >
        <div className="sched-item">
          <span className="sched-time">{time}</span>
          <span className="sched-text">
            <span className="sched-title">{occurrence.title}</span>
            {occurrence.location && <span className="sched-place">{occurrence.location}</span>}
          </span>
        </div>
      </InlineEdit>
    </li>
  );
}

function AddForm({ onAdd, onClose }: { onAdd(event: NewScheduleEvent): void; onClose(): void }) {
  const [title, setTitle] = useState('');
  const [days, setDays] = useState(0);
  const [date, setDate] = useState('');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [place, setPlace] = useState('');
  const ready = title.trim() && start && (days > 0 || date) && (!end || end > start);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!ready) return;
    onAdd({
      title: title.trim(),
      start_local: start,
      ...(date ? { date } : { weekdays: days }),
      ...(end ? { end_local: end } : {}),
      ...(place.trim() ? { location: place.trim() } : {}),
    });
    onClose();
  };

  return (
    <form className="sched-form" onSubmit={submit}>
      <input
        aria-label="What"
        placeholder="Lecture, gym, shift…"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
      />
      <div className="sched-days" role="group" aria-label="Every week on">
        {WEEKDAY_NAMES.map((name, i) => (
          <button
            key={name}
            type="button"
            className="day-chip"
            aria-label={FULL_NAMES[i]}
            aria-pressed={(days & (1 << i)) !== 0}
            onClick={() => {
              setDate('');
              setDays((d) => d ^ (1 << i));
            }}
          >
            {name.charAt(0)}
          </button>
        ))}
      </div>
      <label className="sched-field">
        <span>or once on</span>
        <input
          type="date"
          aria-label="Once on"
          value={date}
          onChange={(e) => {
            setDays(0);
            setDate(e.target.value);
          }}
        />
      </label>
      <div className="sched-times">
        <label className="sched-field">
          <span>from</span>
          <input
            type="time"
            aria-label="Starts"
            value={start}
            onChange={(e) => setStart(e.target.value)}
          />
        </label>
        <label className="sched-field">
          <span>to</span>
          <input
            type="time"
            aria-label="Ends"
            value={end}
            onChange={(e) => setEnd(e.target.value)}
          />
        </label>
      </div>
      <input
        aria-label="Where"
        placeholder="Where (optional)"
        value={place}
        onChange={(e) => setPlace(e.target.value)}
      />
      <div className="sched-actions">
        <button type="submit" className="pill" disabled={!ready}>
          Save
        </button>
        <button type="button" className="text-button" onClick={onClose}>
          Cancel
        </button>
      </div>
    </form>
  );
}

/** F37: fixed commitments, today or the coming week. Never mixed with today's tasks. */
export function SchedulePanel({ events, today, onAdd, onRename, onDelete }: SchedulePanelProps) {
  const [view, setView] = useState<'today' | 'week'>('today');
  const [adding, setAdding] = useState(false);
  const week = Array.from({ length: 7 }, (_, i) => addDays(today, i))
    .map((date) => ({ date, items: occurrencesOn(events, date) }))
    .filter((day) => day.items.length > 0);
  const todays = occurrencesOn(events, today);
  const row = (o: ScheduleOccurrence) => (
    <Row key={`${o.event_id}-${o.date}`} occurrence={o} onRename={onRename} onDelete={onDelete} />
  );

  return (
    <section className="panel panel-schedule rise d1">
      <div className="panel-head">
        <h2>Schedule</h2>
        <div className="sched-views" role="group" aria-label="Show">
          <button
            type="button"
            className="text-button"
            aria-pressed={view === 'today'}
            onClick={() => setView('today')}
          >
            Today
          </button>
          <button
            type="button"
            className="text-button"
            aria-pressed={view === 'week'}
            onClick={() => setView('week')}
          >
            Week
          </button>
        </div>
      </div>
      {view === 'today' &&
        (todays.length > 0 ? (
          <ul className="sched-list">{todays.map(row)}</ul>
        ) : (
          <p className="sched-empty">Nothing scheduled today.</p>
        ))}
      {view === 'week' &&
        (week.length > 0 ? (
          week.map((day) => (
            <div className="sched-day" key={day.date}>
              <span className="label">
                {day.date === today
                  ? 'Today'
                  : `${WEEKDAY_NAMES[weekdayOf(day.date)]} ${Number(day.date.slice(8))}`}
              </span>
              <ul className="sched-list">{day.items.map(row)}</ul>
            </div>
          ))
        ) : (
          <p className="sched-empty">Nothing scheduled this week.</p>
        ))}
      {adding ? (
        <AddForm onAdd={onAdd} onClose={() => setAdding(false)} />
      ) : (
        <button type="button" className="text-button sched-add" onClick={() => setAdding(true)}>
          Add to schedule
        </button>
      )}
    </section>
  );
}
