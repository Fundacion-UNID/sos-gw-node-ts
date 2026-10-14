// src/adapters/BlockchainAdapterMem.ts

import { IBlockchainAdapter } from './IBlockchainAdapter';
import type { ResearchAssetVersionMapping } from '../utils/research-asset-versioning';

/**
 * An in-memory mock implementation of the IBlockchainAdapter for testing and local development.
 * It simulates a blockchain ledger using a simple Map.
 */
export class BlockchainAdapterMem implements IBlockchainAdapter {
  private ledger: Map<string, string>;
  private consentAccessBundles: Map<string, Record<string, unknown>>;

  constructor() {
    // Pre-populate the mock ledger with some test data
    this.ledger = new Map<string, string>();
    this.consentAccessBundles = new Map<string, Record<string, unknown>>();
  }

  /**
   * Simulates querying the mock ledger for a batch of hashes.
   */
  public async discoverDidsByHashes(hashes: string[], channel: string, chaincode: string): Promise<(string | undefined)[]> {
    // console.log(`[BlockchainAdapterMem] Querying channel "${channel}" on chaincode "${chaincode}" for ${hashes.length} hashes.`);
    
    const results = hashes.map(hash => this.ledger.get(hash));
    
    // Simulate a delay
    await new Promise(resolve => setTimeout(resolve, 50));

    return results;
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
    // This memory adapter acknowledges all mappings without persistent blockchain effects.
    // Production adapters can write these mappings on-chain.
    await new Promise(resolve => setTimeout(resolve, 10));
    return {
      accepted: mappings.length,
      txId: `mem-tx-${Date.now()}`,
    };
  }

  public async registerResearchVersionMappings(
    mappings: ResearchAssetVersionMapping[],
    _channel: string,
    _chaincode: string,
  ): Promise<{ accepted: number; txId?: string }> {
    return { accepted: mappings.length, txId: `mem-research-${Date.now()}` };
  }

  public async registerConsentAccessBundle(params: {
    assetId: string;
    payload: Record<string, unknown>;
    channel: string;
    chaincode: string;
  }): Promise<{ accepted: number; txId?: string }> {
    this.consentAccessBundles.set(params.assetId, params.payload);
    await new Promise(resolve => setTimeout(resolve, 10));
    return {
      accepted: Array.isArray(params.payload?.data) ? params.payload.data.length : 0,
      txId: `mem-consentaccess-${Date.now()}`,
    };
  }

  public async registerArtifactBundle(params: {
    assetId: string;
    payload: Record<string, unknown>;
    channel: string;
  }): Promise<{ accepted: number; txId?: string }> {
    this.consentAccessBundles.set(params.assetId, params.payload);
    await new Promise(resolve => setTimeout(resolve, 10));
    return {
      accepted: 1,
      txId: `mem-artifact-${Date.now()}`,
    };
  }

  // Helper method for tests to populate the ledger
  public addMapping(hash: string, did: string) {
    this.ledger.set(hash, did);
  }

  public getConsentAccessBundle(assetId: string): Record<string, unknown> | undefined {
    return this.consentAccessBundles.get(assetId);
  }
}
