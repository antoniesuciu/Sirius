/** Shared controls for the two logo playgrounds: states (keys 1–9), theme, sizes, voice level. */
import '../../../packages/ui/src/styles/tokens.css';
import './style.css';
import { type ReactNode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';

const THEMES = ['paper', 'sage', 'midnight', 'night-owl', 'graphite', 'ember', 'orb'];
/** Header, voice stage, and close up. */
const SIZES = [44, 200, 360];

export interface StateInfo<S extends string> {
  id: S;
  label: string;
  note: string;
}

export interface RenderOptions<S extends string> {
  state: S;
  size: number;
  level: number;
  /** Ends a one-shot state, as the app would. */
  settle(): void;
  extras: Record<string, boolean>;
}

export function playground<S extends string>(spec: {
  title: string;
  intro: string;
  states: StateInfo<S>[];
  initial: S;
  /** Where a one-shot state goes when it ends. */
  after: S;
  extras?: Record<string, { label: string; on: boolean }>;
  render(o: RenderOptions<S>): ReactNode;
}) {
  function Playground() {
    const [state, setState] = useState<S>(spec.initial);
    const [theme, setTheme] = useState('paper');
    const [level, setLevel] = useState(0);
    const [extras, setExtras] = useState(() =>
      Object.fromEntries(Object.entries(spec.extras ?? {}).map(([k, v]) => [k, v.on])),
    );
    useEffect(() => {
      if (theme === 'paper') delete document.documentElement.dataset.theme;
      else document.documentElement.dataset.theme = theme;
    }, [theme]);
    useEffect(() => {
      const onKey = (e: KeyboardEvent) => {
        const s = spec.states[Number(e.key) - 1];
        if (s) setState(s.id);
      };
      document.addEventListener('keydown', onKey);
      return () => document.removeEventListener('keydown', onKey);
    }, []);
    const info = spec.states.find((s) => s.id === state);
    return (
      <main>
        <header>
          <h1>{spec.title}</h1>
          <a href="./index.html">All playgrounds</a>
        </header>
        <p className="intro">{spec.intro}</p>
        <section className="stage" aria-label="The logo at the app's sizes">
          {SIZES.map((size) => (
            <figure key={size}>
              {spec.render({ state, size, level, settle: () => setState(spec.after), extras })}
              <figcaption>{size} px</figcaption>
            </figure>
          ))}
        </section>
        <p className="caption">
          <strong>{info?.label}</strong> {info?.note}
        </p>
        <div className="row" role="group" aria-label="State">
          {spec.states.map((s, i) => (
            <button key={s.id} type="button" aria-pressed={s.id === state} onClick={() => setState(s.id)}>
              {s.label} <kbd>{i + 1}</kbd>
            </button>
          ))}
        </div>
        <div className="row" role="group" aria-label="Theme">
          {THEMES.map((t) => (
            <button key={t} type="button" aria-pressed={t === theme} onClick={() => setTheme(t)}>
              {t}
            </button>
          ))}
        </div>
        <div className="row">
          <label>
            Voice level {Math.round(level * 100)}%
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={level}
              onChange={(e) => setLevel(Number(e.target.value))}
            />
          </label>
          {Object.entries(spec.extras ?? {}).map(([k, v]) => (
            <label key={k}>
              <input
                type="checkbox"
                checked={extras[k] ?? false}
                onChange={(e) => setExtras((x) => ({ ...x, [k]: e.target.checked }))}
              />
              {v.label}
            </label>
          ))}
        </div>
        <p className="note">
          At 0% speaking has no level, as on the phone. Reduced motion follows the system setting.
        </p>
      </main>
    );
  }
  const root = document.getElementById('root');
  if (root) createRoot(root).render(<Playground />);
}
