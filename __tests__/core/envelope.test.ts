import { generateAndWrapDEK, unwrapAndDecryptDEK, KmsPayload } from '@/core/envelope';

describe('security', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    process.env.ENCRYPTION_KEY = 'a'.repeat(64); // 64 char hex string
    process.env.NOTION_ENCRYPTION_KEY_V2 = 'test-pepper';
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe('generateAndWrapDEK & unwrapAndDecryptDEK', () => {
    it('should securely encrypt and decrypt a plaintext string', () => {
      const plaintext = 'sk-my-super-secret-key-123';
      const payload = generateAndWrapDEK(plaintext);
      
      expect(payload).toHaveProperty('encryptedKey');
      expect(payload).toHaveProperty('iv');
      expect(payload).toHaveProperty('authTag');
      expect(payload).toHaveProperty('encryptedDek');
      expect(payload).toHaveProperty('dekIv');
      expect(payload).toHaveProperty('dekAuthTag');
      
      const decrypted = unwrapAndDecryptDEK(payload);
      expect(decrypted).toBe(plaintext);
    });

    it('should throw an error when unwrapping tampered data', () => {
      const plaintext = 'sk-my-super-secret-key-123';
      const payload = generateAndWrapDEK(plaintext);
      
      // Tamper with ciphertext in a guaranteed way
      const firstChar = payload.encryptedKey.charAt(0);
      const newFirstChar = firstChar === 'a' ? 'b' : 'a';
      const tamperedPayload = { ...payload, encryptedKey: newFirstChar + payload.encryptedKey.substring(1) };
      
      expect(() => {
        unwrapAndDecryptDEK(tamperedPayload);
      }).toThrow();
    });

    it('should throw if ENCRYPTION_KEY is missing', () => {
      delete process.env.ENCRYPTION_KEY;
      expect(() => generateAndWrapDEK('test')).toThrow('ENCRYPTION_KEY must be a 64-character hex string');
      expect(() => unwrapAndDecryptDEK({} as unknown as KmsPayload)).toThrow('ENCRYPTION_KEY must be a 64-character hex string');
    });

    it('should throw if ENCRYPTION_KEY is not 64 chars', () => {
      process.env.ENCRYPTION_KEY = 'short';
      expect(() => generateAndWrapDEK('test')).toThrow('ENCRYPTION_KEY must be a 64-character hex string');
      expect(() => unwrapAndDecryptDEK({} as unknown as KmsPayload)).toThrow('ENCRYPTION_KEY must be a 64-character hex string');
    });
  });
});
