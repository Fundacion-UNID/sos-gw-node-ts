// Flow contract: subject search returns consent resources through either rollout envelope without changing authorization or persistence.
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.
// File: src/__tests__/unit/managers/IndividualManager.test.ts

import { jest } from '@jest/globals';
import { mock, MockProxy } from 'jest-mock-extended';
import type { IVaultRepository } from '../../../database/repositories/vault/vault.repository';
import type { IKmsService } from '../../../gdc-backend-utils-node/models/IKmsService';
import { ClaimsOfferSchemaorg, ClaimsPersonSchemaorg, ClaimsServiceSchemaorg } from 'gdc-common-utils-ts/constants/schemaorg';
import { IDecodedDidcommPayload } from 'gdc-common-utils-ts/models/confidential-message';
import { JobRequest, JobStatus } from 'gdc-common-utils-ts/models/confidential-job';
import { ConfidentialStorageDoc } from 'gdc-common-utils-ts/models/confidential-storage';

import { CredentialManager } from '../../../managers/CredentialManager';
import { EntityConfig } from '../../../gdc-backend-utils-node/models/entity';
import { testTenant1IdentifierUrn } from '../../data/organization.data';
import { testCustomer1Uuid } from '../../data/customer.data';
import { TenantsCacheManager } from '../../../managers/TenantsCacheManager';
import { IBlockchainAdapter } from '../../../adapters/IBlockchainAdapter';
import {
  testCreateCustomerJobRequestProfessionalOnboarding,
  testIndividualOnboardingBatchEntries,
} from '../../data/customer-onboarding.data';
import { BundleEntry, BundleEntryResponse, ErrorEntry } from 'gdc-common-utils-ts/models/bundle';
import { DeviceLicense } from 'gdc-common-utils-ts/models/device-license';
import { getSubjectScopedSectionId } from '../../../utils/individual-sections';
import { extractBundleSearchResources } from 'gdc-common-utils-ts/utils/organization-employee-lifecycle';


const uuidMock = {
  v4: jest.fn(),
  validate: jest.fn(() => true), // Mock the validate function
};

jest.unstable_mockModule('uuid', () => uuidMock);
const { IndividualManager } = await import('../../../managers/IndividualManager');
const { v4: uuidv4 } = await import('uuid');
  
describe('IndividualManager', () => {
  let individualManager: InstanceType<typeof IndividualManager>;
  let mockVaultRepository: MockProxy<IVaultRepository>;
  let mockKmsService: MockProxy<IKmsService>;
  let mockTenantsCacheManager: MockProxy<TenantsCacheManager>;
  let mockCredentialManager: MockProxy<CredentialManager>;
  let mockBlockchainAdapter: MockProxy<IBlockchainAdapter>;


  const TENANT_URN = testTenant1IdentifierUrn;
  const HOST_COLLECTION_NAME = 'host-collection';
  const HOST_DID = 'did:web:host.example.com';

  beforeEach(() => {
    mockVaultRepository = mock<IVaultRepository>();
    mockKmsService = mock<IKmsService>();
    mockTenantsCacheManager = mock<TenantsCacheManager>();
    mockCredentialManager = mock<CredentialManager>();
    mockBlockchainAdapter = mock<IBlockchainAdapter>();

    individualManager = new IndividualManager(
      mockVaultRepository,
      mockKmsService,
      mockTenantsCacheManager,
      mockCredentialManager,
      mockBlockchainAdapter, // Add the new dependency
      'test-network',        // Add the network name
      {
        hostCollectionName: HOST_COLLECTION_NAME,
        hostDid: HOST_DID,
      },
    );
    jest.clearAllMocks();
    (uuidv4 as jest.Mock).mockReturnValue('new-mocked-uuid-v4');

    mockTenantsCacheManager.getEntityClaims.mockResolvedValue({});
    mockTenantsCacheManager.getCollectionName.mockResolvedValue('tenant-collection');
    mockKmsService.protectAttributesNameAndValue.mockResolvedValue([]);

    mockKmsService.protectConfidentialData.mockImplementation(
      async (doc: ConfidentialStorageDoc): Promise<ConfidentialStorageDoc> => {
        const secureDoc = { ...doc, jwe: { ciphertext: 'encrypted-content' } };
        delete (secureDoc as Partial<ConfidentialStorageDoc>).content;
        return secureDoc;
      },
    );
  });

  describe('Customer Onboarding', () => {
    
    beforeEach(() => {
        // Ensure job object has all required properties for each test in this suite
        (testCreateCustomerJobRequestProfessionalOnboarding as JobRequest).id = 'test-id';
        (testCreateCustomerJobRequestProfessionalOnboarding as JobRequest).status = JobStatus.DRAFT;
        (testCreateCustomerJobRequestProfessionalOnboarding as JobRequest).sequence = 0;
        (testCreateCustomerJobRequestProfessionalOnboarding as JobRequest).createdAtTimestamp = Date.now();
    });
    
    it('HU 2 (Professional Onboarding): should aggregate a batch and create a single customer', async () => {
      // ARRANGE
      const job = testCreateCustomerJobRequestProfessionalOnboarding;
      mockTenantsCacheManager.getTenantIdentifierUrn.mockResolvedValue(TENANT_URN);

      // ACT
      const response = await individualManager.process(job);

      // ASSERT
      // 1. Verify persistence
      expect(mockVaultRepository.put).toHaveBeenCalledTimes(1);
      const savedDoc = mockKmsService.protectConfidentialData.mock.calls[0][0];
      const customerConfig = savedDoc.content as EntityConfig;
      expect(customerConfig.id).toBe(testCustomer1Uuid);
      expect((customerConfig.claims as any)[ClaimsPersonSchemaorg.identifierValue]).toBe((testIndividualOnboardingBatchEntries[1].resource.meta.claims as any)[ClaimsPersonSchemaorg.identifierValue]);

      // 2. Verify response structure
      const responseEntry = response.body.data[0];
      if (!('resource' in responseEntry)) {
        throw new Error('Expected a BundleEntry, got an ErrorEntry.');
      }
      expect(responseEntry.response.status).toBe('201');
      expect(responseEntry.resource?.id).toBe(testCustomer1Uuid);

      // 3. Verify aggregated claims in the response
      const personClaims = responseEntry.resource!.meta!.claims!;
      const serviceClaims = responseEntry.resource!.contained![0]!.meta!.claims!;
      
      expect(personClaims[ClaimsPersonSchemaorg.email]).toBe((testIndividualOnboardingBatchEntries[0].resource.meta.claims as any)[ClaimsPersonSchemaorg.email]);
      expect(personClaims[ClaimsPersonSchemaorg.identifierValue]).toBe((testIndividualOnboardingBatchEntries[1].resource.meta.claims as any)[ClaimsPersonSchemaorg.identifierValue]);
      expect(serviceClaims[ClaimsServiceSchemaorg.termsOfService]).toBe((testIndividualOnboardingBatchEntries[0].resource.meta.claims as any)[ClaimsServiceSchemaorg.termsOfService]);
    });

    it('HU 1 (Self-Onboarding): should generate an identifier if none is provided', async () => {
      // ARRANGE
      const generatedUuid = 'a1b2c3d4-e5f6-4a3b-8c2d-1e9f0a8b7c6d';
      (uuidv4 as jest.Mock).mockReturnValue(generatedUuid);

      const job: JobRequest = {
        ...testCreateCustomerJobRequestProfessionalOnboarding,
        id: 'self-onboarding-job-id', // Add required properties
        status: JobStatus.DRAFT,
        sequence: 0,
        createdAtTimestamp: Date.now(),
        content: {
          ...(testCreateCustomerJobRequestProfessionalOnboarding.content as IDecodedDidcommPayload),
          jti: 'self-onboarding-jti',
          body: {
            data: [
              {
                resource: {
                  resourceType: 'Person',
                  meta: { claims: {
                    [ClaimsPersonSchemaorg.email]: 'new.customer@example.com',
                  } },
                },
                request: { method: 'POST', url: '/' },
                type: 'Customer-form-v1.0',
              },
            ],
          },
        },
      };
      
      (job.content!.body!.data[0].resource!.meta!.claims as any)['org.schema.Service.category'] = 'health-care';
      
      mockTenantsCacheManager.getTenantIdentifierUrn.mockResolvedValue(TENANT_URN);

      // ACT
      const response = await individualManager.process(job);

      // ASSERT
      // 1. Verify the generated ID was used for persistence
      expect(mockVaultRepository.put).toHaveBeenCalledTimes(1);
      const savedDoc = mockKmsService.protectConfidentialData.mock.calls[0][0];
      const customerConfig = savedDoc.content as EntityConfig;
      expect(customerConfig.id).toBe(generatedUuid);

      // 2. Verify the generated identifier is in the response
      const responseEntry = response.body.data[0];
      if (!('resource' in responseEntry)) {
        throw new Error('Expected a BundleEntry with a resource, but received an ErrorEntry.');
      }
      expect(responseEntry.response.status).toBe('201');
      expect(responseEntry.resource?.id).toBe(generatedUuid);
      const finalClaims = responseEntry.resource!.meta!.claims!;
      expect(finalClaims[ClaimsPersonSchemaorg.identifier]).toBe(`urn:uuid:${generatedUuid}`);
    });

    it('should return an error if batch entries have inconsistent identifiers', async () => {
	        // ARRANGE
	        const job = JSON.parse(JSON.stringify(testCreateCustomerJobRequestProfessionalOnboarding)) as JobRequest;
	        (job.content!.body!.data[1].resource!.meta!.claims as any)[ClaimsPersonSchemaorg.identifier] = 'urn:uuid:different-uuid';
	        mockTenantsCacheManager.getTenantIdentifierUrn.mockResolvedValue(TENANT_URN);

        // ACT
        const response = await individualManager.process(job);

        // ASSERT
        expect(mockVaultRepository.put).not.toHaveBeenCalled();
        const errorEntry = response.body.data[0] as ErrorEntry;
        expect(errorEntry.response.status).toBe('400');
        expect(errorEntry.response.outcome.issue[0].diagnostics).toContain('Identifier inconsistency in batch');
    });

    it('should return an Offer when customer licenses exist but none are available', async () => {
      const job = JSON.parse(JSON.stringify(testCreateCustomerJobRequestProfessionalOnboarding)) as JobRequest;
      mockTenantsCacheManager.getTenantIdentifierUrn.mockResolvedValue(TENANT_URN);
      mockTenantsCacheManager.getTenantDid.mockResolvedValue('did:web:host.example.com');

      const issuedLicense: DeviceLicense = {
        id: 'lic-1',
        tenantId: 'acme',
        orderId: 'order-1',
        userClass: 'individual',
        type: 'mobile',
        status: 'issued',
        plan: 'default',
        renewalCycle: '12m',
        reactivationEnabled: false,
        exp: Math.floor(Date.now() / 1000) + 3600,
      };
      mockVaultRepository.getContainersInSection.mockResolvedValueOnce([
        { id: issuedLicense.id, sequence: 0, content: issuedLicense } as unknown as ConfidentialStorageDoc,
      ]);

      const response = await individualManager.process(job);
      const entry = response.body.data[0] as any;
      expect(entry.type).toBe('Individual-license-offer-v1.0');
      expect(entry.resource?.meta?.claims?.[ClaimsOfferSchemaorg.identifier]).toBeDefined();
      expect(mockVaultRepository.put).toHaveBeenCalledTimes(1);
    });
  });

  describe('Customer Discovery', () => {
    it('should batch queries and call the adapter once per channel', async () => {
      // ARRANGE
      const job: JobRequest = {
        id: 'discovery-job-id',
        status: JobStatus.DRAFT,
        sequence: 0,
        createdAtTimestamp: Date.now(),
        sector: 'health-care',
        tenantId: 'acme',
        section: 'test-network',
        format: 'org.schema',
        action: '_discovery',
        resourceType: 'Person',
        content: {
          jti: 'discovery-jti',
          thid: 'thid-test-batch',
          iss: 'iss-test',
          aud: 'aud-test',
          type: 'api+json',
          body: {
            data: [
              // EU-based identifier
              {
                type: 'Person-discover-v1.0',
                resource: { resourceType: 'Person', meta: { claims: { [ClaimsPersonSchemaorg.identifierType]: 'NNES', [ClaimsPersonSchemaorg.identifierValue]: '12345678Z' } } }
              },
              // Global identifier
              {
                type: 'Person-discover-v1.0',
                resource: { resourceType: 'Person', meta: { claims: { [ClaimsPersonSchemaorg.telephone]: '+15551234567' } } }
              },
              // Another EU-based identifier to test grouping
              {
                type: 'Person-discover-v1.0',
                resource: { resourceType: 'Person', meta: { claims: { [ClaimsPersonSchemaorg.identifierType]: 'PPNFR', [ClaimsPersonSchemaorg.identifierValue]: '987654321' } } }
              },
            ]
          }
        }
      };
      mockTenantsCacheManager.getTenantIdentifierUrn.mockResolvedValue(TENANT_URN);
      // Mock the batch response
      mockBlockchainAdapter.discoverDidsByHashes.mockImplementation(async (hashes, channel) => {
        if (channel === 'health-care-eu') {
            return ['did:web:nnes-did', undefined]; // NNES found, PPN not found
        }
        if (channel === 'health-care-global') {
            return ['did:web:phone-did'];
        }
        return [];
      });

      // ACT
      const response = await individualManager.process(job);

      // ASSERT
      // 1. Verify adapter was called exactly once for each channel
      expect(mockBlockchainAdapter.discoverDidsByHashes).toHaveBeenCalledTimes(2);

      // 2. Verify the EU channel call
      expect(mockBlockchainAdapter.discoverDidsByHashes).toHaveBeenCalledWith(
        [expect.any(String), expect.any(String)], // An array of 2 hashes
        'health-care-eu',
        'discovery-person'
      );

      // 3. Verify the Global channel call
      expect(mockBlockchainAdapter.discoverDidsByHashes).toHaveBeenCalledWith(
        [expect.any(String)], // An array of 1 hash
        'health-care-global',
        'discovery-person'
      );
      
      // 4. Verify the final response structure and order
      expect(response.body.data.length).toBe(3);
      expect((response.body.data[0] as BundleEntryResponse).response?.status).toBe('200');
      expect((response.body.data[0] as BundleEntryResponse).response.location).toBe('did:web:nnes-did');
      expect((response.body.data[1] as BundleEntryResponse).response.status).toBe('200');
      expect((response.body.data[1] as BundleEntryResponse).response.location).toBe('did:web:phone-did');
      expect((response.body.data[2] as ErrorEntry).response.status).toBe('404');
    });
  });

  describe('Subject search', () => {
    it('returns projected consents from the individual consents section', async () => {
      const subjectDid = 'did:web:api.acme.org:individual:subject-consent-001';
      const tenantVaultId = 'health-care_acme';
      mockTenantsCacheManager.getTenantIdentifierUrn.mockResolvedValue(TENANT_URN);
      mockVaultRepository.vaultExists.mockResolvedValue(true);
      mockVaultRepository.listContainersInSection.mockResolvedValue([
        {
          id: 'consent-1',
          'Consent.subject': subjectDid,
          'Consent.identifier': 'urn:uuid:consent-professional-001',
          'Consent.actorIdentifier': 'doctor.oncall@example.org',
          'Consent.purpose': 'TREAT',
          'Consent.actorRole': 'ISCO-08|2211',
        },
        {
          id: 'consent-2',
          'Consent.subject': subjectDid,
          'Consent.identifier': 'urn:uuid:consent-organization-001',
          'Consent.actorIdentifier': 'did:web:hospital.acme.org',
          'Consent.purpose': 'ETREAT',
          'Consent.actorRole': 'ISCO-08|2211',
        },
      ] as any);

      const job: JobRequest = {
        id: 'subject-search-job-001',
        status: JobStatus.DRAFT,
        sequence: 0,
        createdAtTimestamp: Date.now(),
        tenantId: 'acme',
        jurisdiction: 'es',
        sector: 'health-care',
        section: 'individual',
        format: 'org.hl7.fhir.api' as any,
        resourceType: 'Subject',
        action: '_search',
        content: {
          jti: 'subject-search-jti-001',
          thid: 'subject-search-thid-001',
          iss: 'did:web:sender.example',
          aud: 'did:web:receiver.example',
          exp: Math.floor(Date.now() / 1000) + 300,
          type: 'api+json',
          body: {
            resourceType: 'Parameters',
            parameter: [
              { name: 'subject', valueString: subjectDid },
            ],
          },
        } as any,
      };

      const response = await individualManager.process(job);
      const responseEntry = response.body.data[0] as any;

      expect(mockVaultRepository.listContainersInSection).toHaveBeenCalledWith(
        tenantVaultId,
        getSubjectScopedSectionId(subjectDid, 'individual', 'consents'),
      );
      expect(responseEntry.type).toBe('Subject-search-response-v1.0');
      expect(responseEntry.response.status).toBe('200');
      expect(response.body.resourceType).toBe('Bundle');
      expect(extractBundleSearchResources(response.body)).toHaveLength(2);
    });

    it('filters one contextualized HRESCH rule by provider, action and source reference', async () => {
      const subjectDid = 'did:web:globaldatacare.es:health-care:organization:taxid:VATES-B42215152:individual:multibase:zSubject';
      const providerDid = 'did:web:globaldatacare.es:health-care:organization:taxid:VATES-B42215152';
      mockTenantsCacheManager.getTenantIdentifierUrn.mockResolvedValue(TENANT_URN);
      mockVaultRepository.vaultExists.mockResolvedValue(true);
      mockVaultRepository.listContainersInSection.mockResolvedValue([
        {
          id: 'permit-globaldatacare',
          '@context': 'org.hl7.fhir.api',
          'org.hl7.fhir.api.Consent.subject': subjectDid,
          'org.hl7.fhir.api.Consent.identifier': 'urn:uuid:permit-globaldatacare',
          'org.hl7.fhir.api.Consent.actor-identifier': providerDid,
          'org.hl7.fhir.api.Consent.actor-role': '*',
          'org.hl7.fhir.api.Consent.purpose': 'HRESCH',
          'org.hl7.fhir.api.Consent.action': 'organization/ResearchSubject.rs',
          'org.hl7.fhir.api.Consent.source-reference': 'https://globaldatacare.es',
          'org.hl7.fhir.api.Consent.decision': 'permit',
        },
        {
          id: 'other-study',
          '@context': 'org.hl7.fhir.api',
          'org.hl7.fhir.api.Consent.subject': subjectDid,
          'org.hl7.fhir.api.Consent.identifier': 'urn:uuid:other-study',
          'org.hl7.fhir.api.Consent.actor-identifier': providerDid,
          'org.hl7.fhir.api.Consent.actor-role': '*',
          'org.hl7.fhir.api.Consent.purpose': 'HRESCH',
          'org.hl7.fhir.api.Consent.action': 'organization/ResearchSubject.rs',
          'org.hl7.fhir.api.Consent.source-reference': 'urn:study:other',
          'org.hl7.fhir.api.Consent.decision': 'deny',
        },
      ] as any);

      const response = await individualManager.process({
        id: 'subject-search-job-hresch',
        status: JobStatus.DRAFT,
        sequence: 0,
        createdAtTimestamp: Date.now(),
        tenantId: 'acme',
        jurisdiction: 'es',
        sector: 'health-care',
        section: 'individual',
        format: 'org.hl7.fhir.api' as any,
        resourceType: 'Subject',
        action: '_search',
        content: {
          jti: 'subject-search-jti-hresch',
          thid: 'subject-search-thid-hresch',
          iss: 'did:web:sender.example',
          aud: 'did:web:receiver.example',
          exp: Math.floor(Date.now() / 1000) + 300,
          type: 'api+json',
          body: {
            resourceType: 'Parameters',
            parameter: [
              { name: 'subject', valueString: subjectDid },
              { name: 'actor-identifier', valueString: providerDid },
              { name: 'purpose', valueString: 'HRESCH' },
              { name: 'action', valueString: 'organization/ResearchSubject.rs' },
              { name: 'source-reference', valueString: 'https://globaldatacare.es' },
            ],
          },
        } as any,
      });

      const responseEntry = response.body.data[0] as any;
      const matches = extractBundleSearchResources(response.body) as any[];
      expect(matches).toHaveLength(1);
      expect(matches[0].id).toBe('permit-globaldatacare');
    });
  });
});
