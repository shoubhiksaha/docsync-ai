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
    case 'google': return env('GEMINI_VISION_MODEL') ?? 'gemini-3.6-flash';
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

const ENV_KEYS: { name: string }[] = [
  { name: 'GROQ_API_KEY' },
  { name: 'OPENAI_API_KEY' },
  { name: 'GEMINI_API_KEY' },
  { name: 'ANTHROPIC_API_KEY' },
];

/** Keys to try, in order: the user's saved key (BYOK), then server keys. Duplicates removed. */
export function providerCandidates(customApiKey?: string | null): ProviderCandidate[] {
  const raw: { apiKey: string; source: string }[] = [];
  const custom = customApiKey?.trim();
  if (custom) raw.push({ apiKey: custom, source: 'saved key' });
  for (const { name } of ENV_KEYS) {
    const value = env(name);
    if (value) raw.push({ apiKey: value, source: name });
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
  return ENV_KEYS.some(({ name }) => env(name));
}
