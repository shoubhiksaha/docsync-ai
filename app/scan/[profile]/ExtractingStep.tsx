'use client';
import { useEffect, useState } from 'react';
import { Check, Circle, Clock, LoaderCircle } from 'lucide-react';
import { useI18n } from '@/client/i18n/I18nProvider';
import type { MessageKey } from '@/client/i18n';
import { Button, Card } from '@/app/components/ui';
import { usePageUrls } from './usePageUrls';
import styles from './scan.module.css';

const STAGES: MessageKey[] = ['extract.sending', 'extract.reading', 'extract.checking'];
/** Typical time the AI takes to read a page once it has the photo. */
const READ_SECONDS = 8;

interface ExtractingStepProps {
  pages: Blob[];
  /** How much of the upload has been sent, 0 to 1. */
  uploaded: number;
  onCancel: () => void;
  /** Gives up on a slow connection without losing the photo (Recent scans). */
  onKeep: () => void;
}

/**
 * Feedback while the AI works (Doherty threshold): staged progress, an elapsed timer once it
 * takes longer than a few seconds, and placeholder rows where the fields will appear.
 */
export default function ExtractingStep({ pages, uploaded, onCancel, onKeep }: ExtractingStepProps) {
  const { t } = useI18n();
  const [preview] = usePageUrls(pages);
  const [seconds, setSeconds] = useState(0);
  const [readingFrom, setReadingFrom] = useState<number | null>(null);

  useEffect(() => {
    const started = Date.now();
    const id = setInterval(() => setSeconds(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (uploaded >= 1) setReadingFrom(from => from ?? seconds);
  }, [uploaded, seconds]);

  // Sending follows the real upload (slow on 2G); "checking" starts after the typical read time.
  const current = readingFrom === null ? 0 : seconds - readingFrom < READ_SECONDS ? 1 : 2;
  // In steps of 10, so a screen reader isn't read every single percent.
  const percent = Math.floor(uploaded * 10) * 10;

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
              {i === 0 && current === 0 && percent > 0 && <span className={styles.muted}>{t('extract.sent', { percent })}</span>}
            </li>
          ))}
        </ol>
        {seconds >= 3 && <p className={`${styles.muted} ${styles.small}`}>{t('extract.elapsed', { seconds })}</p>}
        <div className={styles.stack} aria-hidden>
          {[0, 1, 2, 3].map(i => <div key={i} className={`skeleton ${styles.skeletonRow}`} />)}
        </div>
        <div className={styles.row}>
          <Button onClick={onCancel}>{t('common.cancel')}</Button>
          <Button icon={<Clock size={18} aria-hidden />} onClick={onKeep}>{t('capture.keep')}</Button>
        </div>
      </Card>
    </div>
  );
}
