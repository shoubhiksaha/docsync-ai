const create = jest.fn();
jest.mock('openai', () => ({
  OpenAI: jest.fn().mockImplementation((opts: { baseURL: string }) => ({ baseURL: opts.baseURL, audio: { transcriptions: { create: (a: unknown) => create(opts.baseURL, a) } } })),
  toFile: jest.fn(async (_buf: Buffer, name: string, opts: { type: string }) => ({ name, type: opts.type })),
}));

import { transcribeAudio, transcriptionHealth } from '@/modules/transcription';

const audio = Buffer.from('audio');
const KEYS = ['GROQ_API_KEY', 'GEMINI_API_KEY', 'OPENAI_API_KEY', 'MODULE_TRANSCRIPTION'];

describe('modules/transcription', () => {
  const saved = { ...process.env };
  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...saved };
    KEYS.forEach(k => delete process.env[k]);
    global.fetch = jest.fn();
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });
  afterAll(() => { process.env = saved; });

  it('returns mock text when no keys exist', async () => {
    await expect(transcribeAudio({ audio, fileName: 'v.webm', mimeType: 'audio/webm' })).resolves.toMatch(/mock transcription/);
  });

  it('moves on to the next provider after a failure', async () => {
    process.env.GROQ_API_KEY = 'gsk_x';
    process.env.OPENAI_API_KEY = 'sk-x';
    create.mockImplementation(async (baseURL: string) => {
      if (baseURL.includes('groq')) throw new Error('groq down');
      return { text: 'hello from openai' };
    });
    await expect(transcribeAudio({ audio, fileName: 'v.webm', mimeType: 'audio/webm' })).resolves.toBe('hello from openai');
  });

  it('sends the real recording type (e.g. Safari mp4) to Gemini', async () => {
    process.env.GEMINI_API_KEY = 'AIza-x';
    (global.fetch as jest.Mock).mockResolvedValue({ ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: ' hi ' }] } }] }) });
    await expect(transcribeAudio({ audio, fileName: 'voicenote.webm', mimeType: 'audio/mp4;codecs=mp4a' })).resolves.toBe('hi');
    const body = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body);
    expect(body.contents[0].parts[1].inlineData.mimeType).toBe('audio/mp4');
  });

  it('skips an Anthropic BYOK key (no speech API) and uses server keys', async () => {
    process.env.GROQ_API_KEY = 'gsk_x';
    create.mockResolvedValue({ text: 'from groq' });
    await expect(transcribeAudio({ audio, fileName: 'v.webm', mimeType: 'audio/webm', customApiKey: 'sk-ant-x' })).resolves.toBe('from groq');
  });

  it('returns null when every provider fails or the module is off', async () => {
    process.env.GEMINI_API_KEY = 'AIza-x';
    (global.fetch as jest.Mock).mockResolvedValue({ ok: false, status: 400 });
    await expect(transcribeAudio({ audio, fileName: 'v.webm', mimeType: 'audio/webm' })).resolves.toBeNull();
    process.env.MODULE_TRANSCRIPTION = 'off';
    await expect(transcribeAudio({ audio, fileName: 'v.webm', mimeType: 'audio/webm' })).resolves.toBeNull();
    expect(transcriptionHealth()).toMatchObject({ enabled: false, configured: true });
  });
});
