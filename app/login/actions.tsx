'use client';
import { useEffect, useId, useRef, useState, useSyncExternalStore, useTransition, type ReactNode } from 'react';
import { signIn } from 'next-auth/react';
import toast from 'react-hot-toast';
import { ArrowRight, Languages } from 'lucide-react';
import { LANG_COOKIE } from '@/client/i18n';
import { useI18n } from '@/client/i18n/I18nProvider';
import { signInGate } from './sign-in-gate';
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
 * Starts Google sign-in, then returns to `callbackUrl`. NextAuth makes a few round trips before
 * Google opens, so the control that was tapped says so at once, and every sign-in control on the
 * page ignores taps until Google opens, the timeout passes or the visitor comes back with Back.
 */
function useSignIn(callbackUrl: string) {
  const { t } = useI18n();
  const id = useId();
  const owner = useSyncExternalStore(signInGate.subscribe, signInGate.owner, () => null);

  // Coming back with the browser's Back button can restore the page as it was left, still busy.
  useEffect(() => {
    const reset = (event: PageTransitionEvent) => { if (event.persisted) signInGate.reset(); };
    window.addEventListener('pageshow', reset);
    return () => window.removeEventListener('pageshow', reset);
  }, []);

  const start = () => {
    const outcome = signInGate.start(id, {
      isOnline: () => navigator.onLine,
      signIn: () => signIn('google', { callbackUrl }),
      onSlow: () => toast(t('login.slow'), { id: 'sign-in' }),
    });
    if (outcome === 'offline') toast(t('login.offline'), { id: 'sign-in' });
  };
  return { busy: owner !== null, mine: owner === id, start };
}

/**
 * Starts Google sign-in, then returns to `callbackUrl` (already checked by safeCallbackUrl).
 * "google" is the neutral Sign in with Google button (Google's branding guidelines); "plain" is
 * the quieter button in the header. While Google opens, the button says so.
 */
export function SignInButton({ label, variant, callbackUrl }: { label: string; variant: 'google' | 'plain'; callbackUrl: string }) {
  const { t } = useI18n();
  const { busy, mine, start } = useSignIn(callbackUrl);

  // aria-disabled, not disabled, so focus stays on the button while Google opens.
  return (
    <button
      type="button"
      className={variant === 'google' ? styles.google : styles.signIn}
      aria-disabled={busy || undefined}
      aria-busy={mine || undefined}
      onClick={start}
    >
      {mine ? <span className={styles.spinner} aria-hidden /> : variant === 'google' && <GoogleMark />}
      {mine ? t('login.opening') : label}
    </button>
  );
}

/**
 * A document name on the landing page that signs in straight into that document's scan screen,
 * so a visitor who found their slip here doesn't look for it again on Home. A link, not a button
 * (the page keeps one "Sign in with Google" button); without JavaScript the href opens /login
 * with the same callbackUrl. Ctrl/Cmd-click still opens it in a new tab.
 */
export function StartLink({ name, label, callbackUrl }: { name: string; label: string; callbackUrl: string }) {
  const { busy, mine, start } = useSignIn(callbackUrl);
  return (
    <a
      href={`/login?callbackUrl=${encodeURIComponent(callbackUrl)}`}
      className={styles.docLink}
      aria-label={label}
      aria-disabled={busy || undefined}
      aria-busy={mine || undefined}
      onClick={event => {
        if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        start();
      }}
    >
      {name}
      {mine ? <span className={styles.spinner} aria-hidden /> : <ArrowRight size={14} aria-hidden />}
    </a>
  );
}

/**
 * One kind of work's document links, folded under its name on phones (six open lists made one
 * long column of 28 links there) and open on wider screens, where the cards sit side by side. It
 * starts folded, so on a slow phone the lists never snap shut under the visitor once JavaScript
 * arrives. On wide screens CSS shows the links until then (login.module.css).
 *
 * The heading comes before the <details>: inside <summary> it would be read as part of a button
 * and left out of the screen reader's list of headings. The summary shows the same name.
 */
export function DocGroup({ title, count, children }: { title: ReactNode; count: string; children: ReactNode }) {
  const id = useId();
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    if (window.matchMedia('(min-width: 640px)').matches) ref.current.open = true;
    ref.current.dataset.ready = '';
  }, []);
  return (
    <>
      <h3 id={`${id}-title`} className="sr-only">{title}</h3>
      <details ref={ref} className={styles.groupDetails}>
        <summary className={styles.groupSummary} aria-labelledby={`${id}-title ${id}-count`}>
          <span className={styles.groupTitle} aria-hidden>{title}</span>
          <span id={`${id}-count`} className={styles.groupCount}>{count}</span>
        </summary>
        {children}
      </details>
    </>
  );
}

/**
 * The header's language switch and Sign in. On narrow phones the header only has room for Sign in
 * once the hero's Sign in with Google (element `heroId`) has scrolled out of view; the language
 * button then shortens to "हि" / "EN" to make room.
 */
export function HeaderActions({ signInLabel, callbackUrl, heroId }: { signInLabel: string; callbackUrl: string; heroId: string }) {
  const [heroInView, setHeroInView] = useState(true);
  useEffect(() => {
    const cta = document.getElementById(heroId);
    if (!cta || typeof IntersectionObserver === 'undefined') return;
    // The sticky header covers the top 64px, so a button under it counts as gone.
    const observer = new IntersectionObserver(([entry]) => setHeroInView(entry.isIntersecting), { rootMargin: '-64px 0px 0px 0px' });
    observer.observe(cta);
    return () => observer.disconnect();
  }, [heroId]);
  return (
    <div className={styles.headerActions} data-hero-in-view={heroInView || undefined}>
      <LanguageButton />
      <SignInButton variant="plain" label={signInLabel} callbackUrl={callbackUrl} />
    </div>
  );
}

/**
 * Nearly all of this page is rendered on the server, so the switch runs as a transition: the
 * button and the page change language together once the refresh arrives, and taps in between are
 * ignored instead of switching straight back.
 */
export function LanguageButton() {
  const { t, lang, setLang } = useI18n();
  const [switching, startSwitch] = useTransition();
  const other = lang === 'en' ? 'hi' : 'en';

  // A first visit is shown in the phone's language (serverI18n); keep it, so the parts that read
  // only the cookie (voice notes, sync warnings, the error page) use the same language.
  useEffect(() => {
    if (!document.cookie.split(/;\s*/).some(c => c.startsWith(`${LANG_COOKIE}=`))) {
      document.cookie = `${LANG_COOKIE}=${lang}; path=/; max-age=31536000; samesite=lax`;
    }
  }, [lang]);

  return (
    <button
      type="button"
      className={styles.language}
      aria-disabled={switching || undefined}
      aria-busy={switching || undefined}
      onClick={() => { if (!switching) startSwitch(() => setLang(other)); }}
    >
      {switching ? <span className={styles.spinner} aria-hidden /> : <Languages size={20} aria-hidden />}
      <span lang={other} className={styles.languageName}>{t('nav.switchLanguage')}</span>
      <span lang={other} className={styles.languageShort} aria-hidden>{t('login.languageShort')}</span>
      <span className="sr-only"> ({t('nav.switchLanguageLabel')})</span>
    </button>
  );
}
