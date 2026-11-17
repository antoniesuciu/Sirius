import { useEffect, useRef, useState } from 'react';
import { prefersReducedMotion } from './hooks.ts';
import { tokenMs } from './motion.ts';

export interface AgentToastProps {
  text: string;
  onGotIt(): void;
  onLater(): void;
}

/** Drops in, stays, and on an answer slips away before the answer goes through. */
type ToastStatus = 'enter' | 'shown' | 'leaving';

export function AgentToast({ text, onGotIt, onLater }: AgentToastProps) {
  const [status, setStatus] = useState<ToastStatus>('enter');
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  const answer = (act: () => void) => {
    if (status === 'leaving') return;
    if (prefersReducedMotion()) {
      act();
      return;
    }
    setStatus('leaving');
    timer.current = setTimeout(() => {
      act();
      // Still here a second later: the answer did not go through, so it shows again.
      timer.current = setTimeout(() => setStatus('shown'), 1000);
    }, tokenMs('--dur-fast'));
  };

  return (
    <div
      className="toast"
      role="status"
      data-status={status}
      onAnimationEnd={(e) => {
        if (e.target === e.currentTarget && status === 'enter') setStatus('shown');
      }}
    >
      <span>{text}</span>
      <div className="toast-actions">
        <button type="button" className="pill" onClick={() => answer(onGotIt)}>
          Got it
        </button>
        <button type="button" className="pill pill-ghost" onClick={() => answer(onLater)}>
          Later
        </button>
      </div>
    </div>
  );
}
