const getToken = jest.fn();
jest.mock('next-auth/jwt', () => ({ getToken: (...a: unknown[]) => getToken(...a) }));

import { NextRequest } from 'next/server';
import { middleware } from '@/middleware';
import { resetRateLimits, limitFor } from '@/core/rate-limit';

const SECRET = 'mw-secret';

function request(path: string, cookie?: string, ip = '5.5.5.5') {
  const headers: Record<string, string> = { 'x-real-ip': ip };
  if (cookie) headers.cookie = cookie;
  return new NextRequest(`http://localhost${path}`, { headers });
}

describe('middleware', () => {
  const saved = { ...process.env };
  beforeEach(() => {
    process.env = { ...saved, NEXTAUTH_SECRET: SECRET };
    getToken.mockReset().mockResolvedValue(null);
    resetRateLimits();
  });
  afterAll(() => { process.env = saved; });

  it('lets health and auth endpoints through without a session', async () => {
    expect((await middleware(request('/api/health'))).status).toBe(200);
    expect((await middleware(request('/api/auth/session'))).status).toBe(200);
  });

  it('rejects anonymous API calls and redirects anonymous pages to /login', async () => {
    expect((await middleware(request('/api/settings'))).status).toBe(401);
    const page = await middleware(request('/'));
    expect(page.status).toBe(307);
    expect(page.headers.get('location')).toBe('http://localhost/login');
  });

  it('with PROXY_SECRET set, serves only requests forwarded by the Cloudflare Worker', async () => {
    process.env.PROXY_SECRET = 'proxy-secret';
    const direct = await middleware(request('/api/health'));
    expect(direct.status).toBe(404);
    const forged = new NextRequest('http://localhost/login', { headers: { 'x-proxy-secret': 'proxy-secreT' } });
    expect((await middleware(forged)).status).toBe(404);
    const viaWorker = new NextRequest('http://localhost/api/health', { headers: { 'x-proxy-secret': 'proxy-secret' } });
    expect((await middleware(viaWorker)).status).toBe(200);
  });

  it('ignores cookies left over from the removed demo mode', async () => {
    expect((await middleware(request('/api/settings', 'docsync_guest=true'))).status).toBe(401);
    expect((await middleware(request('/api/settings', 'docsync_guest=v1.9999999999.nonce.signature'))).status).toBe(401);
  });

  it('accepts a verified NextAuth session and sends signed-in users away from /login', async () => {
    getToken.mockResolvedValue({ email: 'u@x.com' });
    expect((await middleware(request('/api/settings'))).status).toBe(200);
    const login = await middleware(request('/login'));
    expect(login.headers.get('location')).toBe('http://localhost/');
  });

  it('rate-limits AI calls per signed-in client', async () => {
    getToken.mockResolvedValue({ email: 'u@x.com' });
    for (let i = 0; i < limitFor('ai'); i++) {
      expect((await middleware(request('/api/extract-freeform'))).status).toBe(200);
    }
    expect((await middleware(request('/api/extract-freeform'))).status).toBe(429);
    expect((await middleware(request('/api/extract-freeform', undefined, '6.6.6.6'))).status).toBe(200);
  });
});
