'use client';
import { useEffect, useState } from 'react';
import { Check, Circle, LoaderCircle } from 'lucide-react';
import { useI18n } from '@/client/i18n/I18nProvider';
import type { MessageKey } from '@/client/i18n';
import { Button, Card } from '@/app/components/ui';
import { usePageUrls } from './usePageUrls';
import styles from './scan.module.css';

const STAGES: MessageKey[] = ['extract.preparing', 'extract.reading', 'extract.checking'];

/**
 * Feedback while the AI works (Doherty threshold): staged progress, an elapsed timer once it
 * takes longer than a few seconds, and placeholder rows where the fields will appear.
 */
export default function ExtractingStep({ pages, onCancel }: { pages: Blob[]; onCancel: () => void }) {
  const { t } = useI18n();
  const [preview] = usePageUrls(pages);
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    const started = Date.now();
    const id = setInterval(() => setSeconds(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(id);
  }, []);

  // The upload is done almost at once; "checking" starts after the typical read time.
  const current = seconds < 1 ? 0 : seconds < 8 ? 1 : 2;

  return (
    <div className={styles.extracting}>
      {/* eslint-disable-next-line @next/next/no-img-element -- local object URL preview */}
      {preview && <img src={preview} alt={t('review.photoTitle')} className={styles.photo} style={{ maxHeight: 360 }} />}
      <Card as="div" title={t('extract.title')}>
        <ol className={styles.stages} aria-live="polite">
          {STAGES.map((stage, i) => (
            <li key={stage} className={`${styles.stage} ${i === current ? styles.stageCurrent : ''} ${i < current ? styles.stageDone : ''}`}>
              {i < current ? <Check size={18} aria-hidden /> : i === current ? <LoaderCircle size={18} className="spin" aria-hidden /> : <Circle size={18} aria-hidden />}
              {t(stage)}
            </li>
          ))}
        </ol>
        {seconds >= 3 && <p className={`${styles.muted} ${styles.small}`}>{t('extract.elapsed', { seconds })}</p>}
        <div className={styles.stack} aria-hidden>
          {[0, 1, 2, 3].map(i => <div key={i} className={`skeleton ${styles.skeletonRow}`} />)}
        </div>
        <div>
          <Button onClick={onCancel}>{t('common.cancel')}</Button>
        </div>
      </Card>
    </div>
  );
}
