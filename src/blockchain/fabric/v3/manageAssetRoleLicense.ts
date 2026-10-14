import type {
  OrganizationRoleLicense,
  OrganizationRoleLicenseSectorPolicy,
} from 'gdc-common-utils-ts/models/organization-role-license';
import { ManageAsset } from './manageAsset';

export type RoleLicenseLedgerSectorPolicy = Omit<OrganizationRoleLicenseSectorPolicy, 'maxDevices'> & {
  maxDevices?: number;
};

/** Fabric gateway wrapper for `rolelicense-sc` on an organization identity channel. */
export class ManageAssetRoleLicense extends ManageAsset {
  constructor(options?: { chaincodeName?: string; channelName?: string }) {
    super('roleLicense', options);
  }

  public async ensureRoleLicense(
    mspId: string,
    id: string,
    payload: Omit<OrganizationRoleLicense, 'devices' | 'createdAt' | 'updatedAt' | 'revokedAt'>,
  ): Promise<{ created: boolean; asset: OrganizationRoleLicense }> {
    return this.submit(mspId, 'EnsureRoleLicense', id, JSON.stringify(payload)) as Promise<{
      created: boolean;
      asset: OrganizationRoleLicense;
    }>;
  }

  public async upsertSectorPolicy(
    mspId: string,
    id: string,
    policy: RoleLicenseLedgerSectorPolicy,
    timestamp: number,
  ): Promise<OrganizationRoleLicense> {
    return this.submit(
      mspId,
      'UpsertSectorPolicy',
      id,
      JSON.stringify(policy),
      String(timestamp),
    ) as Promise<OrganizationRoleLicense>;
  }
}
