import { NextRequest, NextResponse } from 'next/server';
import { errorText, parseJson, resolveCaller, unauthorized } from '@/core/http';
import { MAX_AUDIO_BYTES } from '@/modules/transcription';
import { MAX_DOCUMENT_BYTES } from '@/modules/extraction';
import { getProfile, type RecordField } from '@/modules/profiles';
import { loadProfilePrefs, loadSettings, parseUploadDest } from '@/modules/settings';
import { DESTINATIONS, failedDestinations, syncDocument, type DestinationName, type SyncReport } from '@/modules/sync';

export const maxDuration = 60;

const LABELS: Record<DestinationName, string> = { sheets: 'Google Sheets', notion: 'Notion', media: 'Media upload' };

/** Accepts the new `fields` payload ([{key,label,value}]) or the legacy `data` map ({key: value}). */
function readFields(formData: FormData): RecordField[] {
  const fields = parseJson<unknown>(formData.get('fields'), null);
  if (Array.isArray(fields)) {
    return fields
      .filter((f): f is RecordField => Boolean(f) && typeof (f as RecordField).key === 'string')
      .slice(0, 100)
      .map(f => ({ key: f.key, label: String(f.label || f.key), value: String(f.value ?? '') }));
  }
  const data = parseJson<Record<string, unknown> | null>(formData.get('data'), null);
  return data && typeof data === 'object'
    ? Object.entries(data).slice(0, 100).map(([key, value]) => ({ key, label: key, value: String(value ?? '') }))
    : [];
}

/** `only=notion,media` retries just those destinations; unknown names are ignored, empty = all. */
function readOnly(raw: FormDataEntryValue | null): DestinationName[] | undefined {
  if (typeof raw !== 'string') return undefined;
  const names = raw.split(',').map(s => s.trim()).filter((s): s is DestinationName => (DESTINATIONS as readonly string[]).includes(s));
  return names.length ? [...new Set(names)] : undefined;
}

const sheetCookie = (profileId: string) => `docsync_sheet_${profileId.replace(/-/g, '_')}`;

type DestinationCode = 'saved' | 'failed' | 'not_connected' | 'not_selected' | 'nothing_to_store' | 'not_stored' | 'not_retried' | 'disabled' | 'paused' | 'duplicate' | 'skipped';

function describe(report: SyncReport) {
  return Object.fromEntries(
    (Object.keys(report.destinations) as DestinationName[]).map(name => {
      const outcome = report.destinations[name];
      if (outcome.status === 'failed') return [name, { status: 'failed', code: 'failed' as DestinationCode, detail: outcome.error }];
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

  try {
    const formData = await req.formData();
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

    const report = await syncDocument({
      profile,
      fields,
      note: (formData.get('noteText') as string | null)?.slice(0, 10_000) || '',
      document: document ? Buffer.from(await document.arrayBuffer()) : null,
      audio: audio ? Buffer.from(await audio.arrayBuffer()) : null,
      audioMimeType: audio?.type || undefined,
      caller,
      notion: {
        apiKey: req.headers.get('x-notion-key') || settings.notionKey,
        databaseId: req.headers.get('x-notion-db-id') || settings.notionDbId,
      },
      uploadDest: parseUploadDest(formData.get('uploadDest') ?? settings.uploadDest),
      spreadsheetId,
      duplicateAction,
      // '' means the user turned duplicate checks off; null falls back to the profile's default.
      primaryKey: prefs.primaryKey ?? profile.duplicateKey ?? null,
      only: readOnly(formData.get('only')),
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
      warnings: report.warnings,
      destinations: describe(report),
      imageUrl: report.imageLink,
      spreadsheetId: sheets?.spreadsheetId ?? null,
      spreadsheetUrl: sheets?.spreadsheetUrl,
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
