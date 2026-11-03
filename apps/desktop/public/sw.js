/*
 * Keeps the phone app itself available with no connection (ADR 0010). The data is kept by the
 * app, which knows how old it is; this file only keeps the pages and assets. Network first, so
 * an update to the laptop reaches the phone the next time it opens Sirius in reach of it.
 */
const CACHE = 'sirius-shell-v2';

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
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(event.request, copy));
        }
        return response;
      })
      .catch(() => caches.match(event.request).then((hit) => hit ?? caches.match(fallback))),
  );
});
