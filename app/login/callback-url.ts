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
