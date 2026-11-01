import { NextRequest, NextResponse } from 'next/server';
import { errorText, parseJson, readForm, refundRequest, resolveCaller, unauthorized } from '@/core/http';
import { ExtractionUnavailableError, extractFields, MAX_DOCUMENT_BYTES, MAX_PAGES } from '@/modules/extraction';
import { getProfile } from '@/modules/profiles';
import { loadSettings } from '@/modules/settings';

export const maxDuration = 60;

/** Machine-readable error codes so the UI can explain what to do next. */
type ErrorCode = 'bad_input' | 'too_large' | 'quota' | 'unavailable' | 'internal';

const fail = (code: ErrorCode, error: string, status: number) => NextResponse.json({ error, code }, { status });

const MAX_FOCUS_FIELDS = 30;
const MAX_FOCUS_FIELD_LENGTH = 100;

/** One or more `document` entries: up to MAX_PAGES photos (pages) of the same document. */
export async function POST(req: NextRequest) {
  const caller = await resolveCaller(req);
  if (!caller) return unauthorized();
  const tooLarge = () => fail('too_large', 'These pages are too large (20 MB in total). Please use smaller photos.', 413);
  // Refused before (or while) the body is read into memory; 1 MB is room for the other form fields.
  if (Number(req.headers.get('content-length')) > MAX_DOCUMENT_BYTES + 1_000_000) return tooLarge();

  try {
    const formData = await readForm(req, MAX_DOCUMENT_BYTES + 1_000_000);
    if (!formData) return tooLarge();
    // The AI budget starts once the photos are here: a slow 2G upload must not use up the time to read them.
    const started = Date.now();
    const files = formData.getAll('document').filter((f): f is File => f instanceof File);
    const profile = getProfile(formData.get('profileId') as string | null);

    if (files.length === 0) return fail('bad_input', 'No photo was received. Please add a photo of the document.', 400);
    if (files.length > MAX_PAGES) return fail('bad_input', `Please add at most ${MAX_PAGES} pages at a time.`, 400);
    if (!profile) return fail('bad_input', 'Unknown document type.', 400);
    if (files.some(f => !f.type.startsWith('image/'))) return fail('bad_input', 'Please use a photo (JPG, PNG or WebP) or a PDF.', 400);
    if (files.reduce((n, f) => n + f.size, 0) > MAX_DOCUMENT_BYTES) return tooLarge();

    // Only the key saved in Settings (tested when it was saved), never one sent with the request.
    const { openaiKey: customApiKey } = await loadSettings(req);
    // Field names the user asked for go into the prompt, so keep them few and short.
    const customFields = parseJson<unknown>(formData.get('customFields'), []);
    const focusFields = (Array.isArray(customFields) ? customFields : [])
      .filter((f): f is string => typeof f === 'string' && Boolean(f.trim()))
      .slice(0, MAX_FOCUS_FIELDS)
      .map(f => f.trim().slice(0, MAX_FOCUS_FIELD_LENGTH));
    const result = await extractFields({
      documents: await Promise.all(files.map(async f => Buffer.from(await f.arrayBuffer()))),
      profile,
      focusFields,
      customApiKey,
      startedAt: started,
    });

    return NextResponse.json({ success: true, pages: files.length, ...result });
  } catch (error) {
    if (error instanceof ExtractionUnavailableError && error.kind === 'input') return fail('bad_input', error.message, 400);
    // Not the user's photo: the AI service was busy or down, or this server failed. The retry
    // that follows must not use up their reads (core/rate-limit), so this one is given back,
    // unless a provider answered: that read was paid for, if not usable.
    if (!(error instanceof ExtractionUnavailableError && error.answered)) await refundRequest(req);
    if (error instanceof ExtractionUnavailableError) {
      return error.quotaLike ? fail('quota', error.message, 429) : fail('unavailable', error.message, 502);
    }
    console.error('[extract] unexpected error:', errorText(error));
    return fail('internal', 'Something went wrong while reading the document. Please try again.', 500);
  }
}
