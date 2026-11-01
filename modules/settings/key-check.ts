/**
 * One cheap request (the provider's model list) that tells whether a pasted AI key is accepted, so
 * a mistyped or expired key is caught when it is saved instead of failing quietly on every scan.
 * Only a clear "wrong key" answer counts as refused; a timeout, rate limit or outage leaves the
 * key unchecked, since it may well be fine. A Google key that is real but can't use Gemini (the API
 * isn't switched on for its project, or the key is limited to other APIs) is 'not_enabled', so
 * people aren't told to copy again a key they copied correctly.
 */

export type KeyCheck = 'ok' | 'refused' | 'not_enabled' | 'unchecked';

export const KEY_CHECK_TIMEOUT_MS = 6_000;

/** Longer than any provider's key: more than this is a pasted message, not a key. */
export const MAX_AI_KEY_LENGTH = 200;

/**
 * A pasted key without what copying from WhatsApp, SMS or a PDF adds: spaces and line breaks (also
 * inside the key), zero-width characters and quotes around it, straight or curly. What is left is
 * only checked by isWellFormedKey, so a '…' from a shortened key isn't quietly dropped.
 */
export function cleanAiKey(raw: string): string {
  return raw
    .replace(/[\s\u00AD\u180E\u200B-\u200F\u2060\uFEFF]/g, '')
    .replace(/^["'`\u2018\u2019\u201C\u201D\u00AB\u00BB]+|["'`\u2018\u2019\u201C\u201D\u00AB\u00BB]+$/g, '');
}

/**
 * Whether a cleaned key can be sent in a request header at all: printable ASCII and not too long.
 * Only digits is an SMS code (phones offer them above the keyboard), never a key, so it isn't sent.
 */
export function isWellFormedKey(key: string): boolean {
  return key.length <= MAX_AI_KEY_LENGTH && /^[\x21-\x7E]+$/.test(key) && !/^\d+$/.test(key);
}

const MODEL_LISTS: Record<string, (key: string) => { url: string; headers: Record<string, string> }> = {
  groq: key => ({ url: 'https://api.groq.com/openai/v1/models', headers: { Authorization: `Bearer ${key}` } }),
  openai: key => ({ url: 'https://api.openai.com/v1/models', headers: { Authorization: `Bearer ${key}` } }),
  anthropic: key => ({ url: 'https://api.anthropic.com/v1/models?limit=1', headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' } }),
  google: key => ({ url: 'https://generativelanguage.googleapis.com/v1beta/models?pageSize=1', headers: { 'x-goog-api-key': key } }),
};

/** `provider` is the ai module's detectProvider result for the key. */
export async function checkAiKey(key: string, provider: string): Promise<KeyCheck> {
  const request = MODEL_LISTS[provider]?.(key.trim());
  if (!request) return 'unchecked';
  try {
    // A key no header can carry fails the same way on every scan, so it is refused here rather than
    // passed as "couldn't be tested" (fetch's own network errors are TypeErrors too, so this is apart).
    new Headers(request.headers);
  } catch {
    return 'refused';
  }
  try {
    const res = await fetch(request.url, { headers: request.headers, signal: AbortSignal.timeout(KEY_CHECK_TIMEOUT_MS) });
    if (res.ok) return 'ok';
    // Gemini answers a bad key with 400 "API key not valid" (or 403); the others with 401. A 403 from
    // OpenAI can be a restricted key that still reads documents, so it isn't treated as refused.
    if (res.status === 401) return 'refused';
    if (provider === 'google' && (res.status === 400 || res.status === 403)) {
      const body = await res.text().catch(() => '');
      if (/API_KEY_INVALID|API key not valid|API key expired/i.test(body)) return 'refused';
      return /SERVICE_DISABLED|API_KEY_SERVICE_BLOCKED|PERMISSION_DENIED/.test(body) ? 'not_enabled' : 'refused';
    }
    return 'unchecked';
  } catch {
    return 'unchecked';
  }
}
