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
