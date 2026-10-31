'use client';
import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { signOut, useSession } from 'next-auth/react';
import { Languages, LogOut, Settings } from 'lucide-react';
import { useI18n } from '@/client/i18n/I18nProvider';
import { clearScans } from '@/client/scan-store';
import { clearOfflineCaches } from './ServiceWorkerRegister';
import styles from './Navbar.module.css';

/** Clears everything this device holds for the session, then signs out. */
async function signOutEverywhere() {
  await clearScans();
  await clearOfflineCaches();
  try {
    Object.keys(localStorage).filter(k => k.startsWith('docsync_')).forEach(k => localStorage.removeItem(k));
  } catch {
    // storage unavailable: nothing to clear
  }
  await signOut({ callbackUrl: '/login' });
}

export default function Navbar() {
  const { data: session } = useSession();
  const pathname = usePathname();
  const { t, lang, setLang } = useI18n();
  const [signingOut, setSigningOut] = useState(false);

  if (pathname === '/login') return null;
  const other = lang === 'en' ? 'hi' : 'en';

  return (
    <header className={styles.header}>
      <nav className={`container ${styles.nav}`} aria-label={t('nav.main')}>
        <Link href="/" className={styles.brand} aria-label={t('nav.home')}>
          {/* eslint-disable-next-line @next/next/no-img-element -- tiny static SVG logo */}
          <img src="/icon.svg" alt="" width={28} height={28} />
          <span aria-hidden>DocSync AI</span>
        </Link>

        <div className={styles.actions}>
          <button type="button" className={styles.navButton} onClick={() => setLang(other)} aria-label={t('nav.switchLanguageLabel')}>
            <Languages size={20} aria-hidden />
            <span lang={other}>{t('nav.switchLanguage')}</span>
          </button>
          <Link href="/settings" className={styles.navButton} aria-current={pathname === '/settings' ? 'page' : undefined}>
            <Settings size={20} aria-hidden />
            <span className={styles.collapsible}>{t('nav.settings')}</span>
          </Link>
          {session?.user?.image && (
            /* eslint-disable-next-line @next/next/no-img-element -- remote Google avatar, tiny */
            <img className={styles.avatar} src={session.user.image} alt={session.user.name || t('nav.account')} width={32} height={32} referrerPolicy="no-referrer" />
          )}
          <button
            type="button"
            className={styles.navButton}
            disabled={signingOut}
            onClick={async () => {
              setSigningOut(true);
              await signOutEverywhere();
            }}
          >
            <LogOut size={20} aria-hidden />
            <span className={styles.collapsible}>{t('nav.signOut')}</span>
          </button>
        </div>
      </nav>
    </header>
  );
}
