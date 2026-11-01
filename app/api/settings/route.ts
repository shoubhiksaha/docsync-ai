import { NextRequest, NextResponse } from 'next/server';
import { errorText, resolveCaller, unauthorized } from '@/core/http';
import { detectProvider } from '@/modules/ai';
import { saveSettings, settingsStatus } from '@/modules/settings';

/** Partial update: only the fields present are changed; '' removes a saved value. */
export async function POST(req: NextRequest) {
  if (!(await resolveCaller(req))) return unauthorized();
  try {
    const body = await req.json();
    const response = NextResponse.json({ success: true });
    const { persisted } = await saveSettings(req, response, {
      openaiKey: typeof body.openaiKey === 'string' ? body.openaiKey : undefined,
      notionKey: typeof body.notionKey === 'string' ? body.notionKey : undefined,
      notionDbId: typeof body.notionDbId === 'string' ? body.notionDbId : undefined,
      uploadDest: typeof body.uploadDest === 'string' ? body.uploadDest : undefined,
      persistent: typeof body.persistent === 'boolean' ? body.persistent : undefined,
    });
    if (persisted === 'failed') {
      // Cookies were saved; only the cross-device copy failed. A code, so the UI can say it in the user's language.
      const partial = NextResponse.json({ success: true, warning: 'cloud_sync_failed' });
      response.cookies.getAll().forEach(c => partial.cookies.set(c));
      return partial;
    }
    return response;
  } catch (error) {
    console.error('[settings] save failed:', errorText(error));
    return NextResponse.json({ error: 'Failed to save settings' }, { status: 500 });
  }
}

/** What is saved, never the secrets themselves: the AI key comes back as a masked hint. */
export async function GET(req: NextRequest) {
  if (!(await resolveCaller(req))) return unauthorized();
  return NextResponse.json(await settingsStatus(req, { classifyKey: detectProvider }));
}
