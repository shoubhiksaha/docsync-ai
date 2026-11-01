const getToken = jest.fn();
jest.mock('next-auth/jwt', () => ({ getToken: (...a: unknown[]) => getToken(...a) }));
const extractFields = jest.fn();
jest.mock('@/modules/extraction', () => ({
  ...jest.requireActual('@/modules/extraction'),
  extractFields: (...a: unknown[]) => extractFields(...a),
}));
jest.mock('@/modules/settings', () => ({
  ...jest.requireActual('@/modules/settings'),
  loadSettings: jest.fn(async () => ({ uploadDest: 'both' })),
}));

import { NextRequest } from 'next/server';
import { POST as extract } from '@/app/api/extract-freeform/route';
import { resetRateLimits } from '@/core/rate-limit';
import { ExtractionUnavailableError } from '@/modules/extraction';

const SECRET = 'route-secret';
const png = (name = 'page.png', type = 'image/png', size = 10) => new File([new Uint8Array(size)], name, { type });

async function request(files: File[], opts: { profileId?: string } = {}) {
  const form = new FormData();
  files.forEach(f => form.append('document', f));
  form.append('profileId', opts.profileId ?? 'ngo-receipt');
  return new NextRequest('http://localhost/api/extract-freeform', { method: 'POST', body: form });
}

describe('POST /api/extract-freeform', () => {
  const saved = { ...process.env };
  beforeEach(() => {
    process.env = { ...saved, NEXTAUTH_SECRET: SECRET };
    getToken.mockReset().mockResolvedValue({ email: 'u@x', accessToken: 't' });
    extractFields.mockReset().mockResolvedValue({ documentType: 'Receipt', fields: [], isMock: true, warnings: [], stats: { originalSize: 1, processedSize: 1 } });
    resetRateLimits();
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });
  afterAll(() => { process.env = saved; });

  it('rejects anonymous callers, including leftover demo cookies', async () => {
    getToken.mockResolvedValue(null);
    expect((await extract(await request([png()]))).status).toBe(401);
    const form = new FormData();
    form.append('document', png());
    form.append('profileId', 'ngo-receipt');
    const legacy = new NextRequest('http://localhost/api/extract-freeform', { method: 'POST', body: form, headers: { cookie: 'docsync_guest=v1.9999999999.n.s' } });
    expect((await extract(legacy)).status).toBe(401);
    expect(extractFields).not.toHaveBeenCalled();
  });

  it('passes every page to the extraction module', async () => {
    const res = await extract(await request([png('1.png'), png('2.jpg', 'image/jpeg')]));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ success: true, pages: 2 });
    expect(extractFields.mock.calls[0][0].documents).toHaveLength(2);
  });

  it.each([
    ['no photo', [], 'bad_input', 400],
    ['too many pages', [png(), png(), png(), png(), png()], 'bad_input', 400],
    ['a non-image', [png('a.pdf', 'application/pdf')], 'bad_input', 400],
    ['too large in total', [png('a.png', 'image/png', 11 * 1024 * 1024), png('b.png', 'image/png', 11 * 1024 * 1024)], 'too_large', 413],
  ])('returns a coded error for %s', async (_label, files, code, status) => {
    const res = await extract(await request(files as File[]));
    expect(res.status).toBe(status);
    expect(await res.json()).toMatchObject({ code });
    expect(extractFields).not.toHaveBeenCalled();
  });

  it('refuses an oversized body from its Content-Length, before reading it into memory', async () => {
    const huge = new NextRequest('http://localhost/api/extract-freeform', { method: 'POST', body: 'x', headers: { 'content-length': String(300 * 1024 * 1024) } });
    const formData = jest.spyOn(huge, 'formData');
    const res = await extract(huge);
    expect(res.status).toBe(413);
    expect(await res.json()).toMatchObject({ code: 'too_large' });
    expect(formData).not.toHaveBeenCalled();
  });

  it('counts the AI time budget from the start of the request', async () => {
    await extract(await request([png()]));
    expect(extractFields.mock.calls[0][0].startedAt).toEqual(expect.any(Number));
  });

  it('rejects unknown profiles', async () => {
    const res = await extract(await request([png()], { profileId: 'nope' }));
    expect(await res.json()).toMatchObject({ code: 'bad_input' });
  });

  it.each([
    [new ExtractionUnavailableError('busy', true), 'quota', 429],
    [new ExtractionUnavailableError('down', false), 'unavailable', 502],
    [new ExtractionUnavailableError('bad photo', false, 'input'), 'bad_input', 400],
    [new Error('kaboom'), 'internal', 500],
  ])('maps extraction errors to codes (%#)', async (error, code, status) => {
    extractFields.mockRejectedValue(error);
    const res = await extract(await request([png()]));
    expect(res.status).toBe(status);
    const body = await res.json();
    expect(body.code).toBe(code);
    expect(body.error).not.toContain('kaboom');
  });
});
