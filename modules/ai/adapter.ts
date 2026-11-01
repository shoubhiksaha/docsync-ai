import { defaultModel, type ProviderId } from './providers';

const AI_REQUEST_TIMEOUT_MS = 45000;

function isKnownProvider(provider: string): provider is ProviderId {
    return provider === 'openai' || provider === 'anthropic' || provider === 'google' || provider === 'groq';
}

function stripMarkdownFences(raw: string): string {
    return raw
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/\s*```\s*$/, '')
        .trim();
}

/** Statuses that mean "busy or rate-limited, try again shortly" rather than "this request is wrong". */
const TRANSIENT_STATUSES = new Set([408, 429, 500, 502, 503, 504, 529]);

export function isTransientStatus(status: number): boolean {
    return TRANSIENT_STATUSES.has(status);
}

/** A provider's HTTP error, with how long it asked us to wait when it said (Retry-After). */
export class ProviderHttpError extends Error {
    constructor(
        message: string,
        public readonly status: number,
        public readonly retryAfterMs?: number,
        public readonly transient = isTransientStatus(status),
    ) {
        super(message);
        this.name = 'ProviderHttpError';
    }
}

/**
 * The provider answered, but not with something usable: cut off at its output limit, or not
 * the JSON asked for. The next provider may well do better; this one isn't broken.
 */
export class UnusableAnswerError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'UnusableAnswerError';
    }
}

const DURATION_UNITS: Record<string, number> = { ms: 1, s: 1000, m: 60_000, h: 3_600_000 };

/**
 * The wait a provider asked for: the Retry-After header (seconds or an HTTP date), else the
 * wait named in the body (Groq: "Please try again in 1m2.5s", Gemini: "retryDelay": "37s").
 */
export function parseRetryAfter(header: string | null | undefined, body: string, now = Date.now()): number | undefined {
    if (header?.trim()) {
        const seconds = Number(header);
        if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
        const date = Date.parse(header);
        if (!Number.isNaN(date)) return Math.max(0, date - now);
    }
    const phrase = body.match(/try again in ((?:\d+(?:\.\d+)?(?:ms|h|m|s))+)/i)?.[1]
        ?? body.match(/"retryDelay"\s*:\s*"(\d+(?:\.\d+)?s)"/)?.[1];
    if (!phrase) return undefined;
    let ms = 0;
    for (const [, n, unit] of phrase.matchAll(/(\d+(?:\.\d+)?)(ms|h|m|s)/g)) ms += Number(n) * DURATION_UNITS[unit];
    return Math.round(ms);
}

async function providerError(label: string, response: Response): Promise<ProviderHttpError> {
    const body = await response.text().catch(() => '');
    return new ProviderHttpError(
        `${label} API Error: ${response.status} - ${body}`,
        response.status,
        parseRetryAfter(response.headers?.get('retry-after'), body),
    );
}

export interface UniversalAIConfig {
    apiKey: string;
    provider?: string;
    modelName?: string;
    baseUrl?: string;
    apiVersion?: string;
    timeoutMs?: number;
}

export interface VisionImage {
    mimeType: string;
    base64Data: string;
}

export class UniversalAIAdapter {
    apiKey: string;
    provider: string;
    modelName: string;
    baseUrl: string;
    apiVersion?: string;
    timeoutMs: number;

    constructor(config: UniversalAIConfig) {
        if (!config.apiKey) throw new Error("API Key is required for BYOK Adapter");

        this.apiKey = config.apiKey;
        this.provider = (config.provider || 'openai').toLowerCase();
        this.timeoutMs = config.timeoutMs ?? AI_REQUEST_TIMEOUT_MS;

        this.modelName = config.modelName
            || (isKnownProvider(this.provider) ? defaultModel(this.provider) : defaultModel('openai'));

        if (config.apiVersion) {
            this.apiVersion = config.apiVersion;
        }

        if (config.baseUrl) {
            this.baseUrl = config.baseUrl;
        } else {
            const urlMap: Record<string, string> = {
                openai: 'https://api.openai.com/v1/chat/completions',
                anthropic: 'https://api.anthropic.com/v1/messages',
                google: `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(this.modelName)}:generateContent`,
                cohere: 'https://api.cohere.ai/v2/chat',
                huggingface: `https://api-inference.huggingface.co/models/${this.modelName}`,
                xai: 'https://api.x.ai/v1/chat/completions',
                groq: 'https://api.groq.com/openai/v1/chat/completions',
                deepseek: 'https://api.deepseek.com/v1/chat/completions',
                mistral: 'https://api.mistral.ai/v1/chat/completions',
                perplexity: 'https://api.perplexity.ai/chat/completions',
                together: 'https://api.together.xyz/v1/chat/completions',
                openrouter: 'https://openrouter.ai/api/v1/chat/completions',
            };
            this.baseUrl = urlMap[this.provider] || urlMap['openai'];
        }
    }

    async _fetch(url: string, options: RequestInit) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
        try {
            const response = await fetch(url, {
                ...options,
                signal: controller.signal,
            });
            return response;
        } finally {
            clearTimeout(timeout);
        }
    }

    async chat(systemPrompt: string, userPrompt: string, images: VisionImage[] = []): Promise<string> {
        const openaiCompatible = [
            'openai', 'groq', 'deepseek', 'mistral', 'perplexity',
            'together', 'openrouter', 'ollama', 'local', 'xai'
        ];

        if (openaiCompatible.includes(this.provider)) {
            return this._chatOpenAICompatible(systemPrompt, userPrompt, images);
        } else if (this.provider === 'google') {
            return this._chatGoogle(systemPrompt, userPrompt, images);
        } else if (this.provider === 'anthropic') {
            return this._chatAnthropic(systemPrompt, userPrompt, images);
        } else {
            return this._chatOpenAICompatible(systemPrompt, userPrompt, images);
        }
    }

    async _chatOpenAICompatible(systemPrompt: string, userPrompt: string, images: VisionImage[]) {
        const headers: Record<string, string> = {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${this.apiKey}`
        };

        const userContent: Record<string, unknown>[] = [{ type: "text", text: userPrompt }];
        for (const img of images) {
            userContent.push({
                type: "image_url",
                image_url: { url: `data:${img.mimeType};base64,${img.base64Data}` }
            });
        }

        const messages = [];
        if (systemPrompt) messages.push({ role: "system", content: systemPrompt });
        messages.push({ role: "user", content: userContent });

        const payload: Record<string, unknown> = {
            model: this.modelName,
            messages,
            response_format: { type: "json_object" },
            temperature: 0.1
        };

        const response = await this._fetch(this.baseUrl, { method: 'POST', headers, body: JSON.stringify(payload) });
        if (!response.ok) throw await providerError(this.provider, response);

        const data = await response.json();
        if (data?.choices?.[0]?.finish_reason === 'length') throw new UnusableAnswerError(`${this.provider} answer was cut off at its output limit`);
        const content = data?.choices?.[0]?.message?.content;
        if (typeof content !== 'string') throw new Error('No extraction returned');

        return stripMarkdownFences(content);
    }

    async _chatGoogle(systemPrompt: string, userPrompt: string, images: VisionImage[]) {
        const modelsToTry = [this.modelName, 'gemini-3-flash-preview', 'gemini-2.5-flash'];
        const uniqueModels = Array.from(new Set(modelsToTry));
        const failures: ProviderHttpError[] = [];

        for (let i = 0; i < uniqueModels.length; i++) {
            const modelToTry = uniqueModels[i];
            const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelToTry)}:generateContent`;

            const headers: Record<string, string> = {
                "Content-Type": "application/json",
                "x-goog-api-key": this.apiKey
            };

            const userParts: Record<string, unknown>[] = [{ text: userPrompt }];
            for (const img of images) {
                userParts.push({
                    inlineData: { mimeType: img.mimeType, data: img.base64Data }
                });
            }

            const payload: Record<string, unknown> = {
                contents: [{ role: "user", parts: userParts }],
                generationConfig: {
                    responseMimeType: "application/json",
                    temperature: 0.1
                }
            };

            if (systemPrompt) {
                payload['systemInstruction'] = {
                    parts: [{ text: systemPrompt }]
                };
            }

            const response = await this._fetch(url, { method: 'POST', headers, body: JSON.stringify(payload) });
            if (!response.ok) {
                const failure = await providerError('Google', response);
                failures.push(failure);
                // Try fallback on 5xx, 429 (Rate Limit/Quota), or 404 (model not found)
                if ((response.status >= 500 || response.status === 429 || response.status === 404) && i < uniqueModels.length - 1) {
                    console.warn(`Google API Error with ${modelToTry}: ${response.status}. Trying fallback...`);
                    continue;
                }
                // Busy if any model was only busy. Name a wait only if every model named one:
                // an overloaded model (503) may clear sooner than a rate-limited one.
                const waits = failures.map(f => f.retryAfterMs);
                const retryAfterMs = waits.every((w): w is number => w !== undefined) ? Math.min(...waits) : undefined;
                throw new ProviderHttpError(failure.message, failure.status, retryAfterMs, failures.some(f => f.transient));
            }

            const data = await response.json();
            if (data?.candidates?.[0]?.finishReason === 'MAX_TOKENS') throw new UnusableAnswerError('Google answer was cut off at its output limit');
            const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
            if (typeof text !== 'string') {
                if (i < uniqueModels.length - 1) continue;
                throw new Error('No extraction returned');
            }

            return stripMarkdownFences(text);
        }

        return ''; // Unreachable due to the error thrown inside the loop
    }

    async _chatAnthropic(systemPrompt: string, userPrompt: string, images: VisionImage[]) {
        const headers = {
            "x-api-key": this.apiKey,
            "anthropic-version": "2023-06-01",
            "Content-Type": "application/json"
        };

        const userContent: Record<string, unknown>[] = [];
        for (const img of images) {
            userContent.push({
                type: "image",
                source: {
                    type: "base64",
                    media_type: img.mimeType,
                    data: img.base64Data
                }
            });
        }
        userContent.push({ type: "text", text: userPrompt });

        const payload: Record<string, unknown> = {
            model: this.modelName,
            // Dense pages (muster rolls, khata ledgers) return up to 100 fields; 4096 cut them off.
            max_tokens: 8192,
            messages: [{ role: "user", content: userContent }],
            temperature: 0.1
        };

        if (systemPrompt) payload['system'] = systemPrompt;

        const response = await this._fetch(this.baseUrl, { method: 'POST', headers, body: JSON.stringify(payload) });
        if (!response.ok) throw await providerError('Anthropic', response);

        const data = await response.json();
        if (data?.stop_reason === 'max_tokens') throw new UnusableAnswerError('Anthropic answer was cut off at its output limit');
        const rawText = data?.content?.[0]?.text;
        if (typeof rawText !== 'string') throw new Error('No extraction returned');

        return stripMarkdownFences(rawText);
    }
}
