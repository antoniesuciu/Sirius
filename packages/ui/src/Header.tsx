import { useState } from 'react';
import { Clock } from './Clock.tsx';
import { useTypewriter } from './hooks.ts';

export interface HeaderProps {
  /** Null until today's data has loaded. It types once and then stays put (F2). */
  greeting: string | null;
  suggestions: string[];
  quiet: boolean;
  onToggleQuiet(): void;
  /** The two buttons; the phone goes without them (owner, 2026-11-05). */
  actions?: boolean;
}

export function Header({
  greeting,
  suggestions,
  quiet,
  onToggleQuiet,
  actions = true,
}: HeaderProps) {
  // Lock in the first greeting: live data changing later must not retype it.
  const [locked, setLocked] = useState<string | null>(null);
  if (locked === null && greeting !== null) setLocked(greeting);
  const typedGreeting = useTypewriter(locked, 42);

  const [press, setPress] = useState<{ index: number; text: string } | null>(null);
  const typedSuggestion = useTypewriter(press?.text ?? null, 26);

  const nextSuggestion = () => {
    if (suggestions.length === 0) return;
    const index = ((press?.index ?? -1) + 1) % suggestions.length;
    setPress({ index, text: suggestions[index] ?? '' });
  };

  return (
    <header className="header">
      <div className="header-left">
        <Clock />
        <h1 className="greeting">
          {typedGreeting.shown}
          {typedGreeting.typing && <span className="caret" />}
        </h1>
        <div className="suggestion">
          {press && (
            <span>
              {typedSuggestion.shown}
              {typedSuggestion.typing && <span className="caret" />}
            </span>
          )}
        </div>
      </div>
      {actions && (
        <div className="header-actions">
          <button type="button" className="pill pill-lg" onClick={nextSuggestion}>
            What should I do now?
          </button>
          <button type="button" className="pill pill-lg pill-solid" onClick={onToggleQuiet}>
            {quiet ? 'Welcome back' : "I'm done for today"}
          </button>
        </div>
      )}
    </header>
  );
}
