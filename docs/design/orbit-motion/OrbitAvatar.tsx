import { gsap } from 'gsap';
import { DrawSVGPlugin } from 'gsap/DrawSVGPlugin';
import { useEffect, useId, useLayoutEffect, useRef } from 'react';
import { useState } from 'react';

function usePageHidden() {
  const [hidden, setHidden] = useState(document.hidden);
  useEffect(() => {
    const update = () => setHidden(document.hidden);
    document.addEventListener('visibilitychange', update);
    return () => document.removeEventListener('visibilitychange', update);
  }, []);
  return hidden;
}

gsap.registerPlugin(DrawSVGPlugin);

export type OrbitState = 'idle' | 'listening' | 'thinking' | 'speaking' | 'needs_input';

export interface OrbitAvatarProps {
  state: OrbitState;
  /** The approved 512 × 512 transparent Orbit artwork. */
  artwork: string;
  /** Actual voice amplitude, 0–1. Zero stays quiet; no invented speech. */
  level?: number;
  size?: number;
  still?: boolean;
  expressive?: boolean;
}

const STAR = 'M370 96 C366 126 365 134 326 142 C360 146 365 150 370 188 C376 152 380 148 413 142 C379 136 376 132 370 96 Z';

/** Experimental Orbit logo animation. Independent of the shipped VoiceOrb. */
export function OrbitAvatar({
  state, artwork, level = 0, size = 240, still = false, expressive = false,
}: OrbitAvatarProps) {
  const root = useRef<SVGSVGElement>(null);
  const star = useRef<SVGGElement>(null);
  const glow = useRef<SVGGElement>(null);
  const hidden = usePageHidden();
  const [reduced, setReduced] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReduced(query.matches);
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  const id = useId().replace(/:/g, '');
  const amplitude = Number.isFinite(level) ? Math.max(0, Math.min(1, level)) : 0;

  useLayoutEffect(() => {
    const media = gsap.matchMedia();
    const context = gsap.context(() => {
      gsap.set('.orbit-star', { svgOrigin: '370 142' });
      gsap.set('.orbit-halo', { svgOrigin: '370 142' });
      gsap.set('.orbit-track', { svgOrigin: '256 262' });
      gsap.set('.orbit-track', { opacity: 0 });
      gsap.set('.orbit-halo', { opacity: state === 'needs_input' ? 0.55 : 0.15 });
      gsap.set('.orbit-star', { fill: state === 'needs_input' ? '#f3b96a' : `url(#${id}-ink)` });

      media.add('(prefers-reduced-motion: no-preference)', () => {
        if (still || hidden) return;
        const strength = expressive ? 1.2 : 1;
        if (state === 'idle') {
          gsap.timeline({ repeat: -1, repeatDelay: 3.8 })
            .to('.orbit-star', { scale: 1 + 0.075 * strength, duration: 0.9, ease: 'sine.inOut' })
            .to('.orbit-star', { scale: 1, duration: 1.1, ease: 'sine.inOut' });
          gsap.to('.orbit-halo', { opacity: 0.45, duration: 1, repeat: -1, yoyo: true, repeatDelay: 2.8, ease: 'sine.inOut' });
        } else if (state === 'listening') {
          gsap.fromTo('.orbit-track', { drawSVG: '0% 0%', opacity: 0 },
            { drawSVG: '0% 78%', opacity: 0.85, duration: 1.25, ease: 'power2.out' });
          gsap.to('.orbit-track', { rotation: 360, duration: 18, repeat: -1, ease: 'none' });
          gsap.to('.orbit-body', { opacity: 1, duration: 0.6 });
          gsap.to('.orbit-star', { scale: 1.08, duration: 1.8, repeat: -1, yoyo: true, ease: 'sine.inOut' });
        } else if (state === 'thinking') {
          gsap.set('.orbit-track', { opacity: 0.95, drawSVG: '0% 19%' });
          gsap.to('.orbit-track', { rotation: 360, duration: 2.6, repeat: -1, ease: 'none' });
          gsap.to('.orbit-halo', { opacity: 0.5, duration: 1.3, repeat: -1, yoyo: true, ease: 'sine.inOut' });
        } else if (state === 'needs_input') {
          gsap.timeline({ repeat: -1, repeatDelay: 0.65 })
            .to('.orbit-star', { scale: 1.18, duration: 0.32, ease: 'power2.out' })
            .to('.orbit-star', { scale: 1, duration: 0.45, ease: 'sine.inOut' });
          gsap.fromTo('.orbit-halo', { scale: 1, opacity: 0.7 },
            { scale: 1.75, opacity: 0, duration: 1.42, repeat: -1, ease: 'power1.out' });
        }
      });
    }, root);
    if (root.current) root.current.dataset.running = String(!still && !hidden && !window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    return () => { media.revert(); context.revert(); };
  }, [state, still, hidden, expressive, id, reduced]);

  useEffect(() => {
    if (state !== 'speaking' || !star.current || !glow.current) return;
    const context = gsap.context(() => {
      const active = !still && !hidden && !reduced;
      gsap.to(star.current, { scale: active ? 1 + amplitude * (expressive ? 0.5 : 0.32) : 1, duration: active ? 0.12 : 0, ease: 'power1.out' });
      gsap.to(glow.current, { opacity: active ? 0.12 + amplitude * 0.8 : 0.15, duration: active ? 0.16 : 0 });
    }, root);
    return () => context.revert();
  }, [state, amplitude, still, hidden, expressive, reduced]);

  return (
    <svg ref={root} className="orbit-avatar" data-state={state} data-level={amplitude}
      viewBox="0 0 512 512" width={size} height={size} role="img" aria-label={`Sirius: ${state.replace('_', ' ')}`}>
      <defs>
        <linearGradient id={`${id}-ink`} x1="0" y1="0" x2="0" y2="1">
          <stop stopColor="#657ec1" /><stop offset="1" stopColor="#9769ab" />
        </linearGradient>
        <linearGradient id={`${id}-light`}><stop stopColor="#8c8af6" stopOpacity="0" /><stop offset="1" stopColor="#c8d9ff" /></linearGradient>
        <clipPath id={`${id}-body`}><path clipRule="evenodd" d="M0 0H512V512H0Z M320 90V194H420V90Z" /></clipPath>
        <filter id={`${id}-glow`} x="-100%" y="-100%" width="300%" height="300%"><feGaussianBlur stdDeviation="9" /></filter>
      </defs>
      <image className="orbit-body" href={artwork} width="512" height="512" clipPath={`url(#${id}-body)`} opacity="0.88" />
      <circle className="orbit-track" cx="256" cy="262" r="202" fill="none" stroke={`url(#${id}-light)`} strokeWidth={expressive ? 5 : 3} strokeLinecap="round" opacity="0" />
      <g ref={glow} className="orbit-halo" opacity="0.15" filter={`url(#${id}-glow)`} fill={state === 'needs_input' ? '#f3b96a' : '#a6a4ff'}><path d={STAR} /></g>
      <g ref={star} className="orbit-star" fill={`url(#${id}-ink)`}><path d={STAR} /></g>
    </svg>
  );
}
