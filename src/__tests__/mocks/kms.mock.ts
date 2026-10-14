// src/__tests__/mocks/kms.mock.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

import { jest } from '@jest/globals';
import { IKmsService } from '../../gdc-backend-utils-node/models/IKmsService';
import { ConfidentialStorageDoc } from 'gdc-common-utils-ts/models/confidential-storage';
import { Content } from 'gdc-common-utils-ts/utils/content';

// This is the definitive, globally-safe mock.
// It uses the original JWE structure and Content helpers to be compatible with all tests.
// Its implementation is now NON-DESTRUCTIVE (it preserves `indexed`), which is the key fix.

const protectConfidentialData: IKmsService['protectConfidentialData'] = async (doc) => {
  // THE FIX: Use destructuring to preserve all top-level properties like `indexed`.
  const { content, ...rest } = doc; 
  const simulatedJwe = { ciphertext: Content.objectToRawBase64UrlSafe(content || {}) };
  // Return the preserved properties (`...rest`) along with the `jwe` object.
  return { ...rest, jwe: simulatedJwe } as ConfidentialStorageDoc;
};

const unprotectConfidentialData: IKmsService['unprotectConfidentialData'] = async <T>(
  doc: ConfidentialStorageDoc,
): Promise<T> => {
  // Match the real KmsService behavior: return the decrypted `content`, not the full document wrapper.
  if (doc.jwe?.ciphertext) {
    return Content.base64UrlSafeToJSON(doc.jwe.ciphertext as string) as T;
  }
  if ((doc as any).content !== undefined) {
    return (doc as any).content as T;
  }
  return doc as unknown as T;
};

export const mockKmsService: jest.Mocked<IKmsService> = {
  init: jest.fn(async () => {}),
  provisionKeys: jest.fn(),
  getPublicJwks: jest.fn(),
  getPublicVerificationKey: jest.fn(),
  getPublicEncryptionKey: jest.fn(),
  decodeRequest: jest.fn(),
  signWithManagedKey: jest.fn(),
  signWithReconstructedKey: jest.fn(),
  createDetachedJws: jest.fn(async (payload: object, signerKid: string, signerVaultId: string) => {
    const protectedHeader = { alg: 'ML-DSA-44', kid: signerKid };
    const protectedHeaderB64 = Buffer.from(JSON.stringify(protectedHeader)).toString('base64url');
    const signature = `fake-signature-for-payload-${JSON.stringify(payload)}`;
    const signatureB64 = Buffer.from(signature).toString('base64url');
    return `${protectedHeaderB64}..${signatureB64}`;
  }),
  createCompactJws: jest.fn(async (payload: object, signerKid: string) => {
    const protectedHeader = { alg: 'ML-DSA-44', kid: signerKid };
    const protectedHeaderB64 = Buffer.from(JSON.stringify(protectedHeader)).toString('base64url');
    const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const signature = `fake-signature-for-payload-${JSON.stringify(payload)}`;
    const signatureB64 = Buffer.from(signature).toString('base64url');
    return `${protectedHeaderB64}.${payloadB64}.${signatureB64}`;
  }),
  encodeResponse: jest.fn(),
  protectConfidentialData: jest.fn(protectConfidentialData),
  // THE HAMMER: Use `as any` to force the complex generic type to comply with Jest.
  unprotectConfidentialData: jest.fn(unprotectConfidentialData) as any,
  getHostPublicJwkSet: jest.fn(async () => ({ keys: [] })),
  getHmacBase64Url: jest.fn(),
  protectAttributesNameAndValue: jest.fn(),
};
