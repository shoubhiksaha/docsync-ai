'use client';
import { useEffect, useMemo, useRef, useState, useTransition, type FormEvent, type MouseEvent } from 'react';
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

// How long typing must pause before the match count is announced to screen readers.
const STATUS_DELAY = 500;

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
  const picker = useRef<HTMLDivElement>(null);
  const jump = useRef<HTMLElement>(null);
  const chips = useRef<HTMLUListElement>(null);
  // The group being read on a phone, whose chip is marked in the sticky row.
  const [current, setCurrent] = useState<string | null>(null);

  const indexed = useMemo(() => apps.map(app => ({ app, index: searchIndex(app.search) })), [apps]);
  const typed = searchable(indexed, words(query));
  const searching = typed.length > 0;
  const ranked = searching ? rank(indexed, typed) : null;
  const found = ranked ? ranked.items.map(({ app }) => app) : [];
  const noMatch = searching && found.length === 0;
  // A lone match opens on the Search key only when every word names it, never on a guess.
  const sure = found.length === 1 && ranked?.match === 'name';
  const sections = groups
    .map(group => ({ ...group, apps: apps.filter(app => app.group === group.id) }))
    .filter(group => group.apps.length > 0);
  const recent = recentIds.map(id => apps.find(app => app.id === id)).filter((app): app is PickerApp => Boolean(app));

  const here = searching ? null : current;

  // The sticky header grows with the offline banner (two lines in Hindi): the chips stick under its
  // real height, and jumps and focus clear both.
  useEffect(() => {
    const root = picker.current;
    const header = document.querySelector('header');
    if (!root || !header || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => root.style.setProperty('--header-h', `${header.offsetHeight}px`));
    observer.observe(header);
    return () => observer.disconnect();
  }, []);

  // While the chips stick (phones), the current group is the last one whose heading has passed under them.
  useEffect(() => {
    if (searching) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      const bar = jump.current;
      if (!bar || getComputedStyle(bar).position !== 'sticky') return setCurrent(null);
      const line = bar.getBoundingClientRect().bottom + 24;
      const passed = [...(picker.current?.querySelectorAll<HTMLElement>('section[id^="group-"]') ?? [])].filter(s => s.getBoundingClientRect().top <= line);
      setCurrent(passed.length ? passed[passed.length - 1].id.slice('group-'.length) : null);
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(update); };
    update();
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
    };
  }, [searching]);

  // Brings the marked chip into view in its row: half the groups start off the side of a phone.
  useEffect(() => {
    const row = chips.current;
    const chip = row?.querySelector<HTMLElement>('[aria-current="true"]');
    if (!row || !chip || row.scrollWidth <= row.clientWidth) return;
    const rowBox = row.getBoundingClientRect();
    const chipBox = chip.getBoundingClientRect();
    row.scrollLeft += chipBox.left - rowBox.left - (rowBox.width - chipBox.width) / 2;
  }, [here]);

  // Screen readers hear the count once typing pauses, not one stale count per keystroke; the visible line stays instant.
  const status = searching
    ? noMatch ? t('home.noMatch', { query: query.trim() }) : ranked?.match === 'closest' ? t('home.closest', { query: query.trim() }) : t('home.matches', { count: found.length })
    : '';
  const [announced, setAnnounced] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setAnnounced(status), STATUS_DELAY);
    return () => clearTimeout(timer);
  }, [status]);

  // Leaves a search with no results; flushSync renders every group before a chip's jump runs.
  const clear = () => flushSync(() => setQuery(''));

  // A chip scrolls to its group and moves the focus to its heading without adding a history entry,
  // so the phone's Back button leaves Home instead of stepping back through earlier jumps.
  const jumpTo = (event: MouseEvent<HTMLAnchorElement>, id: string) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    if (noMatch) clear();
    const target = document.getElementById(`group-${id}`);
    if (!target) return;
    event.preventDefault();
    // The section's scroll-margin clears the sticky header and chips; reduced motion is kept by the global CSS.
    target.scrollIntoView({ block: 'start' });
    target.querySelector<HTMLElement>('h2')?.focus({ preventScroll: true });
  };

  // The keyboard's Search key opens the only sure match, or closes the keyboard so the matches show.
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (sure) startOpening(() => router.push(`/scan/${found[0].id}`));
    else input.current?.blur();
  };

  return (
    <div ref={picker} className={styles.picker}>
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
        {searching && <p className={styles.status} aria-hidden>{status}</p>}
        <p role="status" className="sr-only">{announced}</p>
        {noMatch && (
          <div>
            <Button variant="primary" size="lg" onClick={() => { clear(); input.current?.focus(); }}>{t('home.showAll')}</Button>
          </div>
        )}
      </form>

      {(!searching || noMatch) && sections.length > 1 && (
        <nav ref={jump} aria-label={t('home.groupsNav')} className={styles.jump}>
          <ul ref={chips} className={styles.chips}>
            {sections.map(group => (
              <li key={group.id}>
                <a
                  href={`#group-${group.id}`}
                  className={styles.chip}
                  aria-current={group.id === here ? 'true' : undefined}
                  onClick={event => jumpTo(event, group.id)}
                >
                  {group.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      )}

      {found.length > 0 && (
        <ul className={styles.grid}>
          {found.map(app => <li key={app.id}><AppCard app={app} opening={opening && sure} /></li>)}
        </ul>
      )}

      {!searching && sections.map(group => (
        <section key={group.id} id={`group-${group.id}`} className={styles.section} aria-labelledby={`group-${group.id}-title`}>
          <h2 id={`group-${group.id}-title`} tabIndex={-1} className={styles.groupTitle}>{group.label}</h2>
          <ul className={styles.grid}>
            {group.apps.map(app => <li key={app.id}><AppCard app={app} /></li>)}
          </ul>
        </section>
      ))}
    </div>
  );
}
