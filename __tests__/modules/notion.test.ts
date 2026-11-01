const databasesRetrieve = jest.fn();
const dataSourcesRetrieve = jest.fn();
const pagesCreate = jest.fn();
jest.mock('@notionhq/client', () => ({
  Client: jest.fn().mockImplementation(() => ({
    databases: { retrieve: databasesRetrieve },
    dataSources: { retrieve: dataSourcesRetrieve },
    pages: { create: pagesCreate },
  })),
}));
const uploadToNotion = jest.fn();
jest.mock('notion-multipart-uploader', () => ({ uploadToNotion: (...args: unknown[]) => uploadToNotion(...args) }));

import { buildProperties, createDatabaseForUser, notionHealth, parseDateToISO, resolveNotionTarget, syncRecord } from '@/modules/notion';
import { getProfile, type RecordField } from '@/modules/profiles';

const ngo = getProfile('ngo-receipt')!;
const slip = getProfile('factory-weight-slip')!;
const fields: RecordField[] = [
  { key: 'date', label: 'Date', value: '24-Oct-2023' },
  { key: 'donorName', label: 'Donor Name', value: 'Rahul Sharma' },
  { key: 'amount', label: 'Amount', value: '₹5,000' },
  { key: 'panNumber', label: 'PAN Number', value: 'ABCDE1234F' },
];

describe('parseDateToISO', () => {
  it.each([
    ['24-Oct-2023', '2023-10-24'],
    ['24 October 2023', '2023-10-24'],
    ['3rd Sept 2024', '2024-09-03'],
    ['24/10/2023', '2023-10-24'],
    ['05.01.24', '2024-01-05'],
    ['2023-10-24', '2023-10-24'],
    ['2023-10-24T10:00:00Z', '2023-10-24'],
    ['Oct 24, 2023', '2023-10-24'],
  ])('%s → %s', (input, expected) => {
    expect(parseDateToISO(input)).toBe(expected);
  });

  it.each(['', '31/02/2023', '13/13/2023', 'yesterday', 'Foo 12 2023'])('rejects %p', input => {
    expect(parseDateToISO(input)).toBeNull();
  });
});

describe('buildProperties', () => {
  it('writes only properties that exist with the right type', () => {
    const schema = {
      Title: { type: 'title' },
      Date: { type: 'date' },
      Amount: { type: 'number' },
      PAN: { type: 'select' }, // wrong type → skipped
      Profile: { type: 'select' },
      'Scanned At': { type: 'date' },
    };
    const props = buildProperties(schema, { profile: ngo, fields, note: 'hi', scannedAt: '2026-01-01T00:00:00.000Z' });
    expect(props).toEqual({
      Title: { title: [{ type: 'text', text: { content: 'Rahul Sharma' } }] },
      Date: { date: { start: '2023-10-24' } },
      Amount: { number: 5000 },
      Profile: { select: { name: 'NGO Donation Receipt' } },
      'Scanned At': { date: { start: '2026-01-01T00:00:00.000Z' } },
    });
  });

  it('skips an unparseable date instead of failing the page', () => {
    const props = buildProperties({ Name: { type: 'title' }, Date: { type: 'date' } }, {
      profile: ngo, fields: [{ key: 'date', label: 'Date', value: 'illegible' }], scannedAt: 'x',
    });
    expect(props.Date).toBeUndefined();
    expect(props.Name).toEqual({ title: [{ type: 'text', text: { content: 'illegible' } }] });
  });

  it('handles rich_text, select and date specs from profiles', () => {
    const schema = { Name: { type: 'title' }, 'Net Weight': { type: 'number' }, Notes: { type: 'rich_text' }, 'Original Image': { type: 'url' } };
    const props = buildProperties(schema, {
      profile: slip,
      fields: [{ key: 'vehicleNumber', label: 'Vehicle', value: 'MH-12' }, { key: 'netWeight', label: 'Net', value: '10,000' }],
      note: 'x'.repeat(2500),
      imageLink: 'https://drive.google.com/x',
      scannedAt: 'x',
    });
    expect(props['Net Weight']).toEqual({ number: 10000 });
    expect((props.Notes as { rich_text: unknown[] }).rich_text).toHaveLength(2);
    expect(props['Original Image']).toEqual({ url: 'https://drive.google.com/x' });
  });
});

describe('syncRecord', () => {
  const saved = { ...process.env };
  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...saved };
    delete process.env.NOTION_API_KEY;
    delete process.env.NOTION_DATABASE_ID;
    pagesCreate.mockResolvedValue({ url: 'https://notion.so/page' });
  });
  afterAll(() => { process.env = saved; });

  it('uses the data-source schema and parent (Notion API 2025-09-03)', async () => {
    databasesRetrieve.mockResolvedValue({ data_sources: [{ id: 'ds1' }] });
    dataSourcesRetrieve.mockResolvedValue({ properties: { Name: { type: 'title' }, Amount: { type: 'number' } } });
    uploadToNotion.mockResolvedValueOnce('img-1').mockResolvedValueOnce('aud-1');

    const res = await syncRecord({ apiKey: 'secret_x', databaseId: 'db1', profile: ngo, fields, note: 'n', image: Buffer.from('i'), audio: Buffer.from('a') });

    expect(res).toEqual({ url: 'https://notion.so/page', attachmentNotes: [] });
    const arg = pagesCreate.mock.calls[0][0];
    expect(arg.parent).toEqual({ type: 'data_source_id', data_source_id: 'ds1' });
    expect(Object.keys(arg.properties)).toEqual(['Name', 'Amount']);
    const types = arg.children.map((c: { type: string }) => c.type);
    expect(types).toEqual(['heading_2', 'callout', 'heading_3', 'code', 'heading_3', 'image']);
  });

  it('falls back to database properties for the older API shape and survives attachment failures', async () => {
    databasesRetrieve.mockResolvedValue({ properties: { Name: { type: 'title' } } });
    uploadToNotion.mockRejectedValue(new Error('upload limit'));
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);

    const res = await syncRecord({ apiKey: 'secret_x', databaseId: 'db1', profile: ngo, fields, image: Buffer.from('i') });
    expect(pagesCreate.mock.calls[0][0].parent).toEqual({ database_id: 'db1' });
    expect(res.attachmentNotes).toEqual(['notion_image_not_attached']);
  });

  it('throws when Notion is not connected, and propagates API errors', async () => {
    await expect(syncRecord({ profile: ngo, fields })).rejects.toThrow('not connected');
    databasesRetrieve.mockRejectedValue(new Error('Could not find database'));
    await expect(syncRecord({ apiKey: 'k', databaseId: 'd', profile: ngo, fields })).rejects.toThrow('Could not find database');
  });

  it('resolveNotionTarget never sends one user\'s records to a shared server database', () => {
    expect(resolveNotionTarget({})).toBeNull();
    process.env.NOTION_API_KEY = 'k';
    process.env.NOTION_DATABASE_ID = 'd';
    expect(resolveNotionTarget({})).toBeNull();
    expect(resolveNotionTarget({ apiKey: 'u', databaseId: 'v' })).toEqual({ apiKey: 'u', databaseId: 'v' });
    // Single-tenant deployments may opt in, but only for users who saved nothing, and never mixed.
    process.env.SINGLE_TENANT = 'true';
    expect(resolveNotionTarget({})).toEqual({ apiKey: 'k', databaseId: 'd' });
    expect(resolveNotionTarget({ apiKey: 'u' })).toBeNull();
    expect(resolveNotionTarget({ databaseId: 'v' })).toBeNull();
    expect(notionHealth().configured).toBe(true);
  });

  it('keeps both values when two fields share a label', async () => {
    databasesRetrieve.mockResolvedValue({ properties: { Name: { type: 'title' } } });
    await syncRecord({
      apiKey: 'secret_x', databaseId: 'db1', profile: ngo,
      fields: [{ key: 'amount', label: 'Amount', value: '100' }, { key: 'amount2', label: 'Amount', value: '250' }],
    });
    const code = pagesCreate.mock.calls[0][0].children.find((c: { type: string }) => c.type === 'code');
    const raw = JSON.parse(code.code.rich_text.map((r: { text: { content: string } }) => r.text.content).join(''));
    expect(raw).toEqual({ Amount: '100', 'Amount (amount2)': '250' });
  });
});

describe('createDatabaseForUser', () => {
  beforeEach(() => { global.fetch = jest.fn(); });

  it('creates a database with every property the profiles write', async () => {
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ results: [{ id: 'page1' }] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'newdb' }) });
    await expect(createDatabaseForUser('tok')).resolves.toBe('newdb');
    const body = JSON.parse((global.fetch as jest.Mock).mock.calls[1][1].body);
    expect(body.parent).toEqual({ type: 'page_id', page_id: 'page1' });
    expect(Object.keys(body.properties)).toEqual(expect.arrayContaining(['Name', 'Profile', 'Date', 'Scanned At', 'Notes', 'Amount', 'PAN', 'Gross Weight', 'Tare Weight', 'Net Weight']));
    expect(body.properties.Amount).toEqual({ number: { format: 'number' } });
  });

  it('returns null when no page was shared or creation fails', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: true, json: async () => ({ results: [] }) });
    await expect(createDatabaseForUser('tok')).resolves.toBeNull();
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ results: [{ id: 'p' }] }) })
      .mockResolvedValueOnce({ ok: false, status: 400, json: async () => ({ message: 'bad' }) });
    await expect(createDatabaseForUser('tok')).resolves.toBeNull();
  });
});
