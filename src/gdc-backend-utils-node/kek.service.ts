// src/security/kek.service.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

import crypto from 'crypto';
import { AesGcmComponents } from 'gdc-common-utils-ts/models/aes';

/**
 * Manages the lifecycle and usage of the Key Encryption Key (KEK).
 * The KEK is derived from a master secret (`KEK_SECRET` env var) and is
 * used exclusively to encrypt and decrypt Data Encryption Keys (DEKs).
 * It follows a secure pattern where the master secret is read once at startup,
 * wrapped by a session key in memory, and then redacted from the environment.
 */

/**
 * A session key used to wrap the KEK in memory. This adds a layer of protection,
 * ensuring the KEK itself is not held in plaintext in the application's memory.
 * It is generated randomly at startup and discarded when the process exits.
 */
let sessionKey: Uint8Array | null = null;

/**
 * The KEK, wrapped (encrypted) by the `sessionKey`. This is the only form
 * in which the KEK is stored in memory.
 */
let wrappedKEK: Uint8Array | null = null;

/**
 * Initializes the KEK service.
 * This function MUST be called once at application startup. It reads the master
 * secret, derives the KEK, wraps it with a session key, and redacts the secret.
 * @throws If `KEK_SECRET` environment variable is not set.
 */
export function initializeKekService(): void {
  const masterSecret = process.env.KEK_SECRET;
  if (!masterSecret) {
    throw new Error('KEK_SECRET environment variable is required at boot time.');
  }

  // In a real implementation, a KDF like scrypt or Argon2 would be used here.
  // For this cycle, we'll use the secret directly as the KEK for simplicity.
  const kek = Buffer.from(masterSecret, 'base64');
  sessionKey = crypto.randomBytes(32); // AES-256 session key

  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-gcm', sessionKey, iv);
  const ciphertext = Buffer.concat([cipher.update(kek), cipher.final()]);
  const authTag = cipher.getAuthTag();

  wrappedKEK = Buffer.concat([iv, authTag, ciphertext]);

  // Security Best Practice: Redact the secret from the environment variables
  // after it has been loaded into its secure, in-memory wrapped form.
  process.env.KEK_SECRET = '<REDACTED_FOR_SECURITY>';
  // console.log('[KEK_SERVICE] Initialized successfully. Master secret has been wrapped and redacted.');
}

/**
 * Retrieves the unwrapped KEK for an encryption/decryption operation.
 * @returns The raw KEK as a `Uint8Array`.
 * @throws If the service has not been initialized.
 * @private
 */
function getKek(): Uint8Array {
  if (!sessionKey || !wrappedKEK) {
    throw new Error('KEK Service has not been initialized. Call initializeKekService() at startup.');
  }

  const iv = wrappedKEK.subarray(0, 16);
  const authTag = wrappedKEK.subarray(16, 32);
  const encryptedKek = wrappedKEK.subarray(32);

  const decipher = crypto.createDecipheriv('aes-256-gcm', sessionKey, iv);
  decipher.setAuthTag(authTag);
  const dek = Buffer.concat([decipher.update(encryptedKek), decipher.final()]);

  return new Uint8Array(dek);
}

/**
 * Encrypts a payload using the KEK.
 * @param plaintext The data to encrypt (e.g., a Data Encryption Key).
 * @returns The components of the encrypted data (`iv`, `ciphertext`, `authTag`).
 */
export function encryptWithKek(plaintext: Uint8Array): AesGcmComponents {
  const kek = getKek();
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-gcm', kek, iv);

  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return {
    ciphertext: new Uint8Array(ciphertext),
    iv: new Uint8Array(iv),
    authTag: new Uint8Array(authTag),
  };
}

/**
 * Decrypts a payload using the KEK.
 * @param encrypted The components of the data to decrypt.
 * @returns The decrypted plaintext as a `Uint8Array`.
 */
export function decryptWithKek(encrypted: AesGcmComponents): Uint8Array {
  const kek = getKek();
  const decipher = crypto.createDecipheriv('aes-256-gcm', kek, encrypted.iv);
  decipher.setAuthTag(encrypted.authTag);

  const plaintext = Buffer.concat([
    decipher.update(encrypted.ciphertext),
    decipher.final(),
  ]);

  return new Uint8Array(plaintext);
}

/**
 * Encrypts a Data Encryption Key (DEK) using the KEK.
 * This is the "wrapping" part of envelope encryption.
 * @param dek The DEK to encrypt.
 * @returns A single byte array containing the concatenated IV, authTag, and ciphertext.
 */
export function encryptDek(dek: Uint8Array): Uint8Array {
    const { iv, authTag, ciphertext } = encryptWithKek(dek);
    return new Uint8Array(Buffer.concat([iv, authTag, ciphertext]));
}

/**
 * Decrypts a Data Encryption Key (DEK) that was encrypted with the KEK.
 * This is the "unwrapping" part of envelope encryption.
 * @param encryptedDek The concatenated bytes of the encrypted DEK.
 * @returns The decrypted DEK as a `Uint8Array`.
 */
export function decryptDek(encryptedDek: Uint8Array): Uint8Array {
    const iv = encryptedDek.subarray(0, 16);
    const authTag = encryptedDek.subarray(16, 32);
    const ciphertext = encryptedDek.subarray(32);
  
    return decryptWithKek({ iv, authTag, ciphertext });
}
