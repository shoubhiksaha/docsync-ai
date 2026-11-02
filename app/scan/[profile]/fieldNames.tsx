'use client';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { useI18n } from '@/client/i18n/I18nProvider';
import type { Lang } from '@/client/i18n';
import { displayLabel, type ReviewField } from '@/client/scan-flow';

type Localize = (label: string, lang: Lang) => string;

const LocalizeContext = createContext<Localize | null>(null);

/**
 * Field names in the user's language on every scan screen ("Society Name" → "समिति का नाम"). The
 * Hindi names come with the document types, loaded only for a Hindi user (the same download the
 * reading's checks use), so English pages don't fetch them; until they arrive, names show as read.
 * `localize` is given directly in tests, which render without effects.
 */
export function FieldNamesProvider({ children, localize: given }: { children: ReactNode; localize?: Localize }) {
  const { lang } = useI18n();
  const [loaded, setLoaded] = useState<Localize | null>(null);

  useEffect(() => {
    if (given || lang === 'en' || loaded) return;
    let cancelled = false;
    import('@/modules/profiles').then(({ localizedFieldLabel }) => {
      if (!cancelled) setLoaded(() => localizedFieldLabel);
    }).catch(() => {
      // offline and not cached: the names stay as read
    });
    return () => {
      cancelled = true;
    };
  }, [given, lang, loaded]);

  return <LocalizeContext.Provider value={given ?? loaded}>{children}</LocalizeContext.Provider>;
}

/** The name to show for a field, in the user's language unless the user typed it (see displayLabel). */
export function useFieldName(): (field: Pick<ReviewField, 'label'> & Partial<Pick<ReviewField, 'origin' | 'renamed'>>) => string {
  const { lang } = useI18n();
  const localize = useContext(LocalizeContext);
  return field => displayLabel(field, label => (localize ? localize(label, lang) : label));
}
