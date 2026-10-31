import sharp from 'sharp';
import { resetBreakers } from '@/core/isolation';
import { buildSystemPrompt, extractFields, ExtractionUnavailableError, normalizeFields } from '@/modules/extraction';
import { getProfile } from '@/modules/profiles';

const KEYS = ['GROQ_API_KEY', 'OPENAI_API_KEY', 'GEMINI_API_KEY', 'ANTHROPIC_API_KEY', 'MODULE_EXTRACTION'];

let image: Buffer;
beforeAll(async () => {
  image = await sharp({ create: { width: 40, height: 30, channels: 3, background: '#ffffff' } }).png().toBuffer();
});

function modelReply(content: unknown) {
  return { ok: true, json: async () => ({ choices: [{ message: { content: typeof content === 'string' ? content : JSON.stringify(content) } }] }) };
}

describe('modules/extraction', () => {
  const saved = { ...process.env };
  const ngo = getProfile('ngo-receipt')!;
  beforeEach(() => {
    process.env = { ...saved };
    KEYS.forEach(k => delete process.env[k]);
    resetBreakers();
    global.fetch = jest.fn();
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());
  afterAll(() => { process.env = saved; });

  it('returns profile mock data (with validation) when no provider is configured', async () => {
    const res = await extractFields({ document: image, profile: ngo });
    expect(res.isMock).toBe(true);
    expect(res.fields.map(f => f.key)).toContain('donorName');
    expect(res.warnings).toEqual([]);
    expect(res.stats.originalSize).toBe(image.length);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('extracts, normalizes and validates fields from the model', async () => {
    process.env.OPENAI_API_KEY = 'sk-x';
    (global.fetch as jest.Mock).mockResolvedValue(modelReply({
      documentType: 'Donation receipt',
      fields: [
        { key: 'amount', label: 'Amount', value: 5000, confidence: 140, category: 'financial' },
        { label: 'Donor Name', value: 'Asha', confidence: '90', category: 'weird' },
        { key: '', label: '', value: 'dropped' },
      ],
    }));
    const res = await extractFields({ document: image, profile: ngo, focusFields: ['Receipt No'] });
    expect(res.isMock).toBe(false);
    expect(res.provider).toBe('openai');
    expect(res.fields).toEqual([
      { key: 'amount', label: 'Amount', value: '5000', confidence: 100, category: 'financial' },
      { key: 'donorName', label: 'Donor Name', value: 'Asha', confidence: 90, category: 'other' },
    ]);
    expect(res.warnings[0]).toMatch(/PAN/);
    const body = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body);
    expect(body.messages[0].content).toContain('Receipt No');
  });

  it('rejects unreadable model output with a clear error', async () => {
    process.env.OPENAI_API_KEY = 'sk-x';
    (global.fetch as jest.Mock).mockResolvedValue(modelReply('not json'));
    await expect(extractFields({ document: image, profile: ngo })).rejects.toThrow(ExtractionUnavailableError);
  });

  it('treats a photo with nothing readable as an input problem, not a service outage', async () => {
    process.env.OPENAI_API_KEY = 'sk-x';
    (global.fetch as jest.Mock).mockResolvedValue(modelReply({ fields: [] }));
    await expect(extractFields({ document: image, profile: ngo })).rejects.toMatchObject({ kind: 'input', message: expect.stringMatching(/clearer/) });
  });

  it('maps all-providers-out-of-quota to a quota error, never to sample data', async () => {
    process.env.OPENAI_API_KEY = 'sk-x';
    // A daily quota names a long wait, so the request fails at once instead of retrying.
    (global.fetch as jest.Mock).mockResolvedValue({ ok: false, status: 429, text: async () => 'quota', headers: new Headers({ 'retry-after': '3600' }) });
    const err = await extractFields({ document: image, profile: ngo }).catch(e => e);
    expect(err).toBeInstanceOf(ExtractionUnavailableError);
    expect(err.quotaLike).toBe(true);
    expect(err.message).toMatch(/busy|limit/);
    expect(err.message).not.toMatch(/429|quota/);
  });

  it('sends every page of a multi-page document in one request', async () => {
    process.env.OPENAI_API_KEY = 'sk-x';
    (global.fetch as jest.Mock).mockResolvedValue(modelReply({ fields: [{ key: 'amount', label: 'Amount', value: '1', confidence: 90 }] }));
    const res = await extractFields({ documents: [image, image, image, image, image], profile: ngo });
    expect(res.stats.originalSize).toBe(image.length * 4);
    const body = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body);
    const parts = body.messages[1].content;
    expect(parts.filter((p: { type: string }) => p.type === 'image_url')).toHaveLength(4);
    expect(JSON.stringify(parts)).toContain('4 pages of the same document');
  });

  it('rejects unusable uploads as input errors, and hides provider details from the message', async () => {
    await expect(extractFields({ profile: ngo })).rejects.toMatchObject({ kind: 'input' });
    await expect(extractFields({ document: Buffer.from('not an image'), profile: ngo })).rejects.toMatchObject({ kind: 'input', message: expect.stringMatching(/JPG or PNG/) });

    process.env.OPENAI_API_KEY = 'sk-x';
    (global.fetch as jest.Mock).mockResolvedValue({ ok: false, status: 400, text: async () => 'model gpt-x does not exist' });
    const err = await extractFields({ document: image, profile: ngo }).catch(e => e);
    expect(err).toMatchObject({ kind: 'service', quotaLike: false });
    expect(err.message).not.toContain('gpt-x');
  });

  it('honours the extraction kill switch', async () => {
    process.env.MODULE_EXTRACTION = 'off';
    await expect(extractFields({ document: image, profile: ngo })).rejects.toThrow('disabled');
  });

  it('normalizeFields de-duplicates keys and caps lengths', () => {
    const out = normalizeFields([
      { key: 'a', label: 'A', value: 'x'.repeat(3000) },
      { key: 'a', label: 'A2', value: { nested: true } },
      'garbage',
    ]);
    expect(out[0].value).toHaveLength(2000);
    expect(out[1].key).toBe('a2');
    expect(out[1].value).toBe('{"nested":true}');
    expect(normalizeFields('nope')).toEqual([]);
  });

  it('the prompt includes the profile context and priority fields', () => {
    const prompt = buildSystemPrompt(ngo, ['Custom Field']);
    expect(prompt).toContain('NGO donation receipt');
    expect(prompt).toContain('PAN Number');
    expect(prompt).toContain('Custom Field');
  });
});
