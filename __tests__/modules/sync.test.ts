import { resetBreakers } from '@/core/isolation';
import { getProfile } from '@/modules/profiles';
import { failedDestinations, syncDocument, type SyncDeps, type SyncInput } from '@/modules/sync';

/**
 * These tests are the contract for "a problem in one module doesn't take down the others":
 * each destination can fail, hang or be switched off while the rest still complete.
 */

function deps(overrides: Partial<{ [K in keyof SyncDeps]: Partial<SyncDeps[K]> }> = {}): SyncDeps {
  return {
    sheets: {
      findDuplicates: jest.fn(async () => null),
      appendRecord: jest.fn(async () => ({ spreadsheetId: 'S', spreadsheetUrl: 'https://sheet', action: 'append' as const, rows: 1 })),
      ...overrides.sheets,
    },
    notion: {
      resolveNotionTarget: jest.fn(() => ({ apiKey: 'k', databaseId: 'd' })),
      syncRecord: jest.fn(async () => ({ url: 'https://notion/page', attachmentNotes: [] })),
      ...overrides.notion,
    },
    media: {
      prepareArchiveImage: jest.fn(async (b: Buffer) => b),
      storeMedia: jest.fn(async () => ({ imageUrl: 'https://drive/img', audioUrl: 'https://drive/aud', notes: [] })),
      ...overrides.media,
    },
  } as SyncDeps;
}

const base = (): SyncInput => ({
  profile: getProfile('factory-weight-slip')!,
  fields: [
    { key: 'vehicleNumber', label: 'Vehicle Number', value: 'MH-12' },
    { key: 'grossWeight', label: 'Gross Weight', value: '1500' },
    { key: 'tareWeight', label: 'Tare Weight', value: '500' },
  ],
  note: 'checked',
  document: Buffer.from('img'),
  audio: Buffer.from('aud'),
  caller: { accessToken: 't' },
  notion: { apiKey: 'k', databaseId: 'd' },
  uploadDest: 'both',
});

describe('modules/sync — fault isolation', () => {
  beforeEach(() => {
    resetBreakers();
    ['MODULE_NOTION', 'MODULE_MEDIA', 'MODULE_SHEETS'].forEach(k => delete process.env[k]);
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  it('happy path: every destination succeeds and derived fields reach Sheets', async () => {
    const d = deps();
    const report = await syncDocument(base(), d);
    expect(failedDestinations(report)).toEqual([]);
    expect(report.imageLink).toBe('https://notion/page');
    const append = (d.sheets.appendRecord as jest.Mock).mock.calls[0][0];
    expect(append.fields.find((f: { key: string }) => f.key === 'netWeight').value).toBe('1000');
    expect(append.meta).toMatchObject({ imageLink: 'https://notion/page', voiceNoteLink: 'https://drive/aud', syncStatus: 'Success', notes: 'checked' });
  });

  it('Notion failing does not stop Sheets or media', async () => {
    const d = deps({ notion: { syncRecord: jest.fn(async () => { throw new Error('Notion 502'); }) } });
    const report = await syncDocument(base(), d);
    expect(report.destinations.notion).toMatchObject({ status: 'failed', error: 'Notion 502' });
    expect(report.destinations.sheets.status).toBe('ok');
    expect(report.destinations.media.status).toBe('ok');
    const append = (d.sheets.appendRecord as jest.Mock).mock.calls[0][0];
    expect(append.meta.imageLink).toBe('https://drive/img'); // falls back to the Drive link
    expect(append.meta.syncStatus).toBe('Partial (Notion failed)');
  });

  it('media failing does not stop Sheets or Notion', async () => {
    const d = deps({ media: { storeMedia: jest.fn(async () => { throw new Error('Drive quota'); }) } });
    const report = await syncDocument(base(), d);
    expect(failedDestinations(report)).toEqual(['media']);
    expect(report.destinations.notion.status).toBe('ok');
    expect(report.destinations.sheets.status).toBe('ok');
  });

  it('Sheets failing still leaves Notion and media done, and is reported', async () => {
    const d = deps({ sheets: { appendRecord: jest.fn(async () => { throw new Error('Sheets 500'); }) } });
    const report = await syncDocument(base(), d);
    expect(failedDestinations(report)).toEqual(['sheets']);
    expect(report.destinations.notion.status).toBe('ok');
  });

  it('a hanging destination is cut off by its timeout', async () => {
    jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick'] });
    try {
      const d = deps({ notion: { syncRecord: jest.fn(() => new Promise(() => undefined)) as never } });
      const pending = syncDocument(base(), d);
      await jest.advanceTimersByTimeAsync(26_000);
      const report = await pending;
      expect(report.destinations.notion).toMatchObject({ status: 'failed' });
      expect(report.destinations.sheets.status).toBe('ok');
    } finally {
      jest.useRealTimers();
    }
  });

  it('a module switched off with MODULE_<NAME>=off is skipped, the rest still run', async () => {
    process.env.MODULE_NOTION = 'off';
    const d = deps();
    const report = await syncDocument(base(), d);
    expect(report.destinations.notion.status).toBe('skipped');
    expect(d.notion.syncRecord).not.toHaveBeenCalled();
    expect(report.destinations.sheets.status).toBe('ok');
  });

  it('a crashing archive-image step only produces a warning', async () => {
    const d = deps({ media: { prepareArchiveImage: jest.fn(async () => { throw new Error('sharp'); }) } });
    const report = await syncDocument(base(), d);
    expect(report.warnings[0]).toMatch(/could not be processed/);
    expect(report.destinations.sheets.status).toBe('ok');
  });

  it('duplicates are detected before anything is written', async () => {
    const d = deps({ sheets: { findDuplicates: jest.fn(async () => ({ count: 1, label: 'Vehicle Number', value: 'MH-12' })) } });
    const report = await syncDocument({ ...base(), primaryKey: 'vehicleNumber' }, d);
    expect(report.duplicate).toEqual({ count: 1, label: 'Vehicle Number', value: 'MH-12' });
    expect(d.notion.syncRecord).not.toHaveBeenCalled();
    expect(d.media.storeMedia).not.toHaveBeenCalled();
    expect(d.sheets.appendRecord).not.toHaveBeenCalled();
  });

  it('a failing duplicate check warns but does not block the sync', async () => {
    const d = deps({ sheets: { findDuplicates: jest.fn(async () => { throw new Error('read failed'); }) } });
    const report = await syncDocument({ ...base(), primaryKey: 'vehicleNumber' }, d);
    expect(report.warnings[0]).toMatch(/Duplicate check was unavailable/);
    expect(report.destinations.sheets.status).toBe('ok');
  });

  it('routes media by destination: Notion-only keeps files out of Drive; Drive-only skips Notion', async () => {
    let d = deps();
    await syncDocument({ ...base(), uploadDest: 'notion' }, d);
    expect(d.media.storeMedia).not.toHaveBeenCalled();

    d = deps();
    const report = await syncDocument({ ...base(), uploadDest: 'gdrive' }, d);
    expect(d.notion.syncRecord).not.toHaveBeenCalled();
    expect(report.destinations.notion).toMatchObject({ status: 'skipped' });
    expect((d.media.storeMedia as jest.Mock).mock.calls[0][0].image).toBeTruthy();
  });

  it('with Notion not connected, Drive receives the files even for "notion" destination', async () => {
    const d = deps({ notion: { resolveNotionTarget: jest.fn(() => null) } });
    await syncDocument({ ...base(), uploadDest: 'notion' }, d);
    expect(d.media.storeMedia).toHaveBeenCalled();
  });

  it('reports why a destination was skipped with a machine-readable code', async () => {
    const notConnected = await syncDocument({ ...base(), document: null, audio: null }, deps({ notion: { resolveNotionTarget: jest.fn(() => null) } }));
    expect(notConnected.destinations.notion).toMatchObject({ status: 'skipped', code: 'not_connected' });
    expect(notConnected.destinations.media).toMatchObject({ status: 'skipped', code: 'nothing_to_store' });

    const driveOnly = await syncDocument({ ...base(), uploadDest: 'gdrive' }, deps());
    expect(driveOnly.destinations.notion).toMatchObject({ status: 'skipped', code: 'not_selected' });

    const dup = await syncDocument({ ...base(), primaryKey: 'vehicleNumber' }, deps({ sheets: { findDuplicates: jest.fn(async () => ({ count: 1, label: 'Vehicle', value: 'MH-12' })) } }));
    expect(dup.destinations.sheets).toMatchObject({ status: 'skipped', code: 'duplicate' });
  });

  it('a retry (`only`) runs just the listed destinations and skips the duplicate check without Sheets', async () => {
    const d = deps();
    const report = await syncDocument({ ...base(), primaryKey: 'vehicleNumber', only: ['notion'] }, d);
    expect(report.destinations.notion.status).toBe('ok');
    expect(report.destinations.sheets).toMatchObject({ status: 'skipped', code: 'not_retried' });
    expect(report.destinations.media).toMatchObject({ status: 'skipped', code: 'not_retried' });
    expect(d.sheets.findDuplicates).not.toHaveBeenCalled();
    expect(d.sheets.appendRecord).not.toHaveBeenCalled();
    expect(d.media.storeMedia).not.toHaveBeenCalled();

    const sheetsOnly = deps();
    await syncDocument({ ...base(), primaryKey: 'vehicleNumber', only: ['sheets'] }, sheetsOnly);
    expect(sheetsOnly.sheets.findDuplicates).toHaveBeenCalled();
    expect(sheetsOnly.media.prepareArchiveImage).not.toHaveBeenCalled();
    expect(sheetsOnly.notion.syncRecord).not.toHaveBeenCalled();

    const all = deps();
    await syncDocument({ ...base(), only: [] }, all);
    expect(all.notion.syncRecord).toHaveBeenCalled();
    expect(all.sheets.appendRecord).toHaveBeenCalled();
  });
});
