/**
 * Where to send someone after sign-in: the page they asked for, as a path on this site, or '/'.
 * Accepts a relative path ('/scan/ngo-receipt') or a full URL (NextAuth passes its callbackUrl
 * back to /login as one after a failed sign-in) and keeps only the path, so it can never point
 * at another site. /login itself and API routes fall back to '/'.
 */
export function safeCallbackUrl(value: string | string[] | undefined | null): string {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw) return '/';
  let url: URL;
  try {
    url = new URL(raw, 'http://localhost');
  } catch {
    return '/';
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return '/';
  const path = `${url.pathname}${url.search}${url.hash}`;
  if (path.startsWith('//') || /^\/(login|api)(\/|\?|#|$)/.test(path)) return '/';
  return path;
}

/** NextAuth's record of where the current sign-in should end up, set when it starts (secure name first). */
export const NEXTAUTH_CALLBACK_COOKIES = ['__Secure-next-auth.callback-url', 'next-auth.callback-url'];

/**
 * Where /login sends someone after sign-in: the callbackUrl in the address or, back from a failed
 * sign-in without one, NextAuth's callback-url cookie. The signIn callback's Scopes refusal
 * redirects to a bare /login?error=…, so without the cookie a shared /scan link would end on Home.
 * Only after an error: on a plain visit the cookie may be left over from an earlier sign-in.
 */
export function loginCallbackUrl(
  query: { callbackUrl?: string | string[]; error?: string | string[] },
  cookie: (name: string) => string | undefined,
): string {
  if (query.callbackUrl || !query.error) return safeCallbackUrl(query.callbackUrl);
  return safeCallbackUrl(NEXTAUTH_CALLBACK_COOKIES.map(cookie).find(Boolean));
}

/**
 * The privacy policy, opened from /login, and its "Back to DocSync". A pending deep link (a shared
 * /scan link) comes along both ways, so signing in after reading the policy still opens it. Back
 * goes through /login, which sends someone already signed in straight on (middleware.ts).
 */
export function privacyHref(callbackUrl: string): string {
  const wanted = safeCallbackUrl(callbackUrl);
  return wanted === '/' ? '/privacy' : `/privacy?callbackUrl=${encodeURIComponent(wanted)}`;
}

export function privacyBackHref(callbackUrl: string | string[] | undefined): string {
  const wanted = safeCallbackUrl(callbackUrl);
  return wanted === '/' ? '/' : `/login?callbackUrl=${encodeURIComponent(wanted)}`;
}

/**
 * /login itself, keeping a pending deep link (a shared /scan link): where the language switch
 * without JavaScript and the "Reload page" link go back to.
 */
export function loginHref(callbackUrl: string | string[] | undefined | null): string {
  const wanted = safeCallbackUrl(callbackUrl);
  return wanted === '/' ? '/login' : `/login?callbackUrl=${encodeURIComponent(wanted)}`;
}

/** The document type a pending /scan/<id> link opens, or null for any other page. */
export function scanProfileId(callbackUrl: string): string | null {
  return /^\/scan\/([^/?#]+)/.exec(callbackUrl)?.[1] ?? null;
}
