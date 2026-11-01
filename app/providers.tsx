'use client';
import { useEffect, type ReactNode } from 'react';
import { SessionProvider } from 'next-auth/react';
import toast, { ToastBar, Toaster, type Toast } from 'react-hot-toast';
import { X } from 'lucide-react';
import { I18nProvider, useI18n } from '@/client/i18n/I18nProvider';
import type { Lang } from '@/client/i18n';
import { installTelemetry } from '@/client/telemetry';
import { IconButton } from './components/ui';

/** Long enough to read a two-line Devanagari message in glare: 10 s plus 60 ms a character. */
function readingTime(message: Toast['message']): number {
  return 10_000 + 60 * (typeof message === 'string' ? message.length : 0);
}

/**
 * Times messages and errors that didn't set their own duration by their length. react-hot-toast
 * only pauses on mouse hover, so a fixed 4 s left phone users no way to finish reading.
 */
function ReadingTimer({ item }: { item: Toast }) {
  const { id, type, duration, visible, message, createdAt } = item;
  useEffect(() => {
    if (duration !== Infinity || type === 'loading' || !visible) return;
    const timer = setTimeout(() => toast.dismiss(id), readingTime(message));
    return () => clearTimeout(timer);
  }, [id, type, duration, visible, message, createdAt]);
  return null;
}

/**
 * Toasts sit at the bottom, above the sticky action bar, so they never cover page titles. Each has
 * a close button; errors are announced at once (role="alert", where react-hot-toast uses "status").
 */
function AppToaster() {
  const { t } = useI18n();
  return (
    <Toaster
      position="bottom-center"
      containerStyle={{ bottom: 'calc(var(--bar-height) + 16px)' }}
      toastOptions={{
        // Confirmations are short; everything else is timed by ReadingTimer.
        duration: Infinity,
        success: { duration: 4000 },
        style: {
          background: 'var(--surface)',
          color: 'var(--text)',
          border: '1px solid var(--border)',
          boxShadow: 'var(--shadow-md)',
          maxWidth: 'min(480px, calc(100vw - 32px))',
        },
      }}
    >
      {item => (
        <ToastBar toast={item.type === 'error' ? { ...item, ariaProps: { role: 'alert', 'aria-live': 'assertive' } } : item}>
          {({ icon, message }) => (
            <>
              {icon}
              {message}
              <IconButton label={t('common.close')} icon={<X size={18} aria-hidden />} onClick={() => toast.dismiss(item.id)} />
              <ReadingTimer item={item} />
            </>
          )}
        </ToastBar>
      )}
    </Toaster>
  );
}

/** Going offline shows a lasting banner under the header (Navbar); coming back gets a short toast. */
function ConnectionWatcher() {
  const { t } = useI18n();
  useEffect(() => {
    const online = () => toast.success(t('toast.online'), { id: 'connection' });
    window.addEventListener('online', online);
    return () => window.removeEventListener('online', online);
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
