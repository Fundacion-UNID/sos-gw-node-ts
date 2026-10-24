// src/adapters/IBlockchainAdapter.ts

import type { PublicHealthStatisticLedgerMapping } from '../utils/public-health-statistics';

/**
 * Defines the standardized interface for interacting with a blockchain network
 * for the purpose of identity discovery. This allows the application's business logic
 * to be decoupled from the specific blockchain technology (e.g., Fabric, Ethereum).
 */
export interface IBlockchainAdapter {
  /**
   * Queries the blockchain network to discover DIDs associated with a given list of hashes.
   * The returned array must maintain the same order as the input hashes.
   *
   * @param hashes An array of multibase-encoded multihashes to look up.
   * @param channel The name of the channel on the network (e.g., 'health-care-eu').
   * @param chaincode The name of the smart contract/chaincode to invoke (e.g., 'discovery-person').
   * @returns A promise that resolves to an array of the same length as the input. Each element
   *          is either the found 'did:web' string or undefined if not found.
   */
  discoverDidsByHashes(hashes: string[], channel: string, chaincode: string): Promise<(string | undefined)[]>;

  /**
   * Optional write path for registering content-addressed FHIR version identifiers.
   * `resource.id` remains UUID; `versionId` can carry a CID/multihash for traceability.
   *
   * Implementations can persist these mappings on-chain for audit/discovery.
   */
  registerCidVersionMappings?(
    mappings: Array<{
      cid: string;
      versionId: string;
      resourceType?: string;
      resourceId?: string;
      fullUrl?: string;
    }>,
    channel: string,
    chaincode: string,
  ): Promise<{ accepted: number; txId?: string }>;

  /** Registers one code-only research parent followed by its opaque version. */
  registerResearchVersionMappings?(
    mappings: Array<{
      resourceType: string;
      researchAssetId: string;
      versionAssetId: string;
      sourceVersionId: string;
      parent: string;
      research: true;
      tags: Array<{
        id: string;
        system?: string;
        code?: string;
        version?: string;
        userSelected?: boolean;
      }>;
    }>,
    channel: string,
    chaincode: string,
  ): Promise<{ accepted: number; txId?: string }>;

  /** Registers identifier-free statistics in the manager-selected research channel. */
  registerPublicHealthStatistics?(
    mappings: PublicHealthStatisticLedgerMapping[],
    channel: string,
    chaincode: string,
  ): Promise<{ accepted: number; txId?: string }>;

  /**
   * Optional write path for registering one content-addressed artifact payload
   * on-chain.
   */
  registerArtifactBundle?(
    params: {
      assetId: string;
      payload: Record<string, unknown>;
      channel: string;
    },
  ): Promise<{ accepted: number; txId?: string }>;

  /**
   * Optional write path for registering one sanitized consent-access rule on-chain.
   *
   * The payload still uses the shared JSON:API-style primary-document contract
   * with mandatory `data[]`, but GW CORE now submits one atomic rule per call:
   * - `assetId = data[0].id = CIDv1(SHA3-384(canonicalRuleId))`
   * - `payload.data.length = 1`
   */
  registerConsentAccessBundle?(
    params: {
      assetId: string;
      payload: Record<string, unknown>;
      channel: string;
      chaincode: string;
    },
  ): Promise<{ accepted: number; txId?: string }>;
}
