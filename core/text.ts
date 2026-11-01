/**
 * "Donor Name", "donor_name" and "donorName" all normalize to "donorname". Letters of any script
 * are kept, so "रसीद नंबर" becomes "रसीदनंबर" rather than "" (which would match nothing).
 */
export function normalizeKey(value: unknown): string {
  return String(value ?? '').normalize('NFC').toLowerCase().replace(/[^\p{L}\p{M}\p{N}]/gu, '');
}

/** "₹5,000.50" → 5000.5, "15,000 kg" → 15000; null when no number is present. */
export function parseNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const match = String(value ?? '').replace(/,/g, '').match(/-?\d+(\.\d+)?/);
  if (!match) return null;
  const n = Number(match[0]);
  return Number.isFinite(n) ? n : null;
}
