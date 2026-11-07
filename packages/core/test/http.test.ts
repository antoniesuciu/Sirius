import { readSseStream, type SiriusEvent } from '@sirius/contracts';
import { describe, expect, test } from 'vitest';
import { createApp } from '../src/http/app.ts';
import { harness } from './harness.ts';

const TOKEN = 'test-token';

function setup() {
  const h = harness();
  const app = createApp(h.core, { token: TOKEN, mode: 'local', version: 't' });
  const request = (path: string, init: RequestInit = {}) =>
    app.request(`/v1${path}`, {
      ...init,
      headers: {
        authorization: `Bearer ${TOKEN}`,
        'content-type': 'application/json',
        ...init.headers,
      },
    });
  const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
    request(path, { method: 'POST', body: JSON.stringify(body), headers });
  return { h, app, request, post };
}

describe('auth', () => {
  test('health is open, everything else needs the token', async () => {
    const { app } = setup();
    expect((await app.request('/v1/health')).status).toBe(200);
    expect((await app.request('/v1/today')).status).toBe(401);
    const wrong = await app.request('/v1/today', { headers: { authorization: 'Bearer nope' } });
    expect(wrong.status).toBe(401);
  });

  test('SSE needs the token too', async () => {
    expect((await setup().app.request('/v1/events')).status).toBe(401);
  });
});

describe('generated routes', () => {
  test('create, read and path parameters round-trip', async () => {
    const { request, post } = setup();
    const task = (await (await post('/tasks', { title: 'From curl' })).json()) as { id: string };
    await post(`/tasks/${task.id}/complete`, {});
    const today = (await (await request('/today')).json()) as { tasks: { status: string }[] };
    expect(today.tasks[0]?.status).toBe('done');
  });

  test('DELETE routes work', async () => {
    const { request, post } = setup();
    const { id } = (await (await post('/tasks', { title: 'x' })).json()) as { id: string };
    expect((await request(`/tasks/${id}`, { method: 'DELETE' })).status).toBe(200);
  });

  test('every op appears in the OpenAPI document', async () => {
    const { request } = setup();
    const doc = (await (await request('/openapi.json')).json()) as {
      paths: Record<string, Record<string, { operationId: string }>>;
    };
    const ids = Object.values(doc.paths).flatMap((p) => Object.values(p).map((o) => o.operationId));
    expect(ids).toContain('add_task');
    expect(ids).toContain('confirm_proposal');
  });
});

describe('errors', () => {
  test('bad input is a 400 that says what is wrong', async () => {
    const res = await setup().post('/tasks', { title: '' });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: 'invalid_input' });
  });

  test('a missing row is a 404', async () => {
    const res = await setup().post('/tasks/nope/complete', {});
    expect(res.status).toBe(404);
  });

  test('a body cannot override a path parameter', async () => {
    const { post } = setup();
    const a = (await (await post('/tasks', { title: 'a' })).json()) as { id: string };
    const res = await post(`/tasks/${a.id}/rename`, { id: 'other', title: 'b' });
    expect(await res.json()).toMatchObject({ id: a.id, title: 'b' });
  });
});

describe('the actor header', () => {
  test('an MCP client is an agent, so the core refuses destructive calls', async () => {
    const { post } = setup();
    const res = await post(
      '/tasks/reschedule',
      { ids: ['x'], date: '2026-11-02' },
      { 'x-sirius-actor': 'claude' },
    );
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: 'requires_proposal' });
  });

  test('nobody can claim to be the scheduler', async () => {
    const { h, post } = setup();
    await post('/tasks', { title: 'x' }, { 'x-sirius-actor': 'system' });
    const change = h.events.find((e) => e.type === 'change');
    expect(change?.type === 'change' && change.actor).toBe('user');
  });
});

test('SSE streams a change as it happens', async () => {
  const { request, post } = setup();
  const res = await request('/events');
  expect(res.headers.get('content-type')).toBe('text/event-stream');
  const seen = new Promise<SiriusEvent>((resolve) => {
    void readSseStream(res.body as ReadableStream<Uint8Array>, resolve);
  });
  await post('/tasks', { title: 'live' });
  expect(await seen).toMatchObject({ type: 'change', entity: 'tasks', op: 'create', rev: 1 });
});

test('SSE follows each event with a comment, so WebKitGTK hands the event over at once', async () => {
  const { request, post } = setup();
  const res = await request('/events');
  const reader = (res.body as ReadableStream<Uint8Array>).getReader();
  const decoder = new TextDecoder();
  let text = '';
  await post('/tasks', { title: 'live' });
  // The desktop app's WebKit keeps the last chunk until another one arrives.
  while (!/data: .*\n\n:\n\n/.test(text)) {
    text += decoder.decode((await reader.read()).value, { stream: true });
  }
  await reader.cancel();
});

test('CORS allows the Tauri origin and refuses others', async () => {
  const { app } = setup();
  const preflight = (origin: string) =>
    app.request('/v1/today', { method: 'OPTIONS', headers: { origin } });
  const allowed = await preflight('tauri://localhost');
  expect(allowed.headers.get('access-control-allow-origin')).toBe('tauri://localhost');
  const other = await preflight('https://evil.example');
  expect(other.headers.get('access-control-allow-origin')).toBeNull();
});
