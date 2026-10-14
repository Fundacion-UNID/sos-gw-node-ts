// Flow contract: reuse shared test fixtures and canonical types; do not introduce duplicated literals.
// The worker routes each authorized FHIR job to its owning manager and encrypts the asynchronous response for the tenant boundary.
// src/__tests__/unit/worker.test.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

import { jest } from '@jest/globals';
import { mock, MockProxy } from 'jest-mock-extended';
import { Worker } from '../../worker';
import { IJobProcessor, ManagerRegistry } from '../../managers/registry';
import { JobRequest } from 'gdc-common-utils-ts/models/confidential-job';
import { testCreateCustomerJobRequestProfessionalOnboarding } from '../data/customer-onboarding.data';
import { createJobName } from '../../utils/naming';
import { IKmsService } from '../../gdc-backend-utils-node/models/IKmsService';
import { IDecodedDidcommPayload } from 'gdc-common-utils-ts/models/confidential-message';

describe('Worker', () => {
  let worker: Worker;
  let mockManagerRegistry: MockProxy<ManagerRegistry>;
  let mockIndividualManager: MockProxy<IJobProcessor>;
  let mockFamilyManager: MockProxy<IJobProcessor>;
  let mockDocumentReferenceManager: MockProxy<IJobProcessor>;
  let mockTwinCompositionManager: MockProxy<IJobProcessor>;
  let mockKmsService: MockProxy<IKmsService>;
  const API_BASE_URL = 'https://api.example.com';

  beforeEach(() => {
    mockIndividualManager = mock<IJobProcessor>();
    mockFamilyManager = mock<IJobProcessor>();
    mockDocumentReferenceManager = mock<IJobProcessor>();
    mockTwinCompositionManager = mock<IJobProcessor>();
    mockKmsService = mock<IKmsService>();
    mockManagerRegistry = mock<ManagerRegistry>({
      individualManager: mockIndividualManager,
      familyManager: mockFamilyManager,
      documentReferenceManager: mockDocumentReferenceManager,
      twinCompositionManager: mockTwinCompositionManager,
      subscriptionManager: undefined,
    });
    
    worker = new Worker(mockManagerRegistry, API_BASE_URL, mockKmsService);
    jest.clearAllMocks();
  });

  it('should route a "Person" resourceType job to the IndividualManager and encode the response', async () => {
    // ARRANGE
    const resourceType = 'Person';
    const vaultId = 'health-care_acme';
    const jobName = createJobName(
      vaultId,
      resourceType,
      '_batch',
    );
    
    const job: JobRequest = {
      ...testCreateCustomerJobRequestProfessionalOnboarding,
      tenantId: 'acme',
      sector: 'health-care',
      resourceType: resourceType,
      contentType: 'application/json',
    };

    const mockManagerResponse: IDecodedDidcommPayload = {
      jti: 'mock-jti-response',
      type: 'transaction-response',
      iss: API_BASE_URL,
      aud: 'urn:did:example:123',
      exp: Math.floor(Date.now() / 1000) + 300,
      thid: job.content?.thid as string,
      body: { data: [] },
    };
    mockIndividualManager.process.mockResolvedValue(mockManagerResponse);
    mockKmsService.getPublicEncryptionKey.mockResolvedValue({ kid: 'key-1' } as any);
    mockKmsService.encodeResponse.mockResolvedValue('encrypted.jwe.string');

    // ACT
    await worker.process(jobName, job);

    // ASSERT
    expect(mockIndividualManager.process).toHaveBeenCalledTimes(1);
    expect(mockIndividualManager.process).toHaveBeenCalledWith(job);
    expect(mockKmsService.encodeResponse).toHaveBeenCalledTimes(1);
    expect(mockKmsService.getPublicEncryptionKey).toHaveBeenCalledWith(vaultId);
    expect(mockKmsService.protectConfidentialData).not.toHaveBeenCalled();
  });

  it('routes Subject collection batches without treating Subject as a resource type', async () => {
    const subjectIdentityManager = mock<IJobProcessor>();
    const localWorker = new Worker(
      mock<ManagerRegistry>({ subjectIdentityManager, subscriptionManager: undefined }),
      API_BASE_URL,
      mockKmsService,
    );
    const jobName = createJobName('health-care_acme', 'Subject', '_batch');
    const job: JobRequest = {
      ...testCreateCustomerJobRequestProfessionalOnboarding,
      tenantId: 'acme', sector: 'health-care', section: 'individual',
      resourceType: 'Subject', action: '_batch',
    };
    subjectIdentityManager.process.mockResolvedValue({
      jti: 'subject-response', type: 'subject-identity-response', iss: API_BASE_URL,
      aud: 'did:web:client.example', exp: Math.floor(Date.now() / 1000) + 300,
      thid: String(job.content?.thid), body: { resourceType: 'Bundle', data: [] },
    } as any);
    mockKmsService.getPublicEncryptionKey.mockResolvedValue({ kid: 'host-key' } as any);
    mockKmsService.encodeResponse.mockResolvedValue('encrypted-subject-response');

    await localWorker.process(jobName, job);

    expect(subjectIdentityManager.process).toHaveBeenCalledWith(job);
    expect(mockIndividualManager.process).not.toHaveBeenCalled();
  });

  it('routes the public Patient/$match alias to the private Subject identity manager', async () => {
    const subjectIdentityManager = mock<IJobProcessor>();
    const localWorker = new Worker(
      mock<ManagerRegistry>({ subjectIdentityManager, subscriptionManager: undefined }),
      API_BASE_URL,
      mockKmsService,
    );
    const jobName = createJobName('animal-care_acme', 'Patient', '$match');
    const job: JobRequest = {
      ...testCreateCustomerJobRequestProfessionalOnboarding,
      tenantId: 'acme', sector: 'animal-care', section: 'individual',
      resourceType: 'Patient', action: '$match',
    };
    subjectIdentityManager.process.mockResolvedValue({
      jti: 'patient-match-response', type: 'patient-match-response', iss: API_BASE_URL,
      aud: 'did:web:client.example', exp: Math.floor(Date.now() / 1000) + 300,
      thid: String(job.content?.thid),
      body: { resourceType: 'Bundle', type: 'searchset', total: 0, entry: [] },
    } as any);
    mockKmsService.getPublicEncryptionKey.mockResolvedValue({ kid: 'host-key' } as any);
    mockKmsService.encodeResponse.mockResolvedValue('encrypted-patient-match-response');

    await localWorker.process(jobName, job);

    expect(subjectIdentityManager.process).toHaveBeenCalledWith(job);
  });

  it('routes Animal/$hashed-claims-issue to the Subject identity evidence manager', async () => {
    const subjectIdentityManager = mock<IJobProcessor>();
    const localWorker = new Worker(
      mock<ManagerRegistry>({ subjectIdentityManager, subscriptionManager: undefined }),
      API_BASE_URL,
      mockKmsService,
    );
    const job: JobRequest = {
      ...testCreateCustomerJobRequestProfessionalOnboarding,
      tenantId: 'acme', sector: 'animal-care', section: 'individual',
      format: 'org.schema', resourceType: 'Animal', action: '$hashed-claims-issue',
    };
    subjectIdentityManager.process.mockResolvedValue({
      thid: job.content?.thid,
      body: { resourceType: 'Parameters' },
    } as any);
    mockKmsService.getPublicEncryptionKey.mockResolvedValue({ kid: 'tenant-key' } as any);
    mockKmsService.encodeResponse.mockResolvedValue('encrypted-antifraud-response');

    await localWorker.process(createJobName('animal-care_acme', 'Animal', '$hashed-claims-issue'), job);

    expect(subjectIdentityManager.process).toHaveBeenCalledWith(job);
  });

  it('routes FHIR R5 ResearchStudy jobs to the dedicated study manager', async () => {
    const researchStudyManager = mock<IJobProcessor>();
    const localWorker = new Worker(
      mock<ManagerRegistry>({ researchStudyManager, subscriptionManager: undefined }),
      API_BASE_URL,
      mockKmsService,
    );
    const jobName = createJobName('animal-care_research-clinic', 'ResearchStudy', '_batch');
    const job = {
      ...testCreateCustomerJobRequestProfessionalOnboarding,
      tenantId: 'research-clinic',
      sector: 'animal-care',
      section: 'organization',
      format: 'org.hl7.fhir.r5',
      action: '_batch',
      resourceType: 'ResearchStudy',
    } as JobRequest;
    researchStudyManager.process.mockResolvedValue({
      jti: 'research-study-response',
      type: 'batch-response',
      iss: API_BASE_URL,
      aud: 'did:web:client.example',
      thid: String(job.content?.thid),
      body: { resourceType: 'Bundle', type: 'batch-response', data: [] },
    } as any);
    mockKmsService.getPublicEncryptionKey.mockResolvedValue({ kid: 'tenant-key' } as any);
    mockKmsService.encodeResponse.mockResolvedValue('encrypted-research-study-response');

    await localWorker.process(jobName, job);

    expect(researchStudyManager.process).toHaveBeenCalledWith(job);
  });

  it('routes FHIR R5 Group jobs to the descriptive research group manager', async () => {
    const groupManager = mock<IJobProcessor>();
    const localWorker = new Worker(
      mock<ManagerRegistry>({ groupManager, subscriptionManager: undefined }),
      API_BASE_URL,
      mockKmsService,
    );
    const jobName = createJobName('animal-care_research-clinic', 'Group', '_batch');
    const job = {
      ...testCreateCustomerJobRequestProfessionalOnboarding,
      tenantId: 'research-clinic',
      sector: 'animal-care',
      section: 'organization',
      format: 'org.hl7.fhir.r5',
      action: '_batch',
      resourceType: 'Group',
    } as JobRequest;
    groupManager.process.mockResolvedValue({
      jti: 'research-group-response',
      type: 'transaction-response',
      iss: API_BASE_URL,
      aud: 'did:web:client.example',
      thid: String(job.content?.thid),
      body: { resourceType: 'Bundle', type: 'batch-response', data: [] },
    } as any);
    mockKmsService.getPublicEncryptionKey.mockResolvedValue({ kid: 'tenant-key' } as any);
    mockKmsService.encodeResponse.mockResolvedValue('encrypted-research-group-response');

    await localWorker.process(jobName, job);

    expect(groupManager.process).toHaveBeenCalledWith(job);
  });

  it.each([
    ['Encounter', 'encounterManager'],
    ['ServiceRequest', 'serviceRequestManager'],
    ['Task', 'careTaskManager'],
    ['CommunicationRequest', 'communicationRequestManager'],
  ] as const)('routes FHIR R5 %s jobs to the claims-first care coordination manager', async (resourceType, registryKey) => {
    const manager = mock<IJobProcessor>();
    const localWorker = new Worker(
      mock<ManagerRegistry>({ [registryKey]: manager, subscriptionManager: undefined }),
      API_BASE_URL,
      mockKmsService,
    );
    const job = {
      ...testCreateCustomerJobRequestProfessionalOnboarding,
      tenantId: 'care-clinic', sector: 'animal-care', section: 'organization',
      format: 'org.hl7.fhir.r5', action: '_batch', resourceType,
    } as JobRequest;
    manager.process.mockResolvedValue({
      jti: `${resourceType}-response`, type: 'batch-response', iss: API_BASE_URL,
      aud: 'did:web:client.example', thid: String(job.content?.thid),
      body: { resourceType: 'Bundle', type: 'batch-response', data: [] },
    } as any);
    mockKmsService.getPublicEncryptionKey.mockResolvedValue({ kid: 'tenant-key' } as any);
    mockKmsService.encodeResponse.mockResolvedValue(`encrypted-${resourceType}-response`);

    await localWorker.process(createJobName('animal-care_care-clinic', resourceType, '_batch'), job);

    expect(manager.process).toHaveBeenCalledWith(job);
  });

  it('routes only organization FHIR R5 Consent jobs to the ResearchStudy consent manager', async () => {
    const researchStudyConsentManager = mock<IJobProcessor>();
    const consentManager = mock<IJobProcessor>();
    const localWorker = new Worker(
      mock<ManagerRegistry>({ researchStudyConsentManager, consentManager, subscriptionManager: undefined }),
      API_BASE_URL,
      mockKmsService,
    );
    const jobName = createJobName('animal-care_research-clinic', 'Consent', '_batch');
    const job = {
      ...testCreateCustomerJobRequestProfessionalOnboarding,
      tenantId: 'research-clinic', sector: 'animal-care', section: 'organization',
      format: 'org.hl7.fhir.r5', action: '_batch', resourceType: 'Consent',
    } as JobRequest;
    researchStudyConsentManager.process.mockResolvedValue({
      jti: 'research-study-consent-response', type: 'transaction-response', iss: API_BASE_URL,
      aud: 'did:web:client.example', thid: String(job.content?.thid),
      body: { resourceType: 'Bundle', type: 'batch-response', data: [] },
    } as any);
    mockKmsService.getPublicEncryptionKey.mockResolvedValue({ kid: 'tenant-key' } as any);
    mockKmsService.encodeResponse.mockResolvedValue('encrypted-research-study-consent-response');

    await localWorker.process(jobName, job);

    expect(researchStudyConsentManager.process).toHaveBeenCalledWith(job);
    expect(consentManager.process).not.toHaveBeenCalled();
  });

  it('should throw an error for an unconfigured resourceType', async () => {
    // ARRANGE
    const resourceType = 'UnknownResource';
    const jobName = createJobName(
      'health-care_acme',
      resourceType,
      '_batch',
    );
    
    const job: JobRequest = {
      ...testCreateCustomerJobRequestProfessionalOnboarding,
      tenantId: 'health-care_acme',
      resourceType: resourceType,
    };

    // For the error case, the worker creates an IDecodedDidcommPayload and then encodes it.
    // We can mock the encode function to simply stringify the payload, so we can inspect it.
    mockKmsService.encodeResponse.mockImplementation(async (payload) => JSON.stringify(payload));

    // ACT
    const responseString = await worker.process(jobName, job);
    const response = JSON.parse(responseString);

    // ASSERT
    expect(mockIndividualManager.process).not.toHaveBeenCalled();
    const errorIssue = response.body.data[0].response.outcome.issue![0];
    expect(errorIssue.diagnostics).toContain(`No manager configured for resourceType '${resourceType}'`);
  });

  it('keeps canonical resource.meta.claims without creating legacy claims or warnings', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const mockPersonManager = mock<IJobProcessor>();
    const registryWithPerson = mock<ManagerRegistry>({
      individualManager: mockPersonManager,
      subscriptionManager: undefined,
    });
    const localWorker = new Worker(registryWithPerson, API_BASE_URL, mockKmsService);

    const jobName = createJobName('test_host', 'Person', '_batch');
    const job: JobRequest = {
      ...testCreateCustomerJobRequestProfessionalOnboarding,
      tenantId: 'host',
      sector: 'test',
      resourceType: 'Person',
      contentType: 'application/json',
      content: {
        ...(testCreateCustomerJobRequestProfessionalOnboarding.content || {}),
        thid: 'thid-task-normalize-001',
        body: {
          data: [
            {
              type: 'Person',
              request: { method: 'POST' },
              resource: {
                resourceType: 'Person',
                meta: {
                  claims: {
                    '@context': 'org.hl7.fhir.api',
                    id: 'task-normalize-001',
                    subject: 'Person/elder-001',
                    status: 'active',
                  },
                },
              },
            },
          ],
        },
      } as any,
    };

    const managerResponse: IDecodedDidcommPayload = {
      jti: 'mock-jti-person',
      type: 'batch-response',
      iss: API_BASE_URL,
      aud: 'did:web:client.example.com',
      exp: Math.floor(Date.now() / 1000) + 300,
      thid: 'thid-person-normalize-001',
      body: { data: [] },
    };

    mockPersonManager.process.mockResolvedValue(managerResponse);
    mockKmsService.getPublicEncryptionKey.mockResolvedValue({ kid: 'host-key' } as any);
    mockKmsService.encodeResponse.mockResolvedValue('encrypted-task-response');

    await localWorker.process(jobName, job);

    expect(mockPersonManager.process).toHaveBeenCalledTimes(1);
    expect((job.content as any).body.data[0].resource.meta.claims).toMatchObject({
      '@context': 'org.hl7.fhir.api',
      id: 'task-normalize-001',
      subject: 'Person/elder-001',
      status: 'active',
    });
    expect((job.content as any).body.data[0].meta?.claims).toBeUndefined();
    expect(warnSpy.mock.calls.some(([message]) => String(message).includes('Deprecated claims placement'))).toBe(false);
    warnSpy.mockRestore();
  });

  it('rejects entry.meta.claims instead of migrating a legacy claims placement', async () => {
    const mockPersonManager = mock<IJobProcessor>();
    const registryWithPerson = mock<ManagerRegistry>({
      individualManager: mockPersonManager,
      subscriptionManager: undefined,
    });
    const localWorker = new Worker(registryWithPerson, API_BASE_URL, mockKmsService);
    const jobName = createJobName('test_host', 'Person', '_batch');
    const job: JobRequest = {
      ...testCreateCustomerJobRequestProfessionalOnboarding,
      tenantId: 'host',
      sector: 'test',
      resourceType: 'Person',
      contentType: 'application/json',
      content: {
        ...(testCreateCustomerJobRequestProfessionalOnboarding.content || {}),
        thid: 'thid-reject-entry-claims-001',
        body: {
          data: [{
            type: 'Person',
            request: { method: 'POST' },
            meta: { claims: { 'Person.identifier': 'urn:uuid:legacy-entry-claims' } },
            resource: { resourceType: 'Person' },
          }],
        },
      } as any,
    };
    mockKmsService.encodeResponse.mockImplementation(async (payload) => JSON.stringify(payload));

    const response = JSON.parse(await localWorker.process(jobName, job));

    expect(mockPersonManager.process).not.toHaveBeenCalled();
    expect(response.body.data[0].response.outcome.issue[0].diagnostics).toContain(
      'Claims must be supplied only in entry.resource.meta.claims',
    );
    expect((job.content as any).body.data[0].resource.meta).toBeUndefined();
  });

  it('should route individual pdf DocumentReference create jobs to the FamilyManager', async () => {
    const jobName = createJobName('health-care_acme', 'DocumentReference', '_create');
    const job: JobRequest = {
      ...testCreateCustomerJobRequestProfessionalOnboarding,
      tenantId: 'acme',
      sector: 'health-care',
      section: 'individual',
      format: 'pdf',
      action: '_create',
      resourceType: 'DocumentReference',
      contentType: 'application/json',
    };

    const managerResponse: IDecodedDidcommPayload = {
      jti: 'mock-jti-document-reference',
      type: 'batch-response',
      iss: API_BASE_URL,
      aud: 'did:web:client.example.com',
      exp: Math.floor(Date.now() / 1000) + 300,
      thid: job.content?.thid as string,
      body: { data: [] },
    };

    mockFamilyManager.process.mockResolvedValue(managerResponse);
    mockKmsService.getPublicEncryptionKey.mockResolvedValue({ kid: 'tenant-key' } as any);
    mockKmsService.encodeResponse.mockResolvedValue('encrypted-document-reference-response');

    await worker.process(jobName, job);

    expect(mockFamilyManager.process).toHaveBeenCalledTimes(1);
    expect(mockFamilyManager.process).toHaveBeenCalledWith(job);
    expect(mockDocumentReferenceManager.process).not.toHaveBeenCalled();
  });

  it('routes the public digitaltwin ResearchSubject/_search contract to the twin manager', async () => {
    const jobName = createJobName('animal-care_704457076', 'ResearchSubject', '_search');
    const job: JobRequest = {
      ...testCreateCustomerJobRequestProfessionalOnboarding,
      tenantId: '704457076',
      sector: 'animal-care',
      section: 'digitaltwin',
      format: 'org.hl7.fhir.r4',
      action: '_search',
      resourceType: 'ResearchSubject',
      contentType: 'application/json',
      content: {
        ...(testCreateCustomerJobRequestProfessionalOnboarding.content || {}),
        thid: 'thid-vet-research-subject-search-001',
        body: {
          resourceType: 'Parameters',
          parameter: [{ name: 'section', valueString: 'LOINC|10160-0' }],
        },
      } as any,
    };
    mockTwinCompositionManager.process.mockResolvedValue({
      jti: 'vet-research-subject-search-response',
      type: 'transaction-response',
      iss: API_BASE_URL,
      aud: 'did:web:client.example.com',
      thid: job.content?.thid as string,
      body: { data: [] },
    } as IDecodedDidcommPayload);
    mockKmsService.getPublicEncryptionKey.mockResolvedValue({ kid: 'tenant-key' } as any);
    mockKmsService.encodeResponse.mockResolvedValue('encrypted-research-subject-search-response');

    await worker.process(jobName, job);

    expect(mockTwinCompositionManager.process).toHaveBeenCalledWith(job);
  });

  it('should route digitaltwin Composition jobs to the TwinCompositionManager', async () => {
    const jobName = createJobName('animal-research_acme', 'Composition', '_search');
    const job: JobRequest = {
      ...testCreateCustomerJobRequestProfessionalOnboarding,
      tenantId: 'acme',
      sector: 'animal-research',
      section: 'digitaltwin',
      format: 'org.hl7.fhir.api',
      action: '_search',
      resourceType: 'Composition',
      contentType: 'application/json',
      content: {
        ...(testCreateCustomerJobRequestProfessionalOnboarding.content || {}),
        thid: 'thid-twin-composition-001',
        body: { resourceType: 'Parameters', parameter: [] },
      } as any,
    };

    const managerResponse: IDecodedDidcommPayload = {
      jti: 'mock-jti-twin-composition',
      type: 'transaction-response',
      iss: API_BASE_URL,
      aud: 'did:web:client.example.com',
      exp: Math.floor(Date.now() / 1000) + 300,
      thid: job.content?.thid as string,
      body: { data: [] },
    };

    mockTwinCompositionManager.process.mockResolvedValue(managerResponse);
    mockKmsService.getPublicEncryptionKey.mockResolvedValue({ kid: 'tenant-key' } as any);
    mockKmsService.encodeResponse.mockResolvedValue('encrypted-twin-composition-response');

    await worker.process(jobName, job);

    expect(mockTwinCompositionManager.process).toHaveBeenCalledTimes(1);
    expect(mockTwinCompositionManager.process).toHaveBeenCalledWith(job);
    expect(mockDocumentReferenceManager.process).not.toHaveBeenCalled();
  });

  describe('Architecture Keeper Tests', () => {
    it('should ALWAYS use encodeResponse for legacy (JSON) requests, NEVER protectConfidentialData', async () => {
      // ARRANGE
      const resourceType = 'Person';
      const jobName = createJobName('health-care_acme', resourceType, '_batch');
      const job: JobRequest = {
        ...testCreateCustomerJobRequestProfessionalOnboarding,
        tenantId: 'acme',
        sector: 'health-care',
        resourceType: resourceType,
        contentType: 'application/json', // This marks it as a "legacy" flow job
      };

      const mockManagerResponse: IDecodedDidcommPayload = {
        jti: 'mock-jti-response-2',
        type: 'transaction-response',
        iss: API_BASE_URL,
        aud: 'urn:did:example:123',
        exp: Math.floor(Date.now() / 1000) + 300,
        thid: job.content!.thid,
        body: { data: [{ type: 'Bundle', id: 'some-bundle-id' }] },
      };
      mockIndividualManager.process.mockResolvedValue(mockManagerResponse);
      
      const mockRecipientPublicEncryptionKey = { kty: 'OKP', crv: 'ML-KEM-768', kid: 'key-1', x: '...' };
      mockKmsService.getPublicEncryptionKey.mockResolvedValue(mockRecipientPublicEncryptionKey as any);

      // ACT
      await worker.process(jobName, job);

      // ASSERT
      // This is the core of the architectural guarantee.
      // The worker MUST call encodeResponse to ensure the async store gets a consistent JWE string.
      expect(mockKmsService.encodeResponse).toHaveBeenCalledTimes(1);
      expect(mockKmsService.encodeResponse).toHaveBeenCalledWith(
        mockManagerResponse,
        [mockRecipientPublicEncryptionKey],
        'health-care_acme' // senderVaultId
      );

      // It MUST NOT call protectConfidentialData, which is for at-rest storage in the main vault.
      expect(mockKmsService.protectConfidentialData).not.toHaveBeenCalled();
    });
  });
});
