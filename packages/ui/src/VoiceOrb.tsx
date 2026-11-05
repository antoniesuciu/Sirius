/**
 * The canvas voice animations (F40), chosen by asking Sirius instead of the wolf (SiriusMark):
 * - ring: lines around the edge that swell with the voice, with bright arcs running round it;
 * - dot: a plain circle that pulses.
 * Idle is one still frame. Frames run only while listening, thinking or speaking (ADR 0004).
 */
import type { OrbStyle } from '@sirius/contracts';
import { useEffect, useRef } from 'react';
import type { AvatarState } from './SiriusAvatar.tsx';

export interface VoiceOrbProps {
  state: AvatarState;
  orb?: Exclude<OrbStyle, 'sirius'>;
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

/** 64 steps through the theme's four orb colours, top to bottom. */
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
  orb = 'ring',
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
    const render = (t: number, amp: number) => {
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
      ctx.clearRect(0, 0, px, px);
      const frame: Frame = { ctx, size: px, dpr, t, amp, colors, glow };
      if (orb === 'ring') drawRing(frame);
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
