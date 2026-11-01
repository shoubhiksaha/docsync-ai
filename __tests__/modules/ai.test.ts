import { aiHealth, AIUnavailableError, chatJson, detectProvider, isKeyRefusal, isQuotaLike, parseRetryAfter, providerCandidates } from '@/modules/ai';
import { BREAKER_THRESHOLD, resetBreakers } from '@/core/isolation';

const KEYS = ['GROQ_API_KEY', 'OPENAI_API_KEY', 'GEMINI_API_KEY', 'ANTHROPIC_API_KEY', 'MODULE_AI'];

function okResponse(content: string) {
  return { ok: true, json: async () => ({ choices: [{ message: { content } }] }) };
}
function geminiOk(text: string) {
  return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text }] } }] }) };
}
function errResponse(status: number, body = '', headers: Record<string, string> = {}) {
  return { ok: false, status, text: async () => body, headers: new Headers(headers) };
}

describe('modules/ai', () => {
  const saved = { ...process.env };
  beforeEach(() => {
    process.env = { ...saved };
    KEYS.forEach(k => delete process.env[k]);
    resetBreakers();
    global.fetch = jest.fn();
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());
  afterAll(() => { process.env = saved; });

  describe('detectProvider', () => {
    it('detects Anthropic keys before the generic sk- prefix', () => {
      expect(detectProvider('sk-ant-api03-abc')).toBe('anthropic');
      expect(detectProvider('sk-proj-abc')).toBe('openai');
      expect(detectProvider('sk-abc')).toBe('openai');
      expect(detectProvider('gsk_abc')).toBe('groq');
      expect(detectProvider('AIzaSyabc')).toBe('google');
      expect(detectProvider('AQ.abc')).toBe('google');
    });
  });

  describe('providerCandidates', () => {
    it('orders saved key first, then server keys, without duplicates', () => {
      process.env.GROQ_API_KEY = 'gsk_server';
      process.env.OPENAI_API_KEY = 'sk-server';
      process.env.GEMINI_API_KEY = 'AIza-server';
      process.env.ANTHROPIC_API_KEY = 'sk-ant-server';
      const list = providerCandidates(' sk-server ');
      expect(list.map(c => `${c.provider}:${c.source}`)).toEqual([
        'openai:saved key', 'groq:GROQ_API_KEY', 'google:GEMINI_API_KEY', 'anthropic:ANTHROPIC_API_KEY',
      ]);
    });

    it('lets models be overridden per environment', () => {
      process.env.GROQ_API_KEY = 'gsk_x';
      process.env.GROQ_VISION_MODEL = 'custom-groq';
      expect(providerCandidates()[0].modelName).toBe('custom-groq');
    });

    it('returns nothing when no keys exist', () => {
      expect(providerCandidates()).toEqual([]);
    });
  });

  describe('chatJson', () => {
    it('falls through to the next provider on ANY error, including 400/401/404', async () => {
      process.env.GROQ_API_KEY = 'gsk_x';
      process.env.OPENAI_API_KEY = 'sk-x';
      (global.fetch as jest.Mock)
        .mockResolvedValueOnce(errResponse(401, 'bad key'))        // saved key (openai)
        .mockResolvedValueOnce(errResponse(400, 'model_decommissioned')) // groq
        .mockResolvedValueOnce(okResponse('{"ok":true}'));          // openai env
      const res = await chatJson({ system: 's', user: 'u', customApiKey: 'sk-byok' });
      // The saved key was refused, so the user can be told to check it rather than wonder about shared limits.
      expect(res).toEqual({ text: '{"ok":true}', provider: 'openai', source: 'OPENAI_API_KEY', savedKeyRefused: true });
      expect(global.fetch).toHaveBeenCalledTimes(3);
    });

    it('does not flag a saved key that failed for another reason', async () => {
      process.env.OPENAI_API_KEY = 'sk-x';
      (global.fetch as jest.Mock)
        .mockResolvedValueOnce(errResponse(400, 'image too large'))
        .mockResolvedValueOnce(okResponse('{"ok":true}'));
      expect(await chatJson({ system: 's', user: 'u', customApiKey: 'gsk_byok' })).not.toHaveProperty('savedKeyRefused');
    });

    it('flags a saved Gemini key refused with 400 API_KEY_INVALID, but not a Gemini 400 about the photo', async () => {
      process.env.OPENAI_API_KEY = 'sk-x';
      (global.fetch as jest.Mock)
        .mockResolvedValueOnce(errResponse(400, '{"error":{"code":400,"message":"API key expired. Please renew the API key.","status":"INVALID_ARGUMENT","details":[{"reason":"API_KEY_INVALID"}]}}'))
        .mockResolvedValueOnce(okResponse('{"ok":true}'));
      expect(await chatJson({ system: 's', user: 'u', customApiKey: 'AIza-byok' })).toMatchObject({ source: 'OPENAI_API_KEY', savedKeyRefused: true });

      (global.fetch as jest.Mock)
        .mockResolvedValueOnce(errResponse(400, '{"error":{"message":"Request payload size exceeds the limit"}}'))
        .mockResolvedValueOnce(okResponse('{"ok":true}'));
      expect(await chatJson({ system: 's', user: 'u', customApiKey: 'AIza-byok' })).not.toHaveProperty('savedKeyRefused');
    });

    it('pauses a server Gemini key that answers 400 API_KEY_INVALID, instead of trying it on every request', async () => {
      process.env.GEMINI_API_KEY = 'AIza-server';
      (global.fetch as jest.Mock).mockResolvedValue(errResponse(400, '{"error":{"message":"API key not valid. Please pass a valid API key.","details":[{"reason":"API_KEY_INVALID"}]}}'));
      for (let i = 0; i < BREAKER_THRESHOLD; i++) await chatJson({ system: 's', user: 'u' }).catch(() => undefined);
      expect(aiHealth().circuit).toBe('open');
    });

    it('isKeyRefusal: 401/403 from any provider; 400 only from Google, and only when it names the key', () => {
      expect(isKeyRefusal('openai', 401)).toBe(true);
      expect(isKeyRefusal('anthropic', 403)).toBe(true);
      expect(isKeyRefusal('google', 400, 'API_KEY_INVALID')).toBe(true);
      expect(isKeyRefusal('google', 400, 'Image too large')).toBe(false);
      expect(isKeyRefusal('openai', 400, 'API key not valid')).toBe(false);
      expect(isKeyRefusal('groq', 429)).toBe(false);
    });

    it("one user's rejected photo (400/413/422) never pauses a server provider for everyone", async () => {
      process.env.OPENAI_API_KEY = 'sk-x';
      for (const status of [400, 413, 422, 400, 413, 422]) {
        (global.fetch as jest.Mock).mockResolvedValueOnce(errResponse(status, 'Request too large: image exceeds 4MB'));
        await chatJson({ system: 's', user: 'u' }).catch(() => undefined);
      }
      expect(aiHealth().circuit).toBe('closed');
      (global.fetch as jest.Mock).mockResolvedValueOnce(okResponse('{"ok":true}'));
      await expect(chatJson({ system: 's', user: 'u' })).resolves.toMatchObject({ provider: 'openai' });

      // A retired model is the provider's problem, whatever the status.
      for (let i = 0; i < BREAKER_THRESHOLD; i++) {
        (global.fetch as jest.Mock).mockResolvedValueOnce(errResponse(400, 'model_decommissioned'));
        await chatJson({ system: 's', user: 'u' }).catch(() => undefined);
      }
      expect(aiHealth().circuit).toBe('open');
    });

    it("one user's blocked or refused photo (200 with no answer) moves on without pausing the provider", async () => {
      process.env.GEMINI_API_KEY = 'AIza-x';
      process.env.ANTHROPIC_API_KEY = 'sk-ant-x';
      for (let i = 0; i < BREAKER_THRESHOLD + 1; i++) {
        (global.fetch as jest.Mock)
          .mockResolvedValueOnce({ ok: true, json: async () => ({ promptFeedback: { blockReason: 'SAFETY' } }) })
          .mockResolvedValueOnce({ ok: true, json: async () => ({ content: [{ text: '{"ok":true}' }] }) });
        await expect(chatJson({ system: 's', user: 'u' })).resolves.toMatchObject({ provider: 'anthropic' });
      }
      // One Gemini call per scan, not one per model, and Gemini is still in line.
      expect(global.fetch).toHaveBeenCalledTimes(2 * (BREAKER_THRESHOLD + 1));
      expect(aiHealth().circuit).toBe('closed');
    });

    it('throws AIUnavailableError with every attempt when all fail', async () => {
      process.env.OPENAI_API_KEY = 'sk-x';
      (global.fetch as jest.Mock).mockResolvedValue(errResponse(429, 'quota exceeded. Please try again in 10m0s.'));
      const err = await chatJson({ system: 's', user: 'u' }).catch(e => e);
      expect(err).toBeInstanceOf(AIUnavailableError);
      expect(err.attempts).toHaveLength(1);
      expect(err.quotaLike).toBe(true);
    });

    it('skips a server provider whose circuit is open after repeated hard failures', async () => {
      process.env.OPENAI_API_KEY = 'sk-x';
      process.env.GEMINI_API_KEY = 'AIza-x';
      (global.fetch as jest.Mock).mockResolvedValue(errResponse(401, 'bad key'));
      for (let i = 0; i < BREAKER_THRESHOLD; i++) await chatJson({ system: 's', user: 'u' }).catch(() => undefined);
      (global.fetch as jest.Mock).mockClear();
      await chatJson({ system: 's', user: 'u' }).catch(() => undefined);
      expect(global.fetch).not.toHaveBeenCalled();
      expect(aiHealth().circuit).toBe('open');
    });

    it('does nothing when the ai module is switched off', async () => {
      process.env.OPENAI_API_KEY = 'sk-x';
      process.env.MODULE_AI = 'off';
      await expect(chatJson({ system: 's', user: 'u' })).rejects.toThrow('No AI provider is configured.');
      expect(global.fetch).not.toHaveBeenCalled();
    });
  });

  // Back-to-back scans: one scan can use up Groq's per-minute limit, and Gemini is often briefly
  // overloaded. Busy must not look like broken.
  describe('chatJson with busy providers', () => {
    const fetchMock = () => global.fetch as jest.Mock;
    beforeEach(() => {
      jest.useFakeTimers();
      jest.spyOn(Math, 'random').mockReturnValue(0); // the extra pass waits exactly 2 s
    });
    afterEach(() => jest.useRealTimers());

    it('tries an overloaded provider once more after a short wait', async () => {
      process.env.OPENAI_API_KEY = 'sk-x';
      fetchMock().mockResolvedValueOnce(errResponse(503, 'overloaded')).mockResolvedValueOnce(okResponse('{"ok":true}'));
      const pending = chatJson({ system: 's', user: 'u' });
      await jest.advanceTimersByTimeAsync(1_999);
      expect(fetchMock()).toHaveBeenCalledTimes(1);
      await jest.advanceTimersByTimeAsync(1);
      await expect(pending).resolves.toMatchObject({ provider: 'openai' });
      expect(fetchMock()).toHaveBeenCalledTimes(2);
    });

    it('never pauses a provider for being busy, however often it happens', async () => {
      process.env.OPENAI_API_KEY = 'sk-x';
      fetchMock().mockResolvedValue(errResponse(503, 'overloaded'));
      for (let i = 0; i < BREAKER_THRESHOLD + 1; i++) {
        const pending = chatJson({ system: 's', user: 'u' }).catch(e => e);
        await jest.advanceTimersByTimeAsync(2_000);
        const err = await pending;
        expect(err.quotaLike).toBe(true);
        expect(err.attempts).toHaveLength(2);
      }
      expect(aiHealth().circuit).toBe('closed');
      expect(fetchMock()).toHaveBeenCalledTimes(2 * (BREAKER_THRESHOLD + 1));
    });

    it('skips a rate-limited key for exactly the wait it named, using the next provider meanwhile', async () => {
      process.env.GROQ_API_KEY = 'gsk_x';
      process.env.GEMINI_API_KEY = 'AIza-x';
      fetchMock()
        .mockResolvedValueOnce(errResponse(429, 'Rate limit reached', { 'retry-after': '20' })) // groq
        .mockResolvedValueOnce(errResponse(503)).mockResolvedValueOnce(errResponse(503)).mockResolvedValueOnce(errResponse(503)) // 3 Gemini models
        .mockResolvedValueOnce(geminiOk('{"first":true}')); // Gemini again, 2 s later
      const first = chatJson({ system: 's', user: 'u' });
      await jest.advanceTimersByTimeAsync(2_000);
      await expect(first).resolves.toMatchObject({ provider: 'google', text: '{"first":true}' });
      expect(fetchMock()).toHaveBeenCalledTimes(5);
      expect(aiHealth().circuit).toBe('open');

      // The next scan doesn't spend time on Groq while it is rate-limited.
      fetchMock().mockClear().mockResolvedValueOnce(geminiOk('{"second":true}'));
      await expect(chatJson({ system: 's', user: 'u' })).resolves.toMatchObject({ provider: 'google' });
      expect(fetchMock()).toHaveBeenCalledTimes(1);
      expect(fetchMock().mock.calls[0][0]).toContain('generativelanguage');

      // Once the named wait is over, Groq is first in line again.
      await jest.advanceTimersByTimeAsync(18_000);
      expect(aiHealth().circuit).toBe('closed');
      fetchMock().mockClear().mockResolvedValueOnce(okResponse('{"third":true}'));
      await expect(chatJson({ system: 's', user: 'u' })).resolves.toMatchObject({ provider: 'groq' });
    });

    it('waits out a rate limit of a few seconds within the same request', async () => {
      process.env.GROQ_API_KEY = 'gsk_x';
      fetchMock()
        .mockResolvedValueOnce(errResponse(429, 'Rate limit reached on tokens per minute. Please try again in 3.5s.'))
        .mockResolvedValueOnce(okResponse('{"ok":true}'));
      const pending = chatJson({ system: 's', user: 'u' });
      await jest.advanceTimersByTimeAsync(3_499);
      expect(fetchMock()).toHaveBeenCalledTimes(1);
      await jest.advanceTimersByTimeAsync(1);
      await expect(pending).resolves.toMatchObject({ provider: 'groq' });
    });

    it('does not wait for a long rate limit, and never retries a hard failure', async () => {
      process.env.OPENAI_API_KEY = 'sk-x';
      process.env.GEMINI_API_KEY = 'AIza-x';
      fetchMock()
        .mockResolvedValueOnce(errResponse(429, 'quota', { 'retry-after': '120' }))
        .mockResolvedValueOnce(errResponse(400, 'API key not valid'));
      const err = await chatJson({ system: 's', user: 'u' }).catch(e => e); // settles with no timers advanced
      expect(err).toBeInstanceOf(AIUnavailableError);
      expect(err.attempts).toHaveLength(2);
      expect(fetchMock()).toHaveBeenCalledTimes(2);
    });

    it('skips the extra pass when the request has too little time left', async () => {
      process.env.OPENAI_API_KEY = 'sk-x';
      fetchMock().mockResolvedValue(errResponse(503));
      const err = await chatJson({ system: 's', user: 'u', deadlineMs: 10_000 }).catch(e => e);
      expect(err).toBeInstanceOf(AIUnavailableError);
      expect(fetchMock()).toHaveBeenCalledTimes(1);
    });

    it('retries a busy saved key (BYOK) too, without a shared breaker', async () => {
      fetchMock().mockResolvedValueOnce(errResponse(529, 'overloaded')).mockResolvedValueOnce({ ok: true, json: async () => ({ content: [{ text: '{"ok":1}' }] }) });
      const pending = chatJson({ system: 's', user: 'u', customApiKey: 'sk-ant-user' });
      await jest.advanceTimersByTimeAsync(2_000);
      await expect(pending).resolves.toMatchObject({ provider: 'anthropic', source: 'saved key' });
    });
  });

  it('parseRetryAfter reads the header, then the wait named in the body', () => {
    const now = Date.parse('2026-10-22T10:00:00Z');
    expect(parseRetryAfter('7', '')).toBe(7_000);
    expect(parseRetryAfter('Thu, 22 Oct 2026 10:00:30 GMT', '', now)).toBe(30_000);
    expect(parseRetryAfter(null, 'Limit 1000, Used 990. Please try again in 1m2.5s. Need more tokens?')).toBe(62_500);
    expect(parseRetryAfter(undefined, 'Please try again in 850ms.')).toBe(850);
    expect(parseRetryAfter('soon', '{"@type": "type.googleapis.com/google.rpc.RetryInfo", "retryDelay": "37s"}')).toBe(37_000);
    expect(parseRetryAfter(null, 'The model is overloaded.')).toBeUndefined();
  });

  it('isQuotaLike', () => {
    expect(isQuotaLike('openai API Error: 429 - x')).toBe(true);
    expect(isQuotaLike('RESOURCE_EXHAUSTED')).toBe(true);
    expect(isQuotaLike('openai API Error: 401 - bad key')).toBe(false);
  });

  it('aiHealth reports configuration without exposing keys', () => {
    expect(aiHealth()).toMatchObject({ enabled: true, configured: false, circuit: 'closed', providers: 0 });
    process.env.GEMINI_API_KEY = 'AIza-x';
    const health = aiHealth();
    expect(health.configured).toBe(true);
    expect(JSON.stringify(health)).not.toContain('AIza');
  });

  it('an unreadable or cut-off answer moves on to the next provider without pausing the first', async () => {
    process.env.OPENAI_API_KEY = 'sk-x';
    process.env.GEMINI_API_KEY = 'AIza-x';
    const accept = (text: string) => {
      try { return Array.isArray(JSON.parse(text).fields); } catch { return false; }
    };
    const cutOff = { ok: true, json: async () => ({ choices: [{ message: { content: '{"fi' }, finish_reason: 'length' }] }) };
    for (let i = 0; i < BREAKER_THRESHOLD; i++) {
      (global.fetch as jest.Mock).mockReset()
        .mockResolvedValueOnce(i % 2 ? okResponse('{"fields": [{"key"') : cutOff)
        .mockResolvedValueOnce(geminiOk('{"fields": []}'));
      await expect(chatJson({ system: 's', user: 'u', accept })).resolves.toMatchObject({ provider: 'google', text: '{"fields": []}' });
    }
    (global.fetch as jest.Mock).mockReset().mockResolvedValueOnce(okResponse('{"fields": []}'));
    await expect(chatJson({ system: 's', user: 'u', accept })).resolves.toMatchObject({ provider: 'openai' });
  });
});
