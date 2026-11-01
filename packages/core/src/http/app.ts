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
import type { Caller } from '../dispatcher.ts';
import { DomainError } from '../errors.ts';

export interface AppOptions {
  token: string;
  mode: 'local' | 'remote';
  version: string;
}

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

function eventStream(core: Core): Response {
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
      stop = () => {
        unsubscribe();
        clearInterval(heartbeat);
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

  app.use('*', cors({ origin: UI_ORIGINS, allowHeaders: ['authorization', 'content-type'] }));

  app.get('/v1/health', (c) => c.json({ ok: true, version: options.version, mode: options.mode }));

  app.use('/v1/*', async (c, next) => {
    const header = c.req.header('authorization') ?? '';
    const given = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (!tokensMatch(given, options.token)) {
      return c.json({ code: 'unauthorized', message: 'Missing or invalid token' }, 401);
    }
    return next();
  });

  app.get('/v1/events', () => eventStream(core));

  for (const name of opNames) register(app, core, name);

  app.doc31('/v1/openapi.json', {
    openapi: '3.1.0',
    info: { title: 'Sirius core', version: options.version },
  });

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
