// src/blockchain/fabric/v3/manageAssetConsentAccess.ts
// Copyright 2026 Antifraud Services Inc. under the Apache License, Version 2.0.

import { ManageAsset } from './manageAsset';

/**
 * Fabric gateway wrapper for the `consentaccess-sc` chaincode.
 *
 * The item type intentionally uses camelCase so the inherited function-name
 * builder resolves to:
 * - `readConsentAccess`
 * - `getConsentAccessHistory`
 */
export class ManageAssetConsentAccess extends ManageAsset {
  constructor(options?: { chaincodeName?: string; channelName?: string }) {
    super('consentAccess', options);
  }
}

export const manageAssetConsentAccess = new ManageAssetConsentAccess();
