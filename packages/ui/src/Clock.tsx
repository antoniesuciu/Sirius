import { useEffect, useState } from 'react';

function formatClock(d: Date): string {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function formatDate(d: Date): string {
  const weekday = d.toLocaleDateString('en-GB', { weekday: 'long' });
  const day = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long' });
  return `${weekday} · ${day}`;
}

/** Dispatch this on the window to re-sync after a resume (the core reconnecting, say). */
export const CLOCK_RESYNC_EVENT = 'sirius:resync-clock';

/**
 * The current time, re-rendered on each minute boundary with a self-rescheduling timeout
 * rather than a 1 s interval, and re-synced whenever the window may have slept.
 */
export function useMinute(): Date {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const schedule = () => {
      clearTimeout(timer);
      const current = new Date();
      setNow(current);
      const wait = 60_000 - (current.getSeconds() * 1000 + current.getMilliseconds()) + 30;
      timer = setTimeout(schedule, wait);
    };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') schedule();
    };
    schedule();
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('focus', schedule);
    window.addEventListener('pageshow', schedule);
    window.addEventListener(CLOCK_RESYNC_EVENT, schedule);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('focus', schedule);
      window.removeEventListener('pageshow', schedule);
      window.removeEventListener(CLOCK_RESYNC_EVENT, schedule);
    };
  }, []);
  return now;
}

/** F1: inline clock and date. */
export function Clock() {
  const now = useMinute();
  return (
    <div className="header-time">
      <time className="clock" aria-label="Current time">
        {formatClock(now)}
      </time>
      <span className="label">{formatDate(now)}</span>
    </div>
  );
}
