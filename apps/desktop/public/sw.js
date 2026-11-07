/*
 * Keeps the phone app itself available with no connection (ADR 0010). The data is kept by the
 * app, which knows how old it is; this file only keeps the pages and assets. Network first, so
 * an update to the laptop reaches the phone the next time it opens Sirius in reach of it.
 */
const CACHE = 'sirius-shell-v3';
/** How long the network gets before the saved copy is used. */
const NETWORK_MS = 3000;

/** The first visit must already be enough to open offline, so the shell is fetched up front. */
async function precache() {
  const cache = await caches.open(CACHE);
  const page = await fetch('./', { cache: 'no-store' });
  const html = await page.clone().text();
  await cache.put('./', page);
  const assets = [...html.matchAll(/(?:src|href)="(\.?\/?assets\/[^"]+)"/g)].map((m) => m[1]);
  await cache.addAll([...new Set(assets)]);
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    precache()
      .catch(() => {})
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== location.origin) return;
  if (url.pathname.startsWith('/v1/')) return;
  // Every page is the one app, so any route offline falls back to the cached start page.
  const fallback = event.request.mode === 'navigate' ? './' : event.request;
  const fetchAndKeep = () =>
    fetch(event.request).then((response) => {
      if (response.ok) {
        const copy = response.clone();
        caches.open(CACHE).then((cache) => cache.put(event.request, copy));
      }
      return response;
    });
  // The server varies on Origin, which a precached request never sent, so match without it.
  const match = (request) => caches.match(request, { ignoreVary: true });
  // Built assets have their hash in the name, so a saved one is always the right one.
  // shortcut: replaced assets stay cached until CACHE changes; prune them if the cache grows.
  if (url.pathname.includes('/assets/')) {
    event.respondWith(match(event.request).then((hit) => hit ?? fetchAndKeep()));
    return;
  }
  // A sleeping laptop behind Tailscale drops packets rather than refusing them, so the network
  // gets a few seconds before the saved copy opens instead. It still refreshes the copy after.
  const network = fetchAndKeep();
  const late = new Promise((resolve) => setTimeout(resolve, NETWORK_MS, null));
  event.respondWith(
    Promise.race([network.catch(() => null), late]).then(
      async (response) =>
        response ?? (await match(event.request)) ?? (await match(fallback)) ?? network,
    ),
  );
});

// Browser push (F39). The laptop encrypts each notification for this phone; the browser
// decrypts it before this runs.
self.addEventListener('push', (event) => {
  let message = { title: 'Sirius', body: '', tag: 'sirius', tab: 'today' };
  try {
    message = { ...message, ...event.data.json() };
  } catch {
    // An empty or unreadable push still says something arrived.
  }
  event.waitUntil(
    self.registration.showNotification(message.title, {
      body: message.body,
      tag: message.tag,
      renotify: true,
      icon: './icon-192.png',
      badge: './icon-192.png',
      data: { tab: message.tab },
    }),
  );
});

// A tap opens Sirius on the tab the notification is about, reusing an open window.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const tab = event.notification.data?.tab ?? 'today';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
      const open = windows[0];
      if (open) {
        open.postMessage({ type: 'open-tab', tab });
        return open.focus();
      }
      return self.clients.openWindow(`./?tab=${encodeURIComponent(tab)}`);
    }),
  );
});
