/**
 * The background reader: photos kept offline are read once the phone is back online, one at a time
 * and oldest first, and each reading is kept with its scan ('ready') so the user only has to check
 * and save it. It never saves anything: Check stays the user's step.
 *
 * Pure scheduling with injected deps (storage, the extract call, the clock, a lock shared by the
 * tabs), so the timing rules are unit-tested without a browser. Home wires it to IndexedDB and
 * /api/extract-freeform (app/components/useOfflineReader.ts).
 */
import { ApiError } from './api';
import type { ErrorCode, Extraction } from './scan-flow';
import { isOpening, type StoredScan } from './scan-store';

/** Pause after each reading, so a backlog of photos doesn't reach the AI providers all at once. */
export const GAP_MS = 2_000;
/** A photo that fails this many times in one visit is left for the user (Read now shows why). */
export const MAX_TRIES = 3;
export const MAX_BACKOFF_MS = 15 * 60_000;
/** Reading this photo again would fail the same way: it is left for the user, and the next one is read. */
const LEAVE_FOR_USER: ErrorCode[] = ['bad_input', 'too_large'];
/** The AI service is busy or out of quota: the wait before the next try starts longer. */
const BUSY: ErrorCode[] = ['quota', 'rate_limited'];
/** Failures the connection coming back can fix, so the wait is cut short when it does. */
const CONNECTION: ErrorCode[] = ['network', 'slow'];

/**
 * How long to wait after the `failures`-th failure in a row: doubling from 10 s (a minute when the
 * service is busy), at most MAX_BACKOFF_MS, spread ±20% so tabs and phones don't retry in step.
 */
export function backoffMs(code: ErrorCode, failures: number, random: () => number = Math.random): number {
  const base = BUSY.includes(code) ? 60_000 : 10_000;
  const delay = Math.min(base * 2 ** Math.max(0, failures - 1), MAX_BACKOFF_MS);
  return Math.round(Math.min(delay * (0.8 + 0.4 * random()), MAX_BACKOFF_MS));
}

/**
 * The next photo to read: the account's own, kept offline and not read or checked yet, not open on a
 * scan page, and not `done` this visit. Oldest first, so the photos come back in the order taken.
 */
export function nextToRead(scans: StoredScan[], account: string, now: number, done: ReadonlySet<string>): StoredScan | null {
  const waiting = scans.filter(scan => scan.status === 'offline' && !scan.fields?.length && Array.isArray(scan.pages) && scan.pages.length > 0
    && scan.owner === account && !done.has(scan.id) && !isOpening(scan, now));
  return waiting.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0) || a.id.localeCompare(b.id))[0] ?? null;
}

export interface ReaderDeps {
  /** Every scan on this device (the reader picks its account's own). */
  list: () => Promise<StoredScan[]>;
  /** Reads the scan's pages; throws an ApiError, or an AbortError once `signal` aborts. */
  read: (scan: StoredScan, signal: AbortSignal) => Promise<Extraction>;
  /** Keeps the reading with the scan unless it changed meanwhile; resolves false when it wasn't kept. */
  keep: (scan: StoredScan, extraction: Extraction) => Promise<boolean>;
  /** Runs `work` while this tab holds the one reader lock shared by the tabs (waiting for it first); gives up once `signal` aborts. */
  lock: (signal: AbortSignal, work: () => Promise<void>) => Promise<void>;
  /** Resolves after `ms`, or as soon as `signal` aborts. */
  sleep: (ms: number, signal: AbortSignal) => Promise<void>;
  isOnline: () => boolean;
  now: () => number;
  random?: () => number;
  /** The snapshot changed (a reading started or finished, or the reader stopped for good). */
  onChange?: () => void;
  /** A reading finished (`code` null) or failed, for telemetry. */
  onRead?: (scan: StoredScan, code: ErrorCode | null, ms: number, extraction?: Extraction) => void;
}

export interface ReaderSnapshot {
  /** The scan being read now. */
  reading: string | null;
  /** The Google sign-in ended: the reader stopped until the user signs in again (it never sends them there). */
  sessionEnded: boolean;
}

export interface OfflineReader {
  /** Starts reading if it isn't already (online, session not ended); resolves when this run ends. */
  start: () => Promise<void>;
  /** Stops at once: the reading in flight is cancelled and nothing is kept from it. */
  stop: () => void;
  /** The connection came back: a wait caused by the connection is cut short, then reading starts. */
  reconnected: () => Promise<void>;
  /** Stops for good (signing out). */
  end: () => void;
  snapshot: () => ReaderSnapshot;
}

export function createOfflineReader(account: string, deps: ReaderDeps): OfflineReader {
  const random = deps.random ?? Math.random;
  let run: AbortController | null = null;
  let ended = false;
  /** Asked to start while running: look for photos once more before stopping (one may have just been kept). */
  let again = false;
  let snapshot: ReaderSnapshot = { reading: null, sessionEnded: false };
  /** Read, or given up on, during this visit: never read twice, since each reading is an AI call. */
  const done = new Set<string>();
  const tries = new Map<string, number>();
  let failures = 0;
  let retryAt = 0;
  let waitingFor: ErrorCode | null = null;

  const update = (change: Partial<ReaderSnapshot>) => {
    snapshot = { ...snapshot, ...change };
    deps.onChange?.();
  };

  async function readOne(scan: StoredScan, signal: AbortSignal) {
    const started = deps.now();
    update({ reading: scan.id });
    try {
      const extraction = await deps.read(scan, signal);
      if (signal.aborted) return;
      done.add(scan.id);
      await deps.keep(scan, extraction);
      failures = 0;
      waitingFor = null;
      retryAt = deps.now() + GAP_MS;
      deps.onRead?.(scan, null, deps.now() - started, extraction);
    } catch (err) {
      if (signal.aborted) return;
      const code: ErrorCode = err instanceof ApiError ? err.code : 'internal';
      deps.onRead?.(scan, code, deps.now() - started);
      // No sign-in page opens from the background: Home says so, and the photos wait.
      if (code === 'session') {
        ended = true;
        update({ sessionEnded: true });
        return;
      }
      const tried = (tries.get(scan.id) ?? 0) + 1;
      tries.set(scan.id, tried);
      if (LEAVE_FOR_USER.includes(code)) {
        done.add(scan.id);
        retryAt = deps.now() + GAP_MS;
        return;
      }
      if (tried >= MAX_TRIES) done.add(scan.id);
      failures += 1;
      waitingFor = code;
      retryAt = deps.now() + backoffMs(code, failures, random);
    } finally {
      if (snapshot.reading === scan.id) update({ reading: null });
    }
  }

  async function loop(signal: AbortSignal) {
    while (!signal.aborted && !ended && deps.isOnline()) {
      const wait = retryAt - deps.now();
      if (wait > 0) {
        await deps.sleep(wait, signal);
        continue;
      }
      again = false;
      const scan = nextToRead(await deps.list(), account, deps.now(), done);
      if (signal.aborted) return;
      if (!scan) {
        if (again) continue;
        return;
      }
      await readOne(scan, signal);
    }
  }

  const start = async () => {
    if (run) {
      again = true;
      return;
    }
    if (ended || !deps.isOnline()) return;
    const controller = new AbortController();
    run = controller;
    try {
      await deps.lock(controller.signal, () => loop(controller.signal));
    } catch {
      // the lock was given up (stopped while waiting for another tab), or storage failed: the next start tries again
    } finally {
      if (run === controller) run = null;
    }
  };

  const stop = () => {
    run?.abort();
    run = null;
    if (snapshot.reading) update({ reading: null });
  };

  return {
    start,
    stop,
    reconnected: () => {
      if (waitingFor && CONNECTION.includes(waitingFor)) {
        retryAt = 0;
        waitingFor = null;
      }
      return start();
    },
    end: () => {
      ended = true;
      stop();
    },
    snapshot: () => snapshot,
  };
}
