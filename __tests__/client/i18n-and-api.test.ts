import { en } from '@/client/i18n/en';
import { hi } from '@/client/i18n/hi';
import { langFromAcceptLanguage, parseLang, translate, translator } from '@/client/i18n';
import { ApiError, errorCodeFor, extractDocument, fetchAllPrefs, fetchPrefs, fetchSettings, MAX_AUDIO_BYTES, savePrefs, saveSettings, syncRecord, transcribe } from '@/client/api';

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

  it("starts a first visit in Hindi only when the phone ranks Hindi above English", () => {
    expect(langFromAcceptLanguage('hi-IN,hi;q=0.9,en-US;q=0.8,en;q=0.7')).toBe('hi');
    expect(langFromAcceptLanguage('HI')).toBe('hi');
    expect(langFromAcceptLanguage('mr-IN,hi;q=0.8,en;q=0.5')).toBe('hi');
    expect(langFromAcceptLanguage('en;q=0.4,hi;q=0.6')).toBe('hi');
    expect(langFromAcceptLanguage('en-IN,en;q=0.9,hi;q=0.8')).toBe('en');
    expect(langFromAcceptLanguage('en,hi')).toBe('en');
    expect(langFromAcceptLanguage('hi;q=0,en;q=0.5')).toBe('en');
    expect(langFromAcceptLanguage('ta-IN,ta;q=0.9')).toBe('en');
    expect(langFromAcceptLanguage('*')).toBe('en');
    expect(langFromAcceptLanguage('')).toBe('en');
    expect(langFromAcceptLanguage(null)).toBe('en');
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

      // Settings saves run one at a time, so a stalled one must end and let the next go.
      hang();
      const settings = saveSettings({ uploadDest: 'gdrive' });
      jest.advanceTimersByTime(15_000);
      await expect(settings).rejects.toEqual(new ApiError('network'));
      hang();
      let keyEnded = false;
      const key = saveSettings({ openaiKey: 'gsk_x' }).finally(() => { keyEnded = true; }); // waits for the provider to try the key
      hang();
      const prefs = fetchAllPrefs();
      jest.advanceTimersByTime(15_000);
      await expect(prefs).rejects.toEqual(new ApiError('network'));
      expect(keyEnded).toBe(false);
      jest.advanceTimersByTime(5_000);
      await expect(key).rejects.toEqual(new ApiError('network'));

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

  it('retries Sheets with the earlier links and without uploading the photo or voice note again', async () => {
    const input = { profileId: 'p', fields: [{ key: 'a', label: 'A', value: '1' }], archive: new Blob(['i']), note: '', audio: new Blob(['a'], { type: 'audio/mp4' }), duplicateAction: 'keep_both' as const };

    respond(200, { destinations: { sheets: { status: 'success', code: 'saved' } }, imageUrl: 'https://drive/img' });
    const outcome = await syncRecord({ ...input, only: ['sheets'], imageLink: 'https://drive/img', voiceNoteLink: 'https://drive/voice' });
    expect(outcome).toMatchObject({ kind: 'saved', result: { status: 'saved', imageLink: 'https://drive/img' } });
    let form = fetchMock.mock.calls[0][1].body as FormData;
    expect(form.get('imageLink')).toBe('https://drive/img');
    expect(form.get('voiceNoteLink')).toBe('https://drive/voice');
    expect(form.get('document')).toBeNull();
    expect(form.get('audioFile')).toBeNull();

    // A too-large voice note doesn't block a Sheets retry that doesn't send it.
    respond(200, { destinations: { sheets: { status: 'success', code: 'saved' } } });
    await syncRecord({ ...input, only: ['sheets'], audio: new Blob([new Uint8Array(MAX_AUDIO_BYTES + 1)]) });

    // Media and Notion retries still send the photo and the voice note.
    respond(200, { destinations: { media: { status: 'success', code: 'saved' } } });
    await syncRecord({ ...input, only: ['media'] });
    form = fetchMock.mock.calls[2][1].body as FormData;
    expect(form.get('document')).not.toBeNull();
    expect(form.get('audioFile')).not.toBeNull();
    expect(form.get('imageLink')).toBeNull();
  });

  it('reports real upload progress while reading, through XMLHttpRequest', async () => {
    class FakeXhr {
      static last: FakeXhr;
      upload: { onprogress?: (e: { lengthComputable: boolean; loaded: number; total: number }) => void; onload?: () => void } = {};
      status = 0;
      responseText = '';
      timeout = 0;
      url = '';
      onload?: () => void;
      onerror?: () => void;
      ontimeout?: () => void;
      onabort?: () => void;
      constructor() { FakeXhr.last = this; }
      open(_method: string, url: string) { this.url = url; }
      send() {}
      abort() { this.onabort?.(); }
    }
    const scope = globalThis as { XMLHttpRequest?: unknown };
    const real = scope.XMLHttpRequest;
    scope.XMLHttpRequest = FakeXhr;
    try {
      const progress: number[] = [];
      const reading = extractDocument([new Blob(['1'])], 'p', [], undefined, sent => progress.push(sent));
      const xhr = FakeXhr.last;
      expect(xhr).toMatchObject({ url: '/api/extract-freeform' });
      xhr.upload.onprogress?.({ lengthComputable: true, loaded: 50, total: 100 });
      xhr.upload.onload?.();
      Object.assign(xhr, { status: 200, responseText: JSON.stringify({ success: true, fields: [{ key: 'a' }] }) });
      xhr.onload?.();
      await expect(reading).resolves.toMatchObject({ fields: [{ key: 'a' }] });
      expect(progress.slice(0, 2)).toEqual([0.5, 1]);
      expect(fetchMock).not.toHaveBeenCalled();

      const expired = extractDocument([new Blob(['1'])], 'p', [], undefined, () => {});
      Object.assign(FakeXhr.last, { status: 401, responseText: '<html>' });
      FakeXhr.last.onload?.();
      await expect(expired).rejects.toMatchObject({ code: 'session' });

      const offline = extractDocument([new Blob(['1'])], 'p', [], undefined, () => {});
      FakeXhr.last.onerror?.();
      await expect(offline).rejects.toEqual(new ApiError('network'));

      jest.useFakeTimers();
      try {
        // A slow upload that keeps moving is never cut off, however long it takes...
        const slow = extractDocument([new Blob(['1'])], 'p', [], undefined, () => {});
        for (let sent = 1; sent < 10; sent++) {
          jest.advanceTimersByTime(25_000);
          FakeXhr.last.upload.onprogress?.({ lengthComputable: true, loaded: sent, total: 10 });
        }
        // ...but one that stops moving for 30 s ends as "slow", not "no connection".
        jest.advanceTimersByTime(30_000);
        await expect(slow).rejects.toEqual(new ApiError('slow'));

        // Once everything is sent, the server gets two minutes to answer.
        const waiting = extractDocument([new Blob(['1'])], 'p', [], undefined, () => {});
        FakeXhr.last.upload.onprogress?.({ lengthComputable: true, loaded: 10, total: 10 });
        jest.advanceTimersByTime(60_000);
        Object.assign(FakeXhr.last, { status: 200, responseText: JSON.stringify({ success: true, fields: [] }) });
        FakeXhr.last.onload?.();
        await expect(waiting).resolves.toMatchObject({ fields: [] });

        const unanswered = extractDocument([new Blob(['1'])], 'p', [], undefined, () => {});
        FakeXhr.last.upload.onload?.();
        jest.advanceTimersByTime(120_000);
        await expect(unanswered).rejects.toEqual(new ApiError('unavailable'));

        // Saving reports upload progress the same way.
        const sent: number[] = [];
        const saving = syncRecord({ profileId: 'p', fields: [{ key: 'a', label: 'A', value: '1' }], archive: null, note: '', audio: null, onProgress: s => sent.push(s) });
        expect(FakeXhr.last.url).toBe('/api/sync');
        FakeXhr.last.upload.onprogress?.({ lengthComputable: true, loaded: 3, total: 10 });
        Object.assign(FakeXhr.last, { status: 200, responseText: JSON.stringify({ destinations: { sheets: { status: 'success', code: 'saved' } } }) });
        FakeXhr.last.onload?.();
        await expect(saving).resolves.toMatchObject({ kind: 'saved', result: { status: 'saved' } });
        expect(sent).toEqual([0.3, 1]);
      } finally {
        jest.useRealTimers();
      }

      const controller = new AbortController();
      const cancelled = extractDocument([new Blob(['1'])], 'p', [], controller.signal, () => {});
      controller.abort();
      await expect(cancelled).rejects.toMatchObject({ name: 'AbortError' });
    } finally {
      scope.XMLHttpRequest = real;
    }
  });

  it('refuses a voice note too large to send before uploading anything', async () => {
    const audio = new Blob([new Uint8Array(MAX_AUDIO_BYTES + 1)], { type: 'audio/webm' });
    await expect(syncRecord({ profileId: 'p', fields: [{ key: 'a', label: 'A', value: '1' }], archive: null, note: '', audio }))
      .rejects.toMatchObject({ code: 'audio_too_large' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('transcribes and rejects empty transcripts', async () => {
    respond(200, { text: ' hello ' });
    expect(await transcribe(new Blob(['a'], { type: 'audio/ogg' }))).toBe('hello');
    respond(200, { text: ' ' });
    await expect(transcribe(new Blob(['a']))).rejects.toBeInstanceOf(ApiError);

    // Saving while the note is turned into text stops that upload.
    fetchMock.mockImplementationOnce((_url: string, init: RequestInit) => new Promise((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
    }));
    const controller = new AbortController();
    const late = transcribe(new Blob(['a']), controller.signal);
    controller.abort();
    await expect(late).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('sends the scan id with every save and retry, so a save whose reply was lost is not written twice', async () => {
    const input = { profileId: 'p', fields: [{ key: 'a', label: 'A', value: '1' }], archive: null, note: '', audio: null };
    const id = '0f8fad5b-d9cb-469f-a165-70867728950e';
    respond(200, { destinations: { sheets: { status: 'success', code: 'saved' } } });
    await syncRecord({ ...input, saveId: id });
    respond(200, { destinations: { sheets: { status: 'success', code: 'saved' } } });
    await syncRecord({ ...input, saveId: id, only: ['sheets'], duplicateAction: 'keep_both' });
    respond(200, { destinations: { sheets: { status: 'success', code: 'saved' } } });
    await syncRecord(input);
    const sent = fetchMock.mock.calls.map(call => (call[1].body as FormData).get('saveId'));
    expect(sent).toEqual([id, id, null]);
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

    respond(200, { profiles: { p: { profileId: 'p', fields: null, primaryKey: null, defaultPrimaryKey: null } } });
    expect(Object.keys(await fetchAllPrefs())).toEqual(['p']);
    respond(401, {});
    await expect(fetchAllPrefs()).rejects.toMatchObject({ code: 'session' });

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
