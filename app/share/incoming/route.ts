import { NextResponse, type NextRequest } from 'next/server';
import { SHARE_MISSED, SHARE_PAGE } from '@/client/shared-files';

/**
 * The share target (manifest share_target) when no service worker took the share: the first share
 * after installing, before the worker is ready, or a browser that runs none. The files are never
 * read or kept here, so photos only ever leave the phone through a scan. /share asks to share again;
 * by then the page has installed the worker. Open without a session (middleware.ts): /share signs in.
 */
function shareAgain(request: NextRequest) {
  return NextResponse.redirect(new URL(`${SHARE_PAGE}?${SHARE_MISSED}=1`, request.url), 303);
}

export { shareAgain as GET, shareAgain as POST };
