'use client';
import { useMemo, useState } from 'react';
import Link from 'next/link';
import {
  ArrowRight, BrickWall, ChefHat, ClipboardList, Construction, FileText, Fish, Fuel, Gavel, Gem, HandCoins, HandHeart,
  Milk, NotebookPen, Package, Palette, Pill, Recycle, Ruler, Scale, Smartphone, Spool, SprayCan, Tent, Trees, Truck,
  Warehouse, Wheat, Wifi, Wrench, type LucideIcon,
} from 'lucide-react';
import { useI18n } from '@/client/i18n/I18nProvider';
import { TextField } from './ui';
import styles from './AppPicker.module.css';

export interface PickerApp {
  id: string;
  group: string;
  title: string;
  description: string;
  /** English and Hindi title, document name and description, joined. */
  searchText: string;
}

export interface PickerGroup {
  id: string;
  label: string;
}

// Purely visual; an app without an entry gets the generic document icon.
const APP_ICONS: Record<string, LucideIcon> = {
  'ngo-receipt': HandHeart,
  'factory-weight-slip': Scale,
  'kirana-khata': NotebookPen,
  'medical-prescription': Pill,
  'garage-repair-estimate': Wrench,
  'mobile-repair-job-card': Smartphone,
  'tailoring-measurement': Ruler,
  'decorator-challan': Tent,
  'mandi-auction-slip': Gavel,
  'dairy-collection-slip': Milk,
  'pesticide-bill': SprayCan,
  'fish-auction-chit': Fish,
  'caterer-material-bill': ChefHat,
  'fleet-fuel-expense': Fuel,
  'lorry-receipt': Truck,
  'courier-run-sheet': Package,
  'godown-storage-receipt': Warehouse,
  'construction-material-inward': Construction,
  'brick-kiln-token': BrickWall,
  'scrap-dealer-receipt': Recycle,
  'timber-measurement-slip': Trees,
  'muster-roll': ClipboardList,
  'handloom-weaver-log': Spool,
  'jewelry-karigar-log': Gem,
  'handicraft-piece-rate': Palette,
  'cable-wifi-receipt': Wifi,
  'pds-distribution-log': Wheat,
  'street-vendor-daily-finance': HandCoins,
};

/** Lower-case, accents and the Hindi nukta removed, so "वजन" finds "वज़न" and "cafe" finds "café". */
function normalize(text: string): string {
  return text.normalize('NFD').replace(/[̀-़ͯ]/g, '').toLowerCase();
}

/** Words of normalized text: letters (with Hindi vowel signs) and digits, split at everything else. */
function words(text: string): string[] {
  return normalize(text).split(/[^\p{L}\p{M}\p{N}]+/u).filter(Boolean);
}

/** The home page's list of document apps: a search box, jump links per group, and one section per group. */
export default function AppPicker({ apps, groups }: { apps: PickerApp[]; groups: PickerGroup[] }) {
  const { t } = useI18n();
  const [query, setQuery] = useState('');

  const indexed = useMemo(() => apps.map(app => ({ app, words: words(app.searchText) })), [apps]);
  const typed = words(query);
  const searching = typed.length > 0;
  // Each typed word must start a word of the app's text, so "LR" finds lorry receipts, not "jewelry".
  const visible = searching
    ? indexed.filter(({ words: own }) => typed.every(w => own.some(o => o.startsWith(w)))).map(({ app }) => app)
    : apps;
  const sections = groups
    .map(group => ({ ...group, apps: visible.filter(app => app.group === group.id) }))
    .filter(group => group.apps.length > 0);
  const allSections = groups.filter(group => apps.some(app => app.group === group.id));

  return (
    <div className={styles.picker}>
      <div role="search" className={styles.search}>
        <TextField
          type="search"
          label={t('home.search')}
          placeholder={t('home.searchPlaceholder')}
          value={query}
          onChange={e => setQuery(e.target.value)}
          autoComplete="off"
          enterKeyHint="search"
        />
        <p role="status" className={searching ? styles.status : 'sr-only'}>
          {searching ? (visible.length ? t('home.matches', { count: visible.length }) : t('home.noMatch', { query: query.trim() })) : ''}
        </p>
      </div>

      {!searching && allSections.length > 1 && (
        <nav aria-label={t('home.groupsNav')}>
          <ul className={styles.chips}>
            {allSections.map(group => (
              <li key={group.id}><a href={`#group-${group.id}`} className={styles.chip}>{group.label}</a></li>
            ))}
          </ul>
        </nav>
      )}

      {sections.map(group => (
        <section key={group.id} id={`group-${group.id}`} className={styles.section} aria-labelledby={`group-${group.id}-title`}>
          <h2 id={`group-${group.id}-title`} className={styles.groupTitle}>{group.label}</h2>
          <ul className={styles.grid}>
            {group.apps.map(app => {
              const Icon = APP_ICONS[app.id] ?? FileText;
              return (
                <li key={app.id}>
                  <Link href={`/scan/${app.id}`} className={styles.card}>
                    <span className={styles.icon} aria-hidden><Icon size={24} /></span>
                    <span className={styles.text}>
                      <span className={styles.title}>{app.title}</span>
                      <span className={styles.description}>{app.description}</span>
                    </span>
                    <ArrowRight size={20} className={styles.arrow} aria-hidden />
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
