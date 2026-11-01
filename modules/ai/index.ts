/**
 * AI module — the only place that talks to LLM providers.
 *
 * chatJson() walks the provider chain (saved key → Groq → OpenAI → Gemini → Anthropic) and moves
 * on after ANY provider error, so one provider being down, out of quota, retired a model, or
 * rejecting a key never blocks the others. Server-key providers have circuit breakers, so a
 * broken provider is skipped for a minute instead of adding latency to every request.
 *
 * An answer the caller can't use (cut off, or not the expected JSON; see `accept`) also moves on
 * to the next provider, without counting against this one.
 *
 * Busy is not broken: a 429/5xx never counts towards the breaker, and neither does one user's
 * request the provider refused for its content (see countsAgainstProvider). A provider that names a wait
 * (Retry-After) is skipped for exactly that long, and when every provider failed, the ones that
 * were only busy get one more try after a short wait, within the request's time budget.
 */
import { isModuleEnabled } from '@/core/env';
import { BREAKER_COOLDOWN_MS, circuitState, pauseCircuit, pausedUntil, recordFailure, recordSuccess, TimeoutError, withTimeout } from '@/core/isolation';
import { ProviderHttpError, UniversalAIAdapter, UnusableAnswerError, type VisionImage } from './adapter';
import { hasServerProvider, isKeyRefusal, providerCandidates, type ProviderCandidate } from './providers';

export { parseRetryAfter, ProviderHttpError, UniversalAIAdapter, UnusableAnswerError } from './adapter';
export type { VisionImage } from './adapter';
export { defaultModel, detectProvider, isKeyRefusal, providerCandidates, type ProviderCandidate, type ProviderId } from './providers';

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
  /** Checks an answer before it is returned; a rejected answer moves on to the next provider. */
  accept?: (text: string) => boolean;
}

export interface ChatJsonResult {
  text: string;
  provider: string;
  source: string;
  /** The user's saved key was refused (see isKeyRefusal), so another key answered: the user should check it in Settings. */
  savedKeyRefused?: true;
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
/** Longest one provider call may take. */
const PER_CALL_MS = 40_000;

/** Statuses a provider gives for this request's own content: image too large, too many pixels, content filter. */
const REQUEST_SPECIFIC_STATUSES = new Set([400, 413, 415, 422]);

/**
 * Whether a failure says the shared server provider is broken (key refused, model retired, network
 * down), so it counts towards the breaker that pauses it for everyone. One user's oversized or
 * filtered photo doesn't, and nor does running out of time on a heavy multi-page request or on the
 * little budget a request had left: those say nothing about the provider. An expired Gemini key
 * answers 400 like an oversized photo does, but names the key.
 */
function countsAgainstProvider(err: unknown, candidate: ProviderCandidate, images: number, timeoutMs: number): boolean {
  if (err instanceof ProviderHttpError) {
    return !REQUEST_SPECIFIC_STATUSES.has(err.status)
      || /decommission|model_not_found/i.test(err.message)
      || isKeyRefusal(candidate.provider, err.status, err.message);
  }
  if (err instanceof TimeoutError || (err instanceof Error && err.name === 'AbortError')) {
    return images <= 1 && timeoutMs >= PER_CALL_MS;
  }
  return true;
}

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

export async function chatJson(opts: ChatJsonOptions): Promise<ChatJsonResult> {
  const candidates = aiCandidates(opts.customApiKey);
  const attempts: AttemptError[] = [];
  const deadline = Date.now() + (opts.deadlineMs ?? 50_000);
  /** Providers that were only busy, and when they can be tried again. */
  const busyUntil = new Map<ProviderCandidate, number>();
  let savedKeyRefused = false;
  const result = (text: string, candidate: ProviderCandidate): ChatJsonResult => ({
    text,
    provider: candidate.provider,
    source: candidate.source,
    ...(savedKeyRefused ? { savedKeyRefused: true as const } : {}),
  });

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

      const timeoutMs = Math.min(remaining, PER_CALL_MS);
      try {
        const adapter = new UniversalAIAdapter({
          apiKey: candidate.apiKey,
          provider: candidate.provider,
          modelName: candidate.modelName,
          timeoutMs,
        });
        const text = await withTimeout(adapter.chat(opts.system, opts.user, opts.images ?? []), remaining, `ai:${candidate.provider}`);
        if (opts.accept && !opts.accept(text)) throw new UnusableAnswerError(`${candidate.provider} gave an answer in the wrong format`);
        if (key) recordSuccess(key);
        busyUntil.delete(candidate);
        return result(text, candidate);
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        if (err instanceof UnusableAnswerError) {
          busyUntil.delete(candidate);
        } else if (err instanceof ProviderHttpError && err.transient) {
          const readyAt = Date.now() + (err.retryAfterMs ?? 0);
          busyUntil.set(candidate, readyAt);
          if (key && err.retryAfterMs) pauseCircuit(key, Math.min(readyAt, Date.now() + BREAKER_COOLDOWN_MS));
        } else {
          busyUntil.delete(candidate);
          if (key && countsAgainstProvider(err, candidate, opts.images?.length ?? 0, timeoutMs)) recordFailure(key);
          if (candidate.source === 'saved key' && err instanceof ProviderHttpError && isKeyRefusal(candidate.provider, err.status, err.message)) savedKeyRefused = true;
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

/** Reported by the public /api/health: whether reading works, never how many provider keys there are. */
export function aiHealth() {
  const open = providerCandidates().some(c => {
    const key = breakerKey(c);
    return key ? circuitState(key) === 'open' : false;
  });
  return {
    enabled: isModuleEnabled('ai'),
    configured: hasServerProvider(),
    circuit: open ? 'open' as const : 'closed' as const,
  };
}
