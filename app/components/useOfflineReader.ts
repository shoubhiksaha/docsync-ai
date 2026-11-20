'use client';
import { useEffect, useSyncExternalStore } from 'react';
import { extractDocument, fetchPrefs, type ProfilePrefs } from '@/client/api';
import { createOfflineReader, type OfflineReader, type ReaderDeps, type ReaderSnapshot } from '@/client/offline-reader';
import { keepReading, listScans, newScanId, SCANS_CHANGED } from '@/client/scan-store';
import { SIGNING_OUT } from '@/client/sign-out';
import { track } from '@/client/telemetry';

/** Hidden this long (another app in front, screen off), the reader stops until the page is shown again. */
const HIDDEN_MS = 60_000;
const LOCK = 'docsync-offline-reader';
/** Without Web Locks: a lease in localStorage that the holding tab renews, and a closed tab's runs out. */
const LEASE_KEY = 'docsync_reader_lease';
const LEASE_MS = 30_000;
/** Remembered fields are asked for again after this long (they only point the AI at those fields). */
const PREFS_MS = 5 * 60_000;
const IDLE: ReaderSnapshot = { reading: null, sessionEnded: false };

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const done = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal.addEventListener('abort', done);
  });
}

async function withLease(signal: AbortSignal, work: () => Promise<void>): Promise<void> {
  const me = newScanId();
  const take = (): boolean => {
    try {
      const [holder, until] = (localStorage.getItem(LEASE_KEY) ?? '').split(' ');
      if (holder && holder !== me && Number(until) > Date.now()) return false;
      localStorage.setItem(LEASE_KEY, `${me} ${Date.now() + LEASE_MS}`);
      return true;
    } catch {
      // storage unavailable: no lease to share, so this tab reads
      return true;
    }
  };
  while (!take()) {
    await sleep(LEASE_MS / 3, signal);
    if (signal.aborted) return;
  }
  const renew = setInterval(take, LEASE_MS / 3);
  try {
    await work();
  } finally {
    clearInterval(renew);
    try {
      if (localStorage.getItem(LEASE_KEY)?.startsWith(`${me} `)) localStorage.removeItem(LEASE_KEY);
    } catch {
      // storage unavailable: nothing was written
    }
  }
}

/** One reader across the tabs: a Web Lock where the browser has them, else the lease. */
function lock(signal: AbortSignal, work: () => Promise<void>): Promise<void> {
  if ('locks' in navigator && typeof navigator.locks?.request === 'function') {
    return navigator.locks.request(LOCK, { signal }, () => work()).then(() => undefined);
  }
  return withLease(signal, work);
}

const prefs = new Map<string, { at: number; value: ProfilePrefs }>();

/** The remembered field names point the AI at them, as on the scan page; reading never waits on a failed load. */
async function rememberedLabels(profileId: string): Promise<string[]> {
  let cached = prefs.get(profileId);
  if (!cached || Date.now() - cached.at > PREFS_MS) {
    const value = await fetchPrefs(profileId);
    cached = value ? { at: Date.now(), value } : undefined;
    if (cached) prefs.set(profileId, cached);
  }
  return cached?.value.fields?.map(f => f.label) ?? [];
}

const listeners = new Set<() => void>();
const deps: ReaderDeps = {
  list: listScans,
  read: async (scan, signal) => extractDocument(scan.pages ?? [], scan.profileId, await rememberedLabels(scan.profileId), signal),
  keep: (scan, extraction) => keepReading(scan, extraction),
  lock,
  sleep,
  isOnline: () => navigator.onLine,
  now: () => Date.now(),
  onChange: () => listeners.forEach(listener => listener()),
  onRead: (scan, code, ms, extraction) => {
    if (code) track('extract_failed', { profile: scan.profileId, code, ms, source: 'background' });
    else track('extract_succeeded', { profile: scan.profileId, ms, count: extraction?.fields.length ?? 0, pages: scan.pages?.length ?? 0, mock: Boolean(extraction?.isMock), source: 'background' });
  },
};

// Kept across client-side navigations, so the waits after failures and the photos already tried hold
// when the user comes back to Home: going back and forth never reads harder.
let shared: { account: string; reader: OfflineReader } | null = null;

function readerFor(account: string): OfflineReader {
  if (shared?.account !== account) {
    shared?.reader.end();
    shared = { account, reader: createOfflineReader(account, deps) };
  }
  return shared.reader;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

/**
 * Reads the photos `account` kept offline while this page is open, online and in view (see
 * client/offline-reader.ts). It stops when the page goes offline, is hidden for a minute, unmounts
 * or the user signs out.
 */
export function useOfflineReader(account: string | null): ReaderSnapshot {
  const snapshot = useSyncExternalStore(subscribe, () => (account && shared?.account === account ? shared.reader.snapshot() : IDLE), () => IDLE);

  useEffect(() => {
    if (!account) return;
    const reader = readerFor(account);
    let hidden: ReturnType<typeof setTimeout> | undefined;
    const shown = () => document.visibilityState !== 'hidden';
    const go = () => {
      if (shown()) void reader.start();
    };
    const online = () => {
      if (shown()) void reader.reconnected();
    };
    const offline = () => reader.stop();
    const visibility = () => {
      clearTimeout(hidden);
      if (shown()) go();
      else hidden = setTimeout(() => reader.stop(), HIDDEN_MS);
    };
    const signingOut = () => reader.end();
    go();
    // A photo kept in this tab (or put back with Undo) is picked up without a reload.
    window.addEventListener(SCANS_CHANGED, go);
    window.addEventListener('online', online);
    window.addEventListener('offline', offline);
    window.addEventListener(SIGNING_OUT, signingOut);
    document.addEventListener('visibilitychange', visibility);
    return () => {
      clearTimeout(hidden);
      window.removeEventListener(SCANS_CHANGED, go);
      window.removeEventListener('online', online);
      window.removeEventListener('offline', offline);
      window.removeEventListener(SIGNING_OUT, signingOut);
      document.removeEventListener('visibilitychange', visibility);
      reader.stop();
    };
  }, [account]);

  return snapshot;
}
