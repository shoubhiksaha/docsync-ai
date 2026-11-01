/**
 * Sheets module — Google Sheets read/write for synced records.
 *
 * Each user writes to their own spreadsheet with their own OAuth token (drive.file scope).
 */
import { google, type sheets_v4, type drive_v3 } from 'googleapis';
import { isModuleEnabled } from '@/core/env';
import { CallerError, circuitState, errorStatus } from '@/core/isolation';
import { driveQueryLiteral, ensureFolder, getGoogleAuth } from '@/core/google-auth';
import {
  buildRow, columnLetter, keyValueForMatch, mergeHeaders, metaColumnIndex, primaryKeyColumn, retriedSyncStatus, rowHoldsFields, sanitizeCell, syncStatusFailures, tabRange,
  type RowMeta, type SheetField, type SheetLang,
} from './a1';

export { columnLetter, keyValueForMatch, mergeHeaders, sanitizeCell, buildRow, syncStatusText, META_COLUMNS, SAVE_ID_COLUMN, type RowMeta, type SheetField, type SheetLang } from './a1';

export interface SheetsCaller {
  accessToken?: string;
}

const USER_SPREADSHEET_NAME = 'DocSync AI Data';
const USER_FOLDER_NAME = 'DocSync AI';
/** New sheets read "05/11/2026" as 5 November and show times in IST. */
const SHEET_LOCALE = { locale: 'en_IN', timeZone: 'Asia/Kolkata' };
const SESSION_EXPIRED = 'Your Google session has expired. Please sign in again.';

type Apis = { sheets: sheets_v4.Sheets; drive: drive_v3.Drive };

/**
 * Answers one sync shares, so its Save ID check, its duplicate check and its write don't each ask
 * Google again for the same header row, trash flag and sheet list (Google allows 60 reads a minute
 * per user, and every round trip is slow on 2G). Lives for one sync; a failed read isn't kept.
 */
export type SheetReads = Map<string, Promise<unknown>>;

export function sheetReads(): SheetReads {
  return new Map();
}

function once<T>(reads: SheetReads | undefined, key: string, load: () => Promise<T>): Promise<T> {
  if (!reads) return load();
  const known = reads.get(key) as Promise<T> | undefined;
  if (known) return known;
  const loading = load();
  reads.set(key, loading);
  loading.catch(() => {
    if (reads.get(key) === loading) reads.delete(key);
  });
  return loading;
}

/** `signal` cancels every request made through these clients (a write that timed out must not land later). */
function apis(caller: SheetsCaller, signal?: AbortSignal): Apis | null {
  if (!caller.accessToken) return null;
  const auth = getGoogleAuth(caller.accessToken);
  return {
    sheets: google.sheets({ version: 'v4', auth: auth as never, ...(signal ? { signal } : {}) }),
    drive: google.drive({ version: 'v3', auth: auth as never, ...(signal ? { signal } : {}) }),
  };
}

/** The remembered sheet was deleted, or belongs to an account this token can't open (drive.file). */
function isUnreachableSheet(err: unknown): boolean {
  const status = errorStatus(err);
  // Google also answers 403 for "rate limit exceeded"; that sheet is fine, just busy.
  const busy = err instanceof Error && /rate ?limit|quota/i.test(err.message);
  return (status === 403 || status === 404) && !busy;
}

export function spreadsheetUrl(id: string): string {
  return `https://docs.google.com/spreadsheets/d/${id}/edit`;
}

/** Ids of the user's spreadsheets called `name`, oldest first, so every lookup picks the same one when there are two. */
async function findSpreadsheets(drive: drive_v3.Drive, name: string): Promise<string[]> {
  const q = [
    `name=${driveQueryLiteral(name)}`,
    "mimeType='application/vnd.google-apps.spreadsheet'",
    'trashed=false',
  ].join(' and ');
  const res = await drive.files.list({ q, spaces: 'drive', fields: 'files(id)', orderBy: 'createdTime', pageSize: 10 });
  return (res.data.files ?? []).flatMap(f => (f.id ? [f.id] : []));
}

/** A sheet the user moved to the Drive trash still opens by id, and Drive deletes it for good after 30 days. */
async function isTrashed(drive: drive_v3.Drive, fileId: string, reads?: SheetReads): Promise<boolean> {
  try {
    return await once(reads, `trashed:${fileId}`, async () => (await drive.files.get({ fileId, fields: 'trashed' })).data.trashed === true);
  } catch {
    return false; // a sheet that can't be opened at all is handled where it is opened
  }
}

async function moveToFolder(drive: drive_v3.Drive, fileId: string, folderName: string): Promise<void> {
  try {
    const folderId = await ensureFolder(drive, folderName);
    const file = await drive.files.get({ fileId, fields: 'parents' });
    await drive.files.update({ fileId, addParents: folderId, removeParents: file.data.parents?.join(',') || '', fields: 'id' });
  } catch (err) {
    console.warn('[sheets] could not move spreadsheet into folder:', err instanceof Error ? err.message : err);
  }
}

/** The user's chosen sheet, or find/create "DocSync AI Data" in their Drive. */
async function resolveSpreadsheetId(api: Apis, clientSpreadsheetId?: string | null, create = true, reads?: SheetReads): Promise<string | null> {
  const clientId = clientSpreadsheetId?.trim();
  if (clientId && /^[A-Za-z0-9_-]{10,}$/.test(clientId)) {
    return clientId;
  }
  const [found = null] = await once(reads, 'own-sheet', () => findSpreadsheets(api.drive, USER_SPREADSHEET_NAME));
  if (found || !create) return found;
  const created = await api.sheets.spreadsheets.create({ requestBody: { properties: { title: USER_SPREADSHEET_NAME, ...SHEET_LOCALE } }, fields: 'spreadsheetId' });
  const id = created.data.spreadsheetId as string;
  // Two first saves at once (two phones on one account) each found nothing and made a sheet. Both
  // keep the one with the smaller id, and the other is trashed while still empty, so the rows of a
  // document type never end up split across two files.
  const others = await findSpreadsheets(api.drive, USER_SPREADSHEET_NAME).catch(() => []);
  const keep = others.reduce((a, b) => (b < a ? b : a), id);
  if (keep !== id) {
    await api.drive.files.update({ fileId: id, requestBody: { trashed: true }, fields: 'id' })
      .catch(err => console.warn('[sheets] could not trash the extra spreadsheet:', err instanceof Error ? err.message : err));
    return keep;
  }
  await moveToFolder(api.drive, id, USER_FOLDER_NAME);
  return id;
}

async function readHeaders(api: Apis, spreadsheetId: string, tab: string): Promise<string[] | null> {
  try {
    const res = await api.sheets.spreadsheets.values.get({ spreadsheetId, range: tabRange(tab, '1:1') });
    return (res.data.values?.[0] as string[] | undefined) ?? [];
  } catch (err) {
    if (err instanceof Error && /unable to parse range/i.test(err.message)) return null; // tab missing
    throw err;
  }
}

async function lookUpSheetId(api: Apis, spreadsheetId: string, tab: string): Promise<number> {
  const meta = await api.sheets.spreadsheets.get({ spreadsheetId, fields: 'sheets.properties(sheetId,title)' });
  const sheetId = meta.data.sheets?.find(s => s.properties?.title === tab)?.properties?.sheetId;
  if (sheetId == null) throw new Error(`The ${tab} tab could not be found.`);
  return sheetId;
}

/**
 * Makes sure `tab` exists; returns its current header row and its sheetId. The sheetId is looked
 * up only when a change to the tab needs it, so a plain save reads the sheet once.
 */
async function ensureTab(api: Apis, spreadsheetId: string, tab: string, retried = false): Promise<{ sheetId: () => Promise<number>; headers: string[] }> {
  const headers = await readHeaders(api, spreadsheetId, tab);
  if (headers) {
    let sheetId: Promise<number> | undefined;
    return { sheetId: () => (sheetId ??= lookUpSheetId(api, spreadsheetId, tab)), headers };
  }
  try {
    const res = await api.sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: { requests: [{ addSheet: { properties: { title: tab, gridProperties: { frozenRowCount: 1 } } } }] },
    });
    const sheetId = res.data.replies?.[0]?.addSheet?.properties?.sheetId ?? 0;
    return { sheetId: async () => sheetId, headers: [] };
  } catch (err) {
    // Another save added the same tab a moment ago: use it.
    if (retried || !(err instanceof Error && /already exists/i.test(err.message))) throw err;
    return ensureTab(api, spreadsheetId, tab, true);
  }
}

/**
 * Moves the existing columns right to make room for new fields and writes the new header row,
 * in one request so the two can't half-apply. Without the move, old rows' cells would sit under
 * the wrong headings.
 */
async function insertColumns(api: Apis, spreadsheetId: string, sheetId: number, headers: string[], insert: { at: number; count: number }) {
  await api.sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [
        {
          insertDimension: {
            range: { sheetId, dimension: 'COLUMNS', startIndex: insert.at, endIndex: insert.at + insert.count },
            inheritFromBefore: insert.at > 0,
          },
        },
        {
          updateCells: {
            start: { sheetId, rowIndex: 0, columnIndex: 0 },
            rows: [{ values: headers.map(h => ({ userEnteredValue: { stringValue: h } })) }],
            fields: 'userEnteredValue',
          },
        },
      ],
    },
  });
}

async function writeHeaders(api: Apis, spreadsheetId: string, tab: string, sheetId: () => Promise<number>, headers: string[], style: boolean) {
  await api.sheets.spreadsheets.values.update({
    spreadsheetId,
    range: tabRange(tab, 'A1'),
    valueInputOption: 'RAW',
    requestBody: { values: [headers] },
  });
  if (!style) return;
  try {
    await api.sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [
          {
            repeatCell: {
              range: { sheetId: await sheetId(), startRowIndex: 0, endRowIndex: 1 },
              cell: { userEnteredFormat: { textFormat: { bold: true }, backgroundColor: { red: 0.85, green: 0.92, blue: 0.98 }, horizontalAlignment: 'CENTER' } },
              fields: 'userEnteredFormat(textFormat,backgroundColor,horizontalAlignment)',
            },
          },
          { autoResizeDimensions: { dimensions: { sheetId: await sheetId(), dimension: 'COLUMNS', startIndex: 0, endIndex: headers.length } } },
        ],
      },
    });
  } catch (err) {
    console.warn('[sheets] header styling failed (non-fatal):', err instanceof Error ? err.message : err);
  }
}

/** Hides the Save ID column the moment it is added: it is for the app, not for people. Best effort. */
async function hideColumn(api: Apis, spreadsheetId: string, sheetId: number, index: number) {
  try {
    await api.sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [{
          updateDimensionProperties: {
            range: { sheetId, dimension: 'COLUMNS', startIndex: index, endIndex: index + 1 },
            properties: { hiddenByUser: true },
            fields: 'hiddenByUser',
          },
        }],
      },
    });
  } catch (err) {
    console.warn('[sheets] could not hide the Save ID column (non-fatal):', err instanceof Error ? err.message : err);
  }
}

/** One metadata cell of a row read back from the sheet; '' and '—' count as empty. */
function metaCell(headers: string[], cells: unknown[], key: keyof RowMeta): string | null {
  const index = metaColumnIndex(headers, key);
  const value = index === -1 ? '' : String(cells[index] ?? '').trim();
  return value && value !== '—' ? value : null;
}

/**
 * The sheet a save would write to, for a read-only lookup: the remembered one, or the user's own
 * when that one is in the trash or can't be opened (as the save does). Null when there is no sheet
 * or the tab has no header row yet.
 */
async function sheetToRead(api: Apis, clientSpreadsheetId: string | null | undefined, tab: string, reads?: SheetReads): Promise<{ spreadsheetId: string; headers: string[] } | null> {
  // The checks of one sync share these reads; the write reads the header row again (see appendRecord).
  const headersOf = (id: string) => once(reads, `headers:${id}:${tab}`, () => readHeaders(api, id, tab));
  let spreadsheetId = await resolveSpreadsheetId(api, clientSpreadsheetId, false, reads);
  if (!spreadsheetId) return null;
  const remembered = spreadsheetId === clientSpreadsheetId?.trim();
  let headers: string[] | null = null;
  let fallBack = false;
  try {
    [headers, fallBack] = await Promise.all([headersOf(spreadsheetId), remembered && isTrashed(api.drive, spreadsheetId, reads)]);
  } catch (err) {
    if (!clientSpreadsheetId || !isUnreachableSheet(err)) throw err;
    fallBack = true;
  }
  if (fallBack) {
    spreadsheetId = await resolveSpreadsheetId(api, null, false, reads);
    headers = spreadsheetId ? await headersOf(spreadsheetId) : null;
  }
  return spreadsheetId && headers?.length ? { spreadsheetId, headers } : null;
}

/** 1-based row numbers (excluding the header) whose PK column equals `value`. */
async function matchingRows(api: Apis, spreadsheetId: string, tab: string, columnIndex: number, value: string): Promise<number[]> {
  const letter = columnLetter(columnIndex + 1);
  const res = await api.sheets.spreadsheets.values.get({ spreadsheetId, range: tabRange(tab, `${letter}2:${letter}`) });
  const rows = res.data.values ?? [];
  const wanted = keyValueForMatch(value);
  return rows.flatMap((row, i) => (keyValueForMatch(row?.[0]) === wanted ? [i + 2] : []));
}

/** The 1-based row number of the last row whose Save ID (in column `column`) is `saveId`, or null. */
async function rowWithSaveId(api: Apis, spreadsheetId: string, tab: string, column: number, saveId: string): Promise<number | null> {
  const letter = columnLetter(column + 1);
  const ids = await api.sheets.spreadsheets.values.get({ spreadsheetId, range: tabRange(tab, `${letter}2:${letter}`) });
  const index = (ids.data.values ?? []).map(row => String(row?.[0] ?? '').trim()).lastIndexOf(saveId);
  return index === -1 ? null : index + 2;
}

async function readRow(api: Apis, spreadsheetId: string, tab: string, headers: string[], rowNumber: number): Promise<unknown[]> {
  const res = await api.sheets.spreadsheets.values.get({ spreadsheetId, range: tabRange(tab, `A${rowNumber}:${columnLetter(headers.length)}${rowNumber}`) });
  return (res.data.values?.[0] ?? []) as unknown[];
}

// ─── Public API ───────────────────────────────────────────────────────────────

export interface DuplicateCheckInput {
  caller: SheetsCaller;
  spreadsheetId?: string | null;
  tab: string;
  fields: SheetField[];
  primaryKey: string;
  /** Also read the first copy's photo link (a replace keeps it instead of uploading the photo again). */
  withImageLink?: boolean;
  /** Reads shared with the rest of this sync. */
  reads?: SheetReads;
}

export interface DuplicateReport {
  count: number;
  label: string;
  value: string;
  /** The first copy's Link to Image, when `withImageLink` asked for it. */
  imageLink?: string | null;
}

/** Read-only check run before anything is written, so a duplicate never leaves half a sync behind. */
export async function findDuplicates(input: DuplicateCheckInput): Promise<DuplicateReport | null> {
  const api = apis(input.caller);
  if (!api) return null;
  const sheet = await sheetToRead(api, input.spreadsheetId, input.tab, input.reads);
  if (!sheet) return null;
  const { spreadsheetId, headers } = sheet;
  const pk = primaryKeyColumn(headers, input.fields, input.primaryKey);
  if (!pk) return null;
  const rows = await matchingRows(api, spreadsheetId, input.tab, pk.index, pk.value);
  if (!rows.length) return null;
  const report: DuplicateReport = { count: rows.length, label: headers[pk.index] || input.primaryKey, value: pk.value };
  if (input.withImageLink && metaColumnIndex(headers, 'imageLink') !== -1) {
    report.imageLink = metaCell(headers, await readRow(api, spreadsheetId, input.tab, headers, rows[0]), 'imageLink');
  }
  return report;
}

export interface SavedRecordInput {
  caller: SheetsCaller;
  spreadsheetId?: string | null;
  tab: string;
  saveId: string;
  signal?: AbortSignal;
  /** Reads shared with the rest of this sync. */
  reads?: SheetReads;
}

export interface SavedRecord {
  spreadsheetId: string;
  spreadsheetUrl: string;
  imageLink: string | null;
  voiceNoteLink: string | null;
  /** Destinations the row's Sync Status names as failed ('Notion', 'media upload'). */
  failed: string[];
}

/**
 * The row an earlier attempt of this same save wrote, found by its Save ID: the phone never heard
 * back (a dropped 2G connection, its own timeout), so it sent the save again. Read-only.
 */
export async function findSavedRecord(input: SavedRecordInput): Promise<SavedRecord | null> {
  const api = apis(input.caller, input.signal);
  if (!api) return null;
  const sheet = await sheetToRead(api, input.spreadsheetId, input.tab, input.reads);
  const column = sheet ? metaColumnIndex(sheet.headers, 'saveId') : -1;
  if (!sheet || column === -1) return null;
  const { spreadsheetId, headers } = sheet;
  const rowNumber = await rowWithSaveId(api, spreadsheetId, input.tab, column, input.saveId);
  if (rowNumber === null) return null;
  const cells = await readRow(api, spreadsheetId, input.tab, headers, rowNumber);
  return {
    spreadsheetId,
    spreadsheetUrl: spreadsheetUrl(spreadsheetId),
    imageLink: metaCell(headers, cells, 'imageLink'),
    voiceNoteLink: metaCell(headers, cells, 'voiceNoteLink'),
    failed: syncStatusFailures(metaCell(headers, cells, 'syncStatus') ?? ''),
  };
}

export interface AppendInput {
  caller: SheetsCaller;
  spreadsheetId?: string | null;
  tab: string;
  fields: SheetField[];
  meta: RowMeta;
  duplicateAction?: 'replace' | 'keep_both' | null;
  primaryKey?: string | null;
  /** Language of the app's own column headings on a new sheet. */
  lang?: SheetLang;
  /** Aborts the write (the sync timeout fired). */
  signal?: AbortSignal;
  /** Reads shared with this sync's checks: the sheet list and trash flag, never the header row. */
  reads?: SheetReads;
}

export interface AppendResult {
  spreadsheetId: string;
  spreadsheetUrl?: string;
  action: 'append' | 'replace';
  rows: number;
  /** Older copies deleted by a replace (the record is then in one row). */
  removed?: number;
  /** The remembered sheet was in the Drive trash, so the row went to the user's own sheet. */
  note?: SheetsNote;
}

export type SheetsNote = 'sheet_was_in_trash';

export async function appendRecord(input: AppendInput): Promise<AppendResult> {
  const api = apis(input.caller, input.signal);
  if (!api) throw new CallerError(SESSION_EXPIRED);

  let spreadsheetId = await resolveSpreadsheetId(api, input.spreadsheetId, true, input.reads);
  if (!spreadsheetId) throw new Error('Your Google Sheet could not be found or created.');
  const remembered = spreadsheetId === input.spreadsheetId?.trim();

  // The header row is always read again: another phone may have added a column since the checks.
  let tab: Awaited<ReturnType<typeof ensureTab>>;
  let trashed = false;
  try {
    [tab, trashed] = await Promise.all([ensureTab(api, spreadsheetId, input.tab), remembered && isTrashed(api.drive, spreadsheetId, input.reads)]);
  } catch (err) {
    // A remembered sheet that is gone (or another account's): use this user's own sheet instead.
    if (!input.spreadsheetId || !isUnreachableSheet(err)) throw err;
    console.warn('[sheets] remembered spreadsheet is not reachable; using the user\'s own DocSync sheet');
    spreadsheetId = (await resolveSpreadsheetId(api, null, true, input.reads)) as string;
    tab = await ensureTab(api, spreadsheetId, input.tab);
  }
  if (trashed) {
    // Rows written there would go when Drive empties its trash.
    console.warn('[sheets] remembered spreadsheet is in the trash; using the user\'s own DocSync sheet');
    spreadsheetId = (await resolveSpreadsheetId(api, null, true, input.reads)) as string;
    tab = await ensureTab(api, spreadsheetId, input.tab);
  }
  const wasEmpty = tab.headers.every(h => !String(h).trim());
  const withSaveId = Boolean(input.meta.saveId);
  let { headers, changed, insert } = mergeHeaders(tab.headers, input.fields, input.lang, withSaveId);
  let current = tab.headers;
  if (changed && !wasEmpty) {
    // Another save may have added the same field a moment ago: decide again from the sheet as it is now.
    current = (await readHeaders(api, spreadsheetId, input.tab)) ?? tab.headers;
    ({ headers, changed, insert } = mergeHeaders(current, input.fields, input.lang, withSaveId));
  }
  if (insert) await insertColumns(api, spreadsheetId, await tab.sheetId(), headers, insert);
  else if (changed) await writeHeaders(api, spreadsheetId, input.tab, tab.sheetId, headers, wasEmpty);
  const saveIdColumn = metaColumnIndex(headers, 'saveId');
  if (saveIdColumn !== -1 && metaColumnIndex(current, 'saveId') === -1) await hideColumn(api, spreadsheetId, await tab.sheetId(), saveIdColumn);

  const row = buildRow(headers, input.fields, input.meta, input.primaryKey);
  const lastColumn = columnLetter(headers.length);
  const done = (result: Pick<AppendResult, 'action' | 'rows' | 'removed'>): AppendResult => ({
    spreadsheetId: spreadsheetId as string,
    spreadsheetUrl: spreadsheetUrl(spreadsheetId as string),
    ...result,
    ...(trashed ? { note: 'sheet_was_in_trash' as const } : {}),
  });

  if (input.duplicateAction === 'replace' && input.primaryKey) {
    const pk = primaryKeyColumn(headers, input.fields, input.primaryKey);
    const rows = pk ? await matchingRows(api, spreadsheetId, input.tab, pk.index, pk.value) : [];
    if (rows.length) {
      // The record takes the place of the first copy and the others go, so it ends up in one row.
      const [first, ...extra] = rows;
      await api.sheets.spreadsheets.values.update({
        spreadsheetId,
        range: tabRange(input.tab, `A${first}:${lastColumn}${first}`),
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [row] },
      });
      if (extra.length) {
        const sheetId = await tab.sheetId();
        await api.sheets.spreadsheets.batchUpdate({
          spreadsheetId,
          requestBody: {
            // Bottom-up, so each row number is still right when its turn comes.
            requests: [...extra].reverse().map(r => ({ deleteDimension: { range: { sheetId, dimension: 'ROWS', startIndex: r - 1, endIndex: r } } })),
          },
        });
      }
      return done({ action: 'replace', rows: 1, removed: extra.length });
    }
  }

  await api.sheets.spreadsheets.values.append({
    spreadsheetId,
    range: tabRange(input.tab, 'A1'),
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: [row] },
  });
  return done({ action: 'append', rows: 1 });
}

export interface RecordLinksInput {
  caller: SheetsCaller;
  spreadsheetId?: string | null;
  tab: string;
  fields: SheetField[];
  imageLink?: string | null;
  voiceNoteLink?: string | null;
  /** Destinations as the Sync Status cell names them ('Notion', 'media upload'). */
  succeeded: string[];
  failed: string[];
  /** Language for a Sync Status that isn't already written in one. */
  lang?: SheetLang;
  /** The save's id: its row is found by its Save ID, whatever Sheets made of the values in it. */
  saveId?: string | null;
  signal?: AbortSignal;
}

/** A retry comes soon after the save it repeats, so its row is among the last ones; older rows are never read. */
const RECENT_ROWS = 200;

/**
 * The row the first attempt of this save wrote: the one with its Save ID. A row from before Save
 * IDs is the last one (of the most recent RECENT_ROWS) holding exactly this record's values and
 * no other save's id.
 */
async function findRecordRow(api: Apis, spreadsheetId: string, headers: string[], input: RecordLinksInput): Promise<{ rowNumber: number; cells: unknown[] } | null> {
  const saveIdColumn = metaColumnIndex(headers, 'saveId');
  if (input.saveId && saveIdColumn !== -1) {
    const rowNumber = await rowWithSaveId(api, spreadsheetId, input.tab, saveIdColumn, input.saveId);
    if (rowNumber !== null) return { rowNumber, cells: await readRow(api, spreadsheetId, input.tab, headers, rowNumber) };
  }
  // Synced At is filled on every row the app writes, so its length is the number of rows.
  const counted = columnLetter(Math.max(0, metaColumnIndex(headers, 'syncedAt')) + 1);
  const column = await api.sheets.spreadsheets.values.get({ spreadsheetId, range: tabRange(input.tab, `${counted}2:${counted}`) });
  const last = (column.data.values?.length ?? 0) + 1;
  const first = Math.max(2, last - RECENT_ROWS + 1);
  if (last < first) return null;
  const res = await api.sheets.spreadsheets.values.get({ spreadsheetId, range: tabRange(input.tab, `A${first}:${columnLetter(headers.length)}${last}`) });
  const rows = (res.data.values ?? []) as unknown[][];
  const isCandidate = (cells: unknown[]) => !(input.saveId && metaCell(headers, cells, 'saveId')) && rowHoldsFields(headers, input.fields, cells);
  let index = rows.length - 1;
  while (index >= 0 && !isCandidate(rows[index] ?? [])) index--;
  return index < 0 ? null : { rowNumber: index + first, cells: rows[index] };
}

/**
 * After a Notion or media retry, brings the row the first attempt wrote up to date (see
 * findRecordRow): the photo and voice-note links it was missing, and its Sync Status. When no row
 * is found, nothing is written. Returns the row number it updated.
 */
export async function updateRecordLinks(input: RecordLinksInput): Promise<number | null> {
  const api = apis(input.caller, input.signal);
  if (!api) return null;
  const spreadsheetId = await resolveSpreadsheetId(api, input.spreadsheetId, false);
  const headers = spreadsheetId ? await readHeaders(api, spreadsheetId, input.tab) : null;
  if (!spreadsheetId || !headers?.length) return null;
  const found = await findRecordRow(api, spreadsheetId, headers, input);
  if (!found) return null;

  const { rowNumber, cells } = found;
  const updates: { range: string; values: unknown[][] }[] = [];
  const set = (key: keyof RowMeta, value: string, onlyIfEmpty: boolean) => {
    const column = metaColumnIndex(headers, key);
    const current = String(cells[column] ?? '').trim();
    if (column === -1 || current === value || (onlyIfEmpty && current && current !== '—')) return;
    updates.push({ range: tabRange(input.tab, `${columnLetter(column + 1)}${rowNumber}`), values: [[sanitizeCell(value)]] });
  };
  if (input.imageLink) set('imageLink', input.imageLink, true);
  if (input.voiceNoteLink) set('voiceNoteLink', input.voiceNoteLink, true);
  set('syncStatus', retriedSyncStatus(String(cells[metaColumnIndex(headers, 'syncStatus')] ?? ''), input.succeeded, input.failed, input.lang), false);
  if (!updates.length) return rowNumber;

  await api.sheets.spreadsheets.values.batchUpdate({ spreadsheetId, requestBody: { valueInputOption: 'USER_ENTERED', data: updates } });
  return rowNumber;
}

export function sheetsHealth() {
  return {
    enabled: isModuleEnabled('sheets'),
    configured: true, // signed-in users always have Sheets via OAuth
    circuit: circuitState('sheets'),
  };
}
