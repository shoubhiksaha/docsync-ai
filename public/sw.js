// DocSync AI service worker.
// Makes the app open offline without ever serving stale code online:
//   - /_next/static/* files are content-hashed, so they are served cache-first;
//   - a few public assets (offline page, icons, ADT badge, sample) are precached;
//   - page navigations go to the network first and fall back to the last copy (or offline.html);
//   - /api/* and every other request always go straight to the network.
// Logout posts { type: 'clear' } so no pages from the previous session stay on the device.

const VERSION = 'v3';
const STATIC_CACHE = `docsync-static-${VERSION}`;
const PAGES_CACHE = `docsync-pages-${VERSION}`;
const CURRENT = [STATIC_CACHE, PAGES_CACHE];
const MAX_PAGES = 20;

const PRECACHE = [
  '/offline.html', '/manifest.json', '/icon.svg', '/icons/icon-192.png', '/icons/icon-512.png', '/sample-ngo-receipt.png',
  '/brand/offering-by-adt-inline-light.svg', '/brand/offering-by-adt-inline-dark.svg',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(STATIC_CACHE).then((cache) => cache.addAll(PRECACHE)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // This origin only serves DocSync, so any other cache is stale: older versions of this
      // worker and the caches left by the old next-pwa/Workbox worker.
      const keys = await caches.keys();
      await Promise.all(keys.filter((key) => !CURRENT.includes(key)).map((key) => caches.delete(key)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'clear') {
    event.waitUntil(clearAll());
  }
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;

  if (request.mode === 'navigate') {
    event.respondWith(networkFirstPage(request));
  } else if (url.pathname.startsWith('/_next/static/') || PRECACHE.includes(url.pathname)) {
    event.respondWith(cacheFirst(request));
  }
  // Anything else: no respondWith, so the browser fetches from the network as usual.
});

async function clearAll() {
  const keys = await caches.keys();
  await Promise.all(keys.filter((key) => key.startsWith('docsync-')).map((key) => caches.delete(key)));
}

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok && response.type === 'basic') {
    const cache = await caches.open(STATIC_CACHE);
    await cache.put(request, response.clone());
  }
  return response;
}

async function networkFirstPage(request) {
  try {
    const response = await fetch(request);
    // Only keep real pages: a redirect (e.g. to /login) or an error must not replace a good copy.
    if (response.status === 200 && response.type === 'basic' && !response.redirected) {
      const cache = await caches.open(PAGES_CACHE);
      await cache.put(request, response.clone());
      await trimPages(cache);
    }
    return response;
  } catch {
    const cached = await caches.match(request, { cacheName: PAGES_CACHE, ignoreSearch: true });
    return cached || (await caches.match('/offline.html')) || Response.error();
  }
}

async function trimPages(cache) {
  const keys = await cache.keys();
  // Cache keys come back in insertion order, so the first ones are the oldest.
  await Promise.all(keys.slice(0, Math.max(0, keys.length - MAX_PAGES)).map((key) => cache.delete(key)));
}
