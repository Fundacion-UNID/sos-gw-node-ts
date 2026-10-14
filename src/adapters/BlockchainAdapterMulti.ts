// src/adapters/BlockchainAdapterMulti.ts
// Copyright 2026 Antifraud Services Inc. under the Apache License, Version 2.0.

import type { IBlockchainAdapter } from './IBlockchainAdapter';
import type { ResearchAssetVersionMapping } from '../utils/research-asset-versioning';

/**
 * Combines a read/discovery adapter with an optional Fabric-backed write adapter.
 *
 * This lets GW CORE preserve existing local-memory discovery behaviour while
 * progressively enabling real Fabric writes for selected chaincodes.
 */
export class BlockchainAdapterMulti implements IBlockchainAdapter {
  private readonly discoveryAdapter: IBlockchainAdapter;
  private readonly writeAdapter?: IBlockchainAdapter;

  constructor(params: {
    discoveryAdapter: IBlockchainAdapter;
    writeAdapter?: IBlockchainAdapter;
  }) {
    this.discoveryAdapter = params.discoveryAdapter;
    this.writeAdapter = params.writeAdapter;
  }

  public async discoverDidsByHashes(hashes: string[], channel: string, chaincode: string): Promise<(string | undefined)[]> {
    return this.discoveryAdapter.discoverDidsByHashes(hashes, channel, chaincode);
  }

  public async registerResearchVersionMappings(
    mappings: ResearchAssetVersionMapping[],
    channel: string,
    chaincode: string,
  ): Promise<{ accepted: number; txId?: string }> {
    if (this.writeAdapter?.registerResearchVersionMappings) {
      return this.writeAdapter.registerResearchVersionMappings(mappings, channel, chaincode);
    }
    if (this.discoveryAdapter.registerResearchVersionMappings) {
      return this.discoveryAdapter.registerResearchVersionMappings(mappings, channel, chaincode);
    }
    return { accepted: 0 };
  }

  public async registerCidVersionMappings(
    mappings: Array<{
      cid: string;
      versionId: string;
      resourceType?: string;
      resourceId?: string;
      fullUrl?: string;
    }>,
    channel: string,
    chaincode: string,
  ): Promise<{ accepted: number; txId?: string }> {
    if (this.writeAdapter?.registerCidVersionMappings) {
      return this.writeAdapter.registerCidVersionMappings(mappings, channel, chaincode);
    }
    if (this.discoveryAdapter.registerCidVersionMappings) {
      return this.discoveryAdapter.registerCidVersionMappings(mappings, channel, chaincode);
    }
    return { accepted: 0 };
  }

  public async registerConsentAccessBundle(params: {
    assetId: string;
    payload: Record<string, unknown>;
    channel: string;
    chaincode: string;
  }): Promise<{ accepted: number; txId?: string }> {
    if (this.writeAdapter?.registerConsentAccessBundle) {
      return this.writeAdapter.registerConsentAccessBundle(params);
    }
    if (this.discoveryAdapter.registerConsentAccessBundle) {
      return this.discoveryAdapter.registerConsentAccessBundle(params);
    }
    return { accepted: 0 };
  }

  public async registerArtifactBundle(params: {
    assetId: string;
    payload: Record<string, unknown>;
    channel: string;
  }): Promise<{ accepted: number; txId?: string }> {
    if (this.writeAdapter?.registerArtifactBundle) {
      return this.writeAdapter.registerArtifactBundle(params);
    }
    if (this.discoveryAdapter.registerArtifactBundle) {
      return this.discoveryAdapter.registerArtifactBundle(params);
    }
    return { accepted: 0 };
  }
}
