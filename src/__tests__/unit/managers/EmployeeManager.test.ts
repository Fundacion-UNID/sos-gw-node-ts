// Flow contract: reuse shared test fixtures and canonical types; do not introduce duplicated literals.
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.
// File: src/__tests__/unit/managers/EmployeeManager.test.ts

/**
 * Flow contract: interactive employee onboarding requires an available seat
 * before identity creation. With no seat it returns an Offer; after Order
 * materialization, creation proceeds without consuming the seat that the
 * explicit License/_issue step must reserve. A future batch importer requires
 * a separate operation contract rather than a hidden Person claim.
 */
import { jest } from '@jest/globals';
import { mock, MockProxy } from 'jest-mock-extended';
import type { IVaultRepository } from '../../../database/repositories/vault/vault.repository';
import type { IKmsService } from '../../../gdc-backend-utils-node/models/IKmsService';
import {
  buildOrganizationAuthorizationUrnCds,
  buildOrganizationEmployeeAuthorizationUrnCds,
  FhirIpsCreatorKinds,
  OrganizationEmployeeSearchResponseEntryTypes,
} from 'gdc-common-utils-ts';
import { ClaimsOfferSchemaorg, ClaimsPersonSchemaorg } from 'gdc-common-utils-ts/constants/schemaorg';
import { RecordBase, ClaimsRecord } from 'gdc-common-utils-ts/models/resource-document';
import { JwkSet } from '../../../gdc-backend-utils-node/models/jwk';
import {
  testBaseJobForEmployeeClaims as testBaseJobForEmployeeClaims,
  testClaimsTenant1Nurse1,
  testClaimsTenant1Receptionist1,
} from '../../data/employee.data';
import { JobRequest } from 'gdc-common-utils-ts/models/confidential-job';
import { ConfidentialStorageDoc } from 'gdc-common-utils-ts/models/confidential-storage';
import type { TenantsCacheManager } from '../../../managers/TenantsCacheManager';
import { EntityConfig } from '../../../gdc-backend-utils-node/models/entity';
import { normalizeCodeSystemAndValue } from '../../../utils/normalize-codeAndSystem';
import { DeviceLicense } from 'gdc-common-utils-ts/models/device-license';
import { getEnvSectionId } from '../../../utils/section-env';
import { EntityLifecycleStatus, EntityType } from '../../../gdc-backend-utils-node/models/enums';
import { EXAMPLE_DEVICE_LICENSE_AVAILABLE } from 'gdc-common-utils-ts/examples/license';
import { EXAMPLE_JURISDICTION, EXAMPLE_SECTOR, EXAMPLE_TENANT_IDENTIFIER } from 'gdc-common-utils-ts/examples/shared';
import {
  SearchResponseProfileEnvironment,
  SearchResponseProfiles,
} from '../../../utils/didcomm-response';
import { buildStableActorIdentifier } from 'gdc-common-utils-ts/utils/actor-identifier';
import { getClinicalCreatorBindingsSectionId } from '../../../utils/clinical-creator-binding';
import { HealthcareActorRoles } from 'gdc-common-utils-ts/constants/healthcare';

const uuidMock = {
  v4: jest.fn(),
  validate: jest.fn(),
};

jest.unstable_mockModule('uuid', () => uuidMock);

const { v4: uuidv4 } = await import('uuid');
const { EmployeeManager } = await import('../../../managers/EmployeeManager');

describe('EmployeeManager', () => {
  let employeeManager: InstanceType<typeof EmployeeManager>;
  let mockVaultRepository: MockProxy<IVaultRepository>;
  let mockKmsService: MockProxy<IKmsService>;
  let mockTenantsCacheManager: MockProxy<TenantsCacheManager>;

  const mockJwkSet: JwkSet = { keys: [] };
  const MOCKED_OCCUPATION_UUID = '00112233-4455-6677-8899-aabbccddeeff';
  const TENANT_ALTERNATE_NAME = EXAMPLE_TENANT_IDENTIFIER;
  const TENANT_SECTOR = EXAMPLE_SECTOR;
  const TENANT_VAULT_ID = `${TENANT_SECTOR}_${TENANT_ALTERNATE_NAME}`;
  const TENANT_URN = `urn:antifraud:soschain-test:${EXAMPLE_JURISDICTION.toLowerCase()}:v1:${TENANT_SECTOR}:entity:tax:123456789`;
  const HOST_COLLECTION_NAME = 'host-collection';
  const HOST_DID = 'did:web:host.example.com';

  beforeEach(() => {
    mockVaultRepository = mock<IVaultRepository>();
    mockKmsService = mock<IKmsService>();
    mockTenantsCacheManager = mock<TenantsCacheManager>();
    employeeManager = new EmployeeManager(
      mockVaultRepository,
      mockKmsService,
      mockTenantsCacheManager,
      mockTenantsCacheManager,
      {
        hostCollectionName: HOST_COLLECTION_NAME,
        hostDid: HOST_DID,
      },
    );
    (uuidv4 as jest.Mock).mockReturnValue(MOCKED_OCCUPATION_UUID);
    jest.clearAllMocks();

    const availableLicense = structuredClone(EXAMPLE_DEVICE_LICENSE_AVAILABLE) as DeviceLicense;
    mockVaultRepository.getContainersInSection.mockResolvedValue([
      { id: availableLicense.id, sequence: 0, content: availableLicense } as unknown as ConfidentialStorageDoc,
    ]);

    mockKmsService.protectConfidentialData.mockImplementation(
      async (doc: ConfidentialStorageDoc, entityId: string): Promise<ConfidentialStorageDoc> => {
        const secureDoc = { ...doc, jwe: { ciphertext: 'encrypted-content' } };
        delete secureDoc.content;
        return secureDoc;
      },
    );
    mockKmsService.unprotectConfidentialData.mockImplementation(
      async <T>(doc: ConfidentialStorageDoc): Promise<T> => {
        if ((doc as any).content !== undefined) {
          return (doc as any).content as T;
        }
        return doc as unknown as T;
      },
    );
    
    // Mock for the new secure indexing flow
    mockKmsService.protectAttributesNameAndValue.mockImplementation(async (attributes) => {
      return attributes.map(attr => ({
        name: `hmac(${attr.name})`,
        value: `hmac(${attr.value})`,
        unique: attr.unique,
      }));
    });
  });

  describe('Employee Creation (POST)', () => {
    it('returns an Offer without creating the employee when no licensed seat exists', async () => {
      const job = testBaseJobForEmployeeClaims(testClaimsTenant1Receptionist1, TENANT_ALTERNATE_NAME, TENANT_SECTOR);
      mockTenantsCacheManager.getTenantIdentifierUrn.mockResolvedValue(TENANT_URN);
      mockVaultRepository.getContainersInSection.mockResolvedValue([]);

      const response = await employeeManager.process(job);

      const entry = response.body.data[0] as any;
      expect(entry.type).toBe('Employee-license-offer-v1.0');
      expect(entry.resource.meta.claims[ClaimsOfferSchemaorg.identifier]).toBeDefined();
      expect(entry.resource.meta.claims[ClaimsOfferSchemaorg.category]).toBe(TENANT_SECTOR);
      expect(entry.resource.meta.claims[ClaimsOfferSchemaorg.identifier]).toContain(`:${EXAMPLE_JURISDICTION}:v1:${EXAMPLE_SECTOR}:`);
      expect(mockVaultRepository.put).toHaveBeenCalledWith(
        HOST_COLLECTION_NAME,
        expect.any(Array),
        getEnvSectionId('communications'),
      );
      const persistedOffer = (mockVaultRepository.put as any).mock.calls[0][1][0] as ConfidentialStorageDoc;
      expect(persistedOffer.indexed?.attributes?.find(
        (attribute) => attribute.name === ClaimsOfferSchemaorg.identifier,
      )?.value).toBe(entry.resource.meta.claims[ClaimsOfferSchemaorg.identifier]);
      expect(mockKmsService.provisionKeys).not.toHaveBeenCalled();
    });

    it('should create employee, index kids securely, and save protected documents', async () => {
      // ARRANGE
      const job = testBaseJobForEmployeeClaims(testClaimsTenant1Receptionist1, TENANT_ALTERNATE_NAME, TENANT_SECTOR);
      mockVaultRepository.put.mockResolvedValue(true);
      mockTenantsCacheManager.getTenantIdentifierUrn.mockResolvedValue(TENANT_URN);
      mockTenantsCacheManager.getEntityClaims.mockResolvedValue({});

      // ACT
      const response = await employeeManager.process(job);

      // ASSERT
      expect(mockTenantsCacheManager.getTenantIdentifierUrn).toHaveBeenCalledWith(TENANT_VAULT_ID);

      // Verify that all expected attributes were sent to be protected for indexing
      const signerKid = job.content?.meta?.jws?.protected?.jwk?.kid;
      const encrypterKid = job.content?.meta?.jwe?.header?.jwk?.kid;
      const email = testClaimsTenant1Receptionist1[ClaimsPersonSchemaorg.email];
      const roleCode = testClaimsTenant1Receptionist1[ClaimsPersonSchemaorg.hasOccupation];

      expect(mockKmsService.protectAttributesNameAndValue).toHaveBeenNthCalledWith(
        2,
        [
          { name: 'email', value: email, unique: true, type: 'string'},
          { name: 'role', value: normalizeCodeSystemAndValue(roleCode as string), unique: false, type: 'token'},
          { name: 'kid', value: signerKid, unique: false, type: 'string'},
          { name: 'kid', value: encrypterKid, unique: false, type: 'string'},
        ],
        TENANT_VAULT_ID
      );
      
      const docToProtect = mockKmsService.protectConfidentialData.mock.calls[0][0];
      const employeeConfig = docToProtect.content as EntityConfig;

      expect(employeeConfig.didDocument!.id).toMatch(
        new RegExp(`^${TENANT_URN}:employee:z[1-9A-HJ-NP-Za-km-z]+:role:isco-08\\|4226:instance:${MOCKED_OCCUPATION_UUID}$`)
      );
      expect(employeeConfig.didDocument!.alsoKnownAs).toContain(
        buildOrganizationEmployeeAuthorizationUrnCds({
          organizationUrn: buildOrganizationAuthorizationUrnCds({
            jurisdiction: EXAMPLE_JURISDICTION,
            identifierType: 'tax',
            identifierValue: '123456789',
          }),
          employeeUuid: MOCKED_OCCUPATION_UUID,
          roleCode: String(roleCode).split('|').pop()!,
        }),
      );

      // Verify that the protected indexes from the mock were added to the document
      expect(docToProtect.indexed?.attributes).toHaveLength(4);
      expect(docToProtect.indexed?.attributes[0].name).toBe('hmac(email)');
      
      const savedDocs = mockVaultRepository.put.mock.calls[0][1] as (RecordBase | ConfidentialStorageDoc)[];
      expect(savedDocs).toHaveLength(2);
      const secureEmployeeDoc = savedDocs.find(
        doc => (doc as ConfidentialStorageDoc).jwe,
      ) as ConfidentialStorageDoc | undefined;
      expect(secureEmployeeDoc).toBeDefined();
      expect(secureEmployeeDoc!.content).toBeUndefined();

      expect(response.body.data[0].response.status).toBe('201');
      expect(response.iss).toBe(TENANT_URN);
    });

    it('preauthorizes the employee and occupation UUIDs as one stable professional creator', async () => {
      const employeeUuid = '31b2c3d4-e5f6-7890-1234-567890abcdef';
      const occupationUuid = '41b2c3d4-e5f6-7890-1234-567890abcdef';
      const providerDid = 'did:web:provider.example.com';
      const clinicalClaims = {
        ...testClaimsTenant1Receptionist1,
        [ClaimsPersonSchemaorg.hasOccupation]: HealthcareActorRoles.Veterinarian,
      };
      const job = testBaseJobForEmployeeClaims(
        clinicalClaims,
        TENANT_ALTERNATE_NAME,
        TENANT_SECTOR,
      );
      (job.content as any).aud = providerDid;
      ((job.content as any).body.data[0] as any).resource.id = employeeUuid;
      (uuidv4 as jest.Mock).mockReturnValue(occupationUuid);
      mockVaultRepository.put.mockResolvedValue(true);
      mockTenantsCacheManager.getTenantIdentifierUrn.mockResolvedValue(TENANT_URN);

      await employeeManager.process(job);

      expect(mockVaultRepository.put).toHaveBeenNthCalledWith(
        2,
        TENANT_VAULT_ID,
        [{
          id: `urn:uuid:${occupationUuid}`,
          kind: FhirIpsCreatorKinds.Professional,
          actorIdentifier: `urn:uuid:${employeeUuid}`,
          authorIdentifier: `urn:uuid:${occupationUuid}`,
          ownerIdentifier: buildOrganizationAuthorizationUrnCds({
            jurisdiction: EXAMPLE_JURISDICTION.toLowerCase(),
            version: 'v1',
            identifierType: 'tax',
            identifierValue: '123456789',
          }),
          role: HealthcareActorRoles.Veterinarian,
          verifiedContactIdentifiers: [buildStableActorIdentifier({
            contactKind: 'email',
            contact: testClaimsTenant1Receptionist1[ClaimsPersonSchemaorg.email],
          })],
        }],
        getClinicalCreatorBindingsSectionId(),
      );
    });

    it('does not create an IPS creator binding for an occupational role outside the governed clinical catalog', async () => {
      const claims = { ...testClaimsTenant1Receptionist1, [ClaimsPersonSchemaorg.hasOccupation]: 'ISCO-08|9999' };
      const job = testBaseJobForEmployeeClaims(claims, TENANT_ALTERNATE_NAME, TENANT_SECTOR);
      (job.content as any).aud = 'did:web:provider.example.com';
      ((job.content as any).body.data[0] as any).resource.id = '31b2c3d4-e5f6-7890-1234-567890abcdef';
      mockVaultRepository.put.mockResolvedValue(true);
      mockTenantsCacheManager.getTenantIdentifierUrn.mockResolvedValue(TENANT_URN);

      await employeeManager.process(job);

      expect(mockVaultRepository.put).not.toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        getClinicalCreatorBindingsSectionId(),
      );
    });

    it('should leave seat issuance to the following License operation', async () => {
      const job = testBaseJobForEmployeeClaims(testClaimsTenant1Receptionist1, TENANT_ALTERNATE_NAME, TENANT_SECTOR);
      mockTenantsCacheManager.getTenantIdentifierUrn.mockResolvedValue(TENANT_URN);
      mockTenantsCacheManager.getTenantDid.mockResolvedValue('did:web:host.example.com');

      const availableLicense = structuredClone(EXAMPLE_DEVICE_LICENSE_AVAILABLE) as DeviceLicense;
      mockVaultRepository.getContainersInSection.mockResolvedValueOnce([
        { id: availableLicense.id, sequence: 0, content: availableLicense } as unknown as ConfidentialStorageDoc,
      ]);

      const response = await employeeManager.process(job);

      expect((response.body.data[0] as any).response.status).toBe('201');
      expect(mockVaultRepository.getContainersInSection).toHaveBeenCalledWith(
        TENANT_VAULT_ID,
        getEnvSectionId('device-licenses'),
      );
      expect(mockVaultRepository.put).toHaveBeenCalledTimes(2);
    });

    it('should not consume an available employee license before the explicit License issue step', async () => {
      const job = testBaseJobForEmployeeClaims(testClaimsTenant1Receptionist1, TENANT_ALTERNATE_NAME, TENANT_SECTOR);
      mockVaultRepository.put.mockResolvedValue(true);
      mockTenantsCacheManager.getTenantIdentifierUrn.mockResolvedValue(TENANT_URN);
      mockTenantsCacheManager.getEntityClaims.mockResolvedValue({});

      const availableLicense = structuredClone(EXAMPLE_DEVICE_LICENSE_AVAILABLE) as DeviceLicense;
      mockVaultRepository.getContainersInSection.mockResolvedValueOnce([
        { id: availableLicense.id, sequence: 0, content: availableLicense } as unknown as ConfidentialStorageDoc,
      ]);

      const response = await employeeManager.process(job);

      expect(mockVaultRepository.put).toHaveBeenCalledTimes(2);
      expect(mockVaultRepository.getContainersInSection).toHaveBeenCalledWith(
        TENANT_VAULT_ID,
        getEnvSectionId('device-licenses'),
      );
      expect(response.body.data[0].response.status).toBe('201');
    });

    it('should return the existing active employee for the same email and role without consuming another license', async () => {
      const job = testBaseJobForEmployeeClaims(testClaimsTenant1Receptionist1, TENANT_ALTERNATE_NAME, TENANT_SECTOR);
      mockTenantsCacheManager.getTenantIdentifierUrn.mockResolvedValue(TENANT_URN);

      const existingEmployee: EntityConfig = {
        id: 'existing-employee-id',
        type: EntityType.Person,
        status: EntityLifecycleStatus.Active,
        claims: testClaimsTenant1Receptionist1,
        meta: { lastUpdated: '2026-05-25T00:00:00.000Z' },
      };
      const existingSecureDoc: ConfidentialStorageDoc = {
        id: existingEmployee.id,
        status: existingEmployee.status,
        sequence: 2,
        content: existingEmployee,
      };
      mockVaultRepository.query.mockResolvedValue([existingSecureDoc]);
      mockVaultRepository.put.mockResolvedValue(true);

      const response = await employeeManager.process(job);

      expect(mockVaultRepository.query).toHaveBeenCalledTimes(1);
      expect(mockVaultRepository.put).not.toHaveBeenCalled();
      expect(response.body.data[0].response.status).toBe('200');
      expect((response.body.data[0] as any).resource.id).toBe(existingEmployee.id);
    });

    it('should reactivate an existing inactive employee for the same email and role without consuming another license', async () => {
      const job = testBaseJobForEmployeeClaims(testClaimsTenant1Receptionist1, TENANT_ALTERNATE_NAME, TENANT_SECTOR);
      mockTenantsCacheManager.getTenantIdentifierUrn.mockResolvedValue(TENANT_URN);

      const existingEmployee: EntityConfig = {
        id: 'inactive-employee-id',
        type: EntityType.Person,
        status: EntityLifecycleStatus.Inactive,
        claims: testClaimsTenant1Receptionist1,
        meta: { lastUpdated: '2026-05-24T00:00:00.000Z' },
      };
      const existingSecureDoc: ConfidentialStorageDoc = {
        id: existingEmployee.id,
        status: existingEmployee.status,
        sequence: 3,
        content: existingEmployee,
      };
      mockVaultRepository.query.mockResolvedValue([existingSecureDoc]);
      mockVaultRepository.put.mockResolvedValue(true);

      const response = await employeeManager.process(job);

      expect(mockVaultRepository.put).toHaveBeenCalledTimes(1);
      const updatedDocs = mockVaultRepository.put.mock.calls[0][1] as ConfidentialStorageDoc[];
      expect(updatedDocs[0].sequence).toBe(4);
      expect(updatedDocs[0].status).toBe(EntityLifecycleStatus.Active);
      expect(response.body.data[0].response.status).toBe('200');
      expect((response.body.data[0] as any).resource.id).toBe(existingEmployee.id);
    });

    it('should create a brand new employee after purge for the same email and role', async () => {
      const job = testBaseJobForEmployeeClaims(testClaimsTenant1Receptionist1, TENANT_ALTERNATE_NAME, TENANT_SECTOR);
      mockVaultRepository.put.mockResolvedValue(true);
      mockTenantsCacheManager.getTenantIdentifierUrn.mockResolvedValue(TENANT_URN);
      mockTenantsCacheManager.getEntityClaims.mockResolvedValue({});

      const purgedEmployee: EntityConfig = {
        id: 'historical-employee-id',
        type: EntityType.Person,
        status: EntityLifecycleStatus.Inactive,
        claims: testClaimsTenant1Receptionist1,
        didDocument: { id: `${TENANT_URN}:employee:old`, service: [] } as any,
        didConfig: { service: [] },
        meta: {
          lastUpdated: '2026-05-20T00:00:00.000Z',
          lifecycleDisposition: 'purged',
          licensingPurgedAt: '2026-05-20T00:00:00.000Z',
        },
      };
      const purgedSecureDoc: ConfidentialStorageDoc = {
        id: purgedEmployee.id,
        status: purgedEmployee.status,
        sequence: 8,
        content: purgedEmployee,
      };
      mockVaultRepository.query.mockResolvedValue([purgedSecureDoc]);

      const response = await employeeManager.process(job);

      expect(mockVaultRepository.put).toHaveBeenCalledTimes(2);
      const docToProtect = mockKmsService.protectConfidentialData.mock.calls.at(-1)?.[0] as ConfidentialStorageDoc;
      const createdEmployee = docToProtect.content as EntityConfig;
      expect(createdEmployee.id).toBe(MOCKED_OCCUPATION_UUID);
      expect(createdEmployee.didDocument?.id).not.toBe(purgedEmployee.didDocument?.id);
      expect(createdEmployee.didDocument?.id).toContain(':instance:');
      expect(response.body.data[0].response.status).toBe('201');
    });
  });

  describe('Employee Deactivation (DELETE)', () => {
    it('rejects a wildcard resource id instead of expanding an implicit all-employees operation', async () => {
      const job = testBaseJobForEmployeeClaims(testClaimsTenant1Receptionist1, TENANT_ALTERNATE_NAME, TENANT_SECTOR);
      job.content!.body!.data[0].request.method = 'DELETE';
      // The wildcard literal is the forbidden wire value under test.
      job.content!.body!.data[0].resource!.id = '*';
      mockTenantsCacheManager.getTenantIdentifierUrn.mockResolvedValue(TENANT_URN);

      const response = await employeeManager.process(job);

      expect(response.body.data[0].response.status).toBe('400');
      expect(response.body.data[0].response.outcome.issue[0].diagnostics).toContain('explicit resource.id');
      expect(mockVaultRepository.get).not.toHaveBeenCalled();
    });

    it('should suspend the employee using resource.id without releasing or mutating device licenses', async () => {
      const job = testBaseJobForEmployeeClaims(testClaimsTenant1Receptionist1, TENANT_ALTERNATE_NAME, TENANT_SECTOR);
      job.content!.body!.data[0].request.method = 'DELETE';
      job.content!.body!.data[0].resource!.id = 'employee-to-disable';
      mockTenantsCacheManager.getTenantIdentifierUrn.mockResolvedValue(TENANT_URN);

      const existingEmployee: EntityConfig = {
        id: 'employee-to-disable',
        type: EntityType.Person,
        status: EntityLifecycleStatus.Active,
        claims: testClaimsTenant1Receptionist1,
        meta: { lastUpdated: '2026-05-25T00:00:00.000Z' },
      };
      const existingSecureDoc: ConfidentialStorageDoc = {
        id: existingEmployee.id,
        status: existingEmployee.status,
        sequence: 1,
        content: existingEmployee,
      };

      mockVaultRepository.get.mockResolvedValue(existingSecureDoc);
      mockVaultRepository.put.mockResolvedValue(true);

      const response = await employeeManager.process(job);

      expect(mockVaultRepository.get).toHaveBeenCalledWith(
        TENANT_VAULT_ID,
        'employee-to-disable',
        getEnvSectionId('employees'),
      );
      expect(mockVaultRepository.getContainersInSection).not.toHaveBeenCalledWith(
        TENANT_VAULT_ID,
        getEnvSectionId('device-licenses'),
      );
      const updatedDocs = mockVaultRepository.put.mock.calls[0][1] as ConfidentialStorageDoc[];
      expect(updatedDocs[0].status).toBe(EntityLifecycleStatus.Inactive);
      expect(response.body.data[0].response.status).toBe('200');
    });
  });

  describe('Employee Search', () => {
    beforeEach(() => {
      process.env[SearchResponseProfileEnvironment.Variable] = SearchResponseProfiles.PrimaryResource;
    });

    afterEach(() => {
      delete process.env[SearchResponseProfileEnvironment.Variable];
    });

    it('keeps disabled employees visible but excludes terminal purge markers', async () => {
      const job = testBaseJobForEmployeeClaims(testClaimsTenant1Receptionist1, TENANT_ALTERNATE_NAME, TENANT_SECTOR);
      job.action = '_search';
      job.content!.body = {
        resourceType: 'Bundle',
        type: 'batch',
        entry: [{ request: { method: 'POST', url: 'Employee/_search' }, resource: { resourceType: 'Parameters' } }],
      } as any;
      mockTenantsCacheManager.getTenantIdentifierUrn.mockResolvedValue(TENANT_URN);
      mockTenantsCacheManager.getCollectionName.mockResolvedValue('physical-tenant-collection');
      mockVaultRepository.getContainersInSection.mockResolvedValue([
        {
          id: 'employee-disabled',
          status: EntityLifecycleStatus.Inactive,
          sequence: 2,
          content: {
            id: 'employee-disabled',
            type: EntityType.Person,
            status: EntityLifecycleStatus.Inactive,
            claims: testClaimsTenant1Receptionist1,
            meta: { lastUpdated: '2026-05-25T00:00:00.000Z' },
          },
        },
        {
          id: 'employee-purged',
          status: EntityLifecycleStatus.Inactive,
          sequence: 3,
          content: {
            id: 'employee-purged',
            type: EntityType.Person,
            status: EntityLifecycleStatus.Inactive,
            claims: testClaimsTenant1Nurse1,
            meta: { lifecycleDisposition: 'purged', purgedAt: '2026-05-26T00:00:00.000Z' },
          },
        },
      ] as ConfidentialStorageDoc[]);

      const response = await employeeManager.process(job);

      expect(response.body.total).toBe(1);
      expect((response.body.data[0] as any).resource.id).toBe('employee-disabled');
    });

    it('should search employees via Bundle entry.request.url filters', async () => {
      const job = testBaseJobForEmployeeClaims(testClaimsTenant1Receptionist1, TENANT_ALTERNATE_NAME, TENANT_SECTOR);
      job.action = '_search';
      job.content!.body = {
        resourceType: 'Bundle',
        type: 'batch',
        entry: [
          {
            request: {
              method: 'GET',
              url: `Employee?${ClaimsPersonSchemaorg.email}=${encodeURIComponent(String(testClaimsTenant1Receptionist1[ClaimsPersonSchemaorg.email]))}`,
            },
          },
        ],
      } as any;
      mockTenantsCacheManager.getTenantIdentifierUrn.mockResolvedValue(TENANT_URN);
      mockTenantsCacheManager.getCollectionName.mockResolvedValue('physical-tenant-collection');
      mockVaultRepository.getContainersInSection.mockResolvedValue([
        {
          id: MOCKED_OCCUPATION_UUID,
          type: 'Occupation',
          employeeId: 'employee-search-hit',
          meta: { claims: { [ClaimsPersonSchemaorg.hasOccupation]: HealthcareActorRoles.NursingProfessional } },
        } as any,
        {
          id: 'employee-search-hit',
          status: EntityLifecycleStatus.Active,
          sequence: 1,
          content: {
            id: 'employee-search-hit',
            type: EntityType.Person,
            status: EntityLifecycleStatus.Active,
            claims: testClaimsTenant1Receptionist1,
            meta: { lastUpdated: '2026-05-25T00:00:00.000Z' },
          } satisfies EntityConfig,
        } as ConfidentialStorageDoc,
        {
          id: 'employee-search-miss',
          status: EntityLifecycleStatus.Active,
          sequence: 1,
          content: {
            id: 'employee-search-miss',
            type: EntityType.Person,
            status: EntityLifecycleStatus.Active,
            claims: testClaimsTenant1Nurse1,
            meta: { lastUpdated: '2026-05-25T00:00:00.000Z' },
          } satisfies EntityConfig,
        } as ConfidentialStorageDoc,
      ]);

      const response = await employeeManager.process(job);

      expect(mockVaultRepository.getContainersInSection).toHaveBeenCalledWith(
        'physical-tenant-collection',
        getEnvSectionId('employees'),
      );
      expect(mockKmsService.unprotectConfidentialData).toHaveBeenCalledWith(
        expect.any(Object),
        TENANT_VAULT_ID,
      );
      expect(response.body.data[0].type).toBe(OrganizationEmployeeSearchResponseEntryTypes.Employee);
      expect(response.body.total).toBe(1);
      expect((response.body.data[0] as any).resource.id).toBe('employee-search-hit');
      expect((response.body.data[0] as any).resource.claims[ClaimsPersonSchemaorg.email]).toBe(
        testClaimsTenant1Receptionist1[ClaimsPersonSchemaorg.email],
      );
      expect((response.body.data[0] as any).resource.contained).toEqual([expect.objectContaining({
        id: MOCKED_OCCUPATION_UUID,
        type: 'Occupation',
      })]);
      expect((response.body.data[0] as any).resource.data).toBeUndefined();
    });

    it('should search employees via POST search entries carrying FHIR Parameters', async () => {
      const job = testBaseJobForEmployeeClaims(testClaimsTenant1Receptionist1, TENANT_ALTERNATE_NAME, TENANT_SECTOR);
      job.action = '_search';
      job.content!.body = {
        resourceType: 'Bundle',
        type: 'batch',
        entry: [
          {
            request: {
              method: 'POST',
              url: 'Employee/_search',
            },
            resource: {
              resourceType: 'Parameters',
              parameter: [
                {
                  name: ClaimsPersonSchemaorg.email,
                  valueString: String(testClaimsTenant1Receptionist1[ClaimsPersonSchemaorg.email]),
                },
              ],
            },
          },
        ],
      } as any;
      mockTenantsCacheManager.getTenantIdentifierUrn.mockResolvedValue(TENANT_URN);
      mockVaultRepository.getContainersInSection.mockResolvedValue([
        {
          id: 'employee-search-hit',
          status: EntityLifecycleStatus.Active,
          sequence: 1,
          content: {
            id: 'employee-search-hit',
            type: EntityType.Person,
            status: EntityLifecycleStatus.Active,
            claims: testClaimsTenant1Receptionist1,
            meta: { lastUpdated: '2026-05-25T00:00:00.000Z' },
          } satisfies EntityConfig,
        } as ConfidentialStorageDoc,
      ]);

      const response = await employeeManager.process(job);

      expect(response.body.data[0].type).toBe(OrganizationEmployeeSearchResponseEntryTypes.Employee);
      expect(response.body.total).toBe(1);
      expect((response.body.data[0] as any).resource.id).toBe('employee-search-hit');
      expect((response.body.data[0] as any).resource.data).toBeUndefined();
    });
  });

  describe('Employee Purge', () => {
    it('should purge the employee using resource.id even when the identifier claim is not a UUID', async () => {
      const job = testBaseJobForEmployeeClaims(testClaimsTenant1Receptionist1, TENANT_ALTERNATE_NAME, TENANT_SECTOR);
      job.action = '_purge';
      job.content!.body!.data[0].resource!.id = 'employee-to-purge';
      mockTenantsCacheManager.getTenantIdentifierUrn.mockResolvedValue(TENANT_URN);

      const existingEmployee: EntityConfig = {
        id: 'employee-to-purge',
        type: EntityType.Person,
        status: EntityLifecycleStatus.Inactive,
        claims: testClaimsTenant1Receptionist1,
        meta: { lastUpdated: '2026-05-25T00:00:00.000Z' },
      };
      const existingSecureDoc: ConfidentialStorageDoc = {
        id: existingEmployee.id,
        status: existingEmployee.status,
        sequence: 1,
        content: existingEmployee,
      };

      mockVaultRepository.get.mockResolvedValue(existingSecureDoc);
      mockVaultRepository.getContainersInSection.mockResolvedValue([]);
      mockVaultRepository.put.mockResolvedValue(true);

      const response = await employeeManager.process(job);

      expect(mockVaultRepository.get).toHaveBeenCalledWith(
        TENANT_VAULT_ID,
        'employee-to-purge',
        getEnvSectionId('employees'),
      );
      expect((response.body.data[0] as any).response.status).toBe('200');
      expect((response.body.data[0] as any).resource.id).toBe('employee-to-purge');
    });

    it('should reject purge unless the employee is already inactive', async () => {
      const job = testBaseJobForEmployeeClaims(testClaimsTenant1Receptionist1, TENANT_ALTERNATE_NAME, TENANT_SECTOR);
      job.action = '_purge';
      mockTenantsCacheManager.getTenantIdentifierUrn.mockResolvedValue(TENANT_URN);

      const existingEmployee: EntityConfig = {
        id: 'employee-to-purge',
        type: EntityType.Person,
        status: EntityLifecycleStatus.Active,
        claims: testClaimsTenant1Receptionist1,
        meta: { lastUpdated: '2026-05-25T00:00:00.000Z' },
      };
      const existingSecureDoc: ConfidentialStorageDoc = {
        id: existingEmployee.id,
        status: existingEmployee.status,
        sequence: 1,
        content: existingEmployee,
      };

      mockVaultRepository.get.mockResolvedValue(existingSecureDoc);

      const response = await employeeManager.process(job);
      const entry = response.body.data[0] as any;
      expect(entry.response.status).toBe('409');
      expect(entry.response.outcome.issue[0].diagnostics).toContain('disabled before purge');
    });

    it('should keep the employee record and release associated licenses on purge', async () => {
      const job = testBaseJobForEmployeeClaims(testClaimsTenant1Receptionist1, TENANT_ALTERNATE_NAME, TENANT_SECTOR);
      job.action = '_purge';
      mockTenantsCacheManager.getTenantIdentifierUrn.mockResolvedValue(TENANT_URN);

      const existingEmployee: EntityConfig = {
        id: 'employee-to-purge',
        type: EntityType.Person,
        status: EntityLifecycleStatus.Inactive,
        claims: testClaimsTenant1Receptionist1,
        meta: { lastUpdated: '2026-05-25T00:00:00.000Z' },
      };
      const existingSecureDoc: ConfidentialStorageDoc = {
        id: existingEmployee.id,
        status: existingEmployee.status,
        sequence: 1,
        content: existingEmployee,
      };
      const activeLicense: DeviceLicense = {
        id: 'license-1',
        tenantId: TENANT_ALTERNATE_NAME,
        orderId: 'order-1',
        userClass: 'employee',
        userCategory: 'default',
        type: 'mobile',
        status: 'active',
        plan: 'default',
        renewalCycle: '12m',
        reactivationEnabled: false,
        exp: Math.floor(Date.now() / 1000) + 3600,
        subjectId: 'employee-to-purge',
        activationCode: 'lic-123',
        issuedToEmail: String(testClaimsTenant1Receptionist1[ClaimsPersonSchemaorg.email]),
        issuedToRole: 'ISCO-08|4226',
      } as any;
      const licenseDoc: ConfidentialStorageDoc = {
        id: activeLicense.id,
        status: activeLicense.status,
        sequence: 2,
        content: activeLicense,
      };

      mockVaultRepository.get.mockResolvedValue(existingSecureDoc);
      mockVaultRepository.getContainersInSection.mockResolvedValue([licenseDoc]);
      mockVaultRepository.put.mockResolvedValue(true);

      const response = await employeeManager.process(job);

      expect(mockVaultRepository.put).toHaveBeenCalledTimes(2);
      const updatedLicenseDocs = mockVaultRepository.put.mock.calls[0][1] as ConfidentialStorageDoc[];
      expect(updatedLicenseDocs[0].status).toBe('available');
      expect((updatedLicenseDocs[0].content as any).activationCode).toBeUndefined();
      expect((updatedLicenseDocs[0].content as any).subjectId).toBeUndefined();

      const protectedEmployeeDocInput = mockKmsService.protectConfidentialData.mock.calls.at(-1)?.[0] as ConfidentialStorageDoc;
      expect((protectedEmployeeDocInput.content as any).meta.licensingPurgedAt).toBeDefined();
      expect((protectedEmployeeDocInput.content as any).meta.lifecycleDisposition).toBe('purged');
      const updatedEmployeeDocs = mockVaultRepository.put.mock.calls[1][1] as ConfidentialStorageDoc[];
      expect(updatedEmployeeDocs[0].status).toBe(EntityLifecycleStatus.Inactive);
      expect(response.body.data[0].response.status).toBe('200');
    });

    it('should return a per-entry conflict for active employees and purge disabled employees in the same bundle', async () => {
      const activeEmployeeId = String(testClaimsTenant1Receptionist1[ClaimsPersonSchemaorg.identifier]);
      const disabledEmployeeId = String(testClaimsTenant1Nurse1[ClaimsPersonSchemaorg.identifier]);
      const disableJob = testBaseJobForEmployeeClaims(testClaimsTenant1Nurse1, TENANT_ALTERNATE_NAME, TENANT_SECTOR);
      disableJob.content!.body!.data[0].request.method = 'DELETE';

      const purgeJob = testBaseJobForEmployeeClaims(testClaimsTenant1Receptionist1, TENANT_ALTERNATE_NAME, TENANT_SECTOR);
      purgeJob.action = '_purge';
      purgeJob.content!.body!.data = [
        {
          resource: { resourceType: 'Employee', meta: { claims: testClaimsTenant1Receptionist1 } },
          request: { method: 'POST' },
          type: 'Employee-purge-request-v1.0',
        },
        {
          resource: { resourceType: 'Employee', meta: { claims: testClaimsTenant1Nurse1 } },
          request: { method: 'POST' },
          type: 'Employee-purge-request-v1.0',
        },
      ] as any;

      mockTenantsCacheManager.getTenantIdentifierUrn.mockResolvedValue(TENANT_URN);

      const employeeDocs = new Map<string, ConfidentialStorageDoc>([
        [
          activeEmployeeId,
          {
            id: activeEmployeeId,
            status: EntityLifecycleStatus.Active,
            sequence: 1,
            content: {
              id: activeEmployeeId,
              type: EntityType.Person,
              status: EntityLifecycleStatus.Active,
              claims: testClaimsTenant1Receptionist1,
              meta: { lastUpdated: '2026-05-25T00:00:00.000Z' },
            } satisfies EntityConfig,
          } as ConfidentialStorageDoc,
        ],
        [
          disabledEmployeeId,
          {
            id: disabledEmployeeId,
            status: EntityLifecycleStatus.Active,
            sequence: 1,
            content: {
              id: disabledEmployeeId,
              type: EntityType.Person,
              status: EntityLifecycleStatus.Active,
              claims: testClaimsTenant1Nurse1,
              meta: { lastUpdated: '2026-05-25T00:00:00.000Z' },
            } satisfies EntityConfig,
          } as ConfidentialStorageDoc,
        ],
      ]);

      const licenseDocs = new Map<string, ConfidentialStorageDoc>([
        [
          'license-nurse-1',
          {
            id: 'license-nurse-1',
            status: 'active',
            sequence: 1,
            content: {
              id: 'license-nurse-1',
              tenantId: TENANT_ALTERNATE_NAME,
              orderId: 'order-1',
              userClass: 'employee',
              userCategory: 'default',
              type: 'mobile',
              status: 'active',
              plan: 'default',
              renewalCycle: '12m',
              reactivationEnabled: false,
              exp: Math.floor(Date.now() / 1000) + 3600,
              subjectId: disabledEmployeeId,
              activationCode: 'activation-code-1',
              issuedToEmail: String(testClaimsTenant1Nurse1[ClaimsPersonSchemaorg.email]),
              issuedToRole: String(testClaimsTenant1Nurse1[ClaimsPersonSchemaorg.hasOccupation]),
            } as any,
          } as ConfidentialStorageDoc,
        ],
      ]);

      mockVaultRepository.get.mockImplementation(async (_vaultId, id, sectionId) => {
        if (sectionId !== getEnvSectionId('employees')) return undefined as any;
        return employeeDocs.get(String(id)) as any;
      });
      mockVaultRepository.getContainersInSection.mockImplementation(async (_vaultId, sectionId) => {
        if (sectionId === getEnvSectionId('device-licenses')) {
          return Array.from(licenseDocs.values()) as any;
        }
        return [] as any;
      });
      mockVaultRepository.put.mockImplementation(async (_vaultId, docs, sectionId) => {
        if (sectionId === getEnvSectionId('employees')) {
          for (const doc of docs as unknown as ConfidentialStorageDoc[]) {
            employeeDocs.set(String(doc.id), doc);
          }
        }
        if (sectionId === getEnvSectionId('device-licenses')) {
          for (const doc of docs as unknown as ConfidentialStorageDoc[]) {
            licenseDocs.set(String(doc.id), doc);
          }
        }
        return true as any;
      });

      const disableResponse = await employeeManager.process(disableJob, 'demo');
      expect(disableResponse.body.data[0].response.status).toBe('200');

      const purgeResponse = await employeeManager.process(purgeJob, 'demo');
      const firstEntry = purgeResponse.body.data[0] as any;
      const secondEntry = purgeResponse.body.data[1] as any;

      expect(firstEntry.response.status).toBe('409');
      expect(firstEntry.response.outcome.issue[0].diagnostics).toContain('disabled before purge');
      expect(secondEntry.response.status).toBe('200');
      expect(secondEntry.response.outcome).toBeUndefined();

      const purgedEmployeeDoc = employeeDocs.get(disabledEmployeeId)!;
      expect(purgedEmployeeDoc.status).toBe(EntityLifecycleStatus.Inactive);
      const protectedPurgedEmployeeInput = mockKmsService.protectConfidentialData.mock.calls.at(-1)?.[0] as ConfidentialStorageDoc;
      expect((protectedPurgedEmployeeInput.content as EntityConfig).meta?.licensingPurgedAt).toBeDefined();

      const releasedLicenseDoc = licenseDocs.get('license-nurse-1')!;
      expect(releasedLicenseDoc.status).toBe('available');
      expect((releasedLicenseDoc.content as any).subjectId).toBeUndefined();
      expect((releasedLicenseDoc.content as any).activationCode).toBeUndefined();
    });
  });
});
