'use client';
import { usePathname } from 'next/navigation';
import { useI18n } from '@/client/i18n/I18nProvider';
import styles from './AdtEndorsement.module.css';

// "An offering by ADT", from ADT's brand kit (LOGO.md §8). The SVGs in public/brand are copied
// unchanged; don't edit them. Stacked at the bottom of the sign-in screen, one line everywhere
// else, and always smaller and quieter than DocSync's own name.
const SIZES = {
  stacked: { width: 123, height: 36 },
  inline: { width: 196, height: 16 },
} as const;

export function AdtEndorsement({ variant }: { variant: keyof typeof SIZES }) {
  const { t } = useI18n();
  return (
    <a href="https://analogdigital.tech" target="_blank" rel="noopener" className={styles.link} aria-label={t('brand.offering')}>
      <picture>
        <source srcSet={`/brand/offering-by-adt-${variant}-dark.svg`} media="(prefers-color-scheme: dark)" />
        {/* eslint-disable-next-line @next/next/no-img-element -- tiny static SVG */}
        <img src={`/brand/offering-by-adt-${variant}-light.svg`} alt="" {...SIZES[variant]} />
      </picture>
    </a>
  );
}

/** The one-line endorsement under every page; the sign-in page shows the stacked one itself. */
export default function AdtFooter() {
  const pathname = usePathname();
  if (pathname === '/login') return null;
  return (
    <footer className={styles.footer}>
      <AdtEndorsement variant="inline" />
    </footer>
  );
}
