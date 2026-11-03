import type { ReminderView } from '@sirius/contracts';
import { useEffect, useState } from 'react';

export interface WellbeingPanelProps {
  nudge: ReminderView | null;
  onSnoozeNudge(reminder: ReminderView): void;
  /** Bumped from outside to start the exercise (the "start breathing" voice command). */
  startSignal: number;
}

const HALF_CYCLE_MS = 4000;

export function WellbeingPanel({ nudge, onSnoozeNudge, startSignal }: WellbeingPanelProps) {
  const [breathing, setBreathing] = useState(false);
  const [inhale, setInhale] = useState(true);

  useEffect(() => {
    if (startSignal > 0) setBreathing(true);
  }, [startSignal]);

  // F14: the label follows the 8 s cycle, flipping every half.
  useEffect(() => {
    if (!breathing) return;
    setInhale(true);
    const timer = setInterval(() => setInhale((v) => !v), HALF_CYCLE_MS);
    return () => clearInterval(timer);
  }, [breathing]);

  const label = breathing ? (inhale ? 'Breathe in' : 'Breathe out') : 'Take a minute';

  return (
    <section className="panel panel-wellbeing rise d5">
      <div className="panel-head">
        <h2>Well-being</h2>
      </div>
      <div className="breath">
        <div className="breath-ring" aria-hidden="true">
          <div className="breath-outline" />
          <div className={`breath-circle ${breathing ? 'breathing' : ''}`} />
        </div>
        <div className="breath-controls">
          <span className="breath-label" aria-live="polite">
            {label}
          </span>
          <button type="button" className="pill" onClick={() => setBreathing((v) => !v)}>
            {breathing ? 'Stop' : 'Begin'}
          </button>
        </div>
      </div>
      <div className="nudge">
        <span>
          Next nudge · {nudge ? `${nudge.time_local} · ${nudge.label.toLowerCase()}` : 'none today'}
        </span>
        {nudge && (
          <button
            type="button"
            className="text-button"
            aria-label={`Later: ${nudge.label}`}
            onClick={() => onSnoozeNudge(nudge)}
          >
            Later
          </button>
        )}
      </div>
    </section>
  );
}
