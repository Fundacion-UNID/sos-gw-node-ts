import type { SubjectIdentityLedgerPort } from '../managers/SubjectIdentityManager';
import { ManageAssetSubjectIdentifier } from '../blockchain/fabric/v3/manageAssetSubjectIdentifier';

type SubjectIdentityFabricManager = Pick<
  ManageAssetSubjectIdentifier,
  'upsertSubjectIdentifier' | 'deleteSubjectIdentifier'
>;

const INDEX_PROVIDER_DID_PATTERN = /^did:web:[A-Za-z0-9._%-]+(?::[A-Za-z0-9._%-]+)*$/;

/**
 * Builds the Fabric adapter used by the encrypted Subject collection.
 *
 * The resulting port intentionally cannot accept a raw identity claim. Its
 * narrow type is the executable audit boundary between private vault data and
 * the public current-resolution ledger.
 */
export function buildSubjectIdentityLedgerPort(input: {
  mspId: string;
  indexProviderDid: string;
  manager?: SubjectIdentityFabricManager;
  channelName?: string;
  chaincodeName?: string;
}): SubjectIdentityLedgerPort {
  const mspId = String(input.mspId || '').trim();
  const indexProviderDid = String(input.indexProviderDid || '').trim();
  if (!mspId) throw new Error('Subject identity ledger requires an MSP id.');
  if (!INDEX_PROVIDER_DID_PATTERN.test(indexProviderDid)) {
    throw new Error('Subject identity ledger index provider must be a did:web identifier.');
  }
  const manager = input.manager || new ManageAssetSubjectIdentifier({
    channelName: input.channelName || process.env.LEDGER_GLOBAL_CHANNEL || 'global',
    chaincodeName: input.chaincodeName || process.env.LEDGER_SUBJECT_IDENTIFIER_CHAINCODE,
  });

  return {
    async upsert({ assetId }) {
      await manager.upsertSubjectIdentifier(mspId, assetId, { indexProviderDid });
    },
    async delete({ assetId }) {
      await manager.deleteSubjectIdentifier(mspId, assetId, indexProviderDid);
    },
  };
}

/**
 * Resolves the optional Fabric port from runtime configuration.
 *
 * The feature switch controls deployment wiring only. It is not an
 * authorization mechanism and it does not change the deterministic alias.
 */
export function buildSubjectIdentityLedgerPortFromEnv(): SubjectIdentityLedgerPort | undefined {
  if (String(process.env.SUBJECT_IDENTIFIER_LEDGER_ENABLED || '').toLowerCase() !== 'true') return undefined;
  const provider = resolveSubjectIdentityProviderFromEnv();
  return buildSubjectIdentityLedgerPort({
    mspId: process.env.LEDGER_MSP_ID || process.env.HLF_MSP_ID_ORG1 || '',
    indexProviderDid: provider.indexProviderDid,
  });
}

/**
 * VetChain owns the single provider DID variable. Product aliases and numeric
 * organization identifiers are intentionally not accepted at this boundary.
 */
export function resolveSubjectIdentityProviderFromEnv(): { indexProviderDid: string } {
  return {
    indexProviderDid: process.env.VET_INDEX_PROVIDER_DID || '',
  };
}
