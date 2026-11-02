import { NextRequest, NextResponse } from 'next/server';
import { accountId } from '@/core/device-owner';
import { errorText, resolveCaller, unauthorized } from '@/core/http';
import { clientIp, consume } from '@/core/rate-limit';
import { detectProvider } from '@/modules/ai';
import { checkAiKey, checkNotion, cleanAiKey, isWellFormedKey, saveSettings, settingsStatus, type KeyCheck, type SaveSettingsResult } from '@/modules/settings';

/**
 * Key tests per account per 10 minutes. Each one asks a provider whether a key works, so without a
 * limit of their own (other settings share the 'default' group's 240) anyone signed in could use
 * this route to sort stolen keys. Ten is plenty for someone pasting their own key a few times.
 */
const KEY_TESTS_PER_WINDOW = 10;

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
 * cleaned of what copying adds (cleanAiKey), then tried: one with other characters left in it is
 * not saved (422, code "key_malformed"), nor is one the provider refuses (422, code "key_refused");
 * a Google key that can't use Gemini is not saved either, and the answer says so (warning
 * "key_not_enabled", nothing else changed); one that couldn't be checked (network, provider busy)
 * is saved with the warning "key_unchecked". Key tests have their own small limit (429).
 */
export async function POST(req: NextRequest) {
  const caller = await resolveCaller(req);
  if (!caller) return unauthorized();
  try {
    const body = await req.json();
    const rawKey = typeof body.openaiKey === 'string' ? body.openaiKey : undefined;
    // '' removes the saved key; anything else is a new key, without what copying added to it.
    const openaiKey = rawKey?.trim() ? cleanAiKey(rawKey) : rawKey;
    let keyCheck: KeyCheck | undefined;
    if (rawKey?.trim()) {
      if (!openaiKey || !isWellFormedKey(openaiKey)) {
        return NextResponse.json({ error: 'This key has characters no key has', code: 'key_malformed' }, { status: 422 });
      }
      const who = (await accountId({ email: caller.email })) ?? clientIp(req.headers);
      if (!(await consume(`ratelimit:keycheck:${who}`, KEY_TESTS_PER_WINDOW))) {
        return NextResponse.json({ error: 'Too many requests. Please try again later.', code: 'rate_limited' }, { status: 429 });
      }
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
