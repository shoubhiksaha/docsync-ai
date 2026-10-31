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

export function translate(lang: Lang, key: MessageKey, vars?: Vars): string {
  const template = dictionaries[lang][key] ?? en[key] ?? key;
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) => (name in vars ? String(vars[name]) : match));
}

export function translator(lang: Lang): Translate {
  return (key, vars) => translate(lang, key, vars);
}
