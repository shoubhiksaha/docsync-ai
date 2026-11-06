'use client';
import { useId } from 'react';
import { useI18n } from '@/client/i18n/I18nProvider';
import type { DuplicateInfo } from '@/client/scan-flow';
import { Button, Dialog } from '@/app/components/ui';
import { useFieldName } from './fieldNames';
import styles from './scan.module.css';

interface DuplicateDialogProps {
  info: DuplicateInfo | null;
  onCancel: () => void;
  onAction: (action: 'keep_both' | 'replace') => void;
}

/**
 * The safe choice (don't save) comes first, on screen and for the keyboard and screen readers alike;
 * replacing rows is the visually distinct, destructive one and comes last. The row already in the
 * sheet is shown when the server could read it, so the user can see whether it is the same document.
 */
export default function DuplicateDialog({ info, onCancel, onAction }: DuplicateDialogProps) {
  const { t } = useI18n();
  const fieldName = useFieldName();
  const headingId = useId();
  const existing = info?.existing;
  return (
    <Dialog
      open={Boolean(info)}
      onClose={onCancel}
      title={t('dup.title')}
      closeLabel={t('common.close')}
      description={info && t('dup.body', { label: fieldName(info), value: info.value, count: info.count })}
      actions={
        <div className={styles.choices}>
          <Button variant="primary" wrap onClick={onCancel}>{t('dup.cancel')}</Button>
          <Button wrap onClick={() => onAction('keep_both')}>{t('dup.keepBoth')}</Button>
          {info && (
            <Button variant="danger" wrap onClick={() => onAction('replace')}>
              {info.count > 1 ? t('dup.replaceMany', { count: info.count }) : t('dup.replace')}
            </Button>
          )}
        </div>
      }
    >
      {existing && (
        <section className={styles.existingRow} aria-labelledby={headingId}>
          <h3 id={headingId} className={styles.existingTitle}>{(info?.count ?? 1) > 1 ? t('dup.existingFirst') : t('dup.existing')}</h3>
          <dl className={styles.summary}>
            {existing.savedAt && (
              <div style={{ display: 'contents' }}>
                <dt>{t('dup.savedAt')}</dt>
                <dd>{existing.savedAt}</dd>
              </div>
            )}
            {existing.fields.map((f, i) => (
              <div key={i} style={{ display: 'contents' }}>
                <dt>{fieldName(f)}</dt>
                <dd>{f.value}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}
    </Dialog>
  );
}
