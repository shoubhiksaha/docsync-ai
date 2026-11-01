'use client';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import toast from 'react-hot-toast';
import { useSession } from 'next-auth/react';
import { BookOpen, Eye, EyeOff, KeyRound, Sheet } from 'lucide-react';
import { useI18n } from '@/client/i18n/I18nProvider';
import type { Lang, MessageKey } from '@/client/i18n';
import { ApiError, errorCodeFor, fetchSettings, savePrefs, saveSettings, type ProfilePrefs, type SettingsStatus, type SettingsUpdate, type UploadDest } from '@/client/api';
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
  if (k.startsWith('AIza')) return 'google';
  return null;
}

/** What GET /api/settings also returns beyond client/api's SettingsStatus. */
type Status = SettingsStatus & {
  /** 'not_configured' = this server keeps settings per device by design; 'unreachable' = a passing problem. */
  syncState?: 'ok' | 'unreachable' | 'not_configured';
  /** The Google Sheet each document type has saved rows to on this device. */
  sheets?: { profileId: string; url: string }[];
};

/** How the Notion connect flow ended (?notion=<code> from /api/auth/notion and its callback). */
export type NotionResult = 'connected' | 'no_page' | 'cancelled' | 'failed' | 'disabled' | 'not_configured';

const NOTION_NOTICES: Record<Exclude<NotionResult, 'connected'>, { tone: 'info' | 'warning' | 'danger'; key: MessageKey }> = {
  no_page: { tone: 'warning', key: 'settings.notion.noPage' },
  cancelled: { tone: 'info', key: 'settings.notion.cancelled' },
  failed: { tone: 'danger', key: 'settings.notion.failed' },
  disabled: { tone: 'info', key: 'settings.notion.disabled' },
  not_configured: { tone: 'info', key: 'settings.notion.notConfigured' },
};

const PHOTOS_LINE: Record<UploadDest, MessageKey> = {
  gdrive: 'settings.records.photosDrive',
  notion: 'settings.records.photosNotion',
  both: 'settings.records.photosBoth',
};

/** Remembered fields listed in full up to this many; longer lists get "Show all". */
const FIELDS_SHOWN = 4;

/** Every document type's preferences in one request (GET /api/profile-prefs without ?profile). */
async function fetchAllPrefs(): Promise<Record<string, ProfilePrefs>> {
  let response: Response;
  try {
    response = await fetch('/api/profile-prefs');
  } catch {
    throw new ApiError('network');
  }
  const body = await response.json().catch(() => null);
  if (response.status !== 200 || !body?.profiles) throw new ApiError(errorCodeFor(response.status, body), response.status);
  return body.profiles;
}

/** A field's name: as remembered, else as the document type names it, else "vehicleNumber" → "Vehicle Number". */
function fieldName(prefs: ProfilePrefs, labels: Record<string, string>, key: string): string {
  const remembered = prefs.fields?.find(f => f.key === key)?.label;
  return remembered || labels[key] || key.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/^./, c => c.toUpperCase());
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
type SaveOutcome = 'ok' | 'failed' | 'refused';

export default function SettingsClient({ profiles, notionResult }: SettingsClientProps) {
  const { t, lang, setLang } = useI18n();
  const { data: session } = useSession();
  const [settings, setSettings] = useState<Status | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [prefs, setPrefs] = useState<Record<string, ProfilePrefs> | null>(null);
  const [prefsFailed, setPrefsFailed] = useState(false);
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
  const loads = useRef(0);
  const queue = useRef<Promise<unknown>>(Promise.resolve());

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

  const load = useCallback(async () => {
    const seq = ++loads.current;
    try {
      const next = await fetchSettings();
      // An older load that answers late must not show a stale choice.
      if (seq !== loads.current) return;
      setSettings(next);
      setLoadFailed(false);
    } catch {
      if (seq === loads.current) setLoadFailed(true);
    }
  }, []);

  useEffect(() => {
    void load();
    fetchAllPrefs().then(setPrefs, () => setPrefsFailed(true));
    if (notionResult) {
      if (notionResult === 'connected') toast.success(t('settings.notion.justConnected'));
      window.history.replaceState(null, '', '/settings');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load once
  }, []);

  useEffect(() => {
    if (!focusTarget) return;
    document.getElementById(focusTarget)?.focus();
    setFocusTarget(null);
  }, [focusTarget]);

  const closeConfirm = (id: Confirming, focusId: string) => {
    setConfirming(c => (c === id ? null : c));
    setFocusTarget(focusId);
  };

  /** Saves one change right away (no "Save all" button) and reports the result. */
  const update = (id: string, change: SettingsUpdate, message = t('settings.saved')) => enqueue(async (): Promise<SaveOutcome> => {
    markBusy(id, true);
    try {
      const { warning } = await saveSettings(change);
      await load();
      if (warning === 'key_unchecked') toast(t('settings.ai.unchecked'), { icon: '⚠️' });
      else if (warning) toast(t('settings.cloudSyncFailed'), { icon: '⚠️' }); // saved here, not copied to other devices
      else toast.success(message);
      return 'ok';
    } catch (err) {
      // 422 is the AI provider refusing a new key; the key card says so next to the field.
      if (err instanceof ApiError && err.status === 422) return 'refused';
      toast.error(err instanceof ApiError && err.code === 'session' ? t('error.session') : t('settings.saveFailed'));
      return 'failed';
    } finally {
      markBusy(id, false);
      setConfirming(c => (c === id ? null : c));
    }
  });

  const saveKey = async (e: FormEvent) => {
    e.preventDefault();
    const key = keyInput.trim();
    if (!key) return;
    setKeyError(null);
    const outcome = await update('ai', { openaiKey: key }, t('settings.ai.keyWorks'));
    if (outcome === 'refused') {
      setKeyError(t('settings.ai.refused', { provider: PROVIDERS[detectProvider(key) ?? 'google'] }));
      setFocusTarget('ai-key');
    } else if (outcome === 'ok') {
      setKeyInput('');
      setShowKey(false);
      setReplacingKey(false);
    }
  };

  const removeWithConfirm = async (id: Confirming, change: SettingsUpdate, message: string, trigger: string, replacement: string) => {
    const outcome = await update(id, change, message);
    setFocusTarget(outcome === 'ok' ? replacement : trigger);
  };

  const savePref = (profileId: string, change: Partial<Pick<ProfilePrefs, 'fields' | 'primaryKey'>>, message: string, undo?: Partial<Pick<ProfilePrefs, 'fields' | 'primaryKey'>>) => enqueue(async () => {
    const id = `prefs-${profileId}`;
    markBusy(id, true);
    try {
      const next = await savePrefs(profileId, change);
      setPrefs(current => ({ ...current, [profileId]: next }));
      if (!undo) {
        toast.success(message);
        return;
      }
      // Rebuilding a remembered list takes two more scans, so a mis-tap can be undone for a few seconds.
      toast(item => (
        <span className={styles.undo}>
          {message}
          <Button variant="ghost" onClick={() => { toast.dismiss(item.id); void savePref(profileId, undo, t('settings.profiles.restored')); }}>{t('recent.undo')}</Button>
        </span>
      ), { id: `forgot-${profileId}`, duration: 6000 });
    } catch {
      toast.error(t('settings.saveFailed'));
    } finally {
      markBusy(id, false);
    }
  });

  const detected = detectProvider(keyInput);
  const notionConnected = Boolean(settings?.hasNotionKey && settings?.hasNotionDbId);
  const notionNotice = notionResult && notionResult !== 'connected' ? NOTION_NOTICES[notionResult] : null;
  const prefsBusy = [...busy].some(id => id.startsWith('prefs-'));
  // Only document types with something remembered; the other 20-odd rows would say nothing.
  const customised = prefs ? profiles.filter(p => prefs[p.id]?.fields?.length || (prefs[p.id] && prefs[p.id].primaryKey !== null)) : [];
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

        <Card titleId="lang-title" title={t('settings.language.title')}>
          <fieldset className={styles.options}>
            <legend className="sr-only">{t('settings.language.title')}</legend>
            {([['en', 'English'], ['hi', 'हिन्दी (Hindi)']] as [Lang, string][]).map(([value, label]) => (
              <label key={value} className={styles.option}>
                <input type="radio" name="lang" value={value} checked={lang === value} onChange={() => setLang(value)} />
                <span className={styles.optionLabel} lang={value}>{label}</span>
              </label>
            ))}
          </fieldset>
        </Card>

        {loadFailed && <Notice tone="danger" urgent>{t('settings.loadFailed')}</Notice>}
        {!settings && !loadFailed && <div className="skeleton" style={{ height: 180 }} aria-label={t('common.loading')} />}

        {settings && (
          <>
            <Card titleId="records-title" title={t('settings.records.title')}>
              <div className={styles.stack}>
                {session?.user?.email && (
                  <p className={styles.account}>{t('settings.records.account', { email: session.user.email })}</p>
                )}
                <p>{t('settings.records.sheet')}</p>
                {sheets.length === 0 && <p className={styles.hint}>{t('settings.records.noSheet')}</p>}
                {sheets.length > 0 && (
                  <div className={styles.row}>
                    {sheets.map(([url, names]) => (
                      <ButtonLink key={url} href={url} external newTabLabel={t('common.newTab')} icon={<Sheet size={18} aria-hidden />} wrap>
                        {sheets.length === 1 ? t('settings.records.openSheet') : t('settings.records.openSheetFor', { types: names.join(', ') })}
                      </ButtonLink>
                    ))}
                  </div>
                )}
                {/* Without Notion every photo goes to Drive, whatever was chosen before. */}
                <p>{t(PHOTOS_LINE[notionConnected ? settings.uploadDest : 'gdrive'])}</p>
              </div>
            </Card>

            <Card
              titleId="notion-title"
              title={t('settings.notion.title')}
              description={t('settings.notion.body')}
              aside={notionConnected ? <Badge tone="success">{t('settings.notion.connected')}</Badge> : undefined}
            >
              <div className={styles.stack}>
                {notionNotice && <Notice tone={notionNotice.tone} urgent={notionNotice.tone === 'danger'}>{t(notionNotice.key)}</Notice>}
                {confirming === 'notion' ? (
                  <Confirm
                    message={t('settings.notion.disconnectConfirm')}
                    confirmLabel={t('settings.notion.disconnectYes')}
                    busy={busy.has('notion')}
                    onConfirm={() => removeWithConfirm('notion', { notionKey: '', notionDbId: '' }, t('settings.notion.disconnected'), 'notion-disconnect', 'notion-connect')}
                    onCancel={() => closeConfirm('notion', 'notion-disconnect')}
                  />
                ) : (
                  <div className={styles.row}>
                    <ButtonLink id="notion-connect" href="/api/auth/notion" native variant={notionConnected ? 'secondary' : 'primary'} icon={<BookOpen size={18} aria-hidden />}>
                      {notionConnected ? t('settings.notion.reconnect') : t('settings.notion.connect')}
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
                    {([
                      ['gdrive', t('settings.media.gdrive'), t('settings.media.gdriveHint')],
                      ['notion', t('settings.media.notion'), t('settings.media.notionHint')],
                      ['both', t('settings.media.both'), t('settings.media.bothHint')],
                    ] as [UploadDest, string, string][]).map(([value, label, hint]) => (
                      <label key={value} className={styles.option}>
                        <input
                          type="radio"
                          name="uploadDest"
                          value={value}
                          checked={settings.uploadDest === value}
                          disabled={busy.has('media')}
                          onChange={() => update('media', { uploadDest: value })}
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
              {prefsFailed && <Notice tone="danger">{t('settings.profiles.loadFailed')}</Notice>}
              {!prefs && !prefsFailed && <div className="skeleton" style={{ height: 48 }} aria-label={t('common.loading')} />}
              {prefs && customised.length === 0 && <p className={styles.hint}>{t('settings.profiles.empty')}</p>}
              {customised.length > 0 && (
                <ul className={styles.list}>
                  {customised.map(profile => {
                    const pref = prefs![profile.id];
                    const fields = pref.fields ?? [];
                    const id = `prefs-${profile.id}`;
                    const showAll = expanded.has(profile.id) || fields.length <= FIELDS_SHOWN + 1;
                    const defaultField = pref.defaultPrimaryKey ? fieldName(pref, profile.fields, pref.defaultPrimaryKey) : null;
                    return (
                      <li key={profile.id} className={styles.listItem}>
                        <span>
                          <span className={styles.optionLabel}>{profile.name}</span>
                          {fields.length > 0 && (
                            <span className={styles.hint}>
                              {fields.length === 1 ? t('settings.profiles.countOne') : t('settings.profiles.count', { count: fields.length })}
                              {': '}
                              {(showAll ? fields : fields.slice(0, FIELDS_SHOWN)).map(f => f.label).join(', ')}
                              {!showAll && (
                                <>
                                  {' '}
                                  <button type="button" className={styles.linkButton} onClick={() => setExpanded(s => new Set(s).add(profile.id))}>
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
                          {fields.length > 0 && (
                            <Button
                              loading={busy.has(id)}
                              disabled={prefsBusy}
                              onClick={() => savePref(profile.id, { fields: null }, t('capture.forgotten'), { fields })}
                            >
                              {t('settings.profiles.forget')}
                            </Button>
                          )}
                          {pref.primaryKey !== null && (
                            <Button loading={busy.has(id)} disabled={prefsBusy} onClick={() => savePref(profile.id, { primaryKey: null }, t('settings.profiles.duplicateReset'))}>
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
                      onConfirm={() => removeWithConfirm('ai', { openaiKey: '' }, t('settings.ai.removed'), 'ai-remove', 'ai-key')}
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
                <form className={styles.stack} onSubmit={saveKey}>
                  <TextField
                    id="ai-key"
                    label={t('settings.ai.label')}
                    type={showKey ? 'text' : 'password'}
                    autoComplete="off"
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    placeholder="gsk_… / AIza… / sk-…"
                    value={keyInput}
                    onChange={e => { setKeyInput(e.target.value); setKeyError(null); }}
                    hint={keyInput.trim() ? (detected ? t('settings.ai.detected', { provider: PROVIDERS[detected] }) : t('settings.ai.unknown')) : undefined}
                    error={keyError ?? undefined}
                  />
                  {detected === 'anthropic' && <p className={styles.hint}>{t('settings.ai.anthropicNote')}</p>}
                  <div className={styles.row}>
                    <Button type="submit" variant="primary" loading={busy.has('ai')} disabled={!keyInput.trim()}>
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
                </form>
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
                        checked={settings.isPersistent}
                        disabled={busy.has('sync') || confirming === 'sync'}
                        onChange={e => (e.target.checked ? update('sync', { persistent: true }) : setConfirming('sync'))}
                      />
                      <span>
                        <span className={styles.optionLabel}>{t('settings.sync.title')}</span>
                        <span className={styles.hint}>{settings.isPersistent ? t('settings.sync.on') : t('settings.sync.off')}</span>
                      </span>
                    </label>
                    {confirming === 'sync' && (
                      <Confirm
                        message={t('settings.sync.offConfirm')}
                        confirmLabel={t('settings.sync.offYes')}
                        busy={busy.has('sync')}
                        onConfirm={() => removeWithConfirm('sync', { persistent: false }, t('settings.saved'), 'sync-toggle', 'sync-toggle')}
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
