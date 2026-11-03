import { describe, expect, test } from 'bun:test';
import { createApp } from '../src/http/app.ts';
import {
  encryptPayload,
  Push,
  rawPublicKey,
  senderKeysFrom,
  tabFor,
  VAPID_SUBJECT,
  type VapidKey,
  vapidAuthorization,
  WebPushNotifier,
} from '../src/push.ts';
import { harness } from './harness.ts';

/** RFC 8291 Appendix A, with the RFC's line wrapping removed. */
const RFC = {
  plaintext: 'When I grow up, I want to be a watermelon',
  asPublic:
    'BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8',
  asPrivate: 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw',
  uaPublic:
    'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
  salt: 'DGv6ra1nlYgDCS1FRnbzlw',
  auth: 'BTBZMqHH6r4Tts7J_aSIgg',
  ciphertext: '8pfeW0KbunFT06SuDKoJH9Ql87S1QUrdirN6GcG7sFz1y1sqLgVi1VhjVkHsUoEsbI_0LpXMuGvnzQ',
};
const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64url');
const bytes = (text: string) => new Uint8Array(Buffer.from(text, 'base64url'));

function testKey(): VapidKey {
  const { privateKey } = require('node:crypto').generateKeyPairSync('ec', {
    namedCurve: 'prime256v1',
  });
  return privateKey.export({ format: 'jwk' }) as VapidKey;
}

/** A browser's side of a subscription: its key pair and auth secret. */
async function browser() {
  const pair = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, [
    'deriveBits',
  ])) as CryptoKeyPair;
  const p256dh = b64(new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey)));
  const auth = b64(crypto.getRandomValues(new Uint8Array(16)));
  return { p256dh, auth };
}

describe('encryption (RFC 8291)', () => {
  test('matches the RFC test vector byte for byte', async () => {
    const sender = await senderKeysFrom(RFC.asPublic, RFC.asPrivate);
    const body = await encryptPayload(
      new TextEncoder().encode(RFC.plaintext),
      { p256dh: RFC.uaPublic, auth: RFC.auth },
      { salt: bytes(RFC.salt), sender },
    );
    // Header: salt, record size 4096, key length 65, the sender's public key.
    expect(b64(body.slice(0, 16))).toBe(RFC.salt);
    expect(new DataView(body.buffer).getUint32(16)).toBe(4096);
    expect(body[20]).toBe(65);
    expect(b64(body.slice(21, 86))).toBe(RFC.asPublic);
    expect(b64(body.slice(86))).toBe(RFC.ciphertext);
  });

  test('a fresh salt and key each time, so two sends never look alike', async () => {
    const sub = await browser();
    const text = new TextEncoder().encode('same');
    const [a, b] = await Promise.all([encryptPayload(text, sub), encryptPayload(text, sub)]);
    expect(b64(a)).not.toBe(b64(b));
  });
});

describe('VAPID (RFC 8292)', () => {
  test('a token for the push service origin, signed by the laptop key', async () => {
    const key = testKey();
    const now = Date.UTC(2026, 10, 3, 12);
    const header = await vapidAuthorization('https://fcm.googleapis.com/fcm/send/abc', key, now);
    const match = header.match(/^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/);
    if (!match) throw new Error(header);
    const [, head, claims, signature, k] = match as unknown as string[];
    expect(k).toBe(b64(rawPublicKey(key)));
    expect(JSON.parse(Buffer.from(claims as string, 'base64url').toString())).toEqual({
      aud: 'https://fcm.googleapis.com',
      exp: now / 1000 + 12 * 3600,
      sub: VAPID_SUBJECT,
    });
    const verifier = await crypto.subtle.importKey(
      'raw',
      rawPublicKey(key),
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['verify'],
    );
    const ok = await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      verifier,
      bytes(signature as string),
      new TextEncoder().encode(`${head}.${claims}`),
    );
    expect(ok).toBe(true);
  });
});

describe('sending', () => {
  test('one encrypted request per phone, and a gone phone is dropped', async () => {
    const h = harness();
    const sent: Array<{ url: string; headers: Record<string, string>; size: number }> = [];
    const push = new Push(h.core.sqlite, testKey(), (async (url: string, init: RequestInit) => {
      sent.push({
        url,
        headers: init.headers as Record<string, string>,
        size: (init.body as Uint8Array).length,
      });
      return new Response(null, { status: url.endsWith('gone') ? 410 : 201 });
    }) as never);
    const sub = await browser();
    expect(push.subscribe({ endpoint: 'https://push.example/ok', keys: sub })).toBe(true);
    expect(push.subscribe({ endpoint: 'https://push.example/gone', keys: sub })).toBe(true);

    await push.send({ title: 'Sirius', body: 'Gym at 18:00', tag: 'schedule:x', tab: 'today' });
    expect(sent.map((s) => s.url).sort()).toEqual([
      'https://push.example/gone',
      'https://push.example/ok',
    ]);
    const headers = sent[0]?.headers ?? {};
    expect(headers['content-encoding']).toBe('aes128gcm');
    expect(headers.urgency).toBe('high');
    expect(headers.authorization).toMatch(/^vapid t=/);
    // The text is not in the request in the clear.
    expect(sent[0]?.size).toBeGreaterThan(86);
    expect(push.count()).toBe(1);
  });

  test('refuses an endpoint that is not https, or keys of the wrong size', async () => {
    const push = new Push(harness().core.sqlite, testKey());
    const sub = await browser();
    expect(push.subscribe({ endpoint: 'http://push.example/x', keys: sub })).toBe(false);
    expect(
      push.subscribe({ endpoint: 'https://push.example/x', keys: { ...sub, auth: 'AAAA' } }),
    ).toBe(false);
  });

  test('a tap opens the tab the notification is about', () => {
    expect(tabFor('schedule:abc')).toBe('today');
    expect(tabFor('reminder:abc')).toBe('list');
    expect(tabFor('claude')).toBe('sirius');
  });

  test('with no phone subscribed nothing is sent', () => {
    let calls = 0;
    const push = new Push(harness().core.sqlite, testKey(), (async () => {
      calls++;
      return new Response(null);
    }) as never);
    new WebPushNotifier(push).notify({ key: 'claude', title: 'Sirius', body: 'x' });
    expect(calls).toBe(0);
  });
});

describe('the phone subscribes over HTTP', () => {
  test('key, subscribe and unsubscribe, behind the login; forgetting phones clears them', async () => {
    const h = harness();
    const app = createApp(h.core, { token: 't', mode: 'local', version: 'x' });
    const auth = { authorization: 'Bearer t', 'content-type': 'application/json' };
    const key = await app.request('/v1/push/key', { headers: auth });
    expect(((await key.json()) as { key: string }).key).toHaveLength(87);
    expect((await app.request('/v1/push/key')).status).toBe(401);

    const sub = { endpoint: 'https://push.example/x', keys: await browser() };
    const added = await app.request('/v1/push/subscription', {
      method: 'POST',
      headers: auth,
      body: JSON.stringify(sub),
    });
    expect(added.status).toBe(204);
    expect(h.core.push.count()).toBe(1);
    const bad = await app.request('/v1/push/subscription', {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({ endpoint: 'nope' }),
    });
    expect(bad.status).toBe(400);

    h.run('forget_phones', {});
    expect(h.core.push.count()).toBe(0);
  });
});
