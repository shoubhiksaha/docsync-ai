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

export type RateGroup = 'ai' | 'write' | 'telemetry' | 'default';

const WINDOW_MS = 10 * 60 * 1000;

/** Requests per window for one signed-in account. Signed-out requests never reach a limited route. */
const LIMITS: Record<RateGroup, number> = { ai: 30, write: 60, telemetry: 120, default: 240 };
/** One IP may carry this many accounts' worth of requests (a shop's staff, a carrier NAT). */
export const IP_CEILING_FACTOR = 10;

export function rateGroupFor(pathname: string): RateGroup {
  if (pathname === '/api/extract-freeform' || pathname === '/api/transcribe') return 'ai';
  if (pathname === '/api/sync' || pathname === '/api/sheets/create') return 'write';
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

/** Test helper. */
export function resetRateLimits(): void {
  memory.clear();
  redisClient = undefined;
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
      count = await client.incr(key);
      if (count === 1) await client.pexpire(key, windowMs);
    } catch (err) {
      console.warn('Redis rate limit error, falling back to memory:', err);
    }
    if (count !== undefined) {
      if (count <= limit) return { allowed: true, retryAfterMs: 0 };
      let ttl = windowMs;
      try {
        ttl = await client.pttl(key);
      } catch {
        // unknown: assume a full window
      }
      return { allowed: false, retryAfterMs: typeof ttl === 'number' && ttl > 0 ? ttl : windowMs };
    }
  }

  const record = memory.get(key);
  if (!record || record.resetTime < now) {
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
