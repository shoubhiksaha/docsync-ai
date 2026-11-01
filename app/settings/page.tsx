import { activeProfiles, localizedProfile } from '@/modules/profiles';
import { serverI18n } from '@/client/i18n/server';
import SettingsClient, { type NotionResult } from './SettingsClient';

/** Outcomes the Notion OAuth routes send back as ?notion=<code>. */
const NOTION_RESULTS: readonly NotionResult[] = ['connected', 'no_page', 'cancelled', 'failed', 'disabled', 'not_configured'];

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ notion?: string }> }) {
  const { lang } = await serverI18n();
  const query = await searchParams;
  const profiles = activeProfiles().map(p => ({
    id: p.id,
    name: localizedProfile(p, lang).title,
    fields: Object.fromEntries(p.mockFields.map(f => [f.key, f.label])),
  }));
  const notionResult = NOTION_RESULTS.find(r => r === query.notion) ?? null;
  return <SettingsClient profiles={profiles} notionResult={notionResult} />;
}
