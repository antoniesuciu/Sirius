import { createHttpClient, type SiriusClient } from '@sirius/contracts';
import { createFixtureClient } from './fixtureClient.ts';

/** Picks the backend once at startup. Everything above this seam only sees `SiriusClient`. */
export function connect(): SiriusClient {
  const params = new URLSearchParams(window.location.search);
  if (params.has('fixtures')) {
    return createFixtureClient({ toastAfterMs: Number(params.get('toastMs') ?? 14_000) });
  }
  // In dev and in the browser the core is same-origin (Vite proxy, or the core itself).
  return createHttpClient({ baseUrl: '' });
}
