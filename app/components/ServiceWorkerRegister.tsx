'use client';

import { useEffect } from 'react';

const CACHE_PREFIX = 'docsync-';

/**
 * Deletes the offline copies of pages and assets (used on logout, so the next person on this
 * device can't open the previous session's pages offline). Never throws.
 */
export async function clearOfflineCaches(): Promise<void> {
  try {
    if ('caches' in window) {
      const keys = await caches.keys();
      await Promise.all(keys.filter(key => key.startsWith(CACHE_PREFIX)).map(key => caches.delete(key)));
    }
    navigator.serviceWorker?.controller?.postMessage({ type: 'clear' });
  } catch (err) {
    console.warn('Could not clear offline caches:', err);
  }
}

/** Registers the service worker that keeps the app installable and lets it open offline. */
export default function ServiceWorkerRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production' || !('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('/sw.js').catch(err => console.warn('Service worker registration failed:', err));
  }, []);
  return null;
}
