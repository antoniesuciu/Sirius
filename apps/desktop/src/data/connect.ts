import { createHttpClient, type SiriusClient } from '@sirius/contracts';
import { invoke } from '@tauri-apps/api/core';
import { createFixtureClient } from './fixtureClient.ts';

interface CoreConnection {
  url: string;
  token: string | null;
  /** Cloudflare Access service token headers, when the core is behind Access. */
  headers: Record<string, string>;
}

/** Picks the backend once at startup. Everything above this seam only sees `SiriusClient`. */
export async function connect(): Promise<SiriusClient> {
  const params = new URLSearchParams(window.location.search);
  if (params.has('fixtures')) {
    return createFixtureClient({ toastAfterMs: Number(params.get('toastMs') ?? 14_000) });
  }
  if ('__TAURI_INTERNALS__' in window) {
    const { url, token, headers } = await invoke<CoreConnection>('core_connection');
    return createHttpClient({ baseUrl: url, headers, ...(token ? { token } : {}) });
  }
  // A browser is same-origin: the Vite proxy in dev, the core itself on a phone. Identity
  // there comes from the Vite proxy or from Cloudflare Access, never from this bundle.
  return createHttpClient({ baseUrl: '' });
}
