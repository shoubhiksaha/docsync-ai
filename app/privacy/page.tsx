import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { serverI18n } from '@/client/i18n/server';
import type { MessageKey } from '@/client/i18n/en';
import styles from './privacy.module.css';

// What DocSync does with your documents and your Google account, in plain words. Public
// (middleware.ts) and linked from the sign-in page, which asks for Google access.

const SECTIONS = ['google', 'ai', 'records', 'kept', 'choices', 'contact'];

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await serverI18n();
  return { title: `${t('privacy.title')} · DocSync AI`, description: t('privacy.lead') };
}

export default async function PrivacyPage() {
  const { t } = await serverI18n();
  const k = (key: string) => t(key as MessageKey);
  return (
    <main id="main" className={`container page ${styles.page}`}>
      <h1 className={styles.title}>{t('privacy.title')}</h1>
      <p className={styles.lead}>{t('privacy.lead')}</p>
      {SECTIONS.map(key => (
        <section key={key} className={styles.section} aria-labelledby={`privacy-${key}`}>
          <h2 id={`privacy-${key}`}>{k(`privacy.${key}.title`)}</h2>
          <p>{k(`privacy.${key}.body`)}</p>
        </section>
      ))}
      <Link href="/" className={styles.back}>
        <ArrowLeft size={18} aria-hidden />
        {t('privacy.back')}
      </Link>
    </main>
  );
}
