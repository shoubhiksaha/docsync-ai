import { normalizeKey } from '@/core/text';
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

/** 1234.5 → "₹1,234.5" (Indian digit grouping, at most 2 decimals). */
export function rupees(n: number): string {
  return `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
}

/** Within ₹1 or 1% of b, whichever is larger. */
export function moneyClose(a: number, b: number): boolean {
  return Math.abs(a - b) <= Math.max(1, Math.abs(b) * 0.01);
}

/** 10-digit Indian mobile, optionally with +91 or a leading 0; spaces and hyphens are ignored. */
export function isMobileNumber(raw: string): boolean {
  return MOBILE_FORMAT.test(raw.replace(/[\s-]/g, ''));
}

/** 15-character GSTIN (e.g. 27ABCDE1234F1Z5); case and spaces are ignored. */
export function isGstin(raw: string): boolean {
  return GSTIN_FORMAT.test(raw.replace(/\s+/g, '').toUpperCase());
}

/** Indian number plate or BH-series number; case, spaces, dots and hyphens are ignored. */
export function isVehicleNumber(raw: string): boolean {
  const plate = raw.replace(/[\s.-]/g, '').toUpperCase();
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
 * "1234 5678 9012" (or "UID: 1234/5678/9012") in an Aadhaar field → "XXXX XXXX 9012". A misread
 * number (8+ digits, not exactly 12) is masked the same way, so most of a real Aadhaar never
 * reaches a sheet. Any other field or value is returned unchanged.
 */
export function maskAadhaar(field: RecordField): RecordField {
  const digits = String(field.value ?? '').replace(/\D/g, '');
  if (digits.length < 8 || !isAadhaarField(field)) return field;
  return { ...field, value: `XXXX XXXX ${digits.slice(-4)}` };
}

/** Masks every standalone Aadhaar-like number inside free text ("Ramesh (234567890123)" → "Ramesh (XXXX XXXX 0123)"). */
export function maskAadhaarInText(text: string): string {
  return text.replace(AADHAAR_IN_TEXT, 'XXXX XXXX $1');
}
