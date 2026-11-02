'use client';
import { useI18n } from '@/client/i18n/I18nProvider';
import { Dialog } from '@/app/components/ui';
import styles from './scan.module.css';

/** The photo full width, to check it is sharp and readable (review screen and the page tray). */
export default function PhotoViewer({ urls, open, onClose, title }: { urls: string[]; open: boolean; onClose: () => void; title?: string }) {
  const { t } = useI18n();
  return (
    <Dialog open={open} onClose={onClose} title={title ?? t('review.photoTitle')} closeLabel={t('common.close')} wide>
      <div className={styles.viewer}>
        {urls.map((url, i) => (
          /* eslint-disable-next-line @next/next/no-img-element -- local object URL */
          <img key={url} src={url} alt={urls.length > 1 ? t('review.page', { n: i + 1 }) : title ?? t('review.photoTitle')} />
        ))}
      </div>
    </Dialog>
  );
}
