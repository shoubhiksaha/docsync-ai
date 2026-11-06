import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { activeProfiles } from '@/modules/profiles';
import { serverI18n } from '@/client/i18n/server';
import { RECENT_APPS_COOKIE, parseRecentApps } from '@/client/scan-store';
import { isShareId } from '@/client/shared-files';
import { pickerApps } from '@/app/components/AppPicker.apps';
import ShareClient from './ShareClient';
import ShareNotice from './ShareNotice';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await serverI18n();
  return { title: `${t('share.title')} · DocSync AI` };
}

/**
 * Where a photo or PDF shared from WhatsApp (or any app) lands: public/sw.js kept it and sent the
 * share here as ?id=<id>. Asks which document it is, with Home's picker. ?missed=1 comes from
 * app/share/incoming/route.ts, when no worker was there to keep the share.
 */
export default async function SharePage({ searchParams }: { searchParams: Promise<{ id?: string | string[]; missed?: string | string[] }> }) {
  const [{ lang, t }, query, jar] = await Promise.all([serverI18n(), searchParams, cookies()]);
  const id = [query.id].flat()[0];

  if (!isShareId(id)) {
    const missed = [query.missed].flat()[0] === '1';
    return (
      <main id="main" className="container page">
        {missed
          ? <ShareNotice title={t('share.missed.title')} body={t('share.missed.body')} home={t('share.home')} />
          : <ShareNotice title={t('share.missing.title')} body={t('share.missing.body')} home={t('share.home')} />}
      </main>
    );
  }

  const { apps, groups } = pickerApps(lang, t);
  const recentIds = parseRecentApps(jar.get(RECENT_APPS_COOKIE)?.value, activeProfiles().map(p => p.id));
  return (
    <main id="main" className="container page">
      <ShareClient id={id} apps={apps} groups={groups} recentIds={recentIds} />
    </main>
  );
}
