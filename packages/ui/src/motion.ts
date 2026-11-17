/**
 * The two small motion helpers the cards share. Both only move with transform and opacity
 * (spec section 4.1), take their timing from the tokens in tokens.css, and do nothing under
 * reduced motion.
 *
 * - `measure` is a FLIP: what follows an element is measured, the layout changes at once, and
 *   each follower glides from where it was to where it now is, instead of jumping.
 * - `useLeaving` lets a row fade and slip away first, then runs the change that removes it.
 */
import { type AnimationEvent, useLayoutEffect, useRef, useState } from 'react';
import { prefersReducedMotion } from './hooks.ts';

/** One animation per element, so a second click starts from where the first had got to. */
const running = new WeakMap<Element, Animation>();

function token(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/** A duration token, such as `--dur`, in milliseconds. */
export function tokenMs(name: string): number {
  const value = token(name);
  const n = Number.parseFloat(value);
  if (!Number.isFinite(n)) return 0;
  return value.endsWith('ms') ? n : n * 1000;
}

function canAnimate(): boolean {
  return (
    !prefersReducedMotion() &&
    typeof document !== 'undefined' &&
    typeof document.documentElement.animate === 'function'
  );
}

function play(el: Element, keyframes: Keyframe[], durationToken: string) {
  running.get(el)?.cancel();
  const animation = el.animate(keyframes, {
    duration: tokenMs(durationToken),
    easing: token('--ease-out') || 'ease-out',
  });
  running.set(el, animation);
  animation.addEventListener('finish', () => {
    if (running.get(el) === animation) running.delete(el);
  });
}

/** Everything laid out after `el`: its later siblings, then each ancestor's, up to the body. */
export function followers(el: Element): Element[] {
  const out: Element[] = [];
  for (let node: Element | null = el; node && node !== document.body; node = node.parentElement) {
    for (let next = node.nextElementSibling; next; next = next.nextElementSibling) out.push(next);
  }
  return out;
}

/**
 * Measures `els` now and returns a function to call once the layout has changed: each element
 * that moved then glides from its old place to its new one. The old place includes any glide
 * still running, so repeated clicks never jump.
 */
export function measure(els: Element[]): () => void {
  if (!canAnimate()) return () => {};
  const before = els.map((el) => el.getBoundingClientRect().top);
  for (const el of els) running.get(el)?.cancel();
  return () => {
    els.forEach((el, i) => {
      if (!el.isConnected) return;
      const dy = (before[i] ?? 0) - el.getBoundingClientRect().top;
      if (Math.abs(dy) < 1) return;
      play(el, [{ transform: `translate3d(0, ${dy}px, 0)` }, { transform: 'none' }], '--dur');
    });
  };
}

/** Content just shown fades in and rises a few pixels. */
export function reveal(els: Iterable<Element>) {
  if (!canAnimate()) return;
  for (const el of els) {
    play(
      el,
      [
        { opacity: 0, transform: 'translate3d(0, 4px, 0)' },
        { opacity: 1, transform: 'none' },
      ],
      '--dur',
    );
  }
}

/** Stops any glide or reveal on `els`, so they sit where the layout puts them. */
export function settle(els: Iterable<Element>) {
  for (const el of els) running.get(el)?.cancel();
}

/**
 * For a list whose rows go away: `leave(row, act)` fades the row out over `--dur-fast`, then
 * runs `act` (the change that removes it), and once the row is gone the rows below glide up.
 * Call it from the component that renders the list, so its commit is when the row is gone.
 */
export function useLeaving(): (row: Element | null, act: () => void) => void {
  const pending = useRef<Array<{ row: Element; glide(): void }>>([]);
  useLayoutEffect(() => {
    if (pending.current.length === 0) return;
    const gone = pending.current.filter((p) => !p.row.isConnected);
    pending.current = pending.current.filter((p) => p.row.isConnected);
    for (const p of gone) p.glide();
  });
  return (row, act) => {
    if (!row || !canAnimate()) {
      act();
      return;
    }
    if (!(row instanceof HTMLElement) || row.dataset.leaving) return;
    row.dataset.leaving = 'true';
    setTimeout(() => {
      pending.current.push({ row, glide: measure(followers(row)) });
      act();
      // If the change did not remove the row (refused, say), it shows again.
      setTimeout(() => {
        if (!row.isConnected) return;
        delete row.dataset.leaving;
        pending.current = pending.current.filter((p) => p.row !== row);
      }, 1000);
    }, tokenMs('--dur-fast'));
  };
}

/**
 * A row's entrance, played once. `seen` holds the keys a list has shown (its rows' text), so a
 * row that comes back under a new id, an optimistic copy swapped for the stored one, does not
 * enter again; and once played the class goes, so showing a folded card does not replay it.
 */
export function useEntrance(seen: Set<string>, key: string) {
  const [fresh, setFresh] = useState(() => !seen.has(key) && !prefersReducedMotion());
  seen.add(key);
  return {
    className: fresh ? 'msg' : '',
    onAnimationEnd: (e: AnimationEvent) => {
      if (e.target === e.currentTarget) setFresh(false);
    },
  };
}
