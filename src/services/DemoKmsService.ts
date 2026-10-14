// src/services/DemoKmsService.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

import { ConfidentialStorageDoc, IndexedAttribute } from 'gdc-common-utils-ts/models/confidential-storage';
import { IDecodedDidcommPayload } from 'gdc-common-utils-ts/models/confidential-message';
import { v4 as uuidv4 } from 'uuid';
import { JobRequest, JobStatus } from 'gdc-common-utils-ts/models/confidential-job';
import { JwsHeader, JwsMultiSign } from 'gdc-common-utils-ts/models/jws';
import { IKmsService } from '../gdc-backend-utils-node/models/IKmsService';
import type { SigningPurpose } from '../gdc-backend-utils-node/models/IKmsService';
import { JwkSet, JWK } from '../gdc-backend-utils-node/models/jwk';
import { Content } from 'gdc-common-utils-ts/utils/content';
import { MlkemPublicJwk, PublicJwk } from 'gdc-common-utils-ts/interfaces/Cryptography.types';
import { ParameterData } from 'gdc-common-utils-ts/models/params';

/**
 * A development-focused implementation of the Key Management Service that uses a real
 * KMS instance internally to generate real, deterministic keys, but simulates the
 * encryption/decryption of the communication layer.
 *
 * This provides the best of both worlds for development:
 * - Real, cryptographically valid `did.json` documents and Verifiable Credentials.
 * - Simple, plaintext-equivalent API communication without needing to build real JWEs.
 *
 * WARNING: DO NOT USE IN PRODUCTION.
 */
export class DemoKmsService implements IKmsService {
  private _realKmsService: IKmsService;

  // The Demo service now wraps a real KMS instance to handle key generation and signing.
  constructor(realKmsService: IKmsService) {
    this._realKmsService = realKmsService;
  }

  async init(): Promise<void> {
    // It's crucial to initialize the wrapped service to provision the host keys.
    await this._realKmsService.init();
    console.warn(`[DemoKmsService] Initialized. Key management is delegated to the real KmsService.`);
  }
  
  // --- DELEGATED METHODS (Real Cryptography) ---

  // Key lifecycle and retrieval methods are delegated directly to the real KMS.
  // This ensures that did.json and VCs are cryptographically valid.
  
  async provisionKeys(entityId: string): Promise<JwkSet> {
    console.warn(`[DemoKmsService] Delegating real key provisioning for: ${entityId}`);
    return this._realKmsService.provisionKeys(entityId);
  }

  async getPublicJwks(entityId: string): Promise<JwkSet> {
    return this._realKmsService.getPublicJwks(entityId);
  }

  async getPublicVerificationKey(entityId: string, alg?: string, purpose?: SigningPurpose): Promise<PublicJwk | undefined> {
    return this._realKmsService.getPublicVerificationKey(entityId, alg, purpose);
  }

  async getPublicEncryptionKey(entityId: string, crv?: string): Promise<MlkemPublicJwk | undefined> {
    return this._realKmsService.getPublicEncryptionKey(entityId, crv);
  }

  async getHostPublicJwkSet(): Promise<JwkSet> {
    return this._realKmsService.getHostPublicJwkSet();
  }
  
  async signWithManagedKey(payload: Uint8Array, entityId: string, alg?: string, purpose?: SigningPurpose): Promise<JwsMultiSign> {
    console.warn(`[DemoKmsService] Delegating real signing for entity: ${entityId}`);
    return this._realKmsService.signWithManagedKey(payload, entityId, alg, purpose);
  }
  
  async signWithReconstructedKey(
    payload: Uint8Array,
    seedPartA: Uint8Array,
    encryptedSeedPartB: Uint8Array,
    protectorEntityId: string
    ): Promise<JwsMultiSign> {
      return this._realKmsService.signWithReconstructedKey(payload, seedPartA, encryptedSeedPartB, protectorEntityId);
    }
    
  async getHmacBase64Url(plaintext: string, entityId: string): Promise<string> {
    return this._realKmsService.getHmacBase64Url(plaintext, entityId);
  }
  
      
  async protectAttributesNameAndValue(attributes: ParameterData[], entityId: string): Promise<IndexedAttribute[]> {
    return this._realKmsService.protectAttributesNameAndValue(attributes, entityId);
  }

  async createDetachedJws(payload: object, signerKid: string, signerVaultId: string, purpose?: SigningPurpose): Promise<string> {
    console.warn(`[DemoKmsService] Delegating real detached JWS creation for: ${signerVaultId}`);
    return this._realKmsService.createDetachedJws(payload, signerKid, signerVaultId, purpose);
  }

  async createCompactJws(payload: object, signerKid: string, signerVaultId: string, purpose?: SigningPurpose): Promise<string> {
    console.warn(`[DemoKmsService] Delegating real compact JWS creation for: ${signerVaultId}`);
    return this._realKmsService.createCompactJws(payload, signerKid, signerVaultId, purpose);
  }

  // --- SIMULATED METHODS (Communication Bypass) ---

  // These methods override the real KMS behavior to allow for simple, unencrypted
  // communication flows during development.
  
  async decodeRequest(message: string): Promise<JobRequest> {
    console.warn(`[DemoKmsService] Bypassing decryption for JWE-like message.`);
    
    const result: JobRequest = {
      id: uuidv4(),
      status: JobStatus.DRAFT,
      sequence: 0,
      createdAtTimestamp: Date.now(),
      // These are populated by the HTTP layer (path params / middleware) in normal flows.
      section: 'unknown',
      format: 'unknown',
      resourceType: 'unknown',
      action: 'unknown',
    };

    // This simulates decoding a Compact JWE by splitting it and decoding the payload part.
    // The expected format is: {protected}.{encrypted_key}.{iv}.{ciphertext}.{tag}
    const parts = message.split('.');
    
    if (parts.length === 5) {
      const protectedHeader = Content.base64UrlSafeToJSON(parts[0]);
      const isSimulatedEnvelope = (protectedHeader as { alg?: string; enc?: string }).alg === 'none'
        && (protectedHeader as { alg?: string; enc?: string }).enc === 'none';
      if (!isSimulatedEnvelope) {
        console.warn('[DemoKmsService] Delegating standards-based Compact JWE decryption.');
        return this._realKmsService.decodeRequest(message);
      }
      // Only alg=none/enc=none is the explicit simulated Compact JWE. A
      // standards-based five-part JWE must never have its ciphertext decoded
      // directly as UTF-8 JSON.
      console.warn(`[DemoKmsService] Detected simulated Compact JWE format.`);
      const payload = Content.base64UrlSafeToJSON(parts[3]);
                  // ARCHITECTURE: This function must be tolerant to handle multiple JWE formats
      // to support both new (standard) and legacy (non-standard) test clients.
      if ((protectedHeader as { cty?: string }).cty === 'JWS') {
        // --- 1. Standard Flow: Nested JWS via `cty` header ---
        // The payload is the JWS compact string directly.
        const jwsString = payload as unknown as string;
        const jwsParts = jwsString.split('.');
        const jwsProtectedRaw = Content.base64UrlSafeToJSON(jwsParts[0]) as Partial<JwsHeader>;
        const jwsPayload = Content.base64UrlSafeToJSON(jwsParts[1]) as IDecodedDidcommPayload;
        result.content = jwsPayload;
        result.content.meta = { jws: { protected: { alg: jwsProtectedRaw.alg || 'none', kid: jwsProtectedRaw.kid || 'none' }, signature: 'dev-fake-signature' }, jwe: { header: protectedHeader } };

      } else if ((payload as any).jws && typeof (payload as any).jws === 'string') {
        // --- 2. Legacy Flow: JWS wrapped in a JSON object ---
        // The payload is a JSON object like `{ "jws": "compact.jws.string" }`.
        const jwsParts = (payload as any).jws.split('.');
        const jwsProtectedRaw = Content.base64UrlSafeToJSON(jwsParts[0]) as Partial<JwsHeader>;
        const jwsPayload = Content.base64UrlSafeToJSON(jwsParts[1]) as IDecodedDidcommPayload;
        result.content = jwsPayload;
        result.content.meta = { jws: { protected: { alg: jwsProtectedRaw.alg || 'none', kid: jwsProtectedRaw.kid || 'none' }, signature: 'dev-fake-signature' }, jwe: { header: protectedHeader } };
        
      } else {
        // --- 3. Response Flow: Payload is the content directly ---
        // This is a job response from the worker, where the payload is the response body itself.
        result.content = payload as IDecodedDidcommPayload;
        result.content.meta = { jwe: { header: protectedHeader } };
      }

    } else {
      // Fallback for simple JSON objects for legacy tests (like the ping health check).
      try {
        const parsedMessage = JSON.parse(message);
        console.warn(`[DemoKmsService] Assuming simple JSON object for legacy flow.`);
        result.content = parsedMessage;
      } catch (e) {
        throw new Error('Message is not a valid simulated JWE or a plain JSON object.');
      }
    }
    return result;
  }

  async encodeResponse(payload: any, recipientJwks: JWK[], senderId: string): Promise<string> {
    const hasStandardsBasedRecipient = recipientJwks.some((jwk) => Boolean(
      jwk?.kty && ((jwk as any).pub || (jwk as any).x || (jwk as any).n),
    ));
    if (hasStandardsBasedRecipient) {
      console.warn('[DemoKmsService] Delegating standards-based Compact JWE encryption.');
      return this._realKmsService.encodeResponse(payload, recipientJwks, senderId);
    }
    console.warn(`[DemoKmsService] Bypassing encryption. Returning Compact JWE representation.`);
    
    // This simulates the JARM response format (response=<JWE>) by creating a structurally valid
    // compact JWE string with a base64-encoded payload.

    const protectedHeader = Content.objectToRawBase64UrlSafe({ 
      enc: 'none', // No encryption
      alg: 'none', // No key agreement
      skid: `dev-sender-kid-for-${senderId}`,
      // Include recipient key IDs for structural consistency
      ...recipientJwks.length === 1 && { kid: recipientJwks[0].kid }
    });

    // The "ciphertext" is just the JSON payload, encoded in Base64Url.
    const fakeCiphertext = Content.objectToRawBase64UrlSafe(payload);

    // Construct the 5 parts of the compact JWE. Parts 2, 3, and 5 are placeholders.
    const fakeEncryptedKey = ''; // Part 2: Encrypted Key (empty)
    const fakeIv = 'dev-iv';       // Part 3: IV
    const fakeTag = 'dev-tag';      // Part 5: Authentication Tag

    return `${protectedHeader}.${fakeEncryptedKey}.${fakeIv}.${fakeCiphertext}.${fakeTag}`;
  }

  // At-rest protection is also simulated to allow easy inspection of the database in dev.
  async protectConfidentialData(doc: ConfidentialStorageDoc, entityId: string): Promise<ConfidentialStorageDoc> {
    console.warn(`[DemoKmsService] Simulating data protection for entity: ${entityId}`);
    if (!doc.content) return doc;

    const { content, ...docWithoutContent } = doc;

    const simulatedJwe = {
      protected: Content.objectToRawBase64UrlSafe({ alg: 'dir', enc: 'A256GCM' }),
      ciphertext: Content.objectToRawBase64UrlSafe(content),
      iv: '_iv_',
      tag: '_tag_',
    };

    return { ...docWithoutContent, jwe: simulatedJwe };
  }

  async unprotectConfidentialData<T>(doc: ConfidentialStorageDoc, entityId: string): Promise<T> {
    console.warn(`[DemoKmsService] Simulating data un-protection for entity: ${entityId}`);
    if (!doc.jwe || !doc.jwe.ciphertext) {
      throw new Error('DemoKmsService: Cannot unprotect document with invalid simulated JWE.');
    }
    return Content.base64UrlSafeToJSON(doc.jwe.ciphertext as string) as T;
  }
}
