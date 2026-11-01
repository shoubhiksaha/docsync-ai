import { readFileSync } from 'fs';
import path from 'path';
import vm from 'vm';

/**
 * Runs public/sw.js against a small in-memory Cache Storage and a scripted network, so the page
 * caching rules can be checked without a browser.
 */
const ORIGIN = 'https://docsync.test';
const SOURCE = readFileSync(path.join(__dirname, '..', '..', 'public', 'sw.js'), 'utf8');

interface FakeResponse {
  ok: boolean;
  status: number;
  type: string;
  redirected: boolean;
  body: string;
  clone(): FakeResponse;
  text(): Promise<string>;
}

function page(body: string, init: Partial<FakeResponse> = {}): FakeResponse {
  const response: FakeResponse = {
    ok: (init.status ?? 200) === 200, status: 200, type: 'basic', redirected: false, body, ...init,
    clone: () => page(body, init),
    text: async () => body,
  };
  return response;
}

const keyOf = (request: string | { url: string }) => new URL(typeof request === 'string' ? request : request.url, ORIGIN).href;

function worker(network: (url: string) => FakeResponse | Error) {
  const stores = new Map<string, Map<string, FakeResponse>>();
  const open = (name: string) => {
    if (!stores.has(name)) stores.set(name, new Map());
    const store = stores.get(name)!;
    return {
      put: async (request: string | { url: string }, response: FakeResponse) => { store.delete(keyOf(request)); store.set(keyOf(request), response); },
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
    location: { origin: ORIGIN },
    addEventListener: (type: string, listener: (event: unknown) => void) => { listeners[type] = listener; },
    skipWaiting: () => undefined,
    clients: { claim: async () => undefined },
  };
  class Request { constructor(public url: string) { this.url = keyOf(url); } }
  const context = vm.createContext({
    self, caches, fetch, Request, URL, Promise, Set, Array,
    Response: { error: () => page('', { status: 0, type: 'error' }) },
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
    async post(data: unknown) {
      listeners.message({ data, waitUntil: (p: Promise<unknown>) => pending.push(p) });
      await settle();
    },
    async precache(pathname: string, body: string) {
      const name = [...stores.keys()].find(key => key.startsWith('docsync-static-')) ?? 'docsync-static-test';
      await open(name).put(pathname, page(body));
    },
    savedPages: () => [...savedPages().keys()].map(url => new URL(url).pathname + new URL(url).search),
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
});
