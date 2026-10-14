// src/blockchain/fabric/v3/manageCryptographicKey.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

import { ManageAsset } from './manageAsset';

/**
 * Minimal payload shape currently persisted by `cryptographickey-sc`.
 *
 * Notes for developers:
 * - `use` follows JWK semantics such as `sig` or `enc`
 * - `purpose` is the business-facing relationship, for example
 *   `organization-signing` or `organization-encryption`
 * - `thumbprint` is the preferred stable key identifier when available
 * - `kid` is a secondary JWK-oriented label and may be missing or non-global
 * - `orgId` currently points to the owner organization identifier; in
 *   practice that resolves to the organization's canonical DID/URN context
 * - temporal lifecycle on-chain uses epoch seconds (`expiresAt`) rather than
 *   ISO strings; `nbf` is not yet modeled separately in the chaincode
 */
export type CryptographicKeyLedgerPayload = {
  keyId?: string;
  orgId: string;
  kid?: string;
  thumbprint?: string;
  kty?: string;
  crv?: string;
  alg?: string;
  use?: 'sig' | 'enc' | string;
  purpose?: string;
  status?: 'active' | 'suspended' | 'revoked' | 'expired';
  expiresAt?: number | null;
  origin?: string;
};

/**
 * Fabric gateway wrapper for `cryptographickey-sc`.
 *
 * `registerKey(...)` is a semantic alias over `submit(...)` that binds the
 * chaincode function name to `RegisterKey`.
 */
export class ManageAssetCryptographicKey extends ManageAsset {
  constructor(options?: { chaincodeName?: string; channelName?: string }) {
    super('cryptographicKey', options);
  }

  /**
   * Creates one new cryptographic key asset in ledger state.
   *
   * This is not a local key-generation helper. It only serializes the payload
   * and submits the `RegisterKey` transaction to Fabric.
   */
  public async registerKey(
    mspId: string,
    keyId: string,
    payload: CryptographicKeyLedgerPayload,
  ): Promise<object> {
    return this.submit(mspId, 'RegisterKey', keyId, JSON.stringify(payload));
  }

  /**
   * Creates the key when absent and returns the existing asset when the
   * on-chain immutable material is compatible. The chaincode rejects a
   * conflicting owner or key payload with CRYPTOGRAPHIC_KEY_CONFLICT.
   */
  public async ensureKey(
    mspId: string,
    keyId: string,
    payload: CryptographicKeyLedgerPayload,
  ): Promise<{ created: boolean; asset: object }> {
    return this.submit(mspId, 'EnsureKey', keyId, JSON.stringify(payload)) as Promise<{ created: boolean; asset: object }>;
  }
}

export const manageAssetCryptographicKey = new ManageAssetCryptographicKey();
