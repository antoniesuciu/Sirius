import { type ChangeEvent, isUndoableChange, type SiriusEvent } from '@sirius/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { invalidationsFor, useClient } from './queries.ts';
import { setReachable } from './sync.ts';

type ChatEvent = Extract<SiriusEvent, { type: 'chat' }>;

/** The chat turn as this client knows it. The core runs one turn at a time. */
export type Turn =
  | { kind: 'idle' }
  | { kind: 'thinking' | 'tool' | 'streaming'; turnId: string; text: string };

/** `resynced`: after a (re)connect, the core's own word on which turn is running, if any. */
export type TurnEvent = ChatEvent | { kind: 'resynced'; activeTurnId: string | null };

const IDLE: Turn = { kind: 'idle' };

export function turnReducer(turn: Turn, event: TurnEvent): Turn {
  const current = turn.kind === 'idle' ? null : turn;
  switch (event.kind) {
    case 'resynced':
      if (event.activeTurnId === null) return IDLE;
      if (current?.turnId === event.activeTurnId) return turn;
      return { kind: 'thinking', turnId: event.activeTurnId, text: '' };
    case 'start':
      return { kind: 'thinking', turnId: event.turn_id, text: '' };
    case 'done':
    case 'error':
      return current?.turnId === event.turn_id ? IDLE : turn;
    case 'text':
    case 'tool': {
      // A live event for another turn means its start was missed while disconnected, and the
      // core runs one turn at a time, so the old one is over: follow the new one.
      const text = current?.turnId === event.turn_id ? current.text : '';
      return event.kind === 'text'
        ? { kind: 'streaming', turnId: event.turn_id, text: text + event.delta }
        : { kind: 'tool', turnId: event.turn_id, text };
    }
  }
}

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
  /** Reconnect at once, such as when the app comes back on screen. */
  reconnect(): void;
}

/**
 * Owns the SSE subscription: cache invalidation plus the state only events carry. `listen` also
 * sees every event, for the phone's voice and tab dots; it may change on every render.
 */
export function useLive(
  listen?: (event: SiriusEvent) => void,
  /** After every (re)connect, once the cache is invalidated: the clock resyncs here. */
  onConnected?: () => void,
): LiveState {
  const client = useClient();
  const listener = useRef(listen);
  listener.current = listen;
  const connectedHook = useRef(onConnected);
  connectedHook.current = onConnected;
  const qc = useQueryClient();
  const [turn, setTurn] = useState<Turn>(IDLE);
  /** Counts chat events, so a resync answer older than a live event is dropped. */
  const chatSeen = useRef(0);
  const [breathingSignal, setBreathingSignal] = useState(0);
  const [undoable, setUndoable] = useState<ChangeEvent | null>(null);
  const undoTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  // Bumped to reconnect at once, rather than after a backoff of up to 30 s.
  const [attempt, setAttempt] = useState(0);
  const connected = useRef(false);

  useEffect(() => {
    let closed = false;
    const onChat = (event: ChatEvent) => {
      chatSeen.current += 1;
      setTurn((t) => turnReducer(t, event));
    };
    // Deltas sent while disconnected are lost; the full reply arrives with the conversation.
    const resync = () => {
      const seen = chatSeen.current;
      const apply = (activeTurnId: string | null) => {
        if (!closed && chatSeen.current === seen) {
          setTurn((t) => turnReducer(t, { kind: 'resynced', activeTurnId }));
        }
      };
      client.call('get_conversation', {}).then(
        (view) => apply(view.active_turn_id),
        // Unknown is treated as over, so Send is never stuck behind a turn that ended.
        () => apply(null),
      );
    };

    const onEvent = (event: SiriusEvent) => {
      for (const key of invalidationsFor(event)) {
        void qc.invalidateQueries({ queryKey: [key] });
      }
      if (event.type === 'chat') onChat(event);
      listener.current?.(event);
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

    const unsubscribe = client.subscribe({
      onEvent,
      onDisconnected: () => {
        connected.current = false;
        setReachable(false);
      },
      onConnected: () => {
        connected.current = true;
        setReachable(true);
        // A turn may have ended, or gone on, while disconnected: ask the core which.
        resync();
        // Anything may have changed while disconnected, and the machine may have slept.
        void qc.invalidateQueries();
        connectedHook.current?.();
      },
    });
    return () => {
      closed = true;
      unsubscribe();
    };
    // `attempt` is a dependency only so that bumping it reconnects at once.
  }, [client, qc, attempt]);

  useEffect(() => () => clearTimeout(undoTimer.current), []);

  const active = turn.kind === 'idle' ? null : turn;
  return {
    streaming: active && (active.kind === 'streaming' || active.text !== '') ? active.text : null,
    thinking: active?.kind === 'thinking' || active?.kind === 'tool',
    turnId: active?.turnId ?? null,
    breathingSignal,
    undoable,
    clearUndo: () => setUndoable(null),
    reconnect: () => setAttempt((n) => n + 1),
  };
}
