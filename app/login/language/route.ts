import { NextResponse, type NextRequest } from 'next/server';
import { LANG_COOKIE, parseLang } from '@/client/i18n';
import { loginHref } from '../callback-url';

/**
 * The landing page's language switch (LanguageButton) before its JavaScript has arrived, which
 * takes many seconds on 2G, or in a browser that runs none (Opera Mini, data savers): the form
 * posts here, and the page loads again in that language with the same callbackUrl. The cookie is
 * the one I18nProvider sets, readable by the page.
 */
export async function POST(request: NextRequest) {
  const form = await request.formData().catch(() => null);
  const field = (name: string) => {
    const value = form?.get(name);
    return typeof value === 'string' ? value : null;
  };
  const response = NextResponse.redirect(new URL(loginHref(field('callbackUrl')), request.url), 303);
  response.cookies.set(LANG_COOKIE, parseLang(field('lang')), { path: '/', maxAge: 31_536_000, sameSite: 'lax' });
  return response;
}
