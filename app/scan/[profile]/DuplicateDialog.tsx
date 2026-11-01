'use client';
import { useI18n } from '@/client/i18n/I18nProvider';
import type { DuplicateInfo } from '@/client/scan-flow';
import { Button, Dialog } from '@/app/components/ui';
import styles from './scan.module.css';

interface DuplicateDialogProps {
  info: DuplicateInfo | null;
  onCancel: () => void;
  onAction: (action: 'keep_both' | 'replace') => void;
}

/**
 * The safe choice (don't save) comes first, on screen and for the keyboard and screen readers alike;
 * replacing rows is the visually distinct, destructive one and comes last.
 */
export default function DuplicateDialog({ info, onCancel, onAction }: DuplicateDialogProps) {
  const { t } = useI18n();
  return (
    <Dialog
      open={Boolean(info)}
      onClose={onCancel}
      title={t('dup.title')}
      closeLabel={t('common.close')}
      description={info && t('dup.body', { label: info.label, value: info.value, count: info.count })}
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
    />
  );
}
