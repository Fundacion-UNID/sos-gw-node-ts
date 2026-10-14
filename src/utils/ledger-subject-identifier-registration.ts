import type { BundleEntry } from 'gdc-common-utils-ts/models/bundle';
import { readSubjectIdentityBundleEntry } from 'gdc-common-utils-ts/utils/subject-identity';
import { ManageAssetSubjectIdentifier } from '../blockchain/fabric/v3/manageAssetSubjectIdentifier';

const INDEX_PROVIDER_DID_PATTERN = /^did:web:[A-Za-z0-9._%-]+(?::[A-Za-z0-9._%-]+)*$/;

type SubjectIdentifierLedgerManager = Pick<ManageAssetSubjectIdentifier, 'upsertSubjectIdentifier'>;

/**
 * Registers semantic Person/Animal/Place identities from the Subject
 * collection. The raw coding-system value is consumed only inside GW while
 * deriving the opaque asset id and is never passed to Fabric.
 */
export async function registerSubjectIdentityBundleOnLedger(input: {
  mspId: string;
  indexProviderDid: string;
  entries: readonly BundleEntry[];
  manager?: SubjectIdentifierLedgerManager;
  channelName?: string;
  chaincodeName?: string;
}): Promise<string[]> {
  const indexProviderDid = normalizeIndexProviderDid(input.indexProviderDid);
  const associations = input.entries.map(readSubjectIdentityBundleEntry);
  const byAssetId = new Map<string, typeof associations[number]>();
  for (const association of associations) {
    const existing = byAssetId.get(association.assetId);
    if (existing && (existing.cardId !== association.cardId || existing.subjectKind !== association.subjectKind)) {
      throw new Error('One subject identifier cannot resolve to different unified cards in the same Bundle');
    }
    byAssetId.set(association.assetId, association);
  }
  const manager = input.manager || new ManageAssetSubjectIdentifier({
    channelName: input.channelName || process.env.LEDGER_GLOBAL_CHANNEL || 'global',
    chaincodeName: input.chaincodeName || process.env.LEDGER_SUBJECT_IDENTIFIER_CHAINCODE,
  });
  for (const association of byAssetId.values()) {
    await manager.upsertSubjectIdentifier(input.mspId, association.assetId, { indexProviderDid });
  }
  return [...byAssetId.keys()];
}

function normalizeIndexProviderDid(value: string): string {
  const indexProviderDid = value.trim();
  if (!INDEX_PROVIDER_DID_PATTERN.test(indexProviderDid)) {
    throw new Error('Index provider must use a did:web identifier');
  }
  return indexProviderDid;
}
