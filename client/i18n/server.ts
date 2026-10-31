import { cookies } from 'next/headers';
import { LANG_COOKIE, parseLang, translator, type Lang, type Translate } from './index';

/** Language and translator for server components (reads the language cookie). */
export async function serverI18n(): Promise<{ lang: Lang; t: Translate }> {
  const lang = parseLang((await cookies()).get(LANG_COOKIE)?.value);
  return { lang, t: translator(lang) };
}
