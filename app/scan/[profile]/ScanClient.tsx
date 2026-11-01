'use client';
import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { signIn } from 'next-auth/react';
import toast from 'react-hot-toast';
import { ArrowLeft, Clock } from 'lucide-react';
import { useI18n } from '@/client/i18n/I18nProvider';
import type { MessageKey } from '@/client/i18n';
import { ApiError, extractDocument, fetchPrefs, savePrefs, syncRecord, type ProfilePrefs } from '@/client/api';
import { filesToPages, MAX_PAGES, stitchPages, UnreadableFileError } from '@/client/images';
import {
  applyTemplate,
  DESTINATIONS,
  fieldSignature,
  initialScanState,
  mergeRetry,
  NOT_KEEPABLE,
  scanReducer,
  toSyncFields,
  type Destination,
  type DuplicateAction,
  type ErrorCode,
  type SaveResult,
  type ScanState,
  type SyncField,
} from '@/client/scan-flow';
import { getScan, newScanId, putScan, savedScan } from '@/client/scan-store';
import { track } from '@/client/telemetry';
import { Button, Dialog, Stepper } from '@/app/components/ui';
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
/** What the user tried while the review had unsaved changes. */
type Leave = { to: 'start-over' } | { to: 'back' } | { to: 'link'; url: URL };

const AUTO_SAVE_SECONDS = 5;
/** How long a finished reading waits for the document checks to load on this device. */
const CHECKS_WAIT_MS = 2_000;
/** Retries are tracked per scan, so one still running for the last scan doesn't block the next. */
const retryKey = (scanId: string, destination: Destination) => `${scanId}:${destination}`;
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
  const router = useRouter();

  const [state, dispatch] = useReducer(scanReducer, initialScanState);
  const [prefs, setPrefs] = useState<ProfilePrefs | null>(null);
  /** The preferences couldn't be loaded: they are tried again once the review opens. */
  const [prefsFailed, setPrefsFailed] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [problem, setProblem] = useState<MessageKey | null>(null);
  const [offline, setOffline] = useState(false);
  const [offlineSaved, setOfflineSaved] = useState(false);
  const [offerRemember, setOfferRemember] = useState(false);
  const [notionDismissed, setNotionDismissed] = useState(true);
  const [retrying, setRetrying] = useState<ReadonlySet<string>>(new Set());
  /** A Saved-screen retry found the Google session has ended. */
  const [retrySession, setRetrySession] = useState(false);
  const [countdown, setCountdown] = useState(AUTO_SAVE_SECONDS);
  const [tray, setTray] = useState<Blob[]>([]);
  const [waitingOnline, setWaitingOnline] = useState(false);
  const [kept, setKept] = useState(false);
  const [leaving, setLeaving] = useState<Leave | null>(null);
  const [loadingSample, setLoadingSample] = useState(false);
  /** How much of the photo upload has been sent (0 to 1) while reading. */
  const [uploaded, setUploaded] = useState(0);
  /** The same while saving, shown on the Save button. */
  const [saveSent, setSaveSent] = useState(0);

  const cameraInput = useRef<HTMLInputElement>(null);
  const uploadInput = useRef<HTMLInputElement>(null);
  const abort = useRef<AbortController | null>(null);
  const archive = useRef<{ pages: Blob[]; image: Blob | null } | null>(null);
  const stateRef = useRef(state);
  stateRef.current = state;
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;
  const trayRef = useRef(tray);
  trayRef.current = tray;
  /** The latest result of each scan with a retry, for one that finishes after "Scan the next one". */
  const retryResults = useRef(new Map<string, SaveResult>());
  /** Pages put back in the tray by "Cancel" keep their scan id, so reading them again doesn't add a second copy. */
  const trayScanId = useRef<string | null>(null);
  const resumed = useRef(false);
  /** Set once the user chose to leave, so no guard asks again on the way out. */
  const leaveOk = useRef(false);
  /** An extra history entry is on top, so the back button lands on the review first. */
  const historyGuard = useRef(false);

  const signatureKey = `docsync_sig_${profileId}`;
  const rememberOffKey = `docsync_remember_off_${profileId}`;

  // Remembered fields and duplicate-check choice live on the server (they follow the user across
  // devices). Older versions kept the template in localStorage: move it over once. Reading never
  // waits for them: a slow load just means this scan's photo is read without the remembered fields.
  useEffect(() => {
    let cancelled = false;
    track('scan_opened', { profile: profileId });
    void fetchPrefs(profileId).then(async (loaded) => {
      if (!loaded) {
        if (!cancelled) setPrefsFailed(true);
        return;
      }
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

  // Leaving the page stops a reading still in progress: no upload or AI read for a result nobody sees.
  useEffect(() => () => abort.current?.abort(), []);

  const extract = useCallback(async (pages: Blob[]) => {
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    dispatch({ type: 'extract-start' });
    setUploaded(0);
    // The remembered fields are asked for only if they have loaded by now: the upload starts at once.
    const remembered = prefsRef.current?.fields;
    // The document type's checks also run here, so their warnings are in the user's language and sit
    // under their field. Loaded while the photo uploads: the profiles stay out of the first download.
    const checks = import('@/modules/profiles').catch(() => null);
    const started = performance.now();
    try {
      const extraction = await extractDocument(pages, profileId, remembered?.map(f => f.label) ?? [], controller.signal, (sent) => {
        if (!controller.signal.aborted) setUploaded(sent);
      });
      // Not waited on for long: without them the server's warnings are shown until the first edit.
      const profiles = await Promise.race([checks, new Promise<null>(resolve => setTimeout(() => resolve(null), CHECKS_WAIT_MS))]);
      if (controller.signal.aborted) return;
      const latest = prefsRef.current?.fields;
      const template = latest?.length ? { fields: latest } : null;
      const profile = profiles?.getProfile(profileId);
      const rules = profiles && profile ? profiles.checkFields(profile, toSyncFields(applyTemplate(extraction.fields, template))) : null;
      dispatch({ type: 'extract-ok', extraction, template, rules });
      track('extract_succeeded', { profile: profileId, ms: Math.round(performance.now() - started), count: extraction.fields.length, pages: pages.length, mock: Boolean(extraction.isMock) });
    } catch (err) {
      if (controller.signal.aborted) return;
      dispatch({ type: 'extract-failed', error: errorCode(err) });
      track('extract_failed', { profile: profileId, code: errorCode(err), ms: Math.round(performance.now() - started) });
    }
  }, [profileId]);

  // Reads the pages, or keeps them on this device while offline.
  const begin = useCallback(async (pages: Blob[], source: Source, keepId: string | null = null) => {
    const scanId = keepId ?? newScanId();
    trayScanId.current = null;
    archive.current = null;
    setTray([]);
    setKept(false);
    dispatch({ type: 'captured', pages, scanId });
    track('photo_added', { profile: profileId, pages: pages.length, source });
    if (!navigator.onLine) {
      const now = Date.now();
      if (await putScan({ id: scanId, profileId, createdAt: now, updatedAt: now, status: 'offline', pages })) {
        track('offline_saved', { profile: profileId });
        setOfflineSaved(true);
      } else {
        // The phone couldn't keep it (storage full, private window): hold it here until online.
        setWaitingOnline(true);
      }
      return;
    }
    void extract(pages);
  }, [extract, profileId]);

  const addFiles = useCallback(async (files: Blob[], source: Source) => {
    if (files.length === 0) return;
    setProblem(null);
    setOfflineSaved(false);
    setWaitingOnline(false);
    setOfferRemember(false);
    setPreparing(true);
    try {
      const { pages, truncated } = await filesToPages(files);
      if (pages.length === 0) return;
      // Camera photos wait in a tray, so a two-page khata or muster roll can be read as one. Pages
      // pasted, dropped or uploaded while the tray is open join it instead of replacing it.
      if (source === 'camera' || trayRef.current.length > 0) {
        if (truncated || trayRef.current.length + pages.length > MAX_PAGES) toast(t('capture.tooManyPages'));
        setTray(current => [...current, ...pages].slice(0, MAX_PAGES));
        return;
      }
      if (truncated) toast(t('capture.tooManyPages'));
      await begin(pages, source);
    } catch (err) {
      setProblem(err instanceof UnreadableFileError && err.reason === 'pdf' ? 'capture.pdfFailed' : 'capture.unsupported');
    } finally {
      setPreparing(false);
    }
  }, [begin, t]);

  // A photo the phone couldn't keep offline is read as soon as the connection is back.
  useEffect(() => {
    if (!waitingOnline || offline) return;
    setWaitingOnline(false);
    void extract(stateRef.current.pages);
  }, [waitingOnline, offline, extract]);

  // Offline captures come back here from Recent scans with ?resume=<id>.
  useEffect(() => {
    if (!resumeId || resumed.current) return;
    resumed.current = true;
    window.history.replaceState(null, '', window.location.pathname);
    getScan(resumeId).then((scan) => {
      if (!scan?.pages?.length || scan.profileId !== profileId) return;
      archive.current = null;
      // A save that failed on a weak connection or an ended session comes back with its checked values.
      if (scan.fields?.length) {
        dispatch({ type: 'restored', pages: scan.pages, scanId: scan.id, fields: scan.fields, note: scan.note ?? '', audio: scan.audio ?? null });
        setKept(true);
        track('photo_added', { profile: profileId, pages: scan.pages.length, source: 'resume' });
        return;
      }
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

  // The document type's checks run again shortly after each change, so a fixed value clears its
  // warning. Loaded on first use: the profiles stay out of the page's first download.
  useEffect(() => {
    if (state.step !== 'review' || !state.changed) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      import('@/modules/profiles').then(({ getProfile, checkFields }) => {
        const profile = getProfile(profileId);
        if (!cancelled && profile) dispatch({ type: 'rules', rules: checkFields(profile, toSyncFields(stateRef.current.fields)) });
      }).catch(() => {
        // offline and not cached: the earlier warnings stay
      });
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [state.fields, state.step, state.changed, profileId]);

  // Preferences that couldn't be loaded are tried once more, quietly, when the review opens.
  useEffect(() => {
    if (state.step !== 'review' || !prefsFailed) return;
    setPrefsFailed(false);
    void fetchPrefs(profileId).then((loaded) => {
      if (loaded) setPrefs(loaded);
    });
  }, [state.step, prefsFailed, profileId]);

  // Photos taken but not read yet are lost on leaving, just like unsaved corrections.
  const trayWaiting = state.step === 'capture' && tray.length > 0;

  // Warn before leaving with unsaved edits, or while a photo is being read.
  useEffect(() => {
    if (state.step !== 'extracting' && state.step !== 'review' && state.step !== 'saving' && !trayWaiting) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!leaveOk.current) e.preventDefault();
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [state.step, trayWaiting]);

  // In-app links and the back button don't fire beforeunload: while reading, or once something was
  // changed on the review, they ask first. A history entry pushed on the first change catches back gestures.
  const reading = state.step === 'extracting';
  const guarded = ((state.step === 'review' || state.step === 'saving') && state.changed) || trayWaiting || reading;
  useEffect(() => {
    if (!guarded) return;
    if (!historyGuard.current) {
      window.history.pushState(null, '', window.location.href);
      historyGuard.current = true;
    }
    const onPopState = () => {
      if (leaveOk.current) return;
      historyGuard.current = false;
      setLeaving({ to: 'back' });
    };
    const onClick = (e: MouseEvent) => {
      if (leaveOk.current || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const anchor = e.target instanceof Element ? e.target.closest('a[href]') : null;
      if (!(anchor instanceof HTMLAnchorElement) || (anchor.target && anchor.target !== '_self') || anchor.hasAttribute('download')) return;
      const url = new URL(anchor.href, window.location.href);
      // Other sites are covered by beforeunload; links to this same page don't leave it.
      if (url.origin !== window.location.origin || (url.pathname === window.location.pathname && url.search === window.location.search)) return;
      e.preventDefault();
      e.stopPropagation();
      setLeaving({ to: 'link', url });
    };
    window.addEventListener('popstate', onPopState);
    document.addEventListener('click', onClick, true);
    return () => {
      window.removeEventListener('popstate', onPopState);
      document.removeEventListener('click', onClick, true);
    };
  }, [guarded]);

  // Saved or started over: take the extra history entry back off, so Back works normally again.
  useEffect(() => {
    if (guarded || !historyGuard.current) return;
    historyGuard.current = false;
    window.history.back();
  }, [guarded]);

  const archiveImage = async (pages: Blob[]): Promise<Blob | null> => {
    if (archive.current?.pages === pages) return archive.current.image;
    const image = await stitchPages(pages).catch(() => pages[0] ?? null);
    archive.current = { pages, image };
    return image;
  };

  // `scan` is the scan the result belongs to: a retry can finish after the user moved on to the next one.
  const store = async (result: SaveResult, fields: SyncField[], image: Blob | null, scan: Pick<ScanState, 'scanId' | 'note' | 'audio' | 'duplicateAction'> = stateRef.current): Promise<boolean> => {
    if (!scan.scanId) return false;
    return putScan(savedScan({
      id: scan.scanId, profileId, fields, note: scan.note, archive: image, audio: scan.audio, duplicateAction: scan.duplicateAction ?? undefined,
    }, result));
  };

  // Keeps the checked fields on this device (Recent scans → "Process now" brings them back).
  const keepPending = async (fields: SyncField[], image: Blob | null): Promise<boolean> => {
    const current = stateRef.current;
    if (!current.scanId || !current.pages.length) return false;
    const now = Date.now();
    return putScan({
      id: current.scanId, profileId, createdAt: now, updatedAt: now, status: 'offline',
      pages: current.pages, fields, note: current.note, archive: image, audio: current.audio,
    });
  };

  const save = async (duplicateAction?: DuplicateAction, withoutVoice = false) => {
    const current = stateRef.current;
    const audio = withoutVoice ? null : current.audio;
    const fields = toSyncFields(current.fields);
    if (fields.length === 0) return;
    dispatch({ type: 'save-start', duplicateAction });
    setSaveSent(0);
    const started = performance.now();
    let image: Blob | null = null;
    try {
      image = await archiveImage(current.pages);
      // The scan id goes with every save and retry of this scan, so one whose reply was lost isn't written twice.
      const outcome = await syncRecord({ profileId, fields, archive: image, note: current.note, audio, duplicateAction, saveId: current.scanId ?? undefined, onProgress: setSaveSent });
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
      // Nothing saved anywhere: the copy in Recent scans can be retried from the home page.
      if ((await store(result, fields, image)) && result.status === 'failed') setKept(true);

      if (result.status !== 'failed') {
        // Offer to remember the fields once the same layout has been saved twice.
        const signature = fieldSignature(fields);
        const previous = readStorage(signatureKey);
        writeStorage(signatureKey, signature);
        // Not while the preferences are unknown: the fields may be remembered already.
        const loaded = prefsRef.current;
        setOfferRemember(Boolean(loaded) && !loaded?.fields?.length && previous === signature && readStorage(rememberOffKey) !== signature);
      }
    } catch (err) {
      const code = errorCode(err);
      dispatch({ type: 'save-failed', error: code });
      track('sync_failed', { profile: profileId, code });
      // A weak connection, a busy service or an ended session mustn't cost the checked values.
      if (!NOT_KEEPABLE.includes(code) && (await keepPending(fields, image))) setKept(true);
    }
  };
  const saveRef = useRef(save);
  saveRef.current = save;

  // Remembered fields that all came back clearly save themselves after a visible countdown. It only
  // runs while the page is in view: a reading that finishes while the user is in another app waits,
  // and the full countdown starts again when they come back.
  useEffect(() => {
    if (!state.autoSave || state.step !== 'review') return;
    let tick: ReturnType<typeof setInterval> | undefined;
    let fire: ReturnType<typeof setTimeout> | undefined;
    const restart = () => {
      clearInterval(tick);
      clearTimeout(fire);
      setCountdown(AUTO_SAVE_SECONDS);
      if (document.visibilityState !== 'visible') return;
      const deadline = Date.now() + AUTO_SAVE_SECONDS * 1000;
      tick = setInterval(() => setCountdown(Math.max(0, Math.ceil((deadline - Date.now()) / 1000))), 250);
      fire = setTimeout(() => void saveRef.current(), AUTO_SAVE_SECONDS * 1000);
    };
    restart();
    document.addEventListener('visibilitychange', restart);
    return () => {
      document.removeEventListener('visibilitychange', restart);
      clearInterval(tick);
      clearTimeout(fire);
    };
  }, [state.autoSave, state.step]);

  // Each destination retries on its own, and several can run at once. A retry belongs to its scan:
  // one that finishes after "Scan the next one" updates only that scan's copy in Recent scans.
  // It sends the user's duplicate choice again; without one, a Sheets retry checks for duplicates
  // like the first save did, and asks again if it finds one.
  const retry = async (destination: Destination, duplicateAction = stateRef.current.duplicateAction) => {
    const current = stateRef.current;
    const { scanId } = current;
    if (!current.result || !scanId || retrying.has(retryKey(scanId, destination))) return;
    const key = retryKey(scanId, destination);
    setRetrying(busy => new Set(busy).add(key));
    setRetrySession(false);
    track('retry', { profile: profileId, destination });
    try {
      // The same values as the first save, so every destination ends up with the same record.
      const fields = current.savedFields ?? toSyncFields(current.fields);
      const image = await archiveImage(current.pages);
      const outcome = await syncRecord({ profileId, fields, archive: image, note: current.note, audio: current.audio, only: [destination], duplicateAction: duplicateAction ?? undefined, saveId: scanId,
        // The first save's photo and voice-note links, so a Sheets retry writes them into the row.
        imageLink: current.result.imageLink, voiceNoteLink: current.result.voiceNoteLink,
        // Sent with progress events, so a slow but moving upload isn't cut off on 2G.
        onProgress: () => {} });
      if (outcome.kind === 'duplicate') {
        if (stateRef.current.scanId === scanId) dispatch({ type: 'duplicate', info: outcome.info });
        track('duplicate_found', { profile: profileId });
      } else {
        // Merged into the latest result, not the one this retry started from, so a retry that
        // finished meanwhile isn't overwritten. stateRef is updated now, before React re-renders.
        const still = stateRef.current.scanId === scanId;
        const merged = mergeRetry((still ? stateRef.current.result : retryResults.current.get(scanId)) ?? current.result, outcome.result);
        retryResults.current.set(scanId, merged);
        if (still) {
          stateRef.current = { ...stateRef.current, result: merged };
          dispatch({ type: 'retry-ok', result: outcome.result });
        }
        await store(merged, fields, image, { ...current, duplicateAction });
      }
    } catch (err) {
      const code = errorCode(err);
      // The user has moved on: the earlier scan still waits in Recent scans with its retry.
      if (stateRef.current.scanId === scanId) {
        if (code === 'session') setRetrySession(true);
        else toast.error(t(`error.${code}`));
      }
    } finally {
      setRetrying(busy => {
        const next = new Set(busy);
        next.delete(key);
        return next;
      });
    }
  };

  const updatePrefs = async (update: Parameters<typeof savePrefs>[1], message?: MessageKey) => {
    try {
      const next = await savePrefs(profileId, update);
      setPrefs(next);
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
    setWaitingOnline(false);
    setOfferRemember(false);
    setKept(false);
    setRetrySession(false);
    setTray([]);
    trayScanId.current = null;
    dispatch({ type: 'reset' });
  };

  // "Cancel" while reading (or "Back to pages" after a failed read) stops the read but keeps the
  // pages, so one can be added, retaken or removed.
  const cancelReading = () => {
    abort.current?.abort();
    const { pages, scanId } = stateRef.current;
    setUploaded(0);
    setTray(pages);
    trayScanId.current = scanId;
    dispatch({ type: 'reset' });
  };

  const requestStartOver = () => {
    if (stateRef.current.changed) setLeaving({ to: 'start-over' });
    else startOver();
  };

  const discardAndLeave = () => {
    const leave = leaving;
    setLeaving(null);
    if (!leave) return;
    if (leave.to === 'start-over') {
      startOver();
      return;
    }
    leaveOk.current = true;
    if (leave.to === 'back') window.history.back();
    // API routes (sign-in and the like) need a full page load; app pages navigate in place.
    else if (leave.url.pathname.startsWith('/api/')) window.location.assign(leave.url.href);
    else router.push(`${leave.url.pathname}${leave.url.search}${leave.url.hash}`);
  };

  const keepChecking = () => {
    // Back was pressed: put the guard entry back, so the next Back asks again.
    if (leaving?.to === 'back' && !historyGuard.current) {
      window.history.pushState(null, '', window.location.href);
      historyGuard.current = true;
    }
    setLeaving(null);
  };

  // No connection while reading: the photo waits on this phone instead of being lost.
  const keepPhoto = async (): Promise<boolean> => {
    const current = stateRef.current;
    if (!current.scanId || !current.pages.length) return false;
    const now = Date.now();
    if (!(await putScan({ id: current.scanId, profileId, createdAt: now, updatedAt: now, status: 'offline', pages: current.pages }))) {
      toast.error(t('capture.keepFailed'));
      return false;
    }
    track('offline_saved', { profile: profileId });
    return true;
  };

  const keepForLater = async () => {
    if (!(await keepPhoto())) return;
    startOver();
    setOfflineSaved(true);
  };

  // Leaving while the photo is read: keep it for Recent scans, then go where the user was going.
  const keepAndLeave = async () => {
    if (await keepPhoto()) discardAndLeave();
  };

  // A failed save: the checked values wait on this phone (Recent scans), and the next scan can start.
  const keepReviewForLater = async () => {
    const current = stateRef.current;
    const image = await archiveImage(current.pages);
    if (!(await keepPending(toSyncFields(current.fields), image))) {
      toast.error(t('capture.keepFailed'));
      return;
    }
    track('offline_saved', { profile: profileId });
    startOver();
    setOfflineSaved(true);
  };

  // Comes back to this scan after signing in, with the checked values if they were kept.
  const signInAgain = () => {
    leaveOk.current = true;
    const id = stateRef.current.scanId;
    void signIn('google', { callbackUrl: kept && id ? `/scan/${profileId}?resume=${id}` : `/scan/${profileId}` });
  };

  // The session ended while reading: the photo waits on this device and is read after signing in.
  const signInToRead = async () => {
    const { scanId, pages } = stateRef.current;
    const now = Date.now();
    const stored = scanId && pages.length ? await putScan({ id: scanId, profileId, createdAt: now, updatedAt: now, status: 'offline', pages }) : false;
    leaveOk.current = true;
    void signIn('google', { callbackUrl: stored ? `/scan/${profileId}?resume=${scanId}` : `/scan/${profileId}` });
  };

  // A Saved-screen retry found the session ended: this scan is already in Recent scans, to retry from home.
  const signInToRetry = () => {
    leaveOk.current = true;
    void signIn('google', { callbackUrl: '/' });
  };

  // The sample shows a spinner while it downloads, and says so if it can't be fetched.
  const trySample = async () => {
    if (!sampleHref || preparing || loadingSample) return;
    setProblem(null);
    setLoadingSample(true);
    const blob = await fetch(sampleHref).then(r => (r.ok ? r.blob() : null)).catch(() => null);
    setLoadingSample(false);
    if (blob) await addFiles([blob], 'sample');
    else setProblem('capture.sampleFailed');
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

  // Saved is the end of the flow, so every step shows as done (Stepper's current={steps.length}).
  const stepIndex = state.step === 'done' ? 3 : state.step === 'review' || state.step === 'saving' ? 1 : 0;
  // null while the preferences are unknown: the server still checks as set in Settings.
  const duplicateKey = prefs ? (prefs.primaryKey ?? prefs.defaultPrimaryKey ?? '') : null;
  const syncedFields = state.savedFields ?? toSyncFields(state.fields);
  const retryingNow = new Set(DESTINATIONS.filter(d => state.scanId && retrying.has(retryKey(state.scanId, d))));

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
          tray={tray}
          error={state.error}
          problem={problem}
          preparing={preparing}
          loadingSample={loadingSample}
          offline={offline}
          offlineSaved={offlineSaved}
          waitingOnline={waitingOnline}
          remembered={prefs?.fields ?? null}
          sampleHref={sampleHref}
          onTakePhoto={() => cameraInput.current?.click()}
          onUpload={() => uploadInput.current?.click()}
          onFiles={(files, source) => void addFiles(files, source)}
          onSample={() => void trySample()}
          onReadTray={() => void begin(tray, 'camera', trayScanId.current)}
          onRemoveTrayPage={(index) => {
            if (trayRef.current.length <= 1) trayScanId.current = null;
            setTray(current => current.filter((_, i) => i !== index));
          }}
          onRetry={() => void extract(state.pages)}
          onKeep={() => void keepForLater()}
          onSignIn={() => void signInToRead()}
          onRetake={() => {
            startOver();
            cameraInput.current?.click();
          }}
          onBackToPages={cancelReading}
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

      {state.step === 'extracting' && <ExtractingStep pages={state.pages} uploaded={uploaded} onCancel={cancelReading} onKeep={() => void keepForLater()} />}

      {(state.step === 'review' || state.step === 'saving') && (
        <ReviewStep
          state={state}
          dispatch={(action) => {
            if (action.type === 'auto-save-cancel') track('auto_save_cancelled', { profile: profileId });
            dispatch(action);
          }}
          documentName={documentName}
          saving={state.step === 'saving'}
          countdown={countdown}
          saveSent={saveSent}
          duplicateKey={duplicateKey}
          onDuplicateKey={(key) => void updatePrefs({ primaryKey: key })}
          kept={kept}
          onKeep={() => void keepReviewForLater()}
          onSignIn={signInAgain}
          onSave={() => void save()}
          onSaveWithoutVoice={() => {
            // The note text (and any transcript) stays; only the recording is dropped.
            dispatch({ type: 'audio', blob: null });
            void save(undefined, true);
          }}
          onStartOver={requestStartOver}
        />
      )}

      {state.step === 'done' && state.result && (
        <DoneStep
          result={state.result}
          fields={syncedFields}
          documentName={documentName}
          retrying={retryingNow}
          sessionEnded={retrySession}
          onSignIn={signInToRetry}
          withVoice={Boolean(state.audio)}
          offerRemember={offerRemember}
          offerNotion={!notionDismissed && state.result.destinations.notion?.code === 'not_connected'}
          onRetry={(destination) => void retry(destination)}
          onRemember={() => {
            track('fields_remembered', { profile: profileId, count: syncedFields.length });
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
          dispatch({ type: 'duplicate-close', choice: action });
          // Found by a Sheets retry on the Saved screen: only Sheets is sent again.
          if (stateRef.current.step === 'done') void retry('sheets', action);
          else void save(action);
        }}
      />

      <Dialog
        open={Boolean(leaving)}
        onClose={keepChecking}
        title={t(reading ? 'extract.leaveTitle' : trayWaiting ? 'capture.leaveTitle' : 'review.leaveTitle')}
        closeLabel={t('common.close')}
        description={reading
          ? t('extract.leaveBody')
          : trayWaiting
            ? t('capture.leaveBody', { count: tray.length })
            : t(kept ? 'review.leaveBodyKept' : 'review.leaveBody', { name: documentName })}
        actions={
          <div className={styles.choices}>
            <Button variant="primary" wrap onClick={keepChecking}>{t(reading ? 'extract.leaveStay' : trayWaiting ? 'capture.leaveKeep' : 'review.leaveKeep')}</Button>
            {reading && <Button wrap icon={<Clock size={18} aria-hidden />} onClick={() => void keepAndLeave()}>{t('capture.keep')}</Button>}
            <Button variant="danger" wrap onClick={discardAndLeave}>{t(reading ? 'extract.leaveDiscard' : trayWaiting ? 'capture.leaveDiscard' : 'review.leaveDiscard')}</Button>
          </div>
        }
      />
    </main>
  );
}
