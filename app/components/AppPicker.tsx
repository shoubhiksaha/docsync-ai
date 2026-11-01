'use client';
import { useMemo, useRef, useState, useTransition, type FormEvent } from 'react';
import { flushSync } from 'react-dom';
import Link, { useLinkStatus } from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ArrowRight, BrickWall, ChefHat, ClipboardList, Construction, FileText, Fish, Fuel, Gavel, Gem, HandCoins, HandHeart, LoaderCircle,
  Milk, NotebookPen, Package, Palette, Pill, Recycle, Ruler, Scale, Smartphone, Spool, SprayCan, Tent, Trees, Truck,
  Warehouse, Wheat, Wifi, Wrench, type LucideIcon,
} from 'lucide-react';
import { useI18n } from '@/client/i18n/I18nProvider';
import { Button, TextField } from './ui';
import { rank, searchIndex, searchable, words, type SearchText } from './AppPicker.search';
import styles from './AppPicker.module.css';

export interface PickerApp {
  id: string;
  group: string;
  title: string;
  /** The card's one short line. */
  description: string;
  /** English and Hindi names, descriptions and search keywords. */
  search: SearchText;
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

// On a slow network the scan page takes seconds to arrive: the tapped card shows it is opening.
function CardArrow({ opening }: { opening: boolean }) {
  const { pending } = useLinkStatus();
  return pending || opening
    ? <LoaderCircle size={20} className={`${styles.arrow} ${styles.opening} spin`} aria-hidden />
    : <ArrowRight size={20} className={styles.arrow} aria-hidden />;
}

function AppCard({ app, opening = false }: { app: PickerApp; opening?: boolean }) {
  const Icon = APP_ICONS[app.id] ?? FileText;
  return (
    <Link href={`/scan/${app.id}`} className={styles.card}>
      <span className={styles.icon} aria-hidden><Icon size={24} /></span>
      <span className={styles.text}>
        <span className={styles.title}>{app.title}</span>
        <span className={styles.description}>{app.description}</span>
      </span>
      <CardArrow opening={opening} />
    </Link>
  );
}

/**
 * The home page's list of document apps: the ones this device used lately, a search box, jump links
 * per group (kept on screen on phones), and one section per group. A search lists matches best first.
 */
export default function AppPicker({ apps, groups, recentIds = [] }: { apps: PickerApp[]; groups: PickerGroup[]; recentIds?: string[] }) {
  const { t } = useI18n();
  const router = useRouter();
  const [query, setQuery] = useState('');
  // The Search key opens the only match through the router, outside its link.
  const [opening, startOpening] = useTransition();
  const input = useRef<HTMLInputElement>(null);

  const indexed = useMemo(() => apps.map(app => ({ app, index: searchIndex(app.search) })), [apps]);
  const typed = searchable(indexed, words(query));
  const searching = typed.length > 0;
  const found = searching ? rank(indexed, typed).map(({ app }) => app) : [];
  const noMatch = searching && found.length === 0;
  const sections = groups
    .map(group => ({ ...group, apps: apps.filter(app => app.group === group.id) }))
    .filter(group => group.apps.length > 0);
  const recent = recentIds.map(id => apps.find(app => app.id === id)).filter((app): app is PickerApp => Boolean(app));

  // Leaves a search with no results; flushSync renders every group before a chip's jump runs.
  const clear = () => flushSync(() => setQuery(''));

  // The keyboard's Search key opens the only match, or closes the keyboard so the matches show.
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (found.length === 1) startOpening(() => router.push(`/scan/${found[0].id}`));
    else input.current?.blur();
  };

  return (
    <div className={styles.picker}>
      {!searching && recent.length > 0 && (
        <section className={styles.section} aria-labelledby="yours-title">
          <h2 id="yours-title" className={styles.groupTitle}>{t('home.yours')}</h2>
          <ul className={styles.grid}>
            {recent.map(app => <li key={app.id}><AppCard app={app} /></li>)}
          </ul>
        </section>
      )}

      <form role="search" className={styles.search} onSubmit={submit}>
        <TextField
          ref={input}
          type="search"
          label={t('home.search')}
          placeholder={t('home.searchPlaceholder')}
          value={query}
          onChange={e => setQuery(e.target.value)}
          autoComplete="off"
          enterKeyHint="search"
        />
        <p role="status" className={searching ? styles.status : 'sr-only'}>
          {searching ? (found.length ? t('home.matches', { count: found.length }) : t('home.noMatch', { query: query.trim() })) : ''}
        </p>
        {noMatch && (
          <div>
            <Button variant="primary" size="lg" onClick={() => { clear(); input.current?.focus(); }}>{t('home.showAll')}</Button>
          </div>
        )}
      </form>

      {(!searching || noMatch) && sections.length > 1 && (
        <nav aria-label={t('home.groupsNav')} className={styles.jump}>
          <ul className={styles.chips}>
            {sections.map(group => (
              <li key={group.id}><a href={`#group-${group.id}`} className={styles.chip} onClick={noMatch ? clear : undefined}>{group.label}</a></li>
            ))}
          </ul>
        </nav>
      )}

      {found.length > 0 && (
        <ul className={styles.grid}>
          {found.map(app => <li key={app.id}><AppCard app={app} opening={opening && found.length === 1} /></li>)}
        </ul>
      )}

      {!searching && sections.map(group => (
        <section key={group.id} id={`group-${group.id}`} className={styles.section} aria-labelledby={`group-${group.id}-title`}>
          <h2 id={`group-${group.id}-title`} className={styles.groupTitle}>{group.label}</h2>
          <ul className={styles.grid}>
            {group.apps.map(app => <li key={app.id}><AppCard app={app} /></li>)}
          </ul>
        </section>
      ))}
    </div>
  );
}
