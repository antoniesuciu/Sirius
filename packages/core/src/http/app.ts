/** REST and SSE, generated from the op registry so routes cannot drift from the ops. */
import { timingSafeEqual } from 'node:crypto';
import { OpenAPIHono } from '@hono/zod-openapi';
import {
  Actor,
  type OpDefinition,
  type OpName,
  opNames,
  ops,
  type SiriusEvent,
  Via,
} from '@sirius/contracts';
import { cors } from 'hono/cors';
import { ZodError } from 'zod';
import type { Core } from '../core.ts';
import type { DesktopLink } from '../desktopLink.ts';
import type { Caller } from '../dispatcher.ts';
import { DomainError } from '../errors.ts';
import { serveUi } from './static.ts';

export interface AppOptions {
  /** Set on a local core, which stops when the desktop app goes (ADR 0009). */
  desktopLink?: DesktopLink;
  token: string;
  mode: 'local' | 'remote';
  version: string;
  /** Accepts Cloudflare Access logins as well as the bearer token. */
  verifyAccess?: (jwt: string) => Promise<boolean>;
  uiDir?: string;
  voiceUrl?: string;
}

const MAX_AUDIO_BYTES = 10 * 1024 * 1024;
const TRANSCRIBE_TIMEOUT_MS = 30_000;

const HEARTBEAT_MS = 25_000;
const UI_ORIGINS = ['tauri://localhost', 'http://tauri.localhost', 'http://localhost:5173'];

function tokensMatch(given: string, expected: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Who is calling. A missing header means the UI. `system` can never be claimed from outside. */
function callerFrom(headers: Headers): Caller {
  const actor = Actor.exclude(['system']).catch('user').parse(headers.get('x-sirius-actor'));
  const via = Via.exclude(['system']).catch('ui').parse(headers.get('x-sirius-via'));
  return { actor, via };
}

function pathParams(path: string): string[] {
  return [...path.matchAll(/\{(\w+)\}/g)].map((m) => m[1] as string);
}

function eventStream(core: Core, attach: () => () => void): Response {
  const encoder = new TextEncoder();
  let stop = () => {};
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const write = (text: string) => controller.enqueue(encoder.encode(text));
      write(': connected\n\n');
      const unsubscribe = core.bus.subscribe((event: SiriusEvent) =>
        write(`data: ${JSON.stringify(event)}\n\n`),
      );
      const heartbeat = setInterval(() => write(': ping\n\n'), HEARTBEAT_MS);
      const detach = attach();
      stop = () => {
        unsubscribe();
        clearInterval(heartbeat);
        detach();
      };
    },
    cancel: () => stop(),
  });
  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      'x-accel-buffering': 'no',
    },
  });
}

function register(app: OpenAPIHono, core: Core, name: OpName): void {
  const def = ops[name] as OpDefinition;
  const { method, path } = def.http;
  const params = pathParams(path);
  const paramMask = Object.fromEntries(params.map((p) => [p, true as const])) as never;
  const hasBody = method === 'post' && Object.keys(def.input.shape).length > params.length;

  // Documentation only: the dispatcher does the one and only validation.
  app.openAPIRegistry.registerPath({
    method,
    path: `/v1${path}`,
    operationId: name,
    summary: def.summary,
    request: {
      ...(params.length > 0 ? { params: def.input.pick(paramMask) } : {}),
      ...(hasBody
        ? { body: { content: { 'application/json': { schema: def.input.omit(paramMask) } } } }
        : {}),
    },
    responses: {
      200: { description: 'OK', content: { 'application/json': { schema: def.output } } },
    },
  });

  app.on(method.toUpperCase(), `/v1${path.replace(/\{(\w+)\}/g, ':$1')}`, async (c) => {
    const body = method === 'get' ? {} : await c.req.json().catch(() => ({}));
    const input = { ...(body as object), ...c.req.param() };
    return c.json(core.dispatcher.run(name, input, callerFrom(c.req.raw.headers)) as object);
  });
}

export function createApp(core: Core, options: AppOptions): OpenAPIHono {
  const app = new OpenAPIHono();

  app.use(
    '*',
    cors({
      origin: UI_ORIGINS,
      allowHeaders: ['authorization', 'content-type', 'x-sirius-client'],
    }),
  );

  app.get('/v1/health', (c) => c.json({ ok: true, version: options.version, mode: options.mode }));

  app.use('/v1/*', async (c, next) => {
    const header = c.req.header('authorization') ?? '';
    const given = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (tokensMatch(given, options.token)) return next();
    const jwt = c.req.header('cf-access-jwt-assertion');
    if (jwt && (await options.verifyAccess?.(jwt))) return next();
    return c.json({ code: 'unauthorized', message: 'Missing or invalid token' }, 401);
  });

  app.get('/v1/events', (c) => {
    const client = c.req.header('x-sirius-client');
    if (client === 'voice-service') return eventStream(core, () => core.voice.attach());
    const { desktopLink } = options;
    if (client === 'desktop' && desktopLink) return eventStream(core, () => desktopLink.attach());
    return eventStream(core, () => () => {});
  });

  for (const name of opNames) register(app, core, name);

  // Phone push-to-talk (ADR-10): the browser records, the voice service transcribes.
  app.post('/v1/voice/audio', async (c) => {
    if (!options.voiceUrl) {
      throw new DomainError(503, 'voice_unavailable', "Voice isn't running right now.");
    }
    const audio = await c.req.arrayBuffer();
    if (audio.byteLength === 0 || audio.byteLength > MAX_AUDIO_BYTES) {
      throw new DomainError(400, 'invalid_audio', 'That recording could not be used.');
    }
    const response = await fetch(`${options.voiceUrl}/transcribe`, {
      method: 'POST',
      body: audio,
      signal: AbortSignal.timeout(TRANSCRIBE_TIMEOUT_MS),
    }).catch(() => null);
    if (!response?.ok) {
      throw new DomainError(503, 'voice_unavailable', "Voice isn't running right now.");
    }
    const { text, lang } = (await response.json()) as { text: string; lang: string };
    if (!text) return c.json({ transcript: '', reply: null });
    const result = core.dispatcher.run(
      'voice_utterance',
      { transcript: text, lang },
      { actor: 'user', via: 'voice' },
    );
    return c.json({ ...result, transcript: text });
  });

  app.doc31('/v1/openapi.json', {
    openapi: '3.1.0',
    info: { title: 'Sirius core', version: options.version },
  });

  if (options.uiDir) serveUi(app, options.uiDir);

  app.onError((error, c) => {
    if (error instanceof DomainError) {
      return c.json({ code: error.code, message: error.message }, error.status);
    }
    if (error instanceof ZodError) {
      const message = error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
      return c.json({ code: 'invalid_input', message }, 400);
    }
    console.error(error);
    return c.json({ code: 'internal', message: 'Something went wrong inside Sirius.' }, 500);
  });

  return app;
}
