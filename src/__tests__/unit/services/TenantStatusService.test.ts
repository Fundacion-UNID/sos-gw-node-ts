import { jest } from '@jest/globals';
import { TenantStatusService } from '../../../services/TenantStatusService';
import type { IDiscoveryTenantRegistry } from '../../../managers/IDiscoveryTenantRegistry';
import type { IVaultRepository } from '../../../database/repositories/vault/vault.repository';
import type { IKmsService } from '../../../gdc-backend-utils-node/models/IKmsService';

const TENANT_VAULT_ID = 'onehealth-research_VATES-EXAMPLE';
const TENANT_COLLECTION = 'tenant-collection-example';
const TENANT_DID = 'did:web:gateway.example:VATES-EXAMPLE:cds-ES:v1:onehealth-research';
const CONTROLLER_DID = `${TENANT_DID}:employee:zExample:RESPRSN`;
const CONTROLLER_KID = 'urn:jwk:sha-256:example-controller-key';
const ACTOR_IDENTIFIER = 'urn:multibase:zExampleActor';

describe('TenantStatusService', () => {
  const tenants = {
    getTenant: jest.fn(),
    getCollectionName: jest.fn(async () => TENANT_COLLECTION),
  } as unknown as jest.Mocked<IDiscoveryTenantRegistry>;
  const vaultRepository = {
    getContainersInSection: jest.fn(),
  } as unknown as jest.Mocked<IVaultRepository>;
  const kmsService = {
    unprotectConfidentialData: jest.fn(async (document: any) => document.content),
  } as unknown as jest.Mocked<IKmsService>;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('reports required when the tenant has no authoritative controller binding', async () => {
    tenants.getTenant.mockResolvedValue({
      status: 'active',
      didDocument: { id: TENANT_DID, controller: null },
    });
    vaultRepository.getContainersInSection.mockResolvedValue([]);

    const status = await new TenantStatusService(tenants, vaultRepository, kmsService).build(TENANT_VAULT_ID);

    expect(status).toEqual(expect.objectContaining({
      tenant: expect.objectContaining({ controllerBindingStatus: 'required' }),
      controllers: [],
    }));
  });

  it('separates issued controller keys from a completed DCR', async () => {
    tenants.getTenant.mockResolvedValue({
      status: 'active',
      didDocument: { id: TENANT_DID, controller: [CONTROLLER_DID] },
    });
    const employeeDocument = {
      id: CONTROLLER_DID,
      status: 'active',
      sequence: 0,
      content: {
        claims: { 'org.schema.Person.sameAs': ACTOR_IDENTIFIER },
        didDocument: {
          id: CONTROLLER_DID,
          verificationMethod: [{
            id: `${CONTROLLER_DID}#controller-key`,
            type: 'JsonWebKey2020',
            controller: CONTROLLER_DID,
            publicKeyJwk: { kty: 'EC', crv: 'P-384', x: 'x', y: 'y', kid: CONTROLLER_KID, alg: 'ES384' },
          }],
          authentication: [`${CONTROLLER_DID}#controller-key`],
        },
      },
    };
    (vaultRepository.getContainersInSection as any).mockImplementation(async (_scope: string, section: string) => (
      String(section).endsWith('employees') ? [employeeDocument] : []
    ));

    const status = await new TenantStatusService(tenants, vaultRepository, kmsService).build(TENANT_VAULT_ID);

    expect(status?.tenant.controllerBindingStatus).toBe('credential_issued');
    expect(status?.controllers[0]).toEqual(expect.objectContaining({
      did: CONTROLLER_DID,
      status: 'credential_issued',
      kids: [expect.objectContaining({ kid: CONTROLLER_KID, alg: 'ES384', purpose: ['authentication'] })],
    }));
  });

  it('resolves a legacy employee container by its embedded controller DID', async () => {
    tenants.getTenant.mockResolvedValue({
      status: 'active',
      didDocument: { id: TENANT_DID, controller: [CONTROLLER_DID] },
    });
    const employeeDocument = {
      id: 'legacy-representative-record-id',
      status: 'active',
      sequence: 0,
      content: {
        claims: { 'org.schema.Person.sameAs': ACTOR_IDENTIFIER },
        didDocument: {
          id: CONTROLLER_DID,
          verificationMethod: [{
            id: `${CONTROLLER_DID}#controller-key`,
            type: 'JsonWebKey2020',
            controller: CONTROLLER_DID,
            publicKeyJwk: { kty: 'EC', crv: 'P-384', x: 'x', y: 'y', kid: CONTROLLER_KID, alg: 'ES384' },
          }],
          authentication: [`${CONTROLLER_DID}#controller-key`],
        },
      },
    };
    (vaultRepository.getContainersInSection as any).mockImplementation(async (_scope: string, section: string) => (
      String(section).endsWith('employees') ? [employeeDocument] : []
    ));

    const status = await new TenantStatusService(tenants, vaultRepository, kmsService).build(TENANT_VAULT_ID);

    expect(status?.tenant.controllerBindingStatus).toBe('credential_issued');
    expect(status?.controllers[0]).toEqual(expect.objectContaining({
      did: CONTROLLER_DID,
      status: 'credential_issued',
      kids: [expect.objectContaining({ kid: CONTROLLER_KID })],
    }));

    const resolved = await new TenantStatusService(tenants, vaultRepository, kmsService)
      .resolveControllerDidDocument(TENANT_VAULT_ID, 'zExample', 'RESPRSN');
    expect(resolved?.id).toBe(CONTROLLER_DID);
  });

  it('reports dcr_active only when the same controller actor has an active device binding', async () => {
    tenants.getTenant.mockResolvedValue({
      status: 'active',
      didDocument: { id: TENANT_DID, controller: CONTROLLER_DID },
    });
    (vaultRepository.getContainersInSection as any).mockImplementation(async (_scope: string, section: string) => {
      if (String(section).endsWith('employees')) {
        return [{
          id: CONTROLLER_DID,
          status: 'active',
          sequence: 0,
          content: {
            claims: { 'org.schema.Person.sameAs': ACTOR_IDENTIFIER },
            didDocument: { id: CONTROLLER_DID, verificationMethod: [] },
          },
        }];
      }
      if (String(section).endsWith('device-licenses')) {
        return [{
          id: 'license-example',
          status: 'active',
          sequence: 1,
          content: {
            status: 'active',
            activatedBy: ACTOR_IDENTIFIER,
            deviceBindings: [{ status: 'active' }],
          },
        }];
      }
      return [];
    });

    const status = await new TenantStatusService(tenants, vaultRepository, kmsService).build(TENANT_VAULT_ID);

    expect(status?.tenant.controllerBindingStatus).toBe('dcr_active');
    expect(status?.controllers[0]?.status).toBe('dcr_active');
  });

  it('decrypts a protected active device licence before projecting dcr_active', async () => {
    tenants.getTenant.mockResolvedValue({
      status: 'active',
      didDocument: { id: TENANT_DID, controller: CONTROLLER_DID },
    });
    const protectedLicense = {
      id: 'protected-license-example',
      status: 'active',
      sequence: 1,
      jwe: { protected: 'header', ciphertext: 'ciphertext', iv: 'iv', tag: 'tag' },
    };
    (vaultRepository.getContainersInSection as any).mockImplementation(async (_scope: string, section: string) => {
      if (String(section).endsWith('employees')) {
        return [{
          id: CONTROLLER_DID,
          status: 'active',
          sequence: 0,
          content: {
            claims: { 'org.schema.Person.sameAs': ACTOR_IDENTIFIER },
            didDocument: { id: CONTROLLER_DID, verificationMethod: [] },
          },
        }];
      }
      return String(section).endsWith('device-licenses') ? [protectedLicense] : [];
    });
    kmsService.unprotectConfidentialData.mockImplementation(async (document: any) => (
      document.id === protectedLicense.id
        ? { status: 'active', activatedBy: ACTOR_IDENTIFIER, deviceId: 'registered-client' }
        : document.content
    ));

    const status = await new TenantStatusService(tenants, vaultRepository, kmsService).build(TENANT_VAULT_ID);

    expect(status?.tenant.controllerBindingStatus).toBe('dcr_active');
    expect(status?.controllers[0]?.status).toBe('dcr_active');
  });
});
