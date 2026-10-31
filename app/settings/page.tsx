import { activeProfiles, localizedProfile } from '@/modules/profiles';
import { serverI18n } from '@/client/i18n/server';
import SettingsClient from './SettingsClient';

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ notionConnected?: string }> }) {
  const { lang } = await serverI18n();
  const query = await searchParams;
  const profiles = activeProfiles().map(p => ({ id: p.id, name: localizedProfile(p, lang).title }));
  return <SettingsClient profiles={profiles} notionJustConnected={query.notionConnected === 'true'} />;
}
