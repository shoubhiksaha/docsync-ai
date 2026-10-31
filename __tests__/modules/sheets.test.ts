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
import { appendRecord, createSheet, findDuplicates, sheetsHealth } from '@/modules/sheets';

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
    process.env = { ...saved };
  });
  afterAll(() => { process.env = saved; });

  it('an expired token asks the user to sign in again and never falls back to a server account', async () => {
    process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL = 'sa@x';
    process.env.GOOGLE_PRIVATE_KEY = 'key';
    await expect(appendRecord({ caller: expired, tab: 'NGO_Receipts', fields, meta })).rejects.toThrow(/session has expired/);
    expect(google.sheets).not.toHaveBeenCalled();
  });

  it('appends a sanitized row, adding new columns before the metadata columns', async () => {
    existingTab(['Receipt Number', 'Notes (Text/Audio)', 'Sync Status']);
    const res = await appendRecord({ caller: user, spreadsheetId: SHEET, tab: 'NGO_Receipts', fields, meta });
    expect(res).toMatchObject({ spreadsheetId: SHEET, action: 'append' });
    const headerWrite = sheetsApi.spreadsheets.values.update.mock.calls[0][0];
    expect(headerWrite.valueInputOption).toBe('RAW');
    expect(headerWrite.requestBody.values[0]).toEqual(['Receipt Number', 'Amount', 'Notes (Text/Audio)', 'Sync Status']);
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

  it('replace rewrites every matching row across the full width', async () => {
    const headers = ['Receipt Number', 'Amount', ...Array.from({ length: 30 }, (_, i) => `Extra ${i}`)];
    existingTab(headers);
    const res = await appendRecord({ caller: user, spreadsheetId: SHEET, tab: 'NGO_Receipts', fields, meta, duplicateAction: 'replace', primaryKey: 'receiptNumber' });
    expect(res).toMatchObject({ action: 'replace', rows: 2 });
    const data = sheetsApi.spreadsheets.values.batchUpdate.mock.calls[0][0].requestBody.data;
    expect(data.map((d: { range: string }) => d.range)).toEqual(["'NGO_Receipts'!A3:AF3", "'NGO_Receipts'!A5:AF5"]);
    expect(sheetsApi.spreadsheets.values.append).not.toHaveBeenCalled();
  });

  it('createSheet makes a new sheet in the user\'s Drive', async () => {
    sheetsApi.spreadsheets.create.mockResolvedValue({ data: { spreadsheetId: 'created_123456789', sheets: [{ properties: { sheetId: 3 } }] } });
    driveApi.files.list.mockResolvedValue({ data: { files: [{ id: 'folder' }] } });
    driveApi.files.get.mockResolvedValue({ data: { parents: [] } });
    const made = await createSheet({ caller: user, tab: 'NGO_Receipts', title: 'T', columns: [{ key: 'a', label: 'A' }] });
    expect(made.spreadsheetId).toBe('created_123456789');
    expect(sheetsApi.spreadsheets.values.update.mock.calls[0][0].requestBody.values[0][0]).toBe('A');
    await expect(createSheet({ caller: expired, tab: 'NGO_Receipts', title: 'T', columns: [] })).rejects.toThrow(/session has expired/);
  });

  it('health', () => {
    expect(sheetsHealth()).toMatchObject({ enabled: true, configured: true, circuit: 'closed' });
  });
});
