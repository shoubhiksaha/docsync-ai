'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import toast from 'react-hot-toast';
import { Clock, RotateCcw, X } from 'lucide-react';
import { useI18n } from '@/client/i18n/I18nProvider';
import { ApiError, syncRecord } from '@/client/api';
import { DESTINATIONS, mergeRetry, type Destination, type SaveResult } from '@/client/scan-flow';
import { deleteScan, listScans, putScan, SCANS_CHANGED, type StoredScan } from '@/client/scan-store';
import { track } from '@/client/telemetry';
import { Badge, Button, IconButton, buttonClass, type Tone } from './ui';
import styles from './RecentScans.module.css';

const STATUS_TONE: Record<StoredScan['status'], Tone> = { offline: 'accent', saved: 'success', partial: 'warning', failed: 'danger' };
const VISIBLE = 5;
// Scans that still need something from the user come first.
const PRIORITY: Record<StoredScan['status'], number> = { offline: 0, failed: 1, partial: 2, saved: 3 };

function failedOf(scan: StoredScan): Destination[] {
  return DESTINATIONS.filter(d => scan.destinations?.[d]?.status === 'failed');
}

/** Scans kept on this device: offline captures to process, and saves with a destination to retry. */
export default function RecentScans({ profileNames }: { profileNames: Record<string, string> }) {
  const { t, lang } = useI18n();
  const [scans, setScans] = useState<StoredScan[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [online, setOnline] = useState(true);
  const [showAll, setShowAll] = useState(false);

  const refresh = useCallback(() => {
    listScans().then(all => setScans(
      all.filter(s => profileNames[s.profileId]).sort((a, b) => PRIORITY[a.status] - PRIORITY[b.status] || b.updatedAt - a.updatedAt),
    ));
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

  if (scans.length === 0) return null;

  const retry = async (scan: StoredScan) => {
    const only = failedOf(scan);
    if (!scan.fields?.length || only.length === 0) return;
    setBusy(scan.id);
    track('retry', { profile: scan.profileId, destination: only.join(',') });
    try {
      const outcome = await syncRecord({ profileId: scan.profileId, fields: scan.fields, archive: scan.archive ?? null, note: scan.note ?? '', audio: scan.audio ?? null, only, duplicateAction: 'keep_both' });
      if (outcome.kind === 'saved') {
        const previous: SaveResult = { status: scan.status === 'saved' ? 'saved' : scan.status === 'partial' ? 'partial' : 'failed', destinations: scan.destinations ?? {}, warnings: [] };
        const merged = mergeRetry(previous, outcome.result);
        await putScan({ ...scan, status: merged.status, destinations: merged.destinations, spreadsheetUrl: merged.spreadsheetUrl ?? scan.spreadsheetUrl, updatedAt: Date.now() });
        toast(t('recent.retried'));
      }
    } catch (err) {
      toast.error(t(`error.${err instanceof ApiError ? err.code : 'internal'}`));
    } finally {
      setBusy(null);
    }
  };

  const time = (ms: number) => new Intl.DateTimeFormat(lang === 'hi' ? 'hi-IN' : 'en-IN', { dateStyle: 'medium', timeStyle: 'short' }).format(ms);

  return (
    <section className={styles.section} aria-labelledby="recent-title">
      <h2 id="recent-title" className={styles.title}>{t('recent.title')}</h2>
      {!online && scans.some(s => s.status === 'offline') && <p className={styles.hint}>{t('recent.offlineHint')}</p>}
      <ul className={styles.list}>
        {(showAll ? scans : scans.slice(0, VISIBLE)).map(scan => {
          const failed = failedOf(scan);
          return (
            <li key={scan.id} className={styles.item}>
              <div className={styles.main}>
                <span className={styles.name}>{profileNames[scan.profileId]}</span>
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
                  ? <Link href={`/scan/${scan.profileId}?resume=${scan.id}`} className={buttonClass({ variant: 'primary' })}>{t('recent.process')}</Link>
                  : <Button variant="primary" disabled>{t('recent.process')}</Button>
                )}
                {failed.length > 0 && (
                  <Button variant="primary" icon={<RotateCcw size={18} aria-hidden />} loading={busy === scan.id} disabled={!online} onClick={() => retry(scan)}>
                    {busy === scan.id ? t('recent.retrying') : t('recent.retry')}
                  </Button>
                )}
                <IconButton label={t('recent.remove')} icon={<X size={20} aria-hidden />} onClick={() => deleteScan(scan.id)} />
              </div>
            </li>
          );
        })}
      </ul>
      {scans.length > VISIBLE && !showAll && (
        <div>
          <Button variant="ghost" onClick={() => setShowAll(true)}>{t('recent.showAll', { count: scans.length })}</Button>
        </div>
      )}
    </section>
  );
}
