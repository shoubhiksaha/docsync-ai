/**
 * Sync orchestrator — sends one reviewed document to every destination.
 *
 * Each destination (Notion, media storage, Google Sheets) runs through runIsolated(): it has its
 * own timeout, kill switch and circuit breaker, and its failure is reported, not thrown. A Notion
 * outage therefore can't stop the row reaching Google Sheets, and vice versa.
 *
 * Order: 1) read-only duplicate check (before any side effect), 2) Notion + media in parallel,
 * 3) Sheets, with whatever links steps 2 produced. `only` limits a run to some destinations, so
 * the UI can retry just the one that failed without writing a second Sheets row. A Sheets retry
 * writes the links the first attempt made (`earlierLinks`); a Notion or media retry fills them
 * into the row the first attempt wrote, and updates its Sync Status.
 *
 * Sheets is the destination that counts: when it is paused or switched off the record is
 * reported as not saved (with a retry), never as saved. Aadhaar numbers are masked here for
 * every profile, whatever the client sent.
 */
import { runIsolated, type Outcome, type SkipCode } from '@/core/isolation';
import { protectAadhaar, protectAadhaarInText } from '@/modules/extraction';
import * as mediaModule from '@/modules/media';
import * as notionModule from '@/modules/notion';
import * as sheetsModule from '@/modules/sheets';
import { deriveFields, type DocumentProfile, type RecordField } from '@/modules/profiles';
import type { UploadDest } from '@/modules/settings';

export interface SyncDeps {
  sheets: Pick<typeof sheetsModule, 'findDuplicates' | 'appendRecord' | 'updateRecordLinks'>;
  notion: Pick<typeof notionModule, 'syncRecord' | 'resolveNotionTarget'>;
  media: Pick<typeof mediaModule, 'storeMedia' | 'prepareArchiveImage'>;
}

const defaultDeps: SyncDeps = { sheets: sheetsModule, notion: notionModule, media: mediaModule };

export const DESTINATION_TIMEOUT_MS = 25_000;
/** Whole-sync budget, inside the route's 60 s maxDuration; Sheets gets whatever is left of it. */
export const SYNC_BUDGET_MS = 52_000;
/** Sheets always gets at least this long, even after slow Notion/media uploads. */
const MIN_SHEETS_MS = 12_000;

export interface SyncInput {
  profile: DocumentProfile;
  fields: RecordField[];
  note?: string;
  document?: Buffer | null;
  audio?: Buffer | null;
  /** Base MIME type ('audio/mp4', not 'audio/webm;codecs=opus') and the file extension that goes with it. */
  audioMimeType?: string;
  audioExtension?: string;
  caller: { accessToken?: string };
  notion: { apiKey?: string | null; databaseId?: string | null };
  uploadDest: UploadDest;
  spreadsheetId?: string | null;
  duplicateAction?: 'replace' | 'keep_both' | null;
  primaryKey?: string | null;
  /** Run only these destinations (a retry); the others are skipped. Empty or missing = all. */
  only?: DestinationName[];
  /** Photo and voice-note links an earlier attempt made, for a retry that doesn't run Notion or media. */
  earlierLinks?: { imageLink?: string | null; voiceNoteLink?: string | null };
  /** When the request started (Date.now()); the time budget counts from here. */
  startedAt?: number;
}

/**
 * Something the user should know about a save that otherwise worked. Codes, not text: the route
 * translates them (client/i18n `done.warning.<code>`), and raw provider errors stay in the log.
 */
export type SyncWarning = 'duplicate_check_unavailable' | 'image_not_processed' | mediaModule.MediaNote | notionModule.NotionNote | sheetsModule.SheetsNote;

export type DestinationName = 'sheets' | 'notion' | 'media';
export const DESTINATIONS: readonly DestinationName[] = ['sheets', 'notion', 'media'];

export interface SyncReport {
  duplicate?: sheetsModule.DuplicateReport;
  destinations: {
    sheets: Outcome<sheetsModule.AppendResult>;
    notion: Outcome<notionModule.NotionSyncResult>;
    media: Outcome<mediaModule.MediaResult>;
  };
  imageLink: string | null;
  audioLink: string | null;
  warnings: SyncWarning[];
}

const skipped = (reason: string, code: SkipCode) => ({ status: 'skipped' as const, reason, code });
const NOT_RETRIED = 'not part of this retry';

/** "2026-11-01 14:05" in India Standard Time (UTC+5:30, no daylight saving), as people read it in the sheet. */
export function istTimestamp(at = new Date()): string {
  return new Date(at.getTime() + 330 * 60_000).toISOString().slice(0, 16).replace('T', ' ');
}

export function failedDestinations(report: SyncReport): DestinationName[] {
  return (Object.keys(report.destinations) as DestinationName[]).filter(d => report.destinations[d].status === 'failed');
}

export async function syncDocument(input: SyncInput, deps: SyncDeps = defaultDeps): Promise<SyncReport> {
  const started = input.startedAt ?? Date.now();
  const fields = deriveFields(input.profile, input.fields.map(protectAadhaar)).map(protectAadhaar);
  const note = input.note ? protectAadhaarInText(input.note) : input.note;
  const sheetFields = fields.map(f => ({ key: f.key, label: f.label, value: f.value }));
  const warnings: SyncWarning[] = [];
  const wanted = (d: DestinationName) => !input.only?.length || input.only.includes(d);

  // 1) Duplicate check — read-only, before anything is written anywhere.
  if (wanted('sheets') && input.primaryKey && !input.duplicateAction) {
    const check = await runIsolated(
      () => deps.sheets.findDuplicates({
        caller: input.caller,
        spreadsheetId: input.spreadsheetId,
        tab: input.profile.sheetTab,
        fields: sheetFields,
        primaryKey: input.primaryKey!,
      }),
      { module: 'sheets', breakerKey: 'sheets:duplicates', timeoutMs: 8_000 },
    );
    if (check.status === 'ok' && check.value) {
      return {
        duplicate: check.value,
        destinations: { sheets: skipped('duplicate found', 'duplicate'), notion: skipped('duplicate found', 'duplicate'), media: skipped('duplicate found', 'duplicate') },
        imageLink: null,
        audioLink: null,
        warnings,
      };
    }
    if (check.status !== 'ok') warnings.push('duplicate_check_unavailable');
  }

  // 2) Notion + media in parallel.
  let archive: Buffer | null = null;
  if (input.document && (wanted('notion') || wanted('media'))) {
    try {
      archive = await deps.media.prepareArchiveImage(input.document);
    } catch (err) {
      warnings.push('image_not_processed');
      console.error('[sync] archive image failed:', err instanceof Error ? err.message : err);
    }
  }

  const notionTarget = deps.notion.resolveNotionTarget(input.notion);
  const notionWanted = input.uploadDest !== 'gdrive' && Boolean(notionTarget);
  const imageForMedia = archive && (input.uploadDest !== 'notion' || !notionWanted) ? archive : null;
  const audioForMedia = input.audio && (input.uploadDest !== 'notion' || !notionWanted) ? input.audio : null;

  const runNotion = (): Promise<SyncReport['destinations']['notion']> => {
    if (!wanted('notion')) return Promise.resolve(skipped(NOT_RETRIED, 'not_retried'));
    if (!notionWanted) {
      return Promise.resolve(input.uploadDest === 'gdrive'
        ? skipped('Notion not selected as a destination', 'not_selected')
        : skipped('Notion not connected', 'not_connected'));
    }
    return runIsolated(
      signal => deps.notion.syncRecord({
        ...input.notion,
        profile: input.profile,
        fields,
        note,
        image: archive,
        audio: input.audio,
        audioMimeType: input.audioMimeType,
        audioExtension: input.audioExtension,
        signal,
      }),
      { module: 'notion', timeoutMs: DESTINATION_TIMEOUT_MS },
    );
  };

  const runMedia = (): Promise<SyncReport['destinations']['media']> => {
    if (!wanted('media')) return Promise.resolve(skipped(NOT_RETRIED, 'not_retried'));
    if (!imageForMedia && !audioForMedia) return Promise.resolve(skipped('nothing to store', 'nothing_to_store'));
    return runIsolated(
      signal => deps.media.storeMedia({
        accessToken: input.caller.accessToken,
        profileId: input.profile.id,
        image: imageForMedia,
        audio: audioForMedia,
        audioMimeType: input.audioMimeType,
        audioExtension: input.audioExtension,
        signal,
      }),
      { module: 'media', timeoutMs: DESTINATION_TIMEOUT_MS },
    );
  };

  const [notion, media] = await Promise.all([runNotion(), runMedia()]);

  if (notion.status === 'ok') warnings.push(...notion.value.attachmentNotes);
  if (media.status === 'ok') warnings.push(...media.value.notes);

  // This run's links first; a retry that didn't run Notion or media keeps the ones the first attempt made.
  const imageLink = (notion.status === 'ok' ? notion.value.url : null)
    ?? (media.status === 'ok' ? media.value.imageUrl : null)
    ?? input.earlierLinks?.imageLink ?? null;
  const audioLink = (media.status === 'ok' ? media.value.audioUrl : null) ?? input.earlierLinks?.voiceNoteLink ?? null;
  // Only destinations that ran this time: one left out of a retry is not known to have failed.
  const ran = [['Notion', notion], ['media upload', media]] as const;
  const otherFailures = ran.flatMap(([name, outcome]) => (outcome.status === 'failed' ? [name] : []));
  const otherSuccesses = ran.flatMap(([name, outcome]) => (outcome.status === 'ok' ? [name] : []));

  // 3) Sheets, with what is left of the budget; a timeout aborts the write so it can't land later.
  const sheetsTimeout = Math.max(MIN_SHEETS_MS, Math.min(DESTINATION_TIMEOUT_MS, SYNC_BUDGET_MS - (Date.now() - started)));
  const sheetsOutcome = !wanted('sheets') ? skipped(NOT_RETRIED, 'not_retried') : await runIsolated(
    signal => deps.sheets.appendRecord({
      caller: input.caller,
      spreadsheetId: input.spreadsheetId,
      tab: input.profile.sheetTab,
      fields: sheetFields,
      meta: {
        notes: note ?? '',
        voiceNoteLink: audioLink ?? '',
        imageLink: imageLink ?? '—',
        syncedAt: istTimestamp(),
        syncStatus: sheetsModule.syncStatusText(otherFailures),
      },
      duplicateAction: input.duplicateAction,
      primaryKey: input.primaryKey,
      signal,
    }),
    { module: 'sheets', timeoutMs: sheetsTimeout },
  );
  // Paused or switched off means the row did not reach the sheet: that is a failed save the user can retry.
  const sheets: SyncReport['destinations']['sheets'] = sheetsOutcome.status === 'skipped' && sheetsOutcome.code !== 'not_retried'
    ? { status: 'failed', error: sheetsOutcome.reason, ms: 0, ...(sheetsOutcome.code ? { code: sheetsOutcome.code } : {}) }
    : sheetsOutcome;
  if (sheets.status === 'ok' && sheets.value.note) warnings.push(sheets.value.note);

  // A Notion or media retry that worked: the row the first attempt wrote gets its links and status.
  // Best effort; the retry itself already succeeded.
  if (!wanted('sheets') && otherSuccesses.length) {
    await runIsolated(
      signal => deps.sheets.updateRecordLinks({
        caller: input.caller,
        spreadsheetId: input.spreadsheetId,
        tab: input.profile.sheetTab,
        fields: sheetFields,
        imageLink,
        voiceNoteLink: audioLink,
        succeeded: otherSuccesses,
        failed: otherFailures,
        signal,
      }),
      { module: 'sheets', breakerKey: 'sheets:links', timeoutMs: 8_000 },
    );
  }

  return { destinations: { sheets, notion, media }, imageLink, audioLink, warnings };
}
