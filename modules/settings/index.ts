/**
 * Settings module — the user's own keys (BYOK), destinations and per-profile preferences.
 *
 * Stateless mode: values live in encrypted httpOnly cookies. Persistent mode: values are also
 * stored in Firestore with envelope encryption so they follow the user across devices.
 * Every failure here degrades to "no saved settings"; callers then fall back to server keys.
 * A Firestore that fails is skipped for a minute (see ./firestore), so it costs one log line, not one per request.
 * Saved keys never leave the server: status calls return a masked hint only.
 */
import type { NextRequest, NextResponse } from 'next/server';
import { getToken } from 'next-auth/jwt';
import type { DocumentReference } from 'firebase-admin/firestore';
import { isModuleEnabled } from '@/core/env';
import { encrypt, getDecryptedCookie, isEncryptionConfigured } from '@/core/crypto';
import { generateAndWrapDEK, unwrapAndDecryptDEK, type KmsPayload } from '@/core/envelope';
import { activeProfiles, getProfile } from '@/modules/profiles';
import { firestoreForRequest, firestoreState, reportFirestore, type FirestoreState } from './firestore';

export type UploadDest = 'both' | 'gdrive' | 'notion';

export interface DocSyncSettings {
  openaiKey?: string;
  notionKey?: string;
  notionDbId?: string;
  uploadDest: UploadDest;
}

export const SETTINGS_COOKIES = {
  aiKey: 'docsync_openai',
  notionKey: 'docsync_notion',
  notionDbId: 'docsync_notion_db',
  uploadDest: 'docsync_upload_dest',
  persistent: 'docsync_persistent',
  profilePrefs: 'docsync_prefs',
} as const;

const TEN_YEARS = 60 * 60 * 24 * 365 * 10;

export function secureCookieOptions(sameSite: 'strict' | 'lax' = 'strict') {
  return { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite, path: '/', maxAge: TEN_YEARS };
}

export function parseUploadDest(value: unknown): UploadDest {
  return value === 'gdrive' || value === 'notion' || value === 'both' ? value : 'both';
}

function safeUnwrap(payload: unknown): string | undefined {
  try {
    return payload ? unwrapAndDecryptDEK(payload as KmsPayload) : undefined;
  } catch {
    return undefined;
  }
}

function persistentCookie(req: NextRequest): boolean {
  return req.cookies.get(SETTINGS_COOKIES.persistent)?.value === 'true';
}

/** "gsk_…a1b2" — enough to recognise a key, never enough to use it. */
export function maskKey(key: string): string {
  const k = key.trim();
  return k.length < 12 ? `…${k.slice(-2)}` : `${k.slice(0, 4)}…${k.slice(-4)}`;
}

async function userEmail(req: NextRequest): Promise<string | undefined> {
  try {
    const token = await getToken({ req });
    return typeof token?.email === 'string' ? token.email : undefined;
  } catch {
    return undefined;
  }
}

export async function loadSettings(req: NextRequest): Promise<DocSyncSettings> {
  const settings: DocSyncSettings = {
    openaiKey: getDecryptedCookie(req, SETTINGS_COOKIES.aiKey),
    notionKey: getDecryptedCookie(req, SETTINGS_COOKIES.notionKey),
    notionDbId: getDecryptedCookie(req, SETTINGS_COOKIES.notionDbId),
    uploadDest: parseUploadDest(req.cookies.get(SETTINGS_COOKIES.uploadDest)?.value),
  };
  if (!isModuleEnabled('settings') || (settings.openaiKey && settings.notionKey && settings.notionDbId)) return settings;

  const db = firestoreForRequest();
  const email = db ? await userEmail(req) : undefined;
  if (!db || !email) return settings;

  try {
    const doc = await db.collection('users').doc(email).get();
    reportFirestore(true);
    const data = doc.exists ? doc.data() : undefined;
    if (data) {
      settings.openaiKey ??= safeUnwrap(data.openaiKey);
      settings.notionKey ??= safeUnwrap(data.notionKey);
      settings.notionDbId ??= safeUnwrap(data.notionDbId);
      if (data.uploadDest) settings.uploadDest = parseUploadDest(data.uploadDest);
    }
  } catch (err) {
    reportFirestore(false, err); // cookie settings only
  }
  return settings;
}

export interface SettingsUpdate {
  openaiKey?: string;
  notionKey?: string;
  notionDbId?: string;
  uploadDest?: string;
  persistent?: boolean;
}

/**
 * Whether this account keeps its settings in Firestore. One rule for reads and writes: sync is on
 * when this device chose it (cookie) or another device did (the user's doc exists). The cookie is
 * SameSite=Strict, so it is also missing on the redirect back from Notion's OAuth screen.
 */
async function accountSyncs(req: NextRequest, ref: DocumentReference): Promise<boolean> {
  if (persistentCookie(req)) return true;
  const exists = (await ref.get()).exists;
  reportFirestore(true);
  return exists;
}

/**
 * Writes cookies on `response` and mirrors the values to Firestore while sync is on. Turning sync
 * on uploads what this device already has; turning it off first copies cloud-only values to this
 * device, so no key is lost. `sameSite: 'lax'` is for responses that end a cross-site redirect (OAuth).
 */
export async function saveSettings(
  req: NextRequest,
  response: NextResponse,
  update: SettingsUpdate,
  { sameSite = 'strict' }: { sameSite?: 'strict' | 'lax' } = {},
): Promise<{ persisted: boolean | 'failed' }> {
  const options = secureCookieOptions(sameSite);
  const setOrClear = (name: string, value: unknown) => {
    if (typeof value === 'string' && value.trim()) response.cookies.set(name, encrypt(value.trim()), options);
    else if (value === '') response.cookies.delete(name);
  };
  setOrClear(SETTINGS_COOKIES.aiKey, update.openaiKey);
  setOrClear(SETTINGS_COOKIES.notionKey, update.notionKey);
  setOrClear(SETTINGS_COOKIES.notionDbId, update.notionDbId);
  if (update.uploadDest) response.cookies.set(SETTINGS_COOKIES.uploadDest, parseUploadDest(update.uploadDest), options);
  const markPersistent = (on: boolean) => response.cookies.set(SETTINGS_COOKIES.persistent, on ? 'true' : 'false', { ...options, httpOnly: false });
  // Only an explicit choice changes the mode; saving one field must not switch persistence off.
  if (typeof update.persistent === 'boolean') markPersistent(update.persistent);

  const db = isModuleEnabled('settings') ? firestoreForRequest() : null;
  const email = db ? await userEmail(req) : undefined;
  if (!db || !email) return { persisted: false };

  const secrets = [
    ['openaiKey', SETTINGS_COOKIES.aiKey, update.openaiKey],
    ['notionKey', SETTINGS_COOKIES.notionKey, update.notionKey],
    ['notionDbId', SETTINGS_COOKIES.notionDbId, update.notionDbId],
  ] as const;
  try {
    const ref = db.collection('users').doc(email);
    if (update.persistent === false) {
      const doc = await ref.get();
      const stored = doc.exists ? doc.data() : undefined;
      if (stored) {
        // Keep on this device whatever only the cloud copy had, so turning sync off never loses a key.
        for (const [field, cookie, value] of secrets) {
          const cloudOnly = value === undefined && !getDecryptedCookie(req, cookie) ? safeUnwrap(stored[field]) : undefined;
          if (cloudOnly) response.cookies.set(cookie, encrypt(cloudOnly), options);
        }
        if (!update.uploadDest && !req.cookies.get(SETTINGS_COOKIES.uploadDest)?.value && stored.uploadDest) {
          response.cookies.set(SETTINGS_COOKIES.uploadDest, parseUploadDest(stored.uploadDest), options);
        }
        const prefs = { ...cloudPrefs(stored), ...readPrefsCookie(req) };
        if (Object.keys(prefs).length) response.cookies.set(SETTINGS_COOKIES.profilePrefs, encodePrefsCookie(prefs), secureCookieOptions('lax'));
      }
      await ref.delete();
      reportFirestore(true);
      return { persisted: false };
    }
    if (update.persistent === undefined) {
      if (!(await accountSyncs(req, ref))) return { persisted: false };
      if (!persistentCookie(req)) markPersistent(true); // sync was turned on from another device
    }

    const data: Record<string, unknown> = {};
    const wrap = (field: string, value: unknown) => {
      if (typeof value === 'string' && value.trim()) data[field] = generateAndWrapDEK(value.trim());
      else if (value === '') data[field] = null;
    };
    for (const [field, cookie, value] of secrets) {
      // Turning sync on uploads the values this device already has.
      wrap(field, value === undefined && update.persistent ? getDecryptedCookie(req, cookie) : value);
    }
    if (update.uploadDest) data.uploadDest = parseUploadDest(update.uploadDest);
    if (update.persistent) {
      // Always written, so the account's doc exists and other devices see sync as on.
      data.uploadDest ??= parseUploadDest(req.cookies.get(SETTINGS_COOKIES.uploadDest)?.value);
      const prefs = readPrefsCookie(req);
      if (Object.keys(prefs).length) data.profilePrefs = prefs;
    }
    if (Object.keys(data).length) {
      await ref.set(data, { merge: true });
      reportFirestore(true);
    }
    return { persisted: true };
  } catch (err) {
    reportFirestore(false, err); // the cookies were still saved
    return { persisted: 'failed' };
  }
}

export interface SettingsStatus {
  hasOpenAiKey: boolean;
  hasNotionKey: boolean;
  hasNotionDbId: boolean;
  uploadDest: UploadDest;
  /** The user chose cross-device settings and Firestore is actually keeping them. */
  isPersistent: boolean;
  /** Cross-device settings work right now: Firestore is configured and answering. */
  syncAvailable: boolean;
  /** Masked saved AI key, e.g. "gsk_…a1b2"; null when none is saved. */
  aiKeyHint: string | null;
  /** Result of `classifyKey` on the saved AI key (e.g. its provider); null without a key or classifier. */
  aiProvider: string | null;
}

/**
 * What is saved, without revealing any secret. `classifyKey` lets the caller label the saved AI
 * key (the route passes the ai module's detectProvider) without this module depending on it.
 */
export async function settingsStatus(req: NextRequest, opts: { classifyKey?: (key: string) => string } = {}): Promise<SettingsStatus> {
  let aiKey = getDecryptedCookie(req, SETTINGS_COOKIES.aiKey);
  const status: SettingsStatus = {
    hasOpenAiKey: Boolean(aiKey),
    hasNotionKey: Boolean(getDecryptedCookie(req, SETTINGS_COOKIES.notionKey)),
    hasNotionDbId: Boolean(getDecryptedCookie(req, SETTINGS_COOKIES.notionDbId)),
    uploadDest: parseUploadDest(req.cookies.get(SETTINGS_COOKIES.uploadDest)?.value),
    isPersistent: false,
    syncAvailable: false,
    aiKeyHint: null,
    aiProvider: null,
  };
  const persistence: FirestoreState = isModuleEnabled('settings') ? await firestoreState() : 'not_configured';
  let syncAvailable = persistence === 'ok';
  let chosen = persistentCookie(req);

  // Without the cookie the doc is still read: sync may have been turned on from another device.
  if (syncAvailable && (!chosen || !(status.hasOpenAiKey && status.hasNotionKey && status.hasNotionDbId))) {
    const db = firestoreForRequest();
    const email = db ? await userEmail(req) : undefined;
    if (db && email) {
      try {
        const doc = await db.collection('users').doc(email).get();
        reportFirestore(true);
        const data = doc.exists ? doc.data() : undefined;
        if (data) {
          chosen = true;
          aiKey ??= safeUnwrap(data.openaiKey);
          status.hasOpenAiKey ||= Boolean(aiKey);
          status.hasNotionKey ||= Boolean(data.notionKey);
          status.hasNotionDbId ||= Boolean(data.notionDbId);
          if (data.uploadDest) status.uploadDest = parseUploadDest(data.uploadDest);
        }
      } catch (err) {
        reportFirestore(false, err);
        syncAvailable = false;
      }
    }
  }
  // Never claim "on all your devices" while nothing is reaching Firestore.
  status.syncAvailable = syncAvailable;
  status.isPersistent = syncAvailable && chosen;

  if (aiKey) {
    status.aiKeyHint = maskKey(aiKey);
    try {
      status.aiProvider = opts.classifyKey ? opts.classifyKey(aiKey) : null;
    } catch {
      status.aiProvider = null;
    }
  }
  return status;
}

// ─── Per-profile preferences ──────────────────────────────────────────────────

export interface ProfilePrefs {
  /** Remembered field list ("template"); null = review every scan. */
  fields: { key: string; label: string }[] | null;
  /**
   * Field used for duplicate checks. null = the profile's default; '' = don't check for duplicates.
   */
  primaryKey: string | null;
}

const MAX_PREF_FIELDS = 40;
const MAX_PREF_TEXT = 100;
/** Encrypted cookie value budget; browsers drop cookies over ~4KB. */
const MAX_PREFS_COOKIE = 3500;

const DEFAULT_PREFS: ProfilePrefs = { fields: null, primaryKey: null };

function cleanText(value: unknown): string {
  return typeof value === 'string' ? value.trim().slice(0, MAX_PREF_TEXT) : '';
}

/** Coerces anything into well-formed prefs; unknown shapes become defaults. */
export function sanitizePrefs(raw: unknown): ProfilePrefs {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_PREFS };
  const r = raw as Record<string, unknown>;
  let fields: ProfilePrefs['fields'] = null;
  if (Array.isArray(r.fields)) {
    fields = r.fields
      .map(f => (f && typeof f === 'object' ? { key: cleanText((f as Record<string, unknown>).key), label: cleanText((f as Record<string, unknown>).label) } : null))
      .filter((f): f is { key: string; label: string } => Boolean(f?.key))
      .map(f => ({ key: f.key, label: f.label || f.key }))
      .slice(0, MAX_PREF_FIELDS);
  }
  return { fields, primaryKey: typeof r.primaryKey === 'string' ? cleanText(r.primaryKey) : null };
}

type PrefsMap = Record<string, ProfilePrefs>;

function readPrefsCookie(req: NextRequest): PrefsMap {
  const raw = getDecryptedCookie(req, SETTINGS_COOKIES.profilePrefs);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const map: PrefsMap = {};
    for (const [id, value] of Object.entries(parsed ?? {})) {
      if (getProfile(id)) map[id] = sanitizePrefs(value);
    }
    return map;
  } catch {
    return {};
  }
}

/** The cross-device prefs in a Firestore user doc; unknown profiles are dropped. */
function cloudPrefs(data: Record<string, unknown> | undefined): PrefsMap {
  const raw = data?.profilePrefs;
  if (!raw || typeof raw !== 'object') return {};
  return Object.fromEntries(Object.entries(raw).filter(([id]) => getProfile(id)).map(([id, value]) => [id, sanitizePrefs(value)]));
}

/** Encrypts the map, dropping the last remembered field of the largest list until it fits. */
function encodePrefsCookie(map: PrefsMap): string {
  const copy: PrefsMap = Object.fromEntries(Object.entries(map).map(([id, p]) => [id, { ...p, fields: p.fields ? [...p.fields] : null }]));
  let value = encrypt(JSON.stringify(copy));
  while (value.length > MAX_PREFS_COOKIE) {
    const largest = Object.values(copy).filter(p => p.fields?.length).sort((a, b) => b.fields!.length - a.fields!.length)[0];
    if (!largest) break;
    largest.fields!.pop();
    value = encrypt(JSON.stringify(copy));
  }
  return value;
}

function legacyPrimaryKey(req: NextRequest, profileId: string): string | null {
  const raw = req.cookies.get(`docsync_pk_${profileId.replace(/-/g, '_')}`)?.value;
  if (!raw) return null;
  try {
    return cleanText(decodeURIComponent(raw)) || null;
  } catch {
    return cleanText(raw) || null;
  }
}

/** This device's prefs, else the cross-device copy, else the old docsync_pk_* cookie, else defaults. */
export async function loadProfilePrefs(req: NextRequest, profileId: string): Promise<ProfilePrefs> {
  if (!getProfile(profileId)) return { ...DEFAULT_PREFS };
  const fromCookie = readPrefsCookie(req)[profileId];
  if (fromCookie) return fromCookie;

  const db = isModuleEnabled('settings') ? firestoreForRequest() : null;
  const email = db ? await userEmail(req) : undefined;
  if (db && email) {
    try {
      const doc = await db.collection('users').doc(email).get();
      reportFirestore(true);
      const stored = doc.exists ? (doc.data()?.profilePrefs as Record<string, unknown> | undefined)?.[profileId] : undefined;
      if (stored) return sanitizePrefs(stored);
    } catch (err) {
      reportFirestore(false, err);
    }
  }
  return { ...DEFAULT_PREFS, primaryKey: legacyPrimaryKey(req, profileId) };
}

/** Every profile's prefs, by the same rule as loadProfilePrefs, with at most one Firestore read. */
export async function loadAllProfilePrefs(req: NextRequest): Promise<PrefsMap> {
  const fromCookie = readPrefsCookie(req);
  let cloud: PrefsMap = {};
  const db = activeProfiles().some(p => !fromCookie[p.id]) && isModuleEnabled('settings') ? firestoreForRequest() : null;
  const email = db ? await userEmail(req) : undefined;
  if (db && email) {
    try {
      const doc = await db.collection('users').doc(email).get();
      reportFirestore(true);
      cloud = cloudPrefs(doc.exists ? doc.data() : undefined);
    } catch (err) {
      reportFirestore(false, err);
    }
  }
  return Object.fromEntries(activeProfiles().map(p => [
    p.id,
    fromCookie[p.id] ?? cloud[p.id] ?? { ...DEFAULT_PREFS, primaryKey: legacyPrimaryKey(req, p.id) },
  ]));
}

/** Merges `update` into the profile's prefs, writes the cookie, and mirrors it in persistent mode. */
export async function saveProfilePrefs(
  req: NextRequest,
  response: NextResponse,
  profileId: string,
  update: Partial<ProfilePrefs>,
): Promise<ProfilePrefs> {
  if (!getProfile(profileId)) throw new Error(`Unknown profile: ${profileId}`);
  const current = await loadProfilePrefs(req, profileId);
  const next = sanitizePrefs({
    fields: update.fields !== undefined ? update.fields : current.fields,
    primaryKey: update.primaryKey !== undefined ? update.primaryKey : current.primaryKey,
  });

  const map = { ...readPrefsCookie(req), [profileId]: next };
  response.cookies.set(SETTINGS_COOKIES.profilePrefs, encodePrefsCookie(map), secureCookieOptions('lax'));
  // The prefs cookie replaces the legacy per-profile primary-key cookie.
  response.cookies.delete(`docsync_pk_${profileId.replace(/-/g, '_')}`);

  const db = isModuleEnabled('settings') ? firestoreForRequest() : null;
  const email = db ? await userEmail(req) : undefined;
  if (db && email) {
    try {
      const ref = db.collection('users').doc(email);
      if (!(await accountSyncs(req, ref))) return next;
      await ref.set({ profilePrefs: { [profileId]: next } }, { merge: true });
      reportFirestore(true);
    } catch (err) {
      reportFirestore(false, err); // saved on this device only
    }
  }
  return next;
}

/**
 * `persistence` is whether cross-device settings work: 'ok', 'unreachable' (credentials are set but
 * Firestore doesn't answer: API disabled, database missing, network) or 'not_configured'
 * (cookie-only by design). Unreachable opens the circuit, so /api/health reports "degraded".
 */
export async function settingsHealth() {
  const enabled = isModuleEnabled('settings');
  const persistence: FirestoreState = enabled ? await firestoreState() : 'not_configured';
  return {
    enabled,
    configured: isEncryptionConfigured(),
    persistent: persistence === 'ok',
    persistence,
    circuit: persistence === 'unreachable' ? 'open' as const : 'closed' as const,
  };
}
