// src/adapters/BlockchainAdapterFabric.ts
// Copyright 2026 Antifraud Services Inc. under the Apache License, Version 2.0.

import { ManageAssetConsentAccess } from '../blockchain/fabric/v3/manageAssetConsentAccess';
import { ManageAssetArtifact } from '../blockchain/fabric/v3/manageAssetArtifact';
import {
  RESEARCH_ASSET_RESOURCE_TYPE,
  VERSION_ASSET_RESOURCE_TYPE,
  type ResearchAssetVersionMapping,
} from '../utils/research-asset-versioning';
import type { PublicHealthStatisticLedgerMapping } from '../utils/public-health-statistics';
import type { IBlockchainAdapter } from './IBlockchainAdapter';

type FabricBlockchainConfig = {
  mspId: string;
};

const DEFAULT_FABRIC_BLOCKCHAIN_CONFIG: FabricBlockchainConfig = {
  mspId: 'Org1MSP',
};

function loadFabricBlockchainConfig(): FabricBlockchainConfig {
  return {
    mspId:
      process.env.LEDGER_MSP_ID
      || process.env.LEDGER_FABRIC_MSP_ID
      || process.env.HLF_MSP_ID_ORG1
      || DEFAULT_FABRIC_BLOCKCHAIN_CONFIG.mspId,
  };
}

/**
 * Minimal Fabric-backed blockchain adapter for write paths that already have a
 * dedicated chaincode contract.
 *
 * Read-oriented discovery remains delegated elsewhere because consent-access
 * registration does not currently expose DID discovery semantics.
 */
export class BlockchainAdapterFabric implements IBlockchainAdapter {
  public async registerPublicHealthStatistics(
    mappings: PublicHealthStatisticLedgerMapping[],
    channel: string,
    chaincode: string,
  ): Promise<{ accepted: number; txId?: string }> {
    const config = loadFabricBlockchainConfig();
    const manager = new ManageAssetArtifact({ chaincodeName: chaincode, channelName: channel });
    const data = mappings.map(({ statisticId, contribution }) => ({
      type: 'PublicHealthStatistic',
      id: statisticId,
      resource: {
        resourceType: 'PublicHealthStatistic',
        collectionPurpose: contribution.collectionPurpose,
        subjectKind: contribution.projection.subjectKind,
        section: contribution.projection.section,
        coding: {
          system: contribution.projection.codingSystem,
          code: contribution.projection.code,
        },
        jurisdiction: contribution.projection.jurisdiction,
        occurredOn: contribution.projection.occurredOn,
        ...(contribution.projection.demographics
          ? { demographics: contribution.projection.demographics }
          : {}),
      },
    }));
    const submitted = await manager.upsertPublicHealthStatisticsWithTransactionId(config.mspId, { data });
    return { accepted: data.length, txId: submitted.transactionId };
  }

  public async registerResearchVersionMappings(
    mappings: ResearchAssetVersionMapping[],
    channel: string,
    chaincode: string,
  ): Promise<{ accepted: number; txId?: string }> {
    const config = loadFabricBlockchainConfig();
    const manager = new ManageAssetArtifact({ chaincodeName: chaincode, channelName: channel });
    const data = mappings.map((mapping) => ({
      researchAsset: {
        type: RESEARCH_ASSET_RESOURCE_TYPE,
        id: mapping.researchAssetId,
        resource: {
          resourceType: RESEARCH_ASSET_RESOURCE_TYPE,
          meta: { tag: mapping.tags },
        },
      },
      versionAsset: {
        type: VERSION_ASSET_RESOURCE_TYPE,
        id: mapping.versionAssetId,
        resource: {
          resourceType: VERSION_ASSET_RESOURCE_TYPE,
          parent: mapping.parent,
          research: true,
        },
      },
    }));
    const submitted = await manager.upsertResearchVersionsWithTransactionId(config.mspId, { data });
    return { accepted: data.length, txId: submitted.transactionId };
  }

  public async discoverDidsByHashes(hashes: string[], channel: string, chaincode: string): Promise<(string | undefined)[]> {
    return hashes.map(() => undefined);
  }

  public async registerConsentAccessBundle(params: {
    assetId: string;
    payload: Record<string, unknown>;
    channel: string;
    chaincode: string;
  }): Promise<{ accepted: number; txId?: string }> {
    const config = loadFabricBlockchainConfig();
    const manager = new ManageAssetConsentAccess({
      chaincodeName: params.chaincode,
      channelName: params.channel,
    });

    await manager.submit(
      config.mspId,
      'upsertConsentAccess',
      params.assetId,
      JSON.stringify(params.payload),
    );

    return {
      accepted: Array.isArray(params.payload?.data) ? params.payload.data.length : 0,
    };
  }

  public async registerArtifactBundle(params: {
    assetId: string;
    payload: Record<string, unknown>;
    channel: string;
  }): Promise<{ accepted: number; txId?: string }> {
    const config = loadFabricBlockchainConfig();
    const manager = new ManageAssetArtifact({
      channelName: params.channel,
    });

    await manager.upsertArtifact(
      config.mspId,
      params.assetId,
      params.payload,
    );

    return { accepted: 1 };
  }
}
