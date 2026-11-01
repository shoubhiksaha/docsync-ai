/**
 * Settings module — the user's own keys (BYOK), destinations and per-profile preferences.
 *
 * Stateless mode: values live in encrypted httpOnly cookies. Persistent mode: values are also
 * stored in Firestore with envelope encryption so they follow the user across devices. While sync
 * is on, the cloud copy wins over this device's cookie unless this device changed the value more
 * recently (per-field `changedAt` times in the doc and in a cookie), so a key removed or replaced on
 * one device is gone everywhere, and a change whose cloud write failed isn't undone here.
 * A device that turned sync off keeps it off: it ignores the doc, and a device that still thinks
 * sync is on but finds no doc switches off too, rather than writing the doc back.
 * Every failure here degrades to "no saved settings"; callers then fall back to server keys.
 * Each Firestore call gets FIRESTORE_CALL_TIMEOUT_MS, and one that fails or stalls is skipped for a
 * minute (see ./firestore), so it costs one log line, not one per request.
 * Saved keys never leave the server: status calls return a masked hint only.
 */
import type { NextRequest, NextResponse } from 'next/server';
import { getToken } from 'next-auth/jwt';
import type { DocumentReference } from 'firebase-admin/firestore';
import { isModuleEnabled } from '@/core/env';
import { withTimeout } from '@/core/isolation';
import { encrypt, getDecryptedCookie, isEncryptionConfigured } from '@/core/crypto';
import { generateAndWrapDEK, unwrapAndDecryptDEK, type KmsPayload } from '@/core/envelope';
import { activeProfiles, getProfile } from '@/modules/profiles';
import { firestoreForRequest, firestoreState, reportFirestore, type FirestoreState } from './firestore';
import type { NotionState } from './notion-check';

export { checkAiKey, type KeyCheck } from './key-check';
export { checkNotion, type NotionState } from './notion-check';

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
  changedAt: 'docsync_changed',
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

/** This device's own choice: true (on), false (turned off here) or undefined (never chosen here). */
function persistentChoice(req: NextRequest): boolean | undefined {
  const value = req.cookies.get(SETTINGS_COOKIES.persistent)?.value;
  return value === 'true' ? true : value === 'false' ? false : undefined;
}

/** Lax, so the choice is also sent on the redirect back from Notion's OAuth screen. */
function setPersistentCookie(response: NextResponse, on: boolean): void {
  response.cookies.set(SETTINGS_COOKIES.persistent, on ? 'true' : 'false', { ...secureCookieOptions('lax'), httpOnly: false });
}

/** "gsk_…a1b2" — enough to recognise a key, never enough to use it. */
export function maskKey(key: string): string {
  const k = key.trim();
  return k.length < 12 ? `…${k.slice(-2)}` : `${k.slice(0, 4)}…${k.slice(-4)}`;
}

/**
 * How long one Firestore read or write may take. A stalled call then fails here (and opens the
 * circuit) well before the client gives up, instead of answering late with the cookies lost.
 */
export const FIRESTORE_CALL_TIMEOUT_MS = 3_000;

function timed<T>(call: Promise<T>): Promise<T> {
  return withTimeout(call, FIRESTORE_CALL_TIMEOUT_MS, 'Firestore');
}

// ─── Which copy is current ────────────────────────────────────────────────────

/** When this device last changed each value: 'openaiKey', 'uploadDest', 'prefs:<profileId>', … */
type ChangedAt = Record<string, number>;

const SECRET_FIELDS = [
  ['openaiKey', SETTINGS_COOKIES.aiKey],
  ['notionKey', SETTINGS_COOKIES.notionKey],
  ['notionDbId', SETTINGS_COOKIES.notionDbId],
] as const;

type CloudDoc = Record<string, unknown>;

function readChangedAt(req: NextRequest): ChangedAt {
  const raw = getDecryptedCookie(req, SETTINGS_COOKIES.changedAt);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return Object.fromEntries(Object.entries(parsed ?? {}).filter((e): e is [string, number] => typeof e[1] === 'number'));
  } catch {
    return {};
  }
}

/** Records on this device that `fields` changed at `now`. */
function stampChanged(req: NextRequest, response: NextResponse, fields: string[], now: number): void {
  if (!fields.length) return;
  const map = { ...readChangedAt(req), ...Object.fromEntries(fields.map(f => [f, now])) };
  response.cookies.set(SETTINGS_COOKIES.changedAt, encrypt(JSON.stringify(map)), secureCookieOptions('lax'));
}

/**
 * Whether the cloud copy of `field` is the one to use: the doc holds it (null means it was removed
 * there) and this device hasn't changed it since. Values written before times were kept count as
 * time 0, so the cloud copy also wins over an old cookie.
 */
function cloudIsCurrent(data: CloudDoc, field: string, value: unknown, changed: ChangedAt): boolean {
  if (value === undefined) return false;
  const at = (data.changedAt as Record<string, unknown> | undefined)?.[field];
  return (typeof at === 'number' ? at : 0) >= (changed[field] ?? 0);
}

async function userEmail(req: NextRequest): Promise<string | undefined> {
  try {
    const token = await getToken({ req });
    return typeof token?.email === 'string' ? token.email : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The account's Firestore doc; undefined when sync is off (no doc, or this device turned it off),
 * or Firestore is unconfigured or skipped.
 */
async function cloudDoc(req: NextRequest): Promise<CloudDoc | undefined> {
  if (persistentChoice(req) === false) return undefined;
  const db = isModuleEnabled('settings') ? firestoreForRequest() : null;
  const email = db ? await userEmail(req) : undefined;
  if (!db || !email) return undefined;
  const doc = await timed(db.collection('users').doc(email).get());
  reportFirestore(true);
  return doc.exists ? doc.data() : undefined;
}

export async function loadSettings(req: NextRequest): Promise<DocSyncSettings> {
  const settings: DocSyncSettings = {
    openaiKey: getDecryptedCookie(req, SETTINGS_COOKIES.aiKey),
    notionKey: getDecryptedCookie(req, SETTINGS_COOKIES.notionKey),
    notionDbId: getDecryptedCookie(req, SETTINGS_COOKIES.notionDbId),
    uploadDest: parseUploadDest(req.cookies.get(SETTINGS_COOKIES.uploadDest)?.value),
  };
  try {
    const data = await cloudDoc(req);
    if (data) {
      const changed = readChangedAt(req);
      for (const [field] of SECRET_FIELDS) {
        if (cloudIsCurrent(data, field, data[field], changed)) settings[field] = safeUnwrap(data[field]);
      }
      if (cloudIsCurrent(data, 'uploadDest', data.uploadDest, changed)) settings.uploadDest = parseUploadDest(data.uploadDest);
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
 * while the user's doc exists, unless this device turned it off (cookie 'false'). The cookie is
 * brought in line on `response`: 'true' when another device turned sync on, 'false' when another
 * device turned it off (the doc is gone), so this device never writes the doc back.
 */
async function accountSyncs(req: NextRequest, ref: DocumentReference, response: NextResponse): Promise<boolean> {
  const choice = persistentChoice(req);
  if (choice === false) return false;
  const exists = (await timed(ref.get())).exists;
  reportFirestore(true);
  if (exists ? choice !== true : choice === true) setPersistentCookie(response, exists);
  return exists;
}

export interface SaveSettingsResult {
  /** 'failed' when turning sync off: the doc couldn't be read or removed, so sync is still on. */
  persisted: boolean | 'failed';
  /** Turning sync on kept values another device saved more recently instead of this device's own. */
  fromCloud?: true;
  /** Turning sync off: some remembered fields didn't fit in this device's cookies (see writePrefsCookies). */
  prefsTrimmed?: true;
}

/**
 * Writes cookies on `response` and mirrors the values to Firestore while sync is on. Turning sync
 * on uploads what this device already has, except where the account's doc (kept by another device)
 * holds a newer value: that one is kept, and this device uses it from then on. Turning sync off
 * first copies cloud-only values to this device, so no key is lost; when Firestore can't be read
 * just then, sync stays on rather than dropping them. `sameSite: 'lax'` is for
 * responses that end a cross-site redirect (OAuth).
 */
export async function saveSettings(
  req: NextRequest,
  response: NextResponse,
  update: SettingsUpdate,
  { sameSite = 'strict' }: { sameSite?: 'strict' | 'lax' } = {},
): Promise<SaveSettingsResult> {
  const options = secureCookieOptions(sameSite);
  const now = Date.now();
  stampChanged(req, response, [
    ...SECRET_FIELDS.filter(([field]) => update[field] === '' || update[field]?.trim()).map(([field]) => field),
    ...(update.uploadDest ? ['uploadDest'] : []),
  ], now);
  const setOrClear = (name: string, value: unknown) => {
    if (typeof value === 'string' && value.trim()) response.cookies.set(name, encrypt(value.trim()), options);
    else if (value === '') response.cookies.delete(name);
  };
  setOrClear(SETTINGS_COOKIES.aiKey, update.openaiKey);
  setOrClear(SETTINGS_COOKIES.notionKey, update.notionKey);
  setOrClear(SETTINGS_COOKIES.notionDbId, update.notionDbId);
  if (update.uploadDest) response.cookies.set(SETTINGS_COOKIES.uploadDest, parseUploadDest(update.uploadDest), options);
  // Only an explicit choice changes the mode; saving one field must not switch persistence off.
  // "On" is recorded only once the cloud copy is written, and "off" only once the cloud-only values
  // are on this device and the doc is gone (below), so a failed step leaves sync as it was.
  const db = isModuleEnabled('settings') ? firestoreForRequest() : null;
  const email = db ? await userEmail(req) : undefined;
  if (!db || !email) {
    if (update.persistent !== false) return { persisted: false };
    // Skipped after a recent failure: the doc may hold values this device only has from it, so
    // sync stays on until they can be copied here. Without Firestore there is no doc to lose.
    if (!db && isModuleEnabled('settings') && (await firestoreState()) === 'unreachable') return { persisted: 'failed' };
    setPersistentCookie(response, false);
    return { persisted: false };
  }

  try {
    const ref = db.collection('users').doc(email);
    if (update.persistent === false) {
      const doc = await timed(ref.get());
      const stored = doc.exists ? doc.data() : undefined;
      let prefsTrimmed = false;
      if (stored) {
        // Keep on this device what it was using (the cloud copy where that was current), so turning sync off never loses a key.
        const changed = readChangedAt(req);
        for (const [field, cookie] of SECRET_FIELDS) {
          if (update[field] !== undefined || !cloudIsCurrent(stored, field, stored[field], changed)) continue;
          const cloud = safeUnwrap(stored[field]);
          if (cloud) response.cookies.set(cookie, encrypt(cloud), options);
          else if (stored[field] === null) response.cookies.delete(cookie); // removed on another device
        }
        if (!update.uploadDest && cloudIsCurrent(stored, 'uploadDest', stored.uploadDest, changed)) {
          response.cookies.set(SETTINGS_COOKIES.uploadDest, parseUploadDest(stored.uploadDest), options);
        }
        const prefs = currentPrefs(stored, readPrefsCookie(req), changed);
        prefsTrimmed = writePrefsCookies(req, response, prefs, Object.keys(prefs)).trimmed.length > 0;
      }
      await timed(ref.delete());
      reportFirestore(true);
      setPersistentCookie(response, false);
      return { persisted: false, ...(prefsTrimmed ? { prefsTrimmed: true } : {}) };
    }
    if (update.persistent === undefined && !(await accountSyncs(req, ref, response))) return { persisted: false };

    // Turning sync on joins the doc another device may already keep: a value is uploaded only where
    // the doc lacks it or this device changed it more recently, so newer keys elsewhere survive.
    let stored: CloudDoc | undefined;
    if (update.persistent) {
      const doc = await timed(ref.get());
      stored = doc.exists ? doc.data() : undefined;
    }
    const changed = readChangedAt(req);
    const uploadHere = (field: string, cloudValue: unknown) => !stored || !cloudIsCurrent(stored, field, cloudValue, changed);
    let fromCloud = false;

    const data: Record<string, unknown> = {};
    const wrap = (field: string, value: unknown) => {
      if (typeof value === 'string' && value.trim()) data[field] = generateAndWrapDEK(value.trim());
      else if (value === '') data[field] = null;
    };
    for (const [field, cookie] of SECRET_FIELDS) {
      if (update[field] !== undefined || !update.persistent) {
        wrap(field, update[field]);
        continue;
      }
      const here = getDecryptedCookie(req, cookie);
      if (uploadHere(field, stored?.[field])) wrap(field, here);
      else if (safeUnwrap(stored![field]) !== here) fromCloud = true;
    }
    if (update.uploadDest) data.uploadDest = parseUploadDest(update.uploadDest);
    else if (update.persistent) {
      const here = parseUploadDest(req.cookies.get(SETTINGS_COOKIES.uploadDest)?.value);
      // Always written to a new doc, so the account's doc exists and other devices see sync as on.
      if (uploadHere('uploadDest', stored?.uploadDest)) data.uploadDest = here;
      else if (parseUploadDest(stored!.uploadDest) !== here) fromCloud = true;
    }
    const changedAt: ChangedAt = Object.fromEntries(Object.keys(data).map(field => [field, now]));
    if (update.persistent) {
      const cloud = cloudPrefs(stored);
      const upload: PrefsMap = {};
      for (const [id, prefs] of Object.entries(readPrefsCookie(req))) {
        if (uploadHere(`prefs:${id}`, cloud[id])) {
          upload[id] = prefs;
          changedAt[`prefs:${id}`] = now;
        } else if (JSON.stringify(cloud[id]) !== JSON.stringify(prefs)) fromCloud = true;
      }
      if (Object.keys(upload).length) data.profilePrefs = upload;
    }
    if (Object.keys(data).length) {
      await timed(ref.set({ ...data, changedAt }, { merge: true }));
      reportFirestore(true);
    }
    if (update.persistent) setPersistentCookie(response, true);
    return { persisted: true, ...(fromCloud ? { fromCloud: true } : {}) };
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
  /** Why sync is or isn't available: 'not_configured' is a server choice, 'unreachable' a passing problem. */
  syncState: FirestoreState;
  /** The Google Sheets this device has saved rows to, per document type (from the sheet cookies). */
  sheets: { profileId: string; url: string }[];
  /** Masked saved AI key, e.g. "gsk_…a1b2"; null when none is saved. */
  aiKeyHint: string | null;
  /** Result of `classifyKey` on the saved AI key (e.g. its provider); null without a key or classifier. */
  aiProvider: string | null;
  /** Whether the saved Notion connection still reaches its database; null when Notion isn't connected. */
  notionState: NotionState | null;
}

/** The cookie app/api/sync keeps each document type's spreadsheet id in. */
const sheetCookie = (profileId: string) => `docsync_sheet_${profileId.replace(/-/g, '_')}`;

function savedSheets(req: NextRequest): SettingsStatus['sheets'] {
  return activeProfiles().flatMap(p => {
    const id = req.cookies.get(sheetCookie(p.id))?.value?.trim();
    return id && /^[A-Za-z0-9_-]{10,}$/.test(id) ? [{ profileId: p.id, url: `https://docs.google.com/spreadsheets/d/${id}/edit` }] : [];
  });
}

/**
 * What is saved, without revealing any secret. `classifyKey` lets the caller label the saved AI
 * key (the route passes the ai module's detectProvider) without this module depending on it.
 * `checkNotion` tries the saved Notion connection; without it a connection counts as 'unchecked'.
 */
export async function settingsStatus(req: NextRequest, opts: {
  classifyKey?: (key: string) => string;
  checkNotion?: (token: string, databaseId: string) => Promise<NotionState>;
} = {}): Promise<SettingsStatus> {
  let aiKey = getDecryptedCookie(req, SETTINGS_COOKIES.aiKey);
  let notionKey = getDecryptedCookie(req, SETTINGS_COOKIES.notionKey);
  let notionDbId = getDecryptedCookie(req, SETTINGS_COOKIES.notionDbId);
  const status: SettingsStatus = {
    hasOpenAiKey: false,
    hasNotionKey: Boolean(getDecryptedCookie(req, SETTINGS_COOKIES.notionKey)),
    hasNotionDbId: Boolean(getDecryptedCookie(req, SETTINGS_COOKIES.notionDbId)),
    uploadDest: parseUploadDest(req.cookies.get(SETTINGS_COOKIES.uploadDest)?.value),
    isPersistent: false,
    syncAvailable: false,
    syncState: 'not_configured',
    sheets: savedSheets(req),
    aiKeyHint: null,
    aiProvider: null,
    notionState: null,
  };
  const tryNotion = (token: string | undefined, databaseId: string | undefined): Promise<NotionState> => (token && databaseId && opts.checkNotion
    ? opts.checkNotion(token, databaseId).catch(() => 'unchecked' as const)
    : Promise.resolve('unchecked'));
  // Started beside the Firestore read rather than after it, so the page waits for the slower of the
  // two, not both. Tried again below only when the account's doc holds another connection.
  const cookieNotion = { token: notionKey, databaseId: notionDbId };
  const notionCheck = status.hasNotionKey && status.hasNotionDbId ? tryNotion(notionKey, notionDbId) : undefined;
  let syncState: FirestoreState = isModuleEnabled('settings') ? await firestoreState() : 'not_configured';
  // On while the account's doc exists: a cookie that says 'true' after another device turned sync
  // off (and deleted the doc) no longer counts.
  let chosen = false;

  // The doc is read unless this device turned sync off: sync may have been turned on, or a value changed, on another device.
  if (syncState === 'ok') {
    try {
      const data = await cloudDoc(req);
      if (data) {
        chosen = true;
        const changed = readChangedAt(req);
        if (cloudIsCurrent(data, 'openaiKey', data.openaiKey, changed)) aiKey = safeUnwrap(data.openaiKey);
        if (cloudIsCurrent(data, 'notionKey', data.notionKey, changed)) {
          status.hasNotionKey = Boolean(data.notionKey);
          notionKey = safeUnwrap(data.notionKey);
        }
        if (cloudIsCurrent(data, 'notionDbId', data.notionDbId, changed)) {
          status.hasNotionDbId = Boolean(data.notionDbId);
          notionDbId = safeUnwrap(data.notionDbId);
        }
        if (cloudIsCurrent(data, 'uploadDest', data.uploadDest, changed)) status.uploadDest = parseUploadDest(data.uploadDest);
      }
    } catch (err) {
      reportFirestore(false, err);
      syncState = 'unreachable';
    }
  }
  // Never claim "on all your devices" while nothing is reaching Firestore.
  status.syncState = syncState;
  status.syncAvailable = syncState === 'ok';
  status.isPersistent = status.syncAvailable && chosen;
  status.hasOpenAiKey = Boolean(aiKey);

  if (aiKey) {
    status.aiKeyHint = maskKey(aiKey);
    try {
      status.aiProvider = opts.classifyKey ? opts.classifyKey(aiKey) : null;
    } catch {
      status.aiProvider = null;
    }
  }
  // "Connected" is checked, so a token removed in Notion or a deleted database doesn't still look fine.
  if (status.hasNotionKey && status.hasNotionDbId) {
    const sameConnection = notionKey === cookieNotion.token && notionDbId === cookieNotion.databaseId;
    status.notionState = await (notionCheck && sameConnection ? notionCheck : tryNotion(notionKey, notionDbId));
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
/** Encrypted cookie value budget per document type; browsers drop cookies over ~4KB. */
const MAX_PREFS_COOKIE = 3500;
/** All document types' prefs cookies together, so every request's headers stay well under servers' 16KB. */
const MAX_PREFS_TOTAL = 8000;

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

/**
 * One cookie per document type, so remembering fields for one type never squeezes another's list
 * (Hindi labels take three bytes a letter). Older versions kept every type in one docsync_prefs cookie.
 */
const prefsCookie = (profileId: string) => `${SETTINGS_COOKIES.profilePrefs}_${profileId.replace(/-/g, '_')}`;

/** This device's prefs: each type's own cookie, else the old single cookie. */
function readPrefsCookie(req: NextRequest): PrefsMap {
  const map: PrefsMap = {};
  const legacy = getDecryptedCookie(req, SETTINGS_COOKIES.profilePrefs);
  if (legacy) {
    try {
      for (const [id, value] of Object.entries((JSON.parse(legacy) as Record<string, unknown>) ?? {})) {
        if (getProfile(id)) map[id] = sanitizePrefs(value);
      }
    } catch {
      // unreadable: ignored
    }
  }
  for (const { id } of activeProfiles()) {
    const raw = getDecryptedCookie(req, prefsCookie(id));
    if (!raw) continue;
    try {
      map[id] = sanitizePrefs(JSON.parse(raw));
    } catch {
      // unreadable: ignored
    }
  }
  return map;
}

/** The cross-device prefs in a Firestore user doc; unknown profiles are dropped. */
function cloudPrefs(data: Record<string, unknown> | undefined): PrefsMap {
  const raw = data?.profilePrefs;
  if (!raw || typeof raw !== 'object') return {};
  return Object.fromEntries(Object.entries(raw).filter(([id]) => getProfile(id)).map(([id, value]) => [id, sanitizePrefs(value)]));
}

/** Encrypts one type's prefs, dropping its last remembered fields while it is over `budget`. */
function encodePrefs(prefs: ProfilePrefs, budget: number): { value: string; kept: ProfilePrefs } {
  let kept = prefs;
  let value = encrypt(JSON.stringify(kept));
  while (value.length > budget && kept.fields?.length) {
    const fields = kept.fields.slice(0, -1);
    kept = { ...kept, fields: fields.length ? fields : null };
    value = encrypt(JSON.stringify(kept));
  }
  return { value, kept };
}

/**
 * Writes the cookies of `ids` (every type in `map` while moving off the old single cookie). Only a
 * list being written is ever shortened, when it doesn't fit beside the other types' cookies:
 * `kept` is what was stored and `trimmed` the types shortened, so callers can say so.
 */
function writePrefsCookies(req: NextRequest, response: NextResponse, map: PrefsMap, ids: string[]): { kept: PrefsMap; trimmed: string[] } {
  const legacy = req.cookies.has(SETTINGS_COOKIES.profilePrefs);
  const writing = [...new Set([...ids, ...(legacy ? Object.keys(map) : [])])];
  let used = activeProfiles()
    .filter(p => !writing.includes(p.id))
    .reduce((total, p) => total + (req.cookies.get(prefsCookie(p.id))?.value.length ?? 0), 0);
  const kept: PrefsMap = {};
  const trimmed: string[] = [];
  for (const id of writing) {
    const encoded = encodePrefs(map[id], Math.min(MAX_PREFS_COOKIE, MAX_PREFS_TOTAL - used));
    used += encoded.value.length;
    kept[id] = encoded.kept;
    if (encoded.kept !== map[id]) trimmed.push(id);
    response.cookies.set(prefsCookie(id), encoded.value, secureCookieOptions('lax'));
  }
  if (legacy) response.cookies.delete(SETTINGS_COOKIES.profilePrefs);
  return { kept, trimmed };
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

/**
 * Each profile's current prefs: the cloud copy unless this device changed them since, else this
 * device's copy, else the cloud copy. Profiles with neither are left out.
 */
function currentPrefs(data: CloudDoc | undefined, fromCookie: PrefsMap, changed: ChangedAt): PrefsMap {
  const cloud = cloudPrefs(data);
  return Object.fromEntries([...new Set([...Object.keys(cloud), ...Object.keys(fromCookie)])].map(id => {
    const useCloud = data && cloudIsCurrent(data, `prefs:${id}`, cloud[id], changed);
    return [id, useCloud ? cloud[id] : fromCookie[id] ?? cloud[id]];
  }));
}

/** Every profile's prefs by the currentPrefs rule, else the old docsync_pk_* cookie, else defaults; one Firestore read. */
export async function loadAllProfilePrefs(req: NextRequest): Promise<PrefsMap> {
  let data: CloudDoc | undefined;
  try {
    data = await cloudDoc(req);
  } catch (err) {
    reportFirestore(false, err); // this device's copy only
  }
  const current = currentPrefs(data, readPrefsCookie(req), readChangedAt(req));
  return Object.fromEntries(activeProfiles().map(p => [
    p.id,
    current[p.id] ?? { ...DEFAULT_PREFS, primaryKey: legacyPrimaryKey(req, p.id) },
  ]));
}

/** One profile's prefs, by the same rule as loadAllProfilePrefs. */
export async function loadProfilePrefs(req: NextRequest, profileId: string): Promise<ProfilePrefs> {
  if (!getProfile(profileId)) return { ...DEFAULT_PREFS };
  return (await loadAllProfilePrefs(req))[profileId] ?? { ...DEFAULT_PREFS };
}

export interface SavedPrefs {
  /** What was saved, which can be shorter than asked for: see `trimmed`. */
  prefs: ProfilePrefs;
  /** Document types whose remembered list had to be shortened to fit on this device (usually none). */
  trimmed: string[];
  /** As for saveSettings: true when mirrored to Firestore, 'failed' when that write failed. */
  persisted: boolean | 'failed';
}

/** Merges `update` into the profile's prefs, writes the cookie, and mirrors it in persistent mode. */
export async function saveProfilePrefs(
  req: NextRequest,
  response: NextResponse,
  profileId: string,
  update: Partial<ProfilePrefs>,
): Promise<SavedPrefs> {
  if (!getProfile(profileId)) throw new Error(`Unknown profile: ${profileId}`);
  const current = await loadProfilePrefs(req, profileId);
  const wanted = sanitizePrefs({
    fields: update.fields !== undefined ? update.fields : current.fields,
    primaryKey: update.primaryKey !== undefined ? update.primaryKey : current.primaryKey,
  });

  const { kept, trimmed } = writePrefsCookies(req, response, { ...readPrefsCookie(req), [profileId]: wanted }, [profileId]);
  const next = kept[profileId];
  const saved = (persisted: SavedPrefs['persisted']): SavedPrefs => ({ prefs: next, trimmed, persisted });
  const now = Date.now();
  stampChanged(req, response, [`prefs:${profileId}`], now);
  // The prefs cookie replaces the legacy per-profile primary-key cookie.
  response.cookies.delete(`docsync_pk_${profileId.replace(/-/g, '_')}`);

  const db = isModuleEnabled('settings') ? firestoreForRequest() : null;
  const email = db ? await userEmail(req) : undefined;
  if (!db || !email) return saved(false);
  try {
    const ref = db.collection('users').doc(email);
    if (!(await accountSyncs(req, ref, response))) return saved(false);
    await timed(ref.set({ profilePrefs: { [profileId]: next }, changedAt: { [`prefs:${profileId}`]: now } }, { merge: true }));
    reportFirestore(true);
    return saved(true);
  } catch (err) {
    reportFirestore(false, err); // saved on this device only
    return saved('failed');
  }
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
