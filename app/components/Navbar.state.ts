/**
 * Whether the header shows the signed-out view (no Home/Settings/Sign out), and whether this
 * device's data belongs to the signed-in account. Kept apart from the component so it can be
 * unit-tested.
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

/**
 * What to do with this device's saved pages and preferences once `account` (an opaque id of the
 * signed-in account, or null when unknown) is signed in, given the account they were stamped with.
 * Another account's pages and preferences must never show for this one, also when that account's
 * session expired instead of being signed out ('clear'); its scans are kept and only hidden
 * (client/scan-store.ts byOwner). An unstamped device (first visit, or data from before the stamp)
 * is adopted, as core/device-owner.ts does for cookies.
 */
export function deviceOwnerAction(stamped: string | null, account: string | null): 'keep' | 'adopt' | 'clear' {
  if (!account || stamped === account) return 'keep';
  return stamped ? 'clear' : 'adopt';
}
