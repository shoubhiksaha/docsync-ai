import { cookies, headers } from 'next/headers';
import { LANG_COOKIE, langFromAcceptLanguage, parseLang, translator, type Lang, type Translate } from './index';

/**
 * Language and translator for server components: the language cookie or, on a first visit
 * before anyone has chosen, the phone's own language (Accept-Language).
 */
export async function serverI18n(): Promise<{ lang: Lang; t: Translate }> {
  const chosen = (await cookies()).get(LANG_COOKIE)?.value;
  const lang = chosen ? parseLang(chosen) : langFromAcceptLanguage((await headers()).get('accept-language'));
  return { lang, t: translator(lang) };
}
