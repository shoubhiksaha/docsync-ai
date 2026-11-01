import { normalizeKey, parseNumber, toAsciiDigits } from '@/core/text';
import type { RecordField } from './types';

const MOBILE_FORMAT = /^(\+91[\s-]?|0)?[6-9]\d{9}$/;
const GSTIN_FORMAT = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
/**
 * Standard plates (MH 12 AB 1234, DL 3C AB 1234, UP 32 T 123): older and handwritten serials may drop
 * leading zeros, but without series letters the serial must have 4 digits, so "GJ 05" isn't a plate.
 */
const VEHICLE_FORMAT = /^[A-Z]{2}\d{1,2}(?:[A-Z]{1,3}\d{1,4}|\d{4})$/;
/** Bharat (BH) series, e.g. 22 BH 1234 AA. */
const BH_FORMAT = /^\d{2}BH\d{4}[A-Z]{1,2}$/;
const AADHAAR_NAME = /a{1,2}dh?a{1,2}r/;
const UID_KEYS = new Set(['uid', 'uidno', 'uidnumber']);
/** A standalone 12-digit run, optionally grouped 4-4-4 ("1234 5678 9012", "1234-5678-9012", "1234.5678.9012"). */
const AADHAAR_IN_TEXT = /\b\d{4}[\s./-]?\d{4}[\s./-]?(\d{4})\b/g;
/** A minus written before the rupee sign: "-₹200", "- Rs 200". */
const MINUS_BEFORE_CURRENCY = /-\s*(?:₹|rs\.?|inr)\s*\d/i;
/** A balance the customer has overpaid: "₹200 advance", "200 Cr", "₹200 jama adhik". */
const IN_CREDIT = /\d\s*(?:\/-)?\s*(?:\(?\s*(?:adv(?:ance)?|cr\.?|jama adhik)\b|एडवांस|अग्रिम|जमा अधिक)/i;
/** Units a weight is written in, as kg per unit (dots removed first: "M.T." → "mt"). */
const WEIGHT_UNITS: [RegExp, number][] = [
  [/^(?:mt|tons?|tonnes?|t|टन्?)$/i, 1000],
  [/^(?:q|qtls?|qntls?|quintals?|क्विंटल|कुंतल)$/i, 100],
  [/^(?:kgs?|kilos?|kilograms?|किलो|किलोग्राम|किग्रा)$/i, 1],
  [/^(?:g|gms?|grams?|ग्राम)$/i, 0.001],
];
/** A number and the word after it: "18.60 qtl", "60 किलो", "62.5 (Qtl)", "9340". */
const WEIGHT_PART = /(\d+(?:\.\d+)?)\s*\(?\s*([a-z.]+|[ऀ-ॿ.]+)?/gi;
/** What may join the parts of one weight: "18 qtl 60 kg", "3 MT + 200 kg", "18 क्विंटल और 60 किलो". */
const WEIGHT_JOIN = /^\s*(?:,|\+|&|and|aur|और)?\s*$/i;
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/** 1234.5 → "₹1,234.5", -200 → "−₹200" (Indian digit grouping, at most 2 decimals). */
export function rupees(n: number): string {
  return `${n < 0 ? '−' : ''}₹${Math.abs(n).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
}

/**
 * Like parseNumber, but a balance written as "-₹200", "₹200 advance" or "200 Cr" is negative
 * (the customer has paid ahead). Null when no number is present.
 */
export function signedAmount(text: string | undefined): number | null {
  const n = parseNumber(text);
  if (n === null || n < 0) return n;
  const ascii = toAsciiDigits(text ?? '');
  return MINUS_BEFORE_CURRENCY.test(ascii) || IN_CREDIT.test(ascii) ? -n : n;
}

/** kg per unit for a unit word ("Qtl" → 100, "किलो" → 1), or null when it isn't a weight unit. */
function kgPerUnit(word: string | undefined): number | null {
  const unit = (word ?? '').replace(/\./g, '');
  return WEIGHT_UNITS.find(([pattern]) => pattern.test(unit))?.[1] ?? null;
}

/**
 * Weight in kg: "3.2 MT" → 3200, "32 Qtl" → 3200, "24.86 टन" → 24860, "500 g" → 0.5, and a
 * compound weight is added up: "18 qtl 60 kg" → 1860, "18 क्विंटल 60 किलो" → 1860. A number
 * written without a unit counts as `bareKg` kg each (1 by default, so "9340" → 9340); with null,
 * such a number gives null. Null when no number is present.
 */
export function weightKg(raw = '', bareKg: number | null = 1): number | null {
  const text = toAsciiDigits(raw).replace(/(\d),(?=\d)/g, '$1');
  let total: number | null = null;
  let lastFactor = Infinity;
  let end = 0;
  for (const part of text.matchAll(WEIGHT_PART)) {
    const factor = kgPerUnit(part[2]);
    if (total === null) {
      const perUnit = factor ?? bareKg;
      if (perUnit === null) return null;
      total = Number(part[1]) * perUnit;
      if (factor === null) break;
    } else {
      // Only a smaller unit straight after the last part continues the weight ("18 qtl 60 kg").
      if (factor === null || factor >= lastFactor || !WEIGHT_JOIN.test(text.slice(end, part.index))) break;
      total += Number(part[1]) * factor;
    }
    lastFactor = factor;
    end = (part.index ?? 0) + part[0].length;
  }
  return total === null ? null : Math.round(total * 1000) / 1000;
}

export interface IndianDate {
  y: number;
  m: number;
  d: number;
  /** Written as a month only ("08/2028", "Aug 2028"); `d` is then that month's last day. */
  monthOnly: boolean;
  /** Midnight UTC of that day, for comparing and subtracting dates. */
  time: number;
}

/**
 * The date at the start of `text`: day-first "18-10-2026", "18/10/26", "18.10.2026", "18 Oct 2026",
 * or ISO "2026-10-18". Anything after the date is ignored, so a printed time ("08-10-2026 11:42")
 * is fine. With `monthOnly`, an expiry such as "08/2028" or "Aug 28" is read first, as the last
 * day of that month. Two-digit years are 20xx. Null when unreadable or not a real day.
 */
export function parseIndianDate(text: string | undefined, options: { monthOnly?: boolean } = {}): IndianDate | null {
  const s = toAsciiDigits(String(text ?? '')).trim().toLowerCase();
  const year = (y: string) => (y.length === 2 ? 2000 + Number(y) : Number(y));
  const month = (m: string) => (/^\d+$/.test(m) ? Number(m) : MONTHS.indexOf(m.slice(0, 3)) + 1);
  const make = (y: number, m: number, d: number | null): IndianDate | null => {
    if (m < 1 || m > 12) return null;
    const day = d ?? new Date(Date.UTC(y, m, 0)).getUTCDate();
    const time = Date.UTC(y, m - 1, day);
    const check = new Date(time);
    return check.getUTCMonth() === m - 1 && check.getUTCDate() === day ? { y, m, d: day, monthOnly: d === null, time } : null;
  };
  if (options.monthOnly) {
    // "08/2028" or "Aug 2028", but not the start of "08/10/2028".
    const x = s.match(/^(\d{1,2}|[a-z]{3,9})[-/. ,]+(\d{4}|\d{2})(?!\d|[-/.]\d)/);
    const date = x && make(year(x[2]), month(x[1]), null);
    if (date) return date;
  }
  let x = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?!\d)/);
  if (x) return make(Number(x[1]), Number(x[2]), Number(x[3]));
  x = s.match(/^(\d{1,2})[-/. ]+(\d{1,2}|[a-z]{3,9})[-/., ]+(\d{4}|\d{2})(?!\d)/);
  return x ? make(year(x[3]), month(x[2]), Number(x[1])) : null;
}

/** Within ₹1 or 1% of b, whichever is larger. */
export function moneyClose(a: number, b: number): boolean {
  return Math.abs(a - b) <= Math.max(1, Math.abs(b) * 0.01);
}

/** 10-digit Indian mobile, optionally with +91 or a leading 0; spaces and hyphens are ignored. */
export function isMobileNumber(raw: string): boolean {
  return MOBILE_FORMAT.test(toAsciiDigits(raw).replace(/[\s-]/g, ''));
}

/** 15-character GSTIN (e.g. 27ABCDE1234F1Z5); case and spaces are ignored. */
export function isGstin(raw: string): boolean {
  return GSTIN_FORMAT.test(toAsciiDigits(raw).replace(/\s+/g, '').toUpperCase());
}

/** Indian number plate or BH-series number; case, spaces, dots and hyphens are ignored. */
export function isVehicleNumber(raw: string): boolean {
  const plate = toAsciiDigits(raw).replace(/[\s.-]/g, '').toUpperCase();
  return VEHICLE_FORMAT.test(plate) || BH_FORMAT.test(plate);
}

/** True when the field's key or label names Aadhaar ("Aadhaar No", "Adhar", "आधार", "UID"). */
export function isAadhaarField(field: RecordField): boolean {
  const key = normalizeKey(field.key);
  const label = normalizeKey(field.label);
  return AADHAAR_NAME.test(key + label)
    || String(field.label ?? '').includes('आधार')
    || UID_KEYS.has(key) || UID_KEYS.has(label);
}

/**
 * "1234 5678 9012" (or "UID: 1234/5678/9012", or "२३४५ ६७८९ ०१२३") in an Aadhaar field → "XXXX XXXX 9012". A misread
 * number (8+ digits, not exactly 12) is masked the same way, so most of a real Aadhaar never
 * reaches a sheet. Any other field or value is returned unchanged.
 */
export function maskAadhaar(field: RecordField): RecordField {
  const digits = toAsciiDigits(String(field.value ?? '')).replace(/\D/g, '');
  if (digits.length < 8 || !isAadhaarField(field)) return field;
  return { ...field, value: `XXXX XXXX ${digits.slice(-4)}` };
}

/** maskAadhaar over a whole record; the same array comes back when nothing needed masking. */
export function maskAadhaarFields(fields: RecordField[]): RecordField[] {
  const masked = fields.map(maskAadhaar);
  return masked.some((f, i) => f !== fields[i]) ? masked : fields;
}

/**
 * Masks every standalone Aadhaar-like number inside free text ("Ramesh (234567890123)" → "Ramesh (XXXX XXXX 0123)"),
 * also when it is written in Devanagari or another Indian script's digits.
 */
export function maskAadhaarInText(text: string): string {
  const ascii = toAsciiDigits(text);
  if (ascii === text) return text.replace(AADHAAR_IN_TEXT, 'XXXX XXXX $1');
  // `ascii` has the same length as `text`, so a match's position is the same in both.
  let out = '';
  let end = 0;
  for (const match of ascii.matchAll(AADHAAR_IN_TEXT)) {
    out += `${text.slice(end, match.index)}XXXX XXXX ${match[1]}`;
    end = (match.index ?? 0) + match[0].length;
  }
  return out + text.slice(end);
}
