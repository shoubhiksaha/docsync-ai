import { NextRequest, NextResponse } from 'next/server';
import { LANG_COOKIE, parseLang } from '@/client/i18n';
import { errorText, readForm, resolveCaller, unauthorized } from '@/core/http';
import { loadSettings } from '@/modules/settings';
import { MAX_AUDIO_BYTES, transcribeAudio } from '@/modules/transcription';

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const caller = await resolveCaller(req);
  if (!caller) return unauthorized();
  const tooLarge = () => NextResponse.json({ error: 'Audio file too large (max 10MB)', code: 'too_large' }, { status: 413 });
  // Refused before (or while) the body is read into memory; 100 KB is room for the multipart framing.
  if (Number(req.headers.get('content-length')) > MAX_AUDIO_BYTES + 100_000) return tooLarge();

  try {
    const formData = await readForm(req, MAX_AUDIO_BYTES + 100_000);
    if (!formData) return tooLarge();
    // The time budget starts once the recording is here, so a slow upload doesn't leave no time to transcribe it.
    const started = Date.now();
    const audioFile = formData.get('audio');

    if (!(audioFile instanceof File)) return NextResponse.json({ error: 'No audio file provided' }, { status: 400 });
    if (audioFile.size > MAX_AUDIO_BYTES) return NextResponse.json({ error: 'Audio file too large (max 10MB)' }, { status: 413 });
    if (!audioFile.type.startsWith('audio/') && !audioFile.type.startsWith('video/')) {
      return NextResponse.json({ error: 'Invalid file type. Only audio files are allowed.' }, { status: 400 });
    }

    const { openaiKey } = await loadSettings(req);
    const customApiKey = req.headers.get('x-openai-key') || openaiKey;
    const text = await transcribeAudio({
      audio: Buffer.from(await audioFile.arrayBuffer()),
      fileName: audioFile.name || 'voicenote.webm',
      mimeType: audioFile.type,
      customApiKey,
      language: parseLang(req.cookies.get(LANG_COOKIE)?.value),
      startedAt: started,
    });
    return text
      ? NextResponse.json({ text })
      : NextResponse.json({ error: 'Transcription is unavailable right now (check your API keys). You can still type a note.' }, { status: 502 });
  } catch (error) {
    console.error('[transcribe] unexpected error:', errorText(error));
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
