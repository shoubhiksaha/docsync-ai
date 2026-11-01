const incr = jest.fn();
const pexpire = jest.fn();
jest.mock('@upstash/redis/cloudflare', () => ({ Redis: jest.fn().mockImplementation(() => ({ incr, pexpire })) }));

import { checkRateLimit, clientIp, consume, IP_CEILING_FACTOR, limitFor, rateGroupFor, resetRateLimits } from '@/core/rate-limit';

describe('core/rate-limit', () => {
  const saved = { ...process.env };
  beforeEach(() => {
    process.env = { ...saved };
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    resetRateLimits();
    incr.mockReset();
    pexpire.mockReset();
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
    incr.mockResolvedValueOnce(1).mockResolvedValueOnce(5);
    expect(await consume('r', 4)).toBe(true);
    expect(pexpire).toHaveBeenCalledTimes(1);
    expect(await consume('r', 4)).toBe(false);

    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    incr.mockRejectedValueOnce(new Error('redis down'));
    expect(await consume('r2', 4)).toBe(true);
  });
});
