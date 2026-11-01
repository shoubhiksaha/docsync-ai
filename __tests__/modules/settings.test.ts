const getToken = jest.fn();
jest.mock('next-auth/jwt', () => ({ getToken: (...a: unknown[]) => getToken(...a) }));

const docRef = { get: jest.fn(), set: jest.fn(), delete: jest.fn() };
const db = { collection: jest.fn(() => ({ doc: jest.fn(() => docRef) })) };
let dbAvailable = true;
let firestore: 'ok' | 'unreachable' = 'ok';
/** Firestore failed on this instance within the last minute, so request paths skip it. */
let circuitOpen = false;
const reportFirestore = jest.fn();
jest.mock('@/modules/settings/firestore', () => ({
  firestoreForRequest: () => (dbAvailable && !circuitOpen ? db : null),
  firestoreState: async () => (dbAvailable ? (circuitOpen ? 'unreachable' : firestore) : 'not_configured'),
  reportFirestore: (...a: unknown[]) => reportFirestore(...a),
}));

import { NextRequest, NextResponse } from 'next/server';
import { decrypt, encrypt } from '@/core/crypto';
import { generateAndWrapDEK, unwrapAndDecryptDEK } from '@/core/envelope';
import {
  checkAiKey, checkNotion, cleanAiKey, isWellFormedKey, loadAllProfilePrefs, loadProfilePrefs, loadSettings, maskKey, parseUploadDest, sanitizePrefs, notionAvailability, saveProfilePrefs, saveSettings, settingsHealth, settingsStatus,
} from '@/modules/settings';

function req(cookies: Record<string, string> = {}) {
  const cookie = Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; ');
  return new NextRequest('http://localhost/api/settings', { headers: cookie ? { cookie } : {} });
}

/** The per-document-type prefs cookies a response set, ready to send back with req(). */
function prefsCookies(res: NextResponse): Record<string, string> {
  return Object.fromEntries(res.cookies.getAll().filter(c => c.name.startsWith('docsync_prefs_') && c.value).map(c => [c.name, c.value]));
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
    circuitOpen = false;
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
      const cookies = { ...prefsCookies(deviceB), docsync_changed: changed(deviceB) };
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
      docsync_upload_dest: 'gdrive', ...prefsCookies(prefs),
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
    const back = req(prefsCookies(res));
    await expect(loadProfilePrefs(back, 'ngo-receipt')).resolves.toEqual({ fields: [{ key: 'a', label: 'A' }], primaryKey: null });
  });

  it("turning sync off while Firestore can't be read keeps sync on, so the cloud key isn't lost on this device", async () => {
    const cloud = { exists: true, data: () => ({ openaiKey: generateAndWrapDEK('gsk_fromPhoneA1234'), changedAt: { openaiKey: 1000 } }) };
    const phoneB = { docsync_persistent: 'true' }; // got its key only through sync

    // Skipped after a recent failure on this instance.
    circuitOpen = true;
    let res = NextResponse.json({});
    await expect(saveSettings(req(phoneB), res, { persistent: false })).resolves.toEqual({ persisted: 'failed' });
    expect(res.cookies.get('docsync_persistent')).toBeUndefined();
    expect(docRef.delete).not.toHaveBeenCalled();
    circuitOpen = false;

    // The read stalls or fails.
    docRef.get.mockRejectedValueOnce(new Error('unavailable'));
    res = NextResponse.json({});
    await expect(saveSettings(req(phoneB), res, { persistent: false })).resolves.toEqual({ persisted: 'failed' });
    expect(res.cookies.get('docsync_persistent')).toBeUndefined();
    expect(docRef.delete).not.toHaveBeenCalled();

    // The doc can't be removed: other devices would keep syncing, so this one stays on too.
    docRef.get.mockResolvedValue(cloud);
    docRef.delete.mockRejectedValueOnce(new Error('unavailable'));
    res = NextResponse.json({});
    await expect(saveSettings(req(phoneB), res, { persistent: false })).resolves.toEqual({ persisted: 'failed' });
    expect(res.cookies.get('docsync_persistent')).toBeUndefined();

    // Still on, so this phone still uses the key; a later try that works keeps it here.
    await expect(loadSettings(req(phoneB))).resolves.toMatchObject({ openaiKey: 'gsk_fromPhoneA1234' });
    res = NextResponse.json({});
    await expect(saveSettings(req(phoneB), res, { persistent: false })).resolves.toEqual({ persisted: false });
    expect(res.cookies.get('docsync_persistent')?.value).toBe('false');
    expect(decrypt(res.cookies.get('docsync_openai')!.value)).toBe('gsk_fromPhoneA1234');

    // A server without Firestore has no cloud copy to keep: off at once.
    dbAvailable = false;
    res = NextResponse.json({});
    await expect(saveSettings(req(), res, { persistent: false })).resolves.toEqual({ persisted: false });
    expect(res.cookies.get('docsync_persistent')?.value).toBe('false');
  });

  it("turning sync on keeps another device's newer values instead of overwriting them with this device's old ones", async () => {
    // Phone B turned sync back on and saved a new key and Notion connection at t=5000; phone A turned sync off long before.
    const phoneB = {
      openaiKey: generateAndWrapDEK('gsk_phoneBNew0000'), notionKey: generateAndWrapDEK('ntn_phoneB'), uploadDest: 'notion',
      profilePrefs: { 'ngo-receipt': { fields: null, primaryKey: 'amount' } },
      changedAt: { openaiKey: 5000, notionKey: 5000, uploadDest: 5000, 'prefs:ngo-receipt': 5000 },
    };
    docRef.get.mockResolvedValue({ exists: true, data: () => phoneB });
    const phoneA = {
      docsync_persistent: 'false', docsync_openai: encrypt('gsk_phoneAOld1111'), docsync_notion: encrypt('ntn_expired'), docsync_upload_dest: 'gdrive',
      docsync_notion_db: encrypt('db-a'), // never in the doc: uploaded
      docsync_changed: encrypt(JSON.stringify({ openaiKey: 1000, notionKey: 1000, uploadDest: 9000 })), // the upload choice changed here since
    };
    const res = NextResponse.json({});
    await expect(saveSettings(req(phoneA), res, { persistent: true })).resolves.toEqual({ persisted: true, fromCloud: true });
    const [written] = docRef.set.mock.calls[0];
    expect(Object.keys(written).sort()).toEqual(['changedAt', 'notionDbId', 'uploadDest']);
    expect(unwrapAndDecryptDEK(written.notionDbId)).toBe('db-a');
    expect(written.uploadDest).toBe('gdrive');

    // From then on phone A uses phone B's key and Notion token.
    const after = { ...phoneA, docsync_persistent: 'true' };
    docRef.get.mockResolvedValue({ exists: true, data: () => ({ ...phoneB, ...written, changedAt: { ...phoneB.changedAt, ...written.changedAt } }) });
    await expect(loadSettings(req(after))).resolves.toMatchObject({ openaiKey: 'gsk_phoneBNew0000', notionKey: 'ntn_phoneB', notionDbId: 'db-a', uploadDest: 'gdrive' });
  });

  it('a Firestore that stalls costs seconds, not the whole request: reads fall back to cookies, writes report failed', async () => {
    jest.useFakeTimers();
    try {
      docRef.get.mockReturnValue(new Promise(() => undefined));
      const loading = loadSettings(req({ docsync_openai: encrypt('sk-here') }));
      await jest.advanceTimersByTimeAsync(3_000);
      await expect(loading).resolves.toMatchObject({ openaiKey: 'sk-here' });
      expect(reportFirestore).toHaveBeenLastCalledWith(false, expect.objectContaining({ name: 'TimeoutError' }));

      docRef.get.mockResolvedValue({ exists: true, data: () => ({}) });
      docRef.set.mockReturnValue(new Promise(() => undefined));
      const res = NextResponse.json({});
      const saving = saveSettings(req({ docsync_persistent: 'true' }), res, { uploadDest: 'gdrive' });
      await jest.advanceTimersByTimeAsync(3_000);
      await expect(saving).resolves.toEqual({ persisted: 'failed' });
      expect(res.cookies.get('docsync_upload_dest')?.value).toBe('gdrive');

      const prefs = saveProfilePrefs(req({ docsync_persistent: 'true' }), NextResponse.json({}), 'ngo-receipt', { primaryKey: '' });
      await jest.advanceTimersByTimeAsync(3_000);
      await expect(prefs).resolves.toMatchObject({ persisted: 'failed' });
    } finally {
      jest.useRealTimers();
    }
  });

  it('reports a failed cloud write without failing the save', async () => {
    docRef.set.mockRejectedValue(new Error('denied'));
    const res = NextResponse.json({});
    await expect(saveSettings(req(), res, { openaiKey: 'k', persistent: true })).resolves.toEqual({ persisted: 'failed' });
    expect(res.cookies.get('docsync_openai')).toBeDefined();
    // Nothing reached the cloud, so sync stays off rather than claiming the key follows the user.
    expect(res.cookies.get('docsync_persistent')).toBeUndefined();
  });

  it('settingsStatus merges cookie flags with Firestore and only reveals a masked key', async () => {
    docRef.get.mockResolvedValue({ exists: true, data: () => ({ notionKey: {}, uploadDest: 'gdrive' }) });
    const status = await settingsStatus(req({ docsync_openai: encrypt('gsk_abcdefghijklmnop1234') }), { classifyKey: k => (k.startsWith('gsk_') ? 'groq' : 'other') });
    expect(status).toEqual({
      hasOpenAiKey: true, hasNotionKey: true, hasNotionDbId: false, uploadDest: 'gdrive', isPersistent: true, syncAvailable: true,
      syncState: 'ok', sheets: [], aiKeyHint: 'gsk_…1234', aiProvider: 'groq', notionState: null, notionAvailable: 'not_configured',
    });
    expect(JSON.stringify(status)).not.toContain('abcdefghijklmnop');
  });

  it('settingsStatus tries a Notion connection, from the cookies or the cloud copy', async () => {
    const checkNotionMock = jest.fn().mockResolvedValue('revoked');
    const notion = { docsync_notion: encrypt('ntn_tok'), docsync_notion_db: encrypt('db-1') };
    await expect(settingsStatus(req(notion), { checkNotion: checkNotionMock })).resolves.toMatchObject({ hasNotionKey: true, notionState: 'revoked' });
    expect(checkNotionMock).toHaveBeenCalledWith('ntn_tok', 'db-1');

    docRef.get.mockResolvedValue({ exists: true, data: () => ({ notionKey: generateAndWrapDEK('ntn_cloud'), notionDbId: generateAndWrapDEK('db-cloud') }) });
    await expect(settingsStatus(req(), { checkNotion: checkNotionMock })).resolves.toMatchObject({ notionState: 'revoked' });
    expect(checkNotionMock).toHaveBeenLastCalledWith('ntn_cloud', 'db-cloud');

    // Without a checker, or without a connection, nothing is tried.
    await expect(settingsStatus(req(notion))).resolves.toMatchObject({ notionState: 'unchecked' });
    docRef.get.mockResolvedValue({ exists: false });
    checkNotionMock.mockClear();
    await expect(settingsStatus(req({ docsync_notion: encrypt('ntn_tok') }), { checkNotion: checkNotionMock })).resolves.toMatchObject({ notionState: null });
    expect(checkNotionMock).not.toHaveBeenCalled();
  });

  it('settingsStatus says whether Notion works on this server, and tries no connection while it is switched off', async () => {
    delete process.env.NOTION_CLIENT_ID;
    delete process.env.NOTION_CLIENT_SECRET;
    expect(notionAvailability()).toBe('not_configured');
    process.env.NOTION_CLIENT_ID = 'id';
    expect(notionAvailability()).toBe('not_configured'); // the callback needs the secret too
    process.env.NOTION_CLIENT_SECRET = 'secret';
    expect(notionAvailability()).toBe('ok');

    // Switched off, a saved connection is kept but nothing is sent to it, so it isn't tried.
    process.env.MODULE_NOTION = 'off';
    const checkNotionMock = jest.fn().mockResolvedValue('ok');
    const status = await settingsStatus(req({ docsync_notion: encrypt('ntn_tok'), docsync_notion_db: encrypt('db-1') }), { checkNotion: checkNotionMock });
    expect(status).toMatchObject({ hasNotionKey: true, hasNotionDbId: true, notionAvailable: 'disabled', notionState: 'unchecked' });
    expect(checkNotionMock).not.toHaveBeenCalled();
  });

  it('settingsStatus checks Notion while Firestore is read, not after', async () => {
    let answer: (doc: unknown) => void = () => undefined;
    docRef.get.mockReturnValue(new Promise(resolve => { answer = resolve; }));
    const checkNotionMock = jest.fn().mockResolvedValue('ok');
    const status = settingsStatus(req({ docsync_notion: encrypt('ntn_tok'), docsync_notion_db: encrypt('db-1') }), { checkNotion: checkNotionMock });
    await Promise.resolve();
    expect(checkNotionMock).toHaveBeenCalledWith('ntn_tok', 'db-1');
    answer({ exists: true, data: () => ({ uploadDest: 'gdrive' }) });
    await expect(status).resolves.toMatchObject({ notionState: 'ok', uploadDest: 'gdrive' });
    // The same connection is tried once.
    expect(checkNotionMock).toHaveBeenCalledTimes(1);
  });

  it('checkNotion: a revoked token or a missing database is told apart from an outage', async () => {
    const realFetch = global.fetch;
    const fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
    const answer = (status: number, body: unknown = {}) => ({ ok: status < 400, status, json: async () => body });
    try {
      fetchMock.mockResolvedValueOnce(answer(200, { id: 'db-1' }));
      await expect(checkNotion('tok', 'db-1')).resolves.toBe('ok');
      expect(fetchMock.mock.calls[0][0]).toBe('https://api.notion.com/v1/databases/db-1');
      expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer tok');
      fetchMock.mockResolvedValueOnce(answer(200, { id: 'db-1', in_trash: true }));
      await expect(checkNotion('tok', 'db-1')).resolves.toBe('missing_db');
      fetchMock.mockResolvedValueOnce(answer(404));
      await expect(checkNotion('tok', 'db-1')).resolves.toBe('missing_db');
      fetchMock.mockResolvedValueOnce(answer(401));
      await expect(checkNotion('tok', 'db-1')).resolves.toBe('revoked');
      fetchMock.mockResolvedValueOnce(answer(502));
      await expect(checkNotion('tok', 'db-1')).resolves.toBe('unchecked');
      fetchMock.mockRejectedValueOnce(new Error('offline'));
      await expect(checkNotion('tok', 'db-1')).resolves.toBe('unchecked');
    } finally {
      global.fetch = realFetch;
    }
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
    docRef.get.mockResolvedValue({ exists: true, data: () => ({ uploadDest: 'both' }) });
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
    docRef.get.mockResolvedValue({ exists: true, data: () => ({ uploadDest: 'both' }) });
    const res = NextResponse.json({});
    const out = await saveSettings(req({ docsync_persistent: 'true' }), res, { uploadDest: 'notion' });
    expect(res.cookies.get('docsync_persistent')).toBeUndefined();
    expect(out.persisted).toBe(true);
    expect(docRef.set).toHaveBeenCalledWith({ uploadDest: 'notion', changedAt: { uploadDest: expect.any(Number) } }, { merge: true });
    expect(docRef.delete).not.toHaveBeenCalled();

    jest.clearAllMocks();
    docRef.get.mockResolvedValue({ exists: false });
    const never = NextResponse.json({});
    await expect(saveSettings(req(), never, { uploadDest: 'gdrive' })).resolves.toEqual({ persisted: false });
    expect(docRef.set).not.toHaveBeenCalled();
    expect(never.cookies.get('docsync_persistent')).toBeUndefined(); // never chosen here: still no choice
  });

  describe('turning sync off on one device while another still has it on', () => {
    const live = { exists: true, data: () => ({ openaiKey: generateAndWrapDEK('gsk_deviceBKey1234'), uploadDest: 'notion', changedAt: { openaiKey: Date.now(), uploadDest: Date.now() } }) };

    it("device B, whose cookie still says on, switches off instead of writing the doc back", async () => {
      // Device A turned sync off: its cookie says false and the doc is gone.
      const deviceA = NextResponse.json({});
      docRef.get.mockResolvedValue(live);
      await saveSettings(req({ docsync_persistent: 'true' }), deviceA, { persistent: false });
      expect(deviceA.cookies.get('docsync_persistent')?.value).toBe('false');
      expect(docRef.delete).toHaveBeenCalled();
      docRef.get.mockResolvedValue({ exists: false });

      // Device B still says on, but finds no doc: it shows off and its next saves stay on the device.
      const deviceB = { docsync_persistent: 'true' };
      await expect(settingsStatus(req(deviceB))).resolves.toMatchObject({ isPersistent: false, syncAvailable: true });
      docRef.set.mockClear();
      const prefs = NextResponse.json({});
      await saveProfilePrefs(req(deviceB), prefs, 'ngo-receipt', { fields: [{ key: 'amount', label: 'Amount' }] });
      const settings = NextResponse.json({});
      await expect(saveSettings(req(deviceB), settings, { uploadDest: 'gdrive' })).resolves.toEqual({ persisted: false });
      expect(docRef.set).not.toHaveBeenCalled();
      expect(prefs.cookies.get('docsync_persistent')?.value).toBe('false');
      expect(settings.cookies.get('docsync_persistent')?.value).toBe('false');
    });

    it('device A ignores a doc written later by another device, until it turns sync on again', async () => {
      docRef.get.mockResolvedValue(live);
      const deviceA = { docsync_persistent: 'false', docsync_upload_dest: 'gdrive' };
      await expect(settingsStatus(req(deviceA))).resolves.toMatchObject({ isPersistent: false, hasOpenAiKey: false, uploadDest: 'gdrive' });
      await expect(loadSettings(req(deviceA))).resolves.toMatchObject({ openaiKey: undefined, uploadDest: 'gdrive' });
      await saveProfilePrefs(req(deviceA), NextResponse.json({}), 'ngo-receipt', { primaryKey: 'amount' });
      await saveSettings(req(deviceA), NextResponse.json({}), { uploadDest: 'both' });
      expect(docRef.get).not.toHaveBeenCalled();
      expect(docRef.set).not.toHaveBeenCalled();

      // Turning it back on joins the doc: device B's newer key and choice stay, and device A uses them.
      const on = NextResponse.json({});
      await expect(saveSettings(req(deviceA), on, { persistent: true })).resolves.toEqual({ persisted: true, fromCloud: true });
      expect(on.cookies.get('docsync_persistent')).toMatchObject({ value: 'true', sameSite: 'lax' });
      expect(docRef.set).not.toHaveBeenCalled();
    });
  });

  describe('profile preferences', () => {

    it('defaults when nothing is saved, and unknown profiles always get defaults', async () => {
      docRef.get.mockResolvedValue({ exists: false });
      await expect(loadProfilePrefs(req(), 'ngo-receipt')).resolves.toEqual({ fields: null, primaryKey: null });
      await expect(loadProfilePrefs(req(), 'nope')).resolves.toEqual({ fields: null, primaryKey: null });
      await expect(saveProfilePrefs(req(), NextResponse.json({}), 'nope', {})).rejects.toThrow('Unknown profile');
    });

    it('saves to an encrypted cookie that a later request reads back, merging partial updates', async () => {
      const res = NextResponse.json({});
      const { prefs: saved, persisted } = await saveProfilePrefs(req(), res, 'ngo-receipt', { fields: [{ key: 'amount', label: 'Amount' }, { key: 'x', label: '' }] });
      expect(saved).toEqual({ fields: [{ key: 'amount', label: 'Amount' }, { key: 'x', label: 'x' }], primaryKey: null });
      expect(persisted).toBe(false);
      expect(res.cookies.get('docsync_prefs_ngo_receipt')?.httpOnly).toBe(true);
      expect(res.cookies.get('docsync_prefs_ngo_receipt')?.value).not.toContain('Amount');
      expect(res.cookies.get('docsync_pk_ngo_receipt')?.value).toBe('');

      const next = req(prefsCookies(res));
      await expect(loadProfilePrefs(next, 'ngo-receipt')).resolves.toEqual(saved);

      const res2 = NextResponse.json({});
      await expect(saveProfilePrefs(next, res2, 'ngo-receipt', { primaryKey: '' })).resolves.toMatchObject({ prefs: { ...saved, primaryKey: '' }, trimmed: [] });
      await expect(loadProfilePrefs(req(prefsCookies(res2)), 'ngo-receipt')).resolves.toMatchObject({ primaryKey: '' });
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

    it('mirrors to Firestore in persistent mode and says when that write failed', async () => {
      docRef.get.mockResolvedValue({ exists: true, data: () => ({}) });
      await expect(saveProfilePrefs(req({ docsync_persistent: 'true' }), NextResponse.json({}), 'factory-weight-slip', { primaryKey: 'vehicleNumber' }))
        .resolves.toMatchObject({ persisted: true });
      expect(docRef.set).toHaveBeenCalledWith({
        profilePrefs: { 'factory-weight-slip': { fields: null, primaryKey: 'vehicleNumber' } },
        changedAt: { 'prefs:factory-weight-slip': expect.any(Number) },
      }, { merge: true });

      docRef.set.mockRejectedValue(new Error('denied'));
      const res = NextResponse.json({});
      await expect(saveProfilePrefs(req({ docsync_persistent: 'true' }), res, 'factory-weight-slip', { fields: [{ key: 'a', label: 'A' }] }))
        .resolves.toEqual({ prefs: { fields: [{ key: 'a', label: 'A' }], primaryKey: null }, trimmed: [], persisted: 'failed' });
      expect(res.cookies.get('docsync_prefs_factory_weight_slip')).toBeDefined();
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
      await saveProfilePrefs(req(prefsCookies(res)), res2, 'muster-roll', { primaryKey: 'workerName' });
      docRef.get.mockClear().mockResolvedValue({
        exists: true,
        data: () => ({ profilePrefs: { 'ngo-receipt': { fields: null, primaryKey: '' }, 'factory-weight-slip': { fields: null, primaryKey: 'vehicleNumber' } } }),
      });
      const all = await loadAllProfilePrefs(req({
        ...prefsCookies(res), ...prefsCookies(res2), docsync_changed: res.cookies.get('docsync_changed')!.value, docsync_pk_lorry_receipt: 'lrNumber',
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

    it("remembering fields for another document type never shortens this one's list (Hindi labels, five types)", async () => {
      // A 12-field dairy-style template with Hindi labels: about 1,060 characters once encrypted.
      const labels = ['किसान का नाम', 'किसान कोड', 'तारीख', 'पाली', 'दूध की मात्रा (लीटर)', 'फैट प्रतिशत', 'एसएनएफ प्रतिशत', 'दर प्रति लीटर', 'कुल राशि', 'केंद्र का नाम', 'पशु का प्रकार', 'टिप्पणी'];
      const template = labels.map((label, i) => ({ key: `field${i}`, label }));
      const types = ['dairy-collection-slip', 'ngo-receipt', 'factory-weight-slip', 'muster-roll', 'lorry-receipt'];
      let cookies: Record<string, string> = {};
      for (const id of types) {
        const res = NextResponse.json({});
        await expect(saveProfilePrefs(req(cookies), res, id, { fields: template })).resolves.toMatchObject({ prefs: { fields: template }, trimmed: [] });
        cookies = { ...cookies, ...prefsCookies(res) };
      }
      const all = await loadAllProfilePrefs(req(cookies));
      for (const id of types) expect(all[id].fields).toEqual(template);
      for (const value of Object.values(cookies)) expect(value.length).toBeLessThanOrEqual(3500);

      // The single cookie older versions kept is still read, and moved to one cookie per type on the next save.
      const legacy = { docsync_prefs: encrypt(JSON.stringify({ 'ngo-receipt': { fields: template, primaryKey: null } })) };
      const moved = NextResponse.json({});
      await saveProfilePrefs(req(legacy), moved, 'muster-roll', { primaryKey: 'workerName' });
      expect(moved.cookies.get('docsync_prefs')?.value).toBe('');
      await expect(loadProfilePrefs(req(prefsCookies(moved)), 'ngo-receipt')).resolves.toEqual({ fields: template, primaryKey: null });
    });

    it('shortens only the list being saved when it cannot fit, and says so', async () => {
      const many = (p: string) => Array.from({ length: 60 }, (_, i) => ({ key: `${p}${i}`.padEnd(100, 'k'), label: 'ल'.repeat(150) }));
      const res = NextResponse.json({});
      const first = await saveProfilePrefs(req(), res, 'ngo-receipt', { fields: many('a') });
      expect(first.trimmed).toEqual(['ngo-receipt']);
      expect(first.prefs.fields!.length).toBeLessThan(40);
      expect(first.prefs.fields![0].label).toHaveLength(100);
      expect(res.cookies.get('docsync_prefs_ngo_receipt')!.value.length).toBeLessThanOrEqual(3500);

      const res2 = NextResponse.json({});
      const second = await saveProfilePrefs(req(prefsCookies(res)), res2, 'factory-weight-slip', { fields: many('b') });
      expect(second.trimmed).toEqual(['factory-weight-slip']);
      expect(res2.cookies.get('docsync_prefs_ngo_receipt')).toBeUndefined(); // the other list is left alone
      const back = req({ ...prefsCookies(res), ...prefsCookies(res2) });
      await expect(loadProfilePrefs(back, 'ngo-receipt')).resolves.toEqual(first.prefs);
      await expect(loadProfilePrefs(back, 'factory-weight-slip')).resolves.toEqual(second.prefs);
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
      const googleError = (status: number, reason: string, message: string) => ({
        ok: false, status, text: async () => JSON.stringify({ error: { code: status, message, status: status === 403 ? 'PERMISSION_DENIED' : 'INVALID_ARGUMENT', details: [{ reason }] } }),
      });
      fetchMock.mockResolvedValueOnce(googleError(400, 'API_KEY_INVALID', 'API key not valid. Please pass a valid API key.'));
      await expect(checkAiKey('AIzaBad', 'google')).resolves.toBe('refused');
      expect(fetchMock.mock.calls[0][1].headers).toEqual({ 'x-goog-api-key': 'AIzaBad' });
      // A real key whose project can't use Gemini: copying it again won't help.
      fetchMock.mockResolvedValueOnce(googleError(403, 'SERVICE_DISABLED', 'Generative Language API has not been used in project 123 before or it is disabled.'));
      await expect(checkAiKey('AQ.CloudConsoleKey', 'google')).resolves.toBe('not_enabled');
      fetchMock.mockResolvedValueOnce(googleError(403, 'API_KEY_SERVICE_BLOCKED', 'Requests to this API are blocked.'));
      await expect(checkAiKey('AIzaRestricted', 'google')).resolves.toBe('not_enabled');
      fetchMock.mockResolvedValueOnce({ ok: false, status: 400, text: async () => '' });
      await expect(checkAiKey('AIzaBad', 'google')).resolves.toBe('refused');
      fetchMock.mockResolvedValueOnce({ ok: false, status: 401 });
      await expect(checkAiKey('sk-ant-x', 'anthropic')).resolves.toBe('refused');
      fetchMock.mockResolvedValueOnce({ ok: false, status: 403 }); // a restricted OpenAI key may still read documents
      await expect(checkAiKey('sk-x', 'openai')).resolves.toBe('unchecked');
      fetchMock.mockResolvedValueOnce({ ok: false, status: 429 });
      await expect(checkAiKey('gsk_x', 'groq')).resolves.toBe('unchecked');
      await expect(checkAiKey('k', 'cohere')).resolves.toBe('unchecked');
      // A key no request header can carry fails the same way on every scan: refused, not "couldn't be tested".
      fetchMock.mockClear();
      await expect(checkAiKey('AIzaSy\u200BAbc', 'google')).resolves.toBe('refused');
      await expect(checkAiKey('“AIzaSyAbc”', 'google')).resolves.toBe('refused');
      expect(fetchMock).not.toHaveBeenCalled();
      // fetch's own network errors are TypeErrors too; they still leave the key unchecked.
      fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'));
      await expect(checkAiKey('gsk_x', 'groq')).resolves.toBe('unchecked');
    } finally {
      global.fetch = realFetch;
    }
  });

  it('cleanAiKey removes what copying from a chat or a PDF adds; isWellFormedKey refuses what is left over', () => {
    expect(cleanAiKey('“AIzaSyAbc123”')).toBe('AIzaSyAbc123');
    expect(cleanAiKey(" 'gsk_abc' \n")).toBe('gsk_abc');
    expect(cleanAiKey('AIzaSy\nAbc')).toBe('AIzaSyAbc');
    expect(cleanAiKey('AIzaSy\u200BAbc\uFEFF')).toBe('AIzaSyAbc');
    expect(cleanAiKey('sk-proj-a b\u00A0c')).toBe('sk-proj-abc');
    expect(isWellFormedKey('AIzaSyAbc123')).toBe(true);
    // A '…' means the key was shortened where it was copied from; it is not quietly dropped.
    expect(isWellFormedKey(cleanAiKey('AIzaSyAbc…'))).toBe(false);
    expect(isWellFormedKey('gsk_' + 'a'.repeat(300))).toBe(false);
    expect(isWellFormedKey('482913')).toBe(false); // an SMS code offered above the keyboard
    expect(isWellFormedKey('')).toBe(false);
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
