'use client';
import { useState, type DragEvent } from 'react';
import { Camera, FileUp, ImagePlus, RotateCcw, Sparkles, WifiOff } from 'lucide-react';
import { useI18n } from '@/client/i18n/I18nProvider';
import type { MessageKey } from '@/client/i18n';
import type { ErrorCode } from '@/client/scan-flow';
import { Badge, Button, ButtonLink, Notice } from '@/app/components/ui';
import { usePageUrls } from './usePageUrls';
import styles from './scan.module.css';

interface CaptureStepProps {
  documentName: string;
  pages: Blob[];
  error: ErrorCode | null;
  problem: MessageKey | null;
  preparing: boolean;
  offline: boolean;
  offlineSaved: boolean;
  remembered: { key: string; label: string }[] | null;
  sampleHref: string | null;
  onTakePhoto: () => void;
  onUpload: () => void;
  onFiles: (files: Blob[], source: 'drop') => void;
  onSample: () => void;
  onRetry: () => void;
  onOtherPhoto: () => void;
  onForget: () => void;
}

export default function CaptureStep(props: CaptureStepProps) {
  const { t } = useI18n();
  const [dragging, setDragging] = useState(false);
  const [preview] = usePageUrls(props.pages);

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const files = [...e.dataTransfer.files];
    if (files.length) props.onFiles(files, 'drop');
  };

  // Extraction failed: keep the photo, explain plainly, offer the two useful next steps.
  if (props.error && props.pages.length) {
    return (
      <div className={styles.stack}>
        <Notice tone="danger" title={t('error.extractTitle')} urgent>
          <p>{t(`error.${props.error}`)}</p>
        </Notice>
        {/* eslint-disable-next-line @next/next/no-img-element -- local object URL preview */}
        {preview && <img src={preview} alt={t('review.photoTitle')} className={styles.photo} style={{ maxHeight: 320 }} />}
        <div className={styles.row}>
          <Button variant="primary" icon={<RotateCcw size={18} aria-hidden />} onClick={props.onRetry}>{t('common.retry')}</Button>
          <Button icon={<ImagePlus size={18} aria-hidden />} onClick={props.onOtherPhoto}>{t('error.otherPhoto')}</Button>
        </div>
      </div>
    );
  }

  if (props.offlineSaved) {
    return (
      <div className={styles.stack}>
        <Notice tone="success" title={t('recent.status.offline')}>
          <p>{t('capture.offlineSaved')}</p>
        </Notice>
        <div className={styles.row}>
          <Button variant="primary" icon={<Camera size={18} aria-hidden />} onClick={props.onTakePhoto}>{t('done.scanNext')}</Button>
          <ButtonLink href="/">{t('done.home')}</ButtonLink>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.stack}>
      {props.offline && (
        <Notice tone="warning" title={t('toast.offline')}>
          <p>{t('capture.offline')}</p>
        </Notice>
      )}
      {props.problem && <Notice tone="danger" urgent>{t(props.problem)}</Notice>}

      <div
        className={`${styles.dropzone} ${dragging ? styles.dropzoneActive : ''}`}
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
      >
        <span className={styles.dropIcon} aria-hidden><Camera size={30} /></span>
        <h2 className={styles.captureTitle}>{t('capture.title', { name: props.documentName })}</h2>
        <p className={styles.captureHint}>{t('capture.hint')}</p>
        <div className={styles.captureButtons}>
          <Button variant="primary" size="lg" wrap icon={<Camera size={20} aria-hidden />} loading={props.preparing} onClick={props.onTakePhoto}>
            {t('capture.takePhoto')}
          </Button>
          <Button size="lg" wrap icon={<FileUp size={20} aria-hidden />} disabled={props.preparing} onClick={props.onUpload}>
            {t('capture.upload')}
          </Button>
        </div>
        <p className={styles.dropHint} aria-live="polite">{dragging ? t('capture.dropActive') : t('capture.drop')}</p>
        {props.sampleHref && (
          <Button variant="ghost" wrap icon={<Sparkles size={18} aria-hidden />} disabled={props.preparing} onClick={props.onSample}>
            {t('capture.sample', { name: props.documentName })}
          </Button>
        )}
      </div>

      {props.remembered && props.remembered.length > 0 && (
        <Notice tone="info" title={t('capture.remembered', { count: props.remembered.length })}>
          <ul className={styles.chips} style={{ justifyContent: 'flex-start' }}>
            {props.remembered.map(f => <li key={f.key}><Badge tone="accent">{f.label}</Badge></li>)}
          </ul>
          <div>
            <Button variant="ghost" onClick={props.onForget}>{t('capture.forget')}</Button>
          </div>
        </Notice>
      )}
      {props.offline && <p className={styles.dropHint}><WifiOff size={14} aria-hidden style={{ display: 'inline' }} /> {t('recent.offlineHint')}</p>}
    </div>
  );
}
