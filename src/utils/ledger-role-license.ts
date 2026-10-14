import { buildStableActorIdentifier, type StableActorContactKind } from 'gdc-common-utils-ts/utils/actor-identifier';
import {
  buildOrganizationRoleLicenseId,
  DEFAULT_ORGANIZATION_ROLE_LICENSE_POLICY,
  normalizeOrganizationRoleLicensePolicies,
} from 'gdc-common-utils-ts/utils/organization-role-license';
import type {
  OrganizationRoleLicense,
  OrganizationRoleLicenseSectorPolicy,
} from 'gdc-common-utils-ts/models/organization-role-license';
import type { ManageAssetRoleLicense } from '../blockchain/fabric/v3/manageAssetRoleLicense';
import { shouldUseFabricLedger } from '../adapters/credential-ledger-resolver';
import { resolveOrganizationIdentityChannel } from './ledger';
import { DEFAULT_ROLE_LICENSE_CHAINCODE_NAME } from '../constants/domain';

type RoleLicenseManager = Pick<
  ManageAssetRoleLicense,
  'ensureRoleLicense' | 'upsertSectorPolicy'
>;

function resolveOrganizationOfficialId(input: Readonly<{
  organizationOfficialId?: string;
  organizationId?: string;
}>): string {
  const direct = String(input.organizationOfficialId || '').trim();
  if (direct) return direct;
  const authorizationUrn = String(input.organizationId || '').trim();
  if (authorizationUrn && !authorizationUrn.startsWith('urn:')) return authorizationUrn;
  const match = authorizationUrn.match(/^urn:org:[^:]+:([^:]+)$/i);
  if (!match?.[1]) {
    throw new Error('Role licence identity requires a bare official organization id or canonical organization URN.');
  }
  return match[1];
}

function resolveLedgerMspId(): string {
  const mspId = String(process.env.LEDGER_MSP_ID || process.env.HLF_MSP_ID_ORG1 || '').trim();
  if (!mspId) throw new Error('Role licence ledger registration requires LEDGER_MSP_ID.');
  return mspId;
}

async function createManager(jurisdiction: string): Promise<ManageAssetRoleLicense> {
  const { ManageAssetRoleLicense: FabricRoleLicenseManager } = await import(
    '../blockchain/fabric/v3/manageAssetRoleLicense.js'
  );
  return new FabricRoleLicenseManager({
    chaincodeName: process.env.LEDGER_ROLE_LICENSE_CHAINCODE || DEFAULT_ROLE_LICENSE_CHAINCODE_NAME,
    channelName: resolveOrganizationIdentityChannel(jurisdiction),
  });
}

export type IssuedRoleLicenseLedgerIdentity = Readonly<{
  id: string;
  organizationOfficialId: string;
  jurisdiction: string;
  stableContactIdentifier: string;
  licensedRole: string;
}>;

/** Builds the shared identity without exposing the clear contact. */
export function buildIssuedRoleLicenseLedgerIdentity(input: Readonly<{
  organizationOfficialId?: string;
  organizationId?: string;
  jurisdiction: string;
  contactKind: StableActorContactKind;
  contact: string;
  licensedRole: string;
}>): IssuedRoleLicenseLedgerIdentity {
  const stableContactIdentifier = buildStableActorIdentifier({
    contactKind: input.contactKind,
    contact: input.contact,
  });
  const identity = {
    organizationOfficialId: resolveOrganizationOfficialId(input),
    jurisdiction: String(input.jurisdiction || '').trim().toLowerCase(),
    stableContactIdentifier,
    licensedRole: String(input.licensedRole || '').trim(),
  };
  return { ...identity, id: buildOrganizationRoleLicenseId(identity) };
}

/**
 * Ensures a role licence through the active Fabric provider.
 * Test Network and production use this same write; payment-provider selection
 * occurs earlier in Offer/Order and cannot bypass this registration.
 */
export async function ensureIssuedRoleLicenseOnLedger(input: Readonly<{
  identity: IssuedRoleLicenseLedgerIdentity;
  sector?: string;
  policies?: readonly OrganizationRoleLicenseSectorPolicy[];
  manager?: RoleLicenseManager;
}>): Promise<IssuedRoleLicenseLedgerIdentity> {
  if (!shouldUseFabricLedger()) return input.identity;
  const defaultPolicy: OrganizationRoleLicenseSectorPolicy = input.sector
    ? { sector: String(input.sector).trim() as OrganizationRoleLicenseSectorPolicy['sector'], active: true }
    : DEFAULT_ORGANIZATION_ROLE_LICENSE_POLICY;
  const policies = normalizeOrganizationRoleLicensePolicies(
    input.policies || [defaultPolicy],
  );
  const manager = input.manager || await createManager(input.identity.jurisdiction);
  const result = await manager.ensureRoleLicense(resolveLedgerMspId(), input.identity.id, {
    ...input.identity,
    status: 'active',
    data: policies,
  });
  for (const policy of policies) {
    const current = result.asset.data.find((candidate) => candidate.sector === policy.sector);
    if (!result.created && (!current
      || current.active !== policy.active
      || current.maxDevices !== policy.maxDevices)) {
      await manager.upsertSectorPolicy(
        resolveLedgerMspId(),
        input.identity.id,
        policy,
        Math.floor(Date.now() / 1000),
      );
    }
  }
  return input.identity;
}

/** Rebuilds the global identity from the privacy-safe local seat projection. */
export function buildIssuedRoleLicenseLedgerIdentityFromSeat(input: Readonly<{
  organizationOfficialId?: string;
  organizationId?: string;
  jurisdiction?: string;
  stableContactIdentifier?: string;
  licensedRole?: string;
}>): IssuedRoleLicenseLedgerIdentity {
  const identity = {
    organizationOfficialId: resolveOrganizationOfficialId(input),
    jurisdiction: String(input.jurisdiction || '').trim().toLowerCase(),
    stableContactIdentifier: String(input.stableContactIdentifier || '').trim(),
    licensedRole: String(input.licensedRole || '').trim(),
  };
  return { ...identity, id: buildOrganizationRoleLicenseId(identity) };
}

// Keep the imported ledger type reachable to generated JSDoc consumers.
export type RoleLicenseLedgerAsset = OrganizationRoleLicense;
