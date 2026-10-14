// src/blockchain/fabric/v3/manageCredential.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

import { ManageAsset } from './manageAsset';

/**
 * Fabric gateway wrapper for `credential-sc`.
 *
 * This wrapper remains intentionally thin because `credential-sc` is not part
 * of the active integration scope right now. Keep it available for backwards
 * compatibility, but do not expand usage until the credential ledger model is
 * clarified.
 */
export class ManageAssetCredential extends ManageAsset {
  constructor(options?: { chaincodeName?: string; channelName?: string }) {
    super('credential', options);
  }
}

export const manageAssetCredential = new ManageAssetCredential();
