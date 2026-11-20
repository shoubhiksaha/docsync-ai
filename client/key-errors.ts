/**
 * What to tell someone whose own AI key wasn't used, per reason the server gives, so they know
 * whether to paste it again, fix it with the provider, wait, or do nothing (the problem is ours).
 * POST /api/settings gives `code` for a key it didn't save and `warning` for one it saved but
 * couldn't confirm; /api/extract-freeform gives `savedKeyError` when a scan couldn't use the key.
 * Messages take `{provider}`, never the key.
 */
import type { MessageKey } from './i18n';

/** Why a scan couldn't use the saved key (modules/ai SavedKeyError). */
export type SavedKeyError = 'key_refused' | 'key_quota' | 'key_unreachable';

/** Own entries only, so a server string like "constructor" never reads Object's. */
const lookup = (map: Record<string, MessageKey>, code: string | undefined): MessageKey | undefined =>
  code && Object.prototype.hasOwnProperty.call(map, code) ? map[code] : undefined;

/**
 * A new key that wasn't saved: the server's `code` (or `warning` "key_not_enabled"), else the
 * client's own ErrorCode for a save that never got an answer ("network").
 */
const NOT_SAVED: Record<string, MessageKey> = {
  key_malformed: 'settings.ai.malformed',
  key_refused: 'settings.ai.refused',
  key_not_enabled: 'settings.ai.notEnabled',
  rate_limited: 'settings.ai.tooManyTests',
  encryption_unavailable: 'settings.serverProblem',
  network: 'error.network',
};

/** The line beside the key field for a key that wasn't saved. Anything unknown is "try again". */
export function keyNotSavedMessage(code: string | undefined): MessageKey {
  return lookup(NOT_SAVED, code) ?? 'settings.saveFailed';
}

/** A key saved without being confirmed (modules/settings KEY_WARNINGS): why, and what to do. */
const SAVED_WITH: Record<string, MessageKey> = {
  key_forbidden: 'settings.ai.forbidden',
  key_quota: 'settings.ai.quota',
  key_unreachable: 'settings.ai.unreachable',
  key_unchecked: 'settings.ai.unchecked',
};

const CLOUD_FAILED = '_cloud_sync_failed';

/**
 * The lines for a key saved with a warning ("key_quota", or "key_quota_cloud_sync_failed" when it
 * also didn't reach the other devices); undefined for a warning that isn't about the key.
 */
export function keySavedWarning(warning: string | undefined): MessageKey[] | undefined {
  if (!warning) return undefined;
  const cloudFailed = warning.endsWith(CLOUD_FAILED);
  const line = lookup(SAVED_WITH, cloudFailed ? warning.slice(0, -CLOUD_FAILED.length) : warning);
  if (!line) return undefined;
  return cloudFailed ? [line, 'settings.cloudSyncFailed'] : [line];
}

const SCAN_MESSAGES: Record<SavedKeyError, MessageKey> = {
  key_refused: 'scan.savedKey.refused',
  key_quota: 'scan.savedKey.quota',
  key_unreachable: 'scan.savedKey.unreachable',
};

/** A server's `savedKeyError`, if it is one this client can explain. */
export function parseSavedKeyError(value: unknown): SavedKeyError | undefined {
  return typeof value === 'string' && lookup(SCAN_MESSAGES, value) ? value as SavedKeyError : undefined;
}

/** What a scan says when the saved key couldn't be used, whether another key read the page or none did. */
export function savedKeyMessage(code: SavedKeyError): MessageKey {
  return SCAN_MESSAGES[code];
}
