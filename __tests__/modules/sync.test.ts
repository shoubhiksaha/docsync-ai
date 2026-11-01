import { BREAKER_THRESHOLD, CallerError, resetBreakers } from '@/core/isolation';
import { activeProfiles, getProfile } from '@/modules/profiles';
import { failedDestinations, istTimestamp, syncDocument, type SyncDeps, type SyncInput } from '@/modules/sync';

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
      // Notion is told to stop, so the page it was about to create never appears after the timeout.
      expect((d.notion.syncRecord as jest.Mock).mock.calls[0][0].signal.aborted).toBe(true);
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
    expect(report.warnings).toEqual(['image_not_processed']);
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
    expect(report.warnings).toEqual(['duplicate_check_unavailable']);
    expect(report.destinations.sheets.status).toBe('ok');
  });

  it('a paused or switched-off Sheets is a failed save the user can retry, never "saved"', async () => {
    process.env.MODULE_SHEETS = 'off';
    const off = await syncDocument({ ...base(), primaryKey: 'vehicleNumber' }, deps());
    expect(off.destinations.sheets).toMatchObject({ status: 'failed', code: 'disabled' });
    expect(failedDestinations(off)).toEqual(['sheets']);
    expect(off.warnings).toContain('duplicate_check_unavailable');
    delete process.env.MODULE_SHEETS;

    const broken = deps({ sheets: { appendRecord: jest.fn(async () => { throw new Error('Sheets 503'); }) } });
    for (let i = 0; i < BREAKER_THRESHOLD; i++) await syncDocument(base(), broken);
    const paused = await syncDocument(base(), deps());
    expect(paused.destinations.sheets).toMatchObject({ status: 'failed', code: 'paused' });
  });

  it("one user's own Sheets errors never pause Sheets for everyone else", async () => {
    const expired = deps({ sheets: { appendRecord: jest.fn(async () => { throw new CallerError('Your Google session has expired.'); }) } });
    const deleted = deps({ sheets: { appendRecord: jest.fn(async () => { throw Object.assign(new Error('Requested entity was not found.'), { status: 404 }); }) } });
    for (let i = 0; i < BREAKER_THRESHOLD; i++) {
      expect((await syncDocument(base(), expired)).destinations.sheets.status).toBe('failed');
      expect((await syncDocument(base(), deleted)).destinations.sheets.status).toBe('failed');
    }
    expect((await syncDocument(base(), deps())).destinations.sheets.status).toBe('ok');
  });

  it('passes an abort signal to the Sheets write and stamps Synced At in IST', async () => {
    const d = deps();
    await syncDocument(base(), d);
    const append = (d.sheets.appendRecord as jest.Mock).mock.calls[0][0];
    expect(append.signal).toBeInstanceOf(AbortSignal);
    expect(append.meta.syncedAt).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
    expect(istTimestamp(new Date('2026-11-01T20:00:00Z'))).toBe('2026-11-02 01:30');
  });

  it.each(activeProfiles().map(p => p.id))('never sends a full Aadhaar number to any destination (%s)', async id => {
    const d = deps();
    await syncDocument({
      ...base(),
      profile: getProfile(id)!,
      fields: [
        { key: 'idProof', label: 'ID Proof', value: '1234 5678 9012' },
        { key: 'aadhaarNo', label: 'Aadhaar No', value: '123456789012' },
        { key: 'remarks', label: 'Remarks', value: 'Aadhaar 2345-6789-0123 seen' },
        { key: 'mobile', label: 'Mobile', value: '+919876543210' },
      ],
      note: 'customer aadhaar 3456 7890 1234',
    }, d);
    const sheets = JSON.stringify((d.sheets.appendRecord as jest.Mock).mock.calls[0][0]);
    const notion = JSON.stringify((d.notion.syncRecord as jest.Mock).mock.calls[0][0]);
    for (const sent of [sheets, notion]) {
      expect(sent).not.toMatch(/1234\D?5678\D?9012|2345\D?6789\D?0123|3456\D?7890\D?1234/);
      expect(sent).toContain('XXXX XXXX 9012');
      expect(sent).toContain('+919876543210');
    }
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
