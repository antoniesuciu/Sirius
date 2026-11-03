/**
 * Sirius as a circle, where the wolf was. Still when idle. While listening, rings ripple out of
 * it; while speaking it swells with the voice; while thinking it breathes. Then it settles back
 * into the plain circle. Only an active state runs any animation (ADR 0004).
 */
import { type CSSProperties, useEffect, useRef } from 'react';
import type { AvatarState } from './SiriusAvatar.tsx';

export interface VoiceOrbProps {
  state: AvatarState;
  /** Loudness 0–1 when known: the laptop's speaker while speaking. */
  level?: number;
  /** Read every frame, for a live source such as the phone's microphone. */
  readLevel?: () => number;
}

const moves = (state: AvatarState) => state === 'listening' || state === 'speaking';

export function VoiceOrb({ state, level, readLevel }: VoiceOrbProps) {
  const orb = useRef<HTMLDivElement>(null);
  const latest = useRef({ state, level, readLevel });
  latest.current = { state, level, readLevel };
  const on = moves(state);

  // The swell follows the voice frame by frame, so it is set directly, not through React.
  useEffect(() => {
    const el = orb.current;
    if (!el) return;
    if (!on || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      el.style.setProperty('--swell', '0');
      return;
    }
    let swell = 0;
    let frame = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const t = (now - start) / 1000;
      const { state: s, level: l, readLevel: read } = latest.current;
      const heard = read ? read() : l !== undefined && l > 0 ? l : null;
      // A phone's own speech reports no level, so give it the uneven rhythm of syllables.
      const goal =
        heard ?? (s === 'speaking' ? 0.45 + 0.35 * Math.sin(t * 7.3) * Math.sin(t * 2.9) : 0.25);
      swell += (goal - swell) * 0.2;
      el.style.setProperty('--swell', swell.toFixed(3));
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      el.style.setProperty('--swell', '0');
    };
  }, [on]);

  return (
    <div
      ref={orb}
      className="voice-orb"
      data-state={state}
      aria-hidden="true"
      style={{ '--swell': 0 } as CSSProperties}
    >
      <span className="orb-ring" />
      <span className="orb-ring orb-ring-late" />
      <span className="orb-core" />
    </div>
  );
}
