import { onlineManager, useMutationState } from '@tanstack/react-query';
import { useSyncExternalStore } from 'react';
import { OP_MUTATION } from './data/queries.ts';
import { clearRefusals, lastSeen, refusalStore } from './data/sync.ts';

function when(at: number): string {
  const date = new Date(at);
  const time = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (date.toDateString() === new Date().toDateString()) return time;
  return `${date.toLocaleDateString([], { weekday: 'long' })} ${time}`;
}

const changes = (n: number) => (n === 1 ? '1 change' : `${n} changes`);

/** One quiet line on the phone about the laptop being away (ADR 0010). Empty when all is well. */
export function ConnectionLine() {
  const online = useSyncExternalStore(
    (listener) => onlineManager.subscribe(listener),
    () => onlineManager.isOnline(),
  );
  const waiting = useMutationState({ filters: { mutationKey: OP_MUTATION, status: 'pending' } });
  const refusals = useSyncExternalStore(refusalStore.subscribe, refusalStore.get);

  if (refusals.length > 0) {
    return (
      <div className="connection-line msg" role="status">
        The laptop could not make {refusals.length === 1 ? 'one change' : 'some changes'}:{' '}
        {refusals.join(' ')}{' '}
        <button type="button" className="pill pill-ghost" onClick={clearRefusals}>
          OK
        </button>
      </div>
    );
  }
  if (online) return null;
  const seen = lastSeen();
  return (
    <div className="connection-line msg" role="status">
      {seen
        ? `Your laptop is out of reach, so this is how things stood at ${when(seen)}.`
        : 'Your laptop is out of reach. Open Sirius once while it is on, and it will be here offline too.'}
      {waiting.length > 0 && ` ${changes(waiting.length)} will go through when it is back.`}
    </div>
  );
}
