/**
 * On Cloud Run the app is meant to be reached only through the Cloudflare Worker in
 * deploy/cloudflare-proxy, which sends PROXY_SECRET in x-proxy-secret and the caller's address in
 * x-real-ip. Requests that skip the Worker (straight to the run.app address) are refused by
 * middleware.ts, so x-real-ip can be trusted for rate limiting. With no PROXY_SECRET (local
 * development, CI) every request is accepted.
 */

/** Constant-time string comparison (Edge middleware has no crypto.timingSafeEqual). */
function sameSecret(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function viaTrustedProxy(headers: Headers): boolean {
  const secret = process.env.PROXY_SECRET;
  return !secret || sameSecret(headers.get('x-proxy-secret') ?? '', secret);
}
