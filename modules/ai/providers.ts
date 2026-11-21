import { env } from '@/core/env';

export type ProviderId = 'openai' | 'anthropic' | 'google' | 'groq';

export interface ProviderCandidate {
  provider: ProviderId;
  modelName: string;
  apiKey: string;
  /** Where the key came from — "saved key" for BYOK, otherwise the env var name. */
  source: string;
}

/** Default vision models; each can be overridden per environment without a code change. */
export function defaultModel(provider: ProviderId): string {
  switch (provider) {
    case 'openai': return env('OPENAI_VISION_MODEL') ?? 'gpt-4o';
    case 'anthropic': return env('ANTHROPIC_VISION_MODEL') ?? 'claude-sonnet-5-5';
    case 'groq': return env('GROQ_VISION_MODEL') ?? 'qwen/qwen3.8-27b';
    // gemini-2.5-flash reads a slip in about 8-20 s; gemini-3.6-flash took 20-38 s, close to the
    // 40 s each attempt gets, and timed out on staging (2026-11-21). The others stay as fallbacks.
    case 'google': return env('GEMINI_VISION_MODEL') ?? 'gemini-2.5-flash';
  }
}

/** Infers the provider from a key's prefix. Order matters: Anthropic keys also start with "sk-". */
export function detectProvider(key: string): ProviderId {
  const k = key.trim();
  if (k.startsWith('sk-ant-')) return 'anthropic';
  if (k.startsWith('gsk_')) return 'groq';
  if (k.startsWith('sk-') || k.startsWith('proj-')) return 'openai';
  return 'google'; // AIza… / AQ.… Gemini keys
}

/**
 * Whether a provider's error says the key itself was refused (wrong, revoked or expired), not just
 * this one request. Gemini answers a bad or expired key with 400 API_KEY_INVALID, which it also
 * uses for a request it can't handle, so for Google a 400 counts only when the body names the key.
 */
export function isKeyRefusal(provider: ProviderId, status: number, body = ''): boolean {
  if (status === 401 || status === 403) return true;
  return provider === 'google' && status === 400 && /API_KEY_INVALID|API key not valid|API key expired/i.test(body);
}

const ENV_KEYS: { name: string }[] = [
  { name: 'GROQ_API_KEY' },
  { name: 'OPENAI_API_KEY' },
  { name: 'GEMINI_API_KEY' },
  { name: 'ANTHROPIC_API_KEY' },
];

/**
 * Whether a server key is used to read documents. The server Groq key is not, unless a vision
 * model is chosen for it (GROQ_VISION_MODEL): on Groq's free tier the vision model allows 1,000
 * output tokens a minute, and one read needs more, so every attempt failed and only added delay.
 * The key still transcribes voice notes (modules/transcription reads it directly). A Groq key a
 * user saves is always tried: it may be on a paid tier.
 */
function readsDocuments(name: string): boolean {
  return name !== 'GROQ_API_KEY' || Boolean(env('GROQ_VISION_MODEL'));
}

/** Keys to try, in order: the user's saved key (BYOK), then server keys. Duplicates removed. */
export function providerCandidates(customApiKey?: string | null): ProviderCandidate[] {
  const raw: { apiKey: string; source: string }[] = [];
  const custom = customApiKey?.trim();
  if (custom) raw.push({ apiKey: custom, source: 'saved key' });
  for (const { name } of ENV_KEYS) {
    const value = env(name);
    if (value && readsDocuments(name)) raw.push({ apiKey: value, source: name });
  }

  const seen = new Set<string>();
  return raw.flatMap(({ apiKey, source }) => {
    if (seen.has(apiKey)) return [];
    seen.add(apiKey);
    const provider = detectProvider(apiKey);
    return [{ apiKey, source, provider, modelName: defaultModel(provider) }];
  });
}

export function hasServerProvider(): boolean {
  return ENV_KEYS.some(({ name }) => env(name) && readsDocuments(name));
}
