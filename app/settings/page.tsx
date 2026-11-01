import type { Metadata } from 'next';
import { activeProfiles, localizedProfile } from '@/modules/profiles';
import { serverI18n } from '@/client/i18n/server';
import { en } from '@/client/i18n/en';
import type { MessageKey } from '@/client/i18n';
import SettingsClient, { type NotionResult } from './SettingsClient';

/** Outcomes the Notion OAuth routes send back as ?notion=<code>. */
const NOTION_RESULTS: readonly NotionResult[] = ['connected', 'no_page', 'cancelled', 'failed', 'disabled', 'not_configured'];

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await serverI18n();
  return { title: `${t('settings.title')} · DocSync AI` };
}

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ notion?: string }> }) {
  const { lang, t } = await serverI18n();
  const query = await searchParams;
  // Field names are English in the profiles; the default duplicate-check fields have translations.
  const fieldLabel = (key: string, label: string) => {
    const translated = `settings.profiles.field.${key}`;
    return lang !== 'en' && translated in en ? t(translated as MessageKey) : label;
  };
  const profiles = activeProfiles().map(p => ({
    id: p.id,
    name: localizedProfile(p, lang).title,
    fields: Object.fromEntries(p.mockFields.map(f => [f.key, fieldLabel(f.key, f.label)])),
  }));
  const notionResult = NOTION_RESULTS.find(r => r === query.notion) ?? null;
  return <SettingsClient profiles={profiles} notionResult={notionResult} />;
}
