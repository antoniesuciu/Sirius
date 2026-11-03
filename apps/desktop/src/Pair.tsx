import { type FormEvent, useEffect, useRef, useState } from 'react';
import { saveToken } from './data/connect.ts';

/** Names the phone in the laptop's list, from the model Android puts in the user agent. */
function phoneName(): string {
  return navigator.userAgent.match(/Android [\d.]+; ([^;)]+)/)?.[1]?.trim() ?? 'Phone';
}

/** The first screen on a phone that has not paired yet (ADR 0010). */
export function Pair({ code: fromLink }: { code: string | null }) {
  const [code, setCode] = useState(fromLink ?? '');
  const [state, setState] = useState<'idle' | 'sending' | 'failed' | 'unreachable'>('idle');
  const tried = useRef(false);

  const pair = async (value: string) => {
    setState('sending');
    const reply = await fetch('/v1/pair', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code: value, name: phoneName() }),
    }).catch(() => null);
    if (!reply) return setState('unreachable');
    if (!reply.ok) return setState('failed');
    const { token } = (await reply.json()) as { token: string };
    saveToken(token);
    window.location.replace(window.location.pathname);
  };

  useEffect(() => {
    // The link from `sirius pair` carries the code, so opening it is the whole job.
    if (fromLink && !tried.current) {
      tried.current = true;
      void pair(fromLink);
    }
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (/^\d{6}$/.test(code)) void pair(code);
  };

  return (
    <main className="pair">
      <h1>Pair this phone</h1>
      <p>
        On the laptop, run <code>sirius pair</code>. Open the link it shows, or type its code here.
      </p>
      <form onSubmit={submit}>
        <input
          aria-label="Pairing code"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          value={code}
          onChange={(event) => setCode(event.target.value.replace(/\D/g, ''))}
        />
        <button type="submit" className="pill" disabled={state === 'sending'}>
          {state === 'sending' ? 'Pairing…' : 'Pair'}
        </button>
      </form>
      {state === 'failed' && (
        <p role="alert">That code did not work. Run sirius pair again for a new one.</p>
      )}
      {state === 'unreachable' && (
        <p role="alert">The laptop is out of reach. Check that it is awake and Tailscale is on.</p>
      )}
    </main>
  );
}
