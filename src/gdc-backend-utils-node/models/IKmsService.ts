// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.
// File: crypto-ts/interfaces/IKmsService.ts

import { JwkSet, JWK } from 'gdc-common-utils-ts/models/jwk';
import { JwsMultiSign } from 'gdc-common-utils-ts/models/jws';
import { ParameterData } from 'gdc-common-utils-ts/models/params'; // extends ParamAttribute with `type` and others.
import { ConfidentialStorageDoc, IndexedAttribute } from 'gdc-common-utils-ts/models/confidential-storage';
import { JobRequest } from 'gdc-common-utils-ts/models/confidential-job';
import { MlkemPublicJwk, PublicJwk } from 'gdc-common-utils-ts/interfaces/Cryptography.types';

export type SigningPurpose = 'comm_sig' | 'vc_sign';

/**
 * Defines the Key Management Service (KMS).
 *
 * --- Data Handling Principles ---
 * Implementations of this service MUST adhere to strict data handling rules:
 * 1.  **Serialization (Outgoing):** When preparing data for signing or encryption
 *     (e.g., in `encodeResponse`), any structured data (like JSON) MUST be
 *     converted to bytes using a strict UTF-8 encoder (`stringToBytesUTF8`).
 * 2.  **Deserialization (Incoming):** When processing incoming data that has been
 *     decrypted or decompressed (e.g., in `decodeRequest`), the resulting byte
 *     array MUST be converted to a string using a permissive ASCII/binary decoder
 *     (`bytesToStringASCII`) before parsing. This ensures robustness against
 *     binary streams that are not strictly UTF-8 compliant.
 *
 * This ensures maximum interoperability and security.
 */


/**
 * Defines the contract for the Key Management Service (KMS).
 * This service is the SINGLE FACADE for all cryptographic operations that
 * use INTERNAL keys managed by the system (e.g., for Tenants or the Host).
 * It consolidates logic from crypto utilities, JWT/JWE utilities, and key storage.
 */
export interface IKmsService {

  /**
   * Initializes the service, ensuring essential keys (like for the 'host') are provisioned.
   * MUST be called before any other methods.
   */
  init(): Promise<void>;  

  // --- Key Lifecycle Management ---

  /**
   * Generates and securely stores a new set of cryptographic keys for an entity.
   * @param entityId The entity's unique identifier (e.g., a tenant URN).
   * @returns The public parts of the generated keys (JWKSet).
   */
  provisionKeys(entityVaultId: string): Promise<JwkSet>;

  /**
   * Retrieves all public keys for an entity.
   * This is used by high-level services like the TenantManager to construct DID Documents.
   * @param entityId The entity's unique identifier.
   * @returns The public keys in a JWKSet.
   */
  getPublicJwks(entityVaultId: string): Promise<JwkSet>;

  /** 
   * Retrieves the public signing key for an entity, optionally filtering by algorithm.
   * If no algorithm is specified, it defaults to the preferred modern algorithm (e.g., ML-DSA-44).
   */
  getPublicVerificationKey(entityVaultId: string, alg?: string, purpose?: SigningPurpose): Promise<PublicJwk | undefined>;
  
  /** 
   * Retrieves the public encryption key for an entity, optionally filtering by curve.
   * If no curve is specified, it defaults to the preferred modern algorithm (e.g., ML-KEM-768).
   */
  getPublicEncryptionKey(entityVaultId: string, crv?: string): Promise<MlkemPublicJwk | undefined>;

  /**
   * Returns the legacy signing private key as PEM (PKCS8).
   * Used for mTLS when reusing the legacy X.509 keypair.
   */
  getLegacyPrivateKeyPem?(entityVaultId: string): Promise<string | undefined>;

  /**
   * A dedicated method to get the host's public keys as a standard JWKSet.
   * This is crucial for bootstrap and discovery endpoints (e.g., jwks.json)
   * and for end-to-end testing scenarios.
   */
  getHostPublicJwkSet(): Promise<JwkSet>;

  // --- Inbound Request Processing ---

  /**
   * Decrypts and decodes an incoming message (JWE or JWS) WITHOUT verifying the signature.
   * This is the primary entry point for the asynchronous API flow. The service
   * will inspect the JWE recipients to find an internal key it can use for decryption.
   * @param message The raw, encrypted JWE string or a signed JWS string.
   * @returns A decoded `JobRequest` object containing the parsed JWE and JWS structures.
   */
  decodeRequest(message: string): Promise<JobRequest>;

  // --- Signing Operations ---

  /**
   * Creates a JWS by signing a raw payload using a key managed directly by the KMS (e.g., a Tenant's key).
   * This should NOT be used for keys that need to be reconstructed (like employee keys).
   * @param payload The raw data (bytes) to sign.
   * @param entityId The ID of the internal entity that is signing.
   * @returns The signed data as a JwsObject.
   */
  signWithManagedKey(payload: Uint8Array, entityVaultId: string, alg?: string, purpose?: SigningPurpose): Promise<JwsMultiSign>;

  /**
   * Signs a payload by reconstructing a key from its components (e.g., for an Employee's cloud key).
   * This is a high-level method that encapsulates the entire key reconstruction and signing workflow.
   * @param payload The raw data (bytes) to sign.
   * @param seedPartA The part of the seed provided by the user (plaintext).
   * @param encryptedSeedPartB The part of the seed stored by the system (encrypted).
   * @param protectorEntityId The ID of the entity (e.g., the Tenant) whose key was used to encrypt `seedPartB`.
   * @returns The signed data as a JwsObject.
   */
  signWithReconstructedKey(
    payload: Uint8Array,
    seedPartA: Uint8Array,
    encryptedSeedPartB: Uint8Array,
    protectorEntityId: string
  ): Promise<JwsMultiSign>;

  /**
   * Creates a detached JWS signature for a JSON payload.
   * This is the high-level primitive for creating `proof` blocks in Verifiable Credentials.
   * It handles payload canonicalization, construction of the JWS protected header,
   * signing with a managed key, and returning the signature in detached format (HEADER..SIGNATURE).
   * @param payload The JSON object to be signed.
   * @param signerKid The 'kid' of the signing key to use.
   * @param signerVaultId The vault ID of the entity that owns the key.
   * @returns A promise that resolves to the detached JWS string.
   */
  createDetachedJws(payload: object, signerKid: string, signerVaultId: string, purpose?: SigningPurpose): Promise<string>;

  /** Creates an RFC 7797 detached JWS over the exact supplied bytes. */
  createDetachedJwsForBytes?(
    payload: Uint8Array,
    signerKid: string,
    signerVaultId: string,
    purpose?: SigningPurpose,
  ): Promise<string>;

  /**
   * Creates a compact JWS for a JSON payload (HEADER.PAYLOAD.SIGNATURE).
   * This is useful for JWT-like tokens such as `initial_access_token`.
   * @param payload The JSON object to be signed.
   * @param signerKid The 'kid' of the signing key to use.
   * @param signerVaultId The vault ID of the entity that owns the key.
   * @returns A promise that resolves to the compact JWS string.
   */
  createCompactJws(
    payload: object,
    signerKid: string,
    signerVaultId: string,
    purpose?: SigningPurpose,
    protectedHeader?: Readonly<Record<string, string>>,
  ): Promise<string>;

  /** Signs an already encoded compact-JWS payload without serializing it again. */
  createCompactJwsFromEncodedPayload?(
    encodedPayload: string,
    signerKid: string,
    signerVaultId: string,
    purpose?: SigningPurpose,
    protectedHeader?: Readonly<Record<string, unknown>>,
  ): Promise<string>;

  // --- Outbound Encryption ---

  /**
   * Encrypts a response payload for one or more external recipients.
   * This method is intended for data in transit (e.g., API responses). The worker
   * MUST always use this method to prepare the final job result for the `AsyncResponseStore`.
   * @param payload The object to encrypt.
   * @param recipientJwks An array of public keys for the recipients.
   * @param senderId The `entityId` of the internal entity sending the response (e.g., 'host'),
   * used to locate the private encryption key for including its `skid` (sender key id) in the protected header.
   * @returns The encrypted JWE as a compact string (for one recipient) or a JSON string (for multiple).
   */
  encodeResponse(payload: any, recipientJwks: JWK[], senderVaultId: string): Promise<string>;

  // --- At-Rest Data Protection ---

  /**
   * Encrypts a document for secure, long-term storage (data at rest).
   * This method is NOT for final job responses, which are considered data in transit.
   * Use this for protecting records before saving them to the main database (e.g., VaultRepository).
   * @param doc The document to protect. The sensitive data is in the `.content` property.
   * @param entityId The ID of the entity whose key should be used.
   * @returns The protected document with `.content` replaced by a `.jwe` property.
   */
  protectConfidentialData(doc: ConfidentialStorageDoc, entityVaultId: string): Promise<ConfidentialStorageDoc>;

  /**
   * Decrypts a document from secure storage.
   * @param doc The protected document containing the `.jwe` property.
   * @param entityId The ID of the entity whose key was used.
   * @returns The decrypted content of the document.
   */
  unprotectConfidentialData<T>(doc: ConfidentialStorageDoc, entityVaultId: string): Promise<T>;

  /**
   * Computes a keyed hash (HMAC) of a plaintext string using the specified entity's secret HMAC key.
   * @param plaintext The string to hash.
   * @param entityId The ID of the entity (e.g., a tenant's vault ID) whose HMAC key should be used.
   * @returns The resulting HMAC as a Base64UrlSafe string.
   */
  getHmacBase64Url(plaintext: string, entityVaultId: string): Promise<string>;

  /**
   * Takes an array of plaintext attributes (with type information) and returns a new array where
   * both the `name` and `value` properties of each attribute have been protected with HMAC.
   * This is used to create the `indexed` array for a `ConfidentialStorageDoc`.
   * The implementation MUST use domain separation based on the attribute `type` to prevent collisions.
   *
   * @param attributes The array of plaintext `ParameterData` objects.
   * @param entityVaultId The security context for key selection.
   * @returns A promise that resolves to the array of protected `IndexedAttribute` objects, ready for storage.
   */
  protectAttributesNameAndValue(attributes: ParameterData[], entityVaultId: string): Promise<IndexedAttribute[]>;
}
