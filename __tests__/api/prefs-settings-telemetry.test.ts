const getToken = jest.fn();
jest.mock('next-auth/jwt', () => ({ getToken: (...a: unknown[]) => getToken(...a) }));
jest.mock('@/modules/settings/firestore', () => ({
  firestoreForRequest: () => null,
  firestoreState: async () => 'not_configured',
  reportFirestore: () => undefined,
}));

import { NextRequest } from 'next/server';
import { GET as getPrefs, POST as savePrefs } from '@/app/api/profile-prefs/route';
import { GET as getSettings, POST as saveSettings } from '@/app/api/settings/route';
import { POST as telemetry } from '@/app/api/telemetry/route';
import { encrypt } from '@/core/crypto';

const SECRET = 'route-secret';

function req(url: string, init: { method?: string; body?: unknown; cookie?: string } = {}) {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (init.cookie) headers.cookie = init.cookie;
  return new NextRequest(`http://localhost${url}`, {
    method: init.method ?? 'GET',
    headers,
    body: init.body === undefined ? undefined : typeof init.body === 'string' ? init.body : JSON.stringify(init.body),
  });
}

describe('settings, profile-prefs and telemetry routes', () => {
  const saved = { ...process.env };
  beforeEach(() => {
    process.env = { ...saved, NEXTAUTH_SECRET: SECRET, ENCRYPTION_KEY: 'd'.repeat(64) };
    getToken.mockReset().mockResolvedValue({ email: 'u@x', accessToken: 't' });
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());
  afterAll(() => { process.env = saved; });

  describe('/api/settings', () => {
    it('GET returns a masked key and its provider, and needs a signed-in caller', async () => {
      const res = await getSettings(req('/api/settings', { cookie: `docsync_openai=${encrypt('gsk_0123456789abcdefWXYZ')}` }));
      const body = await res.json();
      expect(body).toMatchObject({ hasOpenAiKey: true, aiKeyHint: 'gsk_…WXYZ', aiProvider: 'groq', isPersistent: false, syncAvailable: false });
      expect(body).not.toHaveProperty('isGuest');
      expect(JSON.stringify(body)).not.toContain('0123456789');

      getToken.mockResolvedValue(null);
      expect((await getSettings(req('/api/settings'))).status).toBe(401);
      expect((await getSettings(req('/api/settings', { cookie: 'docsync_guest=v1.9999999999.n.s' }))).status).toBe(401);
    });

    it('POST is a partial update: one field changes, persistence mode is left alone, "" removes a key', async () => {
      const res = await saveSettings(req('/api/settings', { method: 'POST', body: { uploadDest: 'gdrive' } }));
      expect(res.status).toBe(200);
      expect(res.cookies.get('docsync_upload_dest')?.value).toBe('gdrive');
      expect(res.cookies.get('docsync_persistent')).toBeUndefined();

      const removed = await saveSettings(req('/api/settings', { method: 'POST', body: { openaiKey: '' } }));
      expect(removed.cookies.get('docsync_openai')?.value).toBe('');

      expect((await saveSettings(req('/api/settings', { method: 'POST', body: 'not json' }))).status).toBe(500);
    });

    it('POST tries a new AI key first: a refused key is not saved, one that cannot be tried is saved with a warning', async () => {
      const realFetch = global.fetch;
      const fetchMock = jest.fn();
      global.fetch = fetchMock as unknown as typeof fetch;
      try {
        fetchMock.mockResolvedValueOnce({ ok: false, status: 401 });
        const refused = await saveSettings(req('/api/settings', { method: 'POST', body: { openaiKey: 'gsk_halfPasted' } }));
        expect(refused.status).toBe(422);
        expect(await refused.json()).toMatchObject({ code: 'key_refused', provider: 'groq' });
        expect(refused.cookies.get('docsync_openai')).toBeUndefined();
        expect(fetchMock.mock.calls[0][0]).toBe('https://api.groq.com/openai/v1/models');
        expect(fetchMock.mock.calls[0][1].headers).toEqual({ Authorization: 'Bearer gsk_halfPasted' });

        fetchMock.mockResolvedValueOnce({ ok: true, status: 200 });
        const works = await saveSettings(req('/api/settings', { method: 'POST', body: { openaiKey: ' AIzaWorkingKey ' } }));
        expect(await works.json()).toEqual({ success: true, keyCheck: 'ok' });
        expect(works.cookies.get('docsync_openai')?.value).toMatch(/^v2\./);

        fetchMock.mockRejectedValueOnce(new Error('offline'));
        const untested = await saveSettings(req('/api/settings', { method: 'POST', body: { openaiKey: 'sk-proj-abc' } }));
        expect(await untested.json()).toEqual({ success: true, keyCheck: 'unchecked', warning: 'key_unchecked' });
        expect(untested.cookies.get('docsync_openai')?.value).toMatch(/^v2\./);

        // Removing a key needs no test.
        fetchMock.mockClear();
        await saveSettings(req('/api/settings', { method: 'POST', body: { openaiKey: '' } }));
        expect(fetchMock).not.toHaveBeenCalled();
      } finally {
        global.fetch = realFetch;
      }
    });

    it('POST says when sync could not be turned on, instead of reporting it saved', async () => {
      const res = await saveSettings(req('/api/settings', { method: 'POST', body: { persistent: true } }));
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ success: true, warning: 'sync_unavailable' });
      expect(res.cookies.get('docsync_persistent')).toBeUndefined();
    });
  });

  describe('/api/profile-prefs', () => {
    it('GET returns stored prefs plus the profile default duplicate field', async () => {
      const res = await getPrefs(req('/api/profile-prefs?profile=factory-weight-slip'));
      expect(await res.json()).toEqual({ profileId: 'factory-weight-slip', fields: null, primaryKey: null, defaultPrimaryKey: 'slipNumber' });
      expect((await getPrefs(req('/api/profile-prefs?profile=nope'))).status).toBe(400);
      getToken.mockResolvedValue(null);
      expect((await getPrefs(req('/api/profile-prefs?profile=ngo-receipt'))).status).toBe(401);
    });

    it('GET without a profile returns every profile in one response', async () => {
      const saved = await savePrefs(req('/api/profile-prefs', { method: 'POST', body: { profileId: 'ngo-receipt', fields: [{ key: 'amount', label: 'Amount' }] } }));
      const res = await getPrefs(req('/api/profile-prefs', { cookie: `docsync_prefs_ngo_receipt=${saved.cookies.get('docsync_prefs_ngo_receipt')?.value}` }));
      const { profiles } = await res.json();
      expect(Object.keys(profiles)).toHaveLength(28);
      expect(profiles['ngo-receipt']).toEqual({ profileId: 'ngo-receipt', fields: [{ key: 'amount', label: 'Amount' }], primaryKey: null, defaultPrimaryKey: 'receiptNumber' });
      expect(profiles['factory-weight-slip']).toMatchObject({ fields: null, primaryKey: null, defaultPrimaryKey: 'slipNumber' });
      getToken.mockResolvedValue(null);
      expect((await getPrefs(req('/api/profile-prefs'))).status).toBe(401);
    });

    it('POST saves remembered fields and the duplicate field into the prefs cookie', async () => {
      const res = await savePrefs(req('/api/profile-prefs', {
        method: 'POST',
        body: { profileId: 'ngo-receipt', fields: [{ key: 'amount', label: 'Amount' }], primaryKey: 'amount', junk: true },
      }));
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ profileId: 'ngo-receipt', fields: [{ key: 'amount', label: 'Amount' }], primaryKey: 'amount', defaultPrimaryKey: 'receiptNumber' });
      const cookie = res.cookies.get('docsync_prefs_ngo_receipt')?.value;
      expect(cookie).toBeTruthy();

      // read back with the new cookie, then clear the fields only
      const back = await getPrefs(req('/api/profile-prefs?profile=ngo-receipt', { cookie: `docsync_prefs_ngo_receipt=${cookie}` }));
      expect(await back.json()).toMatchObject({ fields: [{ key: 'amount', label: 'Amount' }], primaryKey: 'amount' });
      const cleared = await savePrefs(req('/api/profile-prefs', { method: 'POST', cookie: `docsync_prefs_ngo_receipt=${cookie}`, body: { profileId: 'ngo-receipt', fields: null } }));
      expect(await cleared.json()).toMatchObject({ fields: null, primaryKey: 'amount' });
    });

    it("primaryKey '' means \"don't check for duplicates\" and survives a round-trip; null resets to the default", async () => {
      const off = await savePrefs(req('/api/profile-prefs', { method: 'POST', body: { profileId: 'ngo-receipt', primaryKey: '' } }));
      expect(await off.json()).toMatchObject({ primaryKey: '', defaultPrimaryKey: 'receiptNumber' });
      const cookie = off.cookies.get('docsync_prefs_ngo_receipt')?.value;
      const back = await getPrefs(req('/api/profile-prefs?profile=ngo-receipt', { cookie: `docsync_prefs_ngo_receipt=${cookie}` }));
      expect((await back.json()).primaryKey).toBe('');

      const reset = await savePrefs(req('/api/profile-prefs', { method: 'POST', cookie: `docsync_prefs_ngo_receipt=${cookie}`, body: { profileId: 'ngo-receipt', primaryKey: null } }));
      expect((await reset.json()).primaryKey).toBeNull();
    });

    it('POST says which list was shortened when it could not fit on this device', async () => {
      const fields = Array.from({ length: 40 }, (_, i) => ({ key: `field${i}`.padEnd(100, 'k'), label: 'ल'.repeat(100) }));
      const res = await savePrefs(req('/api/profile-prefs', { method: 'POST', body: { profileId: 'ngo-receipt', fields } }));
      const body = await res.json();
      expect(body).toMatchObject({ profileId: 'ngo-receipt', warning: 'prefs_trimmed', trimmed: ['ngo-receipt'] });
      expect(body.fields.length).toBeLessThan(40);
      expect(body.fields).toEqual(fields.slice(0, body.fields.length));
    });

    it('POST validates the profile and the caller', async () => {
      expect((await savePrefs(req('/api/profile-prefs', { method: 'POST', body: { profileId: 'nope' } }))).status).toBe(400);
      expect((await savePrefs(req('/api/profile-prefs', { method: 'POST', body: 'garbage' }))).status).toBe(400);
      getToken.mockResolvedValue(null);
      expect((await savePrefs(req('/api/profile-prefs', { method: 'POST', body: { profileId: 'ngo-receipt' } }))).status).toBe(401);
    });

    it('POST reports a failed save without leaking details', async () => {
      process.env.ENCRYPTION_KEY = '';
      (process.env as Record<string, string>).NODE_ENV = 'production';
      const res = await savePrefs(req('/api/profile-prefs', { method: 'POST', body: { profileId: 'ngo-receipt', primaryKey: 'x' } }));
      expect(res.status).toBe(500);
      expect(await res.json()).toEqual({ error: 'Could not save these preferences. Please try again.' });
    });
  });

  describe('/api/telemetry', () => {
    it('logs sanitized events and returns 204', async () => {
      const info = jest.spyOn(console, 'info').mockImplementation(() => undefined);
      const res = await telemetry(req('/api/telemetry', { method: 'POST', body: { events: [{ event: 'scan_opened', props: { profile: 'ngo-receipt', email: 'a@b.c' } }, { event: 'nope' }] } }));
      expect(res.status).toBe(204);
      expect(info).toHaveBeenCalledTimes(1);
      const line = JSON.parse(info.mock.calls[0][0] as string);
      expect(line).toMatchObject({ type: 'telemetry', event: 'scan_opened', profile: 'ngo-receipt' });
      expect(line.email).toBeUndefined();

      info.mockClear();
      await telemetry(req('/api/telemetry', { method: 'POST', body: { event: 'retry', props: { destination: 'notion' } } }));
      expect(info).toHaveBeenCalledTimes(1);

      info.mockClear();
      const many = Array.from({ length: 50 }, () => ({ event: 'retry' }));
      await telemetry(req('/api/telemetry', { method: 'POST', body: { events: many } }));
      expect(info).toHaveBeenCalledTimes(20);

      info.mockClear();
      expect((await telemetry(req('/api/telemetry', { method: 'POST', body: 'bad json' }))).status).toBe(204);
      expect(info).not.toHaveBeenCalled();
    });

    it('requires a caller', async () => {
      getToken.mockResolvedValue(null);
      expect((await telemetry(req('/api/telemetry', { method: 'POST', body: { event: 'retry' } }))).status).toBe(401);
    });
  });
});
