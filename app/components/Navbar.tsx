'use client';
import { useEffect, useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { Session } from 'next-auth';
import { getSession, signOut, useSession } from 'next-auth/react';
import toast from 'react-hot-toast';
import { Languages, LoaderCircle, LogOut, Settings, WifiOff } from 'lucide-react';
import { useI18n } from '@/client/i18n/I18nProvider';
import { clearScans, listScans } from '@/client/scan-store';
import { signOutThenClear, unsavedCount } from '@/client/sign-out';
import { clearOfflineCaches } from './ServiceWorkerRegister';
import { Button, Dialog } from './ui';
import { deviceOwnerAction, showSignedOutHeader } from './Navbar.state';
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

/** The account this device's scans and preferences belong to; clearDevice removes it with them. */
const OWNER_KEY = 'docsync_owner';

/**
 * Deletes what another account left on this device before anything shows it, then stamps the
 * device with `account`. Without storage there is no stamp to compare, so nothing is deleted.
 */
async function claimDevice(account: string) {
  let stamped: string | null;
  try {
    stamped = localStorage.getItem(OWNER_KEY);
  } catch {
    return;
  }
  const action = deviceOwnerAction(stamped, account);
  if (action === 'keep') return;
  if (action === 'clear') await clearDevice();
  try {
    localStorage.setItem(OWNER_KEY, account);
  } catch {
    // storage unavailable: checked again on the next visit
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

/**
 * `signedIn`: whether the request carried a session cookie, so the first paint is right before useSession answers.
 * `account`: opaque id of the signed-in account (core/device-owner.ts), or null.
 */
export default function Navbar({ signedIn, account }: { signedIn: boolean; account: string | null }) {
  const { data: session, status } = useSession();
  const pathname = usePathname();
  const { t, lang, setLang, switching } = useI18n();
  const [signingOut, setSigningOut] = useState(false);
  /** Unsaved scans that signing out would delete; the confirmation is open while this is set. */
  const [confirmCount, setConfirmCount] = useState<number | null>(null);
  /** The session fetched again after a failed check; next-auth itself doesn't retry until a reload. */
  const [recovered, setRecovered] = useState<Session | null>(null);

  // The header's effects run before the page's, so Home's recent scans read the store once it's cleared.
  useEffect(() => {
    if (account) void claimDevice(account);
  }, [account]);

  useEffect(() => {
    if (status !== 'unauthenticated') return;
    const refetch = () => { void getSession().then(setRecovered); };
    window.addEventListener('online', refetch);
    return () => window.removeEventListener('online', refetch);
  }, [status]);

  // Signed-out visitors only see /login and public pages like /privacy, which link back themselves.
  if (showSignedOutHeader(pathname, status, signedIn)) {
    return <div className={styles.bannerOnly}><OfflineBanner /></div>;
  }
  const other = lang === 'en' ? 'hi' : 'en';
  const avatar = (session ?? recovered)?.user?.image;

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
          {/* The Google avatar, where there is one, is the account link, as in most apps; same size as the gear. */}
          <Link href="/settings" className={styles.navButton} aria-current={pathname === '/settings' ? 'page' : undefined}>
            {avatar ? (
              /* eslint-disable-next-line @next/next/no-img-element -- remote Google avatar, tiny */
              <img className={styles.avatar} src={avatar} alt="" width={24} height={24} referrerPolicy="no-referrer" />
            ) : (
              <Settings size={20} aria-hidden />
            )}
            <span>{t('nav.settings')}</span>
          </Link>
          {/* aria-disabled, not disabled: focus stays on the button while signing out. */}
          <button type="button" className={styles.navButton} aria-disabled={signingOut || undefined} aria-busy={signingOut || undefined} onClick={requestSignOut}>
            {signingOut ? <LoaderCircle className="spin" size={20} aria-hidden /> : <LogOut size={20} aria-hidden />}
            <span>{t('nav.signOut')}</span>
          </button>
          <span className="sr-only" role="status">{signingOut ? t('nav.signingOut') : ''}</span>
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
