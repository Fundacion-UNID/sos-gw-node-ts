// src/__tests__/unit/security/AesManager.test.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

import { jest } from '@jest/globals';
import { randomBytes } from 'crypto'; // Use Node.js native crypto module
import { ProtectedDataAES } from 'gdc-common-utils-ts/models/aes';
import { AesManager } from 'gdc-common-utils-ts';

describe('AesManager', () => {
  let aesManager: AesManager;

  beforeEach(() => {
    aesManager = new AesManager();
  });

  it('should perform a round-trip (encrypt/decrypt) using base64url strings', async () => {
    // --- 1. Arrange ---
    const payload = { message: 'This is a secret message.', timestamp: Date.now() };
    const plaintext = JSON.stringify(payload);
    const cekBytes = randomBytes(32); // 256-bit Content Encryption Key
    const aad = 'integrity-protected-data';
    // --- 2. Act ---
    // The public interface works with base64url strings, as required by JWE.
    const encryptedData: ProtectedDataAES = await aesManager.encrypt(plaintext, cekBytes, aad);

    // The result is then passed back to the decryption method.
    const decryptedText = await aesManager.decrypt(encryptedData, cekBytes, aad);
    const decryptedPayload = JSON.parse(decryptedText);
    // --- 3. Assert ---
    // The output of encrypt should be correctly formatted strings.
    expect(typeof encryptedData.ciphertext).toBe('string');
    expect(typeof encryptedData.iv).toBe('string');
    expect(typeof encryptedData.tag).toBe('string');

    // The final decrypted object must match the original payload.
    expect(decryptedPayload).toEqual(payload);
  });

  it('should fail decryption if the AAD is tampered with', async () => {
    // --- 1. Arrange ---
    const plaintext = JSON.stringify({ data: 'secret' });
    const cekBytes = randomBytes(32);
    const originalAad = 'original_aad';
    const tamperedAad = 'tampered_aad';

    const encryptedData = await aesManager.encrypt(plaintext, cekBytes, originalAad);
    // --- 2. Assert ---
    // Expect decryption to fail when using the wrong AAD.
    await expect(
      aesManager.decrypt(encryptedData, cekBytes, tamperedAad)
    ).rejects.toThrow();
  });
});
