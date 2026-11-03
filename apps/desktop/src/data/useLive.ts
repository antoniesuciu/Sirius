import { type ChangeEvent, isUndoableChange, type SiriusEvent } from '@sirius/contracts';
import { CLOCK_RESYNC_EVENT } from '@sirius/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { invalidationsFor, useClient } from './queries.ts';
import { setReachable } from './sync.ts';

/** Agent-applied changes stay undoable this long (F20). */
const UNDO_WINDOW_MS = 30_000;

export interface LiveState {
  /** Latest streamed reply, or null when nothing is arriving. */
  streaming: string | null;
  thinking: boolean;
  turnId: string | null;
  /** Bumped by the "start breathing" voice command. */
  breathingSignal: number;
  undoable: ChangeEvent | null;
  clearUndo(): void;
}

/** Owns the SSE subscription: cache invalidation plus the state only events carry. */
export function useLive(): LiveState {
  const client = useClient();
  const qc = useQueryClient();
  const [streaming, setStreaming] = useState<string | null>(null);
  const [thinking, setThinking] = useState(false);
  const [turnId, setTurnId] = useState<string | null>(null);
  const [breathingSignal, setBreathingSignal] = useState(0);
  const [undoable, setUndoable] = useState<ChangeEvent | null>(null);
  const undoTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  // Bumped to reconnect at once, rather than after a backoff of up to 30 s.
  const [attempt, setAttempt] = useState(0);
  const connected = useRef(false);

  useEffect(() => {
    // A phone waking up or finding a network is the moment the laptop may be back.
    const retry = () => {
      if (!connected.current && document.visibilityState === 'visible') setAttempt((n) => n + 1);
    };
    window.addEventListener('online', retry);
    document.addEventListener('visibilitychange', retry);
    return () => {
      window.removeEventListener('online', retry);
      document.removeEventListener('visibilitychange', retry);
    };
  }, []);

  useEffect(() => {
    const onChat = (event: Extract<SiriusEvent, { type: 'chat' }>) => {
      switch (event.kind) {
        case 'start':
          setTurnId(event.turn_id);
          setThinking(true);
          setStreaming(null);
          break;
        case 'text':
          setThinking(false);
          setStreaming((s) => (s ?? '') + event.delta);
          break;
        case 'tool':
          setThinking(true);
          break;
        case 'done':
        case 'error':
          setTurnId(null);
          setThinking(false);
          setStreaming(null);
          break;
      }
    };

    const onEvent = (event: SiriusEvent) => {
      for (const key of invalidationsFor(event)) {
        void qc.invalidateQueries({ queryKey: [key] });
      }
      if (event.type === 'chat') onChat(event);
      if (event.type === 'voice') qc.setQueryData(['get_voice_state'], event.state);
      if (event.type === 'ui_action' && event.action === 'start_breathing') {
        setBreathingSignal((n) => n + 1);
      }
      if (event.type === 'change' && isUndoableChange(event)) {
        setUndoable(event);
        clearTimeout(undoTimer.current);
        undoTimer.current = setTimeout(() => setUndoable(null), UNDO_WINDOW_MS);
      }
    };

    return client.subscribe({
      onEvent,
      onDisconnected: () => {
        connected.current = false;
        setReachable(false);
      },
      onConnected: () => {
        connected.current = true;
        setReachable(true);
        // A turn's end may have happened while disconnected, so never stay stuck on it.
        setTurnId(null);
        setThinking(false);
        setStreaming(null);
        // Anything may have changed while disconnected, and the machine may have slept.
        void qc.invalidateQueries();
        window.dispatchEvent(new Event(CLOCK_RESYNC_EVENT));
      },
    });
    // `attempt` is a dependency only so that bumping it reconnects at once.
  }, [client, qc, attempt]);

  useEffect(() => () => clearTimeout(undoTimer.current), []);

  return {
    streaming,
    thinking,
    turnId,
    breathingSignal,
    undoable,
    clearUndo: () => setUndoable(null),
  };
}
