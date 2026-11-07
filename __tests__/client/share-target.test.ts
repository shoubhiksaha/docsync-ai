import { readFileSync } from 'fs';
import path from 'path';
import vm from 'vm';
import { NextRequest } from 'next/server';
import { GET, POST } from '@/app/share/incoming/route';
import { deleteSharedFiles, readSharedFiles, SHARED_CACHE } from '@/client/shared-files';

/**
 * "Share to DocSync": public/sw.js receives the share POST and keeps the files, and the page reads
 * them with client/shared-files.ts. Both run here against one in-memory Cache Storage holding real
 * Responses, so the names and headers they share are checked end to end.
 */
const ORIGIN = 'https://docsync.test';
const SOURCE = readFileSync(path.join(__dirname, '..', '..', 'public', 'sw.js'), 'utf8');
const DAY = 24 * 60 * 60 * 1000;

const keyOf = (request: string | { url: string }) => new URL(typeof request === 'string' ? request : request.url, ORIGIN).href;

function cacheStorage() {
  const stores = new Map<string, Map<string, Response>>();
  const open = (name: string) => {
    if (!stores.has(name)) stores.set(name, new Map());
    const store = stores.get(name)!;
    return {
      put: async (request: string | { url: string }, response: Response) => {
        // As the real one: the body is read in full before put resolves.
        const body = await response.arrayBuffer();
        store.set(keyOf(request), new Response(body, { status: response.status, headers: response.headers }));
      },
      addAll: async () => undefined,
      match: async (request: string | { url: string }) => store.get(keyOf(request))?.clone(),
      keys: async () => [...store.keys()].map(url => new Request(url)),
      delete: async (request: string | { url: string }) => store.delete(keyOf(request)),
    };
  };
  const storage = {
    open: async (name: string) => open(name),
    has: async (name: string) => stores.has(name),
    keys: async () => [...stores.keys()],
    delete: async (name: string) => stores.delete(name),
    match: async () => undefined,
  };
  return Object.assign(storage as unknown as CacheStorage, { stores });
}

function worker(caches = cacheStorage()) {
  let clock = Date.parse('2026-11-07T09:30:00Z');
  const listeners: Record<string, (event: unknown) => void> = {};
  const self = {
    location: { origin: ORIGIN, href: `${ORIGIN}/sw.js?build=b1` },
    addEventListener: (type: string, listener: (event: unknown) => void) => { listeners[type] = listener; },
    skipWaiting: () => undefined,
    clients: { claim: async () => undefined },
    crypto,
  };
  vm.runInContext(SOURCE, vm.createContext({
    self, caches, Request, Response, Headers, URL, Promise, Array, Set, Date: { now: () => clock },
    fetch: async () => { throw new TypeError('offline'); },
    setTimeout: () => 0,
  }));
  const pending: Promise<unknown>[] = [];
  const settle = async () => { while (pending.length) await pending.shift(); };
  return {
    caches,
    now: () => clock,
    later: (ms: number) => { clock += ms; },
    /** Shares `files` as Android does: a multipart POST to the manifest's share_target. Resolves to the response, or null when the worker left it to the network. */
    async share(files: File[], { pathname = '/share/incoming', text = 'from WhatsApp' } = {}): Promise<Response | null> {
      const form = new FormData();
      form.set('text', text);
      for (const file of files) form.append('files', file);
      let response: Promise<Response> | null = null;
      listeners.fetch({
        request: new Request(`${ORIGIN}${pathname}`, { method: 'POST', body: form }),
        respondWith: (p: Promise<Response>) => { response = p; },
        waitUntil: (p: Promise<unknown>) => pending.push(p),
      });
      return response;
    },
    async post(data: unknown) {
      listeners.message({ data, waitUntil: (p: Promise<unknown>) => pending.push(p) });
      await settle();
    },
    async activate() {
      listeners.activate({ waitUntil: (p: Promise<unknown>) => pending.push(p) });
      await settle();
    },
  };
}

const photo = (name: string, bytes = name) => new File([bytes], name, { type: 'image/jpeg' });
const sharedId = (response: Response | null) => new URL(response!.headers.get('location')!).searchParams.get('id')!;

describe('share to DocSync (service worker and share page)', () => {
  it('keeps shared photos and PDFs on the phone and opens the share page', async () => {
    const sw = worker();
    const pdf = new File(['%PDF-1.4 fictional'], 'Tax invoice 0412.pdf', { type: 'application/pdf' });
    const response = await sw.share([photo('dharam-kanta-slip.jpg', 'gross 18,450 kg'), new File(['hello'], 'note.txt', { type: 'text/plain' }), pdf]);

    expect(response!.status).toBe(303);
    const location = new URL(response!.headers.get('location')!);
    expect(location.origin + location.pathname).toBe(`${ORIGIN}/share`);

    // The text is ignored; the files come back in the order they were shared, with their names.
    const files = await readSharedFiles(sharedId(response), sw.caches, sw.now());
    expect(files!.map(file => [file.name, file.type])).toEqual([['dharam-kanta-slip.jpg', 'image/jpeg'], ['Tax invoice 0412.pdf', 'application/pdf']]);
    await expect(files![0].text()).resolves.toBe('gross 18,450 kg');
  });

  it('keeps at most four files, as many pages as a scan reads', async () => {
    const sw = worker();
    const response = await sw.share(['1', '2', '3', '4', '5', '6'].map(n => photo(`page-${n}.jpg`)));
    expect((await readSharedFiles(sharedId(response), sw.caches, sw.now()))!.map(file => file.name)).toEqual(['page-1.jpg', 'page-2.jpg', 'page-3.jpg', 'page-4.jpg']);
  });

  it('opens the share page without an id when nothing could be kept', async () => {
    const sw = worker();
    const response = await sw.share([new File(['hello'], 'note.txt', { type: 'text/plain' })]);
    expect(response!.headers.get('location')).toBe(`${ORIGIN}/share`);
    expect(sw.caches.stores.get(SHARED_CACHE)?.size ?? 0).toBe(0);
  });

  it('leaves every other POST to the network', async () => {
    const sw = worker();
    expect(await sw.share([photo('slip.jpg')], { pathname: '/api/sync' })).toBeNull();
  });

  it('deletes a share once the scan page has it, and never mixes up two shares', async () => {
    const sw = worker();
    const first = sharedId(await sw.share([photo('first.jpg')]));
    const second = sharedId(await sw.share([photo('second.jpg')]));
    expect(first).not.toBe(second);

    await deleteSharedFiles(first, sw.caches);
    await expect(readSharedFiles(first, sw.caches, sw.now())).resolves.toBeNull();
    expect((await readSharedFiles(second, sw.caches, sw.now()))!.map(file => file.name)).toEqual(['second.jpg']);
  });

  it('drops shares nobody scanned within a day', async () => {
    const sw = worker();
    const old = sharedId(await sw.share([photo('old.jpg')]));
    const kept = sharedId(await sw.share([photo('kept.jpg')]));
    sw.later(DAY + 1);
    // The page treats it as gone (and deletes it) even before the worker has tidied up.
    await expect(readSharedFiles(old, sw.caches, sw.now())).resolves.toBeNull();

    // The next share, or the next worker, removes the rest.
    const fresh = sharedId(await sw.share([photo('fresh.jpg')]));
    expect([...sw.caches.stores.get(SHARED_CACHE)!.keys()].map(url => new URL(url).pathname)).toEqual([`/shared-files/${fresh}/0`]);
    await expect(readSharedFiles(kept, sw.caches, sw.now())).resolves.toBeNull();
  });

  it('survives a deploy, and the next worker drops old shares', async () => {
    const before = worker();
    const id = sharedId(await before.share([photo('slip.jpg')]));
    const after = worker(before.caches);
    await after.activate();
    expect(await readSharedFiles(id, after.caches, before.now())).toHaveLength(1);

    after.later(DAY);
    await after.activate();
    expect(after.caches.stores.get(SHARED_CACHE)!.size).toBe(0);
  });

  it('deletes shared files on sign-out, but keeps them when another account signs in', async () => {
    const sw = worker();
    const id = sharedId(await sw.share([photo('slip.jpg')]));
    await sw.post({ type: 'clear', keepShared: true });
    expect(await readSharedFiles(id, sw.caches, sw.now())).toHaveLength(1);

    await sw.post({ type: 'clear' });
    expect(sw.caches.stores.has(SHARED_CACHE)).toBe(false);
    await expect(readSharedFiles(id, sw.caches, sw.now())).resolves.toBeNull();
  });

  it('ignores an address typed by hand, without creating the cache', async () => {
    const caches = cacheStorage();
    for (const id of ['', '../sw.js', 'x', '00000000-0000-4000-8000-000000000000']) await expect(readSharedFiles(id, caches)).resolves.toBeNull();
    await expect(readSharedFiles('00000000-0000-4000-8000-000000000000', null)).resolves.toBeNull();
    expect(caches.stores.size).toBe(0);
  });
});

describe('the share target without a service worker', () => {
  it('asks to share again, and never reads the upload', async () => {
    const form = new FormData();
    form.append('files', photo('slip.jpg'));
    const request = new NextRequest('http://localhost/share/incoming', { method: 'POST', body: form });
    const response = await POST(request);
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('http://localhost/share?missed=1');
    expect(request.bodyUsed).toBe(false);
  });

  it('answers a visit by hand the same way, not with a 404 or 405', async () => {
    const response = await GET(new NextRequest('http://localhost/share/incoming'));
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('http://localhost/share?missed=1');
  });
});
