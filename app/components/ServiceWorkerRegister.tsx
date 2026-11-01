'use client';

import { useEffect, useRef } from 'react';
import { useSession } from 'next-auth/react';
import { useI18n } from '@/client/i18n/I18nProvider';

/** Saved pages (public/sw.js PAGES_CACHE); the session's HTML lives only here. */
const PAGES_PREFIX = 'docsync-pages-';

/**
 * Deletes the offline copies of pages (used on logout, so the next person on this device can't
 * open the previous session's pages offline). The static cache stays: the offline page, icons,
 * badge and content-hashed scripts hold no user data, and only the worker's install fills it.
 * Never throws.
 */
export async function clearOfflineCaches(): Promise<void> {
  try {
    if ('caches' in window) {
      const keys = await caches.keys();
      await Promise.all(keys.filter(key => key.startsWith(PAGES_PREFIX)).map(key => caches.delete(key)));
    }
    tellWorker({ type: 'clear' });
  } catch (err) {
    console.warn('Could not clear offline caches:', err);
  }
}

/** Tells the service worker something; does nothing without one (dev, first visit, old browsers). */
function tellWorker(message: { type: string; urls?: string[] }) {
  navigator.serviceWorker?.controller?.postMessage(message);
}

/** True on a data-saver or 2G connection, where saving pages ahead of time would cost too much. */
function costlyConnection(): boolean {
  const connection = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
  return Boolean(connection?.saveData || connection?.effectiveType?.endsWith('2g'));
}

/**
 * Registers the service worker that keeps the app installable and lets it open offline, and keeps
 * its saved pages useful: after a language switch they are saved again in the new language, and
 * once signed in, every document type's scan page (`pages`) is saved while the phone is idle, so
 * any of them opens offline, not only the ones opened before.
 */
export default function ServiceWorkerRegister({ pages }: { pages: string[] }) {
  const { lang } = useI18n();
  const { status } = useSession();
  const savedLang = useRef(lang);

  useEffect(() => {
    if (process.env.NODE_ENV !== 'production' || !('serviceWorker' in navigator)) return;
    // The build in the address installs a fresh worker on each deploy, which then replaces pages
    // saved by the old build (public/sw.js warm()).
    const build = encodeURIComponent(process.env.APP_BUILD_SHA ?? '');
    navigator.serviceWorker.register(`/sw.js?build=${build}`).catch(err => console.warn('Service worker registration failed:', err));
  }, []);

  // Offline the old copies are still better than none, so the swap waits for a connection.
  useEffect(() => {
    if (lang === savedLang.current) return;
    const resave = () => {
      savedLang.current = lang;
      tellWorker({ type: 'clear-pages', urls: [window.location.pathname, '/'] });
    };
    if (navigator.onLine) {
      resave();
      return;
    }
    window.addEventListener('online', resave, { once: true });
    return () => window.removeEventListener('online', resave);
  }, [lang]);

  useEffect(() => {
    if (status !== 'authenticated' || !navigator.onLine || costlyConnection()) return;
    const warm = () => tellWorker({ type: 'warm', urls: ['/', ...pages] });
    if ('requestIdleCallback' in window) {
      const id = window.requestIdleCallback(warm, { timeout: 10_000 });
      return () => window.cancelIdleCallback(id);
    }
    const id = setTimeout(warm, 5_000);
    return () => clearTimeout(id);
  }, [status, lang, pages]);

  return null;
}
