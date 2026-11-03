import { describe, expect, test } from 'vitest';
import { createApp } from '../src/http/app.ts';
import { harness } from './harness.ts';

const TOKEN = 'laptop-token';

function setup() {
  const h = harness();
  const app = createApp(h.core, { token: TOKEN, mode: 'local', version: 't' });
  const call = (path: string, init: RequestInit & { token?: string } = {}) => {
    const { token, ...rest } = init;
    const headers = new Headers(rest.headers);
    if (token) headers.set('authorization', `Bearer ${token}`);
    if (rest.body) headers.set('content-type', 'application/json');
    return app.request(`/v1${path}`, { ...rest, headers });
  };
  const startPairing = async () =>
    (await (await call('/phones/pairing', { method: 'POST', token: TOKEN })).json()) as {
      code: string;
    };
  const pair = (code: string) =>
    call('/pair', { method: 'POST', body: JSON.stringify({ code, name: 'Pixel' }) });
  return { h, call, startPairing, pair };
}

describe('pairing a phone (ADR 0010)', () => {
  test('the code from the laptop gives the phone a token that works', async () => {
    const { call, startPairing, pair } = setup();
    const { code } = await startPairing();
    expect(code).toMatch(/^\d{6}$/);
    const response = await pair(code);
    expect(response.status).toBe(200);
    const { token } = (await response.json()) as { token: string };
    expect((await call('/today', { token })).status).toBe(200);
  });

  test('a code works once', async () => {
    const { startPairing, pair } = setup();
    const { code } = await startPairing();
    await pair(code);
    expect((await pair(code)).status).toBe(403);
  });

  test('five wrong guesses use the code up', async () => {
    const { startPairing, pair } = setup();
    const { code } = await startPairing();
    const wrong = code === '000000' ? '111111' : '000000';
    for (let i = 0; i < 5; i++) expect((await pair(wrong)).status).toBe(403);
    expect((await pair(code)).status).toBe(403);
  });

  test('a code expires after five minutes', async () => {
    const { h, startPairing, pair } = setup();
    const { code } = await startPairing();
    h.advance(5 * 60 * 1000 + 1);
    expect((await pair(code)).status).toBe(403);
  });

  test('junk is a wrong guess, not a crash', async () => {
    const { startPairing, pair } = setup();
    await startPairing();
    for (const junk of ['', '12', 'ăăăăăă', '1234567']) expect((await pair(junk)).status).toBe(403);
  });

  test('without a code in progress nothing pairs', async () => {
    const { pair } = setup();
    expect((await pair('123456')).status).toBe(403);
  });

  test('only the laptop can start pairing, not an already paired phone', async () => {
    const { call, startPairing, pair } = setup();
    const { code } = await startPairing();
    const { token } = (await (await pair(code)).json()) as { token: string };
    const response = await call('/phones/pairing', { method: 'POST', token });
    expect(response.status).toBe(403);
  });

  test('forgetting phones signs them out', async () => {
    const { call, startPairing, pair } = setup();
    const { code } = await startPairing();
    const { token } = (await (await pair(code)).json()) as { token: string };
    await call('/phones/forget', { method: 'POST', token: TOKEN });
    expect((await call('/today', { token })).status).toBe(401);
  });

  test('a made-up token is refused', async () => {
    const { call } = setup();
    expect((await call('/today', { token: 'not-a-phone' })).status).toBe(401);
  });
});

describe('changes sent again after a lost answer (ADR 0010)', () => {
  const add = (call: ReturnType<typeof setup>['call'], key: string, title = 'Water the basil') =>
    call('/tasks', {
      method: 'POST',
      token: TOKEN,
      headers: { 'idempotency-key': key },
      body: JSON.stringify({ title }),
    });

  test('the same key applies once and answers the same both times', async () => {
    const { h, call } = setup();
    const first = await (await add(call, 'k1')).json();
    const second = await (await add(call, 'k1')).json();
    expect(second).toEqual(first);
    expect(h.run('get_today', {}).tasks.filter((t) => t.title === 'Water the basil')).toHaveLength(
      1,
    );
  });

  test('different keys are different changes', async () => {
    const { h, call } = setup();
    await add(call, 'k1');
    await add(call, 'k2');
    expect(h.run('get_today', {}).tasks.filter((t) => t.title === 'Water the basil')).toHaveLength(
      2,
    );
  });

  test('a refused change is answered the same way again, not retried', async () => {
    const { call } = setup();
    const send = () =>
      call('/tasks/nope/complete', {
        method: 'POST',
        token: TOKEN,
        headers: { 'idempotency-key': 'k3' },
      });
    const first = await send();
    expect(first.status).toBe(404);
    expect((await send()).status).toBe(404);
  });

  test('an earlier answer is never given without a login', async () => {
    const { call } = setup();
    await add(call, 'k4');
    const response = await call('/tasks', {
      method: 'POST',
      headers: { 'idempotency-key': 'k4' },
      body: JSON.stringify({ title: 'x' }),
    });
    expect(response.status).toBe(401);
  });
});
