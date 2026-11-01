'use client';

import { startTransition, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { House, RotateCcw } from 'lucide-react';
import { useI18n } from '@/client/i18n/I18nProvider';
import { reportError } from '@/client/telemetry';
import { Button, ButtonLink, Card } from './components/ui';

export default function RouteError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const { t } = useI18n();
  const router = useRouter();
  useEffect(() => {
    console.error('[ui] page error:', error);
    reportError(error, 'route', error.digest);
  }, [error]);

  // Home and the scan page are rendered on the server, so ask it for the page again; reset() alone
  // would re-render the payload that already failed.
  const retry = () => startTransition(() => {
    router.refresh();
    reset();
  });

  return (
    <main id="main" className="container page">
      <div style={{ maxWidth: 480, margin: '48px auto' }}>
        <Card as="div" title={t('errorPage.title')} description={t('errorPage.body')}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Button variant="primary" icon={<RotateCcw size={18} aria-hidden />} onClick={retry}>{t('common.retry')}</Button>
            <ButtonLink href="/" icon={<House size={18} aria-hidden />}>{t('errorPage.home')}</ButtonLink>
          </div>
        </Card>
      </div>
    </main>
  );
}
