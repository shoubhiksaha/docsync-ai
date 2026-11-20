import { ApiError } from '@/client/api';
import { backoffMs, createOfflineReader, GAP_MS, MAX_BACKOFF_MS, MAX_TRIES, nextToRead, type ReaderDeps } from '@/client/offline-reader';
import type { ErrorCode, Extraction } from '@/client/scan-flow';
import { OPENING_MS, type StoredScan } from '@/client/scan-store';

const page = new Blob(['x'], { type: 'image/jpeg' });
const ACCOUNT = 'account-a';
const settle = () => new Promise(resolve => setImmediate(resolve));
const reading: Extraction = { fields: [{ key: 'farmerName', label: 'Farmer Name', value: 'Sunita Devi', confidence: 97 }] };

function kept(id: string, createdAt: number, extra: Partial<StoredScan> = {}): StoredScan {
  return { id, profileId: 'dairy-collection-slip', createdAt, updatedAt: createdAt, status: 'offline', pages: [page], owner: ACCOUNT, ...extra };
}

/**
 * A device with `scans`, a fake clock that only moves when the reader sleeps, and a read that
 * answers from `answers` (one per call: a reading, or an error code), then succeeds.
 */
function device(scans: StoredScan[], answers: (Extraction | ErrorCode)[] = [], overrides: Partial<ReaderDeps> = {}) {
  let clock = 1_000_000;
  let online = true;
  let inFlight = 0;
  const log = { reads: [] as string[], kept: [] as string[], sleeps: [] as number[], maxInFlight: 0 };
  const store = new Map(scans.map(scan => [scan.id, scan]));
  const deps: ReaderDeps = {
    list: async () => [...store.values()],
    read: async (scan, signal) => {
      log.reads.push(scan.id);
      inFlight += 1;
      log.maxInFlight = Math.max(log.maxInFlight, inFlight);
      try {
        await Promise.resolve();
        if (signal.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' });
        const answer = answers.shift() ?? reading;
        if (typeof answer === 'string') throw new ApiError(answer);
        return answer;
      } finally {
        inFlight -= 1;
      }
    },
    keep: async (scan, extraction) => {
      log.kept.push(scan.id);
      store.set(scan.id, { ...scan, status: 'ready', extraction });
      return true;
    },
    lock: (_signal, work) => work(),
    sleep: async (ms) => {
      log.sleeps.push(ms);
      clock += ms;
    },
    isOnline: () => online,
    now: () => clock,
    random: () => 0.5,
    ...overrides,
  };
  return {
    deps, log, store,
    goOffline: () => { online = false; },
    goOnline: () => { online = true; },
    advance: (ms: number) => { clock += ms; },
  };
}

describe('client/offline-reader: what to read next', () => {
  const now = 5_000_000;

  it("picks the account's oldest photo that hasn't been read or checked yet", () => {
    const scans = [
      kept('newer', 300), kept('oldest', 100), kept('middle', 200),
      kept('theirs', 50, { owner: 'account-b' }),
      kept('unowned', 60, { owner: undefined }),
      kept('checked', 70, { fields: [{ key: 'amount', label: 'Amount', value: '500' }] }),
      kept('ready', 80, { status: 'ready', extraction: reading }),
      kept('failed', 90, { status: 'failed' }),
      kept('no-pages', 95, { pages: [] }),
    ];
    expect(nextToRead(scans, ACCOUNT, now, new Set())?.id).toBe('oldest');
    expect(nextToRead(scans, ACCOUNT, now, new Set(['oldest']))?.id).toBe('middle');
    expect(nextToRead(scans, ACCOUNT, now, new Set(['oldest', 'middle', 'newer']))).toBeNull();
  });

  it('leaves a photo alone while a scan page has it open, and takes it back once that is long past', () => {
    const open = kept('open', 100, { openedAt: now - 1_000 });
    const left = kept('left', 200, { openedAt: now - OPENING_MS - 1 });
    expect(nextToRead([open, left], ACCOUNT, now, new Set())?.id).toBe('left');
    expect(nextToRead([open], ACCOUNT, now, new Set())).toBeNull();
  });
});

describe('client/offline-reader: backoff', () => {
  it('doubles from 10 s, starts at a minute when the service is busy, and stops growing at the cap', () => {
    const mid = () => 0.5;
    expect([1, 2, 3].map(n => backoffMs('network', n, mid))).toEqual([10_000, 20_000, 40_000]);
    expect([1, 2].map(n => backoffMs('quota', n, mid))).toEqual([60_000, 120_000]);
    expect(backoffMs('rate_limited', 1, mid)).toBe(60_000);
    expect(backoffMs('unavailable', 30, mid)).toBe(MAX_BACKOFF_MS);
  });

  it('spreads the waits by up to 20% either way, never past the cap', () => {
    expect(backoffMs('network', 1, () => 0)).toBe(8_000);
    expect(backoffMs('network', 1, () => 1)).toBe(12_000);
    expect(backoffMs('quota', 20, () => 1)).toBe(MAX_BACKOFF_MS);
  });
});

describe('client/offline-reader: reading', () => {
  it('reads every kept photo one at a time, oldest first, keeps each reading, and pauses between them', async () => {
    const d = device([kept('b', 200), kept('a', 100), kept('c', 300)]);
    const reader = createOfflineReader(ACCOUNT, d.deps);
    await reader.start();
    expect(d.log.reads).toEqual(['a', 'b', 'c']);
    expect(d.log.kept).toEqual(['a', 'b', 'c']);
    expect(d.log.maxInFlight).toBe(1);
    expect(d.log.sleeps).toEqual([GAP_MS, GAP_MS, GAP_MS]);
    expect([...d.store.values()].map(scan => scan.status)).toEqual(['ready', 'ready', 'ready']);
    expect(reader.snapshot()).toEqual({ reading: null, sessionEnded: false });
  });

  it("runs once even when started again while reading, and picks up a photo kept meanwhile", async () => {
    const d = device([kept('a', 100)]);
    const reader = createOfflineReader(ACCOUNT, d.deps);
    const keep = d.deps.keep;
    d.deps.keep = async (scan, extraction) => {
      // Kept on the scan page while the first photo was read (SCANS_CHANGED → start()).
      if (scan.id === 'a') {
        d.store.set('b', kept('b', 200));
        void reader.start();
      }
      return keep(scan, extraction);
    };
    await Promise.all([reader.start(), reader.start()]);
    expect(d.log.reads).toEqual(['a', 'b']);
    expect(d.log.maxInFlight).toBe(1);
  });

  it('shows which photo is being read while it is read', async () => {
    const seen: (string | null)[] = [];
    const d = device([kept('a', 100)]);
    const reader = createOfflineReader(ACCOUNT, { ...d.deps, onChange: () => seen.push(reader.snapshot().reading) });
    await reader.start();
    expect(seen).toEqual(['a', null]);
  });

  it('never reads a photo twice in one visit, even when its reading could not be kept', async () => {
    const d = device([kept('a', 100)], [], { keep: async () => false });
    const reader = createOfflineReader(ACCOUNT, d.deps);
    await reader.start();
    await reader.start();
    expect(d.log.reads).toEqual(['a']);
  });

  it('waits longer after each failure, then reads again, and resets the wait after a success', async () => {
    const d = device([kept('a', 100), kept('b', 200)], ['quota', 'quota']);
    const reader = createOfflineReader(ACCOUNT, d.deps);
    await reader.start();
    expect(d.log.reads).toEqual(['a', 'a', 'a', 'b']);
    expect(d.log.sleeps).toEqual([60_000, 120_000, GAP_MS, GAP_MS]);
    expect(d.log.kept).toEqual(['a', 'b']);
  });

  it(`gives up on a photo after ${MAX_TRIES} failed tries, and goes on with the next one`, async () => {
    const d = device([kept('a', 100), kept('b', 200)], ['unavailable', 'network', 'internal']);
    const reader = createOfflineReader(ACCOUNT, d.deps);
    await reader.start();
    expect(d.log.reads).toEqual(['a', 'a', 'a', 'b']);
    expect(d.log.kept).toEqual(['b']);
    expect(d.store.get('a')?.status).toBe('offline');
  });

  it('leaves a photo it cannot read for the user (no backoff) and reads the next', async () => {
    const d = device([kept('a', 100), kept('b', 200)], ['bad_input']);
    const reader = createOfflineReader(ACCOUNT, d.deps);
    await reader.start();
    expect(d.log.reads).toEqual(['a', 'b']);
    expect(d.log.sleeps).toEqual([GAP_MS, GAP_MS]);
  });

  it('stops for good when the Google sign-in has ended, without sending anyone to sign in', async () => {
    const d = device([kept('a', 100), kept('b', 200)], ['session']);
    const reader = createOfflineReader(ACCOUNT, d.deps);
    await reader.start();
    expect(reader.snapshot()).toEqual({ reading: null, sessionEnded: true });
    await reader.start();
    await reader.reconnected();
    expect(d.log.reads).toEqual(['a']);
  });

  it("doesn't start offline, and a wait ends the run once the phone goes offline", async () => {
    const d = device([kept('a', 100)], ['network']);
    d.goOffline();
    const reader = createOfflineReader(ACCOUNT, d.deps);
    await reader.start();
    expect(d.log.reads).toEqual([]);
    d.goOnline();
    d.deps.sleep = async () => d.goOffline();
    await reader.start();
    expect(d.log.reads).toEqual(['a']);
  });

  it('cuts a wait for the connection short when the phone is back online, but not a wait for a busy service', async () => {
    const d = device([kept('a', 100), kept('b', 200)], ['network', 'quota']);
    const reader = createOfflineReader(ACCOUNT, d.deps);
    // The phone goes offline during the first wait.
    d.deps.sleep = async () => d.goOffline();
    await reader.start();
    expect(d.log.reads).toEqual(['a']);
    d.goOnline();
    const sleeps: number[] = [];
    d.deps.sleep = async (ms) => {
      sleeps.push(ms);
      d.goOffline();
    };
    await reader.reconnected();
    // Read again at once; the busy service's wait is kept.
    expect(d.log.reads).toEqual(['a', 'a']);
    expect(sleeps).toEqual([120_000]);
    d.goOnline();
    sleeps.length = 0;
    await reader.reconnected();
    expect(d.log.reads).toEqual(['a', 'a']);
    expect(sleeps).toHaveLength(1);
    expect(sleeps[0]).toBeLessThanOrEqual(120_000);
  });

  it('stopping cancels the reading in flight and keeps nothing from it', async () => {
    let release!: () => void;
    const d = device([kept('a', 100)]);
    const reader = createOfflineReader(ACCOUNT, {
      ...d.deps,
      read: (_scan, signal) => new Promise((resolve, reject) => {
        release = () => resolve(reading);
        signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
      }),
    });
    const run = reader.start();
    await settle();
    expect(reader.snapshot().reading).toBe('a');
    reader.stop();
    release();
    await run;
    expect(d.log.kept).toEqual([]);
    expect(reader.snapshot().reading).toBeNull();
  });

  it('reads nothing while another tab holds the reader lock', async () => {
    let grant!: () => void;
    const d = device([kept('a', 100)]);
    const reader = createOfflineReader(ACCOUNT, {
      ...d.deps,
      lock: async (signal, work) => {
        await new Promise<void>(resolve => { grant = resolve; });
        if (!signal.aborted) await work();
      },
    });
    const run = reader.start();
    await settle();
    expect(d.log.reads).toEqual([]);
    grant();
    await run;
    expect(d.log.reads).toEqual(['a']);
  });

  it('ends for good on sign-out', async () => {
    const d = device([kept('a', 100)]);
    const reader = createOfflineReader(ACCOUNT, d.deps);
    reader.end();
    await reader.start();
    expect(d.log.reads).toEqual([]);
  });

  it("reports each reading's outcome for telemetry", async () => {
    const outcomes: (string | null)[] = [];
    const d = device([kept('a', 100)], ['rate_limited']);
    const reader = createOfflineReader(ACCOUNT, { ...d.deps, onRead: (scan, code) => outcomes.push(code) });
    await reader.start();
    expect(outcomes).toEqual(['rate_limited', null]);
  });
});
