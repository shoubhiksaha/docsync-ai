/**
 * The scan flow as a pure state machine: capture → extracting → review → saving → done.
 * No React, no fetch, so every transition and helper is unit-tested (__tests__/client).
 */
import type { MessageKey } from './i18n';

export type Destination = 'sheets' | 'notion' | 'media';
export const DESTINATIONS: Destination[] = ['sheets', 'notion', 'media'];

export type ErrorCode =
  | 'bad_input' | 'too_large' | 'quota' | 'unavailable'
  | 'rate_limited' | 'network' | 'session' | 'internal'
  /** The upload stopped moving on a weak connection; the photo can be kept for later. */
  | 'slow'
  /** The voice note is over the size /api/sync accepts; the record can be saved without it. */
  | 'audio_too_large';

/** Save errors that trying again can't fix, so the checked values aren't kept for later. */
export const NOT_KEEPABLE: ErrorCode[] = ['bad_input', 'too_large', 'audio_too_large'];

export interface DestinationResult {
  status: 'success' | 'failed' | 'skipped';
  /** saved | failed | not_connected | not_selected | nothing_to_store | not_retried | disabled | duplicate | skipped */
  code: string;
  detail?: string;
}

export interface ApiField {
  key: string;
  label?: string;
  value?: unknown;
  confidence?: number;
  category?: string;
}

/** One field as it is sent to /api/sync. */
export interface SyncField {
  key: string;
  label: string;
  value: string;
}

export interface ReviewField {
  id: string;
  key: string;
  label: string;
  value: string;
  confidence: number;
  removed: boolean;
  origin: 'ai' | 'template' | 'user';
  /** The user changed the value, so it no longer needs a check. */
  edited: boolean;
  /** The user marked the value as right without changing it ("Looks right"). */
  confirmed?: boolean;
}

export interface Template {
  fields: { key: string; label: string }[];
}

export interface Extraction {
  fields: ApiField[];
  documentType?: string;
  isMock?: boolean;
  warnings?: string[];
}

export interface SaveResult {
  status: 'saved' | 'partial' | 'failed';
  destinations: Partial<Record<Destination, DestinationResult>>;
  spreadsheetUrl?: string;
  warnings: string[];
  /** Photo and voice-note links the save made, sent back with a retry so a Sheets retry writes them too. */
  imageLink?: string;
  voiceNoteLink?: string;
}

type RuleCode = MessageKey extends infer K ? (K extends `rule.${infer Code}` ? Code : never) : never;

/** A business-rule warning, as modules/profiles checkFields() returns it: translated when shown (`rule.<code>`). */
export interface RuleWarning {
  code: RuleCode;
  /** Key of the field the warning is about. */
  field?: string;
  params?: Record<string, string | number>;
}

/** The user's answer to "This may already be in your sheet". */
export type DuplicateAction = 'replace' | 'keep_both';

export interface DuplicateInfo {
  count: number;
  label: string;
  value: string;
}

export type Step = 'capture' | 'extracting' | 'review' | 'saving' | 'done';

export interface ScanState {
  step: Step;
  pages: Blob[];
  scanId: string | null;
  error: ErrorCode | null;
  fields: ReviewField[];
  isMock: boolean;
  /** The server's business-rule sentences (English), shown only until the checks run on this device. */
  warnings: string[];
  /** The same checks run on this device: translated when shown, each under the field it is about. */
  rules: RuleWarning[] | null;
  note: string;
  audio: Blob | null;
  result: SaveResult | null;
  /** The fields as sent by the last save, for the Done summary, "Remember them" and retries. */
  savedFields: SyncField[] | null;
  duplicate: DuplicateInfo | null;
  /** What the user chose in the duplicate dialog for this save; retries send it again. */
  duplicateAction: DuplicateAction | null;
  /** A remembered-fields scan that came back clean saves itself after a short countdown. */
  autoSave: boolean;
  /** The user changed something on the review screen, so leaving it asks first. */
  changed: boolean;
}

export const initialScanState: ScanState = {
  step: 'capture',
  pages: [],
  scanId: null,
  error: null,
  fields: [],
  isMock: false,
  warnings: [],
  rules: null,
  note: '',
  audio: null,
  result: null,
  savedFields: null,
  duplicate: null,
  duplicateAction: null,
  autoSave: false,
  changed: false,
};

export type ScanAction =
  | { type: 'captured'; pages: Blob[]; scanId: string }
  | { type: 'extract-start' }
  /** `rules`: the document type's checks run on this device, when they could be loaded. */
  | { type: 'extract-ok'; extraction: Extraction; template: Template | null; rules?: RuleWarning[] | null }
  | { type: 'extract-failed'; error: ErrorCode }
  /** A scan kept on this device with checked fields (failed save) comes back to the review. */
  | { type: 'restored'; pages: Blob[]; scanId: string; fields: { key: string; label: string; value: string }[]; note: string; audio: Blob | null }
  | { type: 'edit'; id: string; value: string }
  /** "Looks right": clears (or puts back) the check on a value without changing it. */
  | { type: 'confirm'; id: string; confirmed: boolean }
  | { type: 'rename'; id: string; label: string }
  | { type: 'remove'; id: string }
  | { type: 'restore'; id: string }
  | { type: 'add'; label: string; value: string }
  | { type: 'note'; value: string }
  /** Adds a voice-note transcript to whatever the note says by then. */
  | { type: 'note-append'; text: string }
  | { type: 'audio'; blob: Blob | null }
  /** The profile's business-rule checks, run again after the user changed something. */
  | { type: 'rules'; rules: RuleWarning[] }
  | { type: 'auto-save-cancel' }
  | { type: 'save-start'; duplicateAction?: DuplicateAction }
  | { type: 'save-ok'; result: SaveResult }
  | { type: 'save-failed'; error: ErrorCode }
  | { type: 'duplicate'; info: DuplicateInfo }
  /** `choice`: the user's answer, kept for retries from the Saved screen. */
  | { type: 'duplicate-close'; choice?: DuplicateAction }
  | { type: 'retry-ok'; result: SaveResult }
  | { type: 'reset' };

/** Confidence below this (and not edited) asks the user for a check. */
export const CHECK_BELOW = 85;
/** Remembered fields must all be at least this confident to save without review. */
export const AUTO_SAVE_FROM = 95;

let idCounter = 0;
const nextId = () => `f${++idCounter}`;

export function keyFromLabel(label: string): string {
  const words = label.trim().toLowerCase().split(/[^\p{L}\p{M}\p{N}]+/u).filter(Boolean);
  if (words.length === 0) return `field_${Date.now().toString(36)}`;
  return words.map((w, i) => (i === 0 ? w : w[0].toUpperCase() + w.slice(1))).join('');
}

function toReviewField(field: ApiField, origin: ReviewField['origin'] = 'ai'): ReviewField {
  const confidence = Number(field.confidence);
  return {
    id: nextId(),
    key: field.key,
    label: String(field.label || field.key),
    value: field.value === undefined || field.value === null ? '' : String(field.value),
    // 0 must stay 0 (that bug showed missing fields as 100%).
    confidence: Number.isFinite(confidence) ? Math.max(0, Math.min(100, confidence)) : 0,
    removed: false,
    origin,
    edited: false,
  };
}

/**
 * Remembered fields first, in their saved order; template fields the AI didn't find are added
 * empty so the user can fill them; extra AI fields are kept but start removed (restorable).
 */
export function applyTemplate(fields: ApiField[], template: Template | null): ReviewField[] {
  if (!template?.fields.length) return fields.filter((f) => f && typeof f.key === 'string').map((f) => toReviewField(f));
  const byKey = new Map(fields.filter((f) => f && typeof f.key === 'string').map((f) => [f.key, f]));
  const ordered = template.fields.map((t) => {
    const found = byKey.get(t.key);
    byKey.delete(t.key);
    return found
      ? { ...toReviewField(found), label: t.label || String(found.label || found.key) }
      : { ...toReviewField({ key: t.key, label: t.label, value: '', confidence: 0 }, 'template') };
  });
  const extras = [...byKey.values()].map((f) => ({ ...toReviewField(f), removed: true }));
  return [...ordered, ...extras];
}

export type FieldStatus = 'ok' | 'check' | 'missing';

export function fieldStatus(field: ReviewField): FieldStatus {
  if (!field.value.trim()) return 'missing';
  if (!field.edited && !field.confirmed && field.confidence < CHECK_BELOW) return 'check';
  return 'ok';
}

/** A value the AI wasn't sure of, which the user can mark as right without retyping it. */
export function canConfirm(field: ReviewField): boolean {
  return !field.edited && field.confidence < CHECK_BELOW && field.value.trim() !== '';
}

export function activeFields(fields: ReviewField[]): ReviewField[] {
  return fields.filter((f) => !f.removed);
}

export function needsAttention(fields: ReviewField[]): number {
  return activeFields(fields).filter((f) => fieldStatus(f) !== 'ok').length;
}

export function canAutoSave(fields: ReviewField[], extraction: Extraction, template: Template | null): boolean {
  if (!template?.fields.length || extraction.isMock || (extraction.warnings?.length ?? 0) > 0) return false;
  const active = activeFields(fields);
  return active.length > 0 && active.every((f) => f.value.trim() !== '' && f.confidence >= AUTO_SAVE_FROM);
}

/**
 * Business-rule warnings placed under the field they are about (the first active field with that
 * key); the rest (no field, or one that was removed) are shown on their own.
 */
export function ruleTargets(fields: ReviewField[], rules: RuleWarning[]): { byField: Map<string, RuleWarning[]>; general: RuleWarning[] } {
  const byField = new Map<string, RuleWarning[]>();
  const general: RuleWarning[] = [];
  const active = activeFields(fields);
  for (const rule of rules) {
    const field = rule.field ? active.find((f) => f.key === rule.field) : undefined;
    if (field) byField.set(field.id, [...(byField.get(field.id) ?? []), rule]);
    else general.push(rule);
  }
  return { byField, general };
}

export function toSyncFields(fields: ReviewField[]): SyncField[] {
  return activeFields(fields).map((f) => ({ key: f.key, label: f.label.trim() || f.key, value: f.value.trim() }));
}

/** Identifies a field layout regardless of order, to spot "the same fields twice". */
export function fieldSignature(fields: { key: string }[]): string {
  return [...new Set(fields.map((f) => f.key))].sort().join('|');
}

export function failedDestinations(result: SaveResult | null): Destination[] {
  if (!result) return [];
  return DESTINATIONS.filter((d) => result.destinations[d]?.status === 'failed');
}

function statusFrom(destinations: SaveResult['destinations']): SaveResult['status'] {
  const outcomes = DESTINATIONS.map((d) => destinations[d]).filter(Boolean) as DestinationResult[];
  const failed = outcomes.some((o) => o.status === 'failed');
  const succeeded = outcomes.some((o) => o.status === 'success');
  return failed ? (succeeded ? 'partial' : 'failed') : 'saved';
}

/** Builds a SaveResult from the /api/sync response body. */
export function saveResultFrom(body: {
  destinations?: Partial<Record<Destination, DestinationResult>>;
  spreadsheetUrl?: string | null;
  warnings?: string[];
  success?: boolean;
  partial?: boolean;
  imageUrl?: string | null;
  audioUrl?: string | null;
}): SaveResult {
  const destinations = body.destinations ?? {};
  const hasDestinations = DESTINATIONS.some((d) => destinations[d]);
  return {
    status: hasDestinations ? statusFrom(destinations) : body.success ? 'saved' : body.partial ? 'partial' : 'failed',
    destinations,
    spreadsheetUrl: body.spreadsheetUrl || undefined,
    warnings: body.warnings ?? [],
    imageLink: body.imageUrl || undefined,
    voiceNoteLink: body.audioUrl || undefined,
  };
}

/** A retry only re-runs some destinations; keep the earlier outcome for the rest. */
export function mergeRetry(previous: SaveResult, retry: SaveResult): SaveResult {
  const destinations = { ...previous.destinations };
  for (const d of DESTINATIONS) {
    const next = retry.destinations[d];
    if (next && next.code !== 'not_retried') destinations[d] = next;
  }
  return {
    status: statusFrom(destinations),
    destinations,
    spreadsheetUrl: retry.spreadsheetUrl ?? previous.spreadsheetUrl,
    warnings: [...new Set([...previous.warnings, ...retry.warnings])],
    imageLink: retry.imageLink ?? previous.imageLink,
    voiceNoteLink: retry.voiceNoteLink ?? previous.voiceNoteLink,
  };
}

function updateField(fields: ReviewField[], id: string, change: Partial<ReviewField>): ReviewField[] {
  return fields.map((f) => (f.id === id ? { ...f, ...change } : f));
}

export function scanReducer(state: ScanState, action: ScanAction): ScanState {
  switch (action.type) {
    case 'captured':
      return { ...initialScanState, pages: action.pages, scanId: action.scanId };
    case 'extract-start':
      return { ...state, step: 'extracting', error: null };
    case 'extract-ok': {
      // A reading that finishes after "Cancel" (or after another photo was added) is dropped.
      if (state.step !== 'extracting') return state;
      const fields = applyTemplate(action.extraction.fields ?? [], action.template);
      return {
        ...state,
        step: 'review',
        error: null,
        fields,
        isMock: Boolean(action.extraction.isMock),
        warnings: action.extraction.warnings ?? [],
        rules: action.rules ?? null,
        autoSave: canAutoSave(fields, action.extraction, action.template) && !action.rules?.length,
      };
    }
    case 'extract-failed':
      return state.step === 'extracting' ? { ...state, step: 'capture', error: action.error } : state;
    case 'restored':
      return {
        ...initialScanState,
        step: 'review',
        pages: action.pages,
        scanId: action.scanId,
        // The user already checked these values before the save failed.
        fields: action.fields.map((f) => ({ ...toReviewField({ ...f, confidence: 100 }), edited: true })),
        note: action.note,
        audio: action.audio,
        changed: true,
      };
    case 'edit':
      return { ...state, autoSave: false, changed: true, fields: updateField(state.fields, action.id, { value: action.value, edited: true }) };
    case 'confirm':
      return { ...state, autoSave: false, changed: true, fields: updateField(state.fields, action.id, { confirmed: action.confirmed }) };
    case 'rename':
      return { ...state, autoSave: false, changed: true, fields: updateField(state.fields, action.id, { label: action.label }) };
    case 'remove':
      return { ...state, autoSave: false, changed: true, fields: updateField(state.fields, action.id, { removed: true }) };
    case 'restore':
      return { ...state, changed: true, fields: updateField(state.fields, action.id, { removed: false }) };
    case 'add': {
      const label = action.label.trim();
      if (!label) return state;
      const field: ReviewField = { ...toReviewField({ key: keyFromLabel(label), label, value: action.value, confidence: 100 }, 'user'), edited: true };
      return { ...state, autoSave: false, changed: true, fields: [...state.fields, field] };
    }
    case 'note':
      return { ...state, autoSave: false, changed: true, note: action.value };
    case 'note-append': {
      const text = action.text.trim();
      if (!text) return state;
      return { ...state, autoSave: false, changed: true, note: state.note.trim() ? `${state.note}\n\n${text}` : text };
    }
    case 'audio':
      return { ...state, autoSave: false, changed: true, audio: action.blob };
    case 'rules':
      return state.step === 'review' ? { ...state, rules: action.rules } : state;
    case 'auto-save-cancel':
      return { ...state, autoSave: false };
    case 'save-start':
      // The fields are locked while saving; what is sent now is what the Done screen shows.
      return { ...state, step: 'saving', error: null, autoSave: false, duplicate: null, duplicateAction: action.duplicateAction ?? null, result: null, savedFields: toSyncFields(state.fields) };
    case 'save-ok':
      // Nothing saved anywhere: stay on review so the user keeps their edits and can try again.
      return action.result.status === 'failed'
        ? { ...state, step: 'review', result: action.result, error: 'unavailable' }
        : { ...state, step: 'done', result: action.result, error: null };
    case 'save-failed':
      return { ...state, step: 'review', error: action.error };
    case 'duplicate':
      // A Sheets retry from the Saved screen can find one too: the dialog opens there.
      return { ...state, step: state.step === 'done' ? 'done' : 'review', duplicate: action.info };
    case 'duplicate-close':
      return { ...state, duplicate: null, duplicateAction: action.choice ?? state.duplicateAction };
    case 'retry-ok':
      return state.result ? { ...state, result: mergeRetry(state.result, action.result) } : state;
    case 'reset':
      return initialScanState;
    default:
      return state;
  }
}
