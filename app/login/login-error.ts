import type { MessageKey } from '@/client/i18n/en';
import { MISSING_SCOPES_ERROR } from './google-scopes';

/**
 * What /login?error=… says. Only a choice made on Google's screen asks the visitor to allow
 * access: Cancel there comes back from NextAuth as Callback (Google's access_denied). OAuthCallback
 * is mostly a sign-in that outlived its 15-minute state and PKCE cookies (a long read of Google's
 * consent screen) or was finished in another tab or browser, so it says to start again. The rest
 * (OAuthSignin, Configuration, or "undefined" when NextAuth couldn't even load its providers on a
 * weak signal) is not their doing, so it says to check the connection and retry.
 */
export function loginErrorMessage(error: string): MessageKey {
  if (error === MISSING_SCOPES_ERROR) return 'login.error.scopes';
  if (error === 'AccessDenied') return 'login.error.denied';
  if (error === 'Callback') return 'login.error.failed';
  if (error === 'OAuthCallback') return 'login.error.expired';
  return 'login.error.network';
}
