const getToken = jest.fn();
jest.mock('next-auth/jwt', () => ({ getToken: (...a: unknown[]) => getToken(...a) }));

const docRef = { get: jest.fn(), set: jest.fn(), delete: jest.fn() };
const db = { collection: jest.fn(() => ({ doc: jest.fn(() => docRef) })) };
let dbAvailable = true;
let firestore: 'ok' | 'unreachable' = 'ok';
const reportFirestore = jest.fn();
jest.mock('@/modules/settings/firestore', () => ({
  firestoreForRequest: () => (dbAvailable ? db : null),
  firestoreState: async () => (dbAvailable ? firestore : 'not_configured'),
  reportFirestore: (...a: unknown[]) => reportFirestore(...a),
}));

import { NextRequest, NextResponse } from 'next/server';
import { decrypt, encrypt } from '@/core/crypto';
import { generateAndWrapDEK, unwrapAndDecryptDEK } from '@/core/envelope';
import {
  checkAiKey, loadAllProfilePrefs, loadProfilePrefs, loadSettings, maskKey, parseUploadDest, sanitizePrefs, saveProfilePrefs, saveSettings, settingsHealth, settingsStatus,
} from '@/modules/settings';

function req(cookies: Record<string, string> = {}) {
  const cookie = Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; ');
  return new NextRequest('http://localhost/api/settings', { headers: cookie ? { cookie } : {} });
}

describe('modules/settings', () => {
  const saved = { ...process.env };
  beforeEach(() => {
    jest.clearAllMocks();
    docRef.get.mockReset().mockResolvedValue({ exists: false });
    docRef.set.mockReset().mockResolvedValue(undefined);
    docRef.delete.mockReset().mockResolvedValue(undefined);
    process.env = { ...saved, ENCRYPTION_KEY: 'c'.repeat(64) };
    dbAvailable = true;
    firestore = 'ok';
    getToken.mockResolvedValue({ email: 'u@example.com' });
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });
  afterAll(() => { process.env = saved; });

  it('reads everything from cookies while sync is off (no cloud copy)', async () => {
    const r = req({ docsync_openai: encrypt('sk-a'), docsync_notion: encrypt('n'), docsync_notion_db: encrypt('d'), docsync_upload_dest: 'gdrive' });
    await expect(loadSettings(r)).resolves.toEqual({ openaiKey: 'sk-a', notionKey: 'n', notionDbId: 'd', uploadDest: 'gdrive' });
    dbAvailable = false;
    await expect(loadSettings(r)).resolves.toEqual({ openaiKey: 'sk-a', notionKey: 'n', notionDbId: 'd', uploadDest: 'gdrive' });
  });

  describe('a change made on another device', () => {
    const changed = (res: NextResponse) => res.cookies.get('docsync_changed')!.value;

    it('removing or replacing a key on device A reaches device B, whose cookie still has the old key', async () => {
      // Device A removes its key and replaces the Notion connection while sync is on.
      docRef.get.mockResolvedValue({ exists: true, data: () => ({}) });
      await saveSettings(req({ docsync_persistent: 'true' }), NextResponse.json({}), { openaiKey: '', notionKey: 'ntn_new', notionDbId: 'db-new' });
      const [written] = docRef.set.mock.calls[0];
      expect(written.openaiKey).toBeNull();
      expect(written.changedAt).toEqual({ openaiKey: expect.any(Number), notionKey: expect.any(Number), notionDbId: expect.any(Number) });

      // Device B saved its values earlier and still has them in its cookies.
      docRef.get.mockResolvedValue({ exists: true, data: () => written });
      const legacy = { docsync_openai: encrypt('gsk_leakedKey1234'), docsync_notion: encrypt('ntn_old'), docsync_notion_db: encrypt('db-old') };
      const deviceB = { ...legacy, docsync_changed: encrypt(JSON.stringify({ openaiKey: written.changedAt.openaiKey - 60_000 })) };
      await expect(loadSettings(req(deviceB))).resolves.toMatchObject({ openaiKey: undefined, notionKey: 'ntn_new', notionDbId: 'db-new' });
      await expect(settingsStatus(req(deviceB))).resolves.toMatchObject({ hasOpenAiKey: false, aiKeyHint: null, hasNotionKey: true });
      // The same with cookies from before change times were kept.
      await expect(loadSettings(req(legacy))).resolves.toMatchObject({ openaiKey: undefined, notionKey: 'ntn_new' });
    });

    it("this device's own newer change wins, e.g. when its cloud write failed", async () => {
      docRef.get.mockResolvedValue({ exists: true, data: () => ({ openaiKey: generateAndWrapDEK('gsk_cloudOld0000'), changedAt: { openaiKey: 1000 } }) });
      docRef.set.mockRejectedValue(new Error('denied'));
      const res = NextResponse.json({});
      await expect(saveSettings(req({ docsync_persistent: 'true' }), res, { openaiKey: 'gsk_localNew1111' })).resolves.toEqual({ persisted: 'failed' });
      const here = req({ docsync_openai: res.cookies.get('docsync_openai')!.value, docsync_changed: changed(res) });
      await expect(loadSettings(here)).resolves.toMatchObject({ openaiKey: 'gsk_localNew1111' });
      await expect(settingsStatus(here)).resolves.toMatchObject({ aiKeyHint: 'gsk_…1111' });
    });

    it('a value the cloud copy never had stays as this device has it', async () => {
      docRef.get.mockResolvedValue({ exists: true, data: () => ({ uploadDest: 'both' }) });
      await expect(loadSettings(req({ docsync_openai: encrypt('sk-a'), docsync_upload_dest: 'gdrive' }))).resolves.toMatchObject({ openaiKey: 'sk-a', uploadDest: 'both' });
    });

    it('forgetting remembered fields on device A reaches device B', async () => {
      const deviceB = NextResponse.json({});
      await saveProfilePrefs(req(), deviceB, 'ngo-receipt', { fields: [{ key: 'amount', label: 'Amount' }] });
      const cookies = { docsync_prefs: deviceB.cookies.get('docsync_prefs')!.value, docsync_changed: changed(deviceB) };
      const at = JSON.parse(decrypt(cookies.docsync_changed)!)['prefs:ngo-receipt'];

      docRef.get.mockResolvedValue({ exists: true, data: () => ({ profilePrefs: { 'ngo-receipt': { fields: null, primaryKey: null } }, changedAt: { 'prefs:ngo-receipt': at + 1 } }) });
      await expect(loadProfilePrefs(req(cookies), 'ngo-receipt')).resolves.toEqual({ fields: null, primaryKey: null });
      // Until then this device's own copy is used.
      docRef.get.mockResolvedValue({ exists: true, data: () => ({ profilePrefs: { 'ngo-receipt': { fields: null, primaryKey: null } }, changedAt: { 'prefs:ngo-receipt': at - 1 } }) });
      await expect(loadProfilePrefs(req(cookies), 'ngo-receipt')).resolves.toEqual({ fields: [{ key: 'amount', label: 'Amount' }], primaryKey: null });
    });
  });

  it('fills missing values from Firestore (envelope-encrypted)', async () => {
    docRef.get.mockResolvedValue({ exists: true, data: () => ({ notionKey: generateAndWrapDEK('n-fs'), uploadDest: 'notion' }) });
    const s = await loadSettings(req({ docsync_openai: encrypt('sk-a') }));
    expect(s).toEqual({ openaiKey: 'sk-a', notionKey: 'n-fs', notionDbId: undefined, uploadDest: 'notion' });
  });

  it('degrades to cookie-only settings when Firestore fails or holds bad data', async () => {
    docRef.get.mockRejectedValue(new Error('firestore down'));
    await expect(loadSettings(req())).resolves.toMatchObject({ uploadDest: 'both' });
    expect(reportFirestore).toHaveBeenLastCalledWith(false, expect.any(Error));
    docRef.get.mockResolvedValue({ exists: true, data: () => ({ openaiKey: { junk: true } }) });
    await expect(loadSettings(req())).resolves.toMatchObject({ openaiKey: undefined });
    dbAvailable = false;
    await expect(loadSettings(req())).resolves.toMatchObject({ uploadDest: 'both' });
  });

  it('saves encrypted cookies and mirrors to Firestore in persistent mode', async () => {
    const res = NextResponse.json({});
    const out = await saveSettings(req(), res, { openaiKey: ' sk-new ', notionKey: '', uploadDest: 'weird', persistent: true });
    expect(out.persisted).toBe(true);
    expect(res.cookies.get('docsync_openai')?.value).toMatch(/^v2\./);
    expect(res.cookies.get('docsync_openai')?.httpOnly).toBe(true);
    expect(res.cookies.get('docsync_upload_dest')?.value).toBe('both');
    const written = docRef.set.mock.calls[0][0];
    expect(written.openaiKey.encryptedKey).toBeDefined();
    expect(written.notionKey).toBeNull();
  });

  it('turning persistence off deletes the Firestore copy', async () => {
    await saveSettings(req(), NextResponse.json({}), { persistent: false });
    expect(docRef.delete).toHaveBeenCalled();
  });

  it('turning sync on uploads the key, Notion connection, upload choice and prefs already on this device', async () => {
    const prefs = NextResponse.json({});
    await saveProfilePrefs(req(), prefs, 'ngo-receipt', { primaryKey: 'amount' });
    docRef.set.mockClear();

    const out = await saveSettings(req({
      docsync_openai: encrypt('gsk_cookieKey1234'), docsync_notion: encrypt('ntn_tok'), docsync_notion_db: encrypt('db-1'),
      docsync_upload_dest: 'gdrive', docsync_prefs: prefs.cookies.get('docsync_prefs')!.value,
    }), NextResponse.json({}), { persistent: true });
    expect(out.persisted).toBe(true);
    const [written, opts] = docRef.set.mock.calls[0];
    expect(opts).toEqual({ merge: true });
    expect(unwrapAndDecryptDEK(written.openaiKey)).toBe('gsk_cookieKey1234');
    expect(unwrapAndDecryptDEK(written.notionKey)).toBe('ntn_tok');
    expect(unwrapAndDecryptDEK(written.notionDbId)).toBe('db-1');
    expect(written.uploadDest).toBe('gdrive');
    expect(written.profilePrefs).toEqual({ 'ngo-receipt': { fields: null, primaryKey: 'amount' } });
    expect(Object.keys(written.changedAt).sort()).toEqual(['notionDbId', 'notionKey', 'openaiKey', 'prefs:ngo-receipt', 'uploadDest']);

    // Even with nothing saved yet, the account's doc is created so other devices see sync as on.
    docRef.set.mockClear();
    await saveSettings(req(), NextResponse.json({}), { persistent: true });
    expect(docRef.set).toHaveBeenCalledWith({ uploadDest: 'both', changedAt: { uploadDest: expect.any(Number) } }, { merge: true });
  });

  it('on a device where sync was turned on elsewhere, changes and removals reach Firestore', async () => {
    docRef.get.mockResolvedValue({ exists: true, data: () => ({ openaiKey: generateAndWrapDEK('sk-cloud') }) });
    const res = NextResponse.json({});
    await expect(saveSettings(req(), res, { openaiKey: '' })).resolves.toEqual({ persisted: true });
    expect(docRef.set).toHaveBeenCalledWith({ openaiKey: null, changedAt: { openaiKey: expect.any(Number) } }, { merge: true });
    expect(res.cookies.get('docsync_persistent')?.value).toBe('true');

    docRef.set.mockClear();
    await saveSettings(req(), NextResponse.json({}), { uploadDest: 'notion' });
    expect(docRef.set).toHaveBeenCalledWith({ uploadDest: 'notion', changedAt: { uploadDest: expect.any(Number) } }, { merge: true });

    // OAuth callbacks set lax cookies.
    const lax = NextResponse.json({});
    await saveSettings(req(), lax, { notionKey: 'tok' }, { sameSite: 'lax' });
    expect(lax.cookies.get('docsync_notion')?.sameSite).toBe('lax');
  });

  it('turning sync off keeps on this device what it was using before deleting the cloud copy', async () => {
    docRef.get.mockResolvedValue({
      exists: true,
      data: () => ({
        openaiKey: generateAndWrapDEK('sk-cloud'), notionKey: generateAndWrapDEK('n-cloud'), notionDbId: null, uploadDest: 'gdrive',
        profilePrefs: { 'ngo-receipt': { fields: [{ key: 'a', label: 'A' }], primaryKey: null }, nope: { fields: null } },
        changedAt: { notionKey: 1000 },
      }),
    });
    const res = NextResponse.json({});
    const here = { docsync_notion: encrypt('n-local'), docsync_notion_db: encrypt('db-stale'), docsync_changed: encrypt(JSON.stringify({ notionKey: 2000 })) };
    await saveSettings(req(here), res, { persistent: false });
    expect(docRef.delete).toHaveBeenCalled();
    expect(decrypt(res.cookies.get('docsync_openai')!.value)).toBe('sk-cloud');
    expect(res.cookies.get('docsync_notion')).toBeUndefined(); // changed here more recently: this device's own value stays
    expect(res.cookies.get('docsync_notion_db')?.value).toBe(''); // removed on another device
    expect(res.cookies.get('docsync_upload_dest')?.value).toBe('gdrive');
    expect(res.cookies.get('docsync_persistent')?.value).toBe('false');
    const back = req({ docsync_prefs: res.cookies.get('docsync_prefs')!.value });
    await expect(loadProfilePrefs(back, 'ngo-receipt')).resolves.toEqual({ fields: [{ key: 'a', label: 'A' }], primaryKey: null });
  });

  it('reports a failed cloud write without failing the save', async () => {
    docRef.set.mockRejectedValue(new Error('denied'));
    const res = NextResponse.json({});
    await expect(saveSettings(req(), res, { openaiKey: 'k', persistent: true })).resolves.toEqual({ persisted: 'failed' });
    expect(res.cookies.get('docsync_openai')).toBeDefined();
  });

  it('settingsStatus merges cookie flags with Firestore and only reveals a masked key', async () => {
    docRef.get.mockResolvedValue({ exists: true, data: () => ({ notionKey: {}, uploadDest: 'gdrive' }) });
    const status = await settingsStatus(req({ docsync_openai: encrypt('gsk_abcdefghijklmnop1234') }), { classifyKey: k => (k.startsWith('gsk_') ? 'groq' : 'other') });
    expect(status).toEqual({
      hasOpenAiKey: true, hasNotionKey: true, hasNotionDbId: false, uploadDest: 'gdrive', isPersistent: true, syncAvailable: true,
      syncState: 'ok', sheets: [], aiKeyHint: 'gsk_…1234', aiProvider: 'groq',
    });
    expect(JSON.stringify(status)).not.toContain('abcdefghijklmnop');
  });

  it('settingsStatus reads the key hint from Firestore, ignores undecryptable cookies and survives a bad classifier', async () => {
    docRef.get.mockResolvedValue({ exists: true, data: () => ({ openaiKey: generateAndWrapDEK('AIzaSyFirestoreKey9876') }) });
    const status = await settingsStatus(req({ docsync_openai: 'garbage' }), { classifyKey: () => { throw new Error('boom'); } });
    expect(status).toMatchObject({ hasOpenAiKey: true, aiKeyHint: 'AIza…9876', aiProvider: null });

    dbAvailable = false;
    await expect(settingsStatus(req({ docsync_openai: 'garbage', docsync_persistent: 'true' }))).resolves.toMatchObject({
      hasOpenAiKey: false, aiKeyHint: null, aiProvider: null, isPersistent: false, syncAvailable: false,
    });
  });

  it('settingsStatus tolerates a Firestore outage and stops claiming cross-device sync', async () => {
    docRef.get.mockRejectedValue(new Error('down'));
    await expect(settingsStatus(req({ docsync_persistent: 'true' }))).resolves.toMatchObject({
      hasOpenAiKey: false, aiKeyHint: null, isPersistent: false, syncAvailable: false,
    });
    expect(reportFirestore).toHaveBeenLastCalledWith(false, expect.any(Error));
  });

  it('settingsStatus: persistence chosen on this device counts only while Firestore answers', async () => {
    docRef.get.mockResolvedValue({ exists: false });
    await expect(settingsStatus(req({ docsync_persistent: 'true' }))).resolves.toMatchObject({ isPersistent: true, syncAvailable: true });

    firestore = 'unreachable';
    jest.clearAllMocks();
    await expect(settingsStatus(req({ docsync_persistent: 'true' }))).resolves.toMatchObject({ isPersistent: false, syncAvailable: false });
    expect(docRef.get).not.toHaveBeenCalled();
  });

  it('settingsStatus shows sync as on when another device turned it on, even with every value in cookies', async () => {
    const all = { docsync_openai: encrypt('sk-a'), docsync_notion: encrypt('n'), docsync_notion_db: encrypt('d') };
    docRef.get.mockResolvedValue({ exists: true, data: () => ({ uploadDest: 'both' }) });
    await expect(settingsStatus(req(all))).resolves.toMatchObject({ isPersistent: true, hasOpenAiKey: true, hasNotionKey: true });
  });

  it('settingsStatus tells a server without Firestore from one that is down, and lists the sheets this device saved to', async () => {
    dbAvailable = false;
    const sheets = { docsync_sheet_ngo_receipt: '1AbCdEfGhIjKlMnOp', docsync_sheet_lorry_receipt: 'bad id!', docsync_sheet_nope: '1AbCdEfGhIjKlMnOp' };
    await expect(settingsStatus(req(sheets))).resolves.toMatchObject({
      syncState: 'not_configured', syncAvailable: false,
      sheets: [{ profileId: 'ngo-receipt', url: 'https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOp/edit' }],
    });
    dbAvailable = true;
    firestore = 'unreachable';
    await expect(settingsStatus(req())).resolves.toMatchObject({ syncState: 'unreachable', syncAvailable: false });
  });

  it('maskKey never shows more than the edges of a key', () => {
    expect(maskKey('sk-ant-0123456789abcd')).toBe('sk-a…abcd');
    expect(maskKey(' short-key ')).toBe('…ey');
  });

  it('a partial update keeps the current persistence mode and still mirrors to Firestore', async () => {
    const res = NextResponse.json({});
    const out = await saveSettings(req({ docsync_persistent: 'true' }), res, { uploadDest: 'notion' });
    expect(res.cookies.get('docsync_persistent')).toBeUndefined();
    expect(out.persisted).toBe(true);
    expect(docRef.set).toHaveBeenCalledWith({ uploadDest: 'notion', changedAt: { uploadDest: expect.any(Number) } }, { merge: true });
    expect(docRef.delete).not.toHaveBeenCalled();

    jest.clearAllMocks();
    await expect(saveSettings(req(), NextResponse.json({}), { uploadDest: 'gdrive' })).resolves.toEqual({ persisted: false });
    expect(docRef.set).not.toHaveBeenCalled();
  });

  describe('profile preferences', () => {
    const prefsCookie = (res: NextResponse) => res.cookies.get('docsync_prefs')?.value ?? '';

    it('defaults when nothing is saved, and unknown profiles always get defaults', async () => {
      docRef.get.mockResolvedValue({ exists: false });
      await expect(loadProfilePrefs(req(), 'ngo-receipt')).resolves.toEqual({ fields: null, primaryKey: null });
      await expect(loadProfilePrefs(req(), 'nope')).resolves.toEqual({ fields: null, primaryKey: null });
      await expect(saveProfilePrefs(req(), NextResponse.json({}), 'nope', {})).rejects.toThrow('Unknown profile');
    });

    it('saves to an encrypted cookie that a later request reads back, merging partial updates', async () => {
      const res = NextResponse.json({});
      const saved = await saveProfilePrefs(req(), res, 'ngo-receipt', { fields: [{ key: 'amount', label: 'Amount' }, { key: 'x', label: '' }] });
      expect(saved).toEqual({ fields: [{ key: 'amount', label: 'Amount' }, { key: 'x', label: 'x' }], primaryKey: null });
      expect(res.cookies.get('docsync_prefs')?.httpOnly).toBe(true);
      expect(prefsCookie(res)).not.toContain('Amount');
      expect(res.cookies.get('docsync_pk_ngo_receipt')?.value).toBe('');

      const next = req({ docsync_prefs: prefsCookie(res) });
      await expect(loadProfilePrefs(next, 'ngo-receipt')).resolves.toEqual(saved);

      const res2 = NextResponse.json({});
      await expect(saveProfilePrefs(next, res2, 'ngo-receipt', { primaryKey: '' })).resolves.toEqual({ ...saved, primaryKey: '' });
      await expect(loadProfilePrefs(req({ docsync_prefs: prefsCookie(res2) }), 'ngo-receipt')).resolves.toMatchObject({ primaryKey: '' });
      expect(docRef.set).not.toHaveBeenCalled(); // not in persistent mode
    });

    it('falls back to the legacy docsync_pk_* cookie, then Firestore wins over it', async () => {
      docRef.get.mockResolvedValue({ exists: false });
      await expect(loadProfilePrefs(req({ docsync_pk_ngo_receipt: encodeURIComponent('Receipt No') }), 'ngo-receipt'))
        .resolves.toEqual({ fields: null, primaryKey: 'Receipt No' });

      docRef.get.mockResolvedValue({ exists: true, data: () => ({ profilePrefs: { 'ngo-receipt': { fields: null, primaryKey: '' } } }) });
      await expect(loadProfilePrefs(req({ docsync_pk_ngo_receipt: 'old' }), 'ngo-receipt')).resolves.toEqual({ fields: null, primaryKey: '' });

      docRef.get.mockResolvedValue({ exists: true, data: () => ({ profilePrefs: { 'ngo-receipt': { fields: [{ key: 'a', label: 'A' }], primaryKey: 'a' } } }) });
      await expect(loadProfilePrefs(req({ docsync_pk_ngo_receipt: 'old' }), 'ngo-receipt')).resolves.toEqual({ fields: [{ key: 'a', label: 'A' }], primaryKey: 'a' });

      docRef.get.mockRejectedValue(new Error('down'));
      await expect(loadProfilePrefs(req(), 'ngo-receipt')).resolves.toEqual({ fields: null, primaryKey: null });
    });

    it('mirrors to Firestore in persistent mode and tolerates a failed write', async () => {
      docRef.get.mockResolvedValue({ exists: false });
      await saveProfilePrefs(req({ docsync_persistent: 'true' }), NextResponse.json({}), 'factory-weight-slip', { primaryKey: 'vehicleNumber' });
      expect(docRef.set).toHaveBeenCalledWith({
        profilePrefs: { 'factory-weight-slip': { fields: null, primaryKey: 'vehicleNumber' } },
        changedAt: { 'prefs:factory-weight-slip': expect.any(Number) },
      }, { merge: true });

      docRef.set.mockRejectedValue(new Error('denied'));
      const res = NextResponse.json({});
      await expect(saveProfilePrefs(req({ docsync_persistent: 'true' }), res, 'factory-weight-slip', { fields: [{ key: 'a', label: 'A' }] }))
        .resolves.toEqual({ fields: [{ key: 'a', label: 'A' }], primaryKey: null });
      expect(res.cookies.get('docsync_prefs')).toBeDefined();
    });

    it('mirrors to Firestore when sync was turned on from another device', async () => {
      docRef.get.mockResolvedValue({ exists: true, data: () => ({}) });
      await saveProfilePrefs(req(), NextResponse.json({}), 'ngo-receipt', { fields: null });
      expect(docRef.set).toHaveBeenCalledWith({
        profilePrefs: { 'ngo-receipt': { fields: null, primaryKey: null } },
        changedAt: { 'prefs:ngo-receipt': expect.any(Number) },
      }, { merge: true });
    });

    it("loads every profile at once: this device's newer change, else the cloud copy, else this device, else the legacy cookie", async () => {
      const res = NextResponse.json({});
      await saveProfilePrefs(req(), res, 'ngo-receipt', { fields: [{ key: 'amount', label: 'Amount' }] });
      const res2 = NextResponse.json({});
      await saveProfilePrefs(req({ docsync_prefs: res.cookies.get('docsync_prefs')!.value }), res2, 'muster-roll', { primaryKey: 'workerName' });
      docRef.get.mockClear().mockResolvedValue({
        exists: true,
        data: () => ({ profilePrefs: { 'ngo-receipt': { fields: null, primaryKey: '' }, 'factory-weight-slip': { fields: null, primaryKey: 'vehicleNumber' } } }),
      });
      const all = await loadAllProfilePrefs(req({
        docsync_prefs: res2.cookies.get('docsync_prefs')!.value, docsync_changed: res.cookies.get('docsync_changed')!.value, docsync_pk_lorry_receipt: 'lrNumber',
      }));
      expect(docRef.get).toHaveBeenCalledTimes(1);
      expect(all['ngo-receipt']).toEqual({ fields: [{ key: 'amount', label: 'Amount' }], primaryKey: null });
      expect(all['muster-roll']).toEqual({ fields: null, primaryKey: 'workerName' });
      expect(all['factory-weight-slip']).toEqual({ fields: null, primaryKey: 'vehicleNumber' });
      expect(all['lorry-receipt']).toEqual({ fields: null, primaryKey: 'lrNumber' });
      expect(Object.keys(all)).toHaveLength(28);

      docRef.get.mockRejectedValue(new Error('down'));
      await expect(loadAllProfilePrefs(req())).resolves.toMatchObject({ 'ngo-receipt': { fields: null, primaryKey: null } });
    });

    it('keeps the cookie under the size budget by trimming remembered fields', async () => {
      const many = (p: string) => Array.from({ length: 60 }, (_, i) => ({ key: `${p}${i}`.padEnd(100, 'k'), label: 'L'.repeat(150) }));
      const res = NextResponse.json({});
      await saveProfilePrefs(req(), res, 'ngo-receipt', { fields: many('a') });
      const res2 = NextResponse.json({});
      const saved = await saveProfilePrefs(req({ docsync_prefs: prefsCookie(res) }), res2, 'factory-weight-slip', { fields: many('b') });
      expect(saved.fields).toHaveLength(40);
      expect(saved.fields![0].label).toHaveLength(100);
      expect(prefsCookie(res2).length).toBeLessThanOrEqual(3500);
      const back = req({ docsync_prefs: prefsCookie(res2) });
      expect((await loadProfilePrefs(back, 'ngo-receipt')).fields!.length).toBeGreaterThan(0);
      expect((await loadProfilePrefs(back, 'factory-weight-slip')).fields!.length).toBeGreaterThan(0);
    });

    it('ignores tampered or foreign cookie content', async () => {
      docRef.get.mockResolvedValue({ exists: false });
      const tampered = encrypt(JSON.stringify({ 'ngo-receipt': { fields: 'nope', primaryKey: 7 }, other: { fields: [] } }));
      await expect(loadProfilePrefs(req({ docsync_prefs: tampered }), 'ngo-receipt')).resolves.toEqual({ fields: null, primaryKey: null });
      await expect(loadProfilePrefs(req({ docsync_prefs: encrypt('not json') }), 'ngo-receipt')).resolves.toEqual({ fields: null, primaryKey: null });
      expect(sanitizePrefs(null)).toEqual({ fields: null, primaryKey: null });
      expect(sanitizePrefs({ primaryKey: '' })).toEqual({ fields: null, primaryKey: '' });
      expect(sanitizePrefs({ fields: [null, { key: '' }, { key: 'k', label: 5 }] })).toEqual({ fields: [{ key: 'k', label: 'k' }], primaryKey: null });
    });
  });

  it('checkAiKey: only a clear "wrong key" answer counts as refused', async () => {
    const realFetch = global.fetch;
    const fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
    try {
      fetchMock.mockResolvedValueOnce({ ok: false, status: 400 });
      await expect(checkAiKey('AIzaBad', 'google')).resolves.toBe('refused');
      expect(fetchMock.mock.calls[0][1].headers).toEqual({ 'x-goog-api-key': 'AIzaBad' });
      fetchMock.mockResolvedValueOnce({ ok: false, status: 401 });
      await expect(checkAiKey('sk-ant-x', 'anthropic')).resolves.toBe('refused');
      fetchMock.mockResolvedValueOnce({ ok: false, status: 403 }); // a restricted OpenAI key may still read documents
      await expect(checkAiKey('sk-x', 'openai')).resolves.toBe('unchecked');
      fetchMock.mockResolvedValueOnce({ ok: false, status: 429 });
      await expect(checkAiKey('gsk_x', 'groq')).resolves.toBe('unchecked');
      await expect(checkAiKey('k', 'cohere')).resolves.toBe('unchecked');
    } finally {
      global.fetch = realFetch;
    }
  });

  it('parseUploadDest and health', () => {
    expect(parseUploadDest('notion')).toBe('notion');
    expect(parseUploadDest(undefined)).toBe('both');
  });

  it('health reports whether cross-device settings actually work', async () => {
    await expect(settingsHealth()).resolves.toMatchObject({ enabled: true, configured: true, persistent: true, persistence: 'ok', circuit: 'closed' });
    firestore = 'unreachable';
    await expect(settingsHealth()).resolves.toMatchObject({ persistent: false, persistence: 'unreachable', circuit: 'open' });
    dbAvailable = false;
    await expect(settingsHealth()).resolves.toMatchObject({ persistent: false, persistence: 'not_configured', circuit: 'closed' });
    process.env.MODULE_SETTINGS = 'off';
    await expect(settingsHealth()).resolves.toMatchObject({ enabled: false, persistence: 'not_configured' });
  });
});
