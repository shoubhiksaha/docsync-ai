import { NextRequest, NextResponse } from 'next/server';
import { errorText, resolveCaller, unauthorized } from '@/core/http';
import { detectProvider } from '@/modules/ai';
import { checkAiKey, saveSettings, settingsStatus, type KeyCheck } from '@/modules/settings';

/**
 * Partial update: only the fields present are changed; '' removes a saved value. A new AI key is
 * tried first: one the provider refuses is not saved (422, code "key_refused"); one that couldn't
 * be checked (network, provider busy) is saved with the warning "key_unchecked".
 */
export async function POST(req: NextRequest) {
  if (!(await resolveCaller(req))) return unauthorized();
  try {
    const body = await req.json();
    const openaiKey = typeof body.openaiKey === 'string' ? body.openaiKey : undefined;
    let keyCheck: KeyCheck | undefined;
    if (openaiKey?.trim()) {
      const provider = detectProvider(openaiKey);
      keyCheck = await checkAiKey(openaiKey, provider);
      if (keyCheck === 'refused') {
        return NextResponse.json({ error: 'The AI provider refused this key', code: 'key_refused', provider }, { status: 422 });
      }
    }
    const response = NextResponse.json({});
    const { persisted } = await saveSettings(req, response, {
      openaiKey,
      notionKey: typeof body.notionKey === 'string' ? body.notionKey : undefined,
      notionDbId: typeof body.notionDbId === 'string' ? body.notionDbId : undefined,
      uploadDest: typeof body.uploadDest === 'string' ? body.uploadDest : undefined,
      persistent: typeof body.persistent === 'boolean' ? body.persistent : undefined,
    });
    // Saved on this device either way. Codes, so the UI can say in the user's language that the
    // cross-device copy failed, or that the key couldn't be tried yet.
    const warning = persisted === 'failed' ? 'cloud_sync_failed' : keyCheck === 'unchecked' ? 'key_unchecked' : undefined;
    const result = NextResponse.json({ success: true, ...(keyCheck ? { keyCheck } : {}), ...(warning ? { warning } : {}) });
    response.cookies.getAll().forEach(c => result.cookies.set(c));
    return result;
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
