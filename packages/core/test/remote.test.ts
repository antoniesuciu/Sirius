import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { createAccessVerifier } from '../src/http/access.ts';
import { createApp } from '../src/http/app.ts';
import { FanOutNotifier, NtfyNotifier } from '../src/notifier.ts';
import { harness } from './harness.ts';

const TEAM = 'team.cloudflareaccess.com';
const AUD = 'sirius-aud';

const b64 = (data: string | ArrayBuffer) => Buffer.from(data as never).toString('base64url');

async function signer() {
  const pair = await crypto.subtle.generateKey(
    {
      name: 'RSASSA-PKCS1-v1_5',
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256',
    },
    true,
    ['sign', 'verify'],
  );
  const jwk = await crypto.subtle.exportKey('jwk', pair.publicKey);
  const key = { ...jwk, kid: 'k1', alg: 'RS256', use: 'sig' };
  const sign = async (claims: Record<string, unknown>) => {
    const head = b64(JSON.stringify({ alg: 'RS256', kid: 'k1', typ: 'JWT' }));
    const body = b64(JSON.stringify(claims));
    const signature = await crypto.subtle.sign(
      'RSASSA-PKCS1-v1_5',
      pair.privateKey,
      new TextEncoder().encode(`${head}.${body}`),
    );
    return `${head}.${body}.${b64(signature)}`;
  };
  return { key, sign };
}

const good = () => ({
  iss: `https://${TEAM}`,
  aud: AUD,
  exp: Math.floor(Date.now() / 1000) + 600,
});

describe('Cloudflare Access', () => {
  const setup = async () => {
    const { key, sign } = await signer();
    let fetches = 0;
    const verify = createAccessVerifier({ teamDomain: TEAM, audience: AUD }, async () => {
      fetches += 1;
      return { keys: [key as never] };
    });
    return { sign, verify, fetches: () => fetches };
  };

  test('accepts a token signed by the team', async () => {
    const { sign, verify } = await setup();
    expect(await verify(await sign(good()))).toBe(true);
  });

  test.each([
    ['another audience', { aud: 'other' }],
    ['another issuer', { iss: 'https://evil.cloudflareaccess.com' }],
    ['an expired token', { exp: 1000 }],
  ])('refuses %s', async (_label, claims) => {
    const { sign, verify } = await setup();
    expect(await verify(await sign({ ...good(), ...claims }))).toBe(false);
  });

  test('refuses a token signed with some other key', async () => {
    const { verify } = await setup();
    const { sign: forged } = await signer();
    expect(await verify(await forged(good()))).toBe(false);
  });

  test('refuses garbage rather than throwing', async () => {
    const { verify } = await setup();
    expect(await verify('not.a.jwt')).toBe(false);
  });

  test('caches the public keys', async () => {
    const { sign, verify, fetches } = await setup();
    await verify(await sign(good()));
    await verify(await sign(good()));
    expect(fetches()).toBe(1);
  });

  test('the API accepts a verified login and still refuses everything else', async () => {
    const { sign, verify } = await setup();
    const app = createApp(harness().core, {
      token: 't',
      mode: 'remote',
      version: 'x',
      verifyAccess: verify,
    });
    const asUser = await app.request('/v1/today', {
      headers: { 'cf-access-jwt-assertion': await sign(good()) },
    });
    expect(asUser.status).toBe(200);
    const forged = await app.request('/v1/today', {
      headers: { 'cf-access-jwt-assertion': 'x.y.z' },
    });
    expect(forged.status).toBe(401);
    expect((await app.request('/v1/today')).status).toBe(401);
  });

  test('in local mode that header means nothing', async () => {
    const app = createApp(harness().core, { token: 't', mode: 'local', version: 'x' });
    const res = await app.request('/v1/today', { headers: { 'cf-access-jwt-assertion': 'a.b.c' } });
    expect(res.status).toBe(401);
  });
});

describe('serving the UI', () => {
  const dir = () => {
    const root = mkdtempSync(join(tmpdir(), 'sirius-ui-'));
    writeFileSync(join(root, 'index.html'), '<title>Sirius</title>');
    writeFileSync(join(root, 'app.js'), 'console.log(1)');
    writeFileSync(join(root, '..', 'secret.txt'), 'nope');
    return root;
  };
  const app = () =>
    createApp(harness().core, { token: 't', mode: 'remote', version: 'x', uiDir: dir() });

  test('serves files with the right type', async () => {
    const res = await app().request('/app.js');
    expect(res.headers.get('content-type')).toContain('javascript');
  });

  test('unknown paths get the app', async () => {
    expect(await (await app().request('/somewhere')).text()).toContain('Sirius');
  });

  test('cannot walk out of the folder', async () => {
    const res = await app().request('/%2e%2e/secret.txt');
    expect(await res.text()).not.toContain('nope');
  });

  test('the API is still protected', async () => {
    expect((await app().request('/v1/today')).status).toBe(401);
  });
});

describe('ntfy (ADR-9)', () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  test('posts to the topic and fans out', async () => {
    const sent: Array<[string, RequestInit | undefined]> = [];
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      sent.push([url, init]);
      return new Response('ok');
    }) as never;
    const other: string[] = [];
    const notifier = new FanOutNotifier([
      new NtfyNotifier('http://ntfy/sirius'),
      { notify: (n) => other.push(n.body) },
    ]);
    notifier.notify({ key: 'k', title: 'Sirius', body: 'Time to stretch' });
    expect(sent[0]?.[0]).toBe('http://ntfy/sirius');
    expect(sent[0]?.[1]?.body).toBe('Time to stretch');
    expect(other).toEqual(['Time to stretch']);
  });

  test('a dead server cannot break anything', () => {
    globalThis.fetch = (async () => {
      throw new Error('down');
    }) as never;
    expect(() =>
      new NtfyNotifier('http://ntfy/x').notify({ key: 'k', title: 't', body: 'b' }),
    ).not.toThrow();
  });
});

describe('phone audio', () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });
  const upload = (app: ReturnType<typeof createApp>, body: BodyInit) =>
    app.request('/v1/voice/audio', {
      method: 'POST',
      headers: { authorization: 'Bearer t' },
      body,
    });

  test('a transcript takes the same path as the laptop', async () => {
    const h = harness();
    globalThis.fetch = (async () =>
      Response.json({ text: 'add buy rice to today', lang: 'en' })) as never;
    const app = createApp(h.core, {
      token: 't',
      mode: 'remote',
      version: 'x',
      voiceUrl: 'http://voice',
    });
    const res = await upload(app, 'audio-bytes');
    expect(await res.json()).toMatchObject({
      route: 'fast_path',
      reply: 'Added Buy rice to today.',
      transcript: 'add buy rice to today',
      // The phone says the reply itself, so it needs to know in which language (F38).
      lang: 'en',
    });
    expect(h.run('get_today', {}).tasks[0]?.title).toBe('Buy rice');
  });

  test('a paired phone may send audio', async () => {
    const h = harness();
    globalThis.fetch = (async () => Response.json({ text: 'ce oră e', lang: 'ro' })) as never;
    const app = createApp(h.core, {
      token: 't',
      mode: 'local',
      version: 'x',
      voiceUrl: 'http://voice',
    });
    const pairing = await app.request('/v1/phones/pairing', {
      method: 'POST',
      headers: { authorization: 'Bearer t' },
    });
    const { code } = (await pairing.json()) as { code: string };
    const paired = await app.request('/v1/pair', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code, name: 'Phone' }),
    });
    const { token } = (await paired.json()) as { token: string };
    const res = await app.request('/v1/voice/audio', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
      body: 'audio-bytes',
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ route: 'fast_path', lang: 'ro' });
  });

  test('no voice service says so', async () => {
    const app = createApp(harness().core, { token: 't', mode: 'remote', version: 'x' });
    expect((await upload(app, 'x')).status).toBe(503);
  });

  test('needs auth', async () => {
    const app = createApp(harness().core, { token: 't', mode: 'remote', version: 'x' });
    expect((await app.request('/v1/voice/audio', { method: 'POST' })).status).toBe(401);
  });
});
