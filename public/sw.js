// DocSync AI service worker.
// Makes the app open offline without ever serving stale code online:
//   - /_next/static/* files are content-hashed, so they are served cache-first (oldest trimmed);
//   - a few public assets (offline page, icons, ADT badge) are precached and served from the
//     cache while a fresh copy is fetched, so an edited manifest or icon still arrives;
//   - page navigations go to the network first and fall back to the last copy (or offline.html),
//     also when a weak connection hasn't answered within a few seconds. Only addresses without a
//     query are kept: ?resume=, ?error=, ?callbackUrl= and ?notion= change what the page shows, so
//     a copy of one must never stand in for another;
//   - /api/* and every other request always go straight to the network.
// Messages from the app:
//   { type: 'clear' }              logout: no pages from the previous session stay on the device
//                                  (the static cache stays: it holds no user data, and only install
//                                  fills the precache, so deleting it would lose offline.html);
//   { type: 'clear-pages', urls }  the language changed: drop the saved pages, save `urls` again;
//   { type: 'warm', urls }         signed in and idle: save pages not opened yet, so they open offline.

const VERSION = 'v4';
const STATIC_CACHE = `docsync-static-${VERSION}`;
const PAGES_CACHE = `docsync-pages-${VERSION}`;
const CURRENT = [STATIC_CACHE, PAGES_CACHE];
// Room for every document type's scan page plus Home and Settings.
const MAX_PAGES = 40;
// Enough for a few deploys' worth of chunks; older ones would otherwise pile up on the phone.
const MAX_STATIC = 200;
// How long a page may take on a weak connection before the saved copy is shown instead.
const PAGE_TIMEOUT_MS = 3500;

const PRECACHE = [
  '/offline.html', '/manifest.json', '/icon.svg', '/icons/icon-192.png', '/icons/icon-512.png',
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

// Bumped whenever saved pages are dropped, so a warm-up still running stops saving old ones.
let generation = 0;
// Warm-ups run one after another, so a second request finds the first one's pages already saved.
let warming = Promise.resolve();

function queueWarm(urls) {
  warming = warming.then(() => warm(urls)).catch(() => undefined);
  return warming;
}

self.addEventListener('message', (event) => {
  const data = event.data || {};
  if (data.type === 'clear') {
    generation += 1;
    event.waitUntil(clearPages());
  } else if (data.type === 'clear-pages') {
    // Saved pages carry the language they were rendered in.
    generation += 1;
    event.waitUntil(caches.delete(PAGES_CACHE).then(() => queueWarm(data.urls)));
  } else if (data.type === 'warm') {
    event.waitUntil(queueWarm(data.urls));
  }
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;

  if (request.mode === 'navigate') {
    event.respondWith(networkFirstPage(event));
  } else if (url.pathname.startsWith('/_next/static/')) {
    event.respondWith(cacheFirst(request));
  } else if (PRECACHE.includes(url.pathname)) {
    event.respondWith(staleWhileRevalidate(event));
  }
  // Anything else: no respondWith, so the browser fetches from the network as usual.
});

async function clearPages() {
  const keys = await caches.keys();
  await Promise.all(keys.filter((key) => key.startsWith('docsync-pages-')).map((key) => caches.delete(key)));
}

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok && response.type === 'basic') {
    const cache = await caches.open(STATIC_CACHE);
    await cache.put(request, response.clone());
    await trimStatic(cache);
  }
  return response;
}

// Non-hashed public files: answer from the cache at once, refresh it in the background.
function staleWhileRevalidate(event) {
  const fresh = fetch(event.request).then(async (response) => {
    if (response.ok && response.type === 'basic') {
      const cache = await caches.open(STATIC_CACHE);
      await cache.put(event.request, response.clone());
    }
    return response;
  });
  event.waitUntil(fresh.catch(() => undefined));
  return caches.match(event.request).then((cached) => cached || fresh);
}

/** Only real pages are kept: a redirect (e.g. to /login) or an error must not replace a good copy. */
function isPage(response) {
  return response.status === 200 && response.type === 'basic' && !response.redirected;
}

async function savePage(request, response) {
  const cache = await caches.open(PAGES_CACHE);
  await cache.put(request, response);
  await trimPages(cache);
}

function networkFirstPage(event) {
  const { request } = event;
  // A query (?resume=, ?error=…) is part of what the page shows, so those pages are never saved.
  const keep = !new URL(request.url).search;
  const network = fetch(request).then(async (response) => {
    if (keep && isPage(response)) await savePage(request, response.clone());
    return response;
  });
  // If the saved copy is shown first, the network answer still refreshes the cache.
  event.waitUntil(network.catch(() => undefined));

  return (async () => {
    // The exact address only: a copy saved for another query would show the wrong page.
    const cached = keep ? await caches.match(request, { cacheName: PAGES_CACHE }) : undefined;
    try {
      // Without a saved copy there is nothing better to show, so keep waiting for the network.
      if (!cached) return await network;
      const timeout = new Promise((resolve) => setTimeout(resolve, PAGE_TIMEOUT_MS, null));
      return (await Promise.race([network, timeout])) || cached;
    } catch {
      return cached || (await caches.match('/offline.html')) || Response.error();
    }
  })();
}

// Saves each page (and the scripts it needs) that isn't saved yet, one at a time so a weak
// connection isn't flooded. Stops at the first redirect: the session has ended.
async function warm(urls) {
  if (!Array.isArray(urls)) return;
  const run = generation;
  for (const path of urls) {
    const url = new URL(path, self.location.origin);
    if (url.origin !== self.location.origin || url.search) continue;
    if (await caches.match(url.href, { cacheName: PAGES_CACHE })) continue;
    try {
      const response = await fetch(url.href, { credentials: 'same-origin' });
      if (response.redirected || run !== generation) return;
      if (!isPage(response)) continue;
      await savePage(url.href, response.clone());
      // A page never opened online also needs its own chunks to start offline.
      const html = await response.text();
      const assets = new Set(html.match(/\/_next\/static\/[^"'\s\\]+\.(?:js|css)/g) || []);
      for (const asset of assets) await cacheFirst(new Request(asset)).catch(() => undefined);
    } catch {
      return; // offline or the connection dropped: try again next time
    }
  }
}

async function trimPages(cache) {
  const keys = await cache.keys();
  // Cache keys come back in insertion order, so the first ones are the oldest.
  await Promise.all(keys.slice(0, Math.max(0, keys.length - MAX_PAGES)).map((key) => cache.delete(key)));
}

async function trimStatic(cache) {
  // Oldest first, as above; the precached files are never trimmed.
  const keys = (await cache.keys()).filter((key) => !PRECACHE.includes(new URL(key.url).pathname));
  await Promise.all(keys.slice(0, Math.max(0, keys.length - MAX_STATIC)).map((key) => cache.delete(key)));
}
