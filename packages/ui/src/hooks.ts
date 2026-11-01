import { useEffect, useRef, useState } from 'react';

const REDUCED_QUERY = '(prefers-reduced-motion: reduce)';

export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia?.(REDUCED_QUERY).matches === true;
}

/** True while the window is hidden, so timers and animations can stop (spec section 4.1). */
export function usePageHidden(): boolean {
  const [hidden, setHidden] = useState(() => document.visibilityState === 'hidden');
  useEffect(() => {
    const onChange = () => setHidden(document.visibilityState === 'hidden');
    document.addEventListener('visibilitychange', onChange);
    return () => document.removeEventListener('visibilitychange', onChange);
  }, []);
  return hidden;
}

const ACTIVITY_EVENTS = ['pointermove', 'pointerdown', 'keydown', 'wheel', 'touchstart'] as const;

/**
 * True once nobody has touched the window for `afterMs`, or as soon as it loses focus. Any
 * running animation keeps WebKitGTK compositing the whole window at 60 fps, so the budget of
 * under 1% idle CPU is only reachable if decoration actually stops (docs/adr/0004).
 */
export function useResting(afterMs: number): boolean {
  const [resting, setResting] = useState(false);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const wake = () => {
      setResting(false);
      clearTimeout(timer);
      timer = setTimeout(() => setResting(true), afterMs);
    };
    const rest = () => {
      clearTimeout(timer);
      setResting(true);
    };
    wake();
    for (const name of ACTIVITY_EVENTS) window.addEventListener(name, wake, { passive: true });
    window.addEventListener('focus', wake);
    window.addEventListener('blur', rest);
    return () => {
      clearTimeout(timer);
      for (const name of ACTIVITY_EVENTS) window.removeEventListener(name, wake);
      window.removeEventListener('focus', wake);
      window.removeEventListener('blur', rest);
    };
  }, [afterMs]);
  return resting;
}

export interface Typed {
  shown: string;
  typing: boolean;
}

/**
 * Types `text` out one character at a time, pausing a little on punctuation. A new
 * `text` restarts it. `null` shows nothing. Reduced motion shows the text at once.
 */
export function useTypewriter(text: string | null, speedMs: number): Typed {
  const [state, setState] = useState<Typed>({ shown: '', typing: false });

  useEffect(() => {
    if (text === null) {
      setState({ shown: '', typing: false });
      return;
    }
    if (prefersReducedMotion()) {
      setState({ shown: text, typing: false });
      return;
    }
    let i = 0;
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      i += 1;
      const done = i >= text.length;
      setState({ shown: text.slice(0, i), typing: !done });
      if (done) return;
      const ch = text[i - 1];
      timer = setTimeout(tick, speedMs + (ch === '.' || ch === ',' ? 170 : 0));
    };
    tick();
    return () => clearTimeout(timer);
  }, [text, speedMs]);

  return state;
}

const MAX_CHARS_PER_SECOND = 60;
const FRAME_MS = 50;

/**
 * F17: the typewriter is driven by the real stream, not simulated. `target` grows as
 * deltas arrive and the display follows at up to 60 chars/s, so bursts read smoothly
 * and the caret never runs ahead of what the agent has actually said.
 */
export function useSmoothedText(target: string): string {
  const [shown, setShown] = useState(0);
  const targetRef = useRef(target);
  targetRef.current = target;

  useEffect(() => {
    if (target.length === 0) {
      setShown(0);
      return;
    }
    if (prefersReducedMotion()) {
      setShown(target.length);
      return;
    }
    const step = Math.ceil((MAX_CHARS_PER_SECOND * FRAME_MS) / 1000);
    const timer = setInterval(() => {
      setShown((n) => {
        const limit = targetRef.current.length;
        if (n >= limit) {
          clearInterval(timer);
          return n;
        }
        return Math.min(n + step, limit);
      });
    }, FRAME_MS);
    return () => clearInterval(timer);
  }, [target]);

  return target.slice(0, shown);
}
