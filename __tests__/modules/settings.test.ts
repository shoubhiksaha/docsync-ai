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
import { encrypt } from '@/core/crypto';
import { generateAndWrapDEK } from '@/core/envelope';
import {
  loadProfilePrefs, loadSettings, maskKey, parseUploadDest, sanitizePrefs, saveProfilePrefs, saveSettings, settingsHealth, settingsStatus,
} from '@/modules/settings';

function req(cookies: Record<string, string> = {}) {
  const cookie = Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; ');
  return new NextRequest('http://localhost/api/settings', { headers: cookie ? { cookie } : {} });
}

describe('modules/settings', () => {
  const saved = { ...process.env };
  beforeEach(() => {
    jest.clearAllMocks();
    docRef.get.mockReset();
    docRef.set.mockReset().mockResolvedValue(undefined);
    docRef.delete.mockReset().mockResolvedValue(undefined);
    process.env = { ...saved, ENCRYPTION_KEY: 'c'.repeat(64) };
    dbAvailable = true;
    firestore = 'ok';
    getToken.mockResolvedValue({ email: 'u@example.com' });
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });
  afterAll(() => { process.env = saved; });

  it('reads everything from cookies without touching Firestore', async () => {
    const r = req({ docsync_openai: encrypt('sk-a'), docsync_notion: encrypt('n'), docsync_notion_db: encrypt('d'), docsync_upload_dest: 'gdrive' });
    await expect(loadSettings(r)).resolves.toEqual({ openaiKey: 'sk-a', notionKey: 'n', notionDbId: 'd', uploadDest: 'gdrive' });
    expect(db.collection).not.toHaveBeenCalled();
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
      aiKeyHint: 'gsk_…1234', aiProvider: 'groq',
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

  it('maskKey never shows more than the edges of a key', () => {
    expect(maskKey('sk-ant-0123456789abcd')).toBe('sk-a…abcd');
    expect(maskKey(' short-key ')).toBe('…ey');
  });

  it('a partial update keeps the current persistence mode and still mirrors to Firestore', async () => {
    const res = NextResponse.json({});
    const out = await saveSettings(req({ docsync_persistent: 'true' }), res, { uploadDest: 'notion' });
    expect(res.cookies.get('docsync_persistent')).toBeUndefined();
    expect(out.persisted).toBe(true);
    expect(docRef.set).toHaveBeenCalledWith({ uploadDest: 'notion' }, { merge: true });
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
      expect(docRef.set).toHaveBeenCalledWith({ profilePrefs: { 'factory-weight-slip': { fields: null, primaryKey: 'vehicleNumber' } } }, { merge: true });

      docRef.set.mockRejectedValue(new Error('denied'));
      const res = NextResponse.json({});
      await expect(saveProfilePrefs(req({ docsync_persistent: 'true' }), res, 'factory-weight-slip', { fields: [{ key: 'a', label: 'A' }] }))
        .resolves.toEqual({ fields: [{ key: 'a', label: 'A' }], primaryKey: null });
      expect(res.cookies.get('docsync_prefs')).toBeDefined();
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
