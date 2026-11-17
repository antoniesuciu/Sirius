/**
 * Any card can fold down to its title bar, so one that is not needed now takes little room
 * but is still there to open. Remembered per device, since a phone and the laptop differ.
 *
 * The card stays mounted while folded, only its body is hidden, so a draft, a chosen view or
 * a breathing round survives, and the card's entrance animation does not replay.
 */
import { createContext, type ReactNode, useContext, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { ChevronIcon } from './Icons.tsx';
import { followers, measure, reveal, settle } from './motion.ts';

const KEY = 'sirius.folded';

type FoldState = 'open' | 'folded';

/** What a fold shows and hides: everything in the card but its title (see dashboard.css). */
const BODY = ':scope > .panel > :not(.panel-head), :scope > .panel > .panel-head > :not(h2)';

export function readFolded(): Set<string> {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return new Set(Array.isArray(saved) ? saved.filter((v) => typeof v === 'string') : []);
  } catch {
    return new Set();
  }
}

function saveFolded(id: string, folded: boolean) {
  const all = readFolded();
  if (folded) all.add(id);
  else all.delete(id);
  try {
    localStorage.setItem(KEY, JSON.stringify([...all]));
  } catch {}
}

interface FoldContextValue {
  folded: boolean;
  hint: string | undefined;
  toggle(): void;
}

const FoldContext = createContext<FoldContextValue | null>(null);

export interface FoldProps {
  id: string;
  /** Shown beside the title while folded, such as how many items wait inside. */
  hint?: string | undefined;
  children: ReactNode;
}

export function Fold({ id, hint, children }: FoldProps) {
  const [state, setState] = useState<FoldState>(() => (readFolded().has(id) ? 'folded' : 'open'));
  const box = useRef<HTMLDivElement>(null);
  const folded = state === 'folded';

  // The change is instant; the cards below glide to their new place (a FLIP, transform only),
  // and what opens fades in, so nothing animates height or reflows the column each frame.
  const toggle = () => {
    const next: FoldState = folded ? 'open' : 'folded';
    saveFolded(id, next === 'folded');
    const el = box.current;
    if (!el) {
      setState(next);
      return;
    }
    const body = el.querySelectorAll(BODY);
    settle(body);
    const glide = measure(followers(el));
    flushSync(() => setState(next));
    glide();
    if (next === 'open') reveal(body);
  };

  return (
    <FoldContext.Provider value={{ folded, hint, toggle }}>
      <div className="fold" ref={box} data-folded={folded || undefined}>
        {children}
      </div>
    </FoldContext.Provider>
  );
}

/** A card's title. Inside a Fold it is also the button that folds and opens the card. */
export function FoldTitle({ children }: { children: string }) {
  const fold = useContext(FoldContext);
  if (!fold) return children;
  return (
    <button type="button" className="fold-title" aria-expanded={!fold.folded} onClick={fold.toggle}>
      {children}
      <span className="fold-chevron">
        <ChevronIcon />
      </span>
      {fold.folded && fold.hint && <span className="label fold-hint">{fold.hint}</span>}
    </button>
  );
}
