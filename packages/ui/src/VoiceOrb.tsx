/**
 * Sirius as an orb, where the wolf was (F40). Three styles, chosen by asking Sirius:
 * - sphere: a dot-matrix sphere in the theme's gradient that turns and ripples with the voice
 *   (after docs/design/references/orb-theme-mock.png and particle-sphere.jpg);
 * - ring: lines around the edge that swell with the voice, with bright arcs running round it;
 * - dot: a plain circle that pulses.
 * Idle is one still frame. Frames run only while listening, thinking or speaking (ADR 0004).
 */
import type { OrbStyle } from '@sirius/contracts';
import { useEffect, useRef } from 'react';
import type { AvatarState } from './SiriusAvatar.tsx';

export interface VoiceOrbProps {
  state: AvatarState;
  orb?: OrbStyle;
  /** CSS pixels, square. */
  size?: number;
  /** Changes when the theme does, so the colours are read again. */
  theme?: string;
  /** Loudness 0–1 when known: the laptop's speaker while speaking. */
  level?: number;
  /** Read every frame, for a live source such as the phone's microphone. */
  readLevel?: () => number;
}

type Rgb = [number, number, number];

function parseColor(value: string, fallback: Rgb): Rgb {
  const hex = value.trim().match(/^#([0-9a-f]{6})$/i)?.[1];
  if (!hex) return fallback;
  return [0, 2, 4].map((i) => Number.parseInt(hex.slice(i, i + 2), 16)) as Rgb;
}

/** 64 steps through the theme's four orb colours, top of the sphere to bottom. */
function palette(el: Element): { colors: string[]; glow: boolean } {
  const style = getComputedStyle(el);
  const stops = [1, 2, 3, 4].map((n) =>
    parseColor(style.getPropertyValue(`--orb-${n}`), [120, 120, 120]),
  );
  const colors: string[] = [];
  for (let i = 0; i < 64; i++) {
    const at = (i / 63) * (stops.length - 1);
    const k = Math.min(stops.length - 2, Math.floor(at));
    const f = at - k;
    const a = stops[k] as Rgb;
    const b = stops[k + 1] as Rgb;
    colors.push(`rgb(${a.map((c, j) => Math.round(c + ((b[j] as number) - c) * f)).join(',')})`);
  }
  return { colors, glow: style.getPropertyValue('--orb-glow').trim() === '1' };
}

interface Point {
  x: number;
  y: number;
  z: number;
  seed: number;
}

/** Latitude rows of evenly spaced dots: projected, they read as the mock's dot matrix. */
function spherePoints(rows: number): Point[] {
  const points: Point[] = [];
  for (let i = 0; i < rows; i++) {
    const theta = (Math.PI * (i + 0.5)) / rows;
    const ring = Math.sin(theta);
    const count = Math.max(4, Math.round(rows * 2 * ring));
    for (let j = 0; j < count; j++) {
      const phi = (2 * Math.PI * (j + (i % 2) * 0.5)) / count;
      points.push({
        x: ring * Math.cos(phi),
        y: Math.cos(theta),
        z: ring * Math.sin(phi),
        seed: points.length * 12.9898,
      });
    }
  }
  return points;
}

interface Frame {
  ctx: CanvasRenderingContext2D;
  size: number;
  dpr: number;
  t: number;
  /** How much the voice moves it, 0–1.3. */
  amp: number;
  colors: string[];
  glow: boolean;
}

const TILT = 0.38;

function drawSphere(f: Frame, points: Point[]): void {
  const { ctx, size, dpr, t, amp, colors, glow } = f;
  const c = size / 2;
  const radius = size * 0.34;
  if (glow) {
    // The soft light behind the sphere: cool above, warm below.
    for (const [dy, color, alpha] of [
      [-0.25, colors[4], 0.22],
      [0.3, colors[60], 0.18],
    ] as const) {
      const g = ctx.createRadialGradient(c, c + dy * radius, 0, c, c + dy * radius, radius * 1.45);
      g.addColorStop(0, color ?? '#888');
      g.addColorStop(1, 'transparent');
      ctx.globalAlpha = alpha;
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, size, size);
    }
  }
  ctx.globalCompositeOperation = glow ? 'lighter' : 'source-over';
  const spin = t * 0.35;
  const cosA = Math.cos(spin);
  const sinA = Math.sin(spin);
  const cosT = Math.cos(TILT);
  const sinT = Math.sin(TILT);
  const dot = Math.max(1, Math.min(2.4, size / (90 * dpr))) * dpr;
  for (const p of points) {
    // Turn about the vertical axis, then tilt towards the viewer.
    const x1 = p.x * cosA + p.z * sinA;
    const z1 = -p.x * sinA + p.z * cosA;
    const y2 = p.y * cosT - z1 * sinT;
    const z2 = p.y * sinT + z1 * cosT;
    const wave =
      Math.sin(3.1 * p.x + 1.9 * t) * Math.sin(2.7 * p.y - 1.4 * t) +
      0.6 * Math.sin(4.3 * p.z + 2.3 * t + 1.7 * p.y);
    // Loud moments throw the edge dots outward, as in the reference.
    const scatter = amp > 0.2 ? Math.max(0, Math.sin(p.seed + t * 3.3)) ** 6 * amp * 0.25 : 0;
    const d = 1 + amp * 0.2 * wave + scatter;
    const front = (z2 + 1) / 2;
    ctx.globalAlpha = 0.12 + 0.88 * front ** 1.6;
    const shade = Math.round((1 - (y2 + 1) / 2) * 63 + x1 * 4);
    ctx.fillStyle = colors[Math.max(0, Math.min(63, shade))] ?? '#888';
    const s = dot * (0.55 + 0.75 * front);
    ctx.fillRect(c + x1 * radius * d - s / 2, c - y2 * radius * d - s / 2, s, s);
  }
}

function drawRing(f: Frame): void {
  const { ctx, size, dpr, t, amp, colors, glow } = f;
  const c = size / 2;
  const radius = size * 0.36;
  const width = Math.max(1.2, size / (70 * dpr)) * dpr;
  ctx.globalCompositeOperation = glow ? 'lighter' : 'source-over';
  ctx.lineCap = 'round';
  // Three closed lines that bend with the voice, each in its own part of the gradient.
  for (let line = 0; line < 3; line++) {
    ctx.beginPath();
    for (let i = 0; i <= 120; i++) {
      const a = (i / 120) * Math.PI * 2;
      const bend =
        Math.sin(3 * a + t * 1.6 * (line + 1) + line * 2) * Math.sin(2 * a - t * 1.1 + line);
      const r = radius * (1 + amp * 0.14 * bend);
      const x = c + r * Math.cos(a);
      const y = c + r * Math.sin(a);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = colors[line * 28] ?? '#888';
    ctx.globalAlpha = 0.55 + 0.15 * line;
    ctx.lineWidth = width;
    ctx.stroke();
  }
  // Bright arcs running round the edge: one while thinking, two while the voice is on.
  const arcs = amp > 0.3 ? 2 : 1;
  for (let k = 0; k < arcs; k++) {
    const start = t * (1.8 + k * 0.7) + k * Math.PI;
    const length = 0.6 + amp * 0.9;
    for (let s = 0; s < 8; s++) {
      ctx.beginPath();
      ctx.arc(c, c, radius, start + (s * length) / 8, start + ((s + 1) * length) / 8);
      ctx.strokeStyle = colors[Math.min(63, 20 + s * 5 + k * 12)] ?? '#888';
      ctx.globalAlpha = 0.15 + (s / 8) * 0.85;
      ctx.lineWidth = width * (1.4 + s * 0.12);
      ctx.stroke();
    }
  }
}

function drawDot(f: Frame): void {
  const { ctx, size, amp, colors, glow } = f;
  const c = size / 2;
  const radius = size * 0.24 * (1 + amp * 0.28);
  const g = ctx.createLinearGradient(0, c - radius, 0, c + radius);
  g.addColorStop(0, colors[0] ?? '#888');
  g.addColorStop(1, colors[63] ?? '#888');
  if (amp > 0.05) {
    ctx.globalAlpha = Math.min(0.5, amp * 0.5);
    ctx.strokeStyle = g;
    ctx.lineWidth = size * 0.02;
    ctx.beginPath();
    ctx.arc(c, c, radius * (1.25 + amp * 0.35), 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.globalCompositeOperation = glow ? 'lighter' : 'source-over';
  ctx.globalAlpha = 1;
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(c, c, radius, 0, Math.PI * 2);
  ctx.fill();
}

const MOVING: ReadonlySet<AvatarState> = new Set(['listening', 'thinking', 'speaking']);

/** How much the voice moves it, and how fast it turns, for each state. */
function motion(
  state: AvatarState,
  t: number,
  heard: number | null,
): { amp: number; pace: number } {
  if (state === 'thinking') return { amp: 0.22 + 0.06 * Math.sin(t * 1.4), pace: 0.55 };
  if (state === 'listening') return { amp: 0.25 + (heard ?? 0.3) * 0.95, pace: 1 };
  if (state === 'speaking') {
    // A phone's own speech reports no level, so give it the uneven rhythm of syllables.
    const syllables = 0.5 + 0.35 * Math.sin(t * 7.3) * Math.sin(t * 2.9);
    return { amp: 0.3 + (heard ?? syllables) * 0.95, pace: 1.15 };
  }
  return { amp: 0, pace: 0 };
}

export function VoiceOrb({
  state,
  orb = 'sphere',
  size = 44,
  theme,
  level,
  readLevel,
}: VoiceOrbProps) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const latest = useRef({ state, level, readLevel });
  latest.current = { state, level, readLevel };
  const moving = MOVING.has(state);

  useEffect(() => {
    const el = canvas.current;
    const ctx = el?.getContext('2d');
    if (!el || !ctx) return;
    const dpr = Math.min(3, Math.max(2, window.devicePixelRatio || 1));
    const px = Math.round(size * dpr);
    el.width = px;
    el.height = px;
    const { colors, glow } = palette(el);
    const points =
      orb === 'sphere' ? spherePoints(Math.max(14, Math.min(44, Math.round(size / 4.5)))) : [];
    const render = (t: number, amp: number) => {
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
      ctx.clearRect(0, 0, px, px);
      const frame: Frame = { ctx, size: px, dpr, t, amp, colors, glow };
      if (orb === 'sphere') drawSphere(frame, points);
      else if (orb === 'ring') drawRing(frame);
      else drawDot(frame);
    };
    const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    if (!moving || still) {
      render(0.8, moving ? 0.3 : 0);
      el.dataset.running = 'false';
      return;
    }
    el.dataset.running = 'true';
    let frame = 0;
    let amp = 0;
    let clock = 0.8;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const { state: s, level: l, readLevel: read } = latest.current;
      const heard = read ? read() : l !== undefined && l > 0 ? l : null;
      const goal = motion(s, clock, heard);
      clock += dt * Math.max(0.2, goal.pace);
      // Eased, so a jump in loudness reads as a swell, not a flicker.
      amp += (goal.amp - amp) * 0.16;
      render(clock, amp);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      el.dataset.running = 'false';
    };
    // `theme` is listed so a new theme's colours are read again.
  }, [moving, orb, size, theme]);

  return (
    <canvas
      ref={canvas}
      className="voice-orb"
      data-state={state}
      data-orb={orb}
      aria-hidden="true"
      style={{ width: size, height: size }}
    />
  );
}
