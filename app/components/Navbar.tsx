'use client';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { Session } from 'next-auth';
import { getSession, signOut, useSession } from 'next-auth/react';
import toast from 'react-hot-toast';
import { Languages, LoaderCircle, LogOut, Settings, WifiOff } from 'lucide-react';
import { useI18n } from '@/client/i18n/I18nProvider';
import { OWNER_KEY, byOwner, claimScans, deleteScans, listScans, rememberScanRows } from '@/client/scan-store';
import { signOutThenClear, unsavedScans, type UnsavedScans } from '@/client/sign-out';
import { clearOfflineCaches } from './ServiceWorkerRegister';
import { Button, Dialog } from './ui';
import { deviceOwnerAction, showSignedOutHeader } from './Navbar.state';
import styles from './Navbar.module.css';

/** Deletes this device's offline pages and preferences (`keep`: localStorage keys to leave). */
async function clearPagesAndPrefs(keep: string[] = []) {
  await clearOfflineCaches();
  try {
    Object.keys(localStorage).filter(k => k.startsWith('docsync_') && !keep.includes(k)).forEach(k => localStorage.removeItem(k));
  } catch {
    // storage unavailable: nothing to clear
  }
}

/**
 * The signed-in account's scans. Another account's are not this user's to count or delete: they
 * stay, still theirs (see claimDevice).
 */
async function ownScans(account: string | null) {
  return byOwner(await listScans(), account).mine;
}

/** Deletes this account's scans, offline pages and preferences (only once the server sign-out worked). */
async function clearDevice(account: string | null) {
  await deleteScans((await ownScans(account)).map(scan => scan.id));
  rememberScanRows(0);
  await clearPagesAndPrefs();
}

/**
 * Stamps the device with `account`. When another account was stamped, its offline pages and
 * preferences are deleted before anything shows them. Its scans are kept, without asking: they may
 * be the only copy of a photo or an unsaved save, Home hides them from this account and offers to
 * delete them (with Undo), and they come back when that account signs in again.
 */
async function claimDevice(account: string) {
  if (deviceOwnerAction(await claimScans(account), account) === 'clear') await clearPagesAndPrefs([OWNER_KEY]);
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
  /** Scans signing out would lose something of; the confirmation is open while this is set. */
  const [confirm, setConfirm] = useState<UnsavedScans | null>(null);
  /** The session fetched again after a failed check; next-auth itself doesn't retry until a reload. */
  const [recovered, setRecovered] = useState<Session | null>(null);
  /** An avatar that didn't load (weak network, blocked images, offline): the gear shows instead. */
  const [brokenAvatar, setBrokenAvatar] = useState<string | null>(null);
  const top = useRef<HTMLDivElement>(null);
  const signedOutView = showSignedOutHeader(pathname, status, signedIn);

  // Home claims the device too (the same claim, made once), so its recent scans list only this account's.
  useEffect(() => {
    if (account) void claimDevice(account);
  }, [account]);

  // What the shell pins to the top (the header, or only the offline banner when signed out) grows
  // with the banner, two lines in Hindi; sticky parts of pages sit under --app-header-h, not a guess.
  useEffect(() => {
    const element = top.current;
    if (!element || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => document.documentElement.style.setProperty('--app-header-h', `${element.offsetHeight}px`));
    observer.observe(element);
    return () => observer.disconnect();
  }, [signedOutView]);

  useEffect(() => {
    if (status !== 'unauthenticated') return;
    const refetch = () => { void getSession().then(setRecovered); };
    window.addEventListener('online', refetch);
    return () => window.removeEventListener('online', refetch);
  }, [status]);

  // Signed-out visitors only see /login and public pages like /privacy, which link back themselves.
  if (signedOutView) {
    return <div ref={top} className={styles.bannerOnly}><OfflineBanner /></div>;
  }
  const other = lang === 'en' ? 'hi' : 'en';
  const image = (session ?? recovered)?.user?.image;
  const avatar = image && image !== brokenAvatar ? image : null;

  async function signOutNow() {
    setConfirm(null);
    setSigningOut(true);
    try {
      const result = await signOutThenClear({
        isOnline: () => navigator.onLine,
        signOut: async () => { await signOut({ redirect: false, callbackUrl: '/login' }); },
        isSignedIn: async () => Boolean(await getSession()),
        clearDevice: () => clearDevice(account),
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
    const unsaved = unsavedScans(await ownScans(account));
    if (unsaved.notInSheet + unsaved.sheetOnly > 0) setConfirm(unsaved);
    else await signOutNow();
  }

  return (
    <header ref={top} className={styles.header}>
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
              <img className={styles.avatar} src={avatar} alt="" width={24} height={24} referrerPolicy="no-referrer" onError={() => setBrokenAvatar(avatar)} />
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
        open={confirm !== null}
        onClose={() => setConfirm(null)}
        title={t('nav.signOutConfirm.title')}
        description={
          <>
            {/* Rows already in the sheet are told apart: only their photo or Notion copy is lost. */}
            {confirm?.notInSheet ? <p>{t('nav.signOutConfirm.body', { count: confirm.notInSheet })}</p> : null}
            {confirm?.sheetOnly ? <p>{t('nav.signOutConfirm.sheetOnly', { count: confirm.sheetOnly })}</p> : null}
          </>
        }
        closeLabel={t('common.close')}
        actions={
          <>
            <Button variant="primary" onClick={() => setConfirm(null)}>{t('nav.signOutConfirm.stay')}</Button>
            <Button variant="danger" icon={<LogOut size={18} aria-hidden />} onClick={signOutNow}>{t('nav.signOutConfirm.delete')}</Button>
          </>
        }
      />
    </header>
  );
}
