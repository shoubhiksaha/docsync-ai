import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getToken } from 'next-auth/jwt';
import { viaTrustedProxy } from '@/core/proxy';
import { checkRateLimit } from '@/core/rate-limit';
import { safeCallbackUrl } from '@/app/login/callback-url';

/** API routes reachable without a session. */
const PUBLIC_API = ['/api/health', '/api/auth/'];

/** Pages anyone can read, signed in or not. */
const PUBLIC_PAGES = ['/privacy'];

function isPublicApi(pathname: string): boolean {
  return PUBLIC_API.some(p => (p.endsWith('/') ? pathname.startsWith(p) : pathname === p));
}

export async function middleware(request: NextRequest) {
  // On Cloud Run, only requests forwarded by the Cloudflare Worker are served (core/proxy.ts).
  if (!viaTrustedProxy(request.headers)) return new NextResponse('Not found', { status: 404 });

  const { pathname } = request.nextUrl;
  const isApi = pathname.startsWith('/api/');

  // NextAuth's own endpoints (session polling etc.), the health check and public pages skip everything below.
  if (isApi && isPublicApi(pathname)) return NextResponse.next();
  if (PUBLIC_PAGES.includes(pathname)) return NextResponse.next();

  const session = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET }).catch(() => null);

  if (pathname.startsWith('/login')) {
    if (!session) return NextResponse.next();
    const next = safeCallbackUrl(request.nextUrl.searchParams.get('callbackUrl'));
    return NextResponse.redirect(new URL(next, request.url));
  }

  if (!session) {
    if (isApi) return NextResponse.json({ error: 'Unauthorized. Please sign in.' }, { status: 401 });
    // Remember the page they asked for (a shared /scan link, a home-screen shortcut) for after sign-in.
    const login = new URL('/login', request.url);
    const wanted = safeCallbackUrl(`${pathname}${request.nextUrl.search}`);
    if (wanted !== '/') login.searchParams.set('callbackUrl', wanted);
    return NextResponse.redirect(login);
  }

  if (isApi && !(await checkRateLimit(request.headers, pathname))) {
    return NextResponse.json({ error: 'Too many requests. Please try again later.' }, { status: 429 });
  }

  return NextResponse.next();
}

export const config = {
  // Skip Next internals and static files (anything with a file extension, e.g. /icon.svg, /sw.js).
  matcher: ['/((?!_next/static|_next/image|.*\\.[a-zA-Z0-9]+$).*)'],
};
