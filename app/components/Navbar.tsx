'use client';
import { useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { getSession, signOut, useSession } from 'next-auth/react';
import toast from 'react-hot-toast';
import { Languages, LoaderCircle, LogOut, Settings, WifiOff } from 'lucide-react';
import { useI18n } from '@/client/i18n/I18nProvider';
import { clearScans, listScans } from '@/client/scan-store';
import { signOutThenClear, unsavedCount } from '@/client/sign-out';
import { clearOfflineCaches } from './ServiceWorkerRegister';
import { Button, Dialog } from './ui';
import styles from './Navbar.module.css';

/** Deletes everything this device holds for the session (only once the server sign-out worked). */
async function clearDevice() {
  await clearScans();
  await clearOfflineCaches();
  try {
    Object.keys(localStorage).filter(k => k.startsWith('docsync_')).forEach(k => localStorage.removeItem(k));
  } catch {
    // storage unavailable: nothing to clear
  }
}

function subscribeOnline(onChange: () => void) {
  window.addEventListener('online', onChange);
  window.addEventListener('offline', onChange);
  return () => {
    window.removeEventListener('online', onChange);
    window.removeEventListener('offline', onChange);
  };
}

/** Stays on screen for as long as the device is offline (a toast is easy to miss). */
function OfflineBanner() {
  const { t } = useI18n();
  const online = useSyncExternalStore(subscribeOnline, () => navigator.onLine, () => true);
  return (
    <div role="status">
      {!online && (
        <p className={`offline-banner ${styles.offline}`}>
          <WifiOff size={18} aria-hidden />
          <span>{t('nav.offlineBanner')}</span>
        </p>
      )}
    </div>
  );
}

/** `signedIn`: whether the request carried a session cookie, so the first paint is right before useSession answers. */
export default function Navbar({ signedIn }: { signedIn: boolean }) {
  const { data: session, status } = useSession();
  const pathname = usePathname();
  const { t, lang, setLang, switching } = useI18n();
  const [signingOut, setSigningOut] = useState(false);
  /** Unsaved scans that signing out would delete; the confirmation is open while this is set. */
  const [confirmCount, setConfirmCount] = useState<number | null>(null);

  // Signed-out visitors only see /login and public pages like /privacy, which link back themselves.
  const signedOut = status === 'unauthenticated' || (status === 'loading' && !signedIn);
  if (pathname === '/login' || signedOut) return <OfflineBanner />;
  const other = lang === 'en' ? 'hi' : 'en';

  async function signOutNow() {
    setConfirmCount(null);
    setSigningOut(true);
    try {
      const result = await signOutThenClear({
        isOnline: () => navigator.onLine,
        signOut: async () => { await signOut({ redirect: false, callbackUrl: '/login' }); },
        isSignedIn: async () => Boolean(await getSession()),
        clearDevice,
        goToLogin: () => window.location.assign('/login'),
      });
      if (result === 'offline') toast(t('nav.signOutOffline'), { id: 'sign-out' });
      if (result === 'failed') toast.error(t('nav.signOutFailed'), { id: 'sign-out' });
    } finally {
      setSigningOut(false);
    }
  }

  async function requestSignOut() {
    if (signingOut) return;
    if (!navigator.onLine) {
      toast(t('nav.signOutOffline'), { id: 'sign-out' });
      return;
    }
    const count = unsavedCount(await listScans());
    if (count > 0) setConfirmCount(count);
    else await signOutNow();
  }

  return (
    <header className={styles.header}>
      <nav className={`container ${styles.nav}`} aria-label={t('nav.main')}>
        <Link href="/" className={styles.brand} aria-label={t('nav.home')}>
          {/* eslint-disable-next-line @next/next/no-img-element -- tiny static SVG logo */}
          <img src="/icon.svg" alt="" width={28} height={28} />
          <span aria-hidden>DocSync AI</span>
        </Link>

        <div className={styles.actions}>
          {/* Busy until the server's text is in the new language too (it can take a while on 2G). */}
          <button
            type="button"
            className={styles.navButton}
            aria-disabled={switching || undefined}
            aria-busy={switching || undefined}
            onClick={() => { if (!switching) setLang(other); }}
          >
            {switching ? <LoaderCircle className="spin" size={20} aria-hidden /> : <Languages size={20} aria-hidden />}
            <span lang={other}>{t('nav.switchLanguage')}</span>
            <span className="sr-only"> ({t('nav.switchLanguageLabel')})</span>
          </button>
          <Link href="/settings" className={styles.navButton} aria-current={pathname === '/settings' ? 'page' : undefined}>
            <Settings size={20} aria-hidden />
            <span>{t('nav.settings')}</span>
          </Link>
          {session?.user?.image ? (
            /* eslint-disable-next-line @next/next/no-img-element -- remote Google avatar, tiny */
            <img className={styles.avatar} src={session.user.image} alt={session.user.name || t('nav.account')} width={32} height={32} referrerPolicy="no-referrer" />
          ) : status === 'loading' && (
            // Holds the avatar's place, so nothing shifts when the session arrives.
            <span className={`${styles.avatar} ${styles.avatarPending}`} aria-hidden />
          )}
          {/* aria-disabled, not disabled: focus stays on the button while signing out. */}
          <button type="button" className={styles.navButton} aria-disabled={signingOut || undefined} aria-busy={signingOut || undefined} onClick={requestSignOut}>
            <LogOut size={20} aria-hidden />
            <span>{t('nav.signOut')}</span>
          </button>
        </div>
      </nav>
      <OfflineBanner />

      <Dialog
        open={confirmCount !== null}
        onClose={() => setConfirmCount(null)}
        title={t('nav.signOutConfirm.title')}
        description={t('nav.signOutConfirm.body', { count: confirmCount ?? 0 })}
        closeLabel={t('common.close')}
        actions={
          <>
            <Button variant="primary" onClick={() => setConfirmCount(null)}>{t('nav.signOutConfirm.stay')}</Button>
            <Button variant="danger" icon={<LogOut size={18} aria-hidden />} onClick={signOutNow}>{t('nav.signOutConfirm.delete')}</Button>
          </>
        }
      />
    </header>
  );
}
