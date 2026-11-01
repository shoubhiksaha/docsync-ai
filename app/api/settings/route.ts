import { NextRequest, NextResponse } from 'next/server';
import { errorText, resolveCaller, unauthorized } from '@/core/http';
import { detectProvider } from '@/modules/ai';
import { checkAiKey, checkNotion, saveSettings, settingsStatus, type KeyCheck, type SaveSettingsResult } from '@/modules/settings';

/**
 * The one code the UI explains, in the user's language. Everything but "sync_unavailable" and
 * "sync_off_failed" was saved on this device. A tested key's result comes first, so
 * "key_unchecked_cloud_sync_failed" says both, and "cloud_sync_failed" after a new key means the key worked.
 */
function warningFor(keyCheck: KeyCheck | undefined, persistent: boolean | undefined, result: SaveSettingsResult): string | undefined {
  // Turning sync on only counts once the account's doc is written; otherwise it stays off.
  if (persistent === true && result.persisted !== true) return 'sync_unavailable';
  // Turning it off only counts once the cloud's values are on this device; otherwise it stays on.
  if (persistent === false && result.persisted === 'failed') return 'sync_off_failed';
  if (result.persisted === 'failed') return keyCheck === 'unchecked' ? 'key_unchecked_cloud_sync_failed' : 'cloud_sync_failed';
  if (keyCheck === 'unchecked') return 'key_unchecked';
  if (result.fromCloud) return 'synced_from_other_device';
  if (result.prefsTrimmed) return 'prefs_trimmed';
  return undefined;
}

/**
 * Partial update: only the fields present are changed; '' removes a saved value. A new AI key is
 * tried first: one the provider refuses is not saved (422, code "key_refused"); a Google key that
 * can't use Gemini is not saved either, and the answer says so (warning "key_not_enabled", nothing
 * else changed); one that couldn't be checked (network, provider busy) is saved with the warning "key_unchecked".
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
      if (keyCheck === 'not_enabled') return NextResponse.json({ success: false, keyCheck, warning: 'key_not_enabled' });
    }
    const response = NextResponse.json({});
    const persistent = typeof body.persistent === 'boolean' ? body.persistent : undefined;
    const saved = await saveSettings(req, response, {
      openaiKey,
      notionKey: typeof body.notionKey === 'string' ? body.notionKey : undefined,
      notionDbId: typeof body.notionDbId === 'string' ? body.notionDbId : undefined,
      uploadDest: typeof body.uploadDest === 'string' ? body.uploadDest : undefined,
      persistent,
    });
    const warning = warningFor(keyCheck, persistent, saved);
    const result = NextResponse.json({ success: true, ...(keyCheck ? { keyCheck } : {}), ...(warning ? { warning } : {}) });
    response.cookies.getAll().forEach(c => result.cookies.set(c));
    return result;
  } catch (error) {
    console.error('[settings] save failed:', errorText(error));
    return NextResponse.json({ error: 'Failed to save settings' }, { status: 500 });
  }
}

/** What is saved, never the secrets themselves: the AI key comes back as a masked hint. A Notion connection is tried. */
export async function GET(req: NextRequest) {
  if (!(await resolveCaller(req))) return unauthorized();
  return NextResponse.json(await settingsStatus(req, { classifyKey: detectProvider, checkNotion }));
}
