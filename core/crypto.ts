import crypto from 'crypto';
import type { NextRequest } from 'next/server';

/**
 * Cookie encryption (AES-256-GCM).
 *
 * v2 format: "v2." + base64url(iv[12] | tag[16] | ciphertext), key derived once with HKDF from
 * ENCRYPTION_KEY. Legacy values (base64 salt[64] | iv[16] | tag[16] | ciphertext with a
 * PBKDF2-derived key per value) are still decrypted so existing cookies keep working.
 *
 * The key is read lazily: a missing ENCRYPTION_KEY only fails the calls that need it.
 */

const TEST_KEY_HEX = '0'.repeat(64);
const V2_PREFIX = 'v2.';

const LEGACY_SALT_LENGTH = 64;
const LEGACY_IV_LENGTH = 16;
const TAG_LENGTH = 16;

export class EncryptionKeyMissingError extends Error {
  constructor() {
    super('ENCRYPTION_KEY is not configured (expected 64 hex characters).');
    this.name = 'EncryptionKeyMissingError';
  }
}

function masterKeyHex(): string {
  const hex = process.env.ENCRYPTION_KEY?.trim() || (process.env.NODE_ENV === 'test' ? TEST_KEY_HEX : '');
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) throw new EncryptionKeyMissingError();
  return hex;
}

export function isEncryptionConfigured(): boolean {
  try {
    masterKeyHex();
    return true;
  } catch {
    return false;
  }
}

let cachedV2: { hex: string; key: Buffer } | null = null;

function v2Key(): Buffer {
  const hex = masterKeyHex();
  if (cachedV2?.hex !== hex) {
    const derived = crypto.hkdfSync('sha256', Buffer.from(hex, 'hex'), 'docsync-cookie-v2', 'cookie-encryption', 32);
    cachedV2 = { hex, key: Buffer.from(derived) };
  }
  return cachedV2.key;
}

export function encrypt(text: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', v2Key(), iv);
  const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  return V2_PREFIX + Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64url');
}

function decryptV2(payload: string): string {
  const raw = Buffer.from(payload, 'base64url');
  const iv = raw.subarray(0, 12);
  const tag = raw.subarray(12, 12 + TAG_LENGTH);
  const encrypted = raw.subarray(12 + TAG_LENGTH);
  const decipher = crypto.createDecipheriv('aes-256-gcm', v2Key(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
}

function decryptLegacy(encText: string): string {
  const raw = Buffer.from(encText, 'base64');
  const salt = raw.subarray(0, LEGACY_SALT_LENGTH);
  const iv = raw.subarray(LEGACY_SALT_LENGTH, LEGACY_SALT_LENGTH + LEGACY_IV_LENGTH);
  const tag = raw.subarray(LEGACY_SALT_LENGTH + LEGACY_IV_LENGTH, LEGACY_SALT_LENGTH + LEGACY_IV_LENGTH + TAG_LENGTH);
  const encrypted = raw.subarray(LEGACY_SALT_LENGTH + LEGACY_IV_LENGTH + TAG_LENGTH);
  const key = crypto.pbkdf2Sync(Buffer.from(masterKeyHex(), 'hex'), salt, 100000, 32, 'sha512');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return decipher.update(encrypted) + decipher.final('utf8');
}

/** Returns null for tampered, malformed or undecryptable values (including a missing key). */
export function decrypt(encText: string): string | null {
  try {
    return encText.startsWith(V2_PREFIX) ? decryptV2(encText.slice(V2_PREFIX.length)) : decryptLegacy(encText);
  } catch {
    return null;
  }
}

export function getDecryptedCookie(req: NextRequest, cookieName: string): string | undefined {
  const encValue = req.cookies.get(cookieName)?.value;
  if (!encValue) return undefined;
  return decrypt(encValue) ?? undefined;
}
