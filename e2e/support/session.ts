import type { BrowserContext } from '@playwright/test';
import { encode } from 'next-auth/jwt';

/**
 * Signs the browser in as a test user by setting the encrypted session cookie NextAuth issues
 * after Google sign-in. It is signed with the server's NEXTAUTH_SECRET, so it only works against
 * a server the tests start themselves (locally or in CI), never a deployed environment. The
 * session carries no Google token, so nothing can reach a real Google account. `user` picks the
 * test account (rate limits are per account).
 */
export async function signIn(context: BrowserContext, baseURL: string, user = 'e2e-user'): Promise<void> {
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) throw new Error('NEXTAUTH_SECRET must be set to run the signed-in E2E tests.');
  const value = await encode({
    secret,
    // expiresAt in the future stops the jwt callback from trying to refresh a Google token.
    token: { sub: user, name: 'E2E Tester', email: `${user}@example.test`, expiresAt: Date.now() + 60 * 60 * 1000 },
  });
  const url = new URL(baseURL);
  const secure = url.protocol === 'https:';
  await context.addCookies([{
    name: secure ? '__Secure-next-auth.session-token' : 'next-auth.session-token',
    value,
    domain: url.hostname,
    path: '/',
    httpOnly: true,
    secure,
    sameSite: 'Lax',
  }]);
}
