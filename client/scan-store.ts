/**
 * Recent scans kept on this device (IndexedDB): photos taken offline that still need processing,
 * and saves where a destination failed and can be retried. Every function degrades to a no-op
 * when IndexedDB is unavailable (private mode, old browsers), so the scan flow never depends on it.
 */
import type { Destination, DestinationResult } from './scan-flow';

export type StoredStatus = 'offline' | 'saved' | 'partial' | 'failed';

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

/** Remembers how many recent-scan rows were shown, and whether saved history was (0 clears the hint). */
export function rememberScanRows(count: number, history = false) {
  setCookie(SCAN_COUNT_COOKIE, `${count}${history ? 'h' : ''}`);
}

/** Reads the hint rememberScanRows wrote; anything unexpected reserves nothing. */
export function parseScanRows(value: string | undefined): ScanRows {
  const match = /^(\d+)(h?)$/.exec(value ?? '');
  return { rows: match ? Math.min(Number(match[1]), 6) : 0, history: Boolean(match?.[2]) };
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
  const record: StoredScan = scan.status === 'saved' ? { ...scan, pages: undefined, archive: undefined, audio: undefined } : scan;
  const key = await run('readwrite', (s) => s.put(record));
  await prune();
  rememberApp(scan.profileId);
  changed();
  return key !== null;
}

export async function deleteScan(id: string): Promise<void> {
  await run('readwrite', (s) => s.delete(id));
  changed();
}

/** Removes everything (sign-out). */
export async function clearScans(): Promise<void> {
  await run('readwrite', (s) => s.clear());
  rememberScanRows(0);
  changed();
}

/** Saved scans past the newest KEEP_SAVED. Waiting, failed and partial scans are never returned. */
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
