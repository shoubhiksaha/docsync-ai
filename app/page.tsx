import type { Metadata } from 'next';
import { cookies, headers } from 'next/headers';
import type { NextRequest } from 'next/server';
import Link from 'next/link';
import { getToken } from 'next-auth/jwt';
import { accountId } from '@/core/device-owner';
import { activeProfiles, comingSoonProfiles, localizedComingSoon, localizedProfile } from '@/modules/profiles';
import { serverI18n } from '@/client/i18n/server';
import { RECENT_APPS_COOKIE, SCAN_COUNT_COOKIE, parseRecentApps, parseScanRows } from '@/client/scan-store';
import AppPicker from './components/AppPicker';
import { pickerApps } from './components/AppPicker.apps';
import ModuleBoundary from './components/ModuleBoundary';
import RecentScans from './components/RecentScans';
import styles from './home.module.css';

/** Each page has its own title in the user's language, so the route announcer says where you are. */
export async function generateMetadata(): Promise<Metadata> {
  const { t } = await serverI18n();
  return { title: `${t('home.title')} · DocSync AI` };
}

/** The signed-in account's opaque id (the same hash as docsync_owner), so Home lists only that account's scans. */
async function signedInAccount(jar: Awaited<ReturnType<typeof cookies>>): Promise<string | null> {
  const req = { cookies: jar, headers: await headers() } as unknown as NextRequest;
  return accountId(await getToken({ req, secret: process.env.NEXTAUTH_SECRET }).catch(() => null));
}

export default async function Home() {
  const { lang, t } = await serverI18n();
  const jar = await cookies();
  const profiles = activeProfiles();

  const { apps, groups } = pickerApps(lang, t);
  const profileNames = Object.fromEntries(profiles.map(p => [p.id, localizedProfile(p, lang).documentName]));
  const titleKeys = Object.fromEntries(profiles.map(p => [p.id, p.notion.titleFrom]));
  // Read from cookies so both render on the server: nothing pops in and moves the cards later.
  const recentApps = parseRecentApps(jar.get(RECENT_APPS_COOKIE)?.value, profiles.map(p => p.id));
  const expectedScans = parseScanRows(jar.get(SCAN_COUNT_COOKIE)?.value);
  const comingSoon = comingSoonProfiles.map(p => localizedComingSoon(p, lang));
  const account = await signedInAccount(jar);

  return (
    <main id="main" className="container page">
      <div className={styles.hero}>
        <h1 className={styles.title} tabIndex={-1}>{t('home.title')}</h1>
        <p className={styles.subtitle}>{t('home.subtitle')}</p>
      </div>

      {/* Records from older builds or a half-finished write must never take the document types down with them. */}
      <ModuleBoundary title={t('boundary.title', { name: t('recent.title') })} body={t('boundary.body')} retryLabel={t('common.retry')}>
        <RecentScans profileNames={profileNames} titleKeys={titleKeys} expected={expectedScans} account={account} />
      </ModuleBoundary>

      <AppPicker apps={apps} groups={groups} recentIds={recentApps} />

      {comingSoon.length > 0 && (
        <details className={styles.comingSoon}>
          <summary>{t('home.comingSoon', { count: comingSoon.length })}</summary>
          <ul className={styles.chips}>
            {comingSoon.map(item => <li key={item.title} title={item.description}>{item.title}</li>)}
          </ul>
        </details>
      )}

      <p className={styles.footer}>
        {t('home.footer')} <Link href="/privacy">{t('home.privacy')}</Link>
      </p>
    </main>
  );
}
