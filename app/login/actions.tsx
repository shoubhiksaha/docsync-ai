'use client';
import { useEffect, useState } from 'react';
import { signIn } from 'next-auth/react';
import { Languages } from 'lucide-react';
import { useI18n } from '@/client/i18n/I18nProvider';
import styles from './login.module.css';

/** Google's multi-colour "G" mark, as required by the Sign in with Google branding guidelines. */
function GoogleMark() {
  return (
    <svg viewBox="0 0 48 48" width="20" height="20" aria-hidden focusable="false">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  );
}

/**
 * Starts Google sign-in, then returns to `callbackUrl` (already checked by safeCallbackUrl).
 * "google" is the neutral Sign in with Google button (Google's branding guidelines); "plain" is
 * the quieter button in the header. NextAuth makes a few round trips before Google opens, so the
 * button says so at once and ignores further taps until then.
 */
export function SignInButton({ label, variant, callbackUrl }: { label: string; variant: 'google' | 'plain'; callbackUrl: string }) {
  const { t } = useI18n();
  const [pending, setPending] = useState(false);

  // Coming back with the browser's Back button can restore the page as it was left, still pending.
  useEffect(() => {
    const reset = (event: PageTransitionEvent) => { if (event.persisted) setPending(false); };
    window.addEventListener('pageshow', reset);
    return () => window.removeEventListener('pageshow', reset);
  }, []);

  return (
    <button
      type="button"
      className={variant === 'google' ? styles.google : styles.signIn}
      disabled={pending}
      aria-busy={pending || undefined}
      onClick={() => {
        if (pending) return;
        setPending(true);
        signIn('google', { callbackUrl }).catch(() => setPending(false));
      }}
    >
      {pending ? <span className={styles.spinner} aria-hidden /> : variant === 'google' && <GoogleMark />}
      {pending ? t('login.opening') : label}
    </button>
  );
}

export function LanguageButton() {
  const { t, lang, setLang } = useI18n();
  const other = lang === 'en' ? 'hi' : 'en';
  return (
    <button type="button" className={styles.language} onClick={() => setLang(other)}>
      <Languages size={20} aria-hidden />
      <span lang={other}>{t('nav.switchLanguage')}</span>
      <span className="sr-only"> ({t('nav.switchLanguageLabel')})</span>
    </button>
  );
}
