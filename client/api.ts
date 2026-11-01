/**
 * Typed calls to DocSync's API routes. Every failure becomes an ApiError with an ErrorCode, which
 * the UI turns into plain-language copy (client/i18n `error.<code>`).
 */
import {
  saveResultFrom,
  type Destination,
  type DuplicateInfo,
  type ErrorCode,
  type Extraction,
  type SaveResult,
} from './scan-flow';

export class ApiError extends Error {
  constructor(public readonly code: ErrorCode, public readonly status = 0) {
    super(code);
  }
}

const CODES: ErrorCode[] = ['bad_input', 'too_large', 'quota', 'unavailable', 'rate_limited', 'network', 'session', 'internal', 'audio_too_large', 'slow'];

export function errorCodeFor(status: number, body: unknown): ErrorCode {
  const code = (body as { code?: unknown } | null)?.code;
  if (typeof code === 'string' && (CODES as string[]).includes(code)) return code as ErrorCode;
  if (status === 401) return 'session';
  if (status === 413) return 'too_large';
  if (status === 429) return 'rate_limited';
  if (status === 400) return 'bad_input';
  if (status === 502 || status === 503 || status === 504) return 'unavailable';
  return 'internal';
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- response bodies are validated field by field below
type Json = any;

// A stalled upload on a weak network must end in an error the user can act on, not a spinner.
const PREFS_TIMEOUT = 15_000;
const TRANSCRIBE_TIMEOUT = 90_000;
const DOCUMENT_TIMEOUT = 120_000;
/** An upload that sends nothing for this long has stalled; one that keeps moving is never cut off. */
const STALL_TIMEOUT = 30_000;
/** The largest voice note /api/sync accepts (MAX_AUDIO_BYTES in modules/transcription). */
export const MAX_AUDIO_BYTES = 10 * 1024 * 1024;

async function send(url: string, init: RequestInit = {}, timeoutMs = 0): Promise<{ status: number; body: Json }> {
  const controller = new AbortController();
  const caller = init.signal;
  let timedOut = false;
  const cancel = () => controller.abort();
  if (caller?.aborted) controller.abort();
  else caller?.addEventListener('abort', cancel);
  const timer = timeoutMs ? setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs) : undefined;
  try {
    let response: Response;
    try {
      response = await fetch(url, { ...init, signal: controller.signal });
    } catch (err) {
      if ((err as Error)?.name === 'AbortError' && !timedOut) throw err;
      throw new ApiError('network');
    }
    const body = await response.json().catch(() => null);
    if (timedOut) throw new ApiError('network');
    return { status: response.status, body };
  } finally {
    clearTimeout(timer);
    caller?.removeEventListener('abort', cancel);
  }
}

/**
 * send() for a form upload, through XMLHttpRequest because fetch can't report upload progress:
 * on a weak network the upload is the slow part, and the progress shown should be real.
 * A slow upload that keeps moving gets the time it needs (1 MB takes minutes on 2G); only one that
 * stops for STALL_TIMEOUT ends, as 'slow'. Once sent, the server has `timeoutMs` to answer.
 */
function sendWithProgress(url: string, body: FormData, signal: AbortSignal | undefined, timeoutMs: number, onProgress: (sent: number) => void): Promise<{ status: number; body: Json }> {
  return new Promise((resolve, reject) => {
    const aborted = () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
    if (signal?.aborted) return aborted();
    const xhr = new XMLHttpRequest();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let expired: ErrorCode | null = null;
    const expireIn = (ms: number, code: ErrorCode) => {
      clearTimeout(timer);
      timer = setTimeout(() => { expired = code; xhr.abort(); }, ms);
    };
    const cancel = () => xhr.abort();
    const finish = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', cancel);
    };
    signal?.addEventListener('abort', cancel);
    xhr.open('POST', url);
    const sent = () => {
      expireIn(timeoutMs, 'unavailable');
      onProgress(1);
    };
    xhr.upload.onprogress = (e) => {
      const known = e.lengthComputable && e.total > 0;
      // Everything sent counts as done even if the upload's load event never comes.
      if (known && e.loaded >= e.total) return sent();
      expireIn(STALL_TIMEOUT, 'slow');
      if (known) onProgress(e.loaded / e.total);
    };
    xhr.upload.onload = sent;
    xhr.onload = () => {
      finish();
      onProgress(1);
      let parsed: Json = null;
      try {
        parsed = JSON.parse(xhr.responseText);
      } catch {
        // not JSON: the status alone decides the error
      }
      resolve({ status: xhr.status, body: parsed });
    };
    xhr.onerror = () => {
      finish();
      reject(new ApiError('network'));
    };
    xhr.onabort = () => {
      finish();
      if (expired) reject(new ApiError(expired));
      else aborted();
    };
    xhr.send(body);
    expireIn(STALL_TIMEOUT, 'slow');
  });
}

function jsonInit(method: string, payload: unknown): RequestInit {
  return { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) };
}

// ─── Extraction ──────────────────────────────────────────────────────────────

/** `onProgress` hears how much of the upload has been sent (0 to 1); 1 means the AI is reading. */
export async function extractDocument(pages: Blob[], profileId: string, focusFields: string[], signal?: AbortSignal, onProgress?: (sent: number) => void): Promise<Extraction> {
  const form = new FormData();
  pages.forEach((page, i) => form.append('document', page, `page-${i + 1}.jpg`));
  form.append('profileId', profileId);
  if (focusFields.length) form.append('customFields', JSON.stringify(focusFields));
  const { status, body } = onProgress && typeof XMLHttpRequest !== 'undefined'
    ? await sendWithProgress('/api/extract-freeform', form, signal, DOCUMENT_TIMEOUT, onProgress)
    : await send('/api/extract-freeform', { method: 'POST', body: form, signal }, DOCUMENT_TIMEOUT);
  if (status !== 200 || !body?.success || !Array.isArray(body.fields)) throw new ApiError(errorCodeFor(status, body), status);
  return {
    fields: body.fields,
    documentType: body.documentType,
    isMock: Boolean(body.isMock),
    warnings: Array.isArray(body.warnings) ? body.warnings : [],
  };
}

// ─── Sync ────────────────────────────────────────────────────────────────────

export interface SyncInput {
  profileId: string;
  fields: { key: string; label: string; value: string }[];
  archive: Blob | null;
  note: string;
  audio: Blob | null;
  duplicateAction?: 'replace' | 'keep_both';
  /** Retry only these destinations. */
  only?: Destination[];
  /** Hears how much of the upload has been sent (0 to 1), as for extractDocument. */
  onProgress?: (sent: number) => void;
}

export type SyncOutcome = { kind: 'saved'; result: SaveResult } | { kind: 'duplicate'; info: DuplicateInfo };

function audioName(audio: Blob): string {
  if (audio.type.includes('mp4') || audio.type.includes('aac')) return 'voice-note.m4a';
  if (audio.type.includes('ogg')) return 'voice-note.ogg';
  return 'voice-note.webm';
}

export async function syncRecord(input: SyncInput): Promise<SyncOutcome> {
  // Said before uploading, and not blamed on the photo: the record can be saved without the note.
  if (input.audio && input.audio.size > MAX_AUDIO_BYTES) throw new ApiError('audio_too_large', 413);
  const form = new FormData();
  form.append('fields', JSON.stringify(input.fields));
  form.append('profileId', input.profileId);
  if (input.archive) form.append('document', input.archive, 'document.jpg');
  if (input.note.trim()) form.append('noteText', input.note.trim());
  if (input.audio) form.append('audioFile', input.audio, audioName(input.audio));
  if (input.duplicateAction) form.append('duplicateAction', input.duplicateAction);
  if (input.only?.length) form.append('only', input.only.join(','));

  const { status, body } = input.onProgress && typeof XMLHttpRequest !== 'undefined'
    ? await sendWithProgress('/api/sync', form, undefined, DOCUMENT_TIMEOUT, input.onProgress)
    : await send('/api/sync', { method: 'POST', body: form }, DOCUMENT_TIMEOUT);
  if (status === 409) {
    return {
      kind: 'duplicate',
      info: { count: Number(body?.duplicateCount) || 1, label: String(body?.primaryKeyLabel || ''), value: String(body?.primaryKeyValue || '') },
    };
  }
  // 502 with per-destination outcomes means "every destination failed" — still a result to show.
  if ((status === 200 || status === 502) && body?.destinations) return { kind: 'saved', result: saveResultFrom(body) };
  throw new ApiError(errorCodeFor(status, body), status);
}

// ─── Voice notes ─────────────────────────────────────────────────────────────

export async function transcribe(audio: Blob): Promise<string> {
  const form = new FormData();
  form.append('audio', audio, audioName(audio));
  const { status, body } = await send('/api/transcribe', { method: 'POST', body: form }, TRANSCRIBE_TIMEOUT);
  if (status !== 200 || typeof body?.text !== 'string' || !body.text.trim()) throw new ApiError(errorCodeFor(status, body), status);
  return body.text.trim();
}

// ─── Per-profile preferences ─────────────────────────────────────────────────

export interface ProfilePrefs {
  profileId: string;
  fields: { key: string; label: string }[] | null;
  primaryKey: string | null;
  defaultPrimaryKey: string | null;
}

export async function fetchPrefs(profileId: string): Promise<ProfilePrefs | null> {
  try {
    const { status, body } = await send(`/api/profile-prefs?profile=${encodeURIComponent(profileId)}`, {}, PREFS_TIMEOUT);
    return status === 200 && body ? body : null;
  } catch {
    return null;
  }
}

export async function savePrefs(profileId: string, update: { fields?: { key: string; label: string }[] | null; primaryKey?: string | null }): Promise<ProfilePrefs> {
  const { status, body } = await send('/api/profile-prefs', jsonInit('POST', { profileId, ...update }));
  if (status !== 200 || !body) throw new ApiError(errorCodeFor(status, body), status);
  return body;
}

// ─── Settings ────────────────────────────────────────────────────────────────

export type UploadDest = 'both' | 'gdrive' | 'notion';

export interface SettingsStatus {
  hasOpenAiKey: boolean;
  aiKeyHint: string | null;
  aiProvider: 'groq' | 'openai' | 'google' | 'anthropic' | null;
  hasNotionKey: boolean;
  hasNotionDbId: boolean;
  uploadDest: UploadDest;
  /** Cross-device settings are on and actually being kept. */
  isPersistent: boolean;
  /** Cross-device settings work right now; when false the choice is shown but can't be changed. */
  syncAvailable: boolean;
}

export async function fetchSettings(): Promise<SettingsStatus> {
  const { status, body } = await send('/api/settings');
  if (status !== 200 || !body) throw new ApiError(errorCodeFor(status, body), status);
  return body;
}

export interface SettingsUpdate {
  openaiKey?: string;
  notionKey?: string;
  notionDbId?: string;
  uploadDest?: UploadDest;
  persistent?: boolean;
}

export async function saveSettings(update: SettingsUpdate): Promise<{ warning?: string }> {
  const { status, body } = await send('/api/settings', jsonInit('POST', update));
  if (status !== 200) throw new ApiError(errorCodeFor(status, body), status);
  return { warning: typeof body?.warning === 'string' ? body.warning : undefined };
}
