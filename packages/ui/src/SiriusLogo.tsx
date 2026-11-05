/**
 * Sirius as the layered logo with nine states, ported from the owner's spec,
 * docs/design/sirius-logo/playground.html (2026-11-05). Each state is an interruptible set of
 * tweens: switching kills the old ones and eases back to neutral before the new one starts.
 *
 * Learned constraints, kept here: the ring never rotates (it shows the seam at the chest);
 * ring and wolf fade as one group (#mark), never apart; quickTo drives scaleX and scaleY,
 * because it cannot drive the `scale` alias; reduced motion turns ambient loops off.
 */
import { gsap } from 'gsap';
import { useEffect, useId, useLayoutEffect, useRef } from 'react';
import { ORBIT } from './avatar/orbit.gen.ts';
import { prefersReducedMotion } from './hooks.ts';

export type LogoState =
  | 'startup'
  | 'idle'
  | 'listening'
  | 'thinking'
  | 'working'
  | 'speaking'
  | 'notify'
  | 'error'
  | 'sleep';

export interface SiriusLogoProps {
  state: LogoState;
  size?: number;
  /** Raw loudness 0–1 while speaking. Smoothed here: 30 ms attack, 150 ms release. */
  level?: number;
  /** Read every frame, for a live source such as an AnalyserNode. Wins over `level`. */
  readLevel?: () => number;
  /** Twinkle, breathing and moonlight while idle. Off in the app: any running animation keeps
   * WebKitGTK compositing the whole window (ADR 0004). Blinks still happen. */
  ambient?: boolean;
  /** Seconds between idle blinks; the spec's demo uses [3.5, 7]. */
  blinkEvery?: [number, number];
  /** One-shot states (startup, notify, error) end here. */
  onSettled?(): void;
  /** Ink instead of the brand gradient. */
  ink?: boolean;
}

const [CX, CY] = ORBIT.ringCentre;
const [SX, SY] = ORBIT.starCentre;
const [PX, PY] = ORBIT.wolfPivot;
const RING_R = 193.2;
const GLINT_R = RING_R - 17;
const REVEAL_R = 176.2;
const REVEAL_LEN = 2 * Math.PI * REVEAL_R;
const GRAD = { x1: 213.3, y1: 75.0, x2: 214.6, y2: 458.2 };
const GRAD_MID = { x: (GRAD.x1 + GRAD.x2) / 2, y: (GRAD.y1 + GRAD.y2) / 2 };
const GRAD_HALF = { x: (GRAD.x2 - GRAD.x1) / 2, y: (GRAD.y2 - GRAD.y1) / 2 };

// Canis Major, anchored on the star: Sirius is alpha CMa.
const CMA: Record<string, [number, number]> = {
  alpha: [0, 0],
  theta: [-6, -34],
  beta: [34, -20],
  o2: [18, 34],
  delta: [40, 62],
  eps: [70, 80],
  eta: [20, 96],
  zeta: [88, 40],
};
const EDGES: Array<[string, string]> = [
  ['alpha', 'theta'],
  ['alpha', 'beta'],
  ['alpha', 'o2'],
  ['o2', 'delta'],
  ['delta', 'eps'],
  ['delta', 'eta'],
  ['eps', 'zeta'],
];
const at = (k: string): [number, number] => {
  const [dx, dy] = CMA[k] ?? [0, 0];
  return [SX + 1.35 * dx, SY + 1.35 * dy];
};
const LINES = EDGES.map(([a, b]) => {
  const [x1, y1] = at(a);
  const [x2, y2] = at(b);
  return { x1, y1, x2, y2, len: Math.hypot(x2 - x1, y2 - y1), to: b };
});
const DOTS = Object.keys(CMA)
  .filter((k) => k !== 'alpha')
  .map((k) => ({ k, xy: at(k), r: k === 'beta' || k === 'delta' || k === 'eps' ? 3.4 : 2.5 }));

const R = gsap.utils.random;

export function SiriusLogo({
  state,
  size = 44,
  level = 0,
  readLevel,
  ambient = false,
  blinkEvery = [20, 40],
  onSettled,
  ink = false,
}: SiriusLogoProps) {
  const root = useRef<SVGSVGElement>(null);
  const id = useId().replace(/:/g, '');
  const live = useRef({ level, readLevel, onSettled, blinkEvery });
  live.current = { level, readLevel, onSettled, blinkEvery };

  useLayoutEffect(() => {
    const svg = root.current;
    if (!svg) return;
    const $ = (name: string) => svg.querySelector(`.l-${name}`) as SVGElement;
    const mark = $('mark');
    const wolf = $('wolf');
    const ear = $('ear');
    const eye = $('eye');
    const starG = $('starG');
    const star = $('star');
    const glow = $('glow');
    const glint = $('glint');
    const constel = $('constel');
    const ripple = $('ripple');
    const reveal = $('reveal');
    const grad = $('grad');
    const lines = [...svg.querySelectorAll<SVGElement>('.l-line')];
    const dots = [...svg.querySelectorAll<SVGElement>('.l-dot')];
    const calm = prefersReducedMotion();

    // The gradient is userSpaceOnUse, so turning the light means turning its axis, not shapes.
    const gp = { a: 0 };
    const applyGrad = () => {
      const t = (gp.a * Math.PI) / 180;
      const vx = GRAD_HALF.x * Math.cos(t) - GRAD_HALF.y * Math.sin(t);
      const vy = GRAD_HALF.x * Math.sin(t) + GRAD_HALF.y * Math.cos(t);
      grad.setAttribute('x1', String(GRAD_MID.x - vx));
      grad.setAttribute('y1', String(GRAD_MID.y - vy));
      grad.setAttribute('x2', String(GRAD_MID.x + vx));
      grad.setAttribute('y2', String(GRAD_MID.y + vy));
    };
    // Moonlight: a blurred glint clipped to the ring, moved along it.
    const gl = { a: 200 };
    const applyGlint = () => {
      const t = (gl.a * Math.PI) / 180;
      glint.setAttribute('cx', String(CX + GLINT_R * Math.cos(t)));
      glint.setAttribute('cy', String(CY + GLINT_R * Math.sin(t)));
    };
    applyGlint();

    gsap.set(wolf, { svgOrigin: `${PX} ${PY}` });
    gsap.set([starG, star, glow], { svgOrigin: `${SX} ${SY}` });
    gsap.set(eye, { transformOrigin: '50% 100%' });
    gsap.set(ear, { transformOrigin: '25% 100%' });
    gsap.set(dots, { transformOrigin: '50% 50%', scale: 0 });

    const scope: Array<gsap.core.Animation> = [];
    const timers: number[] = [];
    let ticker: ((time: number, dt: number) => void) | null = null;
    let alive = true;
    const T = <A extends gsap.core.Animation>(a: A) => (scope.push(a), a);
    const settled = () => alive && live.current.onSettled?.();
    // Long waits are plain timers, so nothing ticks between idle blinks.
    const later = (seconds: number, fn: () => void) =>
      timers.push(window.setTimeout(() => alive && fn(), seconds * 1000));

    const toNeutral = (d = 0.45) => {
      // The star is two-fold symmetric: finish on the nearest equivalent angle.
      const turn = gsap.getProperty(star, 'rotation') as number;
      return T(
        gsap
          .timeline({ defaults: { duration: d, ease: 'power2.inOut' } })
          .to(mark, { opacity: 1 }, 0)
          .to(wolf, { rotation: 0, scale: 1, y: 0, opacity: 1 }, 0)
          .to(ear, { rotation: 0 }, 0)
          .to(eye, { scaleY: 1 }, 0)
          .to(starG, { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 }, 0)
          .to(star, { scale: 1, rotation: Math.round(turn / 180) * 180, opacity: 1 }, 0)
          .to([glow, glint, constel, ripple], { opacity: 0 }, 0)
          .to(reveal, { strokeDashoffset: 0 }, 0)
          .to(gp, { a: Math.round(gp.a / 360) * 360, onUpdate: applyGrad }, 0)
          .add(() => gsap.set(star, { rotation: 0 })),
      );
    };
    const blinkOnce = () =>
      gsap
        .timeline()
        .to(eye, { scaleY: 0.12, duration: 0.07, ease: 'power2.in' })
        .to(eye, { scaleY: 1, duration: 0.14, ease: 'power2.out' });

    const run: Record<LogoState, () => void> = {
      startup() {
        gsap.set(reveal, { strokeDasharray: REVEAL_LEN, strokeDashoffset: REVEAL_LEN });
        gsap.set(wolf, { opacity: 0, y: 8, rotation: 0, scale: 1 });
        gsap.set(starG, { scale: 0, opacity: 0, rotation: -90, x: 0, y: 0 });
        gsap.set([glow, glint, constel, ripple], { opacity: 0 });
        gsap.set(mark, { opacity: 1 });
        gsap.set(eye, { scaleY: 1 });
        gsap.set(ear, { rotation: 0 });
        gsap.set(star, { scale: 1, opacity: 1, rotation: 0 });
        T(
          gsap
            .timeline({ onComplete: settled })
            .to(reveal, { strokeDashoffset: 0, duration: 1.4, ease: 'power2.inOut' }, 0)
            .to(wolf, { opacity: 1, y: 0, duration: 0.8, ease: 'power2.out' }, 0.55)
            .to(
              starG,
              { scale: 1, opacity: 1, rotation: 0, duration: 0.7, ease: 'back.out(2)' },
              1.15,
            )
            .fromTo(
              glow,
              { opacity: 0 },
              { opacity: 0.9, duration: 0.22, yoyo: true, repeat: 1 },
              1.25,
            )
            .add(() => {
              gl.a = 235;
              applyGlint();
            }, 1.5)
            .to(glint, { opacity: 0.5, duration: 0.3 }, 1.5)
            .to(gl, { a: 100, duration: 1.1, ease: 'sine.inOut', onUpdate: applyGlint }, 1.5)
            .to(glint, { opacity: 0, duration: 0.4 }, 2.2),
        );
      },
      idle() {
        toNeutral();
        const blink = () => {
          T(blinkOnce());
          later(R(...live.current.blinkEvery), blink);
        };
        later(R(1.5, 3), blink);
        if (!ambient || calm) return;
        const twinkle = () =>
          T(
            gsap.to(star, {
              scale: R(0.93, 1.07),
              rotation: R(-5, 5),
              opacity: R(0.84, 1),
              duration: R(0.7, 1.9),
              ease: 'sine.inOut',
              onComplete: () => alive && twinkle(),
            }),
          );
        const sweep = () => {
          gl.a = 235;
          applyGlint();
          T(
            gsap
              .timeline()
              .to(glint, { opacity: 0.45, duration: 0.7 }, 0)
              .to(gl, { a: 105, duration: 2.6, ease: 'sine.inOut', onUpdate: applyGlint }, 0)
              .to(glint, { opacity: 0, duration: 0.7 }, 1.9),
          );
          later(R(9, 14), sweep);
        };
        later(0.5, twinkle);
        later(3, sweep);
        T(
          gsap.to(wolf, {
            scale: 1.006,
            duration: 2.6,
            ease: 'sine.inOut',
            yoyo: true,
            repeat: -1,
            delay: 0.5,
          }),
        );
      },
      listening() {
        // The far ear pricks forward and the star drifts towards the nose.
        toNeutral(0.3);
        T(
          gsap
            .timeline({ defaults: { duration: 0.6, ease: 'power3.out' } })
            .to(ear, { rotation: 9 }, 0)
            .to(starG, { x: -10, y: 14, scale: 0.9 }, 0)
            .to(glow, { opacity: 0.32 }, 0),
        );
        if (!calm) {
          T(
            gsap.to(glow, {
              opacity: 0.1,
              duration: 1.1,
              ease: 'sine.inOut',
              yoyo: true,
              repeat: -1,
              delay: 0.6,
            }),
          );
        }
      },
      thinking() {
        // Connecting the dots: Canis Major drawn one star at a time, instead of a spinner.
        toNeutral(0.3);
        T(gsap.to(star, { scale: 0.86, duration: 0.5, ease: 'power2.out' }));
        T(gsap.to(glow, { opacity: 0.22, duration: 0.5 }));
        const tl = gsap.timeline({ repeat: calm ? 0 : -1, repeatDelay: 0.35, delay: 0.3 });
        tl.set(constel, { opacity: 1 })
          .set(lines, { strokeDashoffset: (i: number) => LINES[i]?.len ?? 0 })
          .set(dots, { scale: 0, opacity: 1 });
        LINES.forEach((line, i) => {
          const dot = dots[DOTS.findIndex((d) => d.k === line.to)];
          tl.to(
            lines[i] as SVGElement,
            { strokeDashoffset: 0, duration: 0.45, ease: 'power1.inOut' },
            0.2 + i * 0.5,
          );
          if (dot)
            tl.to(dot, { scale: 1, duration: 0.32, ease: 'back.out(3)' }, 0.2 + i * 0.5 + 0.38);
        });
        tl.to(
          dots,
          {
            opacity: 0.35,
            duration: 0.28,
            yoyo: true,
            repeat: 3,
            stagger: { each: 0.07, from: 'random' },
          },
          '+=.15',
        ).to(constel, { opacity: 0, duration: 0.7 }, '+=.3');
        T(tl);
      },
      working() {
        // The shape holds still while the light moves.
        toNeutral(0.3);
        if (calm) return;
        T(gsap.to(gp, { a: '+=360', duration: 5, ease: 'none', repeat: -1, onUpdate: applyGrad }));
        gl.a = 20;
        applyGlint();
        T(gsap.to(glint, { opacity: 0.5, duration: 0.5 }));
        T(
          gsap.to(gl, {
            a: '+=360',
            duration: 2.4,
            ease: 'none',
            repeat: -1,
            onUpdate: applyGlint,
          }),
        );
        T(gsap.to(star, { rotation: '+=180', duration: 6, ease: 'none', repeat: -1 }));
      },
      speaking() {
        toNeutral(0.3);
        // After the reset, or its overwrite would kill the quickTo tweens.
        T(
          gsap.delayedCall(0.32, () => {
            const sx = gsap.quickTo(star, 'scaleX', { duration: 0.08, ease: 'power2.out' });
            const sy = gsap.quickTo(star, 'scaleY', { duration: 0.08, ease: 'power2.out' });
            const go = gsap.quickTo(glow, 'opacity', { duration: 0.08, ease: 'power2.out' });
            let env = 0;
            let target = 0;
            let nextAt = 0;
            ticker = (_time, dtMs) => {
              const now = performance.now() / 1000;
              const dt = Math.max(dtMs, 1) / 1000;
              const { readLevel: read, level: heard } = live.current;
              let v: number;
              if (read) v = Math.min(1, read());
              else if (heard > 0) v = Math.min(1, heard);
              else {
                // No level, as with the phone's own speech: syllables of 90–220 ms, word gaps.
                if (now > nextAt) {
                  const gap = Math.random() < 0.18;
                  target = gap ? 0.03 : R(0.35, 1);
                  nextAt = now + (gap ? R(0.25, 0.55) : R(0.09, 0.22));
                }
                v = target;
              }
              env += (v - env) * (1 - Math.exp(-dt / (v > env ? 0.03 : 0.15)));
              sx(1 + 0.42 * env);
              sy(1 + 0.42 * env);
              go(0.12 + 0.75 * env);
            };
            gsap.ticker.add(ticker);
          }),
        );
      },
      notify() {
        // A short howl: the head lifts, the star flares and sends out one ripple.
        toNeutral(0.25);
        T(
          gsap
            .timeline({ onComplete: settled })
            .to(wolf, { rotation: -5, duration: 0.5, ease: 'power2.out' }, 0.1)
            .to(starG, { scale: 1.5, rotation: 45, duration: 0.35, ease: 'back.out(2)' }, 0.25)
            .to(glow, { opacity: 1, duration: 0.25 }, 0.25)
            .fromTo(
              ripple,
              { attr: { r: 14 }, opacity: 0.9 },
              { attr: { r: 96 }, opacity: 0, duration: 1.3, ease: 'power2.out' },
              0.3,
            )
            .to(starG, { scale: 1, rotation: 0, duration: 0.7, ease: 'power2.inOut' }, 0.95)
            .to(glow, { opacity: 0, duration: 0.8 }, 0.95)
            .to(wolf, { rotation: 0, duration: 0.9, ease: 'power2.inOut' }, 1.25),
        );
      },
      error() {
        // The star flickers out, sags and relights a beat later: noticed, not alarming.
        toNeutral(0.2);
        T(
          gsap
            .timeline({ onComplete: settled })
            .to(star, { opacity: 0.25, duration: 0.05 })
            .to(star, { opacity: 0.85, duration: 0.05 })
            .to(star, { opacity: 0.1, duration: 0.07 })
            .to(star, { opacity: 0.6, duration: 0.04 })
            .to(star, { opacity: 0, duration: 0.12 })
            .to(starG, { y: 7, duration: 0.45, ease: 'power2.in' }, '<')
            .to({}, { duration: 0.55 })
            .set(star, { scale: 0.5 })
            .to(star, { opacity: 1, scale: 1, duration: 0.5, ease: 'back.out(2.5)' })
            .to(starG, { y: 0, duration: 0.5, ease: 'power2.out' }, '<')
            .fromTo(glow, { opacity: 0.8 }, { opacity: 0, duration: 0.7 }, '<'),
        );
      },
      sleep() {
        toNeutral(0.3);
        T(
          gsap
            .timeline({ defaults: { duration: 2.2, ease: 'power2.inOut' } })
            .to(eye, { scaleY: 0.12 }, 0)
            .to(starG, { x: 24, y: -22, scale: 0.8, opacity: 0.4 }, 0)
            .to(mark, { opacity: 0.82 }, 0), // ring and wolf as one layer: no overlap band
        );
        if (!calm && ambient) {
          T(
            gsap.to(wolf, {
              scale: 1.008,
              duration: 4,
              ease: 'sine.inOut',
              yoyo: true,
              repeat: -1,
              delay: 2.2,
            }),
          );
          T(
            gsap.to(star, {
              opacity: 0.55,
              duration: 2.5,
              ease: 'sine.inOut',
              yoyo: true,
              repeat: -1,
              delay: 2.2,
            }),
          );
        }
      },
    };

    svg.dataset.running = String(!calm && state !== 'sleep' && (state !== 'idle' || ambient));
    run[state]();
    return () => {
      alive = false;
      for (const t of timers) clearTimeout(t);
      for (const a of scope) a.kill();
      if (ticker) gsap.ticker.remove(ticker);
      // Killed where they are, not reverted: the next state eases on from here.
      gsap.killTweensOf([
        mark,
        wolf,
        ear,
        eye,
        starG,
        star,
        glow,
        glint,
        constel,
        ripple,
        reveal,
        ...lines,
        ...dots,
        gp,
        gl,
      ]);
    };
  }, [state, ambient]);

  useEffect(() => () => gsap.killTweensOf(root.current?.querySelectorAll('*') ?? []), []);

  const fill = `url(#${id}-grad)`;
  const brand = ink ? ['var(--ink)', 'var(--ink)'] : ['var(--sirius-1)', 'var(--sirius-2)'];
  return (
    <svg
      ref={root}
      className="sirius-logo"
      data-state={state}
      viewBox="0 0 512 512"
      width={size}
      height={size}
      role="img"
      aria-label={`Sirius, ${state}`}
    >
      <defs>
        <linearGradient
          className="l-grad"
          id={`${id}-grad`}
          gradientUnits="userSpaceOnUse"
          {...GRAD}
        >
          <stop style={{ stopColor: brand[0] }} />
          <stop offset="1" style={{ stopColor: brand[1] }} />
        </linearGradient>
        <filter id={`${id}-glow`} x="-60%" y="-60%" width="220%" height="220%">
          <feGaussianBlur stdDeviation="7" />
        </filter>
        <filter id={`${id}-glint`} x="-100%" y="-100%" width="300%" height="300%">
          <feGaussianBlur stdDeviation="16" />
        </filter>
        <clipPath id={`${id}-ring`}>
          <path d={ORBIT.ring} />
        </clipPath>
        <mask id={`${id}-reveal`} maskUnits="userSpaceOnUse" x="0" y="0" width="512" height="512">
          {/* Starts at the ring's upper tip and runs counter-clockwise. */}
          <circle
            className="l-reveal"
            r={REVEAL_R}
            fill="none"
            stroke="#fff"
            strokeWidth="80"
            transform={`translate(${CX} ${CY}) rotate(286) scale(1 -1)`}
          />
        </mask>
      </defs>
      <g fill={fill} fillRule="evenodd">
        <g className="l-mark">
          <g className="l-wolf">
            <path d={ORBIT.head} />
            <path className="l-ear" d={ORBIT.earBack} />
            <path className="l-eye" d={ORBIT.eye} />
          </g>
          <g mask={`url(#${id}-reveal)`}>
            <path d={ORBIT.ring} />
            <g clipPath={`url(#${id}-ring)`}>
              <circle
                className="l-glint"
                r="44"
                fill="#ffffff"
                filter={`url(#${id}-glint)`}
                opacity="0"
              />
            </g>
          </g>
        </g>
        <g className="l-constel" opacity="0">
          {LINES.map((l) => (
            <line
              key={`${l.x1}-${l.to}`}
              className="l-line"
              x1={l.x1}
              y1={l.y1}
              x2={l.x2}
              y2={l.y2}
              stroke={fill}
              strokeWidth="1.5"
              strokeLinecap="round"
              opacity="0.75"
              style={{ strokeDasharray: l.len, strokeDashoffset: l.len }}
            />
          ))}
          {DOTS.map((d) => (
            <circle key={d.k} className="l-dot" cx={d.xy[0]} cy={d.xy[1]} r={d.r} />
          ))}
        </g>
        <circle
          className="l-ripple"
          cx={SX}
          cy={SY}
          r="14"
          fill="none"
          stroke={fill}
          strokeWidth="1.6"
          opacity="0"
        />
        <g className="l-starG">
          <path
            className="l-glow"
            d={ORBIT.star}
            fill={ink ? 'var(--muted)' : '#cfd5ff'}
            filter={`url(#${id}-glow)`}
            opacity="0"
          />
          <path className="l-star" d={ORBIT.star} />
        </g>
      </g>
    </svg>
  );
}
