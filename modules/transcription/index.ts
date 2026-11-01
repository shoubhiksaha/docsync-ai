/**
 * Transcription module — voice notes to text. Tries the saved key, then Groq Whisper,
 * Gemini and OpenAI Whisper, moving on after any failure. Independent of extraction:
 * if transcription is down, scanning and syncing still work.
 *
 * Server keys have circuit breakers, as in modules/ai: a provider that keeps failing or hanging
 * is skipped for a minute instead of costing every voice note its 30 s. Busy is not broken: a
 * 429/5xx, or one recording the provider refused, never counts towards the breaker.
 */
import { OpenAI, toFile } from 'openai';
import { env, isModuleEnabled } from '@/core/env';
import { circuitState, errorStatus, pausedUntil, recordFailure, recordSuccess } from '@/core/isolation';
import { detectProvider } from '@/modules/ai';

export const MAX_AUDIO_BYTES = 10 * 1024 * 1024;
/** All attempts together, inside the route's 60 s maxDuration, so the user hears "type a note instead" rather than a platform timeout. */
export const TRANSCRIBE_BUDGET_MS = 45_000;
const PER_CALL_MS = 30_000;
/** Less than this left: don't start another provider. */
const MIN_CALL_MS = 3_000;
/** Gemini models that transcribe, in order; GEMINI_AUDIO_MODEL goes first (like the *_VISION_MODEL settings). */
const GEMINI_AUDIO_MODELS = ['gemini-2.5-flash', 'gemini-3-flash-preview'];
/** Statuses a provider gives for this recording itself: too large, unsupported format. */
const REQUEST_SPECIFIC_STATUSES = new Set([400, 413, 415, 422]);
/** Server-key providers, each with its own breaker (`stt:<provider>`). */
const SERVER_PROVIDERS = ['groq', 'google', 'openai'] as const;

/**
 * Whether a failure says the shared server key's provider is broken (key refused, model gone,
 * network down, or hanging for a whole call), so it counts towards the breaker that pauses it.
 */
function countsAgainstProvider(err: unknown, timeoutMs: number): boolean {
  const status = errorStatus(err);
  if (status !== undefined) return status !== 429 && status < 500 && !REQUEST_SPECIFIC_STATUSES.has(status);
  if (err instanceof Error && (/timed? ?out/i.test(err.message) || err.name === 'TimeoutError' || err.name === 'AbortError')) {
    return timeoutMs >= PER_CALL_MS;
  }
  return true;
}

type Runner = (key: string, timeoutMs: number) => Promise<string | null>;

export interface TranscribeInput {
  audio: Buffer;
  fileName: string;
  mimeType: string;
  customApiKey?: string | null;
  /** The app's language. Hindi tells Whisper to expect Hindi, which keeps it in Devanagari rather than Urdu script or English. */
  language?: 'en' | 'hi';
  /** When the upload finished arriving (Date.now()); the time budget counts from here. */
  startedAt?: number;
}

const GEMINI_PROMPT = 'Transcribe the following audio file accurately, in the language that is spoken. Do not translate. Write Hindi in Devanagari script. Return ONLY the raw transcribed text. Do not include quotes or any conversational filler.';

function audioMime(mimeType: string, fileName: string): string {
  const base = mimeType.split(';')[0].trim();
  if (base.startsWith('audio/') || base.startsWith('video/')) return base.replace(/^video\//, 'audio/');
  return fileName.endsWith('.mp3') ? 'audio/mp3' : 'audio/webm';
}

function extensionFor(mime: string): string {
  if (mime.includes('mp4') || mime.includes('m4a') || mime.includes('aac')) return 'm4a';
  if (mime.includes('mpeg') || mime.includes('mp3')) return 'mp3';
  if (mime.includes('ogg')) return 'ogg';
  if (mime.includes('wav')) return 'wav';
  return 'webm';
}

/**
 * The plain MIME type and file extension of a recording. Recorders report 'audio/mp4' (iPhone) or
 * 'audio/webm;codecs=opus' (Chrome); a file stored under the wrong extension won't play on many phones.
 */
export function audioFormat(mimeType: string, fileName = ''): { mimeType: string; extension: string } {
  const mime = audioMime(mimeType, fileName);
  return { mimeType: mime, extension: extensionFor(mime) };
}

export async function transcribeAudio(input: TranscribeInput): Promise<string | null> {
  if (!isModuleEnabled('transcription')) return null;

  const { mimeType: mime, extension } = audioFormat(input.mimeType, input.fileName);
  const fileName = `voicenote.${extension}`;
  const deadline = (input.startedAt ?? Date.now()) + TRANSCRIBE_BUDGET_MS;
  const timeLeft = () => deadline - Date.now();

  const whisper = (baseURL: string, model: string): Runner => async (key, timeoutMs) => {
    const client = new OpenAI({ apiKey: key, baseURL, timeout: timeoutMs, maxRetries: 0 });
    const response = await client.audio.transcriptions.create({
      file: await toFile(input.audio, fileName, { type: mime }),
      model,
      ...(input.language === 'hi' ? { language: 'hi' } : {}),
    });
    return response.text || null;
  };

  const gemini: Runner = async key => {
    const chosen = env('GEMINI_AUDIO_MODEL');
    for (const model of chosen ? [chosen, ...GEMINI_AUDIO_MODELS.filter(m => m !== chosen)] : GEMINI_AUDIO_MODELS) {
      if (timeLeft() < MIN_CALL_MS) break;
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify({
          contents: [{
            role: 'user',
            parts: [
              { text: GEMINI_PROMPT },
              { inlineData: { mimeType: mime, data: input.audio.toString('base64') } },
            ],
          }],
        }),
        signal: AbortSignal.timeout(Math.min(PER_CALL_MS, timeLeft())),
      });
      if (res.ok) {
        const data = await res.json();
        const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (typeof text === 'string' && text.trim()) return text.trim();
      } else if (!(res.status >= 500 || res.status === 404 || res.status === 429)) {
        throw Object.assign(new Error(`Gemini ${res.status}`), { status: res.status });
      }
    }
    return null;
  };

  const runners: Record<string, Runner> = {
    groq: whisper('https://api.groq.com/openai/v1', 'whisper-large-v3'),
    openai: whisper('https://api.openai.com/v1', 'whisper-1'),
    google: gemini,
  };

  // `breaker` only for a server key: a saved key belongs to one user.
  const pipeline: { name: string; key: string; run: Runner; breaker?: string }[] = [];
  const custom = input.customApiKey?.trim();
  if (custom) {
    const provider = detectProvider(custom);
    // Anthropic has no speech-to-text API; fall through to server keys.
    if (runners[provider]) pipeline.push({ name: `${provider} (saved key)`, key: custom, run: runners[provider] });
  }
  const groq = env('GROQ_API_KEY');
  const gem = env('GEMINI_API_KEY');
  const oai = env('OPENAI_API_KEY');
  if (groq) pipeline.push({ name: 'Groq', key: groq, run: runners.groq, breaker: 'stt:groq' });
  if (gem) pipeline.push({ name: 'Gemini', key: gem, run: runners.google, breaker: 'stt:google' });
  if (oai) pipeline.push({ name: 'OpenAI', key: oai, run: runners.openai, breaker: 'stt:openai' });

  // No keys at all: null, so the user is told to type the note. Sample text would end up in their sheet.
  if (pipeline.length === 0) console.warn('[transcription] no speech-to-text key is configured');

  for (const attempt of pipeline) {
    if (attempt.breaker && pausedUntil(attempt.breaker)) {
      console.warn(`[transcription] ${attempt.name} is paused after repeated failures; trying the next one`);
      continue;
    }
    if (timeLeft() < MIN_CALL_MS) {
      console.warn(`[transcription] time budget used up; skipping ${attempt.name} and the rest`);
      break;
    }
    const timeoutMs = Math.min(PER_CALL_MS, timeLeft());
    try {
      const text = await attempt.run(attempt.key, timeoutMs);
      if (attempt.breaker) recordSuccess(attempt.breaker);
      if (text) return text;
    } catch (error) {
      if (attempt.breaker && countsAgainstProvider(error, timeoutMs)) recordFailure(attempt.breaker);
      console.warn(`[transcription] ${attempt.name} failed:`, error instanceof Error ? error.message : error);
    }
  }
  return null;
}

export function transcriptionHealth() {
  return {
    enabled: isModuleEnabled('transcription'),
    configured: Boolean(env('GROQ_API_KEY') || env('GEMINI_API_KEY') || env('OPENAI_API_KEY')),
    circuit: SERVER_PROVIDERS.some(p => circuitState(`stt:${p}`) === 'open') ? 'open' as const : 'closed' as const,
  };
}
