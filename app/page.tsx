import { cookies } from 'next/headers';
import { PROFILE_GROUPS, activeProfiles, comingSoonProfiles, localizedComingSoon, localizedProfile } from '@/modules/profiles';
import { serverI18n } from '@/client/i18n/server';
import { RECENT_APPS_COOKIE, SCAN_COUNT_COOKIE, parseRecentApps } from '@/client/scan-store';
import AppPicker, { type PickerApp, type PickerGroup } from './components/AppPicker';
import { searchTextFor } from './components/AppPicker.search';
import RecentScans from './components/RecentScans';
import styles from './home.module.css';

export default async function Home() {
  const { lang, t } = await serverI18n();
  const jar = await cookies();
  const profiles = activeProfiles();

  const apps: PickerApp[] = profiles.map(p => {
    const shown = localizedProfile(p, lang);
    // Search both languages, whichever the UI is in: people type "LR" or "दूध" either way.
    const searchText = searchTextFor(p.id, (['en', 'hi'] as const)
      .map(l => localizedProfile(p, l))
      .flatMap(text => [text.title, text.documentName, text.description]));
    return { id: p.id, group: p.group, title: shown.title, description: shown.description, searchText };
  });
  const groups: PickerGroup[] = PROFILE_GROUPS.map(id => ({ id, label: t(`group.${id}`) }));
  const profileNames = Object.fromEntries(profiles.map(p => [p.id, localizedProfile(p, lang).documentName]));
  const titleKeys = Object.fromEntries(profiles.map(p => [p.id, p.notion.titleFrom]));
  // Read from cookies so both render on the server: nothing pops in and moves the cards later.
  const recentApps = parseRecentApps(jar.get(RECENT_APPS_COOKIE)?.value, profiles.map(p => p.id));
  const expectedScanRows = Math.min(Number(jar.get(SCAN_COUNT_COOKIE)?.value) || 0, 6);
  const comingSoon = comingSoonProfiles.map(p => localizedComingSoon(p, lang));

  return (
    <main id="main" className="container page">
      <div className={styles.hero}>
        <h1 className={styles.title}>{t('home.title')}</h1>
        <p className={styles.subtitle}>{t('home.subtitle')}</p>
      </div>

      <RecentScans profileNames={profileNames} titleKeys={titleKeys} expectedRows={expectedScanRows} />

      <AppPicker apps={apps} groups={groups} recentIds={recentApps} />

      {comingSoon.length > 0 && (
        <details className={styles.comingSoon}>
          <summary>{t('home.comingSoon', { count: comingSoon.length })}</summary>
          <ul className={styles.chips}>
            {comingSoon.map(item => <li key={item.title} title={item.description}>{item.title}</li>)}
          </ul>
        </details>
      )}

      <p className={styles.footer}>{t('home.footer')}</p>
    </main>
  );
}
