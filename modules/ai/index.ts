/**
 * AI module — the only place that talks to LLM providers.
 *
 * chatJson() walks the provider chain (saved key → Groq → OpenAI → Gemini → Anthropic) and moves
 * on after ANY provider error, so one provider being down, out of quota, retired a model, or
 * rejecting a key never blocks the others. Server-key providers have circuit breakers, so a
 * broken provider is skipped for a minute instead of adding latency to every request.
 *
 * Busy is not broken: a 429/5xx never counts towards the breaker. A provider that names a wait
 * (Retry-After) is skipped for exactly that long, and when every provider failed, the ones that
 * were only busy get one more try after a short wait, within the request's time budget.
 */
import { isModuleEnabled } from '@/core/env';
import { BREAKER_COOLDOWN_MS, circuitState, pauseCircuit, pausedUntil, recordFailure, recordSuccess, withTimeout } from '@/core/isolation';
import { ProviderHttpError, UniversalAIAdapter, type VisionImage } from './adapter';
import { hasServerProvider, providerCandidates, type ProviderCandidate } from './providers';

export { parseRetryAfter, ProviderHttpError, UniversalAIAdapter } from './adapter';
export type { VisionImage } from './adapter';
export { defaultModel, detectProvider, providerCandidates, type ProviderCandidate, type ProviderId } from './providers';

export interface AttemptError {
  provider: string;
  source: string;
  error: string;
}

export class AIUnavailableError extends Error {
  constructor(public readonly attempts: AttemptError[]) {
    super(attempts.length
      ? `All AI providers failed: ${attempts.map(a => `${a.provider} (${a.source}): ${a.error}`).join(' | ')}`
      : 'No AI provider is configured.');
    this.name = 'AIUnavailableError';
  }

  /** True when every attempt looks like a quota / rate-limit / capacity problem. */
  get quotaLike(): boolean {
    return this.attempts.length > 0 && this.attempts.every(a => isQuotaLike(a.error));
  }
}

export function isQuotaLike(message: string): boolean {
  const m = message.toLowerCase();
  return /\b(408|409|429|5\d\d)\b/.test(message)
    || m.includes('resource_exhausted')
    || m.includes('quota')
    || m.includes('rate limit')
    || m.includes('overloaded')
    || m.includes('paused');
}

export interface ChatJsonOptions {
  system: string;
  user: string;
  images?: VisionImage[];
  customApiKey?: string | null;
  /** Total time budget across all providers. */
  deadlineMs?: number;
}

export interface ChatJsonResult {
  text: string;
  provider: string;
  source: string;
}

function breakerKey(c: ProviderCandidate): string | null {
  // BYOK keys belong to one user; only shared server keys get a shared breaker.
  return c.source === 'saved key' ? null : `ai:${c.provider}:${c.source}`;
}

export function aiCandidates(customApiKey?: string | null): ProviderCandidate[] {
  return isModuleEnabled('ai') ? providerCandidates(customApiKey) : [];
}

/** Longest a request waits for a busy provider before its one extra pass over the chain. */
export const MAX_RETRY_WAIT_MS = 8_000;
/** The extra pass waits 2–4 s when no provider named a wait (spread out so retries don't bunch up). */
const RETRY_BASE_MS = 2_000;
const RETRY_JITTER_MS = 2_000;
/** Time a vision call needs; there is no extra pass when less than this would be left. */
const MIN_CALL_BUDGET_MS = 12_000;

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

export async function chatJson(opts: ChatJsonOptions): Promise<ChatJsonResult> {
  const candidates = aiCandidates(opts.customApiKey);
  const attempts: AttemptError[] = [];
  const deadline = Date.now() + (opts.deadlineMs ?? 50_000);
  /** Providers that were only busy, and when they can be tried again. */
  const busyUntil = new Map<ProviderCandidate, number>();

  async function tryEach(list: ProviderCandidate[]): Promise<ChatJsonResult | null> {
    for (const candidate of list) {
      const key = breakerKey(candidate);
      const paused = key ? pausedUntil(key) : 0;
      if (paused) {
        busyUntil.set(candidate, paused);
        attempts.push({ provider: candidate.provider, source: candidate.source, error: 'paused (rate limit or repeated failures)' });
        continue;
      }
      const remaining = deadline - Date.now();
      if (remaining < 2_000) {
        attempts.push({ provider: candidate.provider, source: candidate.source, error: 'skipped: request time budget exhausted' });
        break;
      }

      try {
        const adapter = new UniversalAIAdapter({
          apiKey: candidate.apiKey,
          provider: candidate.provider,
          modelName: candidate.modelName,
          timeoutMs: Math.min(remaining, 40_000),
        });
        const text = await withTimeout(adapter.chat(opts.system, opts.user, opts.images ?? []), remaining, `ai:${candidate.provider}`);
        if (key) recordSuccess(key);
        busyUntil.delete(candidate);
        return { text, provider: candidate.provider, source: candidate.source };
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        if (err instanceof ProviderHttpError && err.transient) {
          const readyAt = Date.now() + (err.retryAfterMs ?? 0);
          busyUntil.set(candidate, readyAt);
          if (key && err.retryAfterMs) pauseCircuit(key, Math.min(readyAt, Date.now() + BREAKER_COOLDOWN_MS));
        } else {
          busyUntil.delete(candidate);
          if (key) recordFailure(key);
        }
        attempts.push({ provider: candidate.provider, source: candidate.source, error: error.slice(0, 500) });
        console.warn(`[ai] ${candidate.provider} (${candidate.source}) failed, trying next provider:`, error.slice(0, 300));
      }
    }
    return null;
  }

  const first = await tryEach(candidates);
  if (first) return first;

  // Every provider failed. Busy ones (overloaded, or rate-limited for a few seconds) usually
  // recover quickly, so wait briefly and try those once more, if the time budget allows.
  const now = Date.now();
  const retry = candidates.filter(c => (busyUntil.get(c) ?? Infinity) - now <= MAX_RETRY_WAIT_MS);
  if (retry.length > 0) {
    const earliest = Math.min(...retry.map(c => busyUntil.get(c)! - now));
    const wait = Math.max(earliest, RETRY_BASE_MS + Math.random() * RETRY_JITTER_MS);
    if (deadline - now - wait >= MIN_CALL_BUDGET_MS) {
      console.warn(`[ai] every provider was busy; trying ${retry.length} again in ${Math.round(wait)}ms`);
      await sleep(wait);
      const second = await tryEach(retry.filter(c => busyUntil.get(c)! <= Date.now()));
      if (second) return second;
    }
  }

  throw new AIUnavailableError(attempts);
}

export function aiHealth() {
  const keys = ['GROQ_API_KEY', 'OPENAI_API_KEY', 'GEMINI_API_KEY', 'ANTHROPIC_API_KEY'];
  const open = providerCandidates().some(c => {
    const key = breakerKey(c);
    return key ? circuitState(key) === 'open' : false;
  });
  return {
    enabled: isModuleEnabled('ai'),
    configured: hasServerProvider(),
    circuit: open ? 'open' as const : 'closed' as const,
    providers: keys.filter(k => process.env[k]?.trim()).length,
  };
}
