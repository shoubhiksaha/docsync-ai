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
 *
 * Only failures that say something about the dependency count: one user's expired session,
 * deleted sheet or revoked token (a CallerError, or a 4xx other than 408/429) is reported as
 * failed but never pauses the module for everyone else.
 */

export type Outcome<T> =
  | { status: 'ok'; value: T; ms: number }
  | { status: 'skipped'; reason: string; code?: SkipCode }
  | { status: 'failed'; error: string; ms: number; code?: SkipCode };

/** Machine-readable reason for a skip, so the UI can explain it without parsing text. */
export type SkipCode = 'disabled' | 'paused' | 'not_connected' | 'not_selected' | 'nothing_to_store' | 'not_retried' | 'duplicate';

export class ModuleSkip extends Error {
  constructor(public readonly reason: string, public readonly code?: SkipCode) {
    super(reason);
    this.name = 'ModuleSkip';
  }
}

/** A failure caused by the caller's own account or data, not by the dependency being down. */
export class CallerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CallerError';
  }
}

/** HTTP status carried by a Google (gaxios) or Notion client error, if any. */
export function errorStatus(err: unknown): number | undefined {
  if (!err || typeof err !== 'object') return undefined;
  const e = err as { status?: unknown; code?: unknown; response?: { status?: unknown } };
  for (const candidate of [e.response?.status, e.status, e.code]) {
    const n = typeof candidate === 'string' && /^\d{3}$/.test(candidate) ? Number(candidate) : candidate;
    if (typeof n === 'number' && n >= 100 && n < 600) return n;
  }
  return undefined;
}

/** True when a failure is about this caller (bad token, missing file), so it must not trip a shared breaker. */
export function isCallerError(err: unknown): boolean {
  if (err instanceof CallerError) return true;
  const status = errorStatus(err);
  return status !== undefined && status >= 400 && status < 500 && status !== 408 && status !== 429;
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

/** Races `promise` against `ms`; `onTimeout` runs when time is up (e.g. to abort the request). */
export async function withTimeout<T>(promise: Promise<T>, ms: number, label: string, onTimeout?: () => void): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          onTimeout?.();
          reject(new TimeoutError(label, ms));
        }, ms);
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

/**
 * `fn` receives a signal that aborts when the timeout fires, so a write that timed out is
 * cancelled instead of landing later (and being written again by the user's retry).
 */
export async function runIsolated<T>(fn: (signal: AbortSignal) => Promise<T>, opts: IsolationOptions): Promise<Outcome<T>> {
  const key = opts.breakerKey ?? opts.module;

  if (!isModuleEnabled(opts.module)) {
    return { status: 'skipped', reason: `${opts.module} is disabled (MODULE_${opts.module.toUpperCase()}=off)`, code: 'disabled' };
  }
  if (circuitState(key) === 'open') {
    return { status: 'skipped', reason: `${key} is temporarily paused after repeated failures`, code: 'paused' };
  }

  const started = Date.now();
  const controller = new AbortController();
  try {
    const value = await withTimeout(fn(controller.signal), opts.timeoutMs, key, () => controller.abort());
    recordSuccess(key);
    return { status: 'ok', value, ms: Date.now() - started };
  } catch (err) {
    if (err instanceof ModuleSkip) {
      return { status: 'skipped', reason: err.reason, ...(err.code ? { code: err.code } : {}) };
    }
    if (!isCallerError(err)) recordFailure(key);
    const error = err instanceof Error ? err.message : String(err);
    console.error(`[${key}] failed:`, error);
    return { status: 'failed', error, ms: Date.now() - started };
  }
}
