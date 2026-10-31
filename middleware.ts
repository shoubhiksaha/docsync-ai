import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getToken } from 'next-auth/jwt';
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

  if (pathname.startsWith('/login')) {
    return session ? NextResponse.redirect(new URL('/', request.url)) : NextResponse.next();
  }

  if (!session) {
    if (isApi) return NextResponse.json({ error: 'Unauthorized. Please sign in.' }, { status: 401 });
    return NextResponse.redirect(new URL('/login', request.url));
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
