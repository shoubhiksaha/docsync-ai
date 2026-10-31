import crypto from 'crypto';

// ─── KMS Envelope Encryption (Simulated) ──────────────────────────────────────
// In a true GCP KMS setup, you would call the KMS API to encrypt the DEK.
// Here, we simulate it by using our secure ENCRYPTION_KEY as the Master Key (KEK).

export interface KmsPayload {
  encryptedKey: string;
  iv: string;
  authTag: string;
  encryptedDek: string;
  dekIv: string;
  dekAuthTag: string;
}

export function generateAndWrapDEK(plaintextKey: string): KmsPayload {
  const masterKeyHex = process.env.ENCRYPTION_KEY;
  if (!masterKeyHex || masterKeyHex.length !== 64) {
    throw new Error('ENCRYPTION_KEY must be a 64-character hex string');
  }
  const masterKey = Buffer.from(masterKeyHex, 'hex');

  // 1. Generate a random 32-byte Data Encryption Key (DEK)
  const dek = crypto.randomBytes(32);

  // 2. Encrypt the plaintext key using the DEK
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', dek, iv);
  const encryptedKey = Buffer.concat([cipher.update(plaintextKey, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  // 3. Encrypt the DEK itself using the Master Key (simulating KMS wrapping)
  const dekIv = crypto.randomBytes(12);
  const dekCipher = crypto.createCipheriv('aes-256-gcm', masterKey, dekIv);
  const encryptedDek = Buffer.concat([dekCipher.update(dek), dekCipher.final()]);
  const dekAuthTag = dekCipher.getAuthTag();

  return {
    encryptedKey: encryptedKey.toString('hex'),
    iv: iv.toString('hex'),
    authTag: authTag.toString('hex'),
    encryptedDek: encryptedDek.toString('hex'),
    dekIv: dekIv.toString('hex'),
    dekAuthTag: dekAuthTag.toString('hex'),
  };
}

export function unwrapAndDecryptDEK(payload: KmsPayload): string {
  const masterKeyHex = process.env.ENCRYPTION_KEY;
  if (!masterKeyHex || masterKeyHex.length !== 64) {
    throw new Error('ENCRYPTION_KEY must be a 64-character hex string');
  }
  const masterKey = Buffer.from(masterKeyHex, 'hex');

  // 1. Decrypt the DEK using the Master Key
  const dekDecipher = crypto.createDecipheriv(
    'aes-256-gcm',
    masterKey,
    Buffer.from(payload.dekIv, 'hex')
  );
  dekDecipher.setAuthTag(Buffer.from(payload.dekAuthTag, 'hex'));
  const dek = Buffer.concat([
    dekDecipher.update(Buffer.from(payload.encryptedDek, 'hex')),
    dekDecipher.final(),
  ]);

  // 2. Decrypt the payload using the unencrypted DEK
  const decipher = crypto.createDecipheriv('aes-256-gcm', dek, Buffer.from(payload.iv, 'hex'));
  decipher.setAuthTag(Buffer.from(payload.authTag, 'hex'));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(payload.encryptedKey, 'hex')),
    decipher.final(),
  ]);

  return plaintext.toString('utf8');
}
