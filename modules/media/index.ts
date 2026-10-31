/**
 * Media module — archives the scanned image and voice note.
 *
 * Files are private to the user, in their own Google Drive ("DocSync AI/DocSync AI Media").
 *
 * Image and audio uploads are independent: one failing doesn't stop the other.
 */
import { Readable } from 'stream';
import sharp from 'sharp';
import { google } from 'googleapis';
import { isModuleEnabled } from '@/core/env';
import { circuitState } from '@/core/isolation';
import { ensureFolder, getGoogleAuth } from '@/core/google-auth';

export interface MediaInput {
  accessToken?: string;
  profileId: string;
  image?: Buffer | null;
  audio?: Buffer | null;
  audioMimeType?: string;
}

export interface MediaResult {
  imageUrl: string | null;
  audioUrl: string | null;
  notes: string[];
}

/** Smaller archive copy of the scan (WebP, ≤1500px wide; tall enough for a few stacked pages). */
export async function prepareArchiveImage(buffer: Buffer): Promise<Buffer> {
  return sharp(buffer)
    .rotate()
    .resize({ width: 1500, height: 6000, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 68 })
    .toBuffer();
}

async function uploadToDrive(accessToken: string, buffer: Buffer, fileName: string, mimeType: string): Promise<string> {
  const auth = getGoogleAuth(accessToken);
  const drive = google.drive({ version: 'v3', auth: auth as never });
  const rootId = await ensureFolder(drive, 'DocSync AI');
  const mediaId = await ensureFolder(drive, 'DocSync AI Media', rootId);
  const res = await drive.files.create({
    requestBody: { name: fileName, parents: [mediaId] },
    media: { mimeType, body: Readable.from(buffer) },
    fields: 'id, webViewLink',
  });
  if (!res.data.id) throw new Error('Drive returned no file id');
  return res.data.webViewLink || `https://drive.google.com/file/d/${res.data.id}/view`;
}

export async function storeMedia(input: MediaInput): Promise<MediaResult> {
  const result: MediaResult = { imageUrl: null, audioUrl: null, notes: [] };
  if (!input.image && !input.audio) return result;

  const token = input.accessToken;
  if (!token) {
    result.notes.push('Your Google session has expired, so the image and voice note were not stored. Please sign in again.');
    return result;
  }
  const upload = (buffer: Buffer, fileName: string, mimeType: string) => uploadToDrive(token, buffer, fileName, mimeType);

  const stamp = Date.now();
  const [image, audio] = await Promise.allSettled([
    input.image ? upload(input.image, `${input.profileId}_${stamp}.webp`, 'image/webp') : Promise.resolve(null),
    input.audio ? upload(input.audio, `voice_${input.profileId}_${stamp}.webm`, input.audioMimeType || 'audio/webm') : Promise.resolve(null),
  ]);

  if (image.status === 'fulfilled') result.imageUrl = image.value;
  else result.notes.push(`Image upload failed: ${image.reason instanceof Error ? image.reason.message : image.reason}`);
  if (audio.status === 'fulfilled') result.audioUrl = audio.value;
  else result.notes.push(`Voice note upload failed: ${audio.reason instanceof Error ? audio.reason.message : audio.reason}`);

  const attempted = [input.image ? image : null, input.audio ? audio : null].filter(Boolean);
  if (attempted.every(r => r?.status === 'rejected')) {
    throw new Error(result.notes.join(' '));
  }
  return result;
}

export function mediaHealth() {
  return { enabled: isModuleEnabled('media'), configured: true, circuit: circuitState('media') };
}
