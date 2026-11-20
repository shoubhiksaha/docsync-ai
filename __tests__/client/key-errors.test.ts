import { ApiError, extractDocument, saveSettings } from '@/client/api';
import { translate } from '@/client/i18n';
import { keyNotSavedMessage, keySavedWarning, parseSavedKeyError, savedKeyMessage, type SavedKeyError } from '@/client/key-errors';
import { initialScanState, scanReducer } from '@/client/scan-flow';
import { KEY_WARNINGS } from '@/modules/settings/key-check';

/** Every reason POST /api/settings and /api/extract-freeform give for not using a user's key. */
const NOT_SAVED_CODES = ['key_malformed', 'key_refused', 'key_not_enabled', 'rate_limited', 'encryption_unavailable'];
const SCAN_CODES: SavedKeyError[] = ['key_refused', 'key_quota', 'key_unreachable'];

describe('client/key-errors', () => {
  it('gives every key the server did not save its own message', () => {
    const messages = NOT_SAVED_CODES.map(keyNotSavedMessage);
    expect(messages).toEqual(['settings.ai.malformed', 'settings.ai.refused', 'settings.ai.notEnabled', 'settings.ai.tooManyTests', 'settings.serverProblem']);
    expect(new Set(messages).size).toBe(messages.length);
    // No answer at all is the connection; anything else is "try again", never undefined.
    expect(keyNotSavedMessage('network')).toBe('error.network');
    expect(keyNotSavedMessage('internal')).toBe('settings.saveFailed');
    expect(keyNotSavedMessage('made_up')).toBe('settings.saveFailed');
    expect(keyNotSavedMessage('constructor')).toBe('settings.saveFailed');
    expect(keyNotSavedMessage(undefined)).toBe('settings.saveFailed');
  });

  it('explains every warning the server gives for a key it saved untested, also with a failed cloud copy', () => {
    const warnings = Object.values(KEY_WARNINGS);
    expect(warnings.sort()).toEqual(['key_forbidden', 'key_quota', 'key_unchecked', 'key_unreachable']);
    const lines = warnings.map(w => keySavedWarning(w));
    expect(lines).toEqual([['settings.ai.forbidden'], ['settings.ai.quota'], ['settings.ai.unchecked'], ['settings.ai.unreachable']]);
    for (const warning of warnings) {
      expect(keySavedWarning(`${warning}_cloud_sync_failed`)).toEqual([...keySavedWarning(warning)!, 'settings.cloudSyncFailed']);
    }
    // Warnings that aren't about the key are left to the page.
    for (const other of ['cloud_sync_failed', 'sync_unavailable', 'key_not_enabled', 'prefs_trimmed', 'toString', '', undefined]) {
      expect(keySavedWarning(other)).toBeUndefined();
    }
  });

  it('says what to do, by name of the provider, in English and Hindi', () => {
    const keys = [...NOT_SAVED_CODES.map(keyNotSavedMessage), ...Object.values(KEY_WARNINGS).flatMap(w => keySavedWarning(w)!), ...SCAN_CODES.map(savedKeyMessage)];
    for (const lang of ['en', 'hi'] as const) {
      for (const key of keys) {
        const text = translate(lang, key, { provider: 'Groq' });
        expect(text).not.toBe(key);
        expect(text).not.toMatch(/\{\w+\}/);
      }
    }
    expect(translate('en', 'settings.ai.refused', { provider: 'Groq' })).toMatch(/^Groq says this key isn't allowed/);
    expect(translate('en', 'settings.ai.quota', { provider: 'OpenAI' })).toContain('billing with OpenAI');
    expect(translate('en', 'settings.serverProblem')).toContain('not with anything you did');
  });

  it('reads a scan\'s savedKeyError only when it is one it can explain', () => {
    expect(SCAN_CODES.map(savedKeyMessage)).toEqual(['scan.savedKey.refused', 'scan.savedKey.quota', 'scan.savedKey.unreachable']);
    for (const code of SCAN_CODES) expect(parseSavedKeyError(code)).toBe(code);
    for (const junk of ['key_malformed', 'toString', '', 3, null, undefined, {}]) expect(parseSavedKeyError(junk)).toBeUndefined();
  });
});

describe('client/api: key failures', () => {
  const realFetch = global.fetch;
  let fetchMock: jest.Mock;
  const respond = (status: number, body: unknown) => fetchMock.mockResolvedValueOnce({ status, json: async () => body });

  beforeEach(() => {
    fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
  });
  afterAll(() => {
    global.fetch = realFetch;
  });

  it("keeps the server's own code for a settings save that failed", async () => {
    respond(422, { error: 'refused', code: 'key_refused', provider: 'groq' });
    const refused = await saveSettings({ openaiKey: 'gsk_FAKE' }).catch(e => e);
    expect(refused).toBeInstanceOf(ApiError);
    expect(refused).toMatchObject({ code: 'internal', status: 422, reason: 'key_refused' });

    respond(503, { error: 'no', code: 'encryption_unavailable' });
    expect(await saveSettings({ openaiKey: 'gsk_FAKE' }).catch(e => e)).toMatchObject({ code: 'unavailable', reason: 'encryption_unavailable' });
    respond(429, { code: 'rate_limited' });
    expect(await saveSettings({ openaiKey: 'gsk_FAKE' }).catch(e => e)).toMatchObject({ code: 'rate_limited', reason: 'rate_limited' });
    respond(200, { success: true, keyCheck: 'quota', warning: 'key_quota' });
    await expect(saveSettings({ openaiKey: 'gsk_FAKE' })).resolves.toEqual({ warning: 'key_quota' });
  });

  it("passes on why a scan couldn't use the saved key, with the result or with the error", async () => {
    respond(200, { success: true, fields: [{ key: 'a' }], savedKeyError: 'key_quota' });
    expect(await extractDocument([new Blob(['1'])], 'ngo-receipt', [])).toMatchObject({ savedKeyError: 'key_quota' });
    respond(200, { success: true, fields: [{ key: 'a' }], savedKeyError: 'something_new' });
    expect(await extractDocument([new Blob(['1'])], 'ngo-receipt', [])).not.toHaveProperty('savedKeyError');

    respond(502, { code: 'unavailable', savedKeyError: 'key_refused' });
    expect(await extractDocument([new Blob(['1'])], 'ngo-receipt', []).catch(e => e)).toMatchObject({ code: 'unavailable', savedKeyError: 'key_refused' });
  });
});

describe('client/scan-flow: saved key problems', () => {
  const page = new Blob(['x'], { type: 'image/jpeg' });
  const extracting = () => scanReducer(scanReducer(initialScanState, { type: 'captured', pages: [page], scanId: 's1' }), { type: 'extract-start' });

  it('keeps why the saved key was not used for the review or the error, and forgets it on the next reading', () => {
    expect(initialScanState.savedKeyError).toBeNull();
    const read = scanReducer(extracting(), { type: 'extract-ok', extraction: { fields: [{ key: 'a', value: '1' }], savedKeyError: 'key_refused' }, template: null });
    expect(read).toMatchObject({ step: 'review', savedKeyError: 'key_refused' });

    const failed = scanReducer(extracting(), { type: 'extract-failed', error: 'quota', savedKeyError: 'key_quota' });
    expect(failed).toMatchObject({ step: 'capture', error: 'quota', savedKeyError: 'key_quota' });
    expect(scanReducer(failed, { type: 'extract-start' }).savedKeyError).toBeNull();
    expect(scanReducer(extracting(), { type: 'extract-failed', error: 'network' }).savedKeyError).toBeNull();
    expect(scanReducer(extracting(), { type: 'extract-ok', extraction: { fields: [{ key: 'a', value: '1' }] }, template: null }).savedKeyError).toBeNull();
  });
});
