'use client';
import { useEffect, useRef, useState, type DragEvent } from 'react';
import { Camera, Clock, Eye, FileUp, ImagePlus, Images, LogIn, RotateCcw, ScanText, Sparkles, WifiOff, X } from 'lucide-react';
import { useI18n } from '@/client/i18n/I18nProvider';
import type { MessageKey } from '@/client/i18n';
import { MAX_PAGES } from '@/client/images';
import type { ErrorCode } from '@/client/scan-flow';
import { Badge, Button, ButtonLink, Notice } from '@/app/components/ui';
import PhotoViewer from './PhotoViewer';
import { usePageUrls } from './usePageUrls';
import { useFieldName } from './fieldNames';
import styles from './scan.module.css';

interface CaptureStepProps {
  documentName: string;
  pages: Blob[];
  /** Camera photos taken so far, not read yet. */
  tray: Blob[];
  error: ErrorCode | null;
  problem: MessageKey | null;
  preparing: boolean;
  /** The sample document is downloading. */
  loadingSample: boolean;
  offline: boolean;
  offlineSaved: boolean;
  /** Offline, and the phone couldn't keep the photo: it is read once the connection is back. */
  waitingOnline: boolean;
  remembered: { key: string; label: string }[] | null;
  sampleHref: string | null;
  onTakePhoto: () => void;
  onUpload: () => void;
  onFiles: (files: Blob[], source: 'drop') => void;
  onSample: () => void;
  onReadTray: () => void;
  onRemoveTrayPage: (index: number) => void;
  onRetry: () => void;
  /** Saved on this device while offline, and the connection is back: read it now, same scan. */
  onReadNow: () => void;
  onKeep: () => void;
  /** The session ended while reading: keep the photo and sign in again. */
  onSignIn: () => void;
  /** Nothing could be read: take the photo again with the camera. */
  onRetake: () => void;
  /** Puts the pages back in the tray (same scan), so one can be retaken or removed. */
  onBackToPages: () => void;
  onOtherPhoto: () => void;
  onForget: () => void;
}

/** Errors where trying again later can work, so the photo can wait on this phone meanwhile. */
const KEEPABLE: ErrorCode[] = ['network', 'slow', 'unavailable', 'quota', 'rate_limited'];
/** Errors that sending the same pages again can't fix. */
const NOT_RETRYABLE: ErrorCode[] = ['bad_input', 'too_large', 'session'];

function PageTray(props: CaptureStepProps) {
  const { t } = useI18n();
  const [dragging, setDragging] = useState(false);
  /** The page open in the viewer. */
  const [viewing, setViewing] = useState<number | null>(null);
  const urls = usePageUrls(props.tray);
  const count = props.tray.length;

  // A file dropped here joins the tray instead of opening in the browser tab.
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const files = [...e.dataTransfer.files];
    if (files.length) props.onFiles(files, 'drop');
  };

  return (
    <div
      className={`${styles.dropzone} ${dragging ? styles.dropzoneActive : ''}`}
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
    >
      <h2 className={styles.captureTitle}>{t('capture.trayTitle', { count })}</h2>
      <ul className={styles.tray} data-single={count === 1 || undefined}>
        {urls.map((url, i) => (
          <li key={url} className={styles.trayPage}>
            <button type="button" className={styles.trayPhoto} aria-label={t('capture.viewPage', { n: i + 1 })} title={t('capture.viewPage', { n: i + 1 })} onClick={() => setViewing(i)}>
              {/* eslint-disable-next-line @next/next/no-img-element -- local object URL preview */}
              <img src={url} alt="" />
              <span className={styles.thumbIcon} aria-hidden><Eye size={16} /></span>
            </button>
            <Button variant="ghost" icon={<X size={18} aria-hidden />} aria-label={t('capture.removePage', { n: i + 1 })} onClick={() => props.onRemoveTrayPage(i)}>
              {t('capture.removeShort')}
            </Button>
          </li>
        ))}
      </ul>
      <PhotoViewer
        urls={viewing !== null && urls[viewing] ? [urls[viewing]] : []}
        open={viewing !== null && Boolean(urls[viewing])}
        onClose={() => setViewing(null)}
        title={viewing !== null ? t('review.page', { n: viewing + 1 }) : undefined}
      />
      <div className={styles.captureButtons}>
        <Button variant="primary" size="lg" wrap icon={<ScanText size={20} aria-hidden />} disabled={props.preparing} onClick={props.onReadTray}>
          {count > 1 ? t('capture.readPages', { count }) : t('capture.readPage')}
        </Button>
        {count < MAX_PAGES && (
          <>
            <Button size="lg" wrap icon={<Camera size={20} aria-hidden />} loading={props.preparing} onClick={props.onTakePhoto}>
              {t('capture.addPage')}
            </Button>
            <Button size="lg" wrap icon={<FileUp size={20} aria-hidden />} disabled={props.preparing} onClick={props.onUpload}>
              {t('capture.uploadPage')}
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

export default function CaptureStep(props: CaptureStepProps) {
  const { t } = useI18n();
  const fieldName = useFieldName();
  const [dragging, setDragging] = useState(false);
  const [preview] = usePageUrls(props.pages);
  const errorRef = useRef<HTMLDivElement>(null);

  // The reading screen (and the button that had focus) is gone: focus moves to what went wrong.
  useEffect(() => {
    if (props.error) errorRef.current?.focus({ preventScroll: true });
  }, [props.error]);

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const files = [...e.dataTransfer.files];
    if (files.length) props.onFiles(files, 'drop');
  };

  // Extraction failed: keep the photo, explain plainly, offer the useful next steps.
  if (props.error && props.pages.length) {
    // The photos are already JPEGs made on this phone, so a photo the server can't use is one with
    // nothing readable on it (blurry, dark, glare): the way on is a better photo, not the same one again.
    const unreadable = props.error === 'bad_input';
    const severalPages = props.pages.length > 1;
    return (
      <div className={styles.stack}>
        <div ref={errorRef} tabIndex={-1}>
          <Notice tone="danger" title={t('error.extractTitle')} urgent>
            <p>{unreadable ? t('error.unreadable') : t(`error.${props.error}`)}</p>
          </Notice>
        </div>
        {/* eslint-disable-next-line @next/next/no-img-element -- local object URL preview */}
        {preview && <img src={preview} alt={t('review.photoTitle')} className={styles.photo} style={{ maxHeight: 320 }} />}
        <div className={styles.row}>
          {/* Retrying can't help an ended session: sign in, and the photo is read afterwards. */}
          {props.error === 'session' && <Button variant="primary" icon={<LogIn size={18} aria-hidden />} onClick={props.onSignIn}>{t('review.signIn')}</Button>}
          {unreadable && !severalPages && <Button variant="primary" icon={<Camera size={18} aria-hidden />} onClick={props.onRetake}>{t('error.retake')}</Button>}
          {!NOT_RETRYABLE.includes(props.error) && <Button variant="primary" icon={<RotateCcw size={18} aria-hidden />} onClick={props.onRetry}>{t('common.retry')}</Button>}
          {/* Several pages: back to them, to retake or remove just the bad one. */}
          {severalPages && (
            <Button variant={unreadable ? 'primary' : 'secondary'} icon={<Images size={18} aria-hidden />} onClick={props.onBackToPages}>{t('error.backToPages')}</Button>
          )}
          {/* The photo can wait on this phone (Recent scans) instead of being lost. */}
          {KEEPABLE.includes(props.error) && <Button icon={<Clock size={18} aria-hidden />} onClick={props.onKeep}>{t('capture.keep')}</Button>}
          <Button icon={<ImagePlus size={18} aria-hidden />} onClick={props.onOtherPhoto}>{t('error.otherPhoto')}</Button>
        </div>
      </div>
    );
  }

  if (props.waitingOnline && props.pages.length) {
    return (
      <div className={styles.stack}>
        <Notice tone="warning" title={t('toast.offline')} urgent>
          <p>{t('capture.notKept')}</p>
        </Notice>
        {/* eslint-disable-next-line @next/next/no-img-element -- local object URL preview */}
        {preview && <img src={preview} alt={t('review.photoTitle')} className={styles.photo} style={{ maxHeight: 320 }} />}
        <div className={styles.row}>
          <Button icon={<ImagePlus size={18} aria-hidden />} onClick={props.onOtherPhoto}>{t('error.otherPhoto')}</Button>
        </div>
      </div>
    );
  }

  // The connection came back while this screen was open: the photo can be read now, not via Recent scans.
  if (props.offlineSaved && !props.offline && props.pages.length) {
    return (
      <div className={styles.stack}>
        <Notice tone="success" title={t('toast.online')}>
          <p>{t('capture.backOnline')}</p>
        </Notice>
        <div className={styles.row}>
          <Button variant="primary" icon={<ScanText size={18} aria-hidden />} onClick={props.onReadNow}>{t('capture.readNow')}</Button>
          <Button icon={<Camera size={18} aria-hidden />} onClick={props.onTakePhoto}>{t('done.scanNext')}</Button>
          <ButtonLink href="/">{t('done.home')}</ButtonLink>
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

  if (props.tray.length) {
    return (
      <div className={styles.stack}>
        {props.offline && (
          <Notice tone="warning" title={t('toast.offline')}>
            <p>{t('capture.offline')}</p>
          </Notice>
        )}
        {props.problem && <Notice tone="danger" urgent>{t(props.problem)}</Notice>}
        <PageTray {...props} />
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
          <Button variant="primary" size="lg" wrap icon={<Camera size={20} aria-hidden />} loading={props.preparing} disabled={props.loadingSample} onClick={props.onTakePhoto}>
            {t('capture.takePhoto')}
          </Button>
          <Button size="lg" wrap icon={<FileUp size={20} aria-hidden />} disabled={props.preparing || props.loadingSample} onClick={props.onUpload}>
            {t('capture.upload')}
          </Button>
        </div>
        {/* Dragging and pasting need a mouse: phones only ever see the "Drop" state, never the hint. */}
        <p className={`${styles.dropHint} ${dragging ? '' : styles.pointerOnly}`} aria-live="polite">{dragging ? t('capture.dropActive') : t('capture.drop')}</p>
        {props.sampleHref && (
          <Button variant="ghost" wrap icon={<Sparkles size={18} aria-hidden />} disabled={props.preparing} loading={props.loadingSample} onClick={props.onSample}>
            {t('capture.sample', { name: props.documentName })}
          </Button>
        )}
      </div>

      {props.remembered && props.remembered.length > 0 && (
        <Notice tone="info" title={t('capture.remembered', { count: props.remembered.length })}>
          <ul className={styles.chips} style={{ justifyContent: 'flex-start' }}>
            {props.remembered.map(f => <li key={f.key}><Badge tone="accent">{fieldName(f)}</Badge></li>)}
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
