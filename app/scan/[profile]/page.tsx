import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getProfile, localizedProfile } from '@/modules/profiles';
import { serverI18n } from '@/client/i18n/server';
import { FieldNamesProvider } from './fieldNames';
import ScanClient from './ScanClient';

/** "Scan: Lorry Receipt (LR) · DocSync AI", so each app's tab and history entry is distinct. */
export async function generateMetadata({ params }: { params: Promise<{ profile: string }> }): Promise<Metadata> {
  const profile = getProfile((await params).profile);
  if (!profile) return {};
  const { lang, t } = await serverI18n();
  return { title: `${t('scan.title', { name: localizedProfile(profile, lang).documentName })} · DocSync AI` };
}

export default async function ScanPage({
  params,
  searchParams,
}: {
  params: Promise<{ profile: string }>;
  searchParams: Promise<{ resume?: string | string[] }>;
}) {
  const [{ profile: profileId }, query] = await Promise.all([params, searchParams]);
  const profile = getProfile(profileId);
  if (!profile) notFound();

  const { lang } = await serverI18n();
  const resume = typeof query.resume === 'string' ? query.resume : null;

  // Field names follow the language on every scan screen (Check, Saved, the duplicate dialog).
  return (
    <FieldNamesProvider>
      <ScanClient
        profileId={profile.id}
        documentName={localizedProfile(profile, lang).documentName}
        sampleHref={profile.sampleDocument?.href ?? null}
        resumeId={resume}
      />
    </FieldNamesProvider>
  );
}
