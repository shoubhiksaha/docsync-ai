// The fetch-only build: no Node APIs, so it is safe in Edge middleware and in Node routes.
import { Redis } from '@upstash/redis/cloudflare';

/**
 * Fixed-window rate limiting, applied to every API route by middleware.ts.
 * Uses Upstash Redis when configured (shared across instances); otherwise an in-memory map
 * per instance (resets on cold starts — a best-effort fallback). Edge-runtime compatible.
 *
 * Limits are per signed-in account: several staff phones on one shop Wi-Fi, or users behind a
 * mobile carrier's shared IP, don't use up each other's scans. A much higher per-IP ceiling
 * remains as abuse protection.
 */

export type RateGroup = 'ai' | 'voice' | 'write' | 'telemetry' | 'default';

const WINDOW_MS = 10 * 60 * 1000;

/**
 * Requests per window for one signed-in account. Signed-out requests never reach a limited route.
 * Voice notes have their own allowance: a dairy or kirana recording one per slip would otherwise
 * use up the document reads halfway through the morning collection.
 */
const LIMITS: Record<RateGroup, number> = { ai: 30, voice: 60, write: 60, telemetry: 120, default: 240 };
/** One IP may carry this many accounts' worth of requests (a shop's staff, a carrier NAT). */
export const IP_CEILING_FACTOR = 10;

export function rateGroupFor(pathname: string): RateGroup {
  if (pathname === '/api/extract-freeform') return 'ai';
  if (pathname === '/api/transcribe') return 'voice';
  if (pathname === '/api/sync') return 'write';
  if (pathname === '/api/telemetry') return 'telemetry';
  return 'default';
}

export function limitFor(group: RateGroup): number {
  return LIMITS[group];
}

/**
 * The caller's IP: x-real-ip, set by the platform or, on Cloud Run, by the Cloudflare Worker
 * (middleware.ts refuses requests that didn't come through it; see core/proxy.ts).
 */
export function clientIp(headers: Headers): string {
  return headers.get('x-real-ip')?.trim()
    || headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    || 'unknown';
}

let redisClient: Redis | null | undefined;
function redis(): Redis | null {
  if (redisClient === undefined) {
    const url = process.env.UPSTASH_REDIS_REST_URL;
    const token = process.env.UPSTASH_REDIS_REST_TOKEN;
    redisClient = url && token ? new Redis({ url, token }) : null;
  }
  return redisClient;
}

const memory = new Map<string, { count: number; resetTime: number }>();
/** The fallback map is swept at this size: a long-lived instance sees a key for every account and IP. */
const MEMORY_MAX_KEYS = 10_000;

/** Drops expired windows; if that isn't enough, the oldest ones, down to 90% (best effort, like the map itself). */
function sweepMemory(now: number): void {
  for (const [key, record] of memory) if (record.resetTime < now) memory.delete(key);
  for (const key of memory.keys()) {
    if (memory.size <= MEMORY_MAX_KEYS * 0.9) break;
    memory.delete(key);
  }
}

/** Test helper. */
export function resetRateLimits(): void {
  memory.clear();
  redisClient = undefined;
}

/** Test helper: windows held in the in-memory fallback. */
export function memoryKeyCount(): number {
  return memory.size;
}

export interface RateDecision {
  allowed: boolean;
  /** When blocked: milliseconds until the window resets (for a Retry-After header). */
  retryAfterMs: number;
}

/** Increments `key` and reports whether the caller is still within `limit`, and if not, for how long. */
async function hit(key: string, limit: number, windowMs: number, now: number): Promise<RateDecision> {
  if (limit <= 0) return { allowed: false, retryAfterMs: windowMs };

  const client = redis();
  if (client) {
    let count: number | undefined;
    try {
      // One transaction, so a key is never left counting without an expiry (which would block its
      // account for good). NX sets the window's expiry only when the key has none, which also
      // mends a key an older version left without one.
      [count] = await client.multi().incr(key).pexpire(key, windowMs, 'NX').exec<[number, 0 | 1]>();
    } catch (err) {
      console.warn('Redis rate limit error, falling back to memory:', err);
    }
    if (count !== undefined) {
      if (count <= limit) return { allowed: true, retryAfterMs: 0 };
      let ttl = windowMs;
      try {
        ttl = await client.pttl(key);
        // No expiry after all: give it one now rather than block this caller forever.
        if (ttl === -1) await client.pexpire(key, windowMs);
      } catch {
        // unknown: assume a full window
      }
      return { allowed: false, retryAfterMs: typeof ttl === 'number' && ttl > 0 ? ttl : windowMs };
    }
  }

  const record = memory.get(key);
  if (!record || record.resetTime < now) {
    if (!record && memory.size >= MEMORY_MAX_KEYS) sweepMemory(now);
    memory.set(key, { count: 1, resetTime: now + windowMs });
    return { allowed: true, retryAfterMs: 0 };
  }
  if (record.count >= limit) return { allowed: false, retryAfterMs: Math.max(0, record.resetTime - now) };
  record.count += 1;
  return { allowed: true, retryAfterMs: 0 };
}

/** Increments `key` and returns whether the caller is still within `limit` for the window. */
export async function consume(key: string, limit: number, windowMs = WINDOW_MS, now = Date.now()): Promise<boolean> {
  return (await hit(key, limit, windowMs, now)).allowed;
}

/**
 * `account` is an opaque id of the signed-in user (core/device-owner accountId). Without one,
 * the IP gets a single account's limit, as before.
 */
export async function checkRateLimit(headers: Headers, pathname: string, account?: string | null): Promise<RateDecision> {
  const group = rateGroupFor(pathname);
  const ip = clientIp(headers);
  const now = Date.now();
  if (!account) return hit(`ratelimit:${group}:${ip}`, limitFor(group), WINDOW_MS, now);
  const own = await hit(`ratelimit:${group}:user:${account}`, limitFor(group), WINDOW_MS, now);
  if (!own.allowed) return own;
  return hit(`ratelimit:${group}:ip:${ip}`, limitFor(group) * IP_CEILING_FACTOR, WINDOW_MS, now);
}

/** Takes one request back off `key`'s current window, if it has one. Best effort. */
async function unhit(key: string, now: number): Promise<void> {
  const client = redis();
  if (client) {
    try {
      // Only a window that is still open: an expired one has nothing to give back. (Should it
      // expire in between, the next hit's NX expiry still gives the key a window.)
      if ((await client.pttl(key)) > 0) await client.decr(key);
      return;
    } catch (err) {
      console.warn('Redis rate limit refund failed:', err);
    }
  }
  const record = memory.get(key);
  if (record && record.resetTime >= now && record.count > 0) record.count -= 1;
}

/**
 * Gives back the request checkRateLimit counted, for one that failed through no fault of the
 * caller (every AI provider busy or down, an internal error): retrying after a short outage must
 * not use up a dairy's reads for the next ten minutes. A photo that couldn't be read still counts.
 */
export async function refundRateLimit(headers: Headers, pathname: string, account?: string | null): Promise<void> {
  const group = rateGroupFor(pathname);
  const ip = clientIp(headers);
  const now = Date.now();
  if (!account) return unhit(`ratelimit:${group}:${ip}`, now);
  await unhit(`ratelimit:${group}:user:${account}`, now);
  await unhit(`ratelimit:${group}:ip:${ip}`, now);
}
