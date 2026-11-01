/**
 * The typed client. It is derived from the op registry rather than generated, so
 * there is no build step to forget and it cannot drift from the server.
 */

import type { SiriusEvent } from './events.ts';
import {
  type HttpMethod,
  type OpDefinition,
  type OpInput,
  type OpName,
  type OpOutput,
  ops,
} from './ops.ts';
import type { Actor, Via } from './schemas.ts';

export interface SiriusClient {
  call<N extends OpName>(name: N, input: OpInput<N>): Promise<OpOutput<N>>;
  /** Streams events, reconnecting on failure. Returns an unsubscribe function. */
  subscribe(handlers: EventHandlers): () => void;
}

export interface EventHandlers {
  onEvent(event: SiriusEvent): void;
  /** Called after every (re)connect, so callers can refetch what they missed. */
  onConnected?(): void;
  onDisconnected?(): void;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface HttpClientOptions {
  /** Origin of the core, for example http://127.0.0.1:7777. Empty means same origin. */
  baseUrl: string;
  token?: string;
  actor?: Actor;
  via?: Via;
  fetch?: typeof fetch;
}

interface PreparedRequest {
  method: HttpMethod;
  path: string;
  body?: string;
}

/** Fills `{param}` segments from the input; what is left becomes the query or body. */
export function prepareRequest(def: OpDefinition, input: Record<string, unknown>): PreparedRequest {
  const rest = { ...input };
  const path = def.http.path.replace(/\{(\w+)\}/g, (_, key: string) => {
    const value = rest[key];
    if (value === undefined) throw new Error(`Missing path parameter: ${key}`);
    delete rest[key];
    return encodeURIComponent(String(value));
  });
  if (def.http.method === 'get') return { method: 'get', path };
  const hasBody = Object.keys(rest).length > 0;
  return { method: def.http.method, path, ...(hasBody ? { body: JSON.stringify(rest) } : {}) };
}

export function createHttpClient(options: HttpClientOptions): SiriusClient {
  const fetchFn = options.fetch ?? globalThis.fetch.bind(globalThis);
  const headers: Record<string, string> = {};
  if (options.token) headers.authorization = `Bearer ${options.token}`;
  if (options.actor) headers['x-sirius-actor'] = options.actor;
  if (options.via) headers['x-sirius-via'] = options.via;

  return {
    async call(name, input) {
      const req = prepareRequest(ops[name] as OpDefinition, input as Record<string, unknown>);
      const res = await fetchFn(`${options.baseUrl}/v1${req.path}`, {
        method: req.method.toUpperCase(),
        headers: req.body ? { ...headers, 'content-type': 'application/json' } : headers,
        ...(req.body ? { body: req.body } : {}),
      });
      if (!res.ok) throw await toApiError(res);
      return res.json();
    },
    subscribe(handlers) {
      const controller = new AbortController();
      void pumpEvents(
        `${options.baseUrl}/v1/events`,
        headers,
        fetchFn,
        handlers,
        controller.signal,
      );
      return () => controller.abort();
    },
  };
}

async function toApiError(res: Response): Promise<ApiError> {
  const body = (await res.json().catch(() => null)) as { code?: string; message?: string } | null;
  return new ApiError(res.status, body?.code ?? 'error', body?.message ?? res.statusText);
}

const MAX_BACKOFF_MS = 30_000;

/**
 * SSE over fetch rather than EventSource, because EventSource cannot send the
 * Authorization header. Reconnects with capped backoff; a failed connection never
 * surfaces as an error, since a sleeping core is an ordinary state.
 */
async function pumpEvents(
  url: string,
  headers: Record<string, string>,
  fetchFn: typeof fetch,
  handlers: EventHandlers,
  signal: AbortSignal,
): Promise<void> {
  let backoff = 1000;
  while (!signal.aborted) {
    try {
      const res = await fetchFn(url, {
        headers: { ...headers, accept: 'text/event-stream' },
        signal,
      });
      if (!res.ok || !res.body) throw new Error(`SSE status ${res.status}`);
      backoff = 1000;
      handlers.onConnected?.();
      await readSseStream(res.body, handlers.onEvent);
    } catch {
      if (signal.aborted) return;
    }
    handlers.onDisconnected?.();
    await delay(backoff, signal);
    backoff = Math.min(backoff * 2, MAX_BACKOFF_MS);
  }
}

/** Reads `data:` frames until the stream ends. Malformed frames are skipped. */
export async function readSseStream(
  body: ReadableStream<Uint8Array>,
  onEvent: (event: SiriusEvent) => void,
): Promise<void> {
  const reader = body
    .pipeThrough(new TextDecoderStream() as unknown as TransformStream<Uint8Array, string>)
    .getReader();
  let buffer = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return;
    buffer += value;
    for (;;) {
      const end = buffer.indexOf('\n\n');
      if (end < 0) break;
      const frame = buffer.slice(0, end);
      buffer = buffer.slice(end + 2);
      const data = frame
        .split('\n')
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trimStart())
        .join('\n');
      if (!data) continue;
      try {
        onEvent(JSON.parse(data) as SiriusEvent);
      } catch {
        // A frame we cannot parse is not worth tearing down the stream for.
      }
    }
  }
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}
