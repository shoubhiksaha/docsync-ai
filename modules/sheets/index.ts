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
  buildRow, columnLetter, keyValueForMatch, mergeHeaders, metaColumnIndex, primaryKeyColumn, retriedSyncStatus, rowHoldsFields, sanitizeCell, tabRange,
  type RowMeta, type SheetField, type SheetLang,
} from './a1';

export { columnLetter, keyValueForMatch, mergeHeaders, sanitizeCell, buildRow, syncStatusText, META_COLUMNS, type RowMeta, type SheetField, type SheetLang } from './a1';

export interface SheetsCaller {
  accessToken?: string;
}

const USER_SPREADSHEET_NAME = 'DocSync AI Data';
const USER_FOLDER_NAME = 'DocSync AI';
/** New sheets read "05/11/2026" as 5 November and show times in IST. */
const SHEET_LOCALE = { locale: 'en_IN', timeZone: 'Asia/Kolkata' };
const SESSION_EXPIRED = 'Your Google session has expired. Please sign in again.';

type Apis = { sheets: sheets_v4.Sheets; drive: drive_v3.Drive };

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
async function isTrashed(drive: drive_v3.Drive, fileId: string): Promise<boolean> {
  try {
    return (await drive.files.get({ fileId, fields: 'trashed' })).data.trashed === true;
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
async function resolveSpreadsheetId(api: Apis, clientSpreadsheetId?: string | null, create = true): Promise<string | null> {
  const clientId = clientSpreadsheetId?.trim();
  if (clientId && /^[A-Za-z0-9_-]{10,}$/.test(clientId)) {
    return clientId;
  }
  const [found = null] = await findSpreadsheets(api.drive, USER_SPREADSHEET_NAME);
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

/** Makes sure `tab` exists; returns its sheetId and current header row. */
async function ensureTab(api: Apis, spreadsheetId: string, tab: string, retried = false): Promise<{ sheetId: number; headers: string[] }> {
  const meta = await api.sheets.spreadsheets.get({ spreadsheetId, fields: 'sheets.properties(sheetId,title)' });
  const existing = meta.data.sheets?.find(s => s.properties?.title === tab);
  if (existing?.properties?.sheetId != null) {
    return { sheetId: existing.properties.sheetId, headers: (await readHeaders(api, spreadsheetId, tab)) ?? [] };
  }
  try {
    const res = await api.sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: { requests: [{ addSheet: { properties: { title: tab, gridProperties: { frozenRowCount: 1 } } } }] },
    });
    return { sheetId: res.data.replies?.[0]?.addSheet?.properties?.sheetId ?? 0, headers: [] };
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

async function writeHeaders(api: Apis, spreadsheetId: string, tab: string, sheetId: number, headers: string[], style: boolean) {
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
              range: { sheetId, startRowIndex: 0, endRowIndex: 1 },
              cell: { userEnteredFormat: { textFormat: { bold: true }, backgroundColor: { red: 0.85, green: 0.92, blue: 0.98 }, horizontalAlignment: 'CENTER' } },
              fields: 'userEnteredFormat(textFormat,backgroundColor,horizontalAlignment)',
            },
          },
          { autoResizeDimensions: { dimensions: { sheetId, dimension: 'COLUMNS', startIndex: 0, endIndex: headers.length } } },
        ],
      },
    });
  } catch (err) {
    console.warn('[sheets] header styling failed (non-fatal):', err instanceof Error ? err.message : err);
  }
}

/** 1-based row numbers (excluding the header) whose PK column equals `value`. */
async function matchingRows(api: Apis, spreadsheetId: string, tab: string, columnIndex: number, value: string): Promise<number[]> {
  const letter = columnLetter(columnIndex + 1);
  const res = await api.sheets.spreadsheets.values.get({ spreadsheetId, range: tabRange(tab, `${letter}2:${letter}`) });
  const rows = res.data.values ?? [];
  const wanted = keyValueForMatch(value);
  return rows.flatMap((row, i) => (keyValueForMatch(row?.[0]) === wanted ? [i + 2] : []));
}

// ─── Public API ───────────────────────────────────────────────────────────────

export interface DuplicateCheckInput {
  caller: SheetsCaller;
  spreadsheetId?: string | null;
  tab: string;
  fields: SheetField[];
  primaryKey: string;
}

export interface DuplicateReport {
  count: number;
  label: string;
  value: string;
}

/** Read-only check run before anything is written, so a duplicate never leaves half a sync behind. */
export async function findDuplicates(input: DuplicateCheckInput): Promise<DuplicateReport | null> {
  const api = apis(input.caller);
  if (!api) return null;
  let spreadsheetId = await resolveSpreadsheetId(api, input.spreadsheetId, false);
  if (!spreadsheetId) return null;
  const remembered = spreadsheetId === input.spreadsheetId?.trim();
  let headers: string[] | null = null;
  // The remembered sheet is in the trash or can't be opened: look in the user's own sheet, as the save will.
  let fallBack = false;
  try {
    [headers, fallBack] = await Promise.all([readHeaders(api, spreadsheetId, input.tab), remembered && isTrashed(api.drive, spreadsheetId)]);
  } catch (err) {
    if (!input.spreadsheetId || !isUnreachableSheet(err)) throw err;
    fallBack = true;
  }
  if (fallBack) {
    spreadsheetId = await resolveSpreadsheetId(api, null, false);
    headers = spreadsheetId ? await readHeaders(api, spreadsheetId, input.tab) : null;
  }
  if (!spreadsheetId) return null;
  if (!headers?.length) return null;
  const pk = primaryKeyColumn(headers, input.fields, input.primaryKey);
  if (!pk) return null;
  const rows = await matchingRows(api, spreadsheetId, input.tab, pk.index, pk.value);
  return rows.length ? { count: rows.length, label: headers[pk.index] || input.primaryKey, value: pk.value } : null;
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

  let spreadsheetId = await resolveSpreadsheetId(api, input.spreadsheetId);
  if (!spreadsheetId) throw new Error('Your Google Sheet could not be found or created.');
  const remembered = spreadsheetId === input.spreadsheetId?.trim();

  let tab: Awaited<ReturnType<typeof ensureTab>>;
  let trashed = false;
  try {
    [tab, trashed] = await Promise.all([ensureTab(api, spreadsheetId, input.tab), remembered && isTrashed(api.drive, spreadsheetId)]);
  } catch (err) {
    // A remembered sheet that is gone (or another account's): use this user's own sheet instead.
    if (!input.spreadsheetId || !isUnreachableSheet(err)) throw err;
    console.warn('[sheets] remembered spreadsheet is not reachable; using the user\'s own DocSync sheet');
    spreadsheetId = (await resolveSpreadsheetId(api, null)) as string;
    tab = await ensureTab(api, spreadsheetId, input.tab);
  }
  if (trashed) {
    // Rows written there would go when Drive empties its trash.
    console.warn('[sheets] remembered spreadsheet is in the trash; using the user\'s own DocSync sheet');
    spreadsheetId = (await resolveSpreadsheetId(api, null)) as string;
    tab = await ensureTab(api, spreadsheetId, input.tab);
  }
  const wasEmpty = tab.headers.every(h => !String(h).trim());
  let { headers, changed, insert } = mergeHeaders(tab.headers, input.fields, input.lang);
  if (changed && !wasEmpty) {
    // Another save may have added the same field a moment ago: decide again from the sheet as it is now.
    ({ headers, changed, insert } = mergeHeaders((await readHeaders(api, spreadsheetId, input.tab)) ?? tab.headers, input.fields, input.lang));
  }
  if (insert) await insertColumns(api, spreadsheetId, tab.sheetId, headers, insert);
  else if (changed) await writeHeaders(api, spreadsheetId, input.tab, tab.sheetId, headers, wasEmpty);

  const row = buildRow(headers, input.fields, input.meta);
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
        await api.sheets.spreadsheets.batchUpdate({
          spreadsheetId,
          requestBody: {
            // Bottom-up, so each row number is still right when its turn comes.
            requests: [...extra].reverse().map(r => ({ deleteDimension: { range: { sheetId: tab.sheetId, dimension: 'ROWS', startIndex: r - 1, endIndex: r } } })),
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
  signal?: AbortSignal;
}

/** A retry comes soon after the save it repeats, so its row is among the last ones; older rows are never read. */
const RECENT_ROWS = 200;

/**
 * After a Notion or media retry, brings the row the first attempt wrote up to date: the photo and
 * voice-note links it was missing, and its Sync Status. The row is the last one (of the most recent
 * RECENT_ROWS) holding exactly this record's values; when none does, nothing is written. Returns the
 * row number it updated.
 */
export async function updateRecordLinks(input: RecordLinksInput): Promise<number | null> {
  const api = apis(input.caller, input.signal);
  if (!api) return null;
  const spreadsheetId = await resolveSpreadsheetId(api, input.spreadsheetId, false);
  const headers = spreadsheetId ? await readHeaders(api, spreadsheetId, input.tab) : null;
  if (!spreadsheetId || !headers?.length) return null;
  // Synced At is filled on every row the app writes, so its length is the number of rows.
  const counted = columnLetter(Math.max(0, metaColumnIndex(headers, 'syncedAt')) + 1);
  const column = await api.sheets.spreadsheets.values.get({ spreadsheetId, range: tabRange(input.tab, `${counted}2:${counted}`) });
  const last = (column.data.values?.length ?? 0) + 1;
  const first = Math.max(2, last - RECENT_ROWS + 1);
  if (last < first) return null;
  const res = await api.sheets.spreadsheets.values.get({ spreadsheetId, range: tabRange(input.tab, `A${first}:${columnLetter(headers.length)}${last}`) });
  const rows = (res.data.values ?? []) as unknown[][];
  let index = rows.length - 1;
  while (index >= 0 && !rowHoldsFields(headers, input.fields, rows[index] ?? [])) index--;
  if (index < 0) return null;

  const cells = rows[index];
  const rowNumber = index + first;
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
