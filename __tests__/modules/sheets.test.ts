const sheetsApi = {
  spreadsheets: {
    get: jest.fn(),
    create: jest.fn(),
    batchUpdate: jest.fn(),
    values: { get: jest.fn(), update: jest.fn(), append: jest.fn(), batchUpdate: jest.fn() },
  },
};
const driveApi = { files: { list: jest.fn(), create: jest.fn(), get: jest.fn(), update: jest.fn() } };

jest.mock('googleapis', () => {
  class OAuth2 { kind = 'oauth'; setCredentials = jest.fn(); }
  return { google: { auth: { OAuth2 }, sheets: jest.fn(() => sheetsApi), drive: jest.fn(() => driveApi) } };
});

import { google } from 'googleapis';
import { CallerError } from '@/core/isolation';
import { appendRecord, findDuplicates, sheetsHealth, updateRecordLinks } from '@/modules/sheets';

const meta = { notes: '', voiceNoteLink: '', imageLink: '—', syncedAt: '2026-01-01T00:00:00.000Z', syncStatus: 'Success' };
const fields = [
  { key: 'receiptNumber', label: 'Receipt Number', value: 'R-1' },
  { key: 'amount', label: 'Amount', value: '=HYPERLINK("x")' },
];
const user = { accessToken: 'ya29.token' };
const expired = {};
const SHEET = 'userSheet_1234567890';

function existingTab(headers: string[]) {
  sheetsApi.spreadsheets.get.mockResolvedValue({ data: { sheets: [{ properties: { sheetId: 7, title: 'NGO_Receipts' } }] } });
  sheetsApi.spreadsheets.values.get.mockImplementation(async ({ range }: { range: string }) => {
    if (range.endsWith('!1:1')) return { data: { values: [headers] } };
    return { data: { values: [['R-0'], ['R-1'], ['R-2'], ['R-1']] } }; // PK column rows 2..5
  });
}

describe('modules/sheets', () => {
  const saved = { ...process.env };
  beforeEach(() => {
    jest.clearAllMocks();
    driveApi.files.get.mockReset();
    process.env = { ...saved };
  });
  afterAll(() => { process.env = saved; });

  it('an expired token asks the user to sign in again and never falls back to a server account', async () => {
    process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL = 'sa@x';
    process.env.GOOGLE_PRIVATE_KEY = 'key';
    await expect(appendRecord({ caller: expired, tab: 'NGO_Receipts', fields, meta })).rejects.toThrow(CallerError);
    await expect(appendRecord({ caller: expired, tab: 'NGO_Receipts', fields, meta })).rejects.toThrow(/session has expired/);
    expect(google.sheets).not.toHaveBeenCalled();
  });

  it('appends a sanitized row, inserting new columns before the metadata columns', async () => {
    existingTab(['Receipt Number', 'Notes (Text/Audio)', 'Sync Status']);
    const res = await appendRecord({ caller: user, spreadsheetId: SHEET, tab: 'NGO_Receipts', fields, meta });
    expect(res).toMatchObject({ spreadsheetId: SHEET, action: 'append' });
    // The existing rows' cells move right with their headers, in the same request as the new header row.
    const [insert, header] = sheetsApi.spreadsheets.batchUpdate.mock.calls[0][0].requestBody.requests;
    expect(insert.insertDimension).toEqual({ range: { sheetId: 7, dimension: 'COLUMNS', startIndex: 1, endIndex: 2 }, inheritFromBefore: true });
    expect(header.updateCells.rows[0].values.map((v: { userEnteredValue: { stringValue: string } }) => v.userEnteredValue.stringValue))
      .toEqual(['Receipt Number', 'Amount', 'Notes (Text/Audio)', 'Sync Status']);
    expect(sheetsApi.spreadsheets.values.update).not.toHaveBeenCalled();
    const append = sheetsApi.spreadsheets.values.append.mock.calls[0][0];
    expect(append.range).toBe("'NGO_Receipts'!A1");
    expect(append.requestBody.values[0]).toEqual(['R-1', '\'=HYPERLINK("x")', '', 'Success']);
    expect((google.sheets as jest.Mock).mock.calls[0][0].auth.kind).toBe('oauth');
  });

  it('creates a missing tab with styled headers', async () => {
    sheetsApi.spreadsheets.get.mockResolvedValue({ data: { sheets: [] } });
    sheetsApi.spreadsheets.batchUpdate.mockResolvedValueOnce({ data: { replies: [{ addSheet: { properties: { sheetId: 9 } } }] } });
    await appendRecord({ caller: user, spreadsheetId: SHEET, tab: 'Factory_Slips', fields, meta });
    expect(sheetsApi.spreadsheets.batchUpdate.mock.calls[0][0].requestBody.requests[0].addSheet.properties.title).toBe('Factory_Slips');
    expect(sheetsApi.spreadsheets.batchUpdate.mock.calls[1][0].requestBody.requests[0].repeatCell.range.sheetId).toBe(9);
  });

  it('finds or creates "DocSync AI Data" when the user has no sheet yet', async () => {
    driveApi.files.list.mockResolvedValue({ data: { files: [] } });
    sheetsApi.spreadsheets.create.mockResolvedValue({ data: { spreadsheetId: 'newSheet_1234567' } });
    driveApi.files.get.mockResolvedValue({ data: { parents: ['root'] } });
    driveApi.files.create.mockResolvedValue({ data: { id: 'folder1' } });
    existingTab([]);
    const res = await appendRecord({ caller: user, spreadsheetId: 'not a sheet id', tab: 'NGO_Receipts', fields, meta });
    expect(res.spreadsheetId).toBe('newSheet_1234567');
    expect(driveApi.files.update).toHaveBeenCalledWith(expect.objectContaining({ fileId: 'newSheet_1234567', addParents: 'folder1' }));
  });

  it('findDuplicates reads only the primary-key column, even past column Z', async () => {
    const headers = [...Array.from({ length: 27 }, (_, i) => `Col ${i}`), 'Receipt Number'];
    existingTab(headers);
    const dup = await findDuplicates({ caller: user, spreadsheetId: SHEET, tab: 'NGO_Receipts', fields, primaryKey: 'receiptNumber' });
    expect(dup).toEqual({ count: 2, label: 'Receipt Number', value: 'R-1' });
    const pkRead = sheetsApi.spreadsheets.values.get.mock.calls.find(([a]) => !a.range.endsWith('!1:1'))[0];
    expect(pkRead.range).toBe("'NGO_Receipts'!AB2:AB");
  });

  it('findDuplicates returns null when there is nothing to compare', async () => {
    existingTab(['Amount']);
    expect(await findDuplicates({ caller: user, spreadsheetId: SHEET, tab: 'NGO_Receipts', fields, primaryKey: 'receiptNumber' })).toBeNull();
    expect(await findDuplicates({ caller: expired, tab: 'NGO_Receipts', fields, primaryKey: 'receiptNumber' })).toBeNull();
  });

  it('replace writes the record over the first copy, across the full width, and deletes the other copies bottom-up', async () => {
    const headers = ['Receipt Number', 'Amount', ...Array.from({ length: 30 }, (_, i) => `Extra ${i}`)];
    existingTab(headers);
    sheetsApi.spreadsheets.values.get.mockImplementation(async ({ range }: { range: string }) => (
      range.endsWith('!1:1') ? { data: { values: [headers] } } : { data: { values: [['R-1'], ['R-0'], ['R-1'], ['R-1']] } } // rows 2..5
    ));
    const res = await appendRecord({ caller: user, spreadsheetId: SHEET, tab: 'NGO_Receipts', fields, meta, duplicateAction: 'replace', primaryKey: 'receiptNumber' });
    expect(res).toMatchObject({ action: 'replace', rows: 1, removed: 2 });
    const update = sheetsApi.spreadsheets.values.update.mock.calls[0][0];
    expect(update.range).toBe("'NGO_Receipts'!A2:AF2");
    expect(update.requestBody.values[0][0]).toBe('R-1');
    const deletes = sheetsApi.spreadsheets.batchUpdate.mock.calls[0][0].requestBody.requests.map((r: { deleteDimension: { range: unknown } }) => r.deleteDimension.range);
    expect(deletes).toEqual([
      { sheetId: 7, dimension: 'ROWS', startIndex: 4, endIndex: 5 },
      { sheetId: 7, dimension: 'ROWS', startIndex: 3, endIndex: 4 },
    ]);
    expect(sheetsApi.spreadsheets.values.append).not.toHaveBeenCalled();
  });

  it('replace with one earlier copy only rewrites that row', async () => {
    existingTab(['Receipt Number', 'Amount']);
    sheetsApi.spreadsheets.values.get.mockImplementation(async ({ range }: { range: string }) => (
      range.endsWith('!1:1') ? { data: { values: [['Receipt Number', 'Amount']] } } : { data: { values: [['R-0'], ['R-1']] } }
    ));
    const res = await appendRecord({ caller: user, spreadsheetId: SHEET, tab: 'NGO_Receipts', fields, meta, duplicateAction: 'replace', primaryKey: 'receiptNumber' });
    expect(res).toMatchObject({ action: 'replace', rows: 1, removed: 0 });
    expect(sheetsApi.spreadsheets.values.update.mock.calls[0][0].range).toBe("'NGO_Receipts'!A3:B3");
    expect(sheetsApi.spreadsheets.batchUpdate).not.toHaveBeenCalled();
  });

  it('a remembered sheet in the Drive trash is not written to: the row goes to the user\'s own sheet, with a note', async () => {
    existingTab(['Receipt Number', 'Amount']);
    driveApi.files.get.mockImplementation(async ({ fileId }: { fileId: string }) => ({ data: { trashed: fileId === SHEET } }));
    driveApi.files.list.mockResolvedValue({ data: { files: [{ id: 'ownSheet_123456' }] } });
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const res = await appendRecord({ caller: user, spreadsheetId: SHEET, tab: 'NGO_Receipts', fields, meta });
    expect(res).toMatchObject({ spreadsheetId: 'ownSheet_123456', note: 'sheet_was_in_trash' });
    expect(sheetsApi.spreadsheets.values.append.mock.calls[0][0].spreadsheetId).toBe('ownSheet_123456');
    expect(driveApi.files.list.mock.calls[0][0]).toMatchObject({ orderBy: 'createdTime' });

    // The duplicate check looks there too.
    sheetsApi.spreadsheets.values.get.mockClear();
    await findDuplicates({ caller: user, spreadsheetId: SHEET, tab: 'NGO_Receipts', fields, primaryKey: 'receiptNumber' });
    expect(sheetsApi.spreadsheets.values.get.mock.calls.at(-1)[0].spreadsheetId).toBe('ownSheet_123456');
  });

  it('two first saves at once keep one sheet: the extra one is trashed', async () => {
    driveApi.files.list
      .mockResolvedValueOnce({ data: { files: [] } })
      .mockResolvedValueOnce({ data: { files: [{ id: 'aOtherPhone_1234' }, { id: 'newSheet_1234567' }] } });
    sheetsApi.spreadsheets.create.mockResolvedValue({ data: { spreadsheetId: 'newSheet_1234567' } });
    driveApi.files.update.mockResolvedValue({ data: { id: 'newSheet_1234567' } });
    existingTab([]);
    const res = await appendRecord({ caller: user, tab: 'NGO_Receipts', fields, meta });
    expect(res.spreadsheetId).toBe('aOtherPhone_1234');
    expect(driveApi.files.update).toHaveBeenCalledWith(expect.objectContaining({ fileId: 'newSheet_1234567', requestBody: { trashed: true } }));
  });

  it('a tab another save added a moment ago is used, not a failed save', async () => {
    sheetsApi.spreadsheets.get
      .mockResolvedValueOnce({ data: { sheets: [] } })
      .mockResolvedValueOnce({ data: { sheets: [{ properties: { sheetId: 11, title: 'NGO_Receipts' } }] } });
    sheetsApi.spreadsheets.batchUpdate.mockRejectedValueOnce(new Error('Invalid requests[0].addSheet: A sheet with the name "NGO_Receipts" already exists.'));
    sheetsApi.spreadsheets.values.get.mockResolvedValue({ data: { values: [['Receipt Number', 'Amount']] } });
    const res = await appendRecord({ caller: user, spreadsheetId: SHEET, tab: 'NGO_Receipts', fields, meta });
    expect(res.action).toBe('append');
  });

  it('a column another save just added is not inserted twice', async () => {
    sheetsApi.spreadsheets.get.mockResolvedValue({ data: { sheets: [{ properties: { sheetId: 7, title: 'NGO_Receipts' } }] } });
    sheetsApi.spreadsheets.values.get
      .mockResolvedValueOnce({ data: { values: [['Receipt Number', 'Sync Status']] } })
      .mockResolvedValueOnce({ data: { values: [['Receipt Number', 'Amount', 'Sync Status']] } });
    await appendRecord({ caller: user, spreadsheetId: SHEET, tab: 'NGO_Receipts', fields, meta });
    expect(sheetsApi.spreadsheets.batchUpdate).not.toHaveBeenCalled();
    expect(sheetsApi.spreadsheets.values.append.mock.calls[0][0].requestBody.values[0]).toEqual(['R-1', '\'=HYPERLINK("x")', 'Success']);
  });

  it('updateRecordLinks fills the missing links and status into the row the first attempt wrote', async () => {
    const headers = ['Receipt Number', 'Amount', 'Voice Note Audio Link', 'Link to Image', 'Sync Status'];
    sheetsApi.spreadsheets.values.get.mockImplementation(async ({ range }: { range: string }) => (
      range.endsWith('!1:1') ? { data: { values: [headers] } } : {
        data: {
          values: [
            ['R-1', '=HYPERLINK("x")', '', '—', 'Partial (Notion, media upload failed)'], // row 2
            ['R-2', '5', '', '—', 'Success'],
            ['R-1', '=HYPERLINK("x")', '', '—', 'Partial (Notion, media upload failed)'], // row 4: the latest copy
            ['R-3', '7', '', '—', 'Success'],
          ],
        },
      }
    ));
    const row = await updateRecordLinks({
      caller: user, spreadsheetId: SHEET, tab: 'NGO_Receipts', fields,
      imageLink: 'https://notion/page', voiceNoteLink: null, succeeded: ['Notion'], failed: ['media upload'],
    });
    expect(row).toBe(4);
    const data = sheetsApi.spreadsheets.values.batchUpdate.mock.calls[0][0].requestBody.data;
    expect(data).toEqual([
      { range: "'NGO_Receipts'!D4", values: [['https://notion/page']] },
      { range: "'NGO_Receipts'!E4", values: [['Partial (media upload failed)']] },
    ]);
  });

  it('updateRecordLinks writes nothing when no row holds this record, or the row is already up to date', async () => {
    const headers = ['Receipt Number', 'Amount', 'Link to Image', 'Sync Status'];
    sheetsApi.spreadsheets.values.get.mockImplementation(async ({ range }: { range: string }) => (
      range.endsWith('!1:1') ? { data: { values: [headers] } } : { data: { values: [['R-1', 'other', '—', 'Partial (Notion failed)'], ['R-1', '=HYPERLINK("x")', 'https://drive/img', 'Success']] } }
    ));
    const input = { caller: user, spreadsheetId: SHEET, tab: 'NGO_Receipts', imageLink: 'https://notion/page', succeeded: ['Notion'], failed: [] };
    expect(await updateRecordLinks({ ...input, fields })).toBe(3);
    expect(await updateRecordLinks({ ...input, fields: [{ key: 'receiptNumber', label: 'Receipt Number', value: 'R-9' }] })).toBeNull();
    expect(sheetsApi.spreadsheets.values.batchUpdate).not.toHaveBeenCalled();
    expect(await updateRecordLinks({ ...input, caller: expired, fields })).toBeNull();
  });

  it('a new field past the last column only rewrites the header row', async () => {
    existingTab(['Receipt Number']);
    await appendRecord({ caller: user, spreadsheetId: SHEET, tab: 'NGO_Receipts', fields, meta });
    expect(sheetsApi.spreadsheets.batchUpdate).not.toHaveBeenCalled();
    expect(sheetsApi.spreadsheets.values.update.mock.calls[0][0].requestBody.values[0]).toEqual(['Receipt Number', 'Amount']);
  });

  it('health', () => {
    expect(sheetsHealth()).toMatchObject({ enabled: true, configured: true, circuit: 'closed' });
  });

  it("a remembered sheet that is gone or another account's falls back to the user's own sheet", async () => {
    sheetsApi.spreadsheets.get.mockImplementation(async ({ spreadsheetId }: { spreadsheetId: string }) => {
      if (spreadsheetId === SHEET) throw Object.assign(new Error('Requested entity was not found.'), { status: 404 });
      return { data: { sheets: [{ properties: { sheetId: 7, title: 'NGO_Receipts' } }] } };
    });
    sheetsApi.spreadsheets.values.get.mockResolvedValue({ data: { values: [['Receipt Number', 'Amount']] } });
    driveApi.files.list.mockResolvedValue({ data: { files: [{ id: 'ownSheet_123456' }] } });
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const res = await appendRecord({ caller: user, spreadsheetId: SHEET, tab: 'NGO_Receipts', fields, meta });
    expect(res.spreadsheetId).toBe('ownSheet_123456');
    expect(sheetsApi.spreadsheets.values.append.mock.calls[0][0].spreadsheetId).toBe('ownSheet_123456');
  });

  it('new sheets use the Indian locale and time zone; a write can be aborted', async () => {
    driveApi.files.list.mockResolvedValue({ data: { files: [] } });
    sheetsApi.spreadsheets.create.mockResolvedValue({ data: { spreadsheetId: 'newSheet_1234567' } });
    driveApi.files.get.mockResolvedValue({ data: { parents: ['root'] } });
    driveApi.files.create.mockResolvedValue({ data: { id: 'folder1' } });
    existingTab([]);
    const signal = new AbortController().signal;
    await appendRecord({ caller: user, tab: 'NGO_Receipts', fields, meta, signal });
    expect(sheetsApi.spreadsheets.create.mock.calls[0][0].requestBody.properties).toMatchObject({ locale: 'en_IN', timeZone: 'Asia/Kolkata' });
    expect((google.sheets as jest.Mock).mock.calls.at(-1)[0].signal).toBe(signal);
  });

  it('findDuplicates catches a re-scan whose leading zeros Sheets dropped', async () => {
    existingTab(['Receipt Number']);
    sheetsApi.spreadsheets.values.get.mockImplementation(async ({ range }: { range: string }) => (
      range.endsWith('!1:1') ? { data: { values: [['Receipt Number']] } } : { data: { values: [['411'], ['412']] } }
    ));
    const dup = await findDuplicates({ caller: user, spreadsheetId: SHEET, tab: 'NGO_Receipts', fields: [{ key: 'receiptNumber', label: 'Receipt Number', value: '000412' }], primaryKey: 'receiptNumber' });
    expect(dup).toEqual({ count: 1, label: 'Receipt Number', value: '000412' });
  });
});
