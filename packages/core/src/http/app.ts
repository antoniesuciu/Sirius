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
import { toIcs } from '../calendar.ts';
import type { Core } from '../core.ts';
import type { DesktopLink } from '../desktopLink.ts';
import type { Caller } from '../dispatcher.ts';
import { DomainError } from '../errors.ts';
import { Replays } from './replays.ts';
import { serveUi } from './static.ts';

export interface AppOptions {
  /** The secret in the calendar feed's address (F37). Without it there is no feed. */
  calendarToken?: string;
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
const LAPTOP_ONLY = new Set(['/v1/phones/pairing', '/v1/phones/forget']);
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
      allowHeaders: [
        'authorization',
        'content-type',
        'x-sirius-client',
        'idempotency-key',
        'x-filename',
      ],
    }),
  );

  app.get('/v1/health', (c) => c.json({ ok: true, version: options.version, mode: options.mode }));

  // F37: calendar apps cannot send a bearer token, so the feed's secret is in its address.
  app.get('/calendar/:file', (c) => {
    const given = c.req.param('file').replace(/\.ics$/, '');
    if (!options.calendarToken || !tokensMatch(given, options.calendarToken)) return c.notFound();
    const events = core.dispatcher.run('list_schedule', {}, { actor: 'system', via: 'system' });
    return c.body(toIcs(events, core.timeZone), 200, {
      'content-type': 'text/calendar; charset=utf-8',
    });
  });

  // The one route a phone can call before it has a token (ADR 0010).
  app.post('/v1/pair', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { code?: unknown; name?: unknown };
    const name = typeof body.name === 'string' ? body.name : 'Phone';
    const token = typeof body.code === 'string' ? core.phones.pair(body.code, name) : null;
    if (!token) {
      return c.json(
        {
          code: 'pairing_failed',
          message: 'That code did not work. Ask the laptop for a new one.',
        },
        403,
      );
    }
    return c.json({ token });
  });

  app.use('/v1/*', async (c, next) => {
    if (c.req.path === '/v1/pair') return next();
    const header = c.req.header('authorization') ?? '';
    const given = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (tokensMatch(given, options.token)) return next();
    if (core.phones.verify(given)) {
      // A phone uses Sirius but does not hand out access. That stays with the laptop.
      if (LAPTOP_ONLY.has(c.req.path)) {
        return c.json({ code: 'forbidden', message: 'Do that from the laptop.' }, 403);
      }
      return next();
    }
    const jwt = c.req.header('cf-access-jwt-assertion');
    if (jwt && (await options.verifyAccess?.(jwt))) return next();
    return c.json({ code: 'unauthorized', message: 'Missing or invalid token' }, 401);
  });

  // After the login check, so an earlier answer is only ever given to someone allowed it.
  const replays = new Replays(core.sqlite, () => core.store.now());
  app.use('/v1/*', async (c, next) => {
    const key = c.req.header('idempotency-key');
    if (!key || c.req.method === 'GET' || key.length > 100) return next();
    const seen = replays.find(key);
    if (seen) {
      return new Response(seen.body, {
        status: seen.status,
        headers: { 'content-type': 'application/json' },
      });
    }
    await next();
    // A failure inside the core may succeed on the next try, so only answers are kept.
    if (c.res.status < 500) replays.remember(key, c.res.status, await c.res.clone().text());
  });

  app.get('/v1/events', (c) => {
    const client = c.req.header('x-sirius-client');
    if (client === 'voice-service') return eventStream(core, () => core.voice.attach());
    const { desktopLink } = options;
    if (client === 'desktop' && desktopLink) return eventStream(core, () => desktopLink.attach());
    return eventStream(core, () => () => {});
  });

  for (const name of opNames) register(app, core, name);

  // F36: the raw file in the body, its name in a header, so nothing needs multipart parsing.
  app.post('/v1/attachments', async (c) => {
    const name = decodeURIComponent(c.req.header('x-filename') ?? 'file');
    const bytes = new Uint8Array(await c.req.arrayBuffer());
    return c.json(await core.attachments.put(name, bytes));
  });

  // Phone push-to-talk (ADR-10): the browser records, the voice service transcribes.
  app.post('/v1/voice/audio', async (c) => {
    if (!options.voiceUrl) {
      console.warn('phone audio refused: SIRIUS_VOICE_URL is not set');
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
    }).catch((error: unknown) => {
      console.warn(`phone audio: the voice service did not answer: ${String(error)}`);
      return null;
    });
    // The voice service answers 422 when it cannot decode the recording.
    if (response?.status === 422) {
      console.warn('phone audio: the voice service could not decode the recording');
      throw new DomainError(400, 'invalid_audio', 'That recording could not be used.');
    }
    if (!response?.ok) {
      if (response) console.warn(`phone audio: the voice service answered ${response.status}`);
      throw new DomainError(503, 'voice_unavailable', "Voice isn't running right now.");
    }
    const { text, lang } = (await response.json()) as { text: string; lang: string };
    if (!text) return c.json({ transcript: '', lang, reply: null });
    const result = core.dispatcher.run(
      'voice_utterance',
      { transcript: text, lang },
      { actor: 'user', via: 'voice' },
    );
    return c.json({ ...result, transcript: text, lang });
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
