/**
 * Photos and PDFs shared to DocSync from another app (WhatsApp → Share → DocSync). The installed
 * app's manifest names SHARE_TARGET as its share target; public/sw.js receives that POST, keeps the
 * files in its own cache (SHARED_CACHE) and opens /share?id=<id>, where the user picks the document
 * type. The scan page then reads them with readSharedFiles and deletes them.
 *
 * The files stay on the phone only: they survive the sign-in round trip (they never pass the server),
 * expire after SHARED_MAX_AGE_MS and go with everything else on sign-out. public/sw.js repeats the
 * names below: it is plain JavaScript and can't import this file.
 */

/** Where the share POST goes (manifest share_target.action); app/share/incoming/route.ts answers it without a worker. */
export const SHARE_TARGET = '/share/incoming';
/** The page that asks which document it is. */
export const SHARE_PAGE = '/share';
/** The worker's cache of shared files: not versioned, so a deploy between sharing and scanning keeps them. */
export const SHARED_CACHE = 'docsync-shared';
/** Each file is kept under SHARED_PATH/<id>/<n>, in the order it was shared. */
export const SHARED_PATH = '/shared-files/';
export const SHARED_NAME_HEADER = 'x-docsync-name';
export const SHARED_AT_HEADER = 'x-docsync-shared-at';
/** A share nobody scanned within a day is dropped. */
export const SHARED_MAX_AGE_MS = 24 * 60 * 60 * 1000;
/** /share?missed=1: the share reached the server instead of a worker (first visit), so nothing was kept. */
export const SHARE_MISSED = 'missed';

/** Share ids are the worker's random UUIDs; anything else in the address is ignored. */
export function isShareId(value: unknown): value is string {
  return typeof value === 'string' && /^[a-z0-9-]{8,64}$/i.test(value);
}

/** The address the document-type picker opens for share `id`. */
export function scanWithShared(profileId: string, id: string): string {
  return `/scan/${profileId}?shared=${encodeURIComponent(id)}`;
}

type Storage = Pick<CacheStorage, 'open' | 'has'>;

function cacheStorage(): Storage | null {
  return typeof caches === 'undefined' ? null : caches;
}

/** The file's position within share `id`, or -1 for another share's (or anything else in the cache). */
function indexIn(id: string, key: Request): number {
  const match = new RegExp(`^${SHARED_PATH}${id}/(\\d+)$`).exec(new URL(key.url).pathname);
  return match ? Number(match[1]) : -1;
}

function decodeName(value: string | null): string {
  try {
    return decodeURIComponent(value || '');
  } catch {
    return '';
  }
}

/**
 * The files of share `id`, in the order they were shared; null when there are none (expired,
 * already scanned, cleared on sign-out, or the address was opened by hand). An expired share is
 * deleted on the way. Never throws.
 */
export async function readSharedFiles(id: string, storage = cacheStorage(), now = Date.now()): Promise<File[] | null> {
  if (!storage || !isShareId(id)) return null;
  try {
    // Opening a cache creates it: don't, on a phone that never received a share.
    if (!(await storage.has(SHARED_CACHE))) return null;
    const cache = await storage.open(SHARED_CACHE);
    const keys = (await cache.keys()).map(key => ({ key, index: indexIn(id, key) })).filter(({ index }) => index >= 0);
    if (!keys.length) return null;
    const entries = await Promise.all(keys.sort((a, b) => a.index - b.index).map(({ key }) => cache.match(key)));
    const responses = entries.filter((r): r is Response => Boolean(r));
    const sharedAt = Number(responses[0]?.headers.get(SHARED_AT_HEADER));
    if (!responses.length || !(now - sharedAt < SHARED_MAX_AGE_MS)) {
      await Promise.all(keys.map(({ key }) => cache.delete(key)));
      return null;
    }
    return await Promise.all(responses.map(async (response, n) => {
      const blob = await response.blob();
      const name = decodeName(response.headers.get(SHARED_NAME_HEADER)) || `shared-${n + 1}`;
      return new File([blob], name, { type: response.headers.get('content-type') || blob.type });
    }));
  } catch {
    return null;
  }
}

/** Deletes share `id` once its files are in a scan. Never throws. */
export async function deleteSharedFiles(id: string, storage = cacheStorage()): Promise<void> {
  if (!storage || !isShareId(id)) return;
  try {
    if (!(await storage.has(SHARED_CACHE))) return;
    const cache = await storage.open(SHARED_CACHE);
    const keys = (await cache.keys()).filter(key => indexIn(id, key) >= 0);
    await Promise.all(keys.map(key => cache.delete(key)));
  } catch {
    // the worker drops it within a day anyway
  }
}
