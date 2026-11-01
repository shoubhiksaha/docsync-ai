import { normalizeKey } from '@/core/text';

/** Pure helpers for laying records out in a sheet. No Google API calls here. */

export interface SheetField {
  key: string;
  label: string;
  value: string;
}

export interface RowMeta {
  notes: string;
  voiceNoteLink: string;
  imageLink: string;
  syncedAt: string;
  syncStatus: string;
  /** This save's id (SAVE_ID_COLUMN): a retry of the same save carries the same one. */
  saveId?: string;
}

/** The language the app's own columns and Sync Status are written in: the user's app language. */
export type SheetLang = 'en' | 'hi';

/** A new sheet gets the headings in the user's language; headings in either language are recognised. */
export const META_COLUMNS: readonly { key: keyof RowMeta; label: string; labelHi: string; aliases: string[] }[] = [
  { key: 'notes', label: 'Notes (Text/Audio)', labelHi: 'नोट (लिखा या बोला)', aliases: ['notes', 'notestextaudio'] },
  { key: 'voiceNoteLink', label: 'Voice Note Audio Link', labelHi: 'वॉइस नोट का लिंक', aliases: ['voicenotelink', 'voicenoteaudiolink'] },
  { key: 'imageLink', label: 'Link to Image', labelHi: 'फ़ोटो का लिंक', aliases: ['linktoimage'] },
  { key: 'syncedAt', label: 'Synced At', labelHi: 'सेव होने का समय', aliases: ['syncedat'] },
  { key: 'syncStatus', label: 'Sync Status', labelHi: 'सेव की स्थिति', aliases: ['syncstatus'] },
];

/**
 * A hidden column holding each save's id, so a save whose reply never reached the phone is
 * recognised when it is retried instead of written twice. Added the first time a save has an id.
 */
export const SAVE_ID_COLUMN: (typeof META_COLUMNS)[number] = { key: 'saveId', label: 'Save ID', labelHi: 'सेव आईडी', aliases: ['saveid'] };

function metaColumnFor(header: string) {
  const norm = normalizeKey(header);
  return [...META_COLUMNS, SAVE_ID_COLUMN].find(m => m.aliases.includes(norm) || normalizeKey(m.labelHi) === norm);
}

/** 1 → A, 26 → Z, 27 → AA, 703 → AAA. */
export function columnLetter(index1: number): string {
  let n = index1;
  let out = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

/** A1 range on a tab, quoting the tab name so spaces and quotes are safe. */
export function tabRange(tab: string, a1: string): string {
  return `'${tab.replace(/'/g, "''")}'!${a1}`;
}

export function headerMatches(header: string, field: Pick<SheetField, 'key' | 'label'>): boolean {
  const h = normalizeKey(header);
  return h !== '' && (h === normalizeKey(field.key) || h === normalizeKey(field.label));
}

/**
 * A field whose name collides with a metadata column (a "Notes" line written on the slip) gets
 * its own "Notes (on document)" column, so it is never mistaken for the voice-note text.
 */
export function columnFields(fields: SheetField[]): SheetField[] {
  return fields.map(f => (metaColumnFor(f.label || f.key) || metaColumnFor(f.key) ? { ...f, label: `${f.label || f.key} (on document)` } : f));
}

/**
 * Which field fills each column. Each field is used once, and a column named by a field's key
 * wins over one that only shares its label, so two "Amount" fields fill two columns instead of
 * one value landing twice. Metadata columns never take a field.
 */
function assignColumns(headers: string[], fields: SheetField[]): Map<number, SheetField> {
  const assigned = new Map<number, SheetField>();
  const used = new Set<SheetField>();
  const open = headers.flatMap((h, i) => (metaColumnFor(h) || !normalizeKey(h) ? [] : [i]));
  const claim = (matches: (header: string, field: SheetField) => boolean) => {
    for (const i of open) {
      if (assigned.has(i)) continue;
      const field = fields.find(f => !used.has(f) && matches(headers[i], f));
      if (field) {
        assigned.set(i, field);
        used.add(field);
      }
    }
  };
  claim((h, f) => normalizeKey(h) === normalizeKey(f.key));
  claim(headerMatches);
  return assigned;
}

export interface MergedHeaders {
  headers: string[];
  changed: boolean;
  /**
   * Blank columns the existing rows need at `at` before the new header row is written, so their
   * notes, links and timestamps stay under their own headings. Absent when nothing has to move.
   */
  insert?: { at: number; count: number };
}

/**
 * Returns the header row needed to hold `fields`. New fields are inserted before the metadata
 * columns; an empty sheet gets every field plus the metadata columns. `withSaveId` adds the Save
 * ID column when the sheet doesn't have it yet.
 */
export function mergeHeaders(existing: string[], rawFields: SheetField[], lang: SheetLang = 'en', withSaveId = false): MergedHeaders {
  const fields = columnFields(rawFields);
  const cleanExisting = existing.map(h => String(h ?? ''));
  const label = (m: { label: string; labelHi: string }) => (lang === 'hi' ? m.labelHi : m.label);
  if (cleanExisting.every(h => h.trim() === '')) {
    return { headers: [...fields.map(f => f.label || f.key), ...META_COLUMNS.map(label), ...(withSaveId ? [label(SAVE_ID_COLUMN)] : [])], changed: true };
  }

  const placed = new Set(assignColumns(cleanExisting, fields).values());
  const missing = fields.filter(f => !placed.has(f)).map(f => f.label || f.key);
  if (withSaveId && metaColumnIndex(cleanExisting, 'saveId') === -1) missing.push(label(SAVE_ID_COLUMN));
  if (missing.length === 0) return { headers: cleanExisting, changed: false };

  const metaIndex = cleanExisting.findIndex(h => metaColumnFor(h));
  const insertAt = metaIndex === -1 ? cleanExisting.length : metaIndex;
  const headers = [...cleanExisting];
  headers.splice(insertAt, 0, ...missing);
  const insert = insertAt < cleanExisting.length ? { at: insertAt, count: missing.length } : undefined;
  return { headers, changed: true, ...(insert ? { insert } : {}) };
}

/**
 * Stops cell values from being evaluated as formulas (="…", +…, @…), and keeps identifiers as
 * written: Sheets would turn receipt no. "000412" into 412, "+919876543210" into a number and a
 * 12+ digit account or IMEI number into 3.57E+14. Amounts and weights stay numeric.
 */
export function sanitizeCell(value: unknown): unknown {
  if (value === null || value === undefined) return '';
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  if (/^0\d+$/.test(trimmed) || /^\+\d+$/.test(trimmed) || /^\d{12,}$/.test(trimmed)) return `'${value}`;
  if (/^[=+\-@\t\r]/.test(value) && !/^[+-]?\d[\d,]*(\.\d+)?$/.test(trimmed)) return `'${value}`;
  return value;
}

export function buildRow(headers: string[], rawFields: SheetField[], meta: RowMeta): unknown[] {
  const assigned = assignColumns(headers, columnFields(rawFields));
  return headers.map((header, i) => {
    const metaColumn = metaColumnFor(header);
    if (metaColumn) return sanitizeCell(meta[metaColumn.key]);
    return sanitizeCell(assigned.get(i)?.value ?? '');
  });
}

/**
 * Duplicate-check form of a key value: case, spaces, "/", "-", "." and leading zeros are ignored,
 * so "000412" matches the 412 an older row was stored as, and "R/412" matches "r-412".
 */
export function keyValueForMatch(value: unknown): string {
  return String(value ?? '').trim().toUpperCase().replace(/[\s/.-]/g, '').replace(/^0+(?=.)/, '');
}

/** Index of the column holding the primary key (matched against the PK field's key or label). */
export function primaryKeyColumn(headers: string[], rawFields: SheetField[], primaryKey: string): { index: number; value: string } | null {
  const fields = columnFields(rawFields);
  const pkNorm = normalizeKey(primaryKey);
  const field = fields.find(f => normalizeKey(f.key) === pkNorm || normalizeKey(f.label) === pkNorm);
  const value = field?.value?.trim();
  if (!field || !value) return null;
  const index = headers.findIndex(h => !metaColumnFor(h) && (normalizeKey(h) === pkNorm || headerMatches(h, field)));
  return index === -1 ? null : { index, value };
}

/** Index of a metadata column ('imageLink', 'syncStatus', …) in the header row, or -1. */
export function metaColumnIndex(headers: string[], key: keyof RowMeta): number {
  return headers.findIndex(h => metaColumnFor(String(h ?? ''))?.key === key);
}

/**
 * A value as the sheet shows it after USER_ENTERED parsing: "1,500.50" and 1500.5 match, as do
 * "000412" and 412, and "₹1,540" and the "₹1,540.00" an en_IN sheet shows for it.
 */
function shownAs(value: unknown): string {
  const text = String(value ?? '').trim().replace(/^'/, '');
  const plain = text.replace(/^(?:₹|rs\.?|inr)\s*/i, '').replace(/,/g, '');
  return /^-?\d+(\.\d+)?$/.test(plain) ? String(Number(plain)) : keyValueForMatch(text);
}

/** Whether a row read back from the sheet holds exactly these field values (metadata columns aside). */
export function rowHoldsFields(headers: string[], rawFields: SheetField[], cells: unknown[]): boolean {
  const assigned = [...assignColumns(headers, columnFields(rawFields))];
  return assigned.some(([, f]) => f.value.trim()) && assigned.every(([i, f]) => shownAs(cells[i]) === shownAs(f.value));
}

/** Destinations as a Hindi Sync Status names them. */
const DESTINATION_HI: Record<string, string> = { Notion: 'Notion', 'media upload': 'मीडिया अपलोड' };
const SUCCESS = { en: 'Success', hi: 'सफल' } as const;

/** The Sync Status cell: "Success", or "Partial (Notion, media upload failed)"; in Hindi "सफल" or "अधूरा (… नहीं हुआ)". */
export function syncStatusText(failed: string[], lang: SheetLang = 'en'): string {
  if (!failed.length) return SUCCESS[lang];
  return lang === 'hi'
    ? `अधूरा (${failed.map(n => DESTINATION_HI[n] ?? n).join(', ')} नहीं हुआ)`
    : `Partial (${failed.join(', ')} failed)`;
}

/** Destinations a Sync Status the app wrote names as failed ('Notion', 'media upload'), in either language. */
export function syncStatusFailures(status: string): string[] {
  const text = status.trim();
  const en = /^Partial \((.*) failed\)$/.exec(text);
  const hi = /^अधूरा \((.*) नहीं हुआ\)$/.exec(text);
  const fromHindi = (name: string) => Object.keys(DESTINATION_HI).find(k => DESTINATION_HI[k] === name) ?? name;
  return en ? en[1].split(', ') : hi ? hi[1].split(', ').map(fromHindi) : [];
}

/**
 * The Sync Status after a retry: destinations that worked this time leave the list, ones that
 * failed again stay. A status the app didn't write is left as it is unless something failed. A
 * status the app wrote keeps its language; older English rows are read as before.
 */
export function retriedSyncStatus(current: string, succeeded: string[], failed: string[], lang: SheetLang = 'en'): string {
  const text = current.trim();
  const en = /^Partial \((.*) failed\)$/.test(text);
  const hi = /^अधूरा \((.*) नहीं हुआ\)$/.test(text);
  const cellLang: SheetLang = hi || text === SUCCESS.hi ? 'hi' : en || text === SUCCESS.en ? 'en' : lang;
  if (!en && !hi && text !== SUCCESS.en && text !== SUCCESS.hi && text !== '' && !failed.length) return current;
  const before = syncStatusFailures(text);
  return syncStatusText([...before.filter(n => !succeeded.includes(n) && !failed.includes(n)), ...failed], cellLang);
}
