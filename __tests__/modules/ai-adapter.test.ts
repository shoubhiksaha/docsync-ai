import { UniversalAIAdapter } from '@/modules/ai';

// Store original fetch
const originalFetch = global.fetch;

describe('UniversalAIAdapter', () => {
  beforeEach(() => {
    // Reset mocks before each test
    global.fetch = jest.fn();
    jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    // Restore original fetch
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('throws an error if no API key is provided', () => {
    expect(() => new UniversalAIAdapter({ apiKey: '' })).toThrow("API Key is required for BYOK Adapter");
  });

  it('sets default models based on provider', () => {
    const openaiAdapter = new UniversalAIAdapter({ apiKey: 'fake', provider: 'openai' });
    expect(openaiAdapter.modelName).toBe('gpt-4o');

    const googleAdapter = new UniversalAIAdapter({ apiKey: 'fake', provider: 'google' });
    expect(googleAdapter.modelName).toBe('gemini-3.6-flash');

    const groqAdapter = new UniversalAIAdapter({ apiKey: 'fake', provider: 'groq' });
    expect(groqAdapter.modelName).toBe('qwen/qwen3.8-27b');

    const anthropicAdapter = new UniversalAIAdapter({ apiKey: 'fake', provider: 'anthropic' });
    expect(anthropicAdapter.modelName).toBe('claude-sonnet-5-5');
  });

  it('uses config modelName if provided', () => {
    const adapter = new UniversalAIAdapter({ apiKey: 'fake', provider: 'openai', modelName: 'custom-model', apiVersion: '2024-01-01' });
    expect(adapter.modelName).toBe('custom-model');
    expect(adapter.apiVersion).toBe('2024-01-01');
  });

  it('sets baseUrl correctly', () => {
    const customAdapter = new UniversalAIAdapter({ apiKey: 'fake', baseUrl: 'https://custom.api' });
    expect(customAdapter.baseUrl).toBe('https://custom.api');

    const defaultAdapter = new UniversalAIAdapter({ apiKey: 'fake', provider: 'unknown-provider' });
    expect(defaultAdapter.baseUrl).toBe('https://api.openai.com/v1/chat/completions');
  });

  describe('chat - OpenAI Compatible', () => {
    it('sends correct payload and returns extracted content', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ choices: [{ message: { content: '```json\n{"data": "value"}\n```' } }] }),
      });

      const adapter = new UniversalAIAdapter({ apiKey: 'fake', provider: 'openai' });
      const response = await adapter.chat('system prompt', 'user prompt', [{ mimeType: 'image/jpeg', base64Data: 'data' }]);
      
      expect(global.fetch).toHaveBeenCalledTimes(1);
      expect(response).toBe('{"data": "value"}');
      
      const requestOptions = (global.fetch as jest.Mock).mock.calls[0][1];
      expect(requestOptions.headers['Authorization']).toBe('Bearer fake');
      const body = JSON.parse(requestOptions.body);
      expect(body.model).toBe('gpt-4o');
      expect(body.messages.length).toBe(2);
    });

    it('throws error if response is not ok', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        status: 400,
        text: async () => 'Bad Request',
      });

      const adapter = new UniversalAIAdapter({ apiKey: 'fake', provider: 'openai' });
      await expect(adapter.chat('', 'user')).rejects.toThrow('openai API Error: 400 - Bad Request');
    });

    it('throws error if extraction is empty', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ choices: [{ message: { content: null } }] }),
      });

      const adapter = new UniversalAIAdapter({ apiKey: 'fake', provider: 'openai' });
      await expect(adapter.chat('', 'user')).rejects.toThrow('No extraction returned');
    });

    it('falls back to empty string if error text fails', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        status: 400,
        text: async () => { throw new Error('Text failed'); },
      });

      const adapter = new UniversalAIAdapter({ apiKey: 'fake', provider: 'openai' });
      await expect(adapter.chat('', 'user')).rejects.toThrow('openai API Error: 400 - ');
    });
  });

  describe('fetch timeout', () => {
    it('aborts fetch on timeout', async () => {
      jest.useFakeTimers();
      const adapter = new UniversalAIAdapter({ apiKey: 'fake', provider: 'openai' });
      
      void adapter._fetch('http://example.com', {});
      
      // Fast-forward time to trigger timeout
      jest.advanceTimersByTime(45000);
      
      // Need to handle the promise somehow since it's just mocked to do nothing?
      // Actually global.fetch is mocked, so let's check if abort was called
      expect(global.fetch).toHaveBeenCalled();
      const options = (global.fetch as jest.Mock).mock.calls[0][1];
      expect(options.signal.aborted).toBe(true);
      
      jest.useRealTimers();
    });
  });

  describe('chat - Google', () => {
    it('sends correct payload and returns extracted content with images', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ candidates: [{ content: { parts: [{ text: 'extracted-text' }] } }] }),
      });

      const adapter = new UniversalAIAdapter({ apiKey: 'fake', provider: 'google' });
      const response = await adapter.chat('sys', 'user', [{ mimeType: 'image/png', base64Data: 'data123' }]);
      
      expect(global.fetch).toHaveBeenCalledTimes(1);
      expect(response).toBe('extracted-text');
      
      const requestOptions = (global.fetch as jest.Mock).mock.calls[0][1];
      expect(requestOptions.headers['x-goog-api-key']).toBe('fake');
    });

    it('falls back to other models on 500 error', async () => {
      (global.fetch as jest.Mock)
        .mockResolvedValueOnce({
          ok: false,
          status: 500,
          text: async () => 'Internal Server Error',
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ candidates: [{ content: { parts: [{ text: 'fallback-text' }] } }] }),
        });

      const adapter = new UniversalAIAdapter({ apiKey: 'fake', provider: 'google', modelName: 'custom-model' });
      const response = await adapter.chat('sys', 'user');
      
      expect(global.fetch).toHaveBeenCalledTimes(2);
      expect(console.warn).toHaveBeenCalled();
      expect(response).toBe('fallback-text');
    });

    it('throws error if all fallbacks fail', async () => {
      (global.fetch as jest.Mock)
        .mockResolvedValueOnce({ ok: false, status: 500, text: async () => 'err1' })
        .mockResolvedValueOnce({ ok: false, status: 500, text: async () => 'err2' })
        .mockResolvedValueOnce({ ok: false, status: 500, text: async () => 'err3' });

      const adapter = new UniversalAIAdapter({ apiKey: 'fake', provider: 'google' });
      await expect(adapter.chat('sys', 'user')).rejects.toThrow('Google API Error: 500 - err3');
    });

    it('reports every model busy as busy, naming a wait only when every model named one', async () => {
      const limited = (s: number) => ({ ok: false, status: 429, text: async () => `{"retryDelay": "${s}s"}`, headers: new Headers() });
      const adapter = new UniversalAIAdapter({ apiKey: 'fake', provider: 'google' });

      (global.fetch as jest.Mock).mockResolvedValueOnce(limited(30)).mockResolvedValueOnce(limited(10)).mockResolvedValueOnce(limited(20));
      await expect(adapter.chat('sys', 'user')).rejects.toMatchObject({ name: 'ProviderHttpError', status: 429, transient: true, retryAfterMs: 10_000 });

      (global.fetch as jest.Mock).mockResolvedValueOnce(limited(30)).mockResolvedValueOnce({ ok: false, status: 503, text: async () => '' }).mockResolvedValueOnce(limited(20));
      await expect(adapter.chat('sys', 'user')).rejects.toMatchObject({ transient: true, retryAfterMs: undefined });

      // Overloaded, then a retired fallback model: still busy, because the first model was.
      (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: false, status: 503, text: async () => '' }).mockResolvedValueOnce({ ok: false, status: 503, text: async () => '' }).mockResolvedValueOnce({ ok: false, status: 404, text: async () => '' });
      await expect(adapter.chat('sys', 'user')).rejects.toMatchObject({ status: 404, transient: true });
    });

    it('treats a rejected request (400) as a hard failure', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: false, status: 400, text: async () => 'API key not valid' });
      const adapter = new UniversalAIAdapter({ apiKey: 'fake', provider: 'google' });
      await expect(adapter.chat('sys', 'user')).rejects.toMatchObject({ status: 400, transient: false });
    });

    it('falls back to empty string if error text fails', async () => {
      (global.fetch as jest.Mock)
        .mockResolvedValueOnce({ ok: false, status: 500, text: async () => { throw new Error('fail'); } })
        .mockResolvedValueOnce({ ok: false, status: 500, text: async () => { throw new Error('fail'); } })
        .mockResolvedValueOnce({ ok: false, status: 400, text: async () => { throw new Error('fail'); } });

      const adapter = new UniversalAIAdapter({ apiKey: 'fake', provider: 'google' });
      await expect(adapter.chat('sys', 'user')).rejects.toThrow('Google API Error: 400 - ');
    });

    it('falls back if text is missing', async () => {
      (global.fetch as jest.Mock)
        .mockResolvedValueOnce({ ok: true, json: async () => ({}) })
        .mockResolvedValueOnce({ ok: true, json: async () => ({}) })
        .mockResolvedValueOnce({ ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: 'fallback-text' }] } }] }) });

      const adapter = new UniversalAIAdapter({ apiKey: 'fake', provider: 'google' });
      const response = await adapter.chat('sys', 'user');
      expect(response).toBe('fallback-text');
    });
    
    it('throws error if final fallback has no text', async () => {
      (global.fetch as jest.Mock)
        .mockResolvedValueOnce({ ok: true, json: async () => ({}) })
        .mockResolvedValueOnce({ ok: true, json: async () => ({}) })
        .mockResolvedValueOnce({ ok: true, json: async () => ({}) });

      const adapter = new UniversalAIAdapter({ apiKey: 'fake', provider: 'google' });
      await expect(adapter.chat('sys', 'user')).rejects.toThrow('No extraction returned');
    });
    
    it('throws normal error if status is 400', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        status: 400,
        text: async () => 'Bad Request',
      });

      const adapter = new UniversalAIAdapter({ apiKey: 'fake', provider: 'google' });
      await expect(adapter.chat('sys', 'user')).rejects.toThrow('Google API Error: 400 - Bad Request');
    });
  });

  describe('chat - Anthropic', () => {
    it('sends correct payload and returns extracted content with images', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ content: [{ text: '```json\n{"a":1}\n```' }] }),
      });

      const adapter = new UniversalAIAdapter({ apiKey: 'fake', provider: 'anthropic' });
      const response = await adapter.chat('sys', 'user', [{ mimeType: 'image/png', base64Data: 'data456' }]);
      
      expect(global.fetch).toHaveBeenCalledTimes(1);
      expect(response).toBe('{"a":1}');
      
      const requestOptions = (global.fetch as jest.Mock).mock.calls[0][1];
      expect(requestOptions.headers['x-api-key']).toBe('fake');
      expect(requestOptions.headers['anthropic-version']).toBe('2023-06-01');
    });

    it('throws error if response is not ok', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        status: 401,
        text: async () => 'Unauthorized',
      });

      const adapter = new UniversalAIAdapter({ apiKey: 'fake', provider: 'anthropic' });
      await expect(adapter.chat('sys', 'user')).rejects.toThrow('Anthropic API Error: 401 - Unauthorized');
    });

    it('falls back to empty string if error text fails', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        status: 401,
        text: async () => { throw new Error('fail'); },
      });

      const adapter = new UniversalAIAdapter({ apiKey: 'fake', provider: 'anthropic' });
      await expect(adapter.chat('sys', 'user')).rejects.toThrow('Anthropic API Error: 401 - ');
    });

    it('throws error if extraction is missing', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ content: [] }),
      });

      const adapter = new UniversalAIAdapter({ apiKey: 'fake', provider: 'anthropic' });
      await expect(adapter.chat('sys', 'user')).rejects.toThrow('No extraction returned');
    });
  });

  describe('chat - Fallback Provider', () => {
    it('defaults to OpenAI compatible for unknown providers', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ choices: [{ message: { content: 'hello' } }] }),
      });

      const adapter = new UniversalAIAdapter({ apiKey: 'fake', provider: 'unknown-provider' });
      const response = await adapter.chat('sys', 'user');
      expect(response).toBe('hello');
    });
  });

  it('sends every page image to every provider', async () => {
    const pages = [{ mimeType: 'image/jpeg', base64Data: 'p1' }, { mimeType: 'image/jpeg', base64Data: 'p2' }, { mimeType: 'image/jpeg', base64Data: 'p3' }];
    const replies: Record<string, unknown> = {
      openai: { choices: [{ message: { content: '{}' } }] },
      google: { candidates: [{ content: { parts: [{ text: '{}' }] } }] },
      anthropic: { content: [{ text: '{}' }] },
    };
    for (const provider of ['openai', 'google', 'anthropic'] as const) {
      (global.fetch as jest.Mock).mockReset().mockResolvedValueOnce({ ok: true, json: async () => replies[provider] });
      await new UniversalAIAdapter({ apiKey: 'fake', provider }).chat('sys', 'user', pages);
      const sent = (global.fetch as jest.Mock).mock.calls[0][1].body as string;
      for (const page of ['p1', 'p2', 'p3']) expect(sent).toContain(page);
    }
  });
});
