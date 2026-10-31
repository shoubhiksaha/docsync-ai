'use client';
import { useEffect, type ReactNode } from 'react';
import { SessionProvider } from 'next-auth/react';
import toast, { Toaster } from 'react-hot-toast';
import { I18nProvider, useI18n } from '@/client/i18n/I18nProvider';
import type { Lang } from '@/client/i18n';
import { installTelemetry } from '@/client/telemetry';

/** Toasts sit at the bottom, above the sticky action bar, so they never cover page titles. */
function AppToaster() {
  return (
    <Toaster
      position="bottom-center"
      containerStyle={{ bottom: 'calc(var(--bar-height) + 16px)' }}
      toastOptions={{
        duration: 4000,
        style: {
          background: 'var(--surface)',
          color: 'var(--text)',
          border: '1px solid var(--border)',
          boxShadow: 'var(--shadow-md)',
          maxWidth: 'min(480px, calc(100vw - 32px))',
        },
      }}
    />
  );
}

function ConnectionWatcher() {
  const { t } = useI18n();
  useEffect(() => {
    const offline = () => toast(t('toast.offline'), { id: 'connection', icon: '⚠️' });
    const online = () => toast.success(t('toast.online'), { id: 'connection' });
    window.addEventListener('offline', offline);
    window.addEventListener('online', online);
    return () => {
      window.removeEventListener('offline', offline);
      window.removeEventListener('online', online);
    };
  }, [t]);
  return null;
}

export function Providers({ lang, children }: { lang: Lang; children: ReactNode }) {
  useEffect(() => installTelemetry(), []);
  return (
    <SessionProvider>
      <I18nProvider lang={lang}>
        {children}
        <ConnectionWatcher />
        <AppToaster />
      </I18nProvider>
    </SessionProvider>
  );
}
