import { NextRequest } from 'next/server';
import { POST } from '@/app/login/language/route';
import { LANG_COOKIE } from '@/client/i18n';

function post(fields?: Record<string, string>) {
  const body = fields ? new URLSearchParams(fields) : undefined;
  return POST(new NextRequest('http://localhost/login/language', { method: 'POST', body }));
}

describe('POST /login/language (the language switch without JavaScript)', () => {
  it('sets the language and goes back to /login with the same deep link', async () => {
    const response = await post({ lang: 'hi', callbackUrl: '/scan/dairy-collection-slip' });
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('http://localhost/login?callbackUrl=%2Fscan%2Fdairy-collection-slip');
    expect(response.cookies.get(LANG_COOKIE)?.value).toBe('hi');
  });

  it('never leaves this site, and falls back to English for anything else', async () => {
    const response = await post({ lang: 'fr', callbackUrl: 'https://evil.example//x' });
    expect(new URL(response.headers.get('location')!).origin).toBe('http://localhost');
    expect(response.cookies.get(LANG_COOKIE)?.value).toBe('en');
  });

  it('goes back to plain /login without a deep link or a form', async () => {
    const response = await post();
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('http://localhost/login');
    expect(response.cookies.get(LANG_COOKIE)?.value).toBe('en');
  });
});
