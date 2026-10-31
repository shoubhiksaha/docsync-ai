import crypto from 'crypto';
import { NextRequest } from 'next/server';
import { decrypt, encrypt, EncryptionKeyMissingError, getDecryptedCookie, isEncryptionConfigured } from '@/core/crypto';

const KEY = 'a'.repeat(64);

/** Produces a value in the pre-v2 format (PBKDF2 per value) to prove old cookies still decrypt. */
function legacyEncrypt(text: string, keyHex: string): string {
  const salt = crypto.randomBytes(64);
  const iv = crypto.randomBytes(16);
  const key = crypto.pbkdf2Sync(Buffer.from(keyHex, 'hex'), salt, 100000, 32, 'sha512');
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  return Buffer.concat([salt, iv, cipher.getAuthTag(), encrypted]).toString('base64');
}

describe('core/crypto', () => {
  const original = process.env.ENCRYPTION_KEY;
  beforeEach(() => { process.env.ENCRYPTION_KEY = KEY; });
  afterAll(() => { process.env.ENCRYPTION_KEY = original; });

  it('round-trips with the v2 format', () => {
    const cipher = encrypt('sk-test-123');
    expect(cipher.startsWith('v2.')).toBe(true);
    expect(decrypt(cipher)).toBe('sk-test-123');
  });

  it('uses a fresh IV each time', () => {
    expect(encrypt('same')).not.toBe(encrypt('same'));
  });

  it('still decrypts legacy (PBKDF2) cookies', () => {
    expect(decrypt(legacyEncrypt('old-notion-token', KEY))).toBe('old-notion-token');
  });

  it('returns null for tampered or garbage input', () => {
    const cipher = encrypt('secret');
    const tampered = cipher.slice(0, -2) + (cipher.endsWith('A') ? 'BB' : 'AA');
    expect(decrypt(tampered)).toBeNull();
    expect(decrypt('not-encrypted')).toBeNull();
    expect(decrypt('')).toBeNull();
  });

  it('returns null when decrypting with a different key', () => {
    const cipher = encrypt('secret');
    process.env.ENCRYPTION_KEY = 'b'.repeat(64);
    expect(decrypt(cipher)).toBeNull();
  });

  it('only fails at call time when the key is missing (no import-time crash)', () => {
    const nodeEnv = process.env.NODE_ENV;
    delete process.env.ENCRYPTION_KEY;
    (process.env as Record<string, string>).NODE_ENV = 'production';
    try {
      expect(isEncryptionConfigured()).toBe(false);
      expect(() => encrypt('x')).toThrow(EncryptionKeyMissingError);
      expect(decrypt('v2.abc')).toBeNull();
    } finally {
      (process.env as Record<string, string>).NODE_ENV = nodeEnv as string;
    }
  });

  it('falls back to a fixed key under NODE_ENV=test', () => {
    delete process.env.ENCRYPTION_KEY;
    expect(isEncryptionConfigured()).toBe(true);
    expect(decrypt(encrypt('t'))).toBe('t');
  });

  it('reads and decrypts a cookie', () => {
    const req = new NextRequest('http://localhost/', { headers: { cookie: `docsync_openai=${encrypt('gsk_abc')}` } });
    expect(getDecryptedCookie(req, 'docsync_openai')).toBe('gsk_abc');
    expect(getDecryptedCookie(req, 'missing')).toBeUndefined();
  });

  it('treats an undecryptable cookie as absent', () => {
    const req = new NextRequest('http://localhost/', { headers: { cookie: 'docsync_openai=garbage' } });
    expect(getDecryptedCookie(req, 'docsync_openai')).toBeUndefined();
  });
});
