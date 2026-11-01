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
import { appendRecord, findDuplicates, findSavedRecord, sheetsHealth, updateRecordLinks } from '@/modules/sheets';

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

  it('updateRecordLinks finds the row by its Save ID, even when Sheets reformatted a date in it', async () => {
    const headers = ['Receipt Number', 'Date', 'Link to Image', 'Sync Status', 'Save ID'];
    const record = [{ key: 'receiptNumber', label: 'Receipt Number', value: 'R-1' }, { key: 'date', label: 'Date', value: '5/11/26' }];
    sheetsApi.spreadsheets.values.get.mockImplementation(async ({ range }: { range: string }) => {
      if (range.endsWith('!1:1')) return { data: { values: [headers] } };
      if (range.endsWith('!E2:E')) return { data: { values: [['save-0001-0002-0003'], ['other-id-0000-0000']] } };
      if (range.endsWith('!A2:E2')) return { data: { values: [['R-1', '05/11/2026', '—', 'Partial (Notion failed)', 'save-0001-0002-0003']] } };
      // Another save of the same values, after it: never mistaken for this one.
      return { data: { values: [['R-1', '05/11/2026', '—', 'Partial (Notion failed)', 'save-0001-0002-0003'], ['R-1', '05/11/2026', '—', 'Partial (Notion failed)', 'other-id-0000-0000']] } };
    });
    const input = { caller: user, spreadsheetId: SHEET, tab: 'NGO_Receipts', fields: record, imageLink: 'https://notion/page', succeeded: ['Notion'], failed: [] };
    expect(await updateRecordLinks({ ...input, saveId: 'save-0001-0002-0003' })).toBe(2);
    expect(sheetsApi.spreadsheets.values.batchUpdate.mock.calls[0][0].requestBody.data[0].range).toBe("'NGO_Receipts'!C2");

    // An id the sheet doesn't hold: only a row without any Save ID may be its row, and here there is none.
    expect(await updateRecordLinks({ ...input, saveId: 'never-saved-0000-0000' })).toBeNull();
    // A retry without an id (an older app) still finds the latest copy by its values, the reformatted date included.
    expect(await updateRecordLinks(input)).toBe(3);
  });

  it('updateRecordLinks reads only the most recent rows of a long tab', async () => {
    const headers = ['Receipt Number', 'Amount', 'Link to Image', 'Synced At', 'Sync Status'];
    const record = ['R-1', '=HYPERLINK("x")', '—', '2026-11-01 10:00', 'Partial (Notion failed)'];
    sheetsApi.spreadsheets.values.get.mockImplementation(async ({ range }: { range: string }) => {
      if (range.endsWith('!1:1')) return { data: { values: [headers] } };
      if (range.endsWith('!D2:D')) return { data: { values: Array.from({ length: 5000 }, () => ['2026-11-01 10:00']) } };
      return { data: { values: [record] } };
    });
    const row = await updateRecordLinks({ caller: user, spreadsheetId: SHEET, tab: 'NGO_Receipts', fields, imageLink: 'https://drive/img', succeeded: ['Notion'], failed: [] });
    expect(sheetsApi.spreadsheets.values.get).toHaveBeenCalledWith(expect.objectContaining({ range: "'NGO_Receipts'!A4802:E5001" }));
    expect(row).toBe(4802);
  });

  it('writes a date-shaped slip or duplicate-check number as text, so Sheets keeps it as written', async () => {
    existingTab(['Book No', 'Receipt Number', 'Date', 'Sync Status']);
    const slip = [
      { key: 'bookNo', label: 'Book No', value: '12/3' },
      { key: 'receiptNumber', label: 'Receipt Number', value: '5-11' },
      { key: 'date', label: 'Date', value: '5/11/26' },
    ];
    await appendRecord({ caller: user, spreadsheetId: SHEET, tab: 'NGO_Receipts', fields: slip, meta, primaryKey: 'receiptNumber' });
    expect(sheetsApi.spreadsheets.values.append.mock.calls[0][0].requestBody.values[0]).toEqual(["'12/3", "'5-11", '5/11/26', 'Success']);
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

  it('findDuplicates can also read the first copy\'s photo link (for a replace)', async () => {
    const headers = ['Receipt Number', 'Amount', 'Link to Image', 'Sync Status'];
    sheetsApi.spreadsheets.get.mockResolvedValue({ data: { sheets: [{ properties: { sheetId: 7, title: 'NGO_Receipts' } }] } });
    sheetsApi.spreadsheets.values.get.mockImplementation(async ({ range }: { range: string }) => {
      if (range.endsWith('!1:1')) return { data: { values: [headers] } };
      if (range.endsWith('!A2:A')) return { data: { values: [['R-0'], ['R-1']] } };
      return { data: { values: [['R-1', '5', 'https://drive.google.com/file/d/OLD/view', 'Success']] } };
    });
    const dup = await findDuplicates({ caller: user, spreadsheetId: SHEET, tab: 'NGO_Receipts', fields, primaryKey: 'receiptNumber', withImageLink: true });
    expect(dup).toEqual({ count: 1, label: 'Receipt Number', value: 'R-1', imageLink: 'https://drive.google.com/file/d/OLD/view' });
    expect(sheetsApi.spreadsheets.values.get.mock.calls.at(-1)[0].range).toBe("'NGO_Receipts'!A3:D3");
  });

  describe('save id (a retried save is not written twice)', () => {
    const withId = { ...meta, saveId: 'save-0001-0002-0003' };
    const hidden = () => sheetsApi.spreadsheets.batchUpdate.mock.calls
      .flatMap(([a]) => a.requestBody.requests)
      .filter((r: { updateDimensionProperties?: unknown }) => r.updateDimensionProperties)
      .map((r: { updateDimensionProperties: { range: unknown } }) => r.updateDimensionProperties.range);

    it('a new sheet gets a hidden Save ID column after the metadata columns, and the row carries the id', async () => {
      existingTab([]);
      await appendRecord({ caller: user, spreadsheetId: SHEET, tab: 'NGO_Receipts', fields, meta: withId });
      const header = sheetsApi.spreadsheets.values.update.mock.calls[0][0].requestBody.values[0];
      expect(header.at(-2)).toBe('Sync Status');
      expect(header.at(-1)).toBe('Save ID');
      expect(hidden()).toEqual([{ sheetId: 7, dimension: 'COLUMNS', startIndex: header.length - 1, endIndex: header.length }]);
      expect(sheetsApi.spreadsheets.values.append.mock.calls[0][0].requestBody.values[0].at(-1)).toBe('save-0001-0002-0003');
    });

    it('an existing sheet gets the column inserted with the other new columns; one that has it is left alone', async () => {
      existingTab(['Receipt Number', 'Amount', 'Sync Status']);
      await appendRecord({ caller: user, spreadsheetId: SHEET, tab: 'NGO_Receipts', fields, meta: withId });
      const [insert] = sheetsApi.spreadsheets.batchUpdate.mock.calls[0][0].requestBody.requests;
      expect(insert.insertDimension.range).toMatchObject({ startIndex: 2, endIndex: 3 });
      expect(hidden()).toEqual([{ sheetId: 7, dimension: 'COLUMNS', startIndex: 2, endIndex: 3 }]);
      expect(sheetsApi.spreadsheets.values.append.mock.calls[0][0].requestBody.values[0]).toEqual(['R-1', '\'=HYPERLINK("x")', 'save-0001-0002-0003', 'Success']);

      jest.clearAllMocks();
      existingTab(['Receipt Number', 'Amount', 'Sync Status', 'Save ID']);
      await appendRecord({ caller: user, spreadsheetId: SHEET, tab: 'NGO_Receipts', fields, meta: withId });
      expect(sheetsApi.spreadsheets.batchUpdate).not.toHaveBeenCalled();
      expect(sheetsApi.spreadsheets.values.append.mock.calls[0][0].requestBody.values[0]).toEqual(['R-1', '\'=HYPERLINK("x")', 'Success', 'save-0001-0002-0003']);
    });

    it('a save without an id adds no column', async () => {
      existingTab(['Receipt Number', 'Amount', 'Sync Status']);
      await appendRecord({ caller: user, spreadsheetId: SHEET, tab: 'NGO_Receipts', fields, meta });
      expect(sheetsApi.spreadsheets.batchUpdate).not.toHaveBeenCalled();
      expect(sheetsApi.spreadsheets.values.update).not.toHaveBeenCalled();
    });

    it('findSavedRecord finds the row by its id and reads back its links and status', async () => {
      const headers = ['Receipt Number', 'Voice Note Audio Link', 'Link to Image', 'Sync Status', 'Save ID'];
      sheetsApi.spreadsheets.get.mockResolvedValue({ data: { sheets: [{ properties: { sheetId: 7, title: 'NGO_Receipts' } }] } });
      sheetsApi.spreadsheets.values.get.mockImplementation(async ({ range }: { range: string }) => {
        if (range.endsWith('!1:1')) return { data: { values: [headers] } };
        if (range.endsWith('!E2:E')) return { data: { values: [['other-id'], [], ['save-0001-0002-0003']] } };
        return { data: { values: [['R-1', '', 'https://drive.google.com/file/d/1/view', 'Partial (Notion failed)', 'save-0001-0002-0003']] } };
      });
      const found = await findSavedRecord({ caller: user, spreadsheetId: SHEET, tab: 'NGO_Receipts', saveId: 'save-0001-0002-0003' });
      expect(found).toEqual({
        spreadsheetId: SHEET,
        spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${SHEET}/edit`,
        imageLink: 'https://drive.google.com/file/d/1/view',
        voiceNoteLink: null,
        failed: ['Notion'],
      });
      expect(sheetsApi.spreadsheets.values.get.mock.calls.at(-1)[0].range).toBe("'NGO_Receipts'!A4:E4");

      expect(await findSavedRecord({ caller: user, spreadsheetId: SHEET, tab: 'NGO_Receipts', saveId: 'never-saved-0000' })).toBeNull();
    });

    it('findSavedRecord returns null for a sheet without the column, or without a session', async () => {
      existingTab(['Receipt Number', 'Sync Status']);
      expect(await findSavedRecord({ caller: user, spreadsheetId: SHEET, tab: 'NGO_Receipts', saveId: 'save-0001-0002-0003' })).toBeNull();
      expect(await findSavedRecord({ caller: expired, tab: 'NGO_Receipts', saveId: 'save-0001-0002-0003' })).toBeNull();
    });
  });
});
