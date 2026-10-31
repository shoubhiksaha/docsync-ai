import { isModuleEnabled, type ModuleName } from './env';

/**
 * Fault isolation for module calls.
 *
 * runIsolated() never throws. It returns an Outcome describing what happened, so a caller that
 * talks to several modules (e.g. sync → Sheets + Notion + Drive) can finish the healthy ones
 * and report the broken one instead of failing the whole request.
 *
 * Each call is bounded by a timeout and guarded by a per-key circuit breaker: after
 * BREAKER_THRESHOLD consecutive failures the key is skipped for BREAKER_COOLDOWN_MS, so a
 * provider that is down stops adding latency to every request. Breaker state is per
 * serverless instance, which is enough to shed load from a failing dependency.
 */

export type Outcome<T> =
  | { status: 'ok'; value: T; ms: number }
  | { status: 'skipped'; reason: string; code?: SkipCode }
  | { status: 'failed'; error: string; ms: number };

/** Machine-readable reason for a skip, so the UI can explain it without parsing text. */
export type SkipCode = 'disabled' | 'paused' | 'not_connected' | 'not_selected' | 'nothing_to_store' | 'not_retried' | 'duplicate';

export class ModuleSkip extends Error {
  constructor(public readonly reason: string, public readonly code?: SkipCode) {
    super(reason);
    this.name = 'ModuleSkip';
  }
}

export const BREAKER_THRESHOLD = 3;
export const BREAKER_COOLDOWN_MS = 60_000;

type BreakerState = { failures: number; openUntil: number };
const breakers = new Map<string, BreakerState>();

export function circuitState(key: string, now = Date.now()): 'closed' | 'open' {
  const state = breakers.get(key);
  return state && state.openUntil > now ? 'open' : 'closed';
}

export function recordSuccess(key: string): void {
  breakers.delete(key);
}

export function recordFailure(key: string, now = Date.now()): void {
  const state = breakers.get(key) ?? { failures: 0, openUntil: 0 };
  state.failures += 1;
  if (state.failures >= BREAKER_THRESHOLD) {
    state.openUntil = now + BREAKER_COOLDOWN_MS;
    state.failures = 0;
  }
  breakers.set(key, state);
}

/** When an open circuit closes again (0 when it is closed). */
export function pausedUntil(key: string, now = Date.now()): number {
  const until = breakers.get(key)?.openUntil ?? 0;
  return until > now ? until : 0;
}

/**
 * Pauses a key until `until` without counting a failure: for a dependency that said it is
 * rate-limited and named a time (Retry-After), so it is skipped exactly that long, not a minute.
 */
export function pauseCircuit(key: string, until: number): void {
  const state = breakers.get(key) ?? { failures: 0, openUntil: 0 };
  state.openUntil = Math.max(state.openUntil, until);
  breakers.set(key, state);
}

/** Test helper. */
export function resetBreakers(): void {
  breakers.clear();
}

export class TimeoutError extends Error {
  constructor(label: string, ms: number) {
    super(`${label} timed out after ${ms}ms`);
    this.name = 'TimeoutError';
  }
}

export async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new TimeoutError(label, ms)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export interface IsolationOptions {
  /** Module whose kill switch (MODULE_<NAME>) gates this call. */
  module: ModuleName;
  /** Circuit-breaker key; defaults to the module name. */
  breakerKey?: string;
  timeoutMs: number;
}

export async function runIsolated<T>(fn: () => Promise<T>, opts: IsolationOptions): Promise<Outcome<T>> {
  const key = opts.breakerKey ?? opts.module;

  if (!isModuleEnabled(opts.module)) {
    return { status: 'skipped', reason: `${opts.module} is disabled (MODULE_${opts.module.toUpperCase()}=off)`, code: 'disabled' };
  }
  if (circuitState(key) === 'open') {
    return { status: 'skipped', reason: `${key} is temporarily paused after repeated failures`, code: 'paused' };
  }

  const started = Date.now();
  try {
    const value = await withTimeout(fn(), opts.timeoutMs, key);
    recordSuccess(key);
    return { status: 'ok', value, ms: Date.now() - started };
  } catch (err) {
    if (err instanceof ModuleSkip) {
      return { status: 'skipped', reason: err.reason, ...(err.code ? { code: err.code } : {}) };
    }
    recordFailure(key);
    const error = err instanceof Error ? err.message : String(err);
    console.error(`[${key}] failed:`, error);
    return { status: 'failed', error, ms: Date.now() - started };
  }
}
