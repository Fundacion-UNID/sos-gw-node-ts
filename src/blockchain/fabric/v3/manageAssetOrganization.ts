// src/blockchain/fabric/v3/manageAssetOrganization.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

import { ManageAsset } from './manageAsset';

/**
 * Fabric gateway wrapper for `organization-sc`.
 *
 * Current contract expectation:
 * - `orgId` is the ledger key
 * - payload carries the canonical organization VC as `vc`
 * - lifecycle state is authored on-chain under `meta.audit`
 */
export class ManageAssetOrganization extends ManageAsset {
  constructor(options?: { chaincodeName?: string; channelName?: string }) {
    super('organization', options);
  }

  /**
   * Creates one organization asset from its canonical signed VC.
   */
  public async createOrganization(mspId: string, orgId: string, payload: object): Promise<object> {
    return this.submit(mspId, 'CreateOrganization', orgId, JSON.stringify(payload));
  }

  /**
   * Creates the organization when absent and accepts an identical retry.
   * A different VC under the same organization id is a domain conflict.
   */
  public async ensureOrganization(
    mspId: string,
    orgId: string,
    payload: object,
  ): Promise<{ created: boolean; asset: object }> {
    return this.submit(mspId, 'EnsureOrganization', orgId, JSON.stringify(payload)) as Promise<{ created: boolean; asset: object }>;
  }
}

export const manageAssetOrganization = new ManageAssetOrganization();
