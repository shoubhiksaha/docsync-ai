import type { Metadata } from 'next';
import Link from 'next/link';
import { Fragment } from 'react';
import { ArrowLeft } from 'lucide-react';
import { serverI18n } from '@/client/i18n/server';
import { privacyBackHref } from '@/app/login/callback-url';
import { POLICY, POLICY_UPDATED } from './policy';
import styles from './privacy.module.css';

// The privacy policy (policy.ts), in the visitor's language. Public (middleware.ts), linked from
// the sign-in page and the landing page's footer, and the address given to Google's OAuth
// verification and the Play Store listing.

const URL_PATTERN = /(https:\/\/[^\s),]+[^\s),.;:]|[\w.+-]+@[\w-]+(?:\.[\w-]+)+)/;
/** Google permission names look like addresses but open no page, so they stay plain text. */
const SCOPE_PREFIX = 'https://www.googleapis.com/auth/';

/** Plain text with its email and https:// addresses (other than permission names) as links. */
function Linked({ text }: { text: string }) {
  return (
    <>
      {text.split(URL_PATTERN).map((part, i) => {
        if (i % 2 === 0 || part.startsWith(SCOPE_PREFIX)) return <Fragment key={i}>{part}</Fragment>;
        return part.includes('@')
          ? <a key={i} href={`mailto:${part}`}>{part}</a>
          : <a key={i} href={part} rel="noopener">{part.replace(/^https:\/\//, '')}</a>;
      })}
    </>
  );
}

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await serverI18n();
  return { title: `${t('privacy.title')} · DocSync AI`, description: t('privacy.lead') };
}

export default async function PrivacyPage({ searchParams }: { searchParams: Promise<{ callbackUrl?: string | string[] }> }) {
  const [{ t, lang }, query] = await Promise.all([serverI18n(), searchParams]);
  const policy = POLICY[lang];
  // Opened from the sign-in page with a shared link pending (/scan/…): back keeps it.
  const back = privacyBackHref(query.callbackUrl);
  return (
    <main id="main" className={`container page ${styles.page}`}>
      <h1 className={styles.title}>{t('privacy.title')}</h1>
      <p className={styles.lead}>{t('privacy.lead')}</p>
      <p className={styles.updated}><time dateTime={POLICY_UPDATED}>{policy.updated}</time></p>
      <nav className={styles.contents} aria-label={t('privacy.contents')}>
        <ol>
          {policy.sections.map(s => <li key={s.id}><a href={`#${s.id}`}>{s.title}</a></li>)}
        </ol>
      </nav>
      {policy.sections.map(section => (
        <section key={section.id} id={section.id} className={styles.section} aria-labelledby={`privacy-${section.id}`}>
          <h2 id={`privacy-${section.id}`}>{section.title}</h2>
          {section.blocks.map((block, i) => (typeof block === 'string'
            ? <p key={i}><Linked text={block} /></p>
            : <ul key={i}>{block.map((item, j) => <li key={j}><Linked text={item} /></li>)}</ul>))}
        </section>
      ))}
      <Link href={back} className={styles.back}>
        <ArrowLeft size={18} aria-hidden />
        {t('privacy.back')}
      </Link>
    </main>
  );
}
