/**
 * Transcription module — voice notes to text. Tries the saved key, then Groq Whisper,
 * Gemini and OpenAI Whisper, moving on after any failure. Independent of extraction:
 * if transcription is down, scanning and syncing still work.
 */
import { OpenAI, toFile } from 'openai';
import { env, isModuleEnabled } from '@/core/env';
import { detectProvider } from '@/modules/ai';

export const MAX_AUDIO_BYTES = 10 * 1024 * 1024;
/** All attempts together, inside the route's 60 s maxDuration, so the user hears "type a note instead" rather than a platform timeout. */
export const TRANSCRIBE_BUDGET_MS = 45_000;
const PER_CALL_MS = 30_000;
/** Less than this left: don't start another provider. */
const MIN_CALL_MS = 3_000;
const MOCK_TEXT = 'This is a mock transcription because no API keys were provided. Please check your settings.';

type Runner = (key: string, timeoutMs: number) => Promise<string | null>;

export interface TranscribeInput {
  audio: Buffer;
  fileName: string;
  mimeType: string;
  customApiKey?: string | null;
}

function audioMime(mimeType: string, fileName: string): string {
  const base = mimeType.split(';')[0].trim();
  if (base.startsWith('audio/') || base.startsWith('video/')) return base.replace(/^video\//, 'audio/');
  return fileName.endsWith('.mp3') ? 'audio/mp3' : 'audio/webm';
}

function fileNameFor(mime: string): string {
  if (mime.includes('mp4') || mime.includes('m4a') || mime.includes('aac')) return 'voicenote.m4a';
  if (mime.includes('mpeg') || mime.includes('mp3')) return 'voicenote.mp3';
  if (mime.includes('ogg')) return 'voicenote.ogg';
  if (mime.includes('wav')) return 'voicenote.wav';
  return 'voicenote.webm';
}

export async function transcribeAudio(input: TranscribeInput): Promise<string | null> {
  if (!isModuleEnabled('transcription')) return null;

  const mime = audioMime(input.mimeType, input.fileName);
  const fileName = fileNameFor(mime);
  const deadline = Date.now() + TRANSCRIBE_BUDGET_MS;
  const timeLeft = () => deadline - Date.now();

  const whisper = (baseURL: string, model: string): Runner => async (key, timeoutMs) => {
    const client = new OpenAI({ apiKey: key, baseURL, timeout: timeoutMs, maxRetries: 0 });
    const response = await client.audio.transcriptions.create({ file: await toFile(input.audio, fileName, { type: mime }), model });
    return response.text || null;
  };

  const gemini: Runner = async key => {
    for (const model of ['gemini-2.5-flash', 'gemini-3-flash-preview']) {
      if (timeLeft() < MIN_CALL_MS) break;
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify({
          contents: [{
            role: 'user',
            parts: [
              { text: 'Transcribe the following audio file accurately. Return ONLY the raw transcribed text. Do not include quotes or any conversational filler.' },
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
        throw new Error(`Gemini ${res.status}`);
      }
    }
    return null;
  };

  const runners: Record<string, Runner> = {
    groq: whisper('https://api.groq.com/openai/v1', 'whisper-large-v3'),
    openai: whisper('https://api.openai.com/v1', 'whisper-1'),
    google: gemini,
  };

  const pipeline: { name: string; key: string; run: Runner }[] = [];
  const custom = input.customApiKey?.trim();
  if (custom) {
    const provider = detectProvider(custom);
    // Anthropic has no speech-to-text API; fall through to server keys.
    if (runners[provider]) pipeline.push({ name: `${provider} (saved key)`, key: custom, run: runners[provider] });
  }
  const groq = env('GROQ_API_KEY');
  const gem = env('GEMINI_API_KEY');
  const oai = env('OPENAI_API_KEY');
  if (groq) pipeline.push({ name: 'Groq', key: groq, run: runners.groq });
  if (gem) pipeline.push({ name: 'Gemini', key: gem, run: runners.google });
  if (oai) pipeline.push({ name: 'OpenAI', key: oai, run: runners.openai });

  if (!custom && pipeline.length === 0) return MOCK_TEXT;

  for (const attempt of pipeline) {
    if (timeLeft() < MIN_CALL_MS) {
      console.warn(`[transcription] time budget used up; skipping ${attempt.name} and the rest`);
      break;
    }
    try {
      const text = await attempt.run(attempt.key, Math.min(PER_CALL_MS, timeLeft()));
      if (text) return text;
    } catch (error) {
      console.warn(`[transcription] ${attempt.name} failed:`, error instanceof Error ? error.message : error);
    }
  }
  return null;
}

export function transcriptionHealth() {
  return {
    enabled: isModuleEnabled('transcription'),
    configured: Boolean(env('GROQ_API_KEY') || env('GEMINI_API_KEY') || env('OPENAI_API_KEY')),
    circuit: 'closed' as const,
  };
}
