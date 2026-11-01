import { createHttpClient, type SiriusClient } from '@sirius/contracts';
import { invoke } from '@tauri-apps/api/core';
import { createFixtureClient } from './fixtureClient.ts';

interface CoreConnection {
  url: string;
  token: string | null;
}

/** Picks the backend once at startup. Everything above this seam only sees `SiriusClient`. */
export async function connect(): Promise<SiriusClient> {
  const params = new URLSearchParams(window.location.search);
  if (params.has('fixtures')) {
    return createFixtureClient({ toastAfterMs: Number(params.get('toastMs') ?? 14_000) });
  }
  if ('__TAURI_INTERNALS__' in window) {
    const { url, token } = await invoke<CoreConnection>('core_connection');
    return createHttpClient({ baseUrl: url, ...(token ? { token } : {}) });
  }
  // In dev and in the browser the core is same-origin (the Vite proxy adds the token).
  return createHttpClient({ baseUrl: '' });
}
