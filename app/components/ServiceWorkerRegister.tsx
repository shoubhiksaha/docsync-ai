'use client';

import { useEffect, useRef } from 'react';
import { useSession } from 'next-auth/react';
import { useI18n } from '@/client/i18n/I18nProvider';
import { parseRecentApps, RECENT_APPS_COOKIE } from '@/client/scan-store';

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
function tellWorker(message: { type: string; urls?: string[]; lang?: string }) {
  navigator.serviceWorker?.controller?.postMessage(message);
}

/** True on a data-saver or 2G connection, where saving every page ahead of time would cost too much. */
function costlyConnection(): boolean {
  const connection = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
  return Boolean(connection?.saveData || connection?.effectiveType?.endsWith('2g'));
}

/** The scan pages of this device's recent document types (client/scan-store.ts RECENT_APPS_COOKIE). */
function recentPages(pages: string[]): string[] {
  const value = document.cookie.match(new RegExp(`(?:^|; )${RECENT_APPS_COOKIE}=([^;]*)`))?.[1];
  return parseRecentApps(value, pages.map(page => page.replace('/scan/', ''))).map(id => `/scan/${id}`);
}

/**
 * Registers the service worker that keeps the app installable and lets it open offline, and keeps
 * its saved pages useful: after a language switch they are saved again in the new language (each
 * old copy stays until its new one has arrived), and once signed in, every document type's scan
 * page (`pages`) is saved while the phone is idle, so any of them opens offline, not only the ones
 * opened before. On 2G or data saver only the recent document types' pages are, so the user's own
 * still open offline.
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

  // This page and Home first; the warm-up below replaces the other saved pages. Offline nothing can
  // be fetched, so the swap waits for a connection.
  useEffect(() => {
    if (lang === savedLang.current) return;
    const resave = () => {
      savedLang.current = lang;
      tellWorker({ type: 'warm', urls: [window.location.pathname, '/'], lang });
    };
    if (navigator.onLine) {
      resave();
      return;
    }
    window.addEventListener('online', resave, { once: true });
    return () => window.removeEventListener('online', resave);
  }, [lang]);

  useEffect(() => {
    if (status !== 'authenticated' || !navigator.onLine) return;
    const warm = () => tellWorker({ type: 'warm', urls: ['/', ...(costlyConnection() ? recentPages(pages) : pages)], lang });
    if ('requestIdleCallback' in window) {
      const id = window.requestIdleCallback(warm, { timeout: 10_000 });
      return () => window.cancelIdleCallback(id);
    }
    const id = setTimeout(warm, 5_000);
    return () => clearTimeout(id);
  }, [status, lang, pages]);

  return null;
}
