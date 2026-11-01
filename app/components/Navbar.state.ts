/**
 * Whether the header shows the signed-out view (no Home/Settings/Sign out). Kept apart from the
 * component so it can be unit-tested.
 */

/** Pages anyone can open (middleware.ts PUBLIC_PAGES); every other page except /login needs a session. */
const PUBLIC_PAGES = ['/privacy'];

type Status = 'authenticated' | 'unauthenticated' | 'loading';

/**
 * Middleware already guarantees a session on every other page, so `status` is only trusted on public
 * pages: next-auth reports a failed session check (offline, weak network) as 'unauthenticated', and
 * the header must not vanish then. `signedIn` is the request's session-cookie hint for the first paint.
 */
export function showSignedOutHeader(pathname: string, status: Status, signedIn: boolean): boolean {
  if (pathname === '/login') return true;
  if (!PUBLIC_PAGES.includes(pathname)) return false;
  return status === 'unauthenticated' || (status === 'loading' && !signedIn);
}
