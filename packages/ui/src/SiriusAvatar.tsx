import type { CSSProperties } from 'react';
import { useEffect, useState } from 'react';
import { siriusSvg } from './avatar/sirius.gen.ts';
import { prefersReducedMotion, usePageHidden } from './hooks.ts';

export type AvatarState = 'idle' | 'listening' | 'thinking' | 'speaking' | 'asleep';

export interface SiriusAvatarProps {
  state: AvatarState;
  /** Coarse TTS amplitude from 0 to 1, used by the `speaking` state. */
  level?: number;
  /** Stops the idle blinks and glances, so a resting window paints nothing. */
  still?: boolean;
}

const BLINK_EVERY_MS = 6500;
const BLINK_FOR_MS = 160;
const GLANCE_EVERY_MS = 15_000;
const GLANCE_HOLD_MS = 2600;

type Glance = 'left' | 'right' | null;

/**
 * The wolf (F15a). States are CSS, keyed off `data-state`. Blinks and glances run from
 * timers that toggle a short transition, so between them nothing is ticking.
 */
export function SiriusAvatar({ state, level = 0, still = false }: SiriusAvatarProps) {
  const hidden = usePageHidden();
  const [blink, setBlink] = useState(false);
  const [glance, setGlance] = useState<Glance>(null);

  useEffect(() => {
    if (state !== 'idle' || hidden || still || prefersReducedMotion()) {
      setBlink(false);
      setGlance(null);
      return;
    }
    const pending = new Set<ReturnType<typeof setTimeout>>();
    const later = (fn: () => void, ms: number) => {
      const t = setTimeout(() => {
        pending.delete(t);
        fn();
      }, ms);
      pending.add(t);
    };
    const blinker = setInterval(() => {
      setBlink(true);
      later(() => setBlink(false), BLINK_FOR_MS);
    }, BLINK_EVERY_MS);
    const glancer = setInterval(() => {
      setGlance('left');
      later(() => setGlance('right'), GLANCE_HOLD_MS);
      later(() => setGlance(null), GLANCE_HOLD_MS * 2);
    }, GLANCE_EVERY_MS);
    return () => {
      clearInterval(blinker);
      clearInterval(glancer);
      for (const t of pending) clearTimeout(t);
    };
  }, [state, hidden, still]);

  return (
    <div
      className="sirius"
      data-state={state}
      data-blink={blink}
      data-glance={glance ?? undefined}
      style={{ '--level': level } as CSSProperties}
    >
      <span className="sirius-ring" aria-hidden="true" />
      <div className="sirius-pose">
        {/* Inlined rather than <img> so CSS can reach the eye groups (spec section 0). */}
        <div className="sirius-motion" dangerouslySetInnerHTML={{ __html: siriusSvg }} />
      </div>
    </div>
  );
}
