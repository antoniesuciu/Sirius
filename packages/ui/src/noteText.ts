/** F42: how the notes view words times, short in a row and fuller in the editor. */
const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

export function noteTime(at: number, full = false, now = Date.now()): string {
  const date = new Date(at);
  // 24-hour, like the clock and the schedule.
  const time = date.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  if (now - at < MINUTE) return 'just now';
  if (now - at < 60 * MINUTE) return `${Math.floor((now - at) / MINUTE)} min ago`;
  if (date.toDateString() === new Date(now).toDateString()) return full ? `today, ${time}` : time;
  const day =
    now - at < 6 * DAY
      ? date.toLocaleDateString([], { weekday: 'short' })
      : date.toLocaleDateString([], {
          day: 'numeric',
          month: 'short',
          ...(date.getFullYear() === new Date(now).getFullYear() ? {} : { year: 'numeric' }),
        });
  return full ? `${day}, ${time}` : day;
}

/** The first line of the body, for a list row. */
export function notePreview(body: string): string {
  return body.trim().split('\n')[0]?.slice(0, 120) ?? '';
}

/** Search matches the title and the body, ignoring case. */
export function noteMatches(note: { title: string; body: string }, query: string): boolean {
  const q = query.trim().toLowerCase();
  return !q || note.title.toLowerCase().includes(q) || note.body.toLowerCase().includes(q);
}
