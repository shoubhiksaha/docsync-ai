import { PROFILE_GROUPS, activeProfiles, comingSoonProfiles, localizedComingSoon, localizedProfile } from '@/modules/profiles';
import { serverI18n } from '@/client/i18n/server';
import AppPicker, { type PickerApp, type PickerGroup } from './components/AppPicker';
import RecentScans from './components/RecentScans';
import styles from './home.module.css';

export default async function Home() {
  const { lang, t } = await serverI18n();
  const profiles = activeProfiles();

  const apps: PickerApp[] = profiles.map(p => {
    const shown = localizedProfile(p, lang);
    // Search both languages, whichever the UI is in: people type "LR" or "दूध" either way.
    const searchText = (['en', 'hi'] as const)
      .map(l => localizedProfile(p, l))
      .flatMap(text => [text.title, text.documentName, text.description])
      .join(' ')
      .toLowerCase();
    return { id: p.id, group: p.group, title: shown.title, description: shown.description, searchText };
  });
  const groups: PickerGroup[] = PROFILE_GROUPS.map(id => ({ id, label: t(`group.${id}`) }));
  const profileNames = Object.fromEntries(profiles.map(p => [p.id, localizedProfile(p, lang).documentName]));
  const comingSoon = comingSoonProfiles.map(p => localizedComingSoon(p, lang));

  return (
    <main id="main" className="container page">
      <div className={styles.hero}>
        <h1 className={styles.title}>{t('home.title')}</h1>
        <p className={styles.subtitle}>{t('home.subtitle')}</p>
      </div>

      <RecentScans profileNames={profileNames} />

      <AppPicker apps={apps} groups={groups} />

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
