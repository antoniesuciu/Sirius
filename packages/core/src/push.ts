/**
 * Browser push to the phone app (F39). The laptop encrypts each notification for the phone
 * (RFC 8291) and signs the request with its own key (VAPID, RFC 8292), so the push service in
 * between, Google's for Chrome, sees neither the text nor anything that identifies the person.
 *
 * Only WebCrypto, so there is no dependency to trust with the keys. Subscriptions live outside
 * the domain tables, like phone tokens: never in the change log, a backup's history or an agent's
 * view.
 */
import { generateKeyPairSync } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Notification, Notifier } from './notifier.ts';
import type { SqliteHandle } from './runtime/sqlite.ts';

/** The laptop's push identity: a P-256 key pair as a JWK, private part included. */
export interface VapidKey {
  kty: 'EC';
  crv: 'P-256';
  x: string;
  y: string;
  d: string;
}

export interface PushSubscriptionInput {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

/** What the phone shows, and which tab a tap opens. */
export interface PushMessage {
  title: string;
  body: string;
  tag: string;
  tab: 'today' | 'sirius' | 'plan' | 'list';
}

const RECORD_SIZE = 4096;
/** Push services accept 4096 bytes of body; the header and tag take 103 of them. */
const MAX_PLAINTEXT = 3800;
const TTL_SECONDS = 60 * 60;
/** RFC 8292 asks for a contact. A project page, so no personal address leaves the laptop. */
export const VAPID_SUBJECT = 'https://github.com/antoniesuciu/Sirius';

const encoder = new TextEncoder();
const b64u = (bytes: ArrayBuffer | Uint8Array) =>
  Buffer.from(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)).toString('base64url');
const fromB64u = (text: string) => new Uint8Array(Buffer.from(text, 'base64url'));

function concat(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

async function hkdf(salt: BufferSource, ikm: BufferSource, info: BufferSource, bytes: number) {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt, info },
    key,
    bytes * 8,
  );
  return new Uint8Array(bits);
}

/** The uncompressed point 0x04 || x || y, which is what browsers hand out as p256dh. */
export function rawPublicKey(jwk: { x: string; y: string }): Uint8Array<ArrayBuffer> {
  return concat(new Uint8Array([4]), fromB64u(jwk.x), fromB64u(jwk.y));
}

function jwkFromRaw(raw: Uint8Array, d?: string): JsonWebKey {
  return {
    kty: 'EC',
    crv: 'P-256',
    x: b64u(raw.slice(1, 33)),
    y: b64u(raw.slice(33, 65)),
    ...(d ? { d } : {}),
  };
}

export interface SenderKeys {
  publicRaw: Uint8Array<ArrayBuffer>;
  privateKey: CryptoKey;
}

/** A fresh key pair per message, as RFC 8291 requires. Tests pass the RFC's own. */
async function ephemeralKeys(): Promise<SenderKeys> {
  const pair = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, [
    'deriveBits',
  ])) as CryptoKeyPair;
  const publicRaw = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
  return { publicRaw, privateKey: pair.privateKey };
}

export async function senderKeysFrom(publicRaw: string, privateD: string): Promise<SenderKeys> {
  const raw = fromB64u(publicRaw);
  const privateKey = await crypto.subtle.importKey(
    'jwk',
    jwkFromRaw(raw, privateD),
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    ['deriveBits'],
  );
  return { publicRaw: raw, privateKey };
}

/** RFC 8291 section 3 with the aes128gcm content coding of RFC 8188, as one record. */
export async function encryptPayload(
  plaintext: Uint8Array<ArrayBuffer>,
  subscriber: { p256dh: string; auth: string },
  fixed: { salt?: Uint8Array<ArrayBuffer>; sender?: SenderKeys } = {},
): Promise<Uint8Array<ArrayBuffer>> {
  const uaPublic = fromB64u(subscriber.p256dh);
  const authSecret = fromB64u(subscriber.auth);
  const salt = fixed.salt ?? crypto.getRandomValues(new Uint8Array(16));
  const sender = fixed.sender ?? (await ephemeralKeys());

  const uaKey = await crypto.subtle.importKey(
    'raw',
    uaPublic,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    [],
  );
  const ecdhSecret = new Uint8Array(
    await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, sender.privateKey, 256),
  );
  const keyInfo = concat(encoder.encode('WebPush: info\0'), uaPublic, sender.publicRaw);
  const ikm = await hkdf(authSecret, ecdhSecret, keyInfo, 32);
  const cek = await hkdf(salt, ikm, encoder.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, encoder.encode('Content-Encoding: nonce\0'), 12);

  // 0x02 marks the last (and only) record; no further padding.
  const padded = concat(plaintext, new Uint8Array([2]));
  const aes = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, aes, padded),
  );
  const header = new Uint8Array(21);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, RECORD_SIZE);
  header[20] = sender.publicRaw.length;
  return concat(header, sender.publicRaw, ciphertext);
}

/** RFC 8292: a short-lived ES256 token for the push service's origin, and the public key. */
export async function vapidAuthorization(
  endpoint: string,
  key: VapidKey,
  now: number,
): Promise<string> {
  const header = b64u(encoder.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = b64u(
    encoder.encode(
      JSON.stringify({
        aud: new URL(endpoint).origin,
        exp: Math.floor(now / 1000) + 12 * 60 * 60,
        sub: VAPID_SUBJECT,
      }),
    ),
  );
  const signer = await crypto.subtle.importKey(
    'jwk',
    { kty: 'EC', crv: 'P-256', x: key.x, y: key.y, d: key.d },
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  );
  // WebCrypto signs in the r || s form that JWS uses, so no DER conversion is needed.
  const signature = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    signer,
    encoder.encode(`${header}.${claims}`),
  );
  return `vapid t=${header}.${claims}.${b64u(signature)}, k=${b64u(rawPublicKey(key))}`;
}

export function throwawayVapidKey(): VapidKey {
  const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const jwk = privateKey.export({ format: 'jwk' }) as VapidKey;
  return { kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y, d: jwk.d };
}

/** Kept in the data folder, because a new key would leave every phone's subscription dead. */
export function loadOrCreateVapidKey(path: string): VapidKey {
  if (existsSync(path)) return JSON.parse(readFileSync(path, 'utf8')) as VapidKey;
  const key = throwawayVapidKey();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(key)}\n`, { mode: 0o600 });
  chmodSync(path, 0o600);
  return key;
}

const ENDPOINT = /^https:\/\/[^\s]+$/;
const KEY_PART = /^[A-Za-z0-9_-]+$/;

export class Push {
  constructor(
    private readonly sqlite: SqliteHandle,
    private readonly key: VapidKey,
    private readonly fetchFn: typeof fetch = globalThis.fetch.bind(globalThis),
    private readonly clock: () => number = Date.now,
  ) {
    sqlite.exec(
      'CREATE TABLE IF NOT EXISTS push_subscriptions (endpoint TEXT PRIMARY KEY, p256dh TEXT NOT NULL, auth TEXT NOT NULL, created_at INTEGER)',
    );
  }

  /** What the phone passes to pushManager.subscribe as applicationServerKey. */
  publicKey(): string {
    return b64u(rawPublicKey(this.key));
  }

  /** False for anything that is not a real https endpoint with well-formed keys. */
  subscribe({ endpoint, keys }: PushSubscriptionInput): boolean {
    const valid =
      ENDPOINT.test(endpoint) &&
      endpoint.length <= 1000 &&
      KEY_PART.test(keys?.p256dh ?? '') &&
      KEY_PART.test(keys?.auth ?? '') &&
      fromB64u(keys.p256dh).length === 65 &&
      fromB64u(keys.auth).length === 16;
    if (!valid) return false;
    this.sqlite.run(
      'INSERT OR REPLACE INTO push_subscriptions VALUES (?, ?, ?, ?)',
      endpoint,
      keys.p256dh,
      keys.auth,
      this.clock(),
    );
    return true;
  }

  unsubscribe(endpoint: string): void {
    this.sqlite.run('DELETE FROM push_subscriptions WHERE endpoint = ?', endpoint);
  }

  /** Forgetting the phones forgets where they get notifications too. */
  forgetAll(): void {
    this.sqlite.exec('DELETE FROM push_subscriptions');
  }

  count(): number {
    const [row] = this.sqlite.all<{ n: number }>('SELECT count(*) AS n FROM push_subscriptions');
    return row?.n ?? 0;
  }

  async send(message: PushMessage): Promise<void> {
    const subscriptions = this.sqlite.all<{ endpoint: string; p256dh: string; auth: string }>(
      'SELECT endpoint, p256dh, auth FROM push_subscriptions',
    );
    let json = JSON.stringify(message);
    if (encoder.encode(json).length > MAX_PLAINTEXT) {
      json = JSON.stringify({ ...message, body: `${message.body.slice(0, 1000)}…` });
    }
    const plaintext = encoder.encode(json);
    await Promise.all(
      subscriptions.map(async (sub) => {
        try {
          const response = await this.fetchFn(sub.endpoint, {
            method: 'POST',
            headers: {
              authorization: await vapidAuthorization(sub.endpoint, this.key, this.clock()),
              'content-encoding': 'aes128gcm',
              'content-type': 'application/octet-stream',
              ttl: String(TTL_SECONDS),
              urgency: 'high',
            },
            body: await encryptPayload(plaintext, sub),
            signal: AbortSignal.timeout(10_000),
          });
          // Gone or unknown: the phone unsubscribed or the app was uninstalled.
          if (response.status === 404 || response.status === 410) this.unsubscribe(sub.endpoint);
          else if (!response.ok) console.warn(`push failed: ${response.status}`);
        } catch (error) {
          console.warn(`push failed: ${String(error)}`);
        }
      }),
    );
  }
}

/** Which tab a tap on the notification opens. */
export function tabFor(key: string): PushMessage['tab'] {
  if (key.startsWith('schedule:')) return 'today';
  if (key.startsWith('reminder:')) return 'list';
  return 'sirius';
}

export class WebPushNotifier implements Notifier {
  constructor(private readonly push: Push) {}

  notify({ key, title, body }: Notification): void {
    if (this.push.count() === 0) return;
    void this.push.send({ title, body, tag: key, tab: tabFor(key) });
  }
}
