import { ManageAsset } from './manageAsset';

/**
 * Fabric gateway wrapper for `artifactevent-sc`.
 */
export class ManageAssetArtifactEvent extends ManageAsset {
  constructor(options?: { chaincodeName?: string; channelName?: string }) {
    super('artifactEvent', options);
  }

  protected override getReadFunction(): string {
    return 'readArtifactEvent';
  }

  protected override getHistoryFunction(): string {
    return 'getArtifactEventHistory';
  }

  /**
   * Creates one immutable artifact event entry in ledger state.
   */
  public async createArtifactEvent(mspId: string, eventId: string, payload: object): Promise<object> {
    return this.submit(mspId, 'CreateArtifactEvent', eventId, JSON.stringify(payload));
  }
}

export const manageAssetArtifactEvent = new ManageAssetArtifactEvent();
