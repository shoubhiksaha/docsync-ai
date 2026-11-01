'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { signIn } from 'next-auth/react';
import toast from 'react-hot-toast';
import { Clock, LogIn, RotateCcw, X } from 'lucide-react';
import { useI18n } from '@/client/i18n/I18nProvider';
import { ApiError, syncRecord } from '@/client/api';
import { DESTINATIONS, mergeRetry, type Destination, type SaveResult } from '@/client/scan-flow';
import { byOwner, claimScans, deleteScan, deleteScans, getScan, listScans, putScan, rememberScanRows, retryInput, SCANS_CHANGED, type ScanRows, type StoredScan } from '@/client/scan-store';
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

/** Rows this list can show: one written by an older build, or cut short when the phone ran out of space, is left out. */
function readable(scan: StoredScan | null | undefined): scan is StoredScan {
  return typeof PRIORITY[scan?.status as StoredScan['status']] === 'number' && Number.isFinite(scan?.updatedAt)
    && (scan?.fields === undefined || (Array.isArray(scan.fields) && scan.fields.every(f => typeof f?.value === 'string')));
}

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
  /** The signed-in Google account (opaque id): only its scans are listed, retried or processed. */
  account: string | null;
}

/**
 * Scans kept on this device: offline captures to process and saves with a destination to retry,
 * then finished saves folded into one line so they don't push the document types down.
 */
export default function RecentScans({ profileNames, titleKeys, expected, account }: Props) {
  const { t, lang } = useI18n();
  // null until IndexedDB answers.
  const [scans, setScans] = useState<StoredScan[] | null>(null);
  // Scans another Google account left on this shared phone: never listed, retried or saved here.
  const [others, setOthers] = useState<StoredScan[]>([]);
  // Retries in flight, per row. The ref blocks a second send before the re-render shows the spinner.
  const [busy, setBusy] = useState<ReadonlySet<string>>(() => new Set());
  const sending = useRef(new Set<string>());
  // Set when a retry finds the Google sign-in has ended; signing in again keeps the scans on this device.
  const [sessionEnded, setSessionEnded] = useState(false);
  const [online, setOnline] = useState(true);
  const [showAll, setShowAll] = useState(false);
  // After a row is removed, focus moves to the next row (its id) or, with none left, to the heading.
  const focusAfter = useRef<string | null | undefined>(undefined);
  const heading = useRef<HTMLHeadingElement>(null);
  const section = useRef<HTMLElement>(null);

  const refresh = useCallback(() => {
    (account ? claimScans(account) : Promise.resolve()).then(listScans).then(all => {
      const { mine, others: theirs } = byOwner(all.filter(s => readable(s) && profileNames[s.profileId]), account);
      const shown = mine.sort((a, b) => PRIORITY[a.status] - PRIORITY[b.status] || b.updatedAt - a.updatedAt);
      setScans(shown);
      setOthers(theirs);
      const waiting = shown.filter(s => s.status !== 'saved').length;
      // One past VISIBLE says a "Show all" button is coming too.
      rememberScanRows(Math.min(waiting, VISIBLE + 1), waiting < shown.length);
    });
  }, [profileNames, account]);

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

  useEffect(() => {
    const target = focusAfter.current;
    if (target === undefined || scans === null) return;
    focusAfter.current = undefined;
    const row = target ? section.current?.querySelector(`[data-scan="${CSS.escape(target)}"]`) : null;
    const action = row?.querySelector<HTMLElement>('a, button:not([disabled])');
    action?.focus();
    if (action && document.activeElement === action) return;
    // No row left to move to (or the whole list is gone): the heading takes the focus.
    (heading.current ?? document.querySelector<HTMLElement>('#main h1'))?.focus();
  }, [scans]);

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
  if (scans.length === 0 && others.length === 0) return null;

  const remove = async (scan: StoredScan, list: StoredScan[]) => {
    const at = list.findIndex(s => s.id === scan.id);
    focusAfter.current = (list[at + 1] ?? list[at - 1])?.id ?? null;
    await deleteScan(scan.id);
    // Kept in memory for a few seconds so a mis-tap can be undone.
    toast(toastItem => (
      <span className={styles.undo}>
        {t(scan.status === 'saved' ? 'recent.removed' : 'recent.deleted')}
        <Button variant="ghost" onClick={() => { toast.dismiss(toastItem.id); void putScan(scan); }}>{t('recent.undo')}</Button>
      </span>
    ), { id: `removed-${scan.id}`, duration: 6000 });
  };

  // Another account's scans can only be deleted here; Undo puts them back, still theirs.
  const removeOthers = async () => {
    const gone = others;
    focusAfter.current = null;
    await deleteScans(gone.map(scan => scan.id));
    toast(toastItem => (
      <span className={styles.undo}>
        {t('recent.otherDeleted')}
        <Button variant="ghost" onClick={() => { toast.dismiss(toastItem.id); gone.forEach(scan => void putScan(scan)); }}>{t('recent.undo')}</Button>
      </span>
    ), { id: 'removed-others', duration: 6000 });
  };

  const retry = async (scan: StoredScan) => {
    const only = failedOf(scan);
    if (!scan.fields?.length || only.length === 0 || sending.current.has(scan.id)) return;
    sending.current.add(scan.id);
    setBusy(new Set(sending.current));
    track('retry', { profile: scan.profileId, destination: only.join(',') });
    try {
      const outcome = await syncRecord(retryInput(scan, only));
      // Deleted elsewhere while this ran (another tab): don't bring it back.
      if (outcome.kind === 'saved' && await getScan(scan.id)) {
        setSessionEnded(false);
        const previous: SaveResult = {
          status: scan.status === 'saved' ? 'saved' : scan.status === 'partial' ? 'partial' : 'failed',
          destinations: scan.destinations ?? {}, warnings: [], imageLink: scan.imageLink, voiceNoteLink: scan.voiceNoteLink,
        };
        const merged = mergeRetry(previous, outcome.result);
        await putScan({
          ...scan, status: merged.status, destinations: merged.destinations, spreadsheetUrl: merged.spreadsheetUrl ?? scan.spreadsheetUrl,
          imageLink: merged.imageLink, voiceNoteLink: merged.voiceNoteLink, updatedAt: Date.now(),
        });
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

  const row = (scan: StoredScan, list: StoredScan[]) => {
    const failed = failedOf(scan);
    // Kept with "Keep for later": already read and checked, so only the save is left.
    const checked = scan.status === 'offline' && Boolean(scan.fields?.length);
    const status = checked ? t('recent.status.checked') : t(`recent.status.${scan.status}`);
    const process = checked ? t('recent.saveNow') : t('recent.process');
    // The customer, vehicle or farmer the slip is about tells five slips of one type apart.
    const name = valueOf(scan, titleKeys[scan.profileId] ?? []);
    // Screen readers list buttons on their own, so each one says which row it acts on.
    const which = [name, profileNames[scan.profileId], time(scan.updatedAt)].filter(Boolean).join(', ');
    const named = (action: string) => t('recent.rowAction', { action, name: which });
    const removeLabel = t(scan.status === 'saved' ? 'recent.remove' : 'recent.delete');
    const retrying = busy.has(scan.id);
    const retryLabel = retrying ? t('recent.retrying') : t('recent.retry');
    return (
      <li key={scan.id} className={styles.item} data-scan={scan.id}>
        <div className={styles.main}>
          <span className={styles.name}>{name || profileNames[scan.profileId]}</span>
          {name && <span className={styles.type}>{profileNames[scan.profileId]}</span>}
          <span className={styles.meta}>
            <Clock size={14} aria-hidden />
            {time(scan.updatedAt)}
            {scan.fields?.length ? ` · ${t('recent.fields', { count: scan.fields.length })}` : ''}
          </span>
          <span className={styles.badges}>
            <Badge tone={STATUS_TONE[scan.status]}>{status}</Badge>
            {failed.map(d => <Badge key={d} tone="danger">{t(`dest.${d}`)}: {t('dest.failed')}</Badge>)}
          </span>
        </div>
        <div className={styles.actions}>
          {scan.status === 'offline' && (online
            ? <Link href={`/scan/${scan.profileId}?resume=${scan.id}`} className={buttonClass({ variant: 'primary' })} aria-label={named(process)}>{process}</Link>
            // aria-disabled, not disabled: it stays focusable and points to the offline hint.
            : <Button variant="primary" aria-disabled aria-describedby="recent-offline" aria-label={named(process)}>{process}</Button>
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
          <IconButton label={named(removeLabel)} title={removeLabel} icon={<X size={20} aria-hidden />} disabled={retrying} onClick={() => remove(scan, list)} />
        </div>
      </li>
    );
  };
  // A record this version can't show (one stored by an older version) is left out instead of taking the list down.
  const safeRow = (list: StoredScan[]) => (scan: StoredScan) => {
    try {
      return row(scan, list);
    } catch {
      return null;
    }
  };

  return (
    <section ref={section} className={styles.section} aria-labelledby="recent-title">
      <h2 id="recent-title" ref={heading} tabIndex={-1} className={styles.title}>{t('recent.title')}</h2>
      {others.length > 0 && (
        <div className={styles.session} role="status">
          <p>{t('recent.otherAccount', { count: others.length })}</p>
          <Button variant="ghost" onClick={() => void removeOthers()}>{t('recent.deleteOthers')}</Button>
        </div>
      )}
      {sessionEnded && (
        <div className={styles.session} role="alert">
          <p>{t('recent.sessionEnded')}</p>
          <Button variant="primary" icon={<LogIn size={18} aria-hidden />} onClick={signInAgain}>{t('review.signIn')}</Button>
        </div>
      )}
      {blocked && <p id="recent-offline" className={styles.hint}>{t('recent.offlineHint')}</p>}
      {waiting >= MANY_WAITING && <p className={styles.warning}>{t('recent.tooMany', { count: waiting })}</p>}
      {open.length > 0 && <ul className={`${styles.list} ${showAll ? '' : styles.folded}`}>{(showAll ? open : open.slice(0, VISIBLE)).map(safeRow(open))}</ul>}
      {/* Stays in place as "Show fewer", so the focus isn't dropped and the list can be folded again. */}
      {open.length > PHONE_VISIBLE && (
        <div className={open.length > VISIBLE ? undefined : styles.phoneOnly}>
          <Button variant="ghost" aria-expanded={showAll} onClick={() => setShowAll(!showAll)}>
            {showAll ? t('recent.showFewer') : t('recent.showAll', { count: open.length })}
          </Button>
        </div>
      )}
      {saved.length > 0 && (
        <details className={styles.history}>
          <summary>{t('recent.history', { count: saved.length })}</summary>
          <ul className={styles.list}>{saved.map(safeRow(saved))}</ul>
        </details>
      )}
    </section>
  );
}
