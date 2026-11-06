/**
 * Where the laptop is and the phone's login to it (ADR 0010), kept in the Android keystore.
 * The app, the background task and the widget all build their client from this.
 */
import { createFixtureClient } from '@sirius/client';
import { createHttpClient, type SiriusClient } from '@sirius/contracts';
import * as SecureStore from 'expo-secure-store';

const KEY = 'sirius.connection';
/** Long enough for a phone on a slow network, short enough to notice a sleeping laptop. */
const TIMEOUT_MS = 8000;
/** Typed as the address, it opens the app on the fixture data, with no laptop. */
export const FIXTURES = 'fixtures';

export interface Connection {
  /** Such as https://laptop.tail1234.ts.net, which `sirius pair` prints. */
  address: string;
  token: string;
}

export async function loadConnection(): Promise<Connection | null> {
  try {
    const raw = await SecureStore.getItemAsync(KEY);
    return raw ? (JSON.parse(raw) as Connection) : null;
  } catch {
    return null;
  }
}

export async function saveConnection(connection: Connection | null): Promise<void> {
  if (connection) await SecureStore.setItemAsync(KEY, JSON.stringify(connection));
  else await SecureStore.deleteItemAsync(KEY);
}

/** Accepts what people type: a bare host, a trailing slash, or the link `sirius pair` prints. */
export function normaliseAddress(typed: string): string {
  const trimmed = typed.trim().replace(/#.*$/, '').replace(/\/+$/, '');
  if (trimmed === FIXTURES) return FIXTURES;
  return /^https?:\/\//.test(trimmed) ? trimmed : `https://${trimmed}`;
}

export function clientFor(connection: Connection): SiriusClient {
  if (connection.address === FIXTURES) return createFixtureClient({ toastAfterMs: 20_000 });
  return createHttpClient({
    baseUrl: connection.address,
    token: connection.token,
    timeoutMs: TIMEOUT_MS,
  });
}

/** Trades the six-digit code from `sirius pair` for a login of this phone's own. */
export async function pair(address: string, code: string): Promise<Connection> {
  if (address === FIXTURES) return { address, token: 'fixtures' };
  const res = await fetch(`${address}/v1/pair`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code: code.trim(), name: 'Sirius for Android' }),
  });
  const body = (await res.json().catch(() => null)) as { token?: string; message?: string } | null;
  if (!res.ok || !body?.token) {
    throw new Error(
      body?.message ?? `The laptop answered ${res.status}. Check the code and try again.`,
    );
  }
  return { address, token: body.token };
}
