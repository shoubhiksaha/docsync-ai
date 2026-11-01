'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { useSession } from 'next-auth/react';
import { BookOpen, Eye, EyeOff, KeyRound, LoaderCircle, LogIn, Sheet } from 'lucide-react';
import { useI18n } from '@/client/i18n/I18nProvider';
import type { Lang, MessageKey } from '@/client/i18n';
import { ApiError, fetchAllPrefs, fetchSettings, savePrefs, saveSettings, type ProfilePrefs, type SettingsStatus, type SettingsUpdate, type UploadDest } from '@/client/api';
import type { ErrorCode } from '@/client/scan-flow';
import { Badge, Button, ButtonLink, Card, Notice, TextField } from '../components/ui';
import styles from './settings.module.css';

const PROVIDERS: Record<NonNullable<SettingsStatus['aiProvider']>, string> = {
  groq: 'Groq',
  openai: 'OpenAI',
  google: 'Google Gemini',
  anthropic: 'Anthropic Claude',
};

/** Mirrors the server's key detection (modules/ai) so people see which provider a key is for. */
function detectProvider(key: string): SettingsStatus['aiProvider'] {
  const k = key.trim();
  if (!k) return null;
  if (k.startsWith('sk-ant-')) return 'anthropic';
  if (k.startsWith('gsk_')) return 'groq';
  if (k.startsWith('sk-') || k.startsWith('proj-')) return 'openai';
  if (k.startsWith('AIza') || k.startsWith('AQ.')) return 'google';
  return null;
}

/** What GET /api/settings also returns beyond client/api's SettingsStatus. */
type Status = SettingsStatus & {
  /** 'not_configured' = this server keeps settings per device by design; 'unreachable' = a passing problem. */
  syncState?: 'ok' | 'unreachable' | 'not_configured';
  /** The Google Sheet each document type has saved rows to on this device. */
  sheets?: { profileId: string; url: string }[];
  /** Whether a saved Notion connection still reaches its database; null without one. */
  notionState?: 'ok' | 'revoked' | 'missing_db' | 'unchecked' | null;
};

/** What POST /api/profile-prefs also returns beyond client/api's ProfilePrefs. */
type SavedPrefs = ProfilePrefs & {
  /** 'prefs_trimmed': a remembered list was shortened to fit on this device; 'cloud_sync_failed': not copied to other devices. */
  warning?: string;
  /** The document types whose list was shortened. */
  trimmed?: string[];
};

/**
 * What a settings save that worked here, but with a warning, says (POST /api/settings `warning`).
 * A tested key's result comes first; "sync_unavailable", "sync_off_failed", "key_not_enabled" and
 * "synced_from_other_device" are handled apart.
 */
const SAVE_WARNINGS: Record<string, MessageKey[]> = {
  key_unchecked: ['settings.ai.unchecked'],
  key_unchecked_cloud_sync_failed: ['settings.ai.unchecked', 'settings.cloudSyncFailed'],
  cloud_sync_failed: ['settings.cloudSyncFailed'],
  prefs_trimmed: ['settings.sync.prefsTrimmed'],
};

/** Where to look for the sheet when this device hasn't saved to it (another phone did, or another account used this one). */
const DRIVE_SEARCH_URL = `https://drive.google.com/drive/search?q=${encodeURIComponent('DocSync AI Data')}`;

/** How the Notion connect flow ended (?notion=<code> from /api/auth/notion and its callback). */
export type NotionResult = 'connected' | 'no_page' | 'cancelled' | 'failed' | 'disabled' | 'not_configured';

const NOTION_NOTICES: Record<Exclude<NotionResult, 'connected'>, { tone: 'info' | 'warning' | 'danger'; key: MessageKey }> = {
  no_page: { tone: 'warning', key: 'settings.notion.noPage' },
  cancelled: { tone: 'info', key: 'settings.notion.cancelled' },
  failed: { tone: 'danger', key: 'settings.notion.failed' },
  disabled: { tone: 'info', key: 'settings.notion.disabled' },
  not_configured: { tone: 'info', key: 'settings.notion.notConfigured' },
};

/** Outcomes that leave an earlier Notion connection as it was. */
const KEEPS_EARLIER: readonly NotionResult[] = ['no_page', 'cancelled', 'failed'];

const PHOTOS_LINE: Record<UploadDest, MessageKey> = {
  gdrive: 'settings.records.photosDrive',
  notion: 'settings.records.photosNotion',
  both: 'settings.records.photosBoth',
};

/** Remembered fields listed in full up to this many; longer lists get "Show all". */
const FIELDS_SHOWN = 4;

/** How long "Saved" stays beside a control that saves as soon as it is changed. */
const SAVED_SHOWN_MS = 4000;
/** "Opening Notion…" ignores further taps for this long, in case the redirect never starts. */
const NOTION_PENDING_MS = 10_000;

/** A field's name: as remembered, else as the document type names it, else "vehicleNumber" → "Vehicle Number". */
function fieldName(prefs: ProfilePrefs, labels: Record<string, string>, key: string): string {
  const remembered = prefs.fields?.find(f => f.key === key)?.label;
  return remembered || labels[key] || key.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/^./, c => c.toUpperCase());
}

/** Back to Settings after signing in again. */
function SignInAgain({ id }: { id?: string }) {
  const { t } = useI18n();
  return (
    <ButtonLink id={id} href={`/login?callbackUrl=${encodeURIComponent('/settings')}`} native variant="primary" icon={<LogIn size={18} aria-hidden />}>{t('review.signIn')}</ButtonLink>
  );
}

/** A load that failed, with a way on: try again, or sign in again when the session has ended. */
function LoadFailed({ code, message, retrying, onRetry, urgent }: {
  code: ErrorCode; message: string; retrying: boolean; onRetry: () => void; urgent?: boolean;
}) {
  const { t } = useI18n();
  const session = code === 'session';
  return (
    <Notice tone="danger" urgent={urgent}>
      <div className={styles.stack}>
        <p>{session ? t('error.session') : message}</p>
        <div className={styles.row}>
          {session ? (
            <SignInAgain />
          ) : (
            <Button loading={retrying} onClick={onRetry}>{t('common.retry')}</Button>
          )}
        </div>
      </div>
    </Notice>
  );
}

/** "Saving…", then "Saved", beside a control that saves as soon as it changes. */
function SaveStatus({ saving, saved }: { saving: boolean; saved: boolean }) {
  const { t } = useI18n();
  return <span className={styles.saveStatus} role="status">{saving ? t('common.saving') : saved ? t('settings.saved') : ''}</span>;
}

/** A second step before anything is removed; focus moves to the safe choice. */
function Confirm({ message, confirmLabel, busy, onConfirm, onCancel }: {
  message: string; confirmLabel: string; busy: boolean; onConfirm: () => void; onCancel: () => void;
}) {
  const { t } = useI18n();
  const cancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => cancelRef.current?.focus(), []);
  return (
    <div className={styles.confirm} role="group" aria-label={message}>
      <p>{message}</p>
      <div className={styles.row}>
        <Button variant="danger" loading={busy} onClick={onConfirm}>{confirmLabel}</Button>
        <Button ref={cancelRef} onClick={onCancel}>{t('common.cancel')}</Button>
      </div>
    </div>
  );
}

interface SettingsClientProps {
  /** `fields`: the document type's own field names, for a duplicate-check field that isn't remembered. */
  profiles: { id: string; name: string; fields: Record<string, string> }[];
  notionResult: NotionResult | null;
}

type Confirming = 'ai' | 'notion' | 'sync';
type SaveOutcome = 'ok' | 'failed' | 'refused' | 'not_enabled' | 'session';

/** Warnings that mean the switch didn't change: the cloud couldn't be reached to turn sync on, or to copy its values here to turn it off. */
const SYNC_NOT_CHANGED: Record<string, MessageKey> = {
  sync_unavailable: 'settings.sync.turnOnFailed',
  sync_off_failed: 'settings.sync.turnOffFailed',
};

export default function SettingsClient({ profiles, notionResult }: SettingsClientProps) {
  const { t, lang, setLang, switching } = useI18n();
  const { data: session } = useSession();
  const [settings, setSettings] = useState<Status | null>(null);
  const [loadError, setLoadError] = useState<ErrorCode | null>(null);
  const [prefs, setPrefs] = useState<Record<string, ProfilePrefs> | null>(null);
  const [prefsError, setPrefsError] = useState<ErrorCode | null>(null);
  const [keyInput, setKeyInput] = useState('');
  const [keyError, setKeyError] = useState<string | null>(null);
  const [showKey, setShowKey] = useState(false);
  const [replacingKey, setReplacingKey] = useState(false);
  // Per control, so one save finishing never re-enables another that is still running.
  const [busy, setBusy] = useState<ReadonlySet<string>>(() => new Set());
  const [confirming, setConfirming] = useState<Confirming | null>(null);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  // Where focus goes once the control that had it is gone (a confirmation closed, a key removed).
  const [focusTarget, setFocusTarget] = useState<string | null>(null);
  // The choice just tapped, shown at once while it saves; the saved value shows again after.
  const [pendingDest, setPendingDest] = useState<UploadDest | null>(null);
  const [pendingSync, setPendingSync] = useState<boolean | null>(null);
  // The control whose change was just saved, for its "Saved" line.
  const [justSaved, setJustSaved] = useState<string | null>(null);
  // Remembered fields forgotten on this visit, so their rows keep an Undo until the page is left.
  const [forgotten, setForgotten] = useState<Readonly<Record<string, { key: string; label: string }[]>>>({});
  const [openingNotion, setOpeningNotion] = useState(false);
  // A save found the session ended: a lasting way to sign in again, not a toast that goes.
  const [sessionEnded, setSessionEnded] = useState(false);
  // Turning sync on or off didn't reach the cloud, so it is as it was; said beside the switch.
  const [syncFailed, setSyncFailed] = useState<MessageKey | null>(null);
  const loads = useRef(0);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const savedTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const markBusy = (id: string, on: boolean) => setBusy(current => {
    const next = new Set(current);
    if (on) next.add(id);
    else next.delete(id);
    return next;
  });

  /** Saves run one at a time, so each request carries the cookies the one before it set. */
  const enqueue = <T,>(task: () => Promise<T>): Promise<T> => {
    const run = queue.current.then(task);
    queue.current = run.catch(() => undefined);
    return run;
  };

  /** Whether the settings shown are now the saved ones. */
  const load = useCallback(async (): Promise<boolean> => {
    const seq = ++loads.current;
    try {
      const next = await fetchSettings();
      // An older load that answers late must not show a stale choice.
      if (seq !== loads.current) return true;
      setSettings(next);
      setLoadError(null);
      return true;
    } catch (err) {
      if (seq === loads.current) setLoadError(err instanceof ApiError ? err.code : 'network');
      return false;
    }
  }, []);

  const loadPrefs = useCallback(async () => {
    try {
      setPrefs(await fetchAllPrefs());
      setPrefsError(null);
    } catch (err) {
      setPrefsError(err instanceof ApiError ? err.code : 'network');
    }
  }, []);

  const retry = async (id: string, task: () => Promise<unknown>) => {
    markBusy(id, true);
    await task();
    markBusy(id, false);
  };

  useEffect(() => {
    void load();
    void loadPrefs();
    if (notionResult) {
      if (notionResult === 'connected') toast.success(t('settings.notion.justConnected'));
      window.history.replaceState(null, '', '/settings');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load once
  }, []);

  useEffect(() => () => clearTimeout(savedTimer.current), []);

  // Back from Notion with the browser's Back button, the page can come back as it was left: still opening.
  useEffect(() => {
    if (!openingNotion) return;
    const reset = () => setOpeningNotion(false);
    const timer = setTimeout(reset, NOTION_PENDING_MS);
    const onShow = (event: PageTransitionEvent) => { if (event.persisted) reset(); };
    window.addEventListener('pageshow', onShow);
    return () => { clearTimeout(timer); window.removeEventListener('pageshow', onShow); };
  }, [openingNotion]);

  useEffect(() => {
    if (!focusTarget) return;
    document.getElementById(focusTarget)?.focus();
    setFocusTarget(null);
  }, [focusTarget]);

  const closeConfirm = (id: Confirming, focusId: string) => {
    setConfirming(c => (c === id ? null : c));
    setFocusTarget(focusId);
  };

  /** The session ended during a save: the sign-in notice at the top takes focus. Typed text stays. */
  const endSession = () => {
    setSessionEnded(true);
    setFocusTarget('sign-in-again');
  };

  /**
   * Saves one change right away (no "Save all" button) and reports the result. `message` null:
   * the control says "Saved" beside itself (SaveStatus) instead of in a toast. `patch` shows the
   * saved change at once, and the page reloads behind it: a reload checks Notion, which can take
   * seconds. Without `patch` the result waits for the reload (a new key's masked hint comes from it).
   */
  const update = (id: string, change: SettingsUpdate, message: string | null = t('settings.saved'), patch?: (s: Status) => Status) => enqueue(async (): Promise<SaveOutcome> => {
    markBusy(id, true);
    try {
      const { warning } = await saveSettings(change);
      // A Google key that can't use Gemini wasn't saved; the key card says why next to the field.
      if (warning === 'key_not_enabled') return 'not_enabled';
      const syncNotChanged = warning ? SYNC_NOT_CHANGED[warning] : undefined;
      if (patch && !syncNotChanged) setSettings(s => (s ? patch(s) : s));
      // A reload that fails after a good save keeps the page as it is, with a quiet word instead of the load error.
      const reload = load();
      const fresh = patch ? true : await reload;
      if (syncNotChanged) {
        setSyncFailed(syncNotChanged);
        return 'failed';
      }
      const lines = warning ? SAVE_WARNINGS[warning] : undefined;
      if (lines) {
        // "cloud_sync_failed" after a new key means the key was tested and works.
        const shown: MessageKey[] = warning === 'cloud_sync_failed' && change.openaiKey?.trim() ? ['settings.ai.keyWorks', ...lines] : lines;
        toast(<span className={styles.lines}>{shown.map(key => <span key={key}>{t(key)}</span>)}</span>, { icon: '⚠️' });
      } else if (warning === 'synced_from_other_device') toast(t('settings.sync.fromOtherDevice'));
      else if (!fresh) toast(t('settings.savedStale'));
      else if (message) toast.success(message);
      if (message === null && !lines) {
        clearTimeout(savedTimer.current);
        setJustSaved(id);
        savedTimer.current = setTimeout(() => setJustSaved(null), SAVED_SHOWN_MS);
      }
      return 'ok';
    } catch (err) {
      // 422 is the AI provider refusing a new key; the key card says so next to the field.
      if (err instanceof ApiError && err.status === 422) return 'refused';
      if (err instanceof ApiError && err.code === 'session') {
        endSession();
        return 'session';
      }
      toast.error(t('settings.saveFailed'));
      return 'failed';
    } finally {
      markBusy(id, false);
      setConfirming(c => (c === id ? null : c));
    }
  });

  const saveKey = async () => {
    const key = keyInput.trim();
    // Save key stays enabled (a greyed button gives no reason): an empty field says what to do.
    if (!key) {
      setKeyError(t('settings.ai.empty'));
      setFocusTarget('ai-key');
      return;
    }
    setKeyError(null);
    const outcome = await update('ai', { openaiKey: key }, t('settings.ai.keyWorks'));
    if (outcome === 'refused' || outcome === 'not_enabled') {
      setKeyError(outcome === 'not_enabled' ? t('settings.ai.notEnabled') : t('settings.ai.refused', { provider: PROVIDERS[detectProvider(key) ?? 'google'] }));
      setFocusTarget('ai-key');
    } else if (outcome === 'ok') {
      setKeyInput('');
      setShowKey(false);
      setReplacingKey(false);
    }
  };

  const removeWithConfirm = async (id: Confirming, change: SettingsUpdate, message: string | null, patch: (s: Status) => Status, trigger: string, replacement: string) => {
    const outcome = await update(id, change, message, patch);
    if (outcome !== 'session') setFocusTarget(outcome === 'ok' ? replacement : trigger);
  };

  /** The tapped choice shows at once; on failure the saved one comes back (with the error toast). */
  const chooseDest = async (value: UploadDest) => {
    setPendingDest(value);
    const outcome = await update('media', { uploadDest: value }, null, s => ({ ...s, uploadDest: value }));
    setPendingDest(p => (p === value ? null : p));
    return outcome;
  };

  /** From the "photos are not being saved" notice, which goes once this is saved: focus moves to the Drive choice. */
  const keepPhotosInDrive = async () => {
    if ((await chooseDest('gdrive')) === 'ok') setFocusTarget('upload-dest-gdrive');
  };

  const turnSyncOn = async () => {
    setSyncFailed(null);
    setPendingSync(true);
    await update('sync', { persistent: true }, null, s => ({ ...s, isPersistent: true }));
    setPendingSync(null);
  };

  /** Whether it saved. `onUndo` adds Undo to the toast. */
  const savePref = (profileId: string, change: Partial<Pick<ProfilePrefs, 'fields' | 'primaryKey'>>, message: string, onUndo?: () => void) => enqueue(async () => {
    const id = `prefs-${profileId}`;
    markBusy(id, true);
    try {
      const { warning, trimmed, ...next }: SavedPrefs = await savePrefs(profileId, change);
      setPrefs(current => ({ ...current, [profileId]: next }));
      if (warning === 'prefs_trimmed') {
        const types = (trimmed ?? [profileId]).map(id => profiles.find(p => p.id === id)?.name ?? id).join(', ');
        toast(t('settings.profiles.trimmed', { types }), { icon: '⚠️' });
      } else if (warning) toast(t('settings.cloudSyncFailed'), { icon: '⚠️' }); // saved here, not copied to other devices
      if (!onUndo) {
        if (!warning) toast.success(message);
        return true;
      }
      toast(item => (
        <span className={styles.undo}>
          {message}
          <Button variant="ghost" onClick={() => { toast.dismiss(item.id); onUndo(); }}>{t('recent.undo')}</Button>
        </span>
      ), { id: `forgot-${profileId}`, duration: 6000 });
      return true;
    } catch (err) {
      if (err instanceof ApiError && err.code === 'session') endSession();
      else toast.error(t('settings.saveFailed'));
      return false;
    } finally {
      markBusy(id, false);
    }
  });

  /**
   * Rebuilding a remembered list takes two more scans, so the row keeps an Undo until the page is
   * left (the toast's own Undo goes after a few seconds). Focus moves to the row, not the page.
   */
  const forget = async (profileId: string, fields: { key: string; label: string }[]) => {
    if (!(await savePref(profileId, { fields: null }, t('capture.forgotten'), () => void restore(profileId, fields)))) return;
    setForgotten(f => ({ ...f, [profileId]: fields }));
    setFocusTarget(`prefs-row-${profileId}`);
  };

  const restore = async (profileId: string, fields: { key: string; label: string }[]) => {
    toast.dismiss(`forgot-${profileId}`);
    if (!(await savePref(profileId, { fields }, t('settings.profiles.restored')))) return;
    setForgotten(f => Object.fromEntries(Object.entries(f).filter(([id]) => id !== profileId)));
    setFocusTarget(`forget-${profileId}`);
  };

  /**
   * The reset button goes with the change; focus moves to its row, or, when the row goes too
   * (nothing else remembered for that type), to the list or the "Nothing remembered" line.
   */
  const resetDuplicate = async (profileId: string, rowStays: boolean) => {
    if (!(await savePref(profileId, { primaryKey: null }, t('settings.profiles.duplicateReset')))) return;
    setFocusTarget(rowStays ? `prefs-row-${profileId}` : customised.length > 1 ? 'prefs-list' : 'prefs-empty');
  };

  const detected = detectProvider(keyInput);
  const notionConnected = Boolean(settings?.hasNotionKey && settings?.hasNotionDbId);
  // Connected, but the token was removed in Notion or the database is gone: Reconnect fixes both.
  const notionBroken = notionConnected && (settings?.notionState === 'revoked' || settings?.notionState === 'missing_db');
  // Photos set to go only to a Notion that isn't working are kept nowhere (with "Both", Drive still has them).
  const photosLost = notionBroken && settings?.uploadDest === 'notion';
  const notionNotice = notionResult && notionResult !== 'connected' ? NOTION_NOTICES[notionResult] : null;
  const prefsBusy = [...busy].some(id => id.startsWith('prefs-'));
  // Only document types with something remembered (or just forgotten, for Undo); the other 20-odd rows would say nothing.
  const customised = prefs ? profiles.filter(p => prefs[p.id]?.fields?.length || (prefs[p.id] && prefs[p.id].primaryKey !== null) || forgotten[p.id]) : [];
  // Usually one "DocSync AI Data" spreadsheet with a tab per document type; listed per sheet in case there are several.
  const sheets = Object.entries((settings?.sheets ?? []).reduce<Record<string, string[]>>((acc, s) => {
    const name = profiles.find(p => p.id === s.profileId)?.name ?? s.profileId;
    (acc[s.url] ??= []).push(name);
    return acc;
  }, {}));
  const syncState = settings?.syncState ?? (settings?.syncAvailable ? 'ok' : 'unreachable');

  return (
    <main id="main" className="container page">
      <div className={styles.wrap}>
        <h1 className={styles.title}>{t('settings.title')}</h1>

        {sessionEnded && (
          <Notice tone="danger" urgent>
            <div className={styles.stack}>
              <p>{t('error.session')}</p>
              <div className={styles.row}>
                <SignInAgain id="sign-in-again" />
              </div>
            </div>
          </Notice>
        )}

        <Card titleId="lang-title" title={t('settings.language.title')}>
          {/* Document type and field names come from the server and change only once its page arrives: busy till then. */}
          <fieldset className={styles.options} aria-busy={switching || undefined}>
            <legend className="sr-only">{t('settings.language.title')}</legend>
            {([['en', 'English'], ['hi', 'हिन्दी (Hindi)']] as [Lang, string][]).map(([value, label]) => (
              <label key={value} className={styles.option}>
                <input type="radio" name="lang" value={value} checked={lang === value} onChange={() => setLang(value)} />
                <span className={styles.optionLabel} lang={value}>{label}</span>
              </label>
            ))}
          </fieldset>
          <span className={styles.saveStatus} role="status">{switching ? t('settings.language.changing') : ''}</span>
        </Card>

        {/* Only when nothing could be shown: after a save, a failed reload keeps the page as it was. */}
        {!settings && loadError && (
          <LoadFailed code={loadError} message={t('settings.loadFailed')} retrying={busy.has('load-settings')} onRetry={() => retry('load-settings', load)} urgent />
        )}
        {!settings && !loadError && <div className="skeleton" style={{ height: 180 }} aria-label={t('common.loading')} />}

        {settings && (
          <>
            <Card titleId="records-title" title={t('settings.records.title')}>
              <div className={styles.stack}>
                {session?.user?.email && (
                  <p className={styles.account}>{t('settings.records.account', { email: session.user.email })}</p>
                )}
                <p>{t('settings.records.sheet')}</p>
                {/* Sheets are remembered per device, so a new phone may not know one that already has rows. */}
                {sheets.length === 0 && (
                  <>
                    <p className={styles.hint}>{t('settings.records.noSheet')}</p>
                    <div className={styles.row}>
                      <ButtonLink href={DRIVE_SEARCH_URL} external newTabLabel={t('common.newTab')} icon={<Sheet size={18} aria-hidden />} wrap>
                        {t('settings.records.findSheet')}
                      </ButtonLink>
                    </div>
                  </>
                )}
                {sheets.length > 0 && (
                  <div className={styles.row}>
                    {sheets.map(([url, names]) => (
                      <ButtonLink key={url} href={url} external newTabLabel={t('common.newTab')} icon={<Sheet size={18} aria-hidden />} wrap>
                        {sheets.length === 1 ? t('settings.records.openSheet') : t('settings.records.openSheetFor', { types: names.join(', ') })}
                      </ButtonLink>
                    ))}
                  </div>
                )}
                {/* Without a working Notion every photo goes to Drive, whatever was chosen before, unless only Notion was chosen. */}
                {photosLost
                  ? <p className={styles.warningText}>{t('settings.records.photosNotSaved')}</p>
                  : <p>{t(PHOTOS_LINE[notionConnected && !notionBroken ? settings.uploadDest : 'gdrive'])}</p>}
              </div>
            </Card>

            <Card
              titleId="notion-title"
              title={t('settings.notion.title')}
              description={t('settings.notion.body')}
              aside={notionConnected
                ? <Badge tone={notionBroken ? 'warning' : 'success'}>{t(notionBroken ? 'settings.notion.broken' : 'settings.notion.connected')}</Badge>
                : undefined}
            >
              <div className={styles.stack}>
                {notionNotice && (
                  <Notice tone={notionNotice.tone} urgent={notionNotice.tone === 'danger'}>
                    {t(notionNotice.key)}
                    {/* Beside the "Connected" badge, say that a failed reconnect left the earlier connection working. */}
                    {notionConnected && !notionBroken && KEEPS_EARLIER.includes(notionResult!) && ` ${t('settings.notion.keptEarlier')}`}
                  </Notice>
                )}
                {notionBroken && (!notionNotice || photosLost) && (
                  <Notice tone="warning">
                    <div className={styles.stack}>
                      {!notionNotice && <p>{t(settings.notionState === 'revoked' ? 'settings.notion.revoked' : 'settings.notion.missingDb')}</p>}
                      {photosLost && (
                        <>
                          <p>{t('settings.notion.photosNotSaved')}</p>
                          <div className={styles.row}>
                            <Button loading={busy.has('media')} onClick={keepPhotosInDrive}>{t('settings.notion.keepInDrive')}</Button>
                          </div>
                        </>
                      )}
                    </div>
                  </Notice>
                )}
                {confirming === 'notion' ? (
                  <Confirm
                    message={t('settings.notion.disconnectConfirm')}
                    confirmLabel={t('settings.notion.disconnectYes')}
                    busy={busy.has('notion')}
                    onConfirm={() => removeWithConfirm('notion', { notionKey: '', notionDbId: '' }, t('settings.notion.disconnected'), s => ({ ...s, hasNotionKey: false, hasNotionDbId: false, notionState: null }), 'notion-disconnect', 'notion-connect')}
                    onCancel={() => closeConfirm('notion', 'notion-disconnect')}
                  />
                ) : (
                  <div className={styles.row}>
                    {/* Another tap would start a second flow, and the first would then fail its state check. */}
                    <ButtonLink
                      id="notion-connect"
                      href="/api/auth/notion"
                      native
                      // Notion is an optional extra: only a broken connection makes Reconnect the thing to do.
                      variant={notionBroken ? 'primary' : 'secondary'}
                      icon={openingNotion ? <LoaderCircle className="spin" size={18} aria-hidden /> : <BookOpen size={18} aria-hidden />}
                      aria-busy={openingNotion || undefined}
                      onClick={e => {
                        if (openingNotion) e.preventDefault();
                        else if (!(e.metaKey || e.ctrlKey || e.shiftKey || e.altKey)) setOpeningNotion(true);
                      }}
                    >
                      {openingNotion ? t('settings.notion.opening') : notionConnected ? t('settings.notion.reconnect') : t('settings.notion.connect')}
                    </ButtonLink>
                    {(settings.hasNotionKey || settings.hasNotionDbId) && (
                      <Button id="notion-disconnect" variant="danger" onClick={() => setConfirming('notion')}>{t('settings.notion.disconnect')}</Button>
                    )}
                  </div>
                )}
                {/* Where photos go is only a choice once Notion is connected; otherwise they go to Drive. */}
                {notionConnected && (
                  <fieldset className={styles.options}>
                    <legend className={styles.legend}>{t('settings.media.title')}</legend>
                    <SaveStatus saving={busy.has('media')} saved={justSaved === 'media'} />
                    {([
                      ['gdrive', t('settings.media.gdrive'), t('settings.media.gdriveHint')],
                      ['notion', t('settings.media.notion'), t('settings.media.notionHint')],
                      ['both', t('settings.media.both'), t('settings.media.bothHint')],
                    ] as [UploadDest, string, string][]).map(([value, label, hint]) => (
                      <label key={value} className={styles.option}>
                        <input
                          id={`upload-dest-${value}`}
                          type="radio"
                          name="uploadDest"
                          value={value}
                          checked={(pendingDest ?? settings.uploadDest) === value}
                          onChange={() => chooseDest(value)}
                        />
                        <span>
                          <span className={styles.optionLabel}>{label}</span>
                          <span className={styles.hint}>{hint}</span>
                        </span>
                      </label>
                    ))}
                  </fieldset>
                )}
              </div>
            </Card>

            <Card titleId="prefs-title" title={t('settings.profiles.title')} description={t('settings.profiles.body')}>
              {!prefs && prefsError && (
                <LoadFailed code={prefsError} message={t('settings.profiles.loadFailed')} retrying={busy.has('load-prefs')} onRetry={() => retry('load-prefs', loadPrefs)} />
              )}
              {!prefs && !prefsError && <div className="skeleton" style={{ height: 48 }} aria-label={t('common.loading')} />}
              {prefs && customised.length === 0 && <p id="prefs-empty" tabIndex={-1} className={styles.hint}>{t('settings.profiles.empty')}</p>}
              {customised.length > 0 && (
                <ul id="prefs-list" tabIndex={-1} className={styles.list}>
                  {customised.map(profile => {
                    const pref = prefs![profile.id];
                    const fields = pref.fields ?? [];
                    const id = `prefs-${profile.id}`;
                    const showAll = expanded.has(profile.id) || fields.length <= FIELDS_SHOWN + 1;
                    const defaultField = pref.defaultPrimaryKey ? fieldName(pref, profile.fields, pref.defaultPrimaryKey) : null;
                    const cleared = fields.length === 0 ? forgotten[profile.id] : undefined;
                    const mine = busy.has(id);
                    return (
                      <li key={profile.id} className={styles.listItem}>
                        <span id={`prefs-row-${profile.id}`} tabIndex={-1}>
                          <span className={styles.optionLabel}>{profile.name}</span>
                          {cleared && <span className={styles.hint}>{t('capture.forgotten')}</span>}
                          {fields.length > 0 && (
                            <span className={styles.hint}>
                              {fields.length === 1 ? t('settings.profiles.countOne') : t('settings.profiles.count', { count: fields.length })}
                              {': '}
                              {(showAll ? fields : fields.slice(0, FIELDS_SHOWN)).map(f => f.label).join(', ')}
                              {!showAll && (
                                <>
                                  {' '}
                                  {/* The button goes once the list is open, so focus moves to the row, which now reads every field. */}
                                  <button
                                    type="button"
                                    className={styles.linkButton}
                                    aria-label={t('settings.profiles.showAllFor', { count: fields.length, type: profile.name })}
                                    onClick={() => { setExpanded(s => new Set(s).add(profile.id)); setFocusTarget(`prefs-row-${profile.id}`); }}
                                  >
                                    {t('settings.profiles.showAll', { count: fields.length })}
                                  </button>
                                </>
                              )}
                            </span>
                          )}
                          {pref.primaryKey !== null && (
                            <span className={styles.hint}>
                              {pref.primaryKey === '' ? t('settings.profiles.duplicateOff') : t('settings.profiles.duplicate', { field: fieldName(pref, profile.fields, pref.primaryKey) })}
                            </span>
                          )}
                        </span>
                        <div className={styles.row}>
                          {/* The pressed button stays enabled (loading), so focus isn't dropped to the page. */}
                          {fields.length > 0 && (
                            <Button
                              id={`forget-${profile.id}`}
                              loading={mine}
                              disabled={prefsBusy && !mine}
                              aria-label={t('settings.profiles.forgetFor', { type: profile.name })}
                              onClick={() => forget(profile.id, fields)}
                            >
                              {t('settings.profiles.forget')}
                            </Button>
                          )}
                          {cleared && (
                            <Button
                              loading={mine}
                              disabled={prefsBusy && !mine}
                              aria-label={t('settings.profiles.undoFor', { type: profile.name })}
                              onClick={() => restore(profile.id, cleared)}
                            >
                              {t('recent.undo')}
                            </Button>
                          )}
                          {pref.primaryKey !== null && (
                            <Button
                              loading={mine}
                              disabled={prefsBusy && !mine}
                              aria-label={defaultField
                                ? t('settings.profiles.useDefaultFor', { field: defaultField, type: profile.name })
                                : t('settings.profiles.resetDuplicateFor', { type: profile.name })}
                              onClick={() => resetDuplicate(profile.id, fields.length > 0 || Boolean(cleared))}
                            >
                              {defaultField ? t('settings.profiles.useDefault', { field: defaultField }) : t('settings.profiles.resetDuplicate')}
                            </Button>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </Card>

            <Card titleId="ai-title" title={t('settings.ai.title')} description={t('settings.ai.body')}>
              {settings.hasOpenAiKey && !replacingKey ? (
                <div className={styles.stack}>
                  <p className={styles.savedKey}>
                    <KeyRound size={18} aria-hidden />
                    {t('settings.ai.saved', { provider: settings.aiProvider ? PROVIDERS[settings.aiProvider] : 'AI', hint: settings.aiKeyHint ?? '' })}
                  </p>
                  {confirming === 'ai' ? (
                    <Confirm
                      message={t('settings.ai.removeConfirm')}
                      confirmLabel={t('settings.ai.removeYes')}
                      busy={busy.has('ai')}
                      onConfirm={() => removeWithConfirm('ai', { openaiKey: '' }, t('settings.ai.removed'), s => ({ ...s, hasOpenAiKey: false, aiKeyHint: null, aiProvider: null }), 'ai-remove', 'ai-key')}
                      onCancel={() => closeConfirm('ai', 'ai-remove')}
                    />
                  ) : (
                    <div className={styles.row}>
                      <Button onClick={() => { setReplacingKey(true); setFocusTarget('ai-key'); }}>{t('settings.ai.replace')}</Button>
                      <Button id="ai-remove" variant="danger" onClick={() => setConfirming('ai')}>{t('settings.ai.remove')}</Button>
                    </div>
                  )}
                </div>
              ) : (
                <div className={styles.stack}>
                  {/* A password field while hidden, so screen readers don't speak the key either (letters masked
                      only by CSS were read out). Chrome ignores autoComplete "off" on a password field and offers to
                      keep it as a site password once its form is sent and goes away, so there is no form (Enter
                      saves here instead) and "one-time-code" marks it as no password; password managers' own flags too. */}
                  <TextField
                    id="ai-key"
                    name="api-key"
                    label={t('settings.ai.label')}
                    type={showKey ? 'text' : 'password'}
                    autoComplete="one-time-code"
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    enterKeyHint="done"
                    data-1p-ignore
                    data-lpignore="true"
                    value={keyInput}
                    onChange={e => { setKeyInput(e.target.value); setKeyError(null); }}
                    onKeyDown={e => {
                      if (e.key !== 'Enter' || e.nativeEvent.isComposing) return;
                      e.preventDefault();
                      if (!busy.has('ai')) void saveKey();
                    }}
                    hint={keyInput.trim() ? (detected ? t('settings.ai.detected', { provider: PROVIDERS[detected] }) : t('settings.ai.unknown')) : t('settings.ai.keyHint')}
                    error={keyError ?? undefined}
                  />
                  {detected === 'anthropic' && <p className={styles.hint}>{t('settings.ai.anthropicNote')}</p>}
                  <div className={styles.row}>
                    <Button variant="primary" loading={busy.has('ai')} onClick={() => void saveKey()}>
                      {busy.has('ai') ? t('settings.ai.checking') : t('settings.ai.saveKey')}
                    </Button>
                    <Button
                      variant="ghost"
                      aria-pressed={showKey}
                      icon={showKey ? <EyeOff size={18} aria-hidden /> : <Eye size={18} aria-hidden />}
                      onClick={() => setShowKey(s => !s)}
                    >
                      {showKey ? t('settings.ai.hide') : t('settings.ai.show')}
                    </Button>
                    {replacingKey && <Button onClick={() => { setReplacingKey(false); setKeyInput(''); setKeyError(null); setShowKey(false); }}>{t('common.cancel')}</Button>}
                  </div>
                </div>
              )}
              <p className={styles.hint}>
                {t('settings.ai.getFree')}{' '}
                <a href="https://console.groq.com/keys" target="_blank" rel="noreferrer">Groq<span className="sr-only"> {t('common.newTab')}</span></a>
                {' · '}
                <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noreferrer">Google AI Studio<span className="sr-only"> {t('common.newTab')}</span></a>
              </p>
            </Card>

            {/* A server without Firestore keeps settings per device by design; there is nothing to choose. */}
            {syncState !== 'not_configured' && (
              <Card titleId="sync-title" title={t('settings.sync.heading')}>
                {syncState === 'unreachable' ? (
                  <Notice>{t('settings.sync.unavailable')}</Notice>
                ) : (
                  <div className={styles.stack}>
                    <label className={styles.option}>
                      <input
                        id="sync-toggle"
                        type="checkbox"
                        checked={pendingSync ?? settings.isPersistent}
                        disabled={confirming === 'sync'}
                        // Not disabled while saving, so focus stays here; a change meanwhile is ignored.
                        aria-disabled={busy.has('sync') || undefined}
                        onChange={e => {
                          if (busy.has('sync')) return;
                          if (e.target.checked) void turnSyncOn();
                          else setConfirming('sync');
                        }}
                      />
                      <span>
                        <span className={styles.optionLabel}>{t('settings.sync.title')}</span>
                        <span className={styles.hint}>{settings.isPersistent ? t('settings.sync.on') : t('settings.sync.off')}</span>
                      </span>
                    </label>
                    <SaveStatus saving={busy.has('sync')} saved={justSaved === 'sync'} />
                    {/* Until the switch shows the other way (a later try worked, or another device changed it). */}
                    {syncFailed && (syncFailed === 'settings.sync.turnOffFailed') === settings.isPersistent && <Notice tone="danger" urgent>{t(syncFailed)}</Notice>}
                    {confirming === 'sync' && (
                      <Confirm
                        message={t('settings.sync.offConfirm')}
                        confirmLabel={t('settings.sync.offYes')}
                        busy={busy.has('sync')}
                        onConfirm={() => { setSyncFailed(null); void removeWithConfirm('sync', { persistent: false }, null, s => ({ ...s, isPersistent: false }), 'sync-toggle', 'sync-toggle'); }}
                        onCancel={() => closeConfirm('sync', 'sync-toggle')}
                      />
                    )}
                  </div>
                )}
              </Card>
            )}
          </>
        )}
      </div>
    </main>
  );
}
