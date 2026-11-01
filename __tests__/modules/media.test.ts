const driveApi = { files: { list: jest.fn(), create: jest.fn() } };
jest.mock('googleapis', () => {
  class OAuth2 { setCredentials = jest.fn(); }
  return { google: { auth: { OAuth2 }, drive: jest.fn(() => driveApi) } };
});

import sharp from 'sharp';
import { mediaHealth, prepareArchiveImage, storeMedia } from '@/modules/media';

describe('modules/media', () => {
  const saved = { ...process.env };
  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...saved };
    global.fetch = jest.fn();
    driveApi.files.list.mockResolvedValue({ data: { files: [{ id: 'folder' }] } });
  });
  afterAll(() => { process.env = saved; });

  it('signed-in users upload privately to their Drive; one failed file does not block the other', async () => {
    driveApi.files.create
      .mockResolvedValueOnce({ data: { id: 'img', webViewLink: 'https://drive/img' } })
      .mockRejectedValueOnce(new Error('quota'));
    const res = await storeMedia({ accessToken: 't', profileId: 'p', image: Buffer.from('i'), audio: Buffer.from('a') });
    expect(res.imageUrl).toBe('https://drive/img');
    expect(res.audioUrl).toBeNull();
    expect(res.notes).toEqual(['voice_note_not_archived']);
  });

  it('looks up the media folder once, so a first save with a voice note makes one "DocSync AI" folder', async () => {
    driveApi.files.list.mockResolvedValue({ data: { files: [] } });
    driveApi.files.create.mockImplementation(async ({ requestBody }: { requestBody: { name: string } }) => ({
      data: { id: `id-${requestBody.name}`, webViewLink: `https://drive/${requestBody.name}` },
    }));
    const res = await storeMedia({ accessToken: 't', profileId: 'p', image: Buffer.from('i'), audio: Buffer.from('a') });
    const folders = driveApi.files.create.mock.calls.map(([a]) => a.requestBody).filter((b: { mimeType?: string }) => b.mimeType?.includes('folder'));
    expect(folders.map((b: { name: string }) => b.name)).toEqual(['DocSync AI', 'DocSync AI Media']);
    const uploads = driveApi.files.create.mock.calls.map(([a]) => a.requestBody).filter((b: { mimeType?: string }) => !b.mimeType);
    expect(uploads.map((b: { parents: string[] }) => b.parents)).toEqual([['id-DocSync AI Media'], ['id-DocSync AI Media']]);
    expect(res.notes).toEqual([]);
  });

  it('throws when every attempted upload failed (so the orchestrator reports it)', async () => {
    driveApi.files.create.mockRejectedValue(new Error('drive down'));
    await expect(storeMedia({ accessToken: 't', profileId: 'p', image: Buffer.from('i') })).rejects.toThrow('drive down');
  });

  it('expired Google session: explains instead of uploading anywhere', async () => {
    const res = await storeMedia({ profileId: 'p', image: Buffer.from('i'), audio: Buffer.from('a') });
    expect(res).toMatchObject({ imageUrl: null, audioUrl: null });
    expect(res.notes).toEqual(['media_session_expired']);
    expect(driveApi.files.create).not.toHaveBeenCalled();
    expect(global.fetch).not.toHaveBeenCalled();
    expect(mediaHealth()).toMatchObject({ enabled: true, configured: true });
  });

  it('no media → nothing to do', async () => {
    await expect(storeMedia({ profileId: 'p' })).resolves.toEqual({ imageUrl: null, audioUrl: null, notes: [] });
  });

  it('prepareArchiveImage produces a WebP', async () => {
    const png = await sharp({ create: { width: 20, height: 20, channels: 3, background: '#000' } }).png().toBuffer();
    const out = await prepareArchiveImage(png);
    expect((await sharp(out).metadata()).format).toBe('webp');
  });

  it('prepareArchiveImage keeps stacked multi-page scans tall enough to read', async () => {
    const tall = await sharp({ create: { width: 1000, height: 4000, channels: 3, background: '#fff' } }).png().toBuffer();
    const meta = await sharp(await prepareArchiveImage(tall)).metadata();
    expect([meta.width, meta.height]).toEqual([1000, 4000]);
    const wide = await sharp({ create: { width: 3000, height: 1000, channels: 3, background: '#fff' } }).png().toBuffer();
    expect((await sharp(await prepareArchiveImage(wide)).metadata()).width).toBe(1500);
  });
});
