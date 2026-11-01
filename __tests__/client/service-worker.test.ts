import { readFileSync } from 'fs';
import path from 'path';
import vm from 'vm';

/**
 * Runs public/sw.js against a small in-memory Cache Storage and a scripted network, so the page
 * caching rules can be checked without a browser.
 */
const ORIGIN = 'https://docsync.test';
const SOURCE = readFileSync(path.join(__dirname, '..', '..', 'public', 'sw.js'), 'utf8');

class FakeHeaders {
  private values = new Map<string, string>();
  constructor(init?: FakeHeaders) { init?.forEach((value, name) => this.values.set(name, value)); }
  get(name: string) { return this.values.get(name.toLowerCase()) ?? null; }
  set(name: string, value: string) { this.values.set(name.toLowerCase(), value); }
  forEach(each: (value: string, name: string) => void) { this.values.forEach(each); }
}

interface FakeResponse {
  ok: boolean;
  status: number;
  type: string;
  redirected: boolean;
  headers: FakeHeaders;
  body: string;
  clone(): FakeResponse;
  text(): Promise<string>;
}

function page(body: string, init: Partial<FakeResponse> = {}): FakeResponse {
  const response: FakeResponse = {
    ok: (init.status ?? 200) === 200, status: 200, type: 'basic', redirected: false, headers: new FakeHeaders(), body, ...init,
    clone: () => page(body, init),
    text: async () => body,
  };
  return response;
}

const keyOf = (request: string | { url: string }) => new URL(typeof request === 'string' ? request : request.url, ORIGIN).href;

type Stores = Map<string, Map<string, FakeResponse>>;

/** `build` is the one the app registered the worker with; pass `stores` to start from another worker's caches. */
function worker(network: (url: string) => FakeResponse | Error, { build = 'b1', stores = new Map() as Stores } = {}) {
  const open = (name: string) => {
    if (!stores.has(name)) stores.set(name, new Map());
    const store = stores.get(name)!;
    return {
      put: async (request: string | { url: string }, response: FakeResponse) => { store.delete(keyOf(request)); store.set(keyOf(request), response); },
      addAll: async (requests: string[]) => { for (const request of requests) store.set(keyOf(request), await fetch(request)); },
      match: async (request: string | { url: string }) => store.get(keyOf(request)),
      keys: async () => [...store.keys()].map(url => ({ url })),
      delete: async (request: string | { url: string }) => store.delete(keyOf(request)),
    };
  };
  const caches = {
    open: async (name: string) => open(name),
    keys: async () => [...stores.keys()],
    delete: async (name: string) => stores.delete(name),
    match: async (request: string | { url: string }, options: { cacheName?: string } = {}) => {
      const names = options.cacheName ? [options.cacheName] : [...stores.keys()];
      for (const name of names) {
        const hit = stores.get(name)?.get(keyOf(request));
        if (hit) return hit;
      }
      return undefined;
    },
  };
  const fetched: string[] = [];
  const fetch = async (request: string | { url: string }) => {
    const url = keyOf(request);
    fetched.push(new URL(url).pathname + new URL(url).search);
    const result = network(url);
    if (result instanceof Error) throw result;
    return result;
  };
  const listeners: Record<string, (event: unknown) => void> = {};
  const self = {
    location: { origin: ORIGIN, href: `${ORIGIN}/sw.js?build=${build}` },
    addEventListener: (type: string, listener: (event: unknown) => void) => { listeners[type] = listener; },
    skipWaiting: () => undefined,
    clients: { claim: async () => undefined },
  };
  class Request { constructor(public url: string) { this.url = keyOf(url); } }
  const Response = Object.assign(
    function Response(body: string, init: { status: number; headers: FakeHeaders }) { return page(body, { status: init.status, headers: init.headers }); },
    { error: () => page('', { status: 0, type: 'error' }) },
  );
  const context = vm.createContext({
    self, caches, fetch, Request, URL, Promise, Set, Array, Response, Headers: FakeHeaders,
    // The weak-connection timer never fires here: these tests are about which copy is used.
    setTimeout: () => 0,
  });
  vm.runInContext(SOURCE, context);

  const savedPages = () => stores.get([...stores.keys()].find(key => key.startsWith('docsync-pages-')) ?? '') ?? new Map<string, FakeResponse>();
  const pending: Promise<unknown>[] = [];
  const settle = async () => { while (pending.length) await pending.shift(); };
  return {
    stores,
    fetched,
    async activate() {
      listeners.activate({ waitUntil: (p: Promise<unknown>) => pending.push(p) });
      await settle();
    },
    async navigate(pathAndQuery: string): Promise<string> {
      let response: Promise<FakeResponse> | undefined;
      listeners.fetch({
        request: { method: 'GET', mode: 'navigate', url: keyOf(pathAndQuery) },
        respondWith: (p: Promise<FakeResponse>) => { response = p; },
        waitUntil: (p: Promise<unknown>) => pending.push(p),
      });
      const body = (await response!).body;
      await settle();
      return body;
    },
    /** A script request from an open page (served cache-first). */
    async fetchStatic(pathname: string) {
      let response: Promise<FakeResponse> | undefined;
      listeners.fetch({
        request: { method: 'GET', mode: 'no-cors', url: keyOf(pathname) },
        respondWith: (p: Promise<FakeResponse>) => { response = p; },
        waitUntil: (p: Promise<unknown>) => pending.push(p),
      });
      await response;
      await settle();
    },
    async install() {
      listeners.install({ waitUntil: (p: Promise<unknown>) => pending.push(p) });
      await settle();
    },
    async post(data: unknown) {
      listeners.message({ data, waitUntil: (p: Promise<unknown>) => pending.push(p) });
      await settle();
    },
    async precache(pathname: string, body: string) {
      const name = [...stores.keys()].find(key => key.startsWith('docsync-static-')) ?? 'docsync-static-test';
      await open(name).put(pathname, page(body));
    },
    savedPages: () => [...savedPages().keys()].map(url => new URL(url).pathname + new URL(url).search),
    staticFiles: () => [...(stores.get([...stores.keys()].find(key => key.startsWith('docsync-static-')) ?? '')?.keys() ?? [])].map(url => new URL(url).pathname),
    savedBodies: () => [...savedPages().values()].map(response => response.body),
  };
}

describe('service worker page cache', () => {
  it('never serves a page saved for another query', async () => {
    let online = true;
    const sw = worker(url => (online ? page(`page ${new URL(url).pathname}${new URL(url).search}`) : new TypeError('offline')));
    await sw.precache('/offline.html', 'offline page');

    await sw.navigate('/login?error=Cancelled');
    await sw.navigate('/scan/kirana-khata?resume=old-scan');
    expect(sw.savedPages()).toEqual([]);

    await sw.navigate('/login');
    await sw.navigate('/scan/kirana-khata');
    expect(sw.savedPages()).toEqual(['/login', '/scan/kirana-khata']);

    online = false;
    // Without the query the saved copy is right; with one it would show another visit's state.
    await expect(sw.navigate('/login')).resolves.toBe('page /login');
    await expect(sw.navigate('/scan/kirana-khata')).resolves.toBe('page /scan/kirana-khata');
    await expect(sw.navigate('/login?callbackUrl=%2Fsettings')).resolves.toBe('offline page');
    await expect(sw.navigate('/scan/kirana-khata?resume=new-scan')).resolves.toBe('offline page');
  });

  it('keeps a good copy when the network answers with a redirect', async () => {
    let signedIn = true;
    const sw = worker(() => (signedIn ? page('home') : page('login', { redirected: true })));
    await sw.navigate('/');
    signedIn = false;
    await sw.navigate('/');
    expect(sw.savedPages()).toEqual(['/']);
  });

  it('saves the pages again after a language switch', async () => {
    let lang = 'en';
    const sw = worker(url => page(`${lang} ${new URL(url).pathname}`));
    await sw.navigate('/');
    await sw.navigate('/settings');
    await sw.navigate('/scan/milk-slip');

    lang = 'hi';
    await sw.post({ type: 'clear-pages', urls: ['/scan/milk-slip', '/'] });

    // Settings (not asked for again) is dropped rather than left in English.
    expect(sw.savedPages()).toEqual(['/scan/milk-slip', '/']);
    expect(sw.savedBodies()).toEqual(['hi /scan/milk-slip', 'hi /']);
  });

  it('drops the saved pages on sign-out but keeps the offline page', async () => {
    let online = true;
    const sw = worker(url => (online ? page(`page ${new URL(url).pathname}`) : new TypeError('offline')));
    await sw.install();
    await sw.navigate('/scan/kirana-khata');
    expect(sw.savedPages()).toEqual(['/scan/kirana-khata']);

    await sw.post({ type: 'clear' });
    expect(sw.savedPages()).toEqual([]);

    // Only install fills the precache, so the bilingual offline page must survive a sign-out.
    online = false;
    await expect(sw.navigate('/scan/kirana-khata')).resolves.toBe('page /offline.html');
    await expect(sw.navigate('/settings')).resolves.toBe('page /offline.html');
  });

  it('warms pages not saved yet, with their scripts, and stops once the session has ended', async () => {
    const sw = worker((url) => {
      const { pathname } = new URL(url);
      if (pathname === '/scan/c') return page('login', { redirected: true });
      if (pathname.startsWith('/_next/static/')) return page('script');
      return page(`<script src="/_next/static/chunks/app/scan/%5Bprofile%5D/page-1a2b.js"></script> ${pathname}`);
    });
    await sw.navigate('/scan/a');
    sw.fetched.length = 0;

    await sw.post({ type: 'warm', urls: ['/scan/a', '/scan/b', '/scan/c', '/scan/d', 'https://elsewhere.test/x'] });

    expect(sw.fetched).toEqual(['/scan/b', '/_next/static/chunks/app/scan/%5Bprofile%5D/page-1a2b.js', '/scan/c']);
    expect(sw.savedPages()).toEqual(['/scan/a', '/scan/b']);
  });

  it('saves pages again once a new build is out, keeping the old copy until then', async () => {
    let build = 'b1';
    let online = true;
    const network = (url: string) => (online ? page(`${build} ${new URL(url).pathname}`) : new TypeError('offline'));
    const before = worker(network, { build: 'b1' });
    await before.post({ type: 'warm', urls: ['/scan/a', '/scan/b'] });

    // A deploy: the app registers the worker under the new build, with the same caches.
    build = 'b2';
    const after = worker(network, { build: 'b2', stores: before.stores });
    online = false;
    await after.post({ type: 'warm', urls: ['/scan/a', '/scan/b'] });
    expect(after.savedBodies()).toEqual(['b1 /scan/a', 'b1 /scan/b']);

    online = true;
    after.fetched.length = 0;
    await after.post({ type: 'warm', urls: ['/scan/a', '/scan/b'] });
    expect(after.fetched).toEqual(['/scan/a', '/scan/b']);
    expect(after.savedBodies()).toEqual(['b2 /scan/a', 'b2 /scan/b']);

    // Saved under this build: nothing to fetch.
    after.fetched.length = 0;
    await after.post({ type: 'warm', urls: ['/scan/a', '/scan/b'] });
    expect(after.fetched).toEqual([]);
  });

  it('never trims the scripts a saved page loads', async () => {
    const sw = worker((url) => {
      const { pathname } = new URL(url);
      if (pathname.startsWith('/_next/static/')) return page('script');
      return page(`<script src="/_next/static/chunks/kept-0.js"></script> ${pathname}`);
    });
    // The saved page's script is the oldest file; 250 newer ones from later visits follow it.
    await sw.post({ type: 'warm', urls: ['/scan/a'] });
    for (let i = 1; i <= 250; i += 1) await sw.fetchStatic(`/_next/static/chunks/later-${i}.js`);
    await sw.activate();

    const files = sw.staticFiles();
    expect(files).toContain('/_next/static/chunks/kept-0.js');
    expect(files).toHaveLength(200);
    expect(files).not.toContain('/_next/static/chunks/later-1.js');
    expect(files).toContain('/_next/static/chunks/later-250.js');
  });
});
