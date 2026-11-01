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
const KEEP = 20;
export const SCANS_CHANGED = 'docsync:scans-changed';

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
  changed();
}

async function prune() {
  const scans = await listScans();
  const extra = scans.slice(KEEP);
  if (extra.length) await run('readwrite', (s) => extra.forEach((scan) => s.delete(scan.id)));
}
