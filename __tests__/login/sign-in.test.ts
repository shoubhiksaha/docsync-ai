import { loginCallbackUrl, privacyBackHref, privacyHref, safeCallbackUrl } from '@/app/login/callback-url';
import { GOOGLE_SCOPES, MISSING_SCOPES_ERROR, hasRequiredScopes } from '@/app/login/google-scopes';
import { loginErrorMessage } from '@/app/login/login-error';

describe('safeCallbackUrl', () => {
  it('keeps paths on this site, with their query', () => {
    expect(safeCallbackUrl('/scan/ngo-receipt')).toBe('/scan/ngo-receipt');
    expect(safeCallbackUrl('/scan/dairy-collection-slip?resume=abc')).toBe('/scan/dairy-collection-slip?resume=abc');
    expect(safeCallbackUrl(['/settings', '/other'])).toBe('/settings');
  });

  it('keeps only the path of a full URL (NextAuth sends one back after a failed sign-in)', () => {
    expect(safeCallbackUrl('https://docsync.analogdigital.tech/scan/ngo-receipt')).toBe('/scan/ngo-receipt');
    expect(safeCallbackUrl('https://evil.example/scan/x')).toBe('/scan/x');
  });

  it('never points at another site', () => {
    for (const bad of ['//evil.example', '/\\evil.example', '/\t/evil.example', 'https://evil.example', 'javascript:alert(1)', 'http://localhost//evil.example']) {
      const result = safeCallbackUrl(bad);
      expect(result.startsWith('/')).toBe(true);
      expect(result.startsWith('//')).toBe(false);
    }
    expect(safeCallbackUrl('javascript:alert(1)')).toBe('/');
    expect(safeCallbackUrl('//evil.example/path')).toBe('/path');
  });

  it("falls back to home for nothing, /login and API routes", () => {
    expect(safeCallbackUrl(undefined)).toBe('/');
    expect(safeCallbackUrl('')).toBe('/');
    expect(safeCallbackUrl('/login')).toBe('/');
    expect(safeCallbackUrl('/login?error=OAuthCallback')).toBe('/');
    expect(safeCallbackUrl('/api/settings')).toBe('/');
    expect(safeCallbackUrl('/loginhelp')).toBe('/loginhelp');
  });
});

describe('loginCallbackUrl', () => {
  const jar = (values: Record<string, string>) => (name: string) => values[name];
  const started = jar({ '__Secure-next-auth.callback-url': 'https://docsync.analogdigital.tech/scan/ngo-receipt' });

  it('uses the callbackUrl in the address when there is one', () => {
    expect(loginCallbackUrl({ callbackUrl: '/scan/dairy-collection-slip', error: 'OAuthCallback' }, started)).toBe('/scan/dairy-collection-slip');
    expect(loginCallbackUrl({ callbackUrl: '/settings' }, started)).toBe('/settings');
  });

  it("keeps the deep link after a Scopes refusal, which comes back to a bare /login?error=…", () => {
    expect(loginCallbackUrl({ error: MISSING_SCOPES_ERROR }, started)).toBe('/scan/ngo-receipt');
    expect(loginCallbackUrl({ error: MISSING_SCOPES_ERROR }, jar({ 'next-auth.callback-url': 'http://localhost:3000/scan/weighbridge-slip' }))).toBe('/scan/weighbridge-slip');
  });

  it('checks the cookie like any other callbackUrl', () => {
    expect(loginCallbackUrl({ error: MISSING_SCOPES_ERROR }, jar({ 'next-auth.callback-url': 'https://evil.example/login' }))).toBe('/');
    expect(loginCallbackUrl({ error: MISSING_SCOPES_ERROR }, jar({}))).toBe('/');
  });

  it('ignores a cookie left over from an earlier sign-in on a plain visit', () => {
    expect(loginCallbackUrl({}, started)).toBe('/');
  });
});

describe('privacy policy links', () => {
  it('carry a pending deep link to the policy and back through /login', () => {
    expect(privacyHref('/scan/ngo-receipt?resume=abc')).toBe('/privacy?callbackUrl=%2Fscan%2Fngo-receipt%3Fresume%3Dabc');
    expect(privacyBackHref('/scan/ngo-receipt?resume=abc')).toBe('/login?callbackUrl=%2Fscan%2Fngo-receipt%3Fresume%3Dabc');
  });

  it('stay plain without one, and never point at another site', () => {
    expect(privacyHref('/')).toBe('/privacy');
    expect(privacyBackHref(undefined)).toBe('/');
    expect(privacyBackHref('/login?error=x')).toBe('/');
    expect(privacyBackHref('https://evil.example/scan/x')).toBe('/login?callbackUrl=%2Fscan%2Fx');
  });
});

describe('hasRequiredScopes', () => {
  it('needs both Drive and Sheets', () => {
    expect(hasRequiredScopes(GOOGLE_SCOPES.join(' '))).toBe(true);
    expect(hasRequiredScopes('openid https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/drive.file')).toBe(true);
    expect(hasRequiredScopes('openid email profile https://www.googleapis.com/auth/drive.file')).toBe(false);
    expect(hasRequiredScopes('openid email profile https://www.googleapis.com/auth/spreadsheets')).toBe(false);
    expect(hasRequiredScopes('openid email profile')).toBe(false);
  });

  it('does not refuse sign-in when Google sends no scope list', () => {
    expect(hasRequiredScopes(undefined)).toBe(true);
    expect(hasRequiredScopes(null)).toBe(true);
  });
});

describe('loginErrorMessage', () => {
  it("asks to allow access only after a choice on Google's screen", () => {
    expect(loginErrorMessage(MISSING_SCOPES_ERROR)).toBe('login.error.scopes');
    expect(loginErrorMessage('AccessDenied')).toBe('login.error.denied');
    // Cancel on Google's consent screen (access_denied) comes back from NextAuth as Callback.
    expect(loginErrorMessage('Callback')).toBe('login.error.failed');
  });

  it("doesn't blame the visitor when sign-in couldn't reach Google", () => {
    // "undefined": NextAuth couldn't load /api/auth/providers on a weak signal.
    for (const code of ['undefined', 'OAuthSignin', 'OAuthCallback', 'Configuration', 'Something']) {
      expect(loginErrorMessage(code)).toBe('login.error.network');
    }
  });
});
