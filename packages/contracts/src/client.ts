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

export interface CallOptions {
  /** Makes a change safe to send again: the core applies one key once (ADR 0010). */
  idempotencyKey?: string;
}

/** A file the core has read and is keeping for a message (F36). */
export interface AttachedFile {
  id: string;
  name: string;
  chars: number;
  truncated: boolean;
  pages: number | null;
}

/** What the core made of a recording from the phone (ADR 0010). */
export interface SpokenTurn {
  /** Empty when nothing was heard; nothing else happened then. */
  transcript: string;
  /** What Whisper heard, such as "en" or "ro". */
  lang: string;
  /** A command was done at once, or an agent turn started and streams as usual. */
  route?: 'fast_path' | 'agent';
  turn_id?: string;
  intent?: string | null;
  /** The answer to a command, to be said aloud. Null for an agent turn. */
  reply: string | null;
}

/** What a browser's PushSubscription.toJSON() gives, which the core stores (F39). */
export interface PushSubscriptionData {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

export interface SiriusClient {
  /** Hands a file to the core, which reads it and keeps the text for an hour. */
  attach(file: Blob, name: string): Promise<AttachedFile>;
  /** Sends a recording to be transcribed and acted on, as push-to-talk does on the laptop. */
  speak(audio: Blob): Promise<SpokenTurn>;
  /** Browser push (F39): the laptop's public key, and where to send this phone's notifications. */
  push: {
    key(): Promise<string>;
    subscribe(subscription: PushSubscriptionData): Promise<void>;
  };
  call<N extends OpName>(name: N, input: OpInput<N>, options?: CallOptions): Promise<OpOutput<N>>;
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
  /** Extra headers on every call, such as a Cloudflare Access service token. */
  headers?: Record<string, string>;
  fetch?: typeof fetch;
  /**
   * Gives up on a call after this long. A sleeping laptop behind Tailscale drops packets rather
   * than refusing them, so without a limit a request would hang instead of failing.
   */
  timeoutMs?: number;
}

/** No reply here means the core is out of reach, not that it said no. */
export function isUnreachable(error: unknown): boolean {
  if (error instanceof ApiError) return false;
  const name = (error as { name?: string } | null)?.name;
  return error instanceof TypeError || name === 'TimeoutError' || name === 'AbortError';
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
  const headers: Record<string, string> = { ...options.headers };
  if (options.token) headers.authorization = `Bearer ${options.token}`;
  if (options.actor) headers['x-sirius-actor'] = options.actor;
  if (options.via) headers['x-sirius-via'] = options.via;

  return {
    async call(name, input, callOptions) {
      const req = prepareRequest(ops[name] as OpDefinition, input as Record<string, unknown>);
      const callHeaders: Record<string, string> = { ...headers };
      if (req.body) callHeaders['content-type'] = 'application/json';
      if (callOptions?.idempotencyKey) callHeaders['idempotency-key'] = callOptions.idempotencyKey;
      const res = await fetchFn(`${options.baseUrl}/v1${req.path}`, {
        method: req.method.toUpperCase(),
        headers: callHeaders,
        ...(req.body ? { body: req.body } : {}),
        ...(options.timeoutMs ? { signal: AbortSignal.timeout(options.timeoutMs) } : {}),
      });
      if (!res.ok) throw await toApiError(res);
      return res.json();
    },
    async attach(file, name) {
      const res = await fetchFn(`${options.baseUrl}/v1/attachments`, {
        method: 'POST',
        headers: { ...headers, 'x-filename': encodeURIComponent(name) },
        body: file,
        // A 20 MB file over a phone network takes longer than an ordinary call.
        ...(options.timeoutMs ? { signal: AbortSignal.timeout(options.timeoutMs * 8) } : {}),
      });
      if (!res.ok) throw await toApiError(res);
      return res.json();
    },
    async speak(audio) {
      const res = await fetchFn(`${options.baseUrl}/v1/voice/audio`, {
        method: 'POST',
        headers,
        body: audio,
        // Transcribing on the laptop takes a few seconds on top of the upload.
        ...(options.timeoutMs ? { signal: AbortSignal.timeout(options.timeoutMs * 4) } : {}),
      });
      if (!res.ok) throw await toApiError(res);
      return res.json();
    },
    push: {
      async key() {
        const res = await fetchFn(`${options.baseUrl}/v1/push/key`, {
          headers,
          ...(options.timeoutMs ? { signal: AbortSignal.timeout(options.timeoutMs) } : {}),
        });
        if (!res.ok) throw await toApiError(res);
        return ((await res.json()) as { key: string }).key;
      },
      async subscribe(subscription) {
        const res = await fetchFn(`${options.baseUrl}/v1/push/subscription`, {
          method: 'POST',
          headers: { ...headers, 'content-type': 'application/json' },
          body: JSON.stringify(subscription),
          ...(options.timeoutMs ? { signal: AbortSignal.timeout(options.timeoutMs) } : {}),
        });
        if (!res.ok) throw await toApiError(res);
      },
    },
    subscribe(handlers) {
      const controller = new AbortController();
      void pumpEvents(
        `${options.baseUrl}/v1/events`,
        headers,
        fetchFn,
        handlers,
        controller.signal,
        options.timeoutMs,
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
/** The core pings every 25 s, so a minute of silence means the connection is dead. */
const SILENCE_MS = 60_000;

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
  connectTimeoutMs?: number,
): Promise<void> {
  let backoff = 1000;
  while (!signal.aborted) {
    // One attempt's own abort, for a connect that hangs or a stream that goes quiet.
    const attempt = new AbortController();
    const stop = () => attempt.abort();
    signal.addEventListener('abort', stop, { once: true });
    let watchdog = connectTimeoutMs ? setTimeout(stop, connectTimeoutMs) : undefined;
    const alive = () => {
      clearTimeout(watchdog);
      watchdog = connectTimeoutMs ? setTimeout(stop, SILENCE_MS) : undefined;
    };
    try {
      const res = await fetchFn(url, {
        headers: { ...headers, accept: 'text/event-stream' },
        signal: attempt.signal,
      });
      if (!res.ok || !res.body) throw new Error(`SSE status ${res.status}`);
      backoff = 1000;
      alive();
      handlers.onConnected?.();
      await readSseStream(res.body, handlers.onEvent, alive);
    } catch {
      if (signal.aborted) return;
    } finally {
      clearTimeout(watchdog);
      signal.removeEventListener('abort', stop);
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
  /** Called on any bytes, including the core's pings, so a caller can tell a live stream. */
  onActivity?: () => void,
): Promise<void> {
  // A plain TextDecoder in stream mode, not TextDecoderStream: React Native has only this.
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return;
    onActivity?.();
    buffer += decoder.decode(value, { stream: true });
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
