/**
 * The reply being written, and the finished reply kept on screen until its stored copy replaces
 * it, so it never blinks. `after` is the core's `created_at` of the newest stored line when the
 * stream began: the stored reply is the first line not mine stored after that. Both sides of the
 * comparison are core times, so a phone whose clock is off cannot mistake an older line for it.
 */
export type Live =
  | { kind: 'none' }
  | { kind: 'streaming'; text: string; after: number }
  | {
      kind: 'held';
      text: string;
      after: number;
      /** How many lines were mine then; one more means I wrote again and the hold is over. */
      mine: number;
      typed: boolean;
    };

/** The fields of a chat line the hold reads. `storedAt` is absent on lines the core never stored. */
interface Line {
  id: string;
  mine: boolean;
  storedAt?: number;
}

export type LiveEvent =
  /** The streamed text as it is now; null when no reply is arriving. */
  | { kind: 'stream'; text: string | null; after: number; mine: number }
  /** The held reply has finished typing out. */
  | { kind: 'typed' }
  | { kind: 'cleared' };

export const NO_LIVE: Live = { kind: 'none' };

/** Returns `live` itself when nothing changed, so it can run while rendering. */
export function liveReducer(live: Live, event: LiveEvent): Live {
  switch (event.kind) {
    case 'stream':
      if (event.text !== null) {
        if (live.kind !== 'streaming') {
          return { kind: 'streaming', text: event.text, after: event.after };
        }
        return live.text === event.text ? live : { ...live, text: event.text };
      }
      if (live.kind !== 'streaming') return live;
      return live.text
        ? { kind: 'held', text: live.text, after: live.after, mine: event.mine, typed: false }
        : NO_LIVE;
    case 'typed':
      return live.kind === 'held' && !live.typed ? { ...live, typed: true } : live;
    case 'cleared':
      return live.kind === 'none' ? live : NO_LIVE;
  }
}

/** The core time of the newest stored line: where a stream starting now anchors. */
export function newestStoredAt(lines: readonly Line[]): number {
  return lines.reduce((max, l) => Math.max(max, l.storedAt ?? 0), 0);
}

/** Ids of the stored replies that arrived for the held text (normally one). */
export function storedReplies(live: Live, lines: readonly Line[]): Set<string> {
  if (live.kind !== 'held') return new Set();
  return new Set(
    lines
      .filter((l) => !l.mine && l.storedAt !== undefined && l.storedAt > live.after)
      .map((l) => l.id),
  );
}

/** I wrote again since the reply was held: it gives way to the new exchange at once. */
export function wroteAgain(live: Live, lines: readonly Line[]): boolean {
  return live.kind === 'held' && lines.filter((l) => l.mine).length > live.mine;
}
