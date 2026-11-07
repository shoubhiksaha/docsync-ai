/**
 * Recent scans kept on this device (IndexedDB): photos taken offline that still need processing
 * (and, once read in the background, the reading that waits for the user's check), and saves
 * where a destination failed and can be retried. Every function degrades to a no-op
 * when IndexedDB is unavailable (private mode, old browsers), so the scan flow never depends on it.
 */
import type { SyncInput } from './api';
import type { Destination, DestinationResult, DuplicateAction, Extraction, SaveResult } from './scan-flow';

/** `ready`: a photo kept offline that the background reader has read; it waits for the user's check. */
export type StoredStatus = 'offline' | 'ready' | 'saved' | 'partial' | 'failed';

export interface StoredScan {
  id: string;
  profileId: string;
  createdAt: number;
  updatedAt: number;
  status: StoredStatus;
  /** Original pages; kept for scans that haven't been processed yet. */
  pages?: Blob[];
  fields?: { key: string; label: string; value: string }[];
  note?: string;
  /** The image sent to /api/sync, kept so failed destinations can be retried. */
  archive?: Blob | null;
  audio?: Blob | null;
  destinations?: Partial<Record<Destination, DestinationResult>>;
  spreadsheetUrl?: string;
  /** Photo and voice-note links the first save made, sent with a Sheets retry so the row gets them too. */
  imageLink?: string;
  voiceNoteLink?: string;
  /** The user's answer to "already in your sheet" (Replace / Keep both), sent again with a retry. */
  duplicateAction?: DuplicateAction;
  /** The Google account the scan belongs to (an opaque hash, as docsync_owner). Unset on scans from before owners were kept. */
  owner?: string;
  /** What the background reader read from `pages` (status 'ready'): Check opens with it, without a second read. */
  extraction?: Extraction;
  readAt?: number;
  /** When a scan page last opened this scan: the background reader leaves it alone for a while (see isOpening). */
  openedAt?: number;
}

const DB_NAME = 'docsync';
const STORE = 'scans';
/** Saved scans kept as history. Unsaved ones are never pruned: they hold the only copy of a photo. */
const KEEP_SAVED = 20;
export const SCANS_CHANGED = 'docsync:scans-changed';
/** Recent-scan rows the home page showed last time, so the server can reserve their space. */
export const SCAN_COUNT_COOKIE = 'docsync_scan_rows';
/** Document types this device saved or captured with lately, most recent first. */
export const RECENT_APPS_COOKIE = 'docsync_recent_apps';
const RECENT_APPS = 3;
/** How long a scan opened on a scan page (in any tab) is left to that page by the background reader. */
export const OPENING_MS = 10 * 60_000;
/**
 * The account this device's scans, offline pages and preferences belong to (the header claims it on
 * every signed-in page); new scans are stamped with it. Sign-out removes it with everything else.
 */
export const OWNER_KEY = 'docsync_owner';

let dbPromise: Promise<IDBDatabase | null> | null = null;

function open(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  dbPromise ??= new Promise((resolve) => {
    try {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: 'id' });
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
      request.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

async function run<T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T> | void): Promise<T | null> {
  const db = await open();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, mode);
      const request = work(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(request ? request.result : null);
      tx.onerror = () => resolve(null);
      tx.onabort = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

function changed() {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(SCANS_CHANGED));
}

function setCookie(name: string, value: string) {
  if (typeof document !== 'undefined') document.cookie = `${name}=${value}; path=/; max-age=31536000; samesite=lax`;
}

/** Profile ids from the recent-apps cookie, keeping only known ones. */
export function parseRecentApps(value: string | undefined, known: readonly string[]): string[] {
  return [...new Set((value ?? '').split('.'))].filter(id => known.includes(id)).slice(0, RECENT_APPS);
}

function rememberApp(profileId: string) {
  if (typeof document === 'undefined' || !/^[a-z0-9-]+$/.test(profileId)) return;
  const current = document.cookie.match(new RegExp(`(?:^|; )${RECENT_APPS_COOKIE}=([^;]*)`))?.[1] ?? '';
  const ids = [profileId, ...current.split('.').filter(id => id && id !== profileId)].slice(0, RECENT_APPS);
  setCookie(RECENT_APPS_COOKIE, ids.join('.'));
}

/** What the home page's recent scans showed last time: rows needing the user, and the saved-history line. */
export interface ScanRows {
  rows: number;
  history: boolean;
}

/** Remembers how many recent-scan rows need the user (one past those shown means "Show all" too), and whether saved history was shown (0 clears the hint). */
export function rememberScanRows(count: number, history = false) {
  setCookie(SCAN_COUNT_COOKIE, `${count}${history ? 'h' : ''}`);
}

/** Reads the hint rememberScanRows wrote; anything unexpected reserves nothing. */
export function parseScanRows(value: string | undefined): ScanRows {
  const match = /^(\d+)(h?)$/.exec(value ?? '');
  return { rows: match ? Math.min(Number(match[1]), 6) : 0, history: Boolean(match?.[2]) };
}

function readOwner(): string | null {
  try {
    return localStorage.getItem(OWNER_KEY);
  } catch {
    return null;
  }
}

let claim: { account: string; previous: Promise<string | null> } | null = null;

/**
 * Tells this device which Google account is signed in (the header and Home both call it; the work is
 * done once per account and page load). New scans are stamped with it. The first time, scans without
 * an owner are adopted by this account, as core/device-owner.ts adopts unstamped cookies; another
 * account's scans are kept, still theirs: Home hides them and offers to delete them, and they come
 * back when that account signs in again. Resolves to the account stamped before (null if none).
 */
export function claimScans(account: string): Promise<string | null> {
  if (claim?.account !== account) claim = { account, previous: stamp(account) };
  return claim.previous;
}

async function stamp(account: string): Promise<string | null> {
  const previous = readOwner();
  if (previous === account) return previous;
  try {
    localStorage.setItem(OWNER_KEY, account);
  } catch {
    // storage unavailable: scans stay unstamped, and so does every account's view of them
    return previous;
  }
  if (previous) return previous;
  const unowned = (await listScans()).filter(scan => !scan.owner);
  if (unowned.length) {
    await run('readwrite', (s) => unowned.forEach((scan) => s.put({ ...scan, owner: account })));
    changed();
  }
  return null;
}

/**
 * Splits scans into the signed-in account's and everyone else's. Without a known account (no
 * session id) every scan is shown, as before owners were kept.
 */
export function byOwner(scans: StoredScan[], account: string | null): { mine: StoredScan[]; others: StoredScan[] } {
  if (!account) return { mine: scans, others: [] };
  return { mine: scans.filter(scan => scan.owner === account), others: scans.filter(scan => scan.owner !== account) };
}

/**
 * The scan kept after a save or retry on the scan page: the photo and voice-note links and the
 * duplicate choice go with it, so a retry from Home writes the same row the scan page would.
 */
export function savedScan(scan: Pick<StoredScan, 'id' | 'profileId' | 'fields' | 'note' | 'archive' | 'audio' | 'duplicateAction'>, result: SaveResult, now = Date.now()): StoredScan {
  return {
    ...scan, createdAt: now, updatedAt: now, status: result.status,
    destinations: result.destinations, spreadsheetUrl: result.spreadsheetUrl, imageLink: result.imageLink, voiceNoteLink: result.voiceNoteLink,
  };
}

/**
 * What a retry from Home sends for `only` the failed destinations: the scan id again, so a save
 * whose reply was lost on a weak network isn't written twice; the first save's links; and the
 * user's duplicate choice (Home can't ask, so without one the row is added next to the old one).
 */
export function retryInput(scan: StoredScan, only: Destination[]): SyncInput {
  return {
    profileId: scan.profileId, fields: scan.fields ?? [], archive: scan.archive ?? null, note: scan.note ?? '', audio: scan.audio ?? null, only,
    saveId: scan.id, duplicateAction: scan.duplicateAction ?? 'keep_both', imageLink: scan.imageLink, voiceNoteLink: scan.voiceNoteLink,
  };
}

/** A scan page (in this tab or another) has this scan open: the background reader doesn't read or change it. */
export function isOpening(scan: Pick<StoredScan, 'openedAt'>, now = Date.now()): boolean {
  return typeof scan.openedAt === 'number' && Math.abs(now - scan.openedAt) < OPENING_MS;
}

/**
 * Whether the background reader may keep its reading of `picked` with the scan as it is now: still
 * unread and unchanged since it was picked (not saved, kept again, checked or deleted meanwhile), and
 * not open on a scan page.
 */
export function canKeepReading(current: StoredScan | null | undefined, picked: Pick<StoredScan, 'updatedAt'>, now = Date.now()): current is StoredScan {
  if (!current) return false;
  return current.status === 'offline' && !current.fields?.length && current.updatedAt === picked.updatedAt && !isOpening(current, now);
}

/** The scan with its background reading, waiting for the user's check. It keeps its time: the row still says when the photo was taken. */
export function readyScan(scan: StoredScan, extraction: Extraction, now = Date.now()): StoredScan {
  return { ...scan, status: 'ready', extraction, readAt: now };
}

/**
 * The background reading of a ready scan, if Check can open with it: a record cut short, or one
 * written by another version, gives null and the photo is read again.
 */
export function usableExtraction(scan: StoredScan | null | undefined): Extraction | null {
  const extraction = scan?.status === 'ready' ? scan.extraction : undefined;
  if (!extraction || typeof extraction !== 'object' || !Array.isArray(extraction.fields)) return null;
  const fields = extraction.fields.filter(f => f && typeof f === 'object' && typeof f.key === 'string' && f.key !== '');
  if (fields.length === 0) return null;
  return {
    fields,
    documentType: typeof extraction.documentType === 'string' ? extraction.documentType : undefined,
    isMock: Boolean(extraction.isMock),
    warnings: Array.isArray(extraction.warnings) ? extraction.warnings.filter(w => typeof w === 'string') : [],
  };
}

export function newScanId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export async function listScans(): Promise<StoredScan[]> {
  const all = (await run<StoredScan[]>('readonly', (s) => s.getAll())) ?? [];
  return all.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function getScan(id: string): Promise<StoredScan | null> {
  return (await run<StoredScan>('readonly', (s) => s.get(id))) ?? null;
}

/**
 * Saves a scan. Successful scans drop their images: nothing left to retry, and it saves space.
 * Resolves false when the phone couldn't keep it (no IndexedDB, storage full, private window).
 */
export async function putScan(scan: StoredScan): Promise<boolean> {
  const owned: StoredScan = scan.owner ? scan : { ...scan, owner: readOwner() ?? undefined };
  const record: StoredScan = owned.status === 'saved' ? { ...owned, pages: undefined, archive: undefined, audio: undefined } : owned;
  const key = await run('readwrite', (s) => s.put(record));
  await prune();
  // Putting back another account's scan (Undo on Home) doesn't add to this account's recent document types.
  if (!record.owner || record.owner === readOwner()) rememberApp(scan.profileId);
  changed();
  return key !== null;
}

/**
 * Keeps the background reader's reading with the scan it read (status 'ready'), in one transaction,
 * only if canKeepReading() still holds. Resolves false when it wasn't kept (changed meanwhile, or the
 * phone couldn't keep it).
 */
export async function keepReading(picked: StoredScan, extraction: Extraction, now = Date.now()): Promise<boolean> {
  let kept = false;
  const done = await run<StoredScan>('readwrite', (s) => {
    const request = s.get(picked.id);
    request.onsuccess = () => {
      if (!canKeepReading(request.result, picked, now)) return;
      s.put(readyScan(request.result, extraction, now));
      kept = true;
    };
    return request;
  });
  if (!kept || done === null) return false;
  changed();
  return true;
}

/** Marks a scan as open on this scan page (`at`), or no longer open (null). Changes nothing else in it. */
export async function markOpening(id: string, at: number | null): Promise<void> {
  await run<StoredScan>('readwrite', (s) => {
    const request = s.get(id);
    request.onsuccess = () => {
      if (request.result) s.put({ ...request.result, openedAt: at ?? undefined });
    };
    return request;
  });
}

export async function deleteScan(id: string): Promise<void> {
  await run('readwrite', (s) => s.delete(id));
  changed();
}

/**
 * Deletes several scans at once, with one change event: another account's from Home, and the
 * signed-in account's own on sign-out (never everyone's: another account's may be its only copy).
 */
export async function deleteScans(ids: string[]): Promise<void> {
  await run('readwrite', (s) => ids.forEach((id) => s.delete(id)));
  changed();
}

/** Saved scans past the newest KEEP_SAVED. Waiting, ready, failed and partial scans are never returned. */
export function prunable(scans: StoredScan[], keep = KEEP_SAVED): StoredScan[] {
  return scans
    .filter((scan) => scan.status === 'saved')
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(keep);
}

async function prune() {
  const extra = prunable(await listScans());
  if (extra.length) await run('readwrite', (s) => extra.forEach((scan) => s.delete(scan.id)));
}
