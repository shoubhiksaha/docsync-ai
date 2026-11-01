/**
 * Media module — archives the scanned image and voice note.
 *
 * Files are private to the user, in their own Google Drive ("DocSync AI/DocSync AI Media").
 * Sharing the sheet does not share them: the sheet's photo links open only for the user, and for
 * anyone they share the "DocSync AI Media" folder with. This is deliberate: they are never made
 * public, since a photo can carry personal details (names, phone numbers, addresses).
 *
 * Image and audio uploads are independent: one failing doesn't stop the other.
 */
import { Readable } from 'stream';
import sharp from 'sharp';
import { google, type drive_v3 } from 'googleapis';
import { isModuleEnabled } from '@/core/env';
import { circuitState } from '@/core/isolation';
import { ensureFolder, getGoogleAuth } from '@/core/google-auth';

export interface MediaInput {
  accessToken?: string;
  profileId: string;
  image?: Buffer | null;
  audio?: Buffer | null;
  audioMimeType?: string;
  /** 'm4a', 'ogg', …, matching audioMimeType, so phone players open the file. */
  audioExtension?: string;
  /** Aborts the uploads (the sync timeout fired). */
  signal?: AbortSignal;
}

/** What the user is told about a partial upload; the UI translates each code (client/i18n `done.warning.*`). */
export type MediaNote = 'media_session_expired' | 'image_not_archived' | 'voice_note_not_archived';

export interface MediaResult {
  imageUrl: string | null;
  audioUrl: string | null;
  notes: MediaNote[];
}

/** Smaller archive copy of the scan (WebP, ≤1500px wide; tall enough for a few stacked pages). */
export async function prepareArchiveImage(buffer: Buffer): Promise<Buffer> {
  return sharp(buffer)
    .rotate()
    .resize({ width: 1500, height: 6000, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 68 })
    .toBuffer();
}

async function uploadToDrive(drive: drive_v3.Drive, mediaId: string, buffer: Buffer, fileName: string, mimeType: string): Promise<string> {
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
    result.notes.push('media_session_expired');
    return result;
  }
  const drive = google.drive({ version: 'v3', auth: getGoogleAuth(token) as never, ...(input.signal ? { signal: input.signal } : {}) });
  // Resolved once, before the parallel uploads: two lookups racing on a first save would each
  // create their own "DocSync AI" folder.
  const rootId = await ensureFolder(drive, 'DocSync AI');
  const mediaId = await ensureFolder(drive, 'DocSync AI Media', rootId);
  const upload = (buffer: Buffer, fileName: string, mimeType: string) => uploadToDrive(drive, mediaId, buffer, fileName, mimeType);

  const stamp = Date.now();
  const [image, audio] = await Promise.allSettled([
    input.image ? upload(input.image, `${input.profileId}_${stamp}.webp`, 'image/webp') : Promise.resolve(null),
    input.audio ? upload(input.audio, `voice_${input.profileId}_${stamp}.${input.audioExtension || 'webm'}`, input.audioMimeType || 'audio/webm') : Promise.resolve(null),
  ]);

  // Google's error text stays in the server log; the user gets a translated note.
  const errors: string[] = [];
  const reason = (r: PromiseRejectedResult) => (r.reason instanceof Error ? r.reason.message : String(r.reason));
  if (image.status === 'fulfilled') result.imageUrl = image.value;
  else {
    result.notes.push('image_not_archived');
    errors.push(`Image upload failed: ${reason(image)}`);
  }
  if (audio.status === 'fulfilled') result.audioUrl = audio.value;
  else {
    result.notes.push('voice_note_not_archived');
    errors.push(`Voice note upload failed: ${reason(audio)}`);
  }

  const attempted = [input.image ? image : null, input.audio ? audio : null].filter(Boolean);
  if (attempted.every(r => r?.status === 'rejected')) {
    throw new Error(errors.join(' '));
  }
  if (errors.length) console.warn('[media]', errors.join(' '));
  return result;
}

/** The Drive file id in a link storeMedia made ("https://drive.google.com/file/d/<id>/view"). */
export function driveFileId(link: string): string | null {
  return /^https:\/\/drive\.google\.com\/(?:file\/d\/|open\?id=)([A-Za-z0-9_-]{10,})/.exec(link)?.[1] ?? null;
}

/**
 * Moves a photo this app stored to the user's Drive trash (a replaced record's old photo), so a
 * redo doesn't leave two copies. Only an image is trashed: the drive.file scope already limits it
 * to files DocSync created or the user opened with it. The user can still restore it for 30 days.
 */
export async function trashMedia(input: { accessToken?: string; link: string; signal?: AbortSignal }): Promise<boolean> {
  const fileId = driveFileId(input.link);
  if (!input.accessToken || !fileId) return false;
  const drive = google.drive({ version: 'v3', auth: getGoogleAuth(input.accessToken) as never, ...(input.signal ? { signal: input.signal } : {}) });
  const file = await drive.files.get({ fileId, fields: 'mimeType, trashed' });
  if (file.data.trashed || !file.data.mimeType?.startsWith('image/')) return false;
  await drive.files.update({ fileId, requestBody: { trashed: true }, fields: 'id' });
  return true;
}

export function mediaHealth() {
  return { enabled: isModuleEnabled('media'), configured: true, circuit: circuitState('media') };
}
