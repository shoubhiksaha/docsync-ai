'use client';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, useTransition, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import toast from 'react-hot-toast';
import { track } from '../telemetry';
import { LANG_COOKIE, translator, type Lang, type Translate } from './index';

interface I18nValue {
  lang: Lang;
  t: Translate;
  setLang: (lang: Lang) => void;
  /** True while a language switch waits for the server's re-rendered text; show it as busy. */
  switching: boolean;
}

const I18nContext = createContext<I18nValue>({ lang: 'en', t: translator('en'), setLang: () => undefined, switching: false });

export function I18nProvider({ lang: initial, children }: { lang: Lang; children: ReactNode }) {
  const router = useRouter();
  const [lang, setLangState] = useState<Lang>(initial);
  const [switching, startSwitch] = useTransition();

  // Only once the server's text has arrived too, so screen readers don't read the old language's
  // words with the new language's voice.
  useEffect(() => {
    if (!switching) document.documentElement.lang = lang;
  }, [lang, switching]);

  const setLang = useCallback((next: Lang) => {
    if (next === lang) return;
    // Offline the server can't re-render its text (and saved pages stay in the old language), so
    // the screen would end up half in each language; keep it as it is and say why.
    if (!navigator.onLine) {
      toast(translator(lang)('nav.languageOffline'), { id: 'language' });
      return;
    }
    document.cookie = `${LANG_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`;
    setLangState(next);
    track('language_changed', { lang: next });
    // Server components (home page, scan headers) read the cookie, so re-render them too; until
    // that text arrives the language controls show as busy.
    startSwitch(() => router.refresh());
  }, [lang, router]);

  const value = useMemo(() => ({ lang, t: translator(lang), setLang, switching }), [lang, setLang, switching]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  return useContext(I18nContext);
}
