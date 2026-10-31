'use client';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import toast from 'react-hot-toast';
import { BookOpen, KeyRound } from 'lucide-react';
import { useI18n } from '@/client/i18n/I18nProvider';
import type { Lang } from '@/client/i18n';
import { ApiError, fetchPrefs, fetchSettings, savePrefs, saveSettings, type ProfilePrefs, type SettingsStatus, type SettingsUpdate, type UploadDest } from '@/client/api';
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

interface SettingsClientProps {
  profiles: { id: string; name: string }[];
  notionJustConnected: boolean;
}

export default function SettingsClient({ profiles, notionJustConnected }: SettingsClientProps) {
  const { t, lang, setLang } = useI18n();
  const [settings, setSettings] = useState<SettingsStatus | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [prefs, setPrefs] = useState<Record<string, ProfilePrefs | null>>({});
  const [keyInput, setKeyInput] = useState('');
  const [replacingKey, setReplacingKey] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

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
    Promise.all(profiles.map(p => fetchPrefs(p.id).then(r => [p.id, r] as const))).then(entries => setPrefs(Object.fromEntries(entries)));
    if (notionJustConnected) {
      toast.success(t('settings.notion.justConnected'));
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
      if (warning) toast(warning, { icon: '⚠️' });
      else toast.success(message);
      return true;
    } catch (err) {
      toast.error(err instanceof ApiError && err.code === 'session' ? t('error.session') : t('settings.saveFailed'));
      return false;
    } finally {
      setBusy(null);
    }
  };

  const saveKey = async (e: FormEvent) => {
    e.preventDefault();
    if (!keyInput.trim()) return;
    if (await update('ai', { openaiKey: keyInput.trim() })) {
      setKeyInput('');
      setReplacingKey(false);
    }
  };

  const forget = async (profileId: string) => {
    setBusy(`prefs-${profileId}`);
    try {
      const next = await savePrefs(profileId, { fields: null });
      setPrefs(current => ({ ...current, [profileId]: next }));
      toast.success(t('capture.forgotten'));
    } catch {
      toast.error(t('settings.saveFailed'));
    } finally {
      setBusy(null);
    }
  };

  const detected = detectProvider(keyInput);
  const notionConnected = Boolean(settings?.hasNotionKey && settings?.hasNotionDbId);

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
                  <div className={styles.row}>
                    <Button onClick={() => setReplacingKey(true)}>{t('settings.ai.replace')}</Button>
                    <Button variant="danger" loading={busy === 'ai'} onClick={() => update('ai', { openaiKey: '' }, t('settings.ai.removed'))}>{t('settings.ai.remove')}</Button>
                  </div>
                </div>
              ) : (
                <form className={styles.stack} onSubmit={saveKey}>
                  <TextField
                    label={t('settings.ai.label')}
                    type="password"
                    autoComplete="off"
                    spellCheck={false}
                    placeholder="gsk_… / AIza… / sk-…"
                    value={keyInput}
                    onChange={e => setKeyInput(e.target.value)}
                    hint={keyInput.trim() ? (detected ? t('settings.ai.detected', { provider: PROVIDERS[detected] }) : t('settings.ai.unknown')) : undefined}
                  />
                  {detected === 'anthropic' && <p className={styles.hint}>{t('settings.ai.anthropicNote')}</p>}
                  <div className={styles.row}>
                    <Button type="submit" variant="primary" loading={busy === 'ai'} disabled={!keyInput.trim()}>{t('settings.ai.saveKey')}</Button>
                    {replacingKey && <Button onClick={() => { setReplacingKey(false); setKeyInput(''); }}>{t('common.cancel')}</Button>}
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
              <div className={styles.row}>
                <ButtonLink href="/api/auth/notion" native variant={notionConnected ? 'secondary' : 'primary'} icon={<BookOpen size={18} aria-hidden />}>
                  {notionConnected ? t('settings.notion.reconnect') : t('settings.notion.connect')}
                </ButtonLink>
                {(settings.hasNotionKey || settings.hasNotionDbId) && (
                  <Button variant="danger" loading={busy === 'notion'} onClick={() => update('notion', { notionKey: '', notionDbId: '' }, t('settings.notion.disconnected'))}>
                    {t('settings.notion.disconnect')}
                  </Button>
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
              <ul className={styles.list}>
                {profiles.map(profile => {
                  const remembered = prefs[profile.id]?.fields;
                  return (
                    <li key={profile.id} className={styles.listItem}>
                      <span>
                        <span className={styles.optionLabel}>{profile.name}</span>
                        <span className={styles.hint}>
                          {remembered?.length ? t('settings.profiles.count', { count: remembered.length }) : t('settings.profiles.none')}
                        </span>
                      </span>
                      {remembered?.length ? (
                        <Button loading={busy === `prefs-${profile.id}`} onClick={() => forget(profile.id)}>{t('settings.profiles.forget')}</Button>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </Card>

            <Card titleId="sync-title" title={t('settings.sync.title')}>
              <label className={styles.option}>
                <input
                  type="checkbox"
                  checked={settings.isPersistent}
                  disabled={busy === 'sync' || !settings.syncAvailable}
                  onChange={e => update('sync', { persistent: e.target.checked })}
                />
                <span>
                  <span className={styles.optionLabel}>{t('settings.sync.title')}</span>
                  <span className={styles.hint}>
                    {!settings.syncAvailable ? t('settings.sync.unavailable') : settings.isPersistent ? t('settings.sync.on') : t('settings.sync.off')}
                  </span>
                </span>
              </label>
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
