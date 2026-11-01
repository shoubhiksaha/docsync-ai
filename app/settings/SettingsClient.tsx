'use client';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import toast from 'react-hot-toast';
import { BookOpen, Eye, EyeOff, KeyRound } from 'lucide-react';
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

/** How the Notion connect flow ended (?notion=<code> from /api/auth/notion and its callback). */
export type NotionResult = 'connected' | 'no_page' | 'cancelled' | 'failed' | 'disabled' | 'not_configured';

const NOTION_NOTICES: Record<Exclude<NotionResult, 'connected'>, { tone: 'info' | 'warning' | 'danger'; key: MessageKey }> = {
  no_page: { tone: 'warning', key: 'settings.notion.noPage' },
  cancelled: { tone: 'info', key: 'settings.notion.cancelled' },
  failed: { tone: 'danger', key: 'settings.notion.failed' },
  disabled: { tone: 'info', key: 'settings.notion.disabled' },
  not_configured: { tone: 'info', key: 'settings.notion.notConfigured' },
};

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

/** "vehicleNumber" → "Vehicle Number", for a duplicate-check field that isn't among the remembered ones. */
function fieldName(prefs: ProfilePrefs, key: string): string {
  const remembered = prefs.fields?.find(f => f.key === key)?.label;
  return remembered || key.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/^./, c => c.toUpperCase());
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
  profiles: { id: string; name: string }[];
  notionResult: NotionResult | null;
}

export default function SettingsClient({ profiles, notionResult }: SettingsClientProps) {
  const { t, lang, setLang } = useI18n();
  const [settings, setSettings] = useState<SettingsStatus | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [prefs, setPrefs] = useState<Record<string, ProfilePrefs> | null>(null);
  const [prefsFailed, setPrefsFailed] = useState(false);
  const [keyInput, setKeyInput] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [replacingKey, setReplacingKey] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<'ai' | 'notion' | 'sync' | null>(null);

  const load = useCallback(async () => {
    try {
      setSettings(await fetchSettings());
      setLoadFailed(false);
    } catch {
      setLoadFailed(true);
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

  /** Saves one change right away (no "Save all" button) and reports the result. */
  const update = async (id: string, change: SettingsUpdate, message = t('settings.saved')) => {
    setBusy(id);
    try {
      const { warning } = await saveSettings(change);
      await load();
      // The only warning is "saved here, but not copied to your other devices".
      if (warning) toast(t('settings.cloudSyncFailed'), { icon: '⚠️' });
      else toast.success(message);
      return true;
    } catch (err) {
      toast.error(err instanceof ApiError && err.code === 'session' ? t('error.session') : t('settings.saveFailed'));
      return false;
    } finally {
      setBusy(null);
      setConfirming(null);
    }
  };

  const saveKey = async (e: FormEvent) => {
    e.preventDefault();
    if (!keyInput.trim()) return;
    if (await update('ai', { openaiKey: keyInput.trim() })) {
      setKeyInput('');
      setShowKey(false);
      setReplacingKey(false);
    }
  };

  const savePref = async (profileId: string, change: Partial<Pick<ProfilePrefs, 'fields' | 'primaryKey'>>, message: string) => {
    setBusy(`prefs-${profileId}`);
    try {
      const next = await savePrefs(profileId, change);
      setPrefs(current => ({ ...current, [profileId]: next }));
      toast.success(message);
    } catch {
      toast.error(t('settings.saveFailed'));
    } finally {
      setBusy(null);
    }
  };

  const detected = detectProvider(keyInput);
  const notionConnected = Boolean(settings?.hasNotionKey && settings?.hasNotionDbId);
  const notionNotice = notionResult && notionResult !== 'connected' ? NOTION_NOTICES[notionResult] : null;
  // Only document types with something remembered; the other 20-odd rows would say nothing.
  const customised = prefs ? profiles.filter(p => prefs[p.id]?.fields?.length || (prefs[p.id] && prefs[p.id].primaryKey !== null)) : [];

  return (
    <main id="main" className="container page">
      <div className={styles.wrap}>
        <h1 className={styles.title}>{t('settings.title')}</h1>

        {loadFailed && <Notice tone="danger" urgent>{t('settings.loadFailed')}</Notice>}
        {!settings && !loadFailed && <div className="skeleton" style={{ height: 180 }} aria-label={t('common.loading')} />}

        {settings && (
          <>
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
                      busy={busy === 'ai'}
                      onConfirm={() => update('ai', { openaiKey: '' }, t('settings.ai.removed'))}
                      onCancel={() => setConfirming(null)}
                    />
                  ) : (
                    <div className={styles.row}>
                      <Button onClick={() => setReplacingKey(true)}>{t('settings.ai.replace')}</Button>
                      <Button variant="danger" onClick={() => setConfirming('ai')}>{t('settings.ai.remove')}</Button>
                    </div>
                  )}
                </div>
              ) : (
                <form className={styles.stack} onSubmit={saveKey}>
                  <TextField
                    label={t('settings.ai.label')}
                    type={showKey ? 'text' : 'password'}
                    autoComplete="off"
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    placeholder="gsk_… / AIza… / sk-…"
                    value={keyInput}
                    onChange={e => setKeyInput(e.target.value)}
                    hint={keyInput.trim() ? (detected ? t('settings.ai.detected', { provider: PROVIDERS[detected] }) : t('settings.ai.unknown')) : undefined}
                  />
                  {detected === 'anthropic' && <p className={styles.hint}>{t('settings.ai.anthropicNote')}</p>}
                  <div className={styles.row}>
                    <Button type="submit" variant="primary" loading={busy === 'ai'} disabled={!keyInput.trim()}>{t('settings.ai.saveKey')}</Button>
                    <Button
                      variant="ghost"
                      aria-pressed={showKey}
                      icon={showKey ? <EyeOff size={18} aria-hidden /> : <Eye size={18} aria-hidden />}
                      onClick={() => setShowKey(s => !s)}
                    >
                      {showKey ? t('settings.ai.hide') : t('settings.ai.show')}
                    </Button>
                    {replacingKey && <Button onClick={() => { setReplacingKey(false); setKeyInput(''); setShowKey(false); }}>{t('common.cancel')}</Button>}
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
                    busy={busy === 'notion'}
                    onConfirm={() => update('notion', { notionKey: '', notionDbId: '' }, t('settings.notion.disconnected'))}
                    onCancel={() => setConfirming(null)}
                  />
                ) : (
                  <div className={styles.row}>
                    <ButtonLink href="/api/auth/notion" native variant={notionConnected ? 'secondary' : 'primary'} icon={<BookOpen size={18} aria-hidden />}>
                      {notionConnected ? t('settings.notion.reconnect') : t('settings.notion.connect')}
                    </ButtonLink>
                    {(settings.hasNotionKey || settings.hasNotionDbId) && (
                      <Button variant="danger" onClick={() => setConfirming('notion')}>{t('settings.notion.disconnect')}</Button>
                    )}
                  </div>
                )}
              </div>
            </Card>

            <Card titleId="media-title" title={t('settings.media.title')}>
              <fieldset className={styles.options}>
                <legend className="sr-only">{t('settings.media.title')}</legend>
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
                      disabled={busy === 'media'}
                      onChange={() => update('media', { uploadDest: value })}
                    />
                    <span>
                      <span className={styles.optionLabel}>{label}</span>
                      <span className={styles.hint}>{hint}</span>
                    </span>
                  </label>
                ))}
              </fieldset>
            </Card>

            <Card titleId="prefs-title" title={t('settings.profiles.title')} description={t('settings.profiles.body')}>
              {prefsFailed && <Notice tone="danger">{t('settings.profiles.loadFailed')}</Notice>}
              {!prefs && !prefsFailed && <div className="skeleton" style={{ height: 48 }} aria-label={t('common.loading')} />}
              {prefs && customised.length === 0 && <p className={styles.hint}>{t('settings.profiles.empty')}</p>}
              {customised.length > 0 && (
                <ul className={styles.list}>
                  {customised.map(profile => {
                    const pref = prefs![profile.id];
                    const remembered = pref.fields?.length ?? 0;
                    const id = `prefs-${profile.id}`;
                    return (
                      <li key={profile.id} className={styles.listItem}>
                        <span>
                          <span className={styles.optionLabel}>{profile.name}</span>
                          {remembered > 0 && <span className={styles.hint}>{t('settings.profiles.count', { count: remembered })}</span>}
                          {pref.primaryKey !== null && (
                            <span className={styles.hint}>
                              {pref.primaryKey === '' ? t('settings.profiles.duplicateOff') : t('settings.profiles.duplicate', { field: fieldName(pref, pref.primaryKey) })}
                            </span>
                          )}
                        </span>
                        <div className={styles.row}>
                          {remembered > 0 && (
                            <Button loading={busy === id} onClick={() => savePref(profile.id, { fields: null }, t('capture.forgotten'))}>{t('settings.profiles.forget')}</Button>
                          )}
                          {pref.primaryKey !== null && (
                            <Button loading={busy === id} onClick={() => savePref(profile.id, { primaryKey: null }, t('settings.profiles.duplicateReset'))}>
                              {t('settings.profiles.resetDuplicate')}
                            </Button>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </Card>

            <Card titleId="sync-title" title={t('settings.sync.heading')}>
              {!settings.syncAvailable ? (
                <Notice>{t('settings.sync.unavailable')}</Notice>
              ) : (
                <div className={styles.stack}>
                  <label className={styles.option}>
                    <input
                      type="checkbox"
                      checked={settings.isPersistent}
                      disabled={busy === 'sync' || confirming === 'sync'}
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
                      busy={busy === 'sync'}
                      onConfirm={() => update('sync', { persistent: false })}
                      onCancel={() => setConfirming(null)}
                    />
                  )}
                </div>
              )}
            </Card>
          </>
        )}

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
      </div>
    </main>
  );
}
