import { safeCallbackUrl } from '@/app/login/callback-url';
import { GOOGLE_SCOPES, hasRequiredScopes } from '@/app/login/google-scopes';

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
