import { createHttpClient, type SiriusClient } from '@sirius/contracts';
import { invoke } from '@tauri-apps/api/core';
import { createFixtureClient } from './fixtureClient.ts';

interface CoreConnection {
  url: string;
  token: string | null;
  /** Cloudflare Access service token headers, when the core is behind Access. */
  headers: Record<string, string>;
}

export type Boot =
  | {
      kind: 'ready';
      client: SiriusClient;
      /** A browser: the phone, or development. It keeps a copy for offline use (ADR 0010). */
      phone: boolean;
      /** Whether the core answered just now. A phone opened away from the laptop starts offline. */
      reachable: boolean;
    }
  | { kind: 'pair'; code: string | null };

const TOKEN_KEY = 'sirius.phone-token';
/** Long enough for a phone on a slow network, short enough to notice a sleeping laptop. */
const PHONE_TIMEOUT_MS = 8000;

export function storedToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function saveToken(token: string | null): void {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    // Storage can be off in a private window. Pairing then lasts until the tab closes.
  }
}

/** `sirius pair` prints a link ending in #pair=123456. */
export function codeFromLink(): string | null {
  return window.location.hash.match(/pair=(\d{6})/)?.[1] ?? null;
}

/** Picks the backend once at startup. Everything above this seam only sees `SiriusClient`. */
export async function connect(): Promise<Boot> {
  const params = new URLSearchParams(window.location.search);
  if (params.has('fixtures')) {
    const client = createFixtureClient({ toastAfterMs: Number(params.get('toastMs') ?? 14_000) });
    return { kind: 'ready', client, phone: false, reachable: true };
  }
  if ('__TAURI_INTERNALS__' in window) {
    const { url, token, headers } = await invoke<CoreConnection>('core_connection');
    const client = createHttpClient({ baseUrl: url, headers, ...(token ? { token } : {}) });
    return { kind: 'ready', client, phone: false, reachable: true };
  }

  // A browser is same-origin: the core itself on a phone, or the Vite proxy in development.
  // Identity is a paired phone's token, or the proxy, or Cloudflare Access, never this bundle.
  const token = storedToken();
  const auth: Record<string, string> = token ? { authorization: `Bearer ${token}` } : {};
  const reply = await fetch('/v1/agents', {
    headers: auth,
    signal: AbortSignal.timeout(PHONE_TIMEOUT_MS / 2),
  }).catch(() => null);
  if (reply?.status === 401) {
    saveToken(null);
    return { kind: 'pair', code: codeFromLink() };
  }
  if (codeFromLink()) window.history.replaceState(null, '', window.location.pathname);
  const client = createHttpClient({
    baseUrl: '',
    timeoutMs: PHONE_TIMEOUT_MS,
    ...(token ? { token } : {}),
  });
  return { kind: 'ready', client, phone: true, reachable: reply?.ok === true };
}
