import { NextRequest, NextResponse } from 'next/server';
import { errorText, parseJson, resolveCaller, unauthorized } from '@/core/http';
import { ExtractionUnavailableError, extractFields, MAX_DOCUMENT_BYTES, MAX_PAGES } from '@/modules/extraction';
import { getProfile } from '@/modules/profiles';
import { loadSettings } from '@/modules/settings';

export const maxDuration = 60;

/** Machine-readable error codes so the UI can explain what to do next. */
type ErrorCode = 'bad_input' | 'too_large' | 'quota' | 'unavailable' | 'internal';

const fail = (code: ErrorCode, error: string, status: number) => NextResponse.json({ error, code }, { status });

/** One or more `document` entries: up to MAX_PAGES photos (pages) of the same document. */
export async function POST(req: NextRequest) {
  const caller = await resolveCaller(req);
  if (!caller) return unauthorized();

  try {
    const formData = await req.formData();
    const files = formData.getAll('document').filter((f): f is File => f instanceof File);
    const profile = getProfile(formData.get('profileId') as string | null);

    if (files.length === 0) return fail('bad_input', 'No photo was received. Please add a photo of the document.', 400);
    if (files.length > MAX_PAGES) return fail('bad_input', `Please add at most ${MAX_PAGES} pages at a time.`, 400);
    if (!profile) return fail('bad_input', 'Unknown document type.', 400);
    if (files.some(f => !f.type.startsWith('image/'))) return fail('bad_input', 'Please use a photo (JPG, PNG or WebP) or a PDF.', 400);
    if (files.reduce((n, f) => n + f.size, 0) > MAX_DOCUMENT_BYTES) return fail('too_large', 'These pages are too large (20 MB in total). Please use smaller photos.', 413);

    const { openaiKey } = await loadSettings(req);
    const customApiKey = req.headers.get('x-openai-key') || openaiKey;
    const result = await extractFields({
      documents: await Promise.all(files.map(async f => Buffer.from(await f.arrayBuffer()))),
      profile,
      focusFields: parseJson<unknown[]>(formData.get('customFields'), []).filter((f): f is string => typeof f === 'string'),
      customApiKey,
    });

    return NextResponse.json({ success: true, pages: files.length, ...result });
  } catch (error) {
    if (error instanceof ExtractionUnavailableError) {
      if (error.kind === 'input') return fail('bad_input', error.message, 400);
      return error.quotaLike ? fail('quota', error.message, 429) : fail('unavailable', error.message, 502);
    }
    console.error('[extract] unexpected error:', errorText(error));
    return fail('internal', 'Something went wrong while reading the document. Please try again.', 500);
  }
}
