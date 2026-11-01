const create = jest.fn();
jest.mock('openai', () => ({
  OpenAI: jest.fn().mockImplementation((opts: { baseURL: string }) => ({ baseURL: opts.baseURL, audio: { transcriptions: { create: (a: unknown) => create(opts.baseURL, a) } } })),
  toFile: jest.fn(async (_buf: Buffer, name: string, opts: { type: string }) => ({ name, type: opts.type })),
}));

import { audioFormat, TRANSCRIBE_BUDGET_MS, transcribeAudio, transcriptionHealth } from '@/modules/transcription';

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

  it('returns null (type a note instead) when no keys exist, never sample text that could be saved as the note', async () => {
    await expect(transcribeAudio({ audio, fileName: 'v.webm', mimeType: 'audio/webm' })).resolves.toBeNull();
  });

  it('tells Whisper to expect Hindi when the app is in Hindi, and Gemini never to translate', async () => {
    process.env.GROQ_API_KEY = 'gsk_x';
    create.mockResolvedValue({ text: 'दूध 5 लीटर' });
    await expect(transcribeAudio({ audio, fileName: 'v.webm', mimeType: 'audio/webm', language: 'hi' })).resolves.toBe('दूध 5 लीटर');
    expect(create.mock.calls[0][1]).toMatchObject({ language: 'hi' });
    await transcribeAudio({ audio, fileName: 'v.webm', mimeType: 'audio/webm', language: 'en' });
    expect(create.mock.calls[1][1]).not.toHaveProperty('language');

    delete process.env.GROQ_API_KEY;
    process.env.GEMINI_API_KEY = 'AIza-x';
    (global.fetch as jest.Mock).mockResolvedValue({ ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: 'नमस्ते' }] } }] }) });
    await transcribeAudio({ audio, fileName: 'v.webm', mimeType: 'audio/webm', language: 'hi' });
    expect(JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body).contents[0].parts[0].text).toMatch(/Do not translate.*Devanagari/);
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

  it('audioFormat gives the plain type and a matching extension for stored voice notes', () => {
    expect(audioFormat('audio/mp4')).toEqual({ mimeType: 'audio/mp4', extension: 'm4a' });
    expect(audioFormat('audio/webm;codecs=opus')).toEqual({ mimeType: 'audio/webm', extension: 'webm' });
    expect(audioFormat('audio/ogg; codecs=opus')).toEqual({ mimeType: 'audio/ogg', extension: 'ogg' });
    expect(audioFormat('video/webm')).toEqual({ mimeType: 'audio/webm', extension: 'webm' });
    expect(audioFormat('', 'note.mp3')).toEqual({ mimeType: 'audio/mp3', extension: 'mp3' });
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

  it('stops trying providers when its time budget is used up, well inside the 60 s route limit', async () => {
    process.env.GROQ_API_KEY = 'gsk_x';
    process.env.OPENAI_API_KEY = 'sk-x';
    let now = 1_000_000;
    jest.spyOn(Date, 'now').mockImplementation(() => now);
    create.mockImplementation(async () => {
      now += TRANSCRIBE_BUDGET_MS - 1_000; // the first provider hangs until almost the end
      throw new Error('timeout');
    });
    await expect(transcribeAudio({ audio, fileName: 'v.webm', mimeType: 'audio/webm' })).resolves.toBeNull();
    expect(create).toHaveBeenCalledTimes(1);
    expect(TRANSCRIBE_BUDGET_MS).toBeLessThan(60_000);
  });
});
