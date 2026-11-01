'use client';
import { useEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { Mic, Square, Trash } from 'lucide-react';
import { useI18n } from '@/client/i18n/I18nProvider';
import type { MessageKey } from '@/client/i18n';
import { transcribe } from '@/client/api';
import { Button, IconButton, Notice } from '@/app/components/ui';
import styles from './scan.module.css';

/** A voice note stops by itself here, well under the 10 MB /api/sync accepts. */
const MAX_SECONDS = 180;
/** Plenty for speech, and keeps a 3-minute note under 1 MB on a weak connection. */
const BITS_PER_SECOND = 32_000;
const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;

interface VoiceNoteProps {
  audio: Blob | null;
  onAudio: (audio: Blob | null) => void;
  /** Called with the transcript so it can be added to the typed note. */
  onText: (text: string) => void;
  /** True while recording or transcribing, so the record isn't saved without the note. */
  onBusy: (busy: boolean) => void;
}

export default function VoiceNote({ audio, onAudio, onText, onBusy }: VoiceNoteProps) {
  const { t } = useI18n();
  const [supported, setSupported] = useState(true);
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [transcribing, setTranscribing] = useState(false);
  const [problem, setProblem] = useState<MessageKey | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  /** Waiting for the microphone (the permission prompt): a second tap mustn't open a second one. */
  const starting = useRef(false);
  const mounted = useRef(true);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  // The recorder's onstop runs long after the render that started it: always call the latest props.
  const latest = useRef({ onAudio, onText, onBusy });
  latest.current = { onAudio, onText, onBusy };

  useEffect(() => {
    mounted.current = true;
    setSupported(typeof MediaRecorder !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia));
    return () => {
      // Leaving the review drops an unfinished recording instead of transcribing it.
      mounted.current = false;
      if (recorder.current?.state === 'recording') recorder.current.stop();
      stream.current?.getTracks().forEach(track => track.stop());
    };
  }, []);

  useEffect(() => {
    const { onBusy: report } = latest.current;
    report(recording || transcribing);
    return () => report(false);
  }, [recording, transcribing]);

  useEffect(() => {
    if (!audio) {
      setAudioUrl(null);
      return;
    }
    const url = URL.createObjectURL(audio);
    setAudioUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [audio]);

  useEffect(() => {
    if (!recording) return;
    const started = Date.now();
    const id = setInterval(() => setSeconds(Math.min(MAX_SECONDS, Math.floor((Date.now() - started) / 1000))), 500);
    return () => clearInterval(id);
  }, [recording]);

  // The limit is shown while recording; reaching it stops and keeps what was said.
  useEffect(() => {
    if (!recording || seconds < MAX_SECONDS) return;
    recorder.current?.stop();
    setRecording(false);
    toast(t('voice.limit'));
  }, [recording, seconds, t]);

  const start = async () => {
    if (starting.current || recorder.current?.state === 'recording') return;
    starting.current = true;
    setProblem(null);
    let media: MediaStream;
    try {
      media = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setProblem('voice.denied');
      return;
    } finally {
      starting.current = false;
    }
    // Left the review while the prompt was open: the microphone goes off again.
    if (!mounted.current) {
      media.getTracks().forEach(track => track.stop());
      return;
    }
    stream.current?.getTracks().forEach(track => track.stop());
    stream.current = media;
    const chunks: BlobPart[] = [];
    let rec: MediaRecorder;
    try {
      rec = new MediaRecorder(media, { audioBitsPerSecond: BITS_PER_SECOND });
    } catch {
      rec = new MediaRecorder(media);
    }
    rec.ondataavailable = (e) => chunks.push(e.data);
    rec.onstop = async () => {
      media.getTracks().forEach(track => track.stop());
      if (!mounted.current) return;
      const blob = new Blob(chunks, { type: rec.mimeType || 'audio/webm' });
      latest.current.onAudio(blob);
      setTranscribing(true);
      try {
        const text = await transcribe(blob);
        if (!mounted.current) return;
        latest.current.onText(text);
        toast.success(t('voice.transcribed'));
      } catch {
        if (mounted.current) setProblem('voice.failed');
      } finally {
        if (mounted.current) setTranscribing(false);
      }
    };
    recorder.current = rec;
    rec.start();
    setSeconds(0);
    setRecording(true);
  };

  const stop = () => {
    recorder.current?.stop();
    setRecording(false);
  };

  if (!supported) return <p className={`${styles.muted} ${styles.small}`}>{t('voice.unsupported')}</p>;

  return (
    <div className={styles.voice}>
      <div className={styles.row}>
        <Button
          variant={recording ? 'danger' : 'secondary'}
          icon={recording ? <Square size={18} aria-hidden /> : <Mic size={18} aria-hidden />}
          aria-pressed={recording}
          disabled={transcribing}
          loading={transcribing}
          onClick={recording ? stop : start}
        >
          {/* One voice note per record: a new recording takes the place of the one below, and says so. */}
          {recording ? t('voice.stop') : audio ? t('voice.recordAgain') : t('voice.record')}
        </Button>
        <span className={`${styles.muted} ${styles.small}`} aria-live="polite">
          {recording ? t('voice.recording', { time: clock(seconds), limit: clock(MAX_SECONDS) }) : transcribing ? t('voice.transcribing') : ''}
        </span>
      </div>
      {audioUrl && !recording && (
        <div className={styles.audioRow}>
          <audio controls src={audioUrl} />
          <IconButton label={t('voice.delete')} icon={<Trash size={20} aria-hidden />} variant="danger" onClick={() => onAudio(null)} />
        </div>
      )}
      {problem && <Notice tone="warning">{t(problem)}</Notice>}
    </div>
  );
}
