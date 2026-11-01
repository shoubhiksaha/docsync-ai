import { showSignedOutHeader } from '@/app/components/Navbar.state';

describe('navbar signed-out view', () => {
  it('always shows the signed-out view on /login', () => {
    expect(showSignedOutHeader('/login', 'authenticated', true)).toBe(true);
    expect(showSignedOutHeader('/login', 'loading', false)).toBe(true);
  });

  it('keeps the header on signed-in pages when the session check fails (offline, weak network)', () => {
    // next-auth reports a failed /api/auth/session fetch as 'unauthenticated'; middleware guarantees a session here.
    for (const path of ['/', '/settings', '/scan/kirana-khata']) {
      expect(showSignedOutHeader(path, 'unauthenticated', true)).toBe(false);
      expect(showSignedOutHeader(path, 'unauthenticated', false)).toBe(false);
      expect(showSignedOutHeader(path, 'loading', false)).toBe(false);
    }
  });

  it('trusts the session status on public pages, using the cookie hint for the first paint', () => {
    expect(showSignedOutHeader('/privacy', 'unauthenticated', true)).toBe(true);
    expect(showSignedOutHeader('/privacy', 'loading', false)).toBe(true);
    expect(showSignedOutHeader('/privacy', 'loading', true)).toBe(false);
    expect(showSignedOutHeader('/privacy', 'authenticated', false)).toBe(false);
  });
});
