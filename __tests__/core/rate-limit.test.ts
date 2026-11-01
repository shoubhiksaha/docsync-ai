const exec = jest.fn();
const pexpire = jest.fn();
const pttl = jest.fn();
const transaction = { incr: jest.fn(), pexpire: jest.fn(), exec };
transaction.incr.mockReturnValue(transaction);
transaction.pexpire.mockReturnValue(transaction);
jest.mock('@upstash/redis/cloudflare', () => ({ Redis: jest.fn().mockImplementation(() => ({ multi: () => transaction, pexpire, pttl })) }));

import { checkRateLimit, clientIp, consume, IP_CEILING_FACTOR, limitFor, memoryKeyCount, rateGroupFor, resetRateLimits } from '@/core/rate-limit';

describe('core/rate-limit', () => {
  const saved = { ...process.env };
  beforeEach(() => {
    process.env = { ...saved };
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    resetRateLimits();
    exec.mockReset();
    pexpire.mockReset();
    pttl.mockReset();
    transaction.pexpire.mockClear();
  });
  afterAll(() => { process.env = saved; });

  it('groups routes', () => {
    expect(rateGroupFor('/api/extract-freeform')).toBe('ai');
    expect(rateGroupFor('/api/transcribe')).toBe('ai');
    expect(rateGroupFor('/api/sync')).toBe('write');
    expect(rateGroupFor('/api/telemetry')).toBe('telemetry');
    expect(rateGroupFor('/api/settings')).toBe('default');
    expect(limitFor('ai')).toBeLessThan(limitFor('default'));
  });

  it('reads the client IP from proxy headers', () => {
    expect(clientIp(new Headers({ 'x-real-ip': '1.1.1.1' }))).toBe('1.1.1.1');
    expect(clientIp(new Headers({ 'x-forwarded-for': '2.2.2.2, 10.0.0.1' }))).toBe('2.2.2.2');
    expect(clientIp(new Headers())).toBe('unknown');
  });

  it('allows up to the limit in memory, then blocks, then resets', async () => {
    const now = 1_000;
    expect(await consume('k', 2, 100, now)).toBe(true);
    expect(await consume('k', 2, 100, now)).toBe(true);
    expect(await consume('k', 2, 100, now)).toBe(false);
    expect(await consume('k', 2, 100, now + 101)).toBe(true);
  });

  it('a zero limit always blocks', async () => {
    expect(await consume('z', 0)).toBe(false);
  });

  it('applies limits per route group and client IP when there is no account', async () => {
    const headers = new Headers({ 'x-real-ip': '9.9.9.9' });
    for (let i = 0; i < limitFor('ai'); i++) {
      expect((await checkRateLimit(headers, '/api/extract-freeform')).allowed).toBe(true);
    }
    const blocked = await checkRateLimit(headers, '/api/extract-freeform');
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterMs).toBeGreaterThan(0);
    expect(blocked.retryAfterMs).toBeLessThanOrEqual(10 * 60 * 1000);
    // other groups and clients are unaffected
    expect((await checkRateLimit(headers, '/api/settings')).allowed).toBe(true);
    expect((await checkRateLimit(new Headers({ 'x-real-ip': '8.8.8.8' }), '/api/extract-freeform')).allowed).toBe(true);
  });

  it('accounts sharing one IP (shop Wi-Fi, carrier NAT) each get their own limit, under an IP ceiling', async () => {
    const shop = new Headers({ 'x-real-ip': '7.7.7.7' });
    for (let i = 0; i < limitFor('ai'); i++) expect((await checkRateLimit(shop, '/api/extract-freeform', 'staff-1')).allowed).toBe(true);
    expect((await checkRateLimit(shop, '/api/extract-freeform', 'staff-1')).allowed).toBe(false);
    expect((await checkRateLimit(shop, '/api/extract-freeform', 'staff-2')).allowed).toBe(true);

    let allowed = 0;
    for (let n = 0; n < IP_CEILING_FACTOR * 2; n++) {
      for (let i = 0; i < limitFor('ai'); i++) if ((await checkRateLimit(shop, '/api/extract-freeform', `bulk-${n}`)).allowed) allowed++;
    }
    expect(allowed).toBeLessThan(limitFor('ai') * IP_CEILING_FACTOR);
  });

  it('uses Redis when configured and falls back to memory on Redis errors', async () => {
    process.env.UPSTASH_REDIS_REST_URL = 'https://redis.example';
    process.env.UPSTASH_REDIS_REST_TOKEN = 'token';
    exec.mockResolvedValueOnce([1, 1]).mockResolvedValueOnce([5, 0]);
    pttl.mockResolvedValueOnce(120_000);
    expect(await consume('r', 4)).toBe(true);
    // The count and its expiry go in one transaction, and the expiry is only set when the key has none.
    expect(transaction.pexpire).toHaveBeenCalledWith('r', expect.any(Number), 'NX');
    expect(await consume('r', 4)).toBe(false);
    expect(pexpire).not.toHaveBeenCalled();

    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    exec.mockRejectedValueOnce(new Error('redis down'));
    expect(await consume('r2', 4)).toBe(true);
  });

  it('gives a Redis key found without an expiry its window back, so an account is never blocked for good', async () => {
    process.env.UPSTASH_REDIS_REST_URL = 'https://redis.example';
    process.env.UPSTASH_REDIS_REST_TOKEN = 'token';
    exec.mockResolvedValueOnce([99, 0]);
    pttl.mockResolvedValueOnce(-1);
    const blocked = await checkRateLimit(new Headers({ 'x-real-ip': '3.3.3.3' }), '/api/extract-freeform');
    expect(blocked).toEqual({ allowed: false, retryAfterMs: 10 * 60 * 1000 });
    expect(pexpire).toHaveBeenCalledWith('ratelimit:ai:3.3.3.3', 10 * 60 * 1000);
  });

  it('sweeps expired windows out of the in-memory fallback', async () => {
    for (let i = 0; i < 10_000; i++) await consume(`old-${i}`, 5, 100, 1_000);
    // All of those windows have ended; the next new key clears them out instead of growing the map.
    expect(memoryKeyCount()).toBe(10_000);
    expect(await consume('fresh', 5, 100, 2_000)).toBe(true);
    expect(memoryKeyCount()).toBe(1);
    expect(await consume('fresh', 1, 100, 2_000)).toBe(false);
  });

  it('caps the in-memory fallback even when every window is still open', async () => {
    for (let i = 0; i < 10_001; i++) await consume(`live-${i}`, 5, 60_000, 1_000);
    expect(memoryKeyCount()).toBeLessThanOrEqual(10_000);
  });
});
