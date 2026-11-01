/** "Donor Name", "donor_name" and "donorName" all normalize to "donorname". */
export function normalizeKey(value: unknown): string {
  return String(value ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** Digits of Indian scripts (Devanagari, Bengali, Gurmukhi, Gujarati, Odia, Tamil, Telugu, Kannada, Malayalam); each block's zero ends in 6. */
const INDIC_DIGIT = /[\u0966-\u096F\u09E6-\u09EF\u0A66-\u0A6F\u0AE6-\u0AEF\u0B66-\u0B6F\u0BE6-\u0BEF\u0C66-\u0C6F\u0CE6-\u0CEF\u0D66-\u0D6F]/g;

/** "₹१,५४०" → "₹1,540": Indian-script digits become 0-9, one character each, so positions don't move. */
export function toAsciiDigits(text: string): string {
  return text.replace(INDIC_DIGIT, d => String((d.charCodeAt(0) - 6) % 16));
}

/** "₹5,000.50" → 5000.5, "15,000 kg" → 15000, "१५४०" → 1540; null when no number is present. */
export function parseNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const match = toAsciiDigits(String(value ?? '')).replace(/,/g, '').match(/-?\d+(\.\d+)?/);
  if (!match) return null;
  const n = Number(match[0]);
  return Number.isFinite(n) ? n : null;
}
