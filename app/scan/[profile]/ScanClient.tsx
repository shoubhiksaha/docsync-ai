'use client';
import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import Link from 'next/link';
import toast from 'react-hot-toast';
import { ArrowLeft } from 'lucide-react';
import { useI18n } from '@/client/i18n/I18nProvider';
import type { MessageKey } from '@/client/i18n';
import { ApiError, extractDocument, fetchPrefs, savePrefs, syncRecord, type ProfilePrefs } from '@/client/api';
import { filesToPages, stitchPages, UnreadableFileError } from '@/client/images';
import {
  activeFields,
  fieldSignature,
  initialScanState,
  mergeRetry,
  scanReducer,
  toSyncFields,
  type Destination,
  type ErrorCode,
  type SaveResult,
} from '@/client/scan-flow';
import { getScan, newScanId, putScan } from '@/client/scan-store';
import { track } from '@/client/telemetry';
import { Stepper } from '@/app/components/ui';
import CaptureStep from './CaptureStep';
import DoneStep from './DoneStep';
import DuplicateDialog from './DuplicateDialog';
import ExtractingStep from './ExtractingStep';
import ReviewStep from './ReviewStep';
import styles from './scan.module.css';

interface ScanClientProps {
  profileId: string;
  documentName: string;
  sampleHref: string | null;
  /** Id of a scan taken offline (Recent scans → "Process now"). */
  resumeId: string | null;
}

type Source = 'camera' | 'upload' | 'drop' | 'paste' | 'sample' | 'resume';

const AUTO_SAVE_SECONDS = 5;
const errorCode = (err: unknown): ErrorCode => (err instanceof ApiError ? err.code : 'internal');

function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // storage unavailable: the offers just won't be remembered
  }
}

export default function ScanClient({ profileId, documentName, sampleHref, resumeId }: ScanClientProps) {
  const { t } = useI18n();

  const [state, dispatch] = useReducer(scanReducer, initialScanState);
  const [prefs, setPrefs] = useState<ProfilePrefs | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [problem, setProblem] = useState<MessageKey | null>(null);
  const [offline, setOffline] = useState(false);
  const [offlineSaved, setOfflineSaved] = useState(false);
  const [offerRemember, setOfferRemember] = useState(false);
  const [notionDismissed, setNotionDismissed] = useState(true);
  const [retrying, setRetrying] = useState<Destination | null>(null);
  const [countdown, setCountdown] = useState(AUTO_SAVE_SECONDS);

  const cameraInput = useRef<HTMLInputElement>(null);
  const uploadInput = useRef<HTMLInputElement>(null);
  const abort = useRef<AbortController | null>(null);
  const archive = useRef<{ pages: Blob[]; image: Blob | null } | null>(null);
  const prefsReady = useRef<Promise<ProfilePrefs | null>>(Promise.resolve(null));
  const stateRef = useRef(state);
  stateRef.current = state;
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;
  const resumed = useRef(false);

  const signatureKey = `docsync_sig_${profileId}`;
  const rememberOffKey = `docsync_remember_off_${profileId}`;

  // Remembered fields and duplicate-check choice live on the server (they follow the user across
  // devices). Older versions kept the template in localStorage: move it over once.
  useEffect(() => {
    let cancelled = false;
    track('scan_opened', { profile: profileId });
    prefsReady.current = fetchPrefs(profileId).then(async (loaded) => {
      if (!loaded) return null;
      const legacyKey = `docsync_template_v1_${profileId}`;
      const legacy = (() => {
        try {
          return JSON.parse(readStorage(legacyKey) || 'null') as { fields?: { key: string; label: string }[] } | null;
        } catch {
          return null;
        }
      })();
      writeStorage(legacyKey, null);
      if (!loaded.fields && legacy?.fields?.length) {
        loaded = await savePrefs(profileId, { fields: legacy.fields }).catch(() => loaded);
      }
      if (!cancelled) setPrefs(loaded);
      return loaded;
    });
    setOffline(!navigator.onLine);
    setNotionDismissed(document.cookie.includes('docsync_notion_skipped='));
    const update = () => setOffline(!navigator.onLine);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      cancelled = true;
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, [profileId]);

  const extract = useCallback(async (pages: Blob[]) => {
    dispatch({ type: 'extract-start' });
    const loaded = await prefsReady.current;
    const template = loaded?.fields?.length ? { fields: loaded.fields } : null;
    const controller = new AbortController();
    abort.current = controller;
    const started = performance.now();
    try {
      const extraction = await extractDocument(pages, profileId, template?.fields.map(f => f.label) ?? [], controller.signal);
      if (controller.signal.aborted) return;
      dispatch({ type: 'extract-ok', extraction, template });
      track('extract_succeeded', { profile: profileId, ms: Math.round(performance.now() - started), count: extraction.fields.length, pages: pages.length, mock: Boolean(extraction.isMock) });
    } catch (err) {
      if (controller.signal.aborted) return;
      dispatch({ type: 'extract-failed', error: errorCode(err) });
      track('extract_failed', { profile: profileId, code: errorCode(err), ms: Math.round(performance.now() - started) });
    }
  }, [profileId]);

  const addFiles = useCallback(async (files: Blob[], source: Source) => {
    if (files.length === 0) return;
    setProblem(null);
    setOfflineSaved(false);
    setOfferRemember(false);
    setPreparing(true);
    try {
      const { pages, truncated } = await filesToPages(files);
      if (pages.length === 0) return;
      if (truncated) toast(t('capture.tooManyPages'));
      const scanId = newScanId();
      archive.current = null;
      dispatch({ type: 'captured', pages, scanId });
      track('photo_added', { profile: profileId, pages: pages.length, source });
      if (!navigator.onLine) {
        const now = Date.now();
        await putScan({ id: scanId, profileId, createdAt: now, updatedAt: now, status: 'offline', pages });
        track('offline_saved', { profile: profileId });
        setOfflineSaved(true);
        return;
      }
      void extract(pages);
    } catch (err) {
      setProblem(err instanceof UnreadableFileError && err.reason === 'pdf' ? 'capture.pdfFailed' : 'capture.unsupported');
    } finally {
      setPreparing(false);
    }
  }, [extract, profileId, t]);

  // Offline captures come back here from Recent scans with ?resume=<id>.
  useEffect(() => {
    if (!resumeId || resumed.current) return;
    resumed.current = true;
    window.history.replaceState(null, '', window.location.pathname);
    getScan(resumeId).then((scan) => {
      if (!scan?.pages?.length || scan.profileId !== profileId) return;
      archive.current = null;
      dispatch({ type: 'captured', pages: scan.pages, scanId: scan.id });
      track('photo_added', { profile: profileId, pages: scan.pages.length, source: 'resume' });
      void extract(scan.pages);
    });
  }, [resumeId, profileId, extract]);

  // Paste a screenshot or copied photo straight onto the capture screen.
  useEffect(() => {
    if (state.step !== 'capture') return;
    const onPaste = (e: ClipboardEvent) => {
      const files = [...(e.clipboardData?.files ?? [])];
      if (files.length) {
        e.preventDefault();
        void addFiles(files, 'paste');
      }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [state.step, addFiles]);

  // Warn before leaving with unsaved edits.
  useEffect(() => {
    if (state.step !== 'review' && state.step !== 'saving') return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [state.step]);

  const archiveImage = async (pages: Blob[]): Promise<Blob | null> => {
    if (archive.current?.pages === pages) return archive.current.image;
    const image = await stitchPages(pages).catch(() => pages[0] ?? null);
    archive.current = { pages, image };
    return image;
  };

  const store = async (result: SaveResult, fields: ReturnType<typeof toSyncFields>, image: Blob | null) => {
    const current = stateRef.current;
    if (!current.scanId) return;
    const now = Date.now();
    await putScan({
      id: current.scanId, profileId, createdAt: now, updatedAt: now, status: result.status,
      fields, note: current.note, archive: image, audio: current.audio,
      destinations: result.destinations, spreadsheetUrl: result.spreadsheetUrl,
    });
  };

  const save = async (duplicateAction?: 'replace' | 'keep_both') => {
    const current = stateRef.current;
    const fields = toSyncFields(current.fields);
    if (fields.length === 0) return;
    dispatch({ type: 'save-start' });
    const started = performance.now();
    try {
      const image = await archiveImage(current.pages);
      const outcome = await syncRecord({ profileId, fields, archive: image, note: current.note, audio: current.audio, duplicateAction });
      if (outcome.kind === 'duplicate') {
        dispatch({ type: 'duplicate', info: outcome.info });
        track('duplicate_found', { profile: profileId });
        return;
      }
      const { result } = outcome;
      dispatch({ type: 'save-ok', result });
      track('review_confirmed', {
        profile: profileId,
        count: fields.length,
        edited: current.fields.filter(f => f.edited && f.origin !== 'user').length,
        removed: current.fields.filter(f => f.removed).length,
        added: current.fields.filter(f => f.origin === 'user').length,
      });
      track('sync_finished', {
        profile: profileId, ms: Math.round(performance.now() - started), status: result.status,
        sheets: result.destinations.sheets?.code, notion: result.destinations.notion?.code, media: result.destinations.media?.code,
      });
      await store(result, fields, image);

      if (result.status !== 'failed') {
        // Offer to remember the fields once the same layout has been saved twice.
        const signature = fieldSignature(fields);
        const previous = readStorage(signatureKey);
        writeStorage(signatureKey, signature);
        setOfferRemember(!prefsRef.current?.fields?.length && previous === signature && readStorage(rememberOffKey) !== signature);
      }
    } catch (err) {
      dispatch({ type: 'save-failed', error: errorCode(err) });
      track('sync_failed', { profile: profileId, code: errorCode(err) });
    }
  };
  const saveRef = useRef(save);
  saveRef.current = save;

  // Remembered fields that all came back clearly save themselves after a visible countdown.
  useEffect(() => {
    if (!state.autoSave || state.step !== 'review') return;
    const deadline = Date.now() + AUTO_SAVE_SECONDS * 1000;
    setCountdown(AUTO_SAVE_SECONDS);
    const tick = setInterval(() => setCountdown(Math.max(0, Math.ceil((deadline - Date.now()) / 1000))), 250);
    const fire = setTimeout(() => void saveRef.current(), AUTO_SAVE_SECONDS * 1000);
    return () => {
      clearInterval(tick);
      clearTimeout(fire);
    };
  }, [state.autoSave, state.step]);

  const retry = async (destination: Destination) => {
    const current = stateRef.current;
    if (!current.result) return;
    setRetrying(destination);
    track('retry', { profile: profileId, destination });
    try {
      const fields = toSyncFields(current.fields);
      const image = await archiveImage(current.pages);
      const outcome = await syncRecord({ profileId, fields, archive: image, note: current.note, audio: current.audio, only: [destination], duplicateAction: 'keep_both' });
      if (outcome.kind === 'saved') {
        dispatch({ type: 'retry-ok', result: outcome.result });
        await store(mergeRetry(current.result, outcome.result), fields, image);
      }
    } catch (err) {
      toast.error(t(`error.${errorCode(err)}`));
    } finally {
      setRetrying(null);
    }
  };

  const updatePrefs = async (update: Parameters<typeof savePrefs>[1], message?: MessageKey) => {
    try {
      const next = await savePrefs(profileId, update);
      setPrefs(next);
      prefsReady.current = Promise.resolve(next);
      if (message) toast.success(t(message));
    } catch (err) {
      toast.error(t(`error.${errorCode(err)}`));
    }
  };

  const startOver = () => {
    abort.current?.abort();
    archive.current = null;
    setProblem(null);
    setOfflineSaved(false);
    setOfferRemember(false);
    dispatch({ type: 'reset' });
  };

  // "Scan the next one": straight back to the camera for the same document type.
  const scanNext = () => {
    startOver();
    cameraInput.current?.click();
  };

  const fromInput = (source: Source) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = [...(e.target.files ?? [])];
    e.target.value = '';
    void addFiles(files, source);
  };

  const stepIndex = state.step === 'done' ? 2 : state.step === 'review' || state.step === 'saving' ? 1 : 0;
  const duplicateKey = prefs ? (prefs.primaryKey ?? prefs.defaultPrimaryKey ?? '') : '';
  const syncedFields = toSyncFields(state.fields);

  return (
    <main id="main" className="container page">
      <div className={styles.header}>
        <div className={styles.titleRow}>
          <Link href="/" aria-label={t('common.back')} title={t('common.back')} style={{ display: 'inline-flex', minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center', color: 'var(--text-2)' }}>
            <ArrowLeft size={22} aria-hidden />
          </Link>
          <h1 className={styles.title}>{t('scan.title', { name: documentName })}</h1>
        </div>
        <div className={styles.stepperWrap}>
          <Stepper label={t('scan.progress')} current={stepIndex} steps={[t('scan.step.photo'), t('scan.step.check'), t('scan.step.saved')]} />
        </div>
      </div>

      <input ref={cameraInput} type="file" accept="image/*" capture="environment" hidden onChange={fromInput('camera')} />
      <input ref={uploadInput} type="file" accept="image/*,application/pdf" multiple hidden onChange={fromInput('upload')} />

      {state.step === 'capture' && (
        <CaptureStep
          documentName={documentName}
          pages={state.pages}
          error={state.error}
          problem={problem}
          preparing={preparing}
          offline={offline}
          offlineSaved={offlineSaved}
          remembered={prefs?.fields ?? null}
          sampleHref={sampleHref}
          onTakePhoto={() => cameraInput.current?.click()}
          onUpload={() => uploadInput.current?.click()}
          onFiles={(files, source) => void addFiles(files, source)}
          onSample={async () => {
            if (!sampleHref) return;
            const blob = await fetch(sampleHref).then(r => r.blob()).catch(() => null);
            if (blob) void addFiles([blob], 'sample');
          }}
          onRetry={() => void extract(state.pages)}
          onOtherPhoto={() => {
            startOver();
            uploadInput.current?.click();
          }}
          onForget={() => {
            track('fields_forgotten', { profile: profileId });
            void updatePrefs({ fields: null }, 'capture.forgotten');
          }}
        />
      )}

      {state.step === 'extracting' && <ExtractingStep pages={state.pages} onCancel={startOver} />}

      {(state.step === 'review' || state.step === 'saving') && (
        <ReviewStep
          state={state}
          dispatch={(action) => {
            if (action.type === 'auto-save-cancel') track('auto_save_cancelled', { profile: profileId });
            dispatch(action);
          }}
          saving={state.step === 'saving'}
          countdown={countdown}
          duplicateKey={duplicateKey}
          onDuplicateKey={(key) => void updatePrefs({ primaryKey: key })}
          onSave={() => void save()}
          onStartOver={startOver}
        />
      )}

      {state.step === 'done' && state.result && (
        <DoneStep
          result={state.result}
          fields={syncedFields}
          documentName={documentName}
          retrying={retrying}
          offerRemember={offerRemember}
          offerNotion={!notionDismissed && state.result.destinations.notion?.code === 'not_connected'}
          onRetry={(destination) => void retry(destination)}
          onRemember={() => {
            track('fields_remembered', { profile: profileId, count: activeFields(state.fields).length });
            setOfferRemember(false);
            void updatePrefs({ fields: syncedFields.map(f => ({ key: f.key, label: f.label })) }, 'done.remembered');
          }}
          onDismissRemember={() => {
            writeStorage(rememberOffKey, fieldSignature(syncedFields));
            setOfferRemember(false);
          }}
          onDismissNotion={() => {
            document.cookie = 'docsync_notion_skipped=true; path=/; max-age=31536000; samesite=lax';
            track('notion_offer', { action: 'dismiss' });
            setNotionDismissed(true);
          }}
          onScanNext={scanNext}
        />
      )}

      <DuplicateDialog
        info={state.duplicate}
        onCancel={() => {
          dispatch({ type: 'duplicate-close' });
          toast(t('dup.cancelled'));
        }}
        onAction={(action) => {
          dispatch({ type: 'duplicate-close' });
          void save(action);
        }}
      />
    </main>
  );
}
