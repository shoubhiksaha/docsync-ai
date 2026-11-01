'use client';
import { useEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { Mic, Square, Trash } from 'lucide-react';
import { useI18n } from '@/client/i18n/I18nProvider';
import type { MessageKey } from '@/client/i18n';
import { transcribe } from '@/client/api';
import { Button, IconButton, Notice } from '@/app/components/ui';
import styles from './scan.module.css';

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
    const id = setInterval(() => setSeconds(Math.floor((Date.now() - started) / 1000)), 500);
    return () => clearInterval(id);
  }, [recording]);

  const start = async () => {
    setProblem(null);
    try {
      stream.current = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setProblem('voice.denied');
      return;
    }
    const chunks: BlobPart[] = [];
    const rec = new MediaRecorder(stream.current);
    rec.ondataavailable = (e) => chunks.push(e.data);
    rec.onstop = async () => {
      stream.current?.getTracks().forEach(track => track.stop());
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
          {recording ? t('voice.stop') : t('voice.record')}
        </Button>
        <span className={`${styles.muted} ${styles.small}`} aria-live="polite">
          {recording ? t('voice.recording', { seconds }) : transcribing ? t('voice.transcribing') : ''}
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
