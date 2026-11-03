/**
 * What Sirius looks like while it listens, thinks or speaks, now that the wolf is put away: three
 * thin lines in ink and olive that swell with the voice and taper to nothing at both ends. It
 * takes no room while idle, and animates only while something is happening (ADR 0004).
 */
import { useEffect, useRef } from 'react';
import type { AvatarState } from './SiriusAvatar.tsx';

export interface VoiceWaveProps {
  state: AvatarState;
  /** Loudness 0–1 when known: the laptop's speaker while speaking. */
  level?: number;
  /** Read every frame, for a live source such as the phone's microphone. */
  readLevel?: () => number;
}

const WIDTH = 300;
const HEIGHT = 40;
const POINTS = 48;
/** Speed, wavelength and share of the swing for each line: none moves in step with another. */
const LINES = [
  { speed: 1.9, k: 2.4, share: 1, className: 'wave-line wave-ink' },
  { speed: -1.3, k: 3.3, share: 0.7, className: 'wave-line wave-accent' },
  { speed: 2.6, k: 4.6, share: 0.45, className: 'wave-line wave-soft' },
];

const active = (state: AvatarState) =>
  state === 'listening' || state === 'thinking' || state === 'speaking';

function path(t: number, amplitude: number, line: (typeof LINES)[number]): string {
  const middle = HEIGHT / 2;
  let d = '';
  for (let i = 0; i <= POINTS; i++) {
    const x = i / POINTS;
    // sin(πx) tapers both ends to the midline, the way a voice fades in and out.
    const y =
      middle +
      Math.sin(Math.PI * x) *
        amplitude *
        line.share *
        (HEIGHT / 2 - 2) *
        Math.sin(2 * Math.PI * line.k * x + t * line.speed);
    d += `${i === 0 ? 'M' : 'L'}${(x * WIDTH).toFixed(1)} ${y.toFixed(1)}`;
  }
  return d;
}

/** How much the lines swing for a state: a voice swings them, thinking barely does. */
function target(state: AvatarState, t: number, level: number | null): number {
  if (state === 'thinking') return 0.12 + 0.05 * Math.sin(t * 1.6);
  if (state === 'listening')
    return level === null ? 0.3 + 0.1 * Math.sin(t * 2.2) : 0.15 + level * 0.85;
  if (state === 'speaking') {
    // A phone's own speech has no level, so give it the uneven rhythm of syllables instead.
    const syllables = 0.55 + 0.3 * Math.sin(t * 7.3) * Math.sin(t * 2.9);
    return level === null ? syllables : 0.2 + level * 0.8;
  }
  return 0;
}

export function VoiceWave({ state, level, readLevel }: VoiceWaveProps) {
  const lines = useRef<Array<SVGPathElement | null>>([]);
  const amplitude = useRef(0);
  const latest = useRef({ state, level, readLevel });
  latest.current = { state, level, readLevel };
  const on = active(state);

  useEffect(() => {
    if (!on) return;
    const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    const draw = (t: number) => {
      lines.current.forEach((el, i) => {
        const line = LINES[i];
        if (el && line) el.setAttribute('d', path(t, amplitude.current, line));
      });
    };
    if (still) {
      amplitude.current = 0.4;
      draw(0);
      return;
    }
    let frame = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const t = (now - start) / 1000;
      const { state: s, level: l, readLevel: read } = latest.current;
      const heard = read ? read() : l !== undefined && l > 0 ? l : null;
      // Ease toward the target, so a level jump reads as a swell, not a flicker.
      amplitude.current += (target(s, t, heard) - amplitude.current) * 0.18;
      draw(t);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [on]);

  return (
    <div className="voice-wave" data-state={state} aria-hidden="true">
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} preserveAspectRatio="none">
        {LINES.map((line, i) => (
          <path
            key={line.className}
            ref={(el) => {
              lines.current[i] = el;
            }}
            className={line.className}
            d={`M0 ${HEIGHT / 2}L${WIDTH} ${HEIGHT / 2}`}
          />
        ))}
      </svg>
    </div>
  );
}
