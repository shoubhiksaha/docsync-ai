/**
 * One cheap request (the provider's model list) that tells whether a pasted AI key is accepted, so
 * a mistyped or expired key is caught when it is saved instead of failing quietly on every scan.
 * Only a clear "wrong key" answer counts as refused; a timeout, rate limit or outage leaves the
 * key unchecked, since it may well be fine.
 */

export type KeyCheck = 'ok' | 'refused' | 'unchecked';

export const KEY_CHECK_TIMEOUT_MS = 6_000;

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
    const res = await fetch(request.url, { headers: request.headers, signal: AbortSignal.timeout(KEY_CHECK_TIMEOUT_MS) });
    if (res.ok) return 'ok';
    // Gemini answers a bad key with 400 "API key not valid" (or 403); the others with 401. A 403 from
    // OpenAI can be a restricted key that still reads documents, so it isn't treated as refused.
    if (res.status === 401 || (provider === 'google' && (res.status === 400 || res.status === 403))) return 'refused';
    return 'unchecked';
  } catch {
    return 'unchecked';
  }
}
