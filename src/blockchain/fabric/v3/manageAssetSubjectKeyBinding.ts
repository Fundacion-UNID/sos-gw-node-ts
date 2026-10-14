import { ManageAsset } from './manageAsset';

/**
 * Fabric gateway wrapper for the derived `subjectkeybinding-sc` index.
 *
 * The referenced public key, thumbprint and key lifecycle are owned by
 * `cryptographickey-sc`. This wrapper stores only the subject-to-`keyId`
 * relationship and its independent lifecycle, allowing key rotation, several
 * devices per subject and several relationships per key without rewriting the
 * canonical key asset.
 *
 * A successful binding write is not authorization and does not prove that the
 * key exists. The orchestrating flow must register/resolve the key in
 * `cryptographickey-sc` on the same channel and apply the relevant identity,
 * licence, consent and channel policies.
 */
export class ManageAssetSubjectKeyBinding extends ManageAsset {
  constructor(options?: { chaincodeName?: string; channelName?: string }) {
    super('subjectKeyBinding', options);
  }

  protected override getReadFunction(): string {
    return 'readSubjectKeyBinding';
  }

  protected override getHistoryFunction(): string {
    return 'getSubjectKeyBindingHistory';
  }

  /**
   * Creates or updates relationship-owned state only.
   *
   * Do not pass or expect JWK material here. `payload.keyId` references the
   * `cryptographickey-sc` asset; suspending this binding does not suspend the
   * key, and changing the key status does not rewrite this binding.
   */
  public async upsertSubjectKeyBinding(mspId: string, bindingId: string, payload: object): Promise<object> {
    return this.submit(mspId, 'UpsertSubjectKeyBinding', bindingId, JSON.stringify(payload));
  }
}

export const manageAssetSubjectKeyBinding = new ManageAssetSubjectKeyBinding();
