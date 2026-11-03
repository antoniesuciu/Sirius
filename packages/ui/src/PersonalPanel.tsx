import type { ReminderView } from '@sirius/contracts';

export interface PersonalPanelProps {
  reminders: ReminderView[];
  onToggle(reminder: ReminderView): void;
  onSnooze(reminder: ReminderView): void;
}

function note(reminders: ReminderView[], now: number): string {
  const upcoming = reminders
    .filter((r) => r.enabled && r.next_fire_at !== null && r.next_fire_at > now)
    .sort((a, b) => (a.next_fire_at ?? 0) - (b.next_fire_at ?? 0))[0];
  if (!upcoming) return 'No reminders set.';
  return `Next reminder at ${upcoming.time_local}.`;
}

export function PersonalPanel({ reminders, onToggle, onSnooze }: PersonalPanelProps) {
  return (
    <section className="panel panel-personal rise d4">
      <div className="panel-head">
        <h2>Personal</h2>
        <span className="label">Prayer · reflection</span>
      </div>
      <p className="personal-note">{note(reminders, Date.now())}</p>
      {reminders.map((r) => (
        <div className="reminder" key={r.id}>
          <span className="reminder-label">{r.label}</span>
          {r.enabled && (
            <button
              type="button"
              className="text-button"
              aria-label={`Later: ${r.label}`}
              onClick={() => onSnooze(r)}
            >
              Later
            </button>
          )}
          <button
            type="button"
            className="switch"
            role="switch"
            aria-checked={r.enabled}
            aria-label={r.label}
            onClick={() => onToggle(r)}
          >
            <span className="switch-track">
              <span className="switch-knob" />
            </span>
          </button>
        </div>
      ))}
    </section>
  );
}
