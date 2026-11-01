import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getToken } from 'next-auth/jwt';
import { accountId, isAccountCookie, OWNER_COOKIE, ownerCookieOptions } from '@/core/device-owner';
import { viaTrustedProxy } from '@/core/proxy';
import { checkRateLimit } from '@/core/rate-limit';

/** API routes reachable without a session. */
const PUBLIC_API = ['/api/health', '/api/auth/'];

function isPublicApi(pathname: string): boolean {
  return PUBLIC_API.some(p => (p.endsWith('/') ? pathname.startsWith(p) : pathname === p));
}

export async function middleware(request: NextRequest) {
  // On Cloud Run, only requests forwarded by the Cloudflare Worker are served (core/proxy.ts).
  if (!viaTrustedProxy(request.headers)) return new NextResponse('Not found', { status: 404 });

  const { pathname } = request.nextUrl;
  const isApi = pathname.startsWith('/api/');

  // NextAuth's own endpoints (session polling etc.) and the health check skip everything below.
  if (isApi && isPublicApi(pathname)) return NextResponse.next();

  const session = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET }).catch(() => null);

  if (!session) {
    if (pathname.startsWith('/login')) return NextResponse.next();
    if (isApi) return NextResponse.json({ error: 'Unauthorized. Please sign in.' }, { status: 401 });
    return NextResponse.redirect(new URL('/login', request.url));
  }

  // A different account signed in on this device: the previous account's key, Notion connection
  // and remembered sheet are dropped, for this request and in the browser (core/device-owner.ts).
  const account = await accountId(session);
  const previousOwner = request.cookies.get(OWNER_COOKIE)?.value;
  const stale = account && previousOwner && previousOwner !== account
    ? request.cookies.getAll().map(c => c.name).filter(isAccountCookie)
    : [];
  stale.forEach(name => request.cookies.delete(name));
  const finish = (response: NextResponse) => {
    if (account && previousOwner !== account) {
      stale.forEach(name => response.cookies.delete(name));
      response.cookies.set(OWNER_COOKIE, account, ownerCookieOptions());
    }
    return response;
  };

  if (pathname.startsWith('/login')) return finish(NextResponse.redirect(new URL('/', request.url)));

  if (isApi) {
    const limit = await checkRateLimit(request.headers, pathname, account);
    if (!limit.allowed) {
      const retryAfterSeconds = Math.max(1, Math.ceil(limit.retryAfterMs / 1000));
      return finish(NextResponse.json(
        { error: 'Too many requests. Please try again later.', code: 'rate_limited', retryAfterSeconds },
        { status: 429, headers: { 'Retry-After': String(retryAfterSeconds) } },
      ));
    }
  }

  return finish(stale.length ? NextResponse.next({ request: { headers: request.headers } }) : NextResponse.next());
}

export const config = {
  // Skip Next internals and static files (anything with a file extension, e.g. /icon.svg, /sw.js).
  matcher: ['/((?!_next/static|_next/image|.*\\.[a-zA-Z0-9]+$).*)'],
};
