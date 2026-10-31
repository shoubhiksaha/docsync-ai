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
}

export const META_COLUMNS: readonly { key: keyof RowMeta; label: string; aliases: string[] }[] = [
  { key: 'notes', label: 'Notes (Text/Audio)', aliases: ['notes', 'notestextaudio'] },
  { key: 'voiceNoteLink', label: 'Voice Note Audio Link', aliases: ['voicenotelink', 'voicenoteaudiolink'] },
  { key: 'imageLink', label: 'Link to Image', aliases: ['linktoimage'] },
  { key: 'syncedAt', label: 'Synced At', aliases: ['syncedat'] },
  { key: 'syncStatus', label: 'Sync Status', aliases: ['syncstatus'] },
];

function metaColumnFor(header: string) {
  const norm = normalizeKey(header);
  return META_COLUMNS.find(m => m.aliases.includes(norm));
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
 * Returns the header row needed to hold `fields`. New fields are inserted before the metadata
 * columns; an empty sheet gets every field plus the metadata columns.
 */
export function mergeHeaders(existing: string[], fields: SheetField[]): { headers: string[]; changed: boolean } {
  const cleanExisting = existing.map(h => String(h ?? ''));
  if (cleanExisting.every(h => h.trim() === '')) {
    return { headers: [...fields.map(f => f.label || f.key), ...META_COLUMNS.map(m => m.label)], changed: true };
  }

  const missing = fields.filter(f => !cleanExisting.some(h => headerMatches(h, f)));
  if (missing.length === 0) return { headers: cleanExisting, changed: false };

  const metaIndex = cleanExisting.findIndex(h => metaColumnFor(h));
  const insertAt = metaIndex === -1 ? cleanExisting.length : metaIndex;
  const headers = [...cleanExisting];
  headers.splice(insertAt, 0, ...missing.map(f => f.label || f.key));
  return { headers, changed: true };
}

/** Stops cell values from being evaluated as formulas (="…", +…, @…), while keeping numbers numeric. */
export function sanitizeCell(value: unknown): unknown {
  if (value === null || value === undefined) return '';
  if (typeof value !== 'string') return value;
  if (/^[=+\-@\t\r]/.test(value) && !/^[+-]?\d[\d,]*(\.\d+)?$/.test(value.trim())) return `'${value}`;
  return value;
}

export function buildRow(headers: string[], fields: SheetField[], meta: RowMeta): unknown[] {
  return headers.map(header => {
    const metaColumn = metaColumnFor(header);
    if (metaColumn) return sanitizeCell(meta[metaColumn.key]);
    const field = fields.find(f => headerMatches(header, f));
    return sanitizeCell(field?.value ?? '');
  });
}

/** Index of the column holding the primary key (matched against the PK field's key or label). */
export function primaryKeyColumn(headers: string[], fields: SheetField[], primaryKey: string): { index: number; value: string } | null {
  const pkNorm = normalizeKey(primaryKey);
  const field = fields.find(f => normalizeKey(f.key) === pkNorm || normalizeKey(f.label) === pkNorm);
  const value = field?.value?.trim();
  if (!field || !value) return null;
  const index = headers.findIndex(h => normalizeKey(h) === pkNorm || headerMatches(h, field));
  return index === -1 ? null : { index, value };
}
