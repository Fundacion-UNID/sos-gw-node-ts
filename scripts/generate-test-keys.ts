// scripts/generate-test-keys.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

// Note: npx ts-node scripts/generate-test-keys.ts

import { Content } from '../src/crypto-ts/utils/content';
import { CryptographyService } from '../src/crypto/CryptographyService';

async function generateKeys() {
  const cryptoService = new CryptographyService();

  // console.log('--- Generating External Client Keys ---');

  // --- ML-DSA Signing Key (Level 2) ---
  const dsaSeed = new Uint8Array(32).fill(1); // 32-byte seed
  const { publicJWKey: signerPubKey, secretKeyBytes: signerPrivKey } = await cryptoService.generateKeyPairMlDsa(dsaSeed, 'ML-DSA-44');
  
  // Store the private component as a Base64URL string
  const signerPrivBase64 = Content.bytesToRawBase64UrlSafe(signerPrivKey);
  
  // console.log(`\n// --- ML-DSA Signing Key Pair (ML-DSA-44 from a fixed seed) ---`);
  // console.log(`export const externalClientSignerJwk = {`);
  // console.log(`  kty: '${signerPubKey.kty}',`);
  // console.log(`  alg: '${signerPubKey.alg}',`);
  // console.log(`  pub: '${signerPubKey.pub}',`);
  // console.log(`  kid: '${signerPubKey.kid}',`);
  // console.log(`  priv: '${signerPrivBase64}'`);
  // console.log('};');
  
  // --- ML-KEM Encryption Key ---
  const kemSeed = new Uint8Array(64).fill(1); // 64-byte seed
  const { publicJWKey: encrypterPubKey, secretKeyBytes: encrypterPrivKey } = await cryptoService.generateKeyPairMlKem(kemSeed, 'ML-KEM-768');

  // Store the private component as a Base64URL string
  const encrypterDBase64 = Content.bytesToRawBase64UrlSafe(encrypterPrivKey);

  // console.log(`\n// --- ML-KEM Encryption Key Pair (ML-KEM-768 from a fixed seed) ---`);
  // console.log(`export const externalClientEncrypterJwk = {`);
  // console.log(`  kty: '${encrypterPubKey.kty}',`);
  // console.log(`  crv: '${encrypterPubKey.crv}',`);
  // console.log(`  x: '${encrypterPubKey.x}',`);
  // console.log(`  kid: '${encrypterPubKey.kid}',`);
  // console.log(`  d: '${encrypterDBase64}'`);
  // console.log('};');
}

generateKeys();
