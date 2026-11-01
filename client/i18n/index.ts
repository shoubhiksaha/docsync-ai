import { en, type MessageKey } from './en';
import { hi } from './hi';

export type { MessageKey };
export type Lang = 'en' | 'hi';
export type Vars = Record<string, string | number>;
export type Translate = (key: MessageKey, vars?: Vars) => string;

/** Plain (readable by the client) cookie holding the chosen UI language. */
export const LANG_COOKIE = 'docsync_lang';

const dictionaries: Record<Lang, Record<MessageKey, string>> = { en, hi };

export function parseLang(value: unknown): Lang {
  return value === 'hi' ? 'hi' : 'en';
}

/**
 * The language a first visit (no language cookie yet) is shown in: Hindi when the phone's
 * Accept-Language ranks Hindi above English ("hi-IN,hi;q=0.9,en;q=0.8"), otherwise English.
 */
export function langFromAcceptLanguage(header: string | null | undefined): Lang {
  const ranked = (header ?? '')
    .split(',')
    .map((part, index) => {
      const [tag, ...params] = part.trim().toLowerCase().split(';');
      const q = params.map(p => p.trim()).find(p => p.startsWith('q='));
      const quality = q ? Number(q.slice(2)) : 1;
      return { primary: tag.split('-')[0], quality: Number.isFinite(quality) ? quality : 0, index };
    })
    .filter(entry => entry.quality > 0 && (entry.primary === 'hi' || entry.primary === 'en'))
    .sort((a, b) => b.quality - a.quality || a.index - b.index);
  return ranked[0]?.primary === 'hi' ? 'hi' : 'en';
}

export function translate(lang: Lang, key: MessageKey, vars?: Vars): string {
  const template = dictionaries[lang][key] ?? en[key] ?? key;
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) => (name in vars ? String(vars[name]) : match));
}

export function translator(lang: Lang): Translate {
  return (key, vars) => translate(lang, key, vars);
}
