import { NextRequest, NextResponse } from 'next/server';
import { EncryptionKeyMissingError, isEncryptionConfigured } from '@/core/crypto';
import { accountId } from '@/core/device-owner';
import { errorText, resolveCaller, unauthorized } from '@/core/http';
import { clientIp, consume } from '@/core/rate-limit';
import { detectProvider } from '@/modules/ai';
import { checkAiKey, checkNotion, cleanAiKey, isWellFormedKey, KEY_WARNINGS, saveSettings, settingsStatus, type KeyCheck, type SaveSettingsResult } from '@/modules/settings';

/**
 * Key tests per account per 10 minutes. Each one asks a provider whether a key works, so without a
 * limit of their own (other settings share the 'default' group's 240) anyone signed in could use
 * this route to sort stolen keys. Ten is plenty for someone pasting their own key a few times.
 */
const KEY_TESTS_PER_WINDOW = 10;

/**
 * Why nothing was saved, one code per thing the user can do: paste the key again (key_malformed),
 * fix or replace it with the provider (key_refused), wait (rate_limited), or nothing, because this
 * server can't keep secrets (encryption_unavailable) or failed some other way (internal).
 */
type SaveErrorCode = 'key_malformed' | 'key_refused' | 'rate_limited' | 'encryption_unavailable' | 'internal';

const fail = (code: SaveErrorCode, error: string, status: number, extra: Record<string, string> = {}) =>
  NextResponse.json({ error, code, ...extra }, { status });

/**
 * The one code the UI explains, in the user's language. Everything but "sync_unavailable" and
 * "sync_off_failed" was saved on this device. A tested key's result comes first, so e.g.
 * "key_quota_cloud_sync_failed" says both, and "cloud_sync_failed" after a new key means the key worked.
 */
function warningFor(keyCheck: KeyCheck | undefined, persistent: boolean | undefined, result: SaveSettingsResult): string | undefined {
  // Turning sync on only counts once the account's doc is written; otherwise it stays off.
  if (persistent === true && result.persisted !== true) return 'sync_unavailable';
  // Turning it off only counts once the cloud's values are on this device; otherwise it stays on.
  if (persistent === false && result.persisted === 'failed') return 'sync_off_failed';
  const keyWarning = keyCheck ? KEY_WARNINGS[keyCheck] : undefined;
  if (result.persisted === 'failed') return keyWarning ? `${keyWarning}_cloud_sync_failed` : 'cloud_sync_failed';
  if (keyWarning) return keyWarning;
  if (result.fromCloud) return 'synced_from_other_device';
  if (result.prefsTrimmed) return 'prefs_trimmed';
  return undefined;
}

/**
 * Partial update: only the fields present are changed; '' removes a saved value. A new AI key is
 * cleaned of what copying adds (cleanAiKey), then tried: one with other characters left in it is
 * not saved (422, code "key_malformed"), nor is one the provider refuses (422, code "key_refused");
 * a Google key that can't use Gemini is not saved either, and the answer says so (warning
 * "key_not_enabled", nothing else changed). One that couldn't be confirmed is saved with a warning
 * that says why (KEY_WARNINGS). Key tests have their own small limit (429, code "rate_limited"), and
 * a server without ENCRYPTION_KEY saves nothing (503, code "encryption_unavailable"). No answer ever
 * carries the key.
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
      if (!openaiKey || !isWellFormedKey(openaiKey)) return fail('key_malformed', 'This key has characters no key has', 422);
      // Not tested when it couldn't be kept: the failure is this server's, and the test isn't used up.
      if (!isEncryptionConfigured()) throw new EncryptionKeyMissingError();
      const who = (await accountId({ email: caller.email })) ?? clientIp(req.headers);
      if (!(await consume(`ratelimit:keycheck:${who}`, KEY_TESTS_PER_WINDOW))) {
        return fail('rate_limited', 'Too many requests. Please try again later.', 429);
      }
      const provider = detectProvider(openaiKey);
      keyCheck = await checkAiKey(openaiKey, provider);
      if (keyCheck === 'malformed') return fail('key_malformed', 'This key has characters no key has', 422);
      if (keyCheck === 'refused') return fail('key_refused', 'The AI provider refused this key', 422, { provider });
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
    if (error instanceof EncryptionKeyMissingError) {
      console.error('[settings] save failed: ENCRYPTION_KEY is not configured');
      return fail('encryption_unavailable', 'Settings cannot be saved on this server right now', 503);
    }
    console.error('[settings] save failed:', errorText(error));
    return fail('internal', 'Failed to save settings', 500);
  }
}

/** What is saved, never the secrets themselves: the AI key comes back as a masked hint. A Notion connection is tried. */
export async function GET(req: NextRequest) {
  if (!(await resolveCaller(req))) return unauthorized();
  return NextResponse.json(await settingsStatus(req, { classifyKey: detectProvider, checkNotion }));
}
