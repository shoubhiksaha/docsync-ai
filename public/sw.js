// DocSync AI service worker.
// Makes the app open offline without ever serving stale code online:
//   - /_next/static/* files are content-hashed, so they are served cache-first (oldest trimmed);
//   - a few public assets (offline page, icons, ADT badge) are precached and served from the
//     cache while a fresh copy is fetched, so an edited icon still arrives;
//   - /app.webmanifest is never kept: it is built per device from the language and the recent
//     document types, so a saved copy would carry the last language or the last account's shortcuts;
//   - page navigations go to the network first and fall back to the last copy (or offline.html),
//     also when a weak connection hasn't answered within a few seconds or the server answers with
//     an error (5xx, e.g. while a deploy restarts it). Only addresses without a query are kept:
//     ?resume=, ?error=, ?callbackUrl= and ?notion= change what the page shows, so a copy of one
//     must never stand in for another;
//   - /api/* and every other request always go straight to the network;
//   - a photo or PDF shared to DocSync (manifest share_target, POST /share/incoming) is kept in
//     SHARED_CACHE, never sent to the server, and the share opens /share?id=<id> (303), where the
//     user picks the document type; the scan page reads the files and deletes them
//     (client/shared-files.ts). Shares older than a day are dropped. They survive the sign-in round
//     trip and a deploy (the cache isn't versioned).
// Messages from the app:
//   { type: 'clear' }              logout: no pages from the previous session stay on the device,
//                                  and no shared files (the static cache stays: it holds no user data,
//                                  and only install fills the precache, so deleting it would lose
//                                  offline.html). With keepShared: another account signed in, and a
//                                  photo shared just before belongs to whoever holds the phone now;
//   { type: 'warm', urls, lang }   signed in and idle, or the language changed: save pages not
//                                  opened yet, or saved by an older build or in another language, so
//                                  they open offline with scripts that still exist. Other saved pages
//                                  are kept, also in the old language: offline they beat offline.html.
// The app registers this file as /sw.js?build=<build>, so each deploy installs a fresh worker that
// knows which build saved pages should come from.

const VERSION = 'v4';
const STATIC_CACHE = `docsync-static-${VERSION}`;
const PAGES_CACHE = `docsync-pages-${VERSION}`;
// Names as in client/shared-files.ts, which reads and deletes the files from the page.
const SHARED_CACHE = 'docsync-shared';
const SHARE_TARGET = '/share/incoming';
const SHARED_PATH = '/shared-files/';
const SHARED_NAME_HEADER = 'x-docsync-name';
const SHARED_AT_HEADER = 'x-docsync-shared-at';
const SHARED_MAX_AGE_MS = 24 * 60 * 60 * 1000;
// The scan page reads at most 4 pages; a few more files only cost space.
const MAX_SHARED_FILES = 4;
const CURRENT = [STATIC_CACHE, PAGES_CACHE, SHARED_CACHE];
// Room for every document type's scan page plus Home and Settings.
const MAX_PAGES = 40;
// Enough for a few deploys' worth of chunks; older ones would otherwise pile up on the phone.
// Files a saved page still loads are kept beyond this.
const MAX_STATIC = 200;
// How long a page may take on a weak connection before the saved copy is shown instead.
const PAGE_TIMEOUT_MS = 3500;

// Saved pages carry the build and the language they were rendered in, so warm() can replace older
// copies, each only once its fresh copy has arrived.
const BUILD = new URL(self.location.href).searchParams.get('build') || '';
const BUILD_HEADER = 'x-docsync-build';
const LANG_HEADER = 'x-docsync-lang';

const PRECACHE = [
  '/offline.html', '/icon.svg', '/icons/icon-192.png', '/icons/icon-512.png',
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
      // Older workers precached the manifest; their copy may list another account's shortcuts.
      await (await caches.open(STATIC_CACHE)).delete('/app.webmanifest');
      await trimStatic();
      // A share that can't be checked now is checked by the next one.
      await dropOldShares().catch(() => undefined);
      await self.clients.claim();
    })(),
  );
});

// Bumped whenever saved pages are dropped, so a warm-up still running stops saving old ones.
let generation = 0;
// Warm-ups run one after another, so a second request finds the first one's pages already saved.
let warming = Promise.resolve();

function queueWarm(urls, lang) {
  // Trimmed afterwards rather than on every saved script: trimming reads every saved page.
  warming = warming.then(() => warm(urls, lang)).then(trimStatic).catch(() => undefined);
  return warming;
}

self.addEventListener('message', (event) => {
  const data = event.data || {};
  if (data.type === 'clear') {
    generation += 1;
    event.waitUntil(Promise.all([clearPages(), data.keepShared ? undefined : caches.delete(SHARED_CACHE)]));
  } else if (data.type === 'warm') {
    event.waitUntil(queueWarm(data.urls, data.lang));
  }
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method === 'POST' && url.origin === self.location.origin && url.pathname === SHARE_TARGET) {
    event.respondWith(receiveShare(request));
    return;
  }
  if (request.method !== 'GET') return;
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

/** Saves a page with its build and its language (from <html lang>); resolves to its HTML. */
async function savePage(request, response) {
  const html = await response.text();
  const headers = new Headers(response.headers);
  headers.set(BUILD_HEADER, BUILD);
  headers.set(LANG_HEADER, (/<html[^>]*\slang="([^"]*)"/.exec(html) || [])[1] || '');
  const cache = await caches.open(PAGES_CACHE);
  await cache.put(request, new Response(html, { status: response.status, statusText: response.statusText, headers }));
  await trimPages(cache);
  return html;
}

/** The scripts and styles a page loads. */
function assetsIn(html) {
  return new Set(html.match(/\/_next\/static\/[^"'\s\\]+\.(?:js|css)/g) || []);
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
      // A server error page (plain English, no way back) is worse than the saved copy.
      const answer = network.then((response) => (response.status >= 500 ? null : response));
      return (await Promise.race([answer, timeout])) || cached;
    } catch {
      return cached || (await caches.match('/offline.html')) || Response.error();
    }
  })();
}

// Saves each page (and the scripts it needs) that isn't saved yet, or was saved by another build or
// in another language than `lang`, one at a time so a weak connection isn't flooded. Stops at the
// first redirect: the session has ended. Until it's replaced, an older copy stays: offline it still
// opens with its own scripts.
async function warm(urls, lang) {
  if (!Array.isArray(urls)) return;
  const run = generation;
  for (const path of urls) {
    const url = new URL(path, self.location.origin);
    if (url.origin !== self.location.origin || url.search) continue;
    const saved = await caches.match(url.href, { cacheName: PAGES_CACHE });
    if (saved && saved.headers.get(BUILD_HEADER) === BUILD && (!lang || saved.headers.get(LANG_HEADER) === lang)) continue;
    try {
      const response = await fetch(url.href, { credentials: 'same-origin' });
      if (response.redirected || run !== generation) return;
      if (!isPage(response)) continue;
      const html = await savePage(url.href, response);
      // A page never opened online also needs its own chunks to start offline.
      for (const asset of assetsIn(html)) await cacheFirst(new Request(asset)).catch(() => undefined);
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

async function trimStatic() {
  const cache = await caches.open(STATIC_CACHE);
  // Oldest first, as above; the precached files are never trimmed.
  const keys = (await cache.keys()).filter((key) => !PRECACHE.includes(new URL(key.url).pathname));
  const extra = keys.length - MAX_STATIC;
  if (extra <= 0) return;
  // Nor is anything a saved page loads: offline, that page would open without working buttons.
  const pages = await caches.open(PAGES_CACHE);
  const needed = new Set();
  for (const key of await pages.keys()) {
    const page = await pages.match(key);
    if (page) assetsIn(await page.text()).forEach((asset) => needed.add(asset));
  }
  const old = keys.filter((key) => !needed.has(new URL(key.url).pathname));
  await Promise.all(old.slice(0, extra).map((key) => cache.delete(key)));
}

function seeOther(path) {
  return Response.redirect(new URL(path, self.location.origin).href, 303);
}

function shareId() {
  return self.crypto && self.crypto.randomUUID ? self.crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

// Keeps the shared photos and PDFs (the first few; text and links are ignored) and opens the page
// that asks which document they are. Nothing kept (no file, storage full): that page says so.
async function receiveShare(request) {
  let id = null;
  try {
    const form = await request.formData();
    const files = form.getAll('files')
      .filter((file) => typeof file === 'object' && file && (!file.type || file.type.startsWith('image/') || file.type === 'application/pdf'))
      .slice(0, MAX_SHARED_FILES);
    if (!files.length) return seeOther('/share');
    await dropOldShares();
    id = shareId();
    const cache = await caches.open(SHARED_CACHE);
    const sharedAt = String(Date.now());
    await Promise.all(files.map((file, n) => {
      const headers = new Headers();
      headers.set('content-type', file.type || 'application/octet-stream');
      headers.set(SHARED_NAME_HEADER, encodeURIComponent(file.name || ''));
      headers.set(SHARED_AT_HEADER, sharedAt);
      return cache.put(`${SHARED_PATH}${id}/${n}`, new Response(file, { status: 200, headers }));
    }));
    return seeOther(`/share?id=${id}`);
  } catch {
    // A part of the share may have been kept: never offer half of it.
    if (id) await deleteShare(id).catch(() => undefined);
    return seeOther('/share');
  }
}

async function deleteShare(id) {
  const cache = await caches.open(SHARED_CACHE);
  const keys = (await cache.keys()).filter((key) => new URL(key.url).pathname.startsWith(`${SHARED_PATH}${id}/`));
  await Promise.all(keys.map((key) => cache.delete(key)));
}

// Shares nobody scanned within a day: each file carries the time it was shared.
async function dropOldShares() {
  if (!(await caches.has(SHARED_CACHE))) return;
  const cache = await caches.open(SHARED_CACHE);
  const now = Date.now();
  for (const key of await cache.keys()) {
    const file = await cache.match(key);
    const sharedAt = Number(file && file.headers.get(SHARED_AT_HEADER));
    if (!(now - sharedAt < SHARED_MAX_AGE_MS)) await cache.delete(key);
  }
}
