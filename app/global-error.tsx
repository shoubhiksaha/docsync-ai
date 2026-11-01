'use client';

import { useEffect, useSyncExternalStore } from 'react';
import { translate } from '@/client/i18n';
import { reportError } from '@/client/telemetry';

// Replaces the root layout when it fails, so no providers or global CSS are available here: the
// colours, language (docsync_lang cookie) and ADT badge follow public/offline.html instead.
const STYLE = `
  :root { --bg: #f4f6f5; --text: #0a0a0a; --muted: #4e5653; --accent: #01f9c9; --on-accent: #0a0a0a; --focus: #00735c; }
  @media (prefers-color-scheme: dark) {
    :root { --bg: #0a0a0a; --text: #f2f5f4; --muted: #a3ada9; --focus: #01f9c9; }
  }
  body { margin: 0; min-height: 100vh; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 16px; padding: 16px; box-sizing: border-box;
    background: var(--bg); color: var(--text); font: 16px/1.5 system-ui, sans-serif; }
  main { max-width: 420px; text-align: center; }
  h1 { font-size: 1.4rem; margin: 0 0 8px; }
  p { color: var(--muted); margin: 0 0 4px; }
  button { min-height: 48px; margin-top: 16px; padding: 10px 20px; border: none; border-radius: 8px; background: var(--accent); color: var(--on-accent); font: inherit; font-weight: 600; cursor: pointer; }
  button:focus-visible, a:focus-visible { outline: 3px solid var(--focus); outline-offset: 3px; }
  footer a { display: inline-flex; align-items: center; min-height: 44px; padding: 0 8px; border-radius: 8px; }
  footer img { display: block; }
`;

const COPY = {
  en: { lang: 'en', title: 'DocSync AI couldn’t load', body: 'Please try again in a moment.', retry: 'Try again' },
  hi: { lang: 'hi', title: 'DocSync AI लोड नहीं हो सका', body: 'कृपया थोड़ी देर में फिर कोशिश करें।', retry: 'फिर कोशिश करें' },
} as const;

const noSubscribe = () => () => undefined;
const cookieIsHindi = () => /(?:^|;\s*)docsync_lang=hi(?:;|$)/.test(document.cookie);

// Not reset(): that re-renders the root layout's payload that already failed on the server, so the
// button would do nothing. A full reload asks the server again.
const reload = () => window.location.reload();

export default function GlobalError({ error }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => reportError(error, 'global', error.digest), [error]);
  // The chosen language first, the other one under it in case the cookie can't be read.
  const hindi = useSyncExternalStore(noSubscribe, cookieIsHindi, () => false);
  const [first, second] = hindi ? [COPY.hi, COPY.en] : [COPY.en, COPY.hi];

  return (
    <html lang={first.lang}>
      <body>
        <style>{STYLE}</style>
        <main>
          <h1>{first.title}</h1>
          <p>{first.body}</p>
          <p lang={second.lang}>{second.title}. {second.body}</p>
          <button type="button" onClick={reload}>
            {first.retry} / <span lang={second.lang}>{second.retry}</span>
          </button>
        </main>
        <footer>
          <a href="https://analogdigital.tech" target="_blank" rel="noopener" aria-label={translate(first.lang, 'brand.offering')}>
            <picture>
              <source srcSet="/brand/offering-by-adt-inline-dark.svg" media="(prefers-color-scheme: dark)" />
              {/* eslint-disable-next-line @next/next/no-img-element -- tiny static SVG */}
              <img src="/brand/offering-by-adt-inline-light.svg" alt="" width={196} height={16} />
            </picture>
          </a>
        </footer>
      </body>
    </html>
  );
}
