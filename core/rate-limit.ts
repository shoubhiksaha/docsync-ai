// The fetch-only build: no Node APIs, so it is safe in Edge middleware and in Node routes.
import { Redis } from '@upstash/redis/cloudflare';

/**
 * Fixed-window rate limiting, applied to every API route by middleware.ts.
 * Uses Upstash Redis when configured (shared across instances); otherwise an in-memory map
 * per instance (resets on cold starts — a best-effort fallback). Edge-runtime compatible.
 */

export type RateGroup = 'ai' | 'write' | 'telemetry' | 'default';

const WINDOW_MS = 10 * 60 * 1000;

/** Requests per window for one signed-in client IP. Signed-out requests never reach a limited route. */
const LIMITS: Record<RateGroup, number> = { ai: 30, write: 60, telemetry: 120, default: 240 };

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

/** Increments `key` and returns whether the caller is still within `limit` for the window. */
export async function consume(key: string, limit: number, windowMs = WINDOW_MS, now = Date.now()): Promise<boolean> {
  if (limit <= 0) return false;

  const client = redis();
  if (client) {
    try {
      const count = await client.incr(key);
      if (count === 1) await client.pexpire(key, windowMs);
      return count <= limit;
    } catch (err) {
      console.warn('Redis rate limit error, falling back to memory:', err);
    }
  }

  const record = memory.get(key);
  if (!record || record.resetTime < now) {
    memory.set(key, { count: 1, resetTime: now + windowMs });
    return true;
  }
  if (record.count >= limit) return false;
  record.count += 1;
  return true;
}

export async function checkRateLimit(headers: Headers, pathname: string): Promise<boolean> {
  const group = rateGroupFor(pathname);
  const ip = clientIp(headers);
  return consume(`ratelimit:${group}:${ip}`, limitFor(group));
}
