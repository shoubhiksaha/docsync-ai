'use client';

import { useEffect } from 'react';
import { House } from 'lucide-react';
import { useI18n } from '@/client/i18n/I18nProvider';
import { ButtonLink, Card } from './components/ui';

/** Unknown document type, old shortcut or mistyped link: in the user's language, with a way back. */
export default function NotFound() {
  const { t } = useI18n();
  // Client components can't export metadata; without this the tab and route announcer keep the last title.
  useEffect(() => {
    const before = document.title;
    const title = `${t('notFound.title')} · DocSync AI`;
    document.title = title;
    // Put the old title back when this page goes away, unless the next page has set its own.
    return () => { if (document.title === title) document.title = before; };
  }, [t]);
  return (
    <main id="main" className="container page">
      <div style={{ maxWidth: 480, margin: '48px auto' }}>
        <Card as="div" heading="h1" title={t('notFound.title')} description={t('notFound.body')}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <ButtonLink href="/" variant="primary" icon={<House size={18} aria-hidden />}>{t('notFound.home')}</ButtonLink>
          </div>
        </Card>
      </div>
    </main>
  );
}
