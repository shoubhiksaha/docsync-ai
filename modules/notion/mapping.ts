import { parseNumber } from '@/core/text';
import { fieldValue, type DocumentProfile, type RecordField } from '@/modules/profiles';

/** Pure mapping from a record to Notion page properties. No API calls here. */

export type SchemaProperties = Record<string, { type: string }>;

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

function monthNumber(name: string): number | undefined {
  return MONTHS[name.slice(0, 3).toLowerCase()];
}

function isoDate(year: number, month: number, day: number): string | null {
  const y = year < 100 ? 2000 + year : year;
  const d = new Date(Date.UTC(y, month - 1, day));
  if (d.getUTCFullYear() !== y || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return null;
  return `${String(y).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * Parses common Indian receipt date formats to YYYY-MM-DD (Notion requires ISO 8601).
 * Numeric dates are read day-first (24/10/2023). Returns null when unsure.
 */
export function parseDateToISO(raw: string | undefined | null): string | null {
  const value = String(raw ?? '').trim();
  if (!value) return null;

  let m = value.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (m) return isoDate(+m[1], +m[2], +m[3]);

  m = value.match(/^(\d{1,2})[-/. ](\d{1,2})[-/. ](\d{2}|\d{4})$/);
  if (m) return isoDate(+m[3], +m[2], +m[1]);

  m = value.match(/^(\d{1,2})(?:st|nd|rd|th)?[-/. ,]*([A-Za-z]{3,9})[-/. ,]*(\d{2}|\d{4})$/);
  if (m && monthNumber(m[2])) return isoDate(+m[3], monthNumber(m[2])!, +m[1]);

  m = value.match(/^([A-Za-z]{3,9})[-/. ]*(\d{1,2})(?:st|nd|rd|th)?[, ]+(\d{4})$/);
  if (m && monthNumber(m[1])) return isoDate(+m[3], monthNumber(m[1])!, +m[2]);

  return null;
}

/** Notion caps each rich_text item at 2000 characters. */
export function richText(content: string): { type: 'text'; text: { content: string } }[] {
  const chunks: { type: 'text'; text: { content: string } }[] = [];
  for (let i = 0; i < content.length && chunks.length < 100; i += 2000) {
    chunks.push({ type: 'text', text: { content: content.slice(i, i + 2000) } });
  }
  return chunks.length ? chunks : [{ type: 'text', text: { content: '' } }];
}

export interface PropertyContext {
  profile: DocumentProfile;
  fields: RecordField[];
  note?: string;
  imageLink?: string | null;
  scannedAt: string;
}

/**
 * Builds page properties, writing only properties that exist in the target database with the
 * expected type. Unknown or mismatched properties are skipped instead of failing the page.
 */
export function buildProperties(schema: SchemaProperties, ctx: PropertyContext): Record<string, unknown> {
  const props: Record<string, unknown> = {};
  const has = (name: string, type: string) => schema[name]?.type === type;

  const titleProp = Object.entries(schema).find(([, p]) => p.type === 'title')?.[0];
  if (titleProp) {
    const title = fieldValue(ctx.fields, ctx.profile.notion.titleFrom)
      ?? ctx.fields.find(f => f.value?.trim())?.value
      ?? ctx.profile.documentName;
    props[titleProp] = { title: richText(title.slice(0, 2000)) };
  }

  const date = parseDateToISO(fieldValue(ctx.fields, ctx.profile.notion.dateFrom));
  if (date && has('Date', 'date')) props.Date = { date: { start: date } };
  if (has('Scanned At', 'date')) props['Scanned At'] = { date: { start: ctx.scannedAt } };
  if (has('Profile', 'select')) props.Profile = { select: { name: ctx.profile.documentName } };
  if (ctx.note && has('Notes', 'rich_text')) props.Notes = { rich_text: richText(ctx.note) };
  if (ctx.imageLink?.startsWith('http') && has('Original Image', 'url')) props['Original Image'] = { url: ctx.imageLink };

  for (const spec of ctx.profile.notion.properties) {
    if (!has(spec.name, spec.type)) continue;
    const raw = fieldValue(ctx.fields, spec.from);
    if (raw === undefined) continue;
    if (spec.type === 'number') {
      const n = parseNumber(raw);
      if (n !== null) props[spec.name] = { number: n };
    } else if (spec.type === 'date') {
      const iso = parseDateToISO(raw);
      if (iso) props[spec.name] = { date: { start: iso } };
    } else if (spec.type === 'select') {
      props[spec.name] = { select: { name: raw.replace(/,/g, ' ').slice(0, 100) } };
    } else {
      props[spec.name] = { rich_text: richText(raw) };
    }
  }
  return props;
}
