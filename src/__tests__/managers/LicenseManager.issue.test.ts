import { mock, MockProxy } from 'jest-mock-extended';
import type { IVaultRepository } from '../../database/repositories/vault/vault.repository';
import { LicenseManager } from '../../managers/LicenseManager';

import type { JobRequest } from 'gdc-common-utils-ts/models/confidential-job';
import type { ConfidentialStorageDoc } from 'gdc-common-utils-ts/models/confidential-storage';
import type { ITenantsManager } from '../../managers/ITenantsManager';

// Flow contract: an employee invitation reserves one private device seat; the
// global role-licence ledger boundary is covered separately by its adapter tests.
describe('LicenseManager (_issue)', () => {
  let mockVaultRepository: MockProxy<IVaultRepository>;
  let manager: LicenseManager;
  const originalNetworkMode = process.env.NETWORK_MODE;

  beforeEach(() => {
    process.env.NETWORK_MODE = 'test';
    mockVaultRepository = mock<IVaultRepository>();
    const tenants = mock<ITenantsManager>();
    tenants.tenantExists.mockResolvedValue(true);
    tenants.getOrganizationIdentifierUrn.mockResolvedValue('urn:org:tax:ES-B12345678');
    manager = new LicenseManager(mockVaultRepository, undefined, tenants);
  });

  afterAll(() => {
    if (originalNetworkMode === undefined) delete process.env.NETWORK_MODE;
    else process.env.NETWORK_MODE = originalNetworkMode;
  });

  it('should reserve one available license and return an activation code', async () => {
    const tenantId = 'acme';
    const sector = 'health-care';
    const tenantVaultId = `${sector}_${tenantId}`;

    const licenseDoc: ConfidentialStorageDoc = {
      id: 'license-available-1',
      status: 'available',
      sequence: 0,
      content: {
        id: 'license-available-1',
        tenantId,
        userClass: 'employee',
        type: 'mobile',
        status: 'available',
        maxDevices: 5,
        exp: Math.floor(Date.now() / 1000) + 3600,
      } as any,
    };

    mockVaultRepository.vaultExists.mockResolvedValue(true);
    mockVaultRepository.getContainersInSection.mockResolvedValue([licenseDoc as any]);
    mockVaultRepository.put.mockResolvedValue(true);

    const job: JobRequest = {
      id: 'job-1',
      sequence: 0,
      status: 'DRAFT' as any,
      createdAtTimestamp: Date.now(),
      tenantId,
      sector: sector as any,
      jurisdiction: 'ES',
      section: 'identity',
      format: 'openid' as any,
      resourceType: 'License',
      action: '_issue',
      content: {
        thid: 'thid-1',
        iss: 'did:web:api.acme.org:employee:admin1@acme.org',
        aud: 'did:web:api.acme.org',
        type: 'application/json',
        body: {
          resourceType: 'Bundle',
          type: 'batch',
          data: [
            {
              type: 'EmployeeLicenseInvitation-v1.0',
              meta: {
                subjectId: 'employee-123',
              },
              resource: {
                resourceType: 'License',
                meta: { claims: {
                  '@context': 'org.schema',
                  'org.schema.Person.email': 'doctor1@acme.org',
                  'org.schema.Person.hasOccupation': 'ISCO-08|2211',
                  'org.schema.IndividualProduct.category': 'professional',
                  'org.schema.IndividualProduct.additionalType': 'mobile',
                } },
              },
              request: { method: 'POST', url: '/acme/cds-ES/v1/health-care/identity/openid/License/_issue' },
            },
          ],
        },
      } as any,
    };

    const resp = await manager.process(job);
    const code = (resp.body as any)?.data?.[0]?.id;
    expect(typeof code).toBe('string');
    expect(code).toMatch(/^lic-/);
    expect((resp.body as any)?.data?.[0]?.meta?.maxDevices).toBe(5);

    expect(mockVaultRepository.put).toHaveBeenCalledTimes(1);
    const [, docs] = mockVaultRepository.put.mock.calls[0];
    const updated = docs[0] as ConfidentialStorageDoc;
    expect(updated.status).toBe('issued');
    expect((updated.content as any).status).toBe('issued');
    expect((updated.content as any).activationCode).toMatch(/^lic-/);
    expect((updated.content as any).issuedToEmail).toBe('doctor1@acme.org');
    expect((updated.content as any).subjectId).toBe('employee-123');
    expect((updated.content as any).ownerOrganizationId).toBe('urn:org:tax:ES-B12345678');
    expect((updated.content as any).activatedBy).toMatch(/^urn:multibase:z/);
    expect((resp.body as any)?.data?.[0]?.meta?.subjectId).toBe('employee-123');

    const missingSubjectJob = structuredClone(job);
    delete (missingSubjectJob.content as any).body.data[0].meta.subjectId;
    const rejected = await manager.process(missingSubjectJob);
    expect((rejected.body as any)?.data?.[0]?.response?.status).toBe('400');
    expect((rejected.body as any)?.data?.[0]?.response?.outcome?.issue?.[0]?.diagnostics)
      .toContain('meta.subjectId');
  });
});
