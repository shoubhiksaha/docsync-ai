'use client';
import { useEffect, useRef, useState } from 'react';
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
  /** Stops reading; the pages go back to the tray. */
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
  const root = useRef<HTMLDivElement>(null);

  // The button that started the reading is gone: focus moves here, so it isn't lost to the page.
  useEffect(() => root.current?.focus({ preventScroll: true }), []);

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
  // In steps of 10 on screen; a screen reader hears only the stage, and the upload at each quarter.
  const percent = Math.floor(uploaded * 10) * 10;
  const quarter = Math.floor(uploaded * 4) * 25;
  const announced = current === 0 && quarter > 0 && quarter < 100 ? `${t(STAGES[0])}: ${t('extract.sent', { percent: quarter })}` : t(STAGES[current]);

  return (
    <div ref={root} className={styles.extracting} role="region" aria-label={t('extract.title')} tabIndex={-1}>
      {/* eslint-disable-next-line @next/next/no-img-element -- local object URL preview */}
      {preview && <img src={preview} alt={t('review.photoTitle')} className={styles.photo} style={{ maxHeight: 360 }} />}
      <Card as="div" title={t('extract.title')}>
        <p className="sr-only" aria-live="polite">{announced}</p>
        <ol className={styles.stages}>
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
          {/* Stops the read and goes back to the pages, which stay: one can be added, retaken or removed. */}
          <Button onClick={onCancel}>{t('extract.stop')}</Button>
          <Button icon={<Clock size={18} aria-hidden />} onClick={onKeep}>{t('capture.keep')}</Button>
        </div>
      </Card>
    </div>
  );
}
