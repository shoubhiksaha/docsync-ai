import { en } from '@/client/i18n/en';
import { hi } from '@/client/i18n/hi';
import { parseLang, translate, translator } from '@/client/i18n';
import { ApiError, errorCodeFor, extractDocument, fetchPrefs, fetchSettings, savePrefs, saveSettings, syncRecord, transcribe } from '@/client/api';

const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort();

describe('client/i18n', () => {
  it('Hindi has every English key, non-empty, with the same placeholders', () => {
    for (const key of Object.keys(en) as (keyof typeof en)[]) {
      expect(hi[key]?.trim()).toBeTruthy();
      expect(placeholders(hi[key])).toEqual(placeholders(en[key]));
    }
    expect(Object.keys(hi).sort()).toEqual(Object.keys(en).sort());
  });

  it('parses the language cookie and fills placeholders', () => {
    expect(parseLang('hi')).toBe('hi');
    expect(parseLang('fr')).toBe('en');
    expect(parseLang(undefined)).toBe('en');
    expect(translate('en', 'home.comingSoon', { count: 26 })).toBe('26 more document types are coming soon');
    expect(translate('en', 'scan.title')).toBe('Scan: {name}');
    expect(translate('en', 'dup.body', { label: 'Receipt' })).toContain('{value}');
    expect(translator('hi')('nav.settings')).toBe('सेटिंग्स');
  });
});

describe('client/api', () => {
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

  it('maps statuses and server codes to error codes', () => {
    expect(errorCodeFor(429, { code: 'quota' })).toBe('quota');
    expect(errorCodeFor(429, { code: 'demo_budget' })).toBe('rate_limited');
    expect(errorCodeFor(429, { code: 'made_up' })).toBe('rate_limited');
    expect(errorCodeFor(401, null)).toBe('session');
    expect(errorCodeFor(413, null)).toBe('too_large');
    expect(errorCodeFor(400, {})).toBe('bad_input');
    expect(errorCodeFor(503, {})).toBe('unavailable');
    expect(errorCodeFor(500, {})).toBe('internal');
  });

  it('extracts with every page and the remembered field names', async () => {
    respond(200, { success: true, fields: [{ key: 'a' }], isMock: true, warnings: ['w'] });
    const result = await extractDocument([new Blob(['1']), new Blob(['2'])], 'ngo-receipt', ['Amount']);
    expect(result).toMatchObject({ isMock: true, warnings: ['w'] });
    const form = fetchMock.mock.calls[0][1].body as FormData;
    expect(form.getAll('document')).toHaveLength(2);
    expect(form.get('customFields')).toBe('["Amount"]');

    respond(429, { code: 'quota' });
    await expect(extractDocument([new Blob(['1'])], 'ngo-receipt', [])).rejects.toMatchObject({ code: 'quota' });
  });

  it('turns network failures into a "network" error and lets aborts through', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await expect(fetchSettings()).rejects.toEqual(new ApiError('network'));
    const abort = Object.assign(new Error('aborted'), { name: 'AbortError' });
    fetchMock.mockRejectedValueOnce(abort);
    await expect(extractDocument([new Blob(['1'])], 'p', [])).rejects.toBe(abort);
  });

  it('gives up on a stalled request as a "network" error, but still lets the caller cancel', async () => {
    // A fetch that only ends when its signal aborts, like an upload stuck on 2G.
    const hang = () => fetchMock.mockImplementationOnce((_url: string, init: RequestInit) => new Promise((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
    }));
    jest.useFakeTimers();
    try {
      hang();
      const sync = syncRecord({ profileId: 'p', fields: [{ key: 'a', label: 'A', value: '1' }], archive: null, note: '', audio: null });
      jest.advanceTimersByTime(10 * 60_000);
      await expect(sync).rejects.toEqual(new ApiError('network'));

      hang();
      const controller = new AbortController();
      const reading = extractDocument([new Blob(['1'])], 'p', [], controller.signal);
      controller.abort();
      await expect(reading).rejects.toMatchObject({ name: 'AbortError' });
    } finally {
      jest.useRealTimers();
    }
  });

  it('syncs: duplicates, per-destination results, retries and errors', async () => {
    const input = { profileId: 'p', fields: [{ key: 'a', label: 'A', value: '1' }], archive: new Blob(['i']), note: ' hi ', audio: new Blob(['a'], { type: 'audio/mp4' }), only: ['notion' as const], duplicateAction: 'keep_both' as const };

    respond(409, { duplicateCount: 2, primaryKeyLabel: 'Receipt', primaryKeyValue: 'R-1' });
    expect(await syncRecord(input)).toEqual({ kind: 'duplicate', info: { count: 2, label: 'Receipt', value: 'R-1' } });
    const form = fetchMock.mock.calls[0][1].body as FormData;
    expect(form.get('only')).toBe('notion');
    expect(form.get('noteText')).toBe('hi');
    expect((form.get('audioFile') as File).name).toBe('voice-note.m4a');

    respond(502, { destinations: { sheets: { status: 'failed', code: 'failed' } } });
    expect(await syncRecord({ ...input, only: undefined, audio: null, archive: null, note: '' })).toMatchObject({ kind: 'saved', result: { status: 'failed' } });

    respond(500, { error: 'boom' });
    await expect(syncRecord(input)).rejects.toMatchObject({ code: 'internal', status: 500 });
  });

  it('transcribes and rejects empty transcripts', async () => {
    respond(200, { text: ' hello ' });
    expect(await transcribe(new Blob(['a'], { type: 'audio/ogg' }))).toBe('hello');
    respond(200, { text: ' ' });
    await expect(transcribe(new Blob(['a']))).rejects.toBeInstanceOf(ApiError);
  });

  it('reads and writes profile prefs and settings', async () => {
    respond(200, { profileId: 'p', fields: null, primaryKey: '', defaultPrimaryKey: 'receiptNumber' });
    expect(await fetchPrefs('p')).toMatchObject({ primaryKey: '' });
    respond(500, null);
    expect(await fetchPrefs('p')).toBeNull();
    fetchMock.mockRejectedValueOnce(new TypeError('offline'));
    expect(await fetchPrefs('p')).toBeNull();

    respond(200, { profileId: 'p', fields: [{ key: 'a', label: 'A' }], primaryKey: null, defaultPrimaryKey: null });
    expect((await savePrefs('p', { fields: [{ key: 'a', label: 'A' }] })).fields).toHaveLength(1);
    expect(JSON.parse(fetchMock.mock.calls.at(-1)[1].body)).toEqual({ profileId: 'p', fields: [{ key: 'a', label: 'A' }] });
    respond(400, { error: 'x' });
    await expect(savePrefs('p', {})).rejects.toMatchObject({ code: 'bad_input' });

    respond(200, { hasOpenAiKey: true });
    expect((await fetchSettings()).hasOpenAiKey).toBe(true);
    respond(200, { success: true, warning: 'cloud failed' });
    expect(await saveSettings({ uploadDest: 'gdrive' })).toEqual({ warning: 'cloud failed' });
    respond(200, { success: true });
    expect(await saveSettings({ persistent: true })).toEqual({ warning: undefined });
    respond(401, {});
    await expect(saveSettings({})).rejects.toMatchObject({ code: 'session' });
  });
});
