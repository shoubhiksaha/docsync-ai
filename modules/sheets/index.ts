/**
 * Sheets module — Google Sheets read/write for synced records.
 *
 * Each user writes to their own spreadsheet with their own OAuth token (drive.file scope).
 */
import { google, type sheets_v4, type drive_v3 } from 'googleapis';
import { isModuleEnabled } from '@/core/env';
import { CallerError, circuitState, errorStatus } from '@/core/isolation';
import { driveQueryLiteral, ensureFolder, getGoogleAuth } from '@/core/google-auth';
import { buildRow, columnLetter, keyValueForMatch, mergeHeaders, primaryKeyColumn, tabRange, type RowMeta, type SheetField } from './a1';

export { columnLetter, keyValueForMatch, mergeHeaders, sanitizeCell, buildRow, META_COLUMNS, type RowMeta, type SheetField } from './a1';

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

async function findSpreadsheet(drive: drive_v3.Drive, name: string, parentId?: string): Promise<string | null> {
  const q = [
    `name=${driveQueryLiteral(name)}`,
    "mimeType='application/vnd.google-apps.spreadsheet'",
    'trashed=false',
    ...(parentId ? [`${driveQueryLiteral(parentId)} in parents`] : []),
  ].join(' and ');
  const res = await drive.files.list({ q, spaces: 'drive', fields: 'files(id)', pageSize: 1 });
  return res.data.files?.[0]?.id ?? null;
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
  const found = await findSpreadsheet(api.drive, USER_SPREADSHEET_NAME);
  if (found || !create) return found;
  const created = await api.sheets.spreadsheets.create({ requestBody: { properties: { title: USER_SPREADSHEET_NAME, ...SHEET_LOCALE } }, fields: 'spreadsheetId' });
  const id = created.data.spreadsheetId as string;
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
async function ensureTab(api: Apis, spreadsheetId: string, tab: string): Promise<{ sheetId: number; headers: string[] }> {
  const meta = await api.sheets.spreadsheets.get({ spreadsheetId, fields: 'sheets.properties(sheetId,title)' });
  const existing = meta.data.sheets?.find(s => s.properties?.title === tab);
  if (existing?.properties?.sheetId != null) {
    return { sheetId: existing.properties.sheetId, headers: (await readHeaders(api, spreadsheetId, tab)) ?? [] };
  }
  const res = await api.sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: { requests: [{ addSheet: { properties: { title: tab, gridProperties: { frozenRowCount: 1 } } } }] },
  });
  return { sheetId: res.data.replies?.[0]?.addSheet?.properties?.sheetId ?? 0, headers: [] };
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
  let headers: string[] | null;
  try {
    headers = await readHeaders(api, spreadsheetId, input.tab);
  } catch (err) {
    if (!input.spreadsheetId || !isUnreachableSheet(err)) throw err;
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
  /** Aborts the write (the sync timeout fired). */
  signal?: AbortSignal;
}

export interface AppendResult {
  spreadsheetId: string;
  spreadsheetUrl?: string;
  action: 'append' | 'replace';
  rows: number;
}

export async function appendRecord(input: AppendInput): Promise<AppendResult> {
  const api = apis(input.caller, input.signal);
  if (!api) throw new CallerError(SESSION_EXPIRED);

  let spreadsheetId = await resolveSpreadsheetId(api, input.spreadsheetId);
  if (!spreadsheetId) throw new Error('Your Google Sheet could not be found or created.');

  let tab: Awaited<ReturnType<typeof ensureTab>>;
  try {
    tab = await ensureTab(api, spreadsheetId, input.tab);
  } catch (err) {
    // A remembered sheet that is gone (or another account's): use this user's own sheet instead.
    if (!input.spreadsheetId || !isUnreachableSheet(err)) throw err;
    console.warn('[sheets] remembered spreadsheet is not reachable; using the user\'s own DocSync sheet');
    spreadsheetId = (await resolveSpreadsheetId(api, null)) as string;
    tab = await ensureTab(api, spreadsheetId, input.tab);
  }
  const wasEmpty = tab.headers.every(h => !String(h).trim());
  const { headers, changed, insert } = mergeHeaders(tab.headers, input.fields);
  if (insert) await insertColumns(api, spreadsheetId, tab.sheetId, headers, insert);
  else if (changed) await writeHeaders(api, spreadsheetId, input.tab, tab.sheetId, headers, wasEmpty);

  const row = buildRow(headers, input.fields, input.meta);
  const lastColumn = columnLetter(headers.length);

  if (input.duplicateAction === 'replace' && input.primaryKey) {
    const pk = primaryKeyColumn(headers, input.fields, input.primaryKey);
    const rows = pk ? await matchingRows(api, spreadsheetId, input.tab, pk.index, pk.value) : [];
    if (rows.length) {
      await api.sheets.spreadsheets.values.batchUpdate({
        spreadsheetId,
        requestBody: {
          valueInputOption: 'USER_ENTERED',
          data: rows.map(r => ({ range: tabRange(input.tab, `A${r}:${lastColumn}${r}`), values: [row] })),
        },
      });
      return { spreadsheetId, spreadsheetUrl: spreadsheetUrl(spreadsheetId), action: 'replace', rows: rows.length };
    }
  }

  await api.sheets.spreadsheets.values.append({
    spreadsheetId,
    range: tabRange(input.tab, 'A1'),
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: [row] },
  });
  return { spreadsheetId, spreadsheetUrl: spreadsheetUrl(spreadsheetId), action: 'append', rows: 1 };
}

export function sheetsHealth() {
  return {
    enabled: isModuleEnabled('sheets'),
    configured: true, // signed-in users always have Sheets via OAuth
    circuit: circuitState('sheets'),
  };
}
