/**
 * The service worker's push handling (F39), run against a fake worker scope. Headless Chromium
 * cannot show notifications (it reports the permission as denied whatever is granted), so the
 * real browser part is checked on the phone.
 */
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

type Handler = (event: Record<string, unknown>) => void;

function loadWorker(windows: Array<{ postMessage(m: unknown): void; focus(): Promise<void> }>) {
  const handlers = new Map<string, Handler>();
  const shown: Array<{ title: string; options: Record<string, unknown> }> = [];
  const opened: string[] = [];
  const self = {
    addEventListener: (type: string, handler: Handler) => handlers.set(type, handler),
    registration: {
      showNotification: async (title: string, options: Record<string, unknown>) => {
        shown.push({ title, options });
      },
    },
    clients: {
      matchAll: async () => windows,
      openWindow: async (url: string) => {
        opened.push(url);
      },
      claim: async () => {},
    },
    skipWaiting: async () => {},
  };
  const source = readFileSync(join(import.meta.dir, '../../public/sw.js'), 'utf8');
  new Function('self', 'caches', 'location', source)(self, {}, { origin: 'https://phone' });
  const fire = async (type: string, event: Record<string, unknown>) => {
    let pending: Promise<unknown> = Promise.resolve();
    handlers.get(type)?.({ ...event, waitUntil: (p: Promise<unknown>) => (pending = p) });
    await pending;
  };
  return { fire, shown, opened };
}

describe('service worker push (F39)', () => {
  test('a push shows one notification with the laptop text, replacing one with the same tag', async () => {
    const worker = loadWorker([]);
    const message = { title: 'Sirius', body: 'Gym at 18:00', tag: 'schedule:x', tab: 'today' };
    await worker.fire('push', { data: { json: () => message } });
    expect(worker.shown).toEqual([
      {
        title: 'Sirius',
        options: {
          body: 'Gym at 18:00',
          tag: 'schedule:x',
          renotify: true,
          icon: './icon-192.png',
          badge: './icon-192.png',
          data: { tab: 'today' },
        },
      },
    ]);
  });

  test('an unreadable push still says something arrived', async () => {
    const worker = loadWorker([]);
    await worker.fire('push', {
      data: {
        json: () => {
          throw new Error('bad');
        },
      },
    });
    expect(worker.shown[0]?.title).toBe('Sirius');
  });

  test('a tap with the app open switches its tab; with it closed, opens it there', async () => {
    const messages: unknown[] = [];
    let focused = 0;
    const open = loadWorker([
      {
        postMessage: (m) => messages.push(m),
        focus: async () => {
          focused++;
        },
      },
    ]);
    const tap = (tab: string) => ({ notification: { close: () => {}, data: { tab } } });
    await open.fire('notificationclick', tap('list'));
    expect(messages).toEqual([{ type: 'open-tab', tab: 'list' }]);
    expect(focused).toBe(1);

    const closed = loadWorker([]);
    await closed.fire('notificationclick', tap('sirius'));
    expect(closed.opened).toEqual(['./?tab=sirius']);
  });
});
