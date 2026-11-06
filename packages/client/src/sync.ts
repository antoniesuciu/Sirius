/**
 * What the phone knows about its link to the laptop (ADR 0010): whether the core is reachable,
 * when it last was, and which queued changes the core turned down.
 */
import { ApiError } from '@sirius/contracts';
import { onlineManager } from '@tanstack/react-query';

const LAST_SEEN_KEY = 'sirius.last-seen';

// Only the event stream decides. The browser's own online flag says nothing about the laptop.
onlineManager.setEventListener(() => () => {});

export function setReachable(reachable: boolean): void {
  if (!reachable && onlineManager.isOnline()) markSeen();
  onlineManager.setOnline(reachable);
  if (reachable) markSeen();
}

function markSeen(): void {
  try {
    localStorage.setItem(LAST_SEEN_KEY, String(Date.now()));
  } catch {
    // Without storage the line simply cannot say when.
  }
}

export function lastSeen(): number | null {
  try {
    const value = Number(localStorage.getItem(LAST_SEEN_KEY));
    return value > 0 ? value : null;
  } catch {
    return null;
  }
}

type Listener = () => void;
let refusals: string[] = [];
const listeners = new Set<Listener>();

/** A queued change the core turned down, such as one for a task deleted on the laptop. */
export function reportRefusal(error: unknown): void {
  if (!(error instanceof ApiError)) return;
  refusals = [...refusals, error.message];
  for (const listener of listeners) listener();
}

export function clearRefusals(): void {
  refusals = [];
  for (const listener of listeners) listener();
}

export const refusalStore = {
  subscribe(listener: Listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  get: () => refusals,
};
