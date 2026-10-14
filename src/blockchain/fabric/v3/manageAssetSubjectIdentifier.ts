import { ManageAsset } from './manageAsset';

export type SubjectIdentifierIndexProviderPayload = Readonly<{ indexProviderDid: string }>;

/** Fabric gateway wrapper for the global `subjectidentifier-sc` contract. */
export class ManageAssetSubjectIdentifier extends ManageAsset {
  constructor(options: { chaincodeName?: string; channelName: string }) {
    super('subjectIdentifier', {
      chaincodeName: options.chaincodeName || 'subjectidentifier-sc',
      channelName: options.channelName,
    });
  }

  public async upsertSubjectIdentifier(
    mspId: string,
    assetId: string,
    payload: SubjectIdentifierIndexProviderPayload,
  ): Promise<object> {
    return this.submit(mspId, 'UpsertSubjectIdentifier', assetId, JSON.stringify(payload));
  }

  /** Removes the current lookup using only the opaque asset and provider ids. */
  public async deleteSubjectIdentifier(
    mspId: string,
    assetId: string,
    indexProviderDid: string,
  ): Promise<object> {
    return this.submit(mspId, 'DeleteSubjectIdentifier', assetId, indexProviderDid);
  }
}
