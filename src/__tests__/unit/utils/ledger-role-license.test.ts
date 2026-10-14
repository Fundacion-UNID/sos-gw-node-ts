// Flow contract: publish only the organization-role licence and sector policy;
// concrete DCR installations and their limits remain private GW state.
import {
  EXAMPLE_ORGANIZATION_ROLE_LICENSE,
  EXAMPLE_ORGANIZATION_ROLE_LICENSE_IDENTITY,
} from 'gdc-common-utils-ts/examples/organization-role-license';
import {
  buildIssuedRoleLicenseLedgerIdentity,
  buildIssuedRoleLicenseLedgerIdentityFromSeat,
  ensureIssuedRoleLicenseOnLedger,
} from '../../../utils/ledger-role-license';
import { ManageAssetRoleLicense } from '../../../blockchain/fabric/v3/manageAssetRoleLicense';

describe('regional organization role licence ledger adapter', () => {
  const original = { ...process.env };

  beforeEach(() => {
    process.env.NETWORK_MODE = 'test-network';
    process.env.LEDGER_PROVIDER_DEFAULT = 'fabric';
    process.env.LEDGER_PROVIDER_MAP = 'test-network=fabric';
    process.env.LEDGER_MSP_ID = 'UNIDMSP';
  });

  afterEach(() => {
    for (const key of Object.keys(process.env)) {
      if (!(key in original)) delete process.env[key];
    }
    Object.assign(process.env, original);
    jest.restoreAllMocks();
  });

  it('builds one cross-host identity from official org, stable contact and role', () => {
    const identity = buildIssuedRoleLicenseLedgerIdentity({
      organizationOfficialId: EXAMPLE_ORGANIZATION_ROLE_LICENSE_IDENTITY.organizationOfficialId,
      jurisdiction: 'ES',
      contactKind: 'email',
      contact: 'professional@example.org',
      licensedRole: EXAMPLE_ORGANIZATION_ROLE_LICENSE_IDENTITY.licensedRole,
    });
    expect(identity.id).toMatch(/^urn:multibase:z/);
    expect(identity.organizationOfficialId).toBe(EXAMPLE_ORGANIZATION_ROLE_LICENSE_IDENTITY.organizationOfficialId);
    expect(identity.jurisdiction).toBe('es');
    expect(identity).not.toHaveProperty('email');
  });

  it('rebuilds the same identity from a persisted organization authorization URN', () => {
    const identity = buildIssuedRoleLicenseLedgerIdentityFromSeat({
      organizationId: `urn:org:tax:${EXAMPLE_ORGANIZATION_ROLE_LICENSE_IDENTITY.organizationOfficialId}`,
      jurisdiction: EXAMPLE_ORGANIZATION_ROLE_LICENSE_IDENTITY.jurisdiction,
      stableContactIdentifier: EXAMPLE_ORGANIZATION_ROLE_LICENSE_IDENTITY.stableContactIdentifier,
      licensedRole: EXAMPLE_ORGANIZATION_ROLE_LICENSE_IDENTITY.licensedRole,
    });
    expect(identity).toEqual(expect.objectContaining({
      organizationOfficialId: EXAMPLE_ORGANIZATION_ROLE_LICENSE_IDENTITY.organizationOfficialId,
      jurisdiction: EXAMPLE_ORGANIZATION_ROLE_LICENSE_IDENTITY.jurisdiction.toLowerCase(),
      stableContactIdentifier: EXAMPLE_ORGANIZATION_ROLE_LICENSE_IDENTITY.stableContactIdentifier,
      licensedRole: EXAMPLE_ORGANIZATION_ROLE_LICENSE_IDENTITY.licensedRole,
    }));
  });

  it('ensures the asset and amends an existing contractual sector policy', async () => {
    const manager = {
      ensureRoleLicense: jest.fn(async () => ({
        created: false,
        asset: EXAMPLE_ORGANIZATION_ROLE_LICENSE,
      })),
      upsertSectorPolicy: jest.fn(async () => EXAMPLE_ORGANIZATION_ROLE_LICENSE),
    };
    await ensureIssuedRoleLicenseOnLedger({
      identity: {
        id: EXAMPLE_ORGANIZATION_ROLE_LICENSE.id,
        ...EXAMPLE_ORGANIZATION_ROLE_LICENSE_IDENTITY,
      },
      policies: [{ sector: 'animal-care', active: true, maxDevices: 5 }],
      manager: manager as any,
    });
    expect(manager.ensureRoleLicense).toHaveBeenCalledWith(
      'UNIDMSP',
      EXAMPLE_ORGANIZATION_ROLE_LICENSE.id,
      expect.objectContaining({
        organizationOfficialId: EXAMPLE_ORGANIZATION_ROLE_LICENSE_IDENTITY.organizationOfficialId,
        data: [{ sector: 'animal-care', active: true, maxDevices: 5 }],
      }),
    );
    expect(manager.upsertSectorPolicy).toHaveBeenCalledWith(
      'UNIDMSP',
      EXAMPLE_ORGANIZATION_ROLE_LICENSE.id,
      { sector: 'animal-care', active: true, maxDevices: 5 },
      expect.any(Number),
    );
  });

  it('omits delegated maxDevices from the public ledger projection', async () => {
    const manager = {
      ensureRoleLicense: jest.fn(async () => ({
        created: true,
        asset: EXAMPLE_ORGANIZATION_ROLE_LICENSE,
      })),
      upsertSectorPolicy: jest.fn(async () => EXAMPLE_ORGANIZATION_ROLE_LICENSE),
    };
    await ensureIssuedRoleLicenseOnLedger({
      identity: { id: EXAMPLE_ORGANIZATION_ROLE_LICENSE.id, ...EXAMPLE_ORGANIZATION_ROLE_LICENSE_IDENTITY },
      policies: [{ sector: 'animal-care', active: true }],
      manager: manager as any,
    });
    expect(manager.ensureRoleLicense).toHaveBeenCalledWith(
      'UNIDMSP',
      EXAMPLE_ORGANIZATION_ROLE_LICENSE.id,
      expect.objectContaining({ data: [{ sector: 'animal-care', active: true }] }),
    );
  });

  it('serializes UpsertSectorPolicy as the chaincode policy JSON contract', async () => {
    const manager = new ManageAssetRoleLicense();
    const submit = jest.spyOn(manager, 'submit').mockResolvedValue({} as any);
    await manager.upsertSectorPolicy(
      'UNIDMSP',
      EXAMPLE_ORGANIZATION_ROLE_LICENSE.id,
      { sector: 'animal-care', active: true, maxDevices: 5 },
      20,
    );
    expect(submit).toHaveBeenCalledWith(
      'UNIDMSP',
      'UpsertSectorPolicy',
      EXAMPLE_ORGANIZATION_ROLE_LICENSE.id,
      JSON.stringify({ sector: 'animal-care', active: true, maxDevices: 5 }),
      '20',
    );
  });
});
