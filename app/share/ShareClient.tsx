'use client';
import { useEffect, useState } from 'react';
import { FileText } from 'lucide-react';
import { useI18n } from '@/client/i18n/I18nProvider';
import { readSharedFiles } from '@/client/shared-files';
import AppPicker, { type PickerApp, type PickerGroup } from '@/app/components/AppPicker';
import ShareNotice from './ShareNotice';
import home from '../home.module.css';
import styles from './share.module.css';

interface Thumb {
  name: string;
  /** An object URL for a photo; null for a PDF, shown by name. */
  src: string | null;
}

/**
 * What was shared, and the same document-type picker as Home: each card opens its scan page with
 * the shared files (?shared=<id>). The files stay in the worker's cache until that page has them.
 */
export default function ShareClient({ id, apps, groups, recentIds }: { id: string; apps: PickerApp[]; groups: PickerGroup[]; recentIds: string[] }) {
  const { t } = useI18n();
  // null while reading the cache (a few milliseconds): the picker shows at once, as it nearly always stays.
  const [thumbs, setThumbs] = useState<Thumb[] | 'missing' | null>(null);

  useEffect(() => {
    let urls: string[] = [];
    let cancelled = false;
    void readSharedFiles(id).then((files) => {
      if (cancelled) return;
      if (!files) return setThumbs('missing');
      const shown = files.map(file => ({ name: file.name, src: file.type.startsWith('image/') ? URL.createObjectURL(file) : null }));
      urls = shown.flatMap(thumb => thumb.src ?? []);
      setThumbs(shown);
    });
    return () => {
      cancelled = true;
      urls.forEach(url => URL.revokeObjectURL(url));
    };
  }, [id]);

  if (thumbs === 'missing') return <ShareNotice title={t('share.missing.title')} body={t('share.missing.body')} home={t('share.home')} />;

  return (
    <>
      <div className={home.hero}>
        <h1 className={home.title} tabIndex={-1}>{t('share.title')}</h1>
        <p className={home.subtitle}>{t('share.subtitle')}</p>
      </div>

      <section className={styles.shared} aria-labelledby="shared-title" aria-busy={thumbs === null}>
        <h2 id="shared-title" className="sr-only">{t('share.files')}</h2>
        {thumbs === null
          ? <p className={styles.loading}>{t('share.loading')}</p>
          : (
            <ul className={styles.thumbs}>
              {thumbs.map((thumb, n) => (
                <li key={n} className={styles.thumb}>
                  {/* eslint-disable-next-line @next/next/no-img-element -- local object URL */}
                  {thumb.src && <img src={thumb.src} alt={t('share.photo', { n: n + 1 })} />}
                  {!thumb.src && <span className={styles.pdf}><FileText size={28} aria-hidden /><span>{thumb.name || 'PDF'}</span></span>}
                </li>
              ))}
            </ul>
          )}
      </section>

      <AppPicker apps={apps} groups={groups} recentIds={recentIds} sharedId={id} />
    </>
  );
}
