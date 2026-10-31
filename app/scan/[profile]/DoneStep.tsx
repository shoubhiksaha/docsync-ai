'use client';
import { BookOpen, Camera, CircleCheck, CircleX, ExternalLink, FileSpreadsheet, HardDrive, House, RotateCcw, TriangleAlert, type LucideIcon } from 'lucide-react';
import { useI18n } from '@/client/i18n/I18nProvider';
import type { MessageKey } from '@/client/i18n';
import { track } from '@/client/telemetry';
import { DESTINATIONS, type Destination, type DestinationResult, type SaveResult } from '@/client/scan-flow';
import { Badge, Button, ButtonLink, Card, Notice, type Tone } from '@/app/components/ui';
import styles from './scan.module.css';

const ICONS: Record<Destination, LucideIcon> = { sheets: FileSpreadsheet, notion: BookOpen, media: HardDrive };
const CODES = ['saved', 'failed', 'not_connected', 'not_selected', 'nothing_to_store', 'not_stored', 'not_retried', 'disabled', 'paused', 'duplicate', 'skipped'] as const;

interface DoneStepProps {
  result: SaveResult;
  fields: { key: string; label: string; value: string }[];
  documentName: string;
  retrying: Destination | null;
  offerRemember: boolean;
  offerNotion: boolean;
  onRetry: (destination: Destination) => void;
  onRemember: () => void;
  onDismissRemember: () => void;
  onDismissNotion: () => void;
  onScanNext: () => void;
}

function statusOf(outcome: DestinationResult | undefined): { key: MessageKey; tone: Tone } {
  if (!outcome) return { key: 'dest.skipped', tone: 'neutral' };
  if (outcome.status === 'success') return { key: 'dest.saved', tone: 'success' };
  if (outcome.status === 'failed') return { key: 'dest.failed', tone: 'danger' };
  const code = (CODES as readonly string[]).includes(outcome.code) ? outcome.code : 'skipped';
  return { key: `dest.${code}` as MessageKey, tone: 'neutral' };
}

/** The end of the flow (peak-end rule): an honest per-destination summary and a one-tap next scan. */
export default function DoneStep(props: DoneStepProps) {
  const { t } = useI18n();
  const { result } = props;
  const [titleKey, bodyKey, tone, Icon]: [MessageKey, MessageKey, Tone, LucideIcon] = result.status === 'saved'
    ? ['done.saved', 'done.savedBody', 'success', CircleCheck]
    : result.status === 'partial'
      ? ['done.partial', 'done.partialBody', 'warning', TriangleAlert]
      : ['done.failed', 'done.failedBody', 'danger', CircleX];

  return (
    <div className={styles.done}>
      <div className={styles.doneHeader} role="status">
        <span className={styles.doneIcon} data-tone={tone} aria-hidden><Icon size={34} /></span>
        <h2 className={styles.reviewTitle}>{t(titleKey)}</h2>
        <p className={styles.muted}>{t(bodyKey, { name: props.documentName })}</p>
      </div>

      <Card title={t('done.where')}>
        <ul className={styles.destinations}>
          {DESTINATIONS.map(destination => {
            const outcome = result.destinations[destination];
            const status = statusOf(outcome);
            const DestIcon = ICONS[destination];
            return (
              <li key={destination} className={styles.destination}>
                <span className={styles.destinationName}>
                  <DestIcon size={20} aria-hidden />
                  {t(`dest.${destination}`)}
                </span>
                <span className={styles.row}>
                  <Badge tone={status.tone}>{t(status.key)}</Badge>
                  {destination === 'sheets' && result.spreadsheetUrl && outcome?.status === 'success' && (
                    <ButtonLink href={result.spreadsheetUrl} external newTabLabel={t('common.newTab')} variant="ghost" icon={<ExternalLink size={18} aria-hidden />}>
                      {t('dest.openSheet')}
                    </ButtonLink>
                  )}
                  {outcome?.status === 'failed' && (
                    <Button variant="ghost" icon={<RotateCcw size={18} aria-hidden />} loading={props.retrying === destination} onClick={() => props.onRetry(destination)}>
                      {t('done.retry', { destination: t(`dest.${destination}`) })}
                    </Button>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
        <details className={styles.disclosure}>
          <summary>{t('review.fieldCount', { count: props.fields.length })}</summary>
          <dl className={styles.summary}>
            {props.fields.map(f => (
              <div key={f.key} style={{ display: 'contents' }}>
                <dt>{f.label}</dt>
                <dd>{f.value || '—'}</dd>
              </div>
            ))}
          </dl>
        </details>
      </Card>

      {result.warnings.length > 0 && (
        <Notice tone="info">
          <ul style={{ paddingLeft: 20 }}>{result.warnings.map(w => <li key={w}>{w}</li>)}</ul>
        </Notice>
      )}

      {props.offerRemember && (
        <Card title={t('done.rememberTitle', { count: props.fields.length })} description={t('done.rememberBody')}>
          <div className={styles.row}>
            <Button variant="primary" onClick={props.onRemember}>{t('done.remember')}</Button>
            <Button onClick={props.onDismissRemember}>{t('common.notNow')}</Button>
          </div>
        </Card>
      )}

      {props.offerNotion && (
        <Card title={t('done.notionTitle')} description={t('done.notionBody')}>
          <div className={styles.row}>
            <ButtonLink href="/api/auth/notion" native variant="primary" icon={<BookOpen size={18} aria-hidden />} onClick={() => track('notion_offer', { action: 'connect' })}>{t('done.notionConnect')}</ButtonLink>
            <Button onClick={props.onDismissNotion}>{t('common.notNow')}</Button>
          </div>
        </Card>
      )}

      <div className={styles.doneButtons}>
        <Button variant="primary" size="lg" icon={<Camera size={20} aria-hidden />} onClick={props.onScanNext}>{t('done.scanNext')}</Button>
        <ButtonLink href="/" size="lg" icon={<House size={20} aria-hidden />}>{t('done.home')}</ButtonLink>
      </div>
    </div>
  );
}
