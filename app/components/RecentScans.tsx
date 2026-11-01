'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { signIn } from 'next-auth/react';
import toast from 'react-hot-toast';
import { Clock, LogIn, RotateCcw, X } from 'lucide-react';
import { useI18n } from '@/client/i18n/I18nProvider';
import { ApiError, syncRecord } from '@/client/api';
import { DESTINATIONS, mergeRetry, type Destination, type SaveResult } from '@/client/scan-flow';
import { deleteScan, getScan, listScans, putScan, rememberScanRows, SCANS_CHANGED, type ScanRows, type StoredScan } from '@/client/scan-store';
import { track } from '@/client/telemetry';
import { normalizeKey } from '@/core/text';
import { Badge, Button, ButtonLink, IconButton, buttonClass, type Tone } from './ui';
import styles from './RecentScans.module.css';

const STATUS_TONE: Record<StoredScan['status'], Tone> = { offline: 'accent', saved: 'success', partial: 'warning', failed: 'danger' };
const VISIBLE = 5;
// On phones a row's buttons wrap under its text, so fewer rows show before the document types (the CSS folds the rest).
const PHONE_VISIBLE = 2;
// Waiting photos past this many get a warning: each one holds a full photo on the phone.
const MANY_WAITING = 20;
// Scans that still need something from the user come first.
const PRIORITY: Record<StoredScan['status'], number> = { offline: 0, failed: 1, partial: 2, saved: 3 };

function failedOf(scan: StoredScan): Destination[] {
  return DESTINATIONS.filter(d => scan.destinations?.[d]?.status === 'failed');
}

/** Value of the first field whose key or label is one of `keys` (like the profiles' fieldValue). */
function valueOf(scan: StoredScan, keys: string[]): string | undefined {
  const wanted = new Set(keys.map(normalizeKey));
  return scan.fields?.find(f => wanted.has(normalizeKey(f.key)) || wanted.has(normalizeKey(f.label)))?.value?.trim() || undefined;
}

interface Props {
  profileNames: Record<string, string>;
  /** Per profile, the field keys that name one document (customer, vehicle, …). */
  titleKeys: Record<string, string[]>;
  /** What the last visit showed; its space is kept while this device's scans load. */
  expected: ScanRows;
}

/**
 * Scans kept on this device: offline captures to process and saves with a destination to retry,
 * then finished saves folded into one line so they don't push the document types down.
 */
export default function RecentScans({ profileNames, titleKeys, expected }: Props) {
  const { t, lang } = useI18n();
  // null until IndexedDB answers.
  const [scans, setScans] = useState<StoredScan[] | null>(null);
  // Retries in flight, per row. The ref blocks a second send before the re-render shows the spinner.
  const [busy, setBusy] = useState<ReadonlySet<string>>(() => new Set());
  const sending = useRef(new Set<string>());
  // Set when a retry finds the Google sign-in has ended; signing in again keeps the scans on this device.
  const [sessionEnded, setSessionEnded] = useState(false);
  const [online, setOnline] = useState(true);
  const [showAll, setShowAll] = useState(false);

  const refresh = useCallback(() => {
    listScans().then(all => {
      const shown = all.filter(s => profileNames[s.profileId]).sort((a, b) => PRIORITY[a.status] - PRIORITY[b.status] || b.updatedAt - a.updatedAt);
      setScans(shown);
      const waiting = shown.filter(s => s.status !== 'saved').length;
      // One past VISIBLE says a "Show all" button is coming too.
      rememberScanRows(Math.min(waiting, VISIBLE + 1), waiting < shown.length);
    });
  }, [profileNames]);

  useEffect(() => {
    refresh();
    setOnline(navigator.onLine);
    const update = () => setOnline(navigator.onLine);
    window.addEventListener(SCANS_CHANGED, refresh);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener(SCANS_CHANGED, refresh);
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, [refresh]);

  if (scans === null) {
    if (expected.rows === 0 && !expected.history) return null;
    return (
      <section className={styles.section} aria-labelledby="recent-title" aria-busy>
        <h2 id="recent-title" className={styles.title}>{t('recent.title')}</h2>
        {expected.rows > 0 && (
          <ul className={`${styles.list} ${styles.folded}`} aria-hidden>
            {Array.from({ length: Math.min(expected.rows, VISIBLE) }, (_, i) => <li key={i} className={`${styles.item} ${styles.placeholder}`} />)}
          </ul>
        )}
        {expected.rows > PHONE_VISIBLE && <div className={`${styles.showAllPlaceholder} ${expected.rows > VISIBLE ? '' : styles.phoneOnly}`} aria-hidden />}
        {expected.history && <div className={styles.historyPlaceholder} aria-hidden />}
      </section>
    );
  }
  if (scans.length === 0) return null;

  const remove = async (scan: StoredScan) => {
    await deleteScan(scan.id);
    // Kept in memory for a few seconds so a mis-tap can be undone.
    toast(toastItem => (
      <span className={styles.undo}>
        {t(scan.status === 'saved' ? 'recent.removed' : 'recent.deleted')}
        <Button variant="ghost" onClick={() => { toast.dismiss(toastItem.id); void putScan(scan); }}>{t('recent.undo')}</Button>
      </span>
    ), { id: `removed-${scan.id}`, duration: 6000 });
  };

  const retry = async (scan: StoredScan) => {
    const only = failedOf(scan);
    if (!scan.fields?.length || only.length === 0 || sending.current.has(scan.id)) return;
    sending.current.add(scan.id);
    setBusy(new Set(sending.current));
    track('retry', { profile: scan.profileId, destination: only.join(',') });
    try {
      const outcome = await syncRecord({ profileId: scan.profileId, fields: scan.fields, archive: scan.archive ?? null, note: scan.note ?? '', audio: scan.audio ?? null, only, duplicateAction: 'keep_both' });
      // Deleted elsewhere while this ran (another tab): don't bring it back.
      if (outcome.kind === 'saved' && await getScan(scan.id)) {
        setSessionEnded(false);
        const previous: SaveResult = { status: scan.status === 'saved' ? 'saved' : scan.status === 'partial' ? 'partial' : 'failed', destinations: scan.destinations ?? {}, warnings: [] };
        const merged = mergeRetry(previous, outcome.result);
        await putScan({ ...scan, status: merged.status, destinations: merged.destinations, spreadsheetUrl: merged.spreadsheetUrl ?? scan.spreadsheetUrl, updatedAt: Date.now() });
        if (merged.status === 'saved') toast.success(t('recent.retrySaved'));
        else toast.error(t('recent.retryFailed'));
      }
    } catch (err) {
      const code = err instanceof ApiError ? err.code : 'internal';
      if (code === 'session') setSessionEnded(true);
      else toast.error(t(`error.${code}`));
    } finally {
      sending.current.delete(scan.id);
      setBusy(new Set(sending.current));
    }
  };

  // Signs in again without signing out, which would delete these scans, and comes back here.
  const signInAgain = () => void signIn('google', { callbackUrl: '/' });

  const time = (ms: number) => new Intl.DateTimeFormat(lang === 'hi' ? 'hi-IN' : 'en-IN', { dateStyle: 'medium', timeStyle: 'short' }).format(ms);
  const waiting = scans.filter(s => s.status === 'offline').length;
  const open = scans.filter(s => s.status !== 'saved');
  const saved = scans.filter(s => s.status === 'saved');
  // Offline, Process now and Retry can't run: the hint says why.
  const blocked = !online && scans.some(s => s.status === 'offline' || failedOf(s).length > 0);

  const row = (scan: StoredScan) => {
    const failed = failedOf(scan);
    // The customer, vehicle or farmer the slip is about tells five slips of one type apart.
    const name = valueOf(scan, titleKeys[scan.profileId] ?? []);
    // Screen readers list buttons on their own, so each one says which row it acts on.
    const which = [name, profileNames[scan.profileId], time(scan.updatedAt)].filter(Boolean).join(', ');
    const named = (action: string) => t('recent.rowAction', { action, name: which });
    const removeLabel = t(scan.status === 'saved' ? 'recent.remove' : 'recent.delete');
    const retrying = busy.has(scan.id);
    const retryLabel = retrying ? t('recent.retrying') : t('recent.retry');
    return (
      <li key={scan.id} className={styles.item}>
        <div className={styles.main}>
          <span className={styles.name}>{name || profileNames[scan.profileId]}</span>
          {name && <span className={styles.type}>{profileNames[scan.profileId]}</span>}
          <span className={styles.meta}>
            <Clock size={14} aria-hidden />
            {time(scan.updatedAt)}
            {scan.fields?.length ? ` · ${t('recent.fields', { count: scan.fields.length })}` : ''}
          </span>
          <span className={styles.badges}>
            <Badge tone={STATUS_TONE[scan.status]}>{t(`recent.status.${scan.status}`)}</Badge>
            {failed.map(d => <Badge key={d} tone="danger">{t(`dest.${d}`)}: {t('dest.failed')}</Badge>)}
          </span>
        </div>
        <div className={styles.actions}>
          {scan.status === 'offline' && (online
            ? <Link href={`/scan/${scan.profileId}?resume=${scan.id}`} className={buttonClass({ variant: 'primary' })} aria-label={named(t('recent.process'))}>{t('recent.process')}</Link>
            // aria-disabled, not disabled: it stays focusable and points to the offline hint.
            : <Button variant="primary" aria-disabled aria-describedby="recent-offline" aria-label={named(t('recent.process'))}>{t('recent.process')}</Button>
          )}
          {scan.status !== 'offline' && scan.spreadsheetUrl && (
            <ButtonLink href={scan.spreadsheetUrl} external aria-label={`${named(t('dest.openSheet'))} ${t('common.newTab')}`}>{t('dest.openSheet')}</ButtonLink>
          )}
          {failed.length > 0 && (
            <Button
              variant="primary"
              icon={<RotateCcw size={18} aria-hidden />}
              loading={retrying}
              aria-disabled={retrying || !online || undefined}
              aria-describedby={online ? undefined : 'recent-offline'}
              onClick={() => { if (online) void retry(scan); }}
              aria-label={named(retryLabel)}
            >
              {retryLabel}
            </Button>
          )}
          <IconButton label={named(removeLabel)} title={removeLabel} icon={<X size={20} aria-hidden />} disabled={retrying} onClick={() => remove(scan)} />
        </div>
      </li>
    );
  };

  return (
    <section className={styles.section} aria-labelledby="recent-title">
      <h2 id="recent-title" className={styles.title}>{t('recent.title')}</h2>
      {sessionEnded && (
        <div className={styles.session} role="alert">
          <p>{t('recent.sessionEnded')}</p>
          <Button variant="primary" icon={<LogIn size={18} aria-hidden />} onClick={signInAgain}>{t('review.signIn')}</Button>
        </div>
      )}
      {blocked && <p id="recent-offline" className={styles.hint}>{t('recent.offlineHint')}</p>}
      {waiting >= MANY_WAITING && <p className={styles.warning}>{t('recent.tooMany', { count: waiting })}</p>}
      {open.length > 0 && <ul className={`${styles.list} ${showAll ? '' : styles.folded}`}>{(showAll ? open : open.slice(0, VISIBLE)).map(row)}</ul>}
      {open.length > PHONE_VISIBLE && !showAll && (
        <div className={open.length > VISIBLE ? undefined : styles.phoneOnly}>
          <Button variant="ghost" onClick={() => setShowAll(true)}>{t('recent.showAll', { count: open.length })}</Button>
        </div>
      )}
      {saved.length > 0 && (
        <details className={styles.history}>
          <summary>{t('recent.history', { count: saved.length })}</summary>
          <ul className={styles.list}>{saved.map(row)}</ul>
        </details>
      )}
    </section>
  );
}
