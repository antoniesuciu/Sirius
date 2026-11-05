/**
 * Sirius as the Orbit wolf, animated layer by layer with GSAP (owner, 2026-11-05). The layers
 * come from docs/design/sirius-logo/sirius.svg: the wolf, the crescent ring and the star.
 * Idle and asleep are one still frame, so WebKitGTK stops compositing (ADR 0004). A state
 * change kills the running tweens where they are and eases back to rest, so nothing snaps.
 */
import { gsap } from 'gsap';
import { useEffect, useId, useLayoutEffect, useRef } from 'react';
import { ORBIT } from './avatar/orbit.gen.ts';
import { prefersReducedMotion } from './hooks.ts';
import type { AvatarState } from './SiriusAvatar.tsx';

export interface SiriusMarkProps {
  state: AvatarState;
  /** CSS pixels, square. */
  size?: number;
  /** Loudness 0–1 when known: the laptop's speaker while speaking. */
  level?: number;
  /** Read every frame, for a live source such as the phone's microphone. */
  readLevel?: () => number;
  /** Hold still even while busy, such as after long inactivity. */
  still?: boolean;
}

const [RX, RY] = ORBIT.ringCentre;
const [SX, SY] = ORBIT.starCentre;
const [WX, WY] = ORBIT.wolfPivot;
const SETTLE = 0.45;

export function SiriusMark({
  state,
  size = 44,
  level = 0,
  readLevel,
  still = false,
}: SiriusMarkProps) {
  const root = useRef<SVGSVGElement>(null);
  const id = useId().replace(/:/g, '');
  const moving = !still && (state === 'listening' || state === 'thinking' || state === 'speaking');
  const levelRef = useRef(level);
  levelRef.current = level;
  const readRef = useRef(readLevel);
  readRef.current = readLevel;

  useLayoutEffect(() => {
    const svg = root.current;
    if (!svg) return;
    const layer = (name: string) => svg.querySelector(`.mark-${name}`) as SVGElement;
    const [wolf, star, arc] = [layer('wolf'), layer('star'), layer('arc')];
    const all = [wolf, star, arc];
    gsap.set(wolf, { svgOrigin: `${WX} ${WY}` });
    gsap.set(arc, { svgOrigin: `${RX} ${RY}` });
    gsap.set(star, { svgOrigin: `${SX} ${SY}` });

    gsap.to([wolf, star], { rotation: 0, scale: 1, duration: SETTLE, ease: 'sine.out' });
    gsap.to(arc, { opacity: moving && state === 'thinking' ? 1 : 0, duration: SETTLE });
    if (!moving || prefersReducedMotion()) return () => gsap.killTweensOf(all);

    const loop = { repeat: -1, yoyo: true, ease: 'sine.inOut', delay: SETTLE };
    let tick: (() => void) | null = null;
    // quickTo cannot drive the `scale` alias, so both axes.
    const starScale = (duration: number) => {
      const x = gsap.quickTo(star, 'scaleX', { duration, ease: 'power1.out' });
      const y = gsap.quickTo(star, 'scaleY', { duration, ease: 'power1.out' });
      return (v: number) => {
        x(v);
        y(v);
      };
    };
    // The ring never turns: that shows the seam where it meets the chest.
    if (state === 'listening') {
      gsap.to(wolf, { rotation: -4, duration: 1.8, ...loop }); // the head tilts to listen
      if (readRef.current) {
        const scale = starScale(0.15);
        tick = () => scale(1 + Math.min(1, readRef.current?.() ?? 0) * 0.45);
      } else gsap.to(star, { scale: 1.15, duration: 1.2, ...loop });
    } else if (state === 'thinking') {
      gsap.to(arc, { rotation: '+=360', duration: 2.4, repeat: -1, ease: 'none' });
      gsap.to(star, { scale: 0.88, duration: 0.9, ...loop });
    } else {
      gsap.to(wolf, { rotation: -2, duration: 0.42, ...loop }); // a speaking nod
      const scale = starScale(0.18);
      tick = () => scale(1.1 + Math.min(1, levelRef.current) * 0.35);
    }
    if (tick) gsap.ticker.add(tick);
    return () => {
      if (tick) gsap.ticker.remove(tick);
      gsap.killTweensOf(all);
    };
  }, [state, moving]);

  // Unmounting mid-tween must not leave GSAP holding detached nodes.
  useEffect(() => () => gsap.killTweensOf(root.current?.querySelectorAll('*') ?? []), []);

  return (
    <svg
      ref={root}
      className="sirius-mark"
      data-state={state}
      data-running={String(moving)}
      viewBox="0 0 512 512"
      width={size}
      height={size}
      role="img"
      aria-label={`Sirius, ${state}`}
    >
      <defs>
        {/* The source's own gradient axis, in each theme's voice colours (F40). */}
        <linearGradient
          id={`${id}-ink`}
          gradientUnits="userSpaceOnUse"
          x1="213"
          y1="75"
          x2="215"
          y2="458"
        >
          <stop style={{ stopColor: 'var(--orb-1)' }} />
          <stop offset="1" style={{ stopColor: 'var(--orb-4)' }} />
        </linearGradient>
      </defs>
      <circle
        className="mark-arc"
        cx={RX}
        cy={RY}
        r={212}
        fill="none"
        stroke="var(--accent)"
        strokeWidth={14}
        strokeLinecap="round"
        pathLength={100}
        strokeDasharray="14 86"
        opacity={0}
      />
      <g fill={`url(#${id}-ink)`} fillRule="evenodd">
        <g className="mark-wolf">
          <path d={ORBIT.head} />
          <path d={ORBIT.earBack} />
          <path d={ORBIT.eye} />
        </g>
        <path className="mark-ring" d={ORBIT.ring} />
        <path className="mark-star" d={ORBIT.star} />
      </g>
    </svg>
  );
}
