/**
 * Extraction module — turns a document photo into reviewed-ready fields.
 * Depends on the ai module for model calls and on profiles for prompts, mock data and
 * business-rule warnings. Never throws for a single bad field; malformed model output is
 * cleaned up or dropped field-by-field.
 */
import sharp from 'sharp';
import { isModuleEnabled } from '@/core/env';
import { normalizeKey, toAsciiDigits } from '@/core/text';
import { AIUnavailableError, aiCandidates, chatJson } from '@/modules/ai';
import { maskAadhaar, maskAadhaarInText, validateFields, type DocumentProfile, type RecordField } from '@/modules/profiles';

export const MAX_DOCUMENT_BYTES = 20 * 1024 * 1024;
/** Pages of one document sent together (e.g. a two-sided receipt or a multi-page PDF). */
export const MAX_PAGES = 4;
const MAX_FIELDS = 100;
const CATEGORIES = new Set(['identity', 'financial', 'date', 'contact', 'metadata', 'other']);

export interface ExtractionResult {
  documentType: string;
  fields: Required<Pick<RecordField, 'key' | 'label' | 'value' | 'confidence' | 'category'>>[];
  totalFieldsVisible: number;
  warnings: string[];
  isMock: boolean;
  provider?: string;
  stats: { originalSize: number; processedSize: number };
}

export class ExtractionUnavailableError extends Error {
  /** `input`: the upload itself is unusable (unreadable image, nothing sent) — retrying won't help. */
  constructor(message: string, public readonly quotaLike: boolean, public readonly kind: 'service' | 'input' = 'service') {
    super(message);
    this.name = 'ExtractionUnavailableError';
  }
}

/** Downscale for the vision model; retries smaller if the first pass is still over 5MB. */
export async function prepareImage(buffer: Buffer): Promise<Buffer> {
  let out = await sharp(buffer)
    .rotate()
    .resize({ width: 2048, height: 2048, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 85 })
    .toBuffer();
  if (out.length > 5 * 1024 * 1024) {
    out = await sharp(buffer)
      .rotate()
      .resize({ width: 1200, height: 1200, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 65 })
      .toBuffer();
  }
  return out;
}

function toCamelKey(label: string): string {
  const words = label.replace(/[^A-Za-z0-9 ]+/g, ' ').trim().split(/\s+/).filter(Boolean);
  return words.map((w, i) => (i === 0 ? w.toLowerCase() : w[0].toUpperCase() + w.slice(1).toLowerCase())).join('') || 'field';
}

/** How an Aadhaar number is printed ("1234 5678 9012"), or text that names one. */
const AADHAAR_GROUPED = /\b\d{4}[\s./-]\d{4}[\s./-]\d{4}\b/;
const MENTIONS_AADHAAR = /a{1,2}dh?a{1,2}r|आधार|\buid\b/i;
const ID_PROOF_LABEL = /id\s*proof|kyc|identity|पहचान/i;

/** Masks Aadhaar-like numbers in free text (a note, an "ID proof" line), keeping the last 4 digits. */
export function protectAadhaarInText(text: string): string {
  return AADHAAR_GROUPED.test(toAsciiDigits(text)) || MENTIONS_AADHAAR.test(text) ? maskAadhaarInText(text) : text;
}

/**
 * Never show or store a full Aadhaar number, on any profile: an Aadhaar field keeps its last 4
 * digits, and so does any 12-digit number in an ID-proof field or written the way Aadhaar is
 * printed. Phone numbers ("+919876543210") and longer IDs (IMEI) are left alone.
 */
export function protectAadhaar<T extends RecordField>(field: T): T {
  const named = maskAadhaar(field) as T;
  if (named !== field) return named;
  const value = String(field.value ?? '');
  const masked = field.category === 'identity' || ID_PROOF_LABEL.test(field.label ?? '')
    ? maskAadhaarInText(value)
    : protectAadhaarInText(value);
  return masked === value ? field : { ...field, value: masked };
}

/**
 * Coerces model output into well-formed fields; drops entries without a key/label and value.
 * Keys and labels come out unique ("Amount", "Amount 2"), so each field gets its own column.
 */
export function normalizeFields(raw: unknown): ExtractionResult['fields'] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const seenLabels = new Set<string>();
  const out: ExtractionResult['fields'] = [];

  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const f = item as Record<string, unknown>;
    const label = String(f.label ?? f.key ?? '').trim();
    const value = f.value === null || f.value === undefined ? '' : (typeof f.value === 'object' ? JSON.stringify(f.value) : String(f.value)).trim();
    if (!label) continue;

    let key = String(f.key ?? '').trim().replace(/[^A-Za-z0-9_]/g, '') || toCamelKey(label);
    if (seen.has(key)) key = `${key}${out.length + 1}`;
    seen.add(key);

    let uniqueLabel = label.slice(0, 120);
    for (let n = 2; seenLabels.has(normalizeKey(uniqueLabel)); n++) uniqueLabel = `${label.slice(0, 115)} ${n}`;
    seenLabels.add(normalizeKey(uniqueLabel));

    const confidence = Math.max(0, Math.min(100, Math.round(Number(f.confidence) || 0)));
    const category = CATEGORIES.has(String(f.category)) ? String(f.category) : 'other';
    out.push(protectAadhaar({ key, label: uniqueLabel, value: value.slice(0, 2000), confidence, category }));
    if (out.length >= MAX_FIELDS) break;
  }
  return out;
}

export function buildSystemPrompt(profile: DocumentProfile | undefined, focusFields: string[]): string {
  const priority = [...new Set([...(profile?.extraction.priorityFields ?? []), ...focusFields])];
  return `You are an expert document analysis AI. Your job is to extract EVERY visible field from the document image.
Your entire response MUST be valid JSON. DO NOT include markdown formatting like \`\`\`json. Return raw JSON matching this schema exactly:
{
  "fields": [
    {
      "key": "camelCase machine key, e.g. receiptNumber",
      "label": "Human-readable label, e.g. Receipt Number",
      "value": "The extracted value as a string",
      "confidence": 0-100,
      "category": "identity | financial | date | contact | metadata | other"
    }
  ],
  "documentType": "Brief description of what document type this appears to be",
  "totalFieldsVisible": 5
}

Be exhaustive — capture everything:
- Dates, reference numbers, IDs
- Names (person, organization, NGO, company)
- Financial amounts, percentages, tax info
- Addresses, contact info, phone, email
- Legal references, section numbers, certificate IDs
- Any labels/fields printed on the form that have values filled in
- Stamps, signatures noted as present (even if not readable)

Write every number in a value with Western digits 0-9, even when the document uses Hindi (Devanagari) or other Indian digits: "१,५४०" → "1,540".

For confidence: 95+ = clearly printed, 75-94 = slightly unclear, 50-74 = partially visible, <50 = inferred.
Return every field you can possibly identify.${profile ? `\n\nContext: ${profile.extraction.context}` : ''}${priority.length ? `\n\nALWAYS look for these fields and use these labels when present: ${priority.join(', ')}.` : ''}`;
}

function mockResult(profile: DocumentProfile | undefined, stats: ExtractionResult['stats']): ExtractionResult {
  const fields = normalizeFields(profile?.mockFields ?? []);
  return {
    documentType: 'Mock Document',
    fields,
    totalFieldsVisible: fields.length,
    warnings: profile ? validateFields(profile, fields) : [],
    isMock: true,
    stats,
  };
}

function readableAnswer(text: string): boolean {
  try {
    return Array.isArray((JSON.parse(text) as { fields?: unknown })?.fields);
  } catch {
    return false;
  }
}

export interface ExtractInput {
  /** Single-page input (kept for compatibility); ignored when `documents` is given. */
  document?: Buffer;
  /** Pages of the same document, in order; at most MAX_PAGES are used. */
  documents?: Buffer[];
  profile?: DocumentProfile;
  /** Field labels from the user's saved template. */
  focusFields?: string[];
  customApiKey?: string | null;
}

export async function extractFields(input: ExtractInput): Promise<ExtractionResult> {
  if (!isModuleEnabled('extraction')) {
    throw new ExtractionUnavailableError('Document extraction is temporarily disabled.', false);
  }

  const pages = (input.documents?.length ? input.documents : input.document ? [input.document] : []).slice(0, MAX_PAGES);
  if (pages.length === 0) throw new ExtractionUnavailableError('No document was provided.', false, 'input');
  const images = await Promise.all(pages.map(prepareImage)).catch(() => {
    throw new ExtractionUnavailableError('This photo could not be opened. Please use a JPG or PNG photo.', false, 'input');
  });
  const stats = {
    originalSize: pages.reduce((n, p) => n + p.length, 0),
    processedSize: images.reduce((n, i) => n + i.length, 0),
  };

  if (aiCandidates(input.customApiKey).length === 0) {
    return mockResult(input.profile, stats);
  }

  try {
    const { text, provider } = await chatJson({
      system: buildSystemPrompt(input.profile, input.focusFields ?? []),
      user: `Extract ALL fields from this ${input.profile?.documentName ?? 'document'}.${pages.length > 1 ? ` The ${pages.length} images are ${pages.length} pages of the same document, in order; return one combined field list.` : ''} Be exhaustive.`,
      images: images.map(image => ({ mimeType: 'image/jpeg', base64Data: image.toString('base64') })),
      customApiKey: input.customApiKey,
      // Unreadable or cut-off JSON moves on to the next provider instead of ending the scan.
      accept: readableAnswer,
    });

    let parsed: { documentType?: unknown; fields?: unknown; totalFieldsVisible?: unknown };
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new ExtractionUnavailableError('The AI service gave an unreadable answer. Please try again.', false);
    }
    const fields = normalizeFields(parsed.fields);
    if (fields.length === 0) {
      throw new ExtractionUnavailableError('No details could be read from this document. Try a clearer, well-lit photo.', false, 'input');
    }

    return {
      documentType: String(parsed.documentType ?? input.profile?.documentName ?? 'Document').slice(0, 200),
      fields,
      totalFieldsVisible: Number(parsed.totalFieldsVisible) || fields.length,
      warnings: input.profile ? validateFields(input.profile, fields) : [],
      isMock: false,
      provider,
      stats,
    };
  } catch (err) {
    if (err instanceof AIUnavailableError) {
      // Provider details go to the server log; the user gets a plain explanation.
      console.error('[extraction] every AI provider failed:', err.message.slice(0, 1000));
      throw new ExtractionUnavailableError(
        err.quotaLike
          ? 'The AI service is busy or has reached its limit. Please try again in a few minutes, or add your own AI key in Settings.'
          : 'The AI service could not read this document right now. Please try again in a minute.',
        err.quotaLike,
      );
    }
    throw err;
  }
}

export function extractionHealth() {
  return { enabled: isModuleEnabled('extraction'), configured: true, circuit: 'closed' as const };
}
