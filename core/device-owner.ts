/**
 * Ties this device's DocSync cookies to the Google account that set them.
 *
 * The saved AI key, Notion connection, upload choice, preferences and remembered sheet live in
 * docsync_* cookies on the device, not in the account. On a shared shop or family phone the next
 * person to sign in would otherwise inherit them: their rows would go to the previous user's
 * Notion and their scans would be billed to the previous user's key. middleware.ts stamps the
 * device with a hash of the signed-in account and, when a different account signs in, drops the
 * previous account's cookies before any route reads them.
 *
 * A device without a stamp (first visit, or cookies from before this check) is adopted by the
 * account that is signed in. Edge-runtime compatible (Web Crypto only).
 */

export const OWNER_COOKIE = 'docsync_owner';

/** Device preferences that are not personal: the interface language stays for the next person. */
const DEVICE_COOKIES = new Set([OWNER_COOKIE, 'docsync_lang']);

const TEN_YEARS = 60 * 60 * 24 * 365 * 10;

export function ownerCookieOptions() {
  return { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax' as const, path: '/', maxAge: TEN_YEARS };
}

/** Cookies that belong to the signed-in account and must not outlive it on this device. */
export function isAccountCookie(name: string): boolean {
  return name.startsWith('docsync_') && !DEVICE_COOKIES.has(name);
}

/**
 * Opaque, stable id for the session's account (Google `sub`, else the email), or null. Hashed
 * with the server secret, so a cookie never reveals which account it belongs to.
 */
export async function accountId(token: { sub?: unknown; email?: unknown } | null | undefined): Promise<string | null> {
  const id = typeof token?.sub === 'string' && token.sub
    ? token.sub
    : typeof token?.email === 'string' && token.email ? token.email.toLowerCase() : null;
  if (!id) return null;
  const input = new TextEncoder().encode(`docsync-account:${process.env.NEXTAUTH_SECRET ?? ''}:${id}`);
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', input));
  return Array.from(digest.subarray(0, 16), b => b.toString(16).padStart(2, '0')).join('');
}
