import { NextRequest, NextResponse } from 'next/server';
import { LANG_COOKIE, parseLang, translate } from '@/client/i18n';
import { errorText, parseJson, readForm, resolveCaller, unauthorized } from '@/core/http';
import { audioFormat, MAX_AUDIO_BYTES } from '@/modules/transcription';
import { MAX_DOCUMENT_BYTES } from '@/modules/extraction';
import { getProfile, type RecordField } from '@/modules/profiles';
import { loadProfilePrefs, loadSettings, parseUploadDest } from '@/modules/settings';
import { DESTINATIONS, failedDestinations, syncDocument, type DestinationName, type SyncReport } from '@/modules/sync';

export const maxDuration = 60;

const LABELS: Record<DestinationName, string> = { sheets: 'Google Sheets', notion: 'Notion', media: 'Media upload' };

/**
 * Google Sheets refuses a cell over 50,000 characters, which would fail the whole save (and every
 * retry), so a very long typed or pasted value is cut to fit. Labels become header cells.
 */
const MAX_KEY = 100;
const MAX_LABEL = 120;
const MAX_VALUE = 45_000;

function field(key: string, label: unknown, value: unknown): RecordField {
  const k = key.trim().slice(0, MAX_KEY);
  return { key: k, label: String(label || k).slice(0, MAX_LABEL), value: String(value ?? '').slice(0, MAX_VALUE) };
}

/** Accepts the new `fields` payload ([{key,label,value}]) or the legacy `data` map ({key: value}). */
function readFields(formData: FormData): RecordField[] {
  const fields = parseJson<unknown>(formData.get('fields'), null);
  if (Array.isArray(fields)) {
    return fields
      .filter((f): f is RecordField => Boolean(f) && typeof (f as RecordField).key === 'string' && Boolean((f as RecordField).key.trim()))
      .slice(0, 100)
      .map(f => field(f.key, f.label, f.value));
  }
  const data = parseJson<Record<string, unknown> | null>(formData.get('data'), null);
  return data && typeof data === 'object'
    ? Object.entries(data).filter(([key]) => key.trim()).slice(0, 100).map(([key, value]) => field(key, key, value))
    : [];
}

/** `only=notion,media` retries just those destinations; unknown names are ignored, empty = all. */
function readOnly(raw: FormDataEntryValue | null): DestinationName[] | undefined {
  if (typeof raw !== 'string') return undefined;
  const names = raw.split(',').map(s => s.trim()).filter((s): s is DestinationName => (DESTINATIONS as readonly string[]).includes(s));
  return names.length ? [...new Set(names)] : undefined;
}

/** A photo or voice-note link from an earlier attempt, sent back with a retry; anything else is ignored. */
function readLink(raw: FormDataEntryValue | null): string | null {
  return typeof raw === 'string' && /^https:\/\/\S+$/.test(raw) && raw.length <= 2_000 ? raw : null;
}

/** The id the phone gave this record (a UUID), sent again with each retry of it; anything else is ignored. */
function readSaveId(raw: FormDataEntryValue | null): string | null {
  return typeof raw === 'string' && /^[A-Za-z0-9][A-Za-z0-9-]{15,63}$/.test(raw) ? raw : null;
}

/** Room for the text fields and multipart framing on top of the photo and voice note. */
const FORM_OVERHEAD_BYTES = 2_000_000;

const sheetCookie = (profileId: string) => `docsync_sheet_${profileId.replace(/-/g, '_')}`;

type DestinationCode = 'saved' | 'failed' | 'not_connected' | 'not_selected' | 'nothing_to_store' | 'not_stored' | 'not_retried' | 'disabled' | 'paused' | 'duplicate' | 'skipped';

function describe(report: SyncReport) {
  return Object.fromEntries(
    (Object.keys(report.destinations) as DestinationName[]).map(name => {
      const outcome = report.destinations[name];
      if (outcome.status === 'failed') return [name, { status: 'failed', code: (outcome.code ?? 'failed') as DestinationCode, detail: outcome.error }];
      if (outcome.status === 'skipped') return [name, { status: 'skipped', code: (outcome.code ?? 'skipped') as DestinationCode, detail: outcome.reason }];
      // Media "succeeds" without uploading anything when the Google session has expired.
      const media = report.destinations.media;
      if (name === 'media' && media.status === 'ok' && !media.value.imageUrl && !media.value.audioUrl) {
        return [name, { status: 'skipped', code: 'not_stored' as DestinationCode }];
      }
      return [name, { status: 'success', code: 'saved' as DestinationCode }];
    }),
  );
}

export async function POST(req: NextRequest) {
  const caller = await resolveCaller(req);
  if (!caller) return unauthorized();
  // Signed in, but Google's token expired and could not be refreshed: no save can work until the
  // user signs in again, so say so (the app keeps the scan) instead of reporting a failed save.
  if (!caller.accessToken) return NextResponse.json({ error: 'Your Google session has expired. Please sign in again.', code: 'session' }, { status: 401 });
  const tooLarge = () => NextResponse.json({ error: 'The upload is too large.', code: 'too_large' }, { status: 413 });
  // Refused before (or while) the body is read into memory, not after.
  if (Number(req.headers.get('content-length')) > MAX_DOCUMENT_BYTES + MAX_AUDIO_BYTES + FORM_OVERHEAD_BYTES) return tooLarge();

  try {
    const formData = await readForm(req, MAX_DOCUMENT_BYTES + MAX_AUDIO_BYTES + FORM_OVERHEAD_BYTES);
    if (!formData) return tooLarge();
    // The time budget starts once the upload is here, so a slow network doesn't eat into the save itself.
    const started = Date.now();
    const profile = getProfile(formData.get('profileId') as string | null);
    const fields = readFields(formData);
    if (!profile || fields.length === 0) return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });

    const documentFile = formData.get('document');
    const audioFile = formData.get('audioFile');
    const document = documentFile instanceof File ? documentFile : null;
    const audio = audioFile instanceof File ? audioFile : null;
    if (document && document.size > MAX_DOCUMENT_BYTES) return NextResponse.json({ error: 'Document file size exceeds the 20MB limit.' }, { status: 413 });
    if (audio && audio.size > MAX_AUDIO_BYTES) return NextResponse.json({ error: 'Audio file size exceeds the 10MB limit.' }, { status: 413 });

    const rawAction = formData.get('duplicateAction');
    const duplicateAction = rawAction === 'replace' || rawAction === 'keep_both' ? rawAction : null;

    const [settings, prefs] = await Promise.all([loadSettings(req), loadProfilePrefs(req, profile.id)]);
    const formSheetId = formData.get('spreadsheetId');
    const spreadsheetId = (typeof formSheetId === 'string' && formSheetId.trim()) || req.cookies.get(sheetCookie(profile.id))?.value || null;
    const audioType = audio ? audioFormat(audio.type, audio.name) : null;
    const lang = parseLang(req.cookies.get(LANG_COOKIE)?.value);

    const report = await syncDocument({
      profile,
      fields,
      note: (formData.get('noteText') as string | null)?.slice(0, 10_000) || '',
      document: document ? Buffer.from(await document.arrayBuffer()) : null,
      audio: audio ? Buffer.from(await audio.arrayBuffer()) : null,
      audioMimeType: audioType?.mimeType,
      audioExtension: audioType?.extension,
      caller,
      // Only the connection saved in Settings, never one sent with the request.
      notion: { apiKey: settings.notionKey, databaseId: settings.notionDbId },
      uploadDest: parseUploadDest(formData.get('uploadDest') ?? settings.uploadDest),
      spreadsheetId,
      duplicateAction,
      // '' means the user turned duplicate checks off; null falls back to the profile's default.
      primaryKey: prefs.primaryKey ?? profile.duplicateKey ?? null,
      only: readOnly(formData.get('only')),
      earlierLinks: { imageLink: readLink(formData.get('imageLink')), voiceNoteLink: readLink(formData.get('voiceNoteLink')) },
      startedAt: started,
      lang,
      saveId: readSaveId(formData.get('saveId')),
    });

    if (report.duplicate) {
      return NextResponse.json({
        isDuplicateConflict: true,
        duplicateCount: report.duplicate.count,
        primaryKeyLabel: report.duplicate.label,
        primaryKeyValue: report.duplicate.value,
      }, { status: 409 });
    }

    const failed = failedDestinations(report);
    const succeeded = (Object.keys(report.destinations) as DestinationName[]).filter(d => report.destinations[d].status === 'ok');
    const sheets = report.destinations.sheets.status === 'ok' ? report.destinations.sheets.value : null;
    const errors = failed.map(d => {
      const outcome = report.destinations[d];
      return `${LABELS[d]} sync failed${outcome.status === 'failed' ? `: ${outcome.error}` : ''}`;
    });

    const message = failed.length === 0 ? 'Successfully synced to all destinations' : `Synced to ${succeeded.map(d => LABELS[d]).join(', ') || 'no destination'}; ${failed.map(d => LABELS[d]).join(', ')} failed.`;

    const response = NextResponse.json({
      success: failed.length === 0,
      partial: failed.length > 0 && succeeded.length > 0,
      message,
      errors,
      // In the user's language; the codes are kept for clients that translate on their own.
      warnings: report.warnings.map(code => translate(lang, `done.warning.${code}`)),
      warningCodes: report.warnings,
      destinations: describe(report),
      // Kept with the scan and sent back with a retry (`imageLink`, `voiceNoteLink`), so a Sheets retry writes them too.
      imageUrl: report.imageLink,
      audioUrl: report.audioLink,
      spreadsheetId: sheets?.spreadsheetId ?? null,
      spreadsheetUrl: sheets?.spreadsheetUrl,
      // A replace leaves the record in one row; this many older copies were removed.
      ...(sheets?.removed ? { removedRows: sheets.removed } : {}),
    }, { status: failed.length > 0 && succeeded.length === 0 ? 502 : 200 });

    // Remember the user's sheet for this profile so later syncs skip the Drive lookup.
    if (sheets?.spreadsheetId) {
      response.cookies.set(sheetCookie(profile.id), sheets.spreadsheetId, {
        httpOnly: false,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
        path: '/',
        maxAge: 60 * 60 * 24 * 365,
      });
    }
    return response;
  } catch (error) {
    console.error('[sync] unexpected error:', errorText(error));
    return NextResponse.json({ error: `An internal error occurred during data sync: ${errorText(error)}` }, { status: 500 });
  }
}
