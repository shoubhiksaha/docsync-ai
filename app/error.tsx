'use client';

import { useEffect } from 'react';
import { House, RotateCcw } from 'lucide-react';
import { useI18n } from '@/client/i18n/I18nProvider';
import { reportError } from '@/client/telemetry';
import { Button, ButtonLink, Card } from './components/ui';

export default function RouteError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const { t } = useI18n();
  useEffect(() => {
    console.error('[ui] page error:', error);
    reportError(error, 'route', error.digest);
  }, [error]);

  return (
    <main id="main" className="container page">
      <div style={{ maxWidth: 480, margin: '48px auto' }}>
        <Card as="div" title={t('errorPage.title')} description={t('errorPage.body')}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Button variant="primary" icon={<RotateCcw size={18} aria-hidden />} onClick={reset}>{t('common.retry')}</Button>
            <ButtonLink href="/" icon={<House size={18} aria-hidden />}>{t('errorPage.home')}</ButtonLink>
          </div>
        </Card>
      </div>
    </main>
  );
}
