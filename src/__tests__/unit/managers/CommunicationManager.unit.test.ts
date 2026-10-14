// Flow contract: reuse shared test fixtures and canonical types; do not introduce duplicated literals.
// Communication ingestion persists authorized resources and
// returns independent per-entry outcomes for mixed clinical batch operations.
// Authorization invariant: only the exact subject's creator or the same
// privately linked verified identity can delete an authored clinical fact.
// Persistence invariant: resources retain author provenance, optional
// submitter audit, and document organization/date; a failed entry never rolls
// back a successful sibling entry.
// TDD contract: write this test red first; make it green only with complete behavior.
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.
// File: src/__tests__/unit/CommunicationManager.unit.test.ts
// Description: Unit tests for the CommunicationManager.

import { jest } from '@jest/globals';
import { CommunicationManager } from '../../../managers/CommunicationManager';
import { TwinCompositionManager } from '../../../managers/TwinCompositionManager';
import type { TenantsCacheManager } from '../../../managers/TenantsCacheManager';
import { testCommunicationAppointmentFhirR4, testCommMsgExtAppointmentRequest, testAppointmentRequestText } from '../../data/appointment.data';
import { DataEntry } from 'gdc-common-utils-ts/models/comm';
import { JobRequest, JobStatus } from 'gdc-common-utils-ts/models/confidential-job';
import { IDecodedDidcommPayload } from 'gdc-common-utils-ts/models/confidential-message';
import { randomUUID } from 'crypto';
import { createServer, type Server } from 'node:http';
import type { IVaultRepository } from '../../../database/repositories/vault/vault.repository';
import type { IKmsService } from '../../../gdc-backend-utils-node/models/IKmsService';
import { getSubjectScopedSectionId } from '../../../utils/individual-sections';
import {
  buildCommunicationParticipantSearchParameters,
  buildCommunicationParticipantIndexAttributes,
  buildExampleCommunicationParticipantProjection,
  buildExampleCommunicationParticipantSearchInput,
  BundleEditableResourceTypes,
  BundleEditor,
  BundleOperations,
  CommunicationParticipantPrefixes,
  CompositionAttesterModes,
  CompositionClaim,
  ConfidentialDocumentIndex,
  ConsentDecisions,
  ConsentStatuses,
  DataCollectionIds,
  HealthcareActorRoles,
  HealthcareBasicSections,
  HealthcareConsentPurposes,
  ResourceTypesFhirR4,
} from 'gdc-common-utils-ts';
import { CommunicationClaim } from 'gdc-common-utils-ts/models/interoperable-claims/communication-claims';
import { BundleTypes } from 'gdc-common-utils-ts/models/bundle-editor-types';
import { Format } from 'gdc-common-utils-ts/constants/Schemas';
import { HttpMediaTypes } from 'gdc-common-utils-ts/constants/http';
import { Sector } from 'gdc-common-utils-ts/models/urlPath';
import {
  EXAMPLE_ALLERGY_IDENTIFIER,
  EXAMPLE_ALLERGY_ONSET_DATE_TIME,
  EXAMPLE_CLINICAL_SECTION_ALLERGIES,
  EXAMPLE_COMMUNICATION_IDENTIFIER,
  EXAMPLE_CONSENT_IDENTIFIER,
  EXAMPLE_CONTENT_TYPE_FHIR_JSON,
  EXAMPLE_CONTROLLER_DID,
  EXAMPLE_HEALTHCARE_JURISDICTION,
  EXAMPLE_IPS_COMPOSITION_IDENTIFIER,
  EXAMPLE_PROFESSIONAL_DID,
  EXAMPLE_PROVIDER_ORGANIZATION_AUTHORIZATION_URN_CDS,
  EXAMPLE_PROVIDER_ORGANIZATION_DID,
  EXAMPLE_SUBJECT_DID,
  EXAMPLE_KYC_CONTROLLER_USER_UUID,
  EXAMPLE_KYC_CONTROLLER_UUID,
  EXAMPLE_OBSERVATION_IDENTIFIER,
  EXAMPLE_RELATED_PERSON_ROLE,
  EXAMPLE_CLIENT_INSTANCE_UUID,
  EXAMPLE_CONTROLLER_SIGN_KEY,
} from 'gdc-common-utils-ts/examples/shared';
import { FhirIpsCreatorKinds } from 'gdc-common-utils-ts/utils/fhir-ips-creator-identity';
import { extractBundleSearchResources } from 'gdc-common-utils-ts/utils/organization-employee-lifecycle';
import { getClinicalCreatorBindingsSectionId } from '../../../utils/ips-bundle';
import { applyDigitalTwinSecondaryUseDecision } from '../../../utils/digital-twin-secondary-use';
import { buildDemoResearchPermitByRoleConsent } from '../../data/demo-smart-access-local-network.data';
import { getOrCreateDigitalTwinSubjectId } from '../../../utils/digital-twin-research-projection';
import { VitalSignsCodes, VitalSignsUnits } from 'gdc-common-utils-ts/constants/vital-signs';
import {
  EXAMPLE_VITAL_SIGNS_EFFECTIVE_DATE_TIME,
  EXAMPLE_VITAL_SIGN_VALUE_BODY_TEMPERATURE,
} from 'gdc-common-utils-ts/examples/shared';

describe('CommunicationManager Unit Tests', () => {
  let communicationManager: CommunicationManager;
  let mockTenantsCacheManager: jest.Mocked<TenantsCacheManager>;
  let mockVaultRepository: jest.Mocked<IVaultRepository>;
  let mockKmsService: jest.Mocked<IKmsService>;
  let mockCompositionManager: { process: jest.Mock };
  let mockIndividualManager: { process: jest.Mock };
  let mockTaskManager: { process: jest.Mock };
  let storedRecords: Map<string, any>;
  let terminologyServer: Server | undefined;
  const testServerDid = 'did:web:test-server.com';

  async function enableDigitalTwinSecondaryUse(subjectDid: string): Promise<string> {
    await applyDigitalTwinSecondaryUseDecision({
      vaultRepository: mockVaultRepository,
      tenantVaultId: 'health-care_acme',
      claims: { ...buildDemoResearchPermitByRoleConsent({ subjectDid }) },
    });
    const twinSubjectId = await getOrCreateDigitalTwinSubjectId({
      vaultRepository: mockVaultRepository,
      tenantVaultId: 'health-care_acme',
      sourceSubject: subjectDid,
    });
    mockVaultRepository.put.mockClear();
    return twinSubjectId;
  }

  beforeEach(() => {
    // Create a new mock instance for each test
    mockTenantsCacheManager = {
      getTenantDid: jest.fn(),
      tenantExists: jest.fn(async () => true),
    } as unknown as jest.Mocked<TenantsCacheManager>;
    storedRecords = new Map<string, any>();
    mockVaultRepository = {
      vaultExists: jest.fn(async () => false),
      put: jest.fn(async (vaultId: string, items: any[], sectionId?: string) => {
        items.forEach((item) => storedRecords.set(`${vaultId}|${sectionId}|${item.id}`, item));
        return true;
      }),
      get: jest.fn(async (vaultId: string, id: string, sectionId?: string) =>
        storedRecords.get(`${vaultId}|${sectionId}|${id}`)),
      delete: jest.fn(async (vaultId: string, id: string, sectionId?: string) =>
        storedRecords.delete(`${vaultId}|${sectionId}|${id}`)),
      query: jest.fn(async () => []),
      listContainersInSection: jest.fn(async () => []),
      getAllSections: jest.fn(async () => []),
    } as unknown as jest.Mocked<IVaultRepository>;
    mockKmsService = {
      protectAttributesNameAndValue: jest.fn(async (attributes: any[]) => attributes.map((attribute) => ({
        ...attribute,
        name: `protected:${attribute.name}`,
        value: `protected:${attribute.value}`,
      }))),
      protectConfidentialData: jest.fn(async (document: any) => document),
      unprotectConfidentialData: jest.fn(async (document: any) => document.content),
    } as unknown as jest.Mocked<IKmsService>;
    mockCompositionManager = {
      process: jest.fn(),
    };
    mockIndividualManager = {
      process: jest.fn(),
    };
    mockTaskManager = {
      process: jest.fn(async (job: any) => ({
        body: { data: [{
          id: job.content.body.data[0].resource.id,
          type: 'Task',
          response: { status: '200' },
          resource: job.content.body.data[0].resource,
        }] },
      })),
    };
    
    communicationManager = new CommunicationManager({
      tenantsCacheManager: mockTenantsCacheManager,
      vaultRepository: mockVaultRepository,
      kmsService: mockKmsService,
      compositionManager: mockCompositionManager as any,
      individualManager: mockIndividualManager as any,
      taskManager: mockTaskManager as any,
    });
  });

  afterEach(async () => {
    delete process.env.RESEARCH_TERMINOLOGY_BASE_URL;
    delete process.env.RESEARCH_TERMINOLOGY_SERVICE_TOKEN;
    delete process.env.RESEARCH_TERMINOLOGY_LABELS_ENABLED;
    if (terminologyServer) {
      await new Promise<void>((resolve) => terminologyServer!.close(() => resolve()));
      terminologyServer = undefined;
    }
    jest.clearAllMocks();
  });

  describe('process (Communication-carried mixed clinical batch)', () => {
    const subjectDid = 'did:web:subject.example:animals:patient-1';
    const creatorDid = 'did:web:clinic-a.example:professionals:vet-1';
    const defaultAssignmentIdentifier = `urn:uuid:${EXAMPLE_KYC_CONTROLLER_UUID}`;

    function buildClinicalBatchJob(
      innerEntries: unknown[],
      authorIdentifier?: string,
      attesterIdentifier?: string | null,
      issuer = creatorDid,
      communicationStatus = 'completed',
    ): JobRequest {
      const resolvedAuthorIdentifier = authorIdentifier || defaultAssignmentIdentifier;
      const resolvedAttesterIdentifier = attesterIdentifier === null
        ? undefined
        : (attesterIdentifier || resolvedAuthorIdentifier);
      const attachedBundle = {
        resourceType: 'Bundle',
        type: 'batch',
        meta: { claims: {
          [CompositionClaim.Author]: resolvedAuthorIdentifier,
          ...(resolvedAttesterIdentifier ? { [CompositionClaim.Attester]: resolvedAttesterIdentifier } : {}),
        } },
        data: innerEntries,
      };
      return {
        id: randomUUID(), status: JobStatus.DRAFT, sequence: 0, createdAtTimestamp: Date.now(),
        tenantId: 'acme', jurisdiction: 'ca-bc', sector: 'animal-care', section: 'individual',
        format: 'org.hl7.fhir.api' as any, resourceType: 'Communication', action: '_batch',
        content: {
          jti: randomUUID(), thid: randomUUID(), iss: issuer, aud: testServerDid,
          exp: Math.floor(Date.now() / 1000) + 300, type: 'org.hl7.fhir.api.Bundle',
          body: {
            resourceType: 'Bundle', type: 'batch', data: [{
              type: 'Communication',
              resource: { resourceType: 'Communication', meta: { claims: {
                [CommunicationClaim.Subject]: subjectDid,
                [CommunicationClaim.Sender]: issuer,
                [CommunicationClaim.Status]: communicationStatus,
                [CommunicationClaim.Topic]: HealthcareBasicSections.AllergiesAndIntolerances.attributeValue,
                [CommunicationClaim.ContentAttachmentType]: 'application/fhir+json',
                [CommunicationClaim.ContentAttachmentData]: Buffer.from(JSON.stringify(attachedBundle), 'utf8').toString('base64'),
              } } },
            }],
          },
        } as any,
      };
    }

    function renderClinicalBatchJobAsFhirR4(job: JobRequest): JobRequest {
      const claims = (job.content!.body as any).data[0].resource.meta.claims;
      return {
        ...job,
        format: Format.FHIR_R4 as any,
        content: {
          ...job.content,
          body: {
            resourceType: 'Bundle',
            type: 'batch',
            entry: [{
              request: { method: 'POST', url: 'individual/org.hl7.fhir.r4/Communication' },
              type: 'Communication',
              resource: {
                resourceType: 'Communication',
                status: claims[CommunicationClaim.Status],
                meta: { claims },
                topic: { coding: [{ system: 'http://loinc.org', code: '30954-2' }] },
                subject: { reference: claims[CommunicationClaim.Subject] },
                sender: { reference: claims[CommunicationClaim.Sender] },
                payload: [{ contentAttachment: {
                  data: claims[CommunicationClaim.ContentAttachmentData],
                  contentType: claims[CommunicationClaim.ContentAttachmentType],
                  title: 'veterinary-section-update.json',
                } }],
              },
            }],
          },
        } as any,
      };
    }
    beforeEach(async () => {
      await mockVaultRepository.put('animal-care_acme', [{
        id: defaultAssignmentIdentifier,
        kind: FhirIpsCreatorKinds.IndividualMember,
        actorIdentifier: `urn:uuid:${EXAMPLE_KYC_CONTROLLER_USER_UUID}`,
        authorIdentifier: defaultAssignmentIdentifier,
        ownerIdentifier: defaultAssignmentIdentifier,
        role: EXAMPLE_RELATED_PERSON_ROLE,
        actorDids: [creatorDid],
      } as any], getClinicalCreatorBindingsSectionId());
      mockVaultRepository.listContainersInSection.mockImplementation(async (vaultId: string, sectionId: string) =>
        [...storedRecords.entries()]
          .filter(([key]) => key.startsWith(`${vaultId}|${sectionId}|`))
          .map(([, value]) => value));
      mockVaultRepository.put.mockClear();
    });

    it('persists the complete VetChain immunization flat-claim graph as independent linked resources', async () => {
      mockTenantsCacheManager.getTenantDid.mockResolvedValue(testServerDid as any);
      const immunizationId = 'immunization-rabies-1';
      const medicationId = 'medication-rabies-1';
      const recommendationId = 'recommendation-rabies-1';
      const documentReferenceId = 'document-reference-rabies-1';
      const reminderTaskId = 'recommendation-rabies-1-reminder-1m';

      const response = await communicationManager.process(buildClinicalBatchJob([{
        type: 'Immunization-create-request-v1.0',
        request: { method: 'POST', url: 'Immunization' },
        resource: { resourceType: 'Immunization', id: immunizationId, meta: { claims: {
          'Immunization.patient': subjectDid,
          'Immunization.status': 'completed',
          'Immunization.date': '2024-05-23',
          'Immunization.vaccine-code': 'http://www.whocc.no/atcvet|QI07AA02',
          'Immunization.contained-reference-list': `Medication/${medicationId},ImmunizationRecommendation/${recommendationId},DocumentReference/${documentReferenceId}`,
        } } },
      }, {
        type: 'Medication-create-request-v1.0',
        request: { method: 'POST', url: 'Medication' },
        resource: { resourceType: 'Medication', id: medicationId, meta: { claims: {
          'Medication.code-text': 'Imrab 3 TF',
          'Medication.expiration-date': '2025-06-28',
        } } },
      }, {
        type: 'ImmunizationRecommendation-create-request-v1.0',
        request: { method: 'POST', url: 'ImmunizationRecommendation' },
        resource: { resourceType: 'ImmunizationRecommendation', id: recommendationId, meta: { claims: {
          'ImmunizationRecommendation.patient': subjectDid,
          'ImmunizationRecommendation.date': '2024-05-23',
          'ImmunizationRecommendation.date-criterion-value': '2027-05-23',
          'ImmunizationRecommendation.vaccine-code': 'http://www.whocc.no/atcvet|QI07AA02',
        } } },
      }, {
        type: 'DocumentReference-create-request-v1.0',
        request: { method: 'POST', url: 'DocumentReference' },
        resource: { resourceType: 'DocumentReference', id: documentReferenceId, meta: { claims: {
          'DocumentReference.subject': subjectDid,
          'DocumentReference.identifier': 'urn:uuid:rabies-certificate-1',
          'DocumentReference.contenthash': 'bafybeirabiescertificate',
          'DocumentReference.contenttype': 'image/jpeg',
        } } },
      }, {
        type: 'Task-create-request-v1.0',
        request: { method: 'POST', url: 'Task' },
        resource: { resourceType: 'Task', id: reminderTaskId, meta: { claims: {
          'Task.status': 'requested',
          'Task.intent': 'order',
          'Task.for': subjectDid,
          'Task.focus': `ImmunizationRecommendation/${recommendationId}`,
          'Task.scheduled-at': '2027-04-23',
          'Task.channel': 'push,email,sms,whatsapp,telephone',
        } } },
      }]));

      expect((response.body as any).data.map((entry: any) => entry.response.status)).toEqual(['201', '201', '201', '201', '200']);
      expect(mockTaskManager.process).toHaveBeenCalledWith(expect.objectContaining({
        action: '_batch',
        content: expect.objectContaining({ body: expect.objectContaining({ data: [expect.objectContaining({
          resource: expect.objectContaining({ resourceType: 'Task', id: reminderTaskId }),
        })] }) }),
      }))
      expect([...storedRecords.values()]).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: medicationId, 'org.hl7.fhir.api.Medication.code-text': 'Imrab 3 TF' }),
        expect.objectContaining({
          id: recommendationId,
          'org.hl7.fhir.api.ImmunizationRecommendation.date': '2024-05-23',
          'org.hl7.fhir.api.ImmunizationRecommendation.date-criterion-value': '2027-05-23',
        }),
        expect.objectContaining({
          id: documentReferenceId,
          'org.hl7.fhir.api.DocumentReference.contenthash': 'bafybeirabiescertificate',
        }),
      ]));
    });

    it('lets the authenticated creator delete the mistaken record without a version condition', async () => {
      // Step 1. Authoritative storage says who created the record and which version is current.
      mockTenantsCacheManager.getTenantDid.mockResolvedValue(testServerDid as any);
      mockVaultRepository.get.mockResolvedValue({
        id: 'immunization-mistake', audit: { creatorDid },
        'Immunization.subject': subjectDid, 'Immunization.meta.versionId': 'version-current',
      } as any);

      // Step 2. The same verified DID conditionally deletes it through the attached batch.
      const response = await communicationManager.process(buildClinicalBatchJob([{
        type: 'Immunization-delete-request-v1.0',
        request: { method: 'DELETE', url: 'Immunization/immunization-mistake' },
        resource: { resourceType: 'Immunization', id: 'immunization-mistake', meta: { claims: {} } },
      }]));
      expect((response.body as any).data).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: 'immunization-mistake', response: expect.objectContaining({ status: '204' }) }),
      ]));
      expect(mockVaultRepository.delete).toHaveBeenCalledTimes(1);
    });

    it('returns 412 when the optional ifMatch version is stale', async () => {
      mockTenantsCacheManager.getTenantDid.mockResolvedValue(testServerDid as any);
      mockVaultRepository.get.mockResolvedValue({
        id: 'immunization-mistake', audit: { creatorDid },
        'Immunization.subject': subjectDid, 'Immunization.meta.versionId': 'version-current',
      } as any);
      const response = await communicationManager.process(buildClinicalBatchJob([{
        type: 'Immunization-delete-request-v1.0',
        request: { method: 'DELETE', url: 'Immunization/immunization-mistake', ifMatch: 'W/"version-stale"' },
        resource: { resourceType: 'Immunization', id: 'immunization-mistake', meta: { claims: {} } },
      }]));
      expect((response.body as any).data[0].response.status).toBe('412');
      expect(mockVaultRepository.delete).not.toHaveBeenCalled();
    });

    it('lets the authenticated creator replace the same clinical resource through PUT', async () => {
      mockTenantsCacheManager.getTenantDid.mockResolvedValue(testServerDid as any);
      mockVaultRepository.get.mockResolvedValue({
        id: 'observation-existing', audit: { creatorDid },
        'Observation.subject': subjectDid, 'Observation.meta.versionId': 'version-current',
      } as any);
      const response = await communicationManager.process(buildClinicalBatchJob([{
        type: 'Observation-update-request-v1.0',
        request: { method: 'PUT', url: 'Observation/observation-existing', ifMatch: 'W/"version-current"' },
        resource: {
          resourceType: 'Observation', id: 'observation-existing',
          subject: { reference: subjectDid }, status: 'final', code: { text: 'Corrected result' },
        },
      }]));
      expect((response.body as any).data[0]).toEqual(expect.objectContaining({
        id: 'observation-existing', response: expect.objectContaining({ status: '200' }),
      }));
      expect(mockVaultRepository.put).toHaveBeenCalledWith(
        'animal-care_acme',
        [expect.objectContaining({ id: 'observation-existing', audit: expect.objectContaining({ creatorDid }) })],
        expect.any(String),
      );
    });

    it('replaces a same-id Observation and its enabled digital-twin projection from native PUT fields even when meta.claims is stale', async () => {
      const tenantVaultId = 'animal-care_acme';
      const effectiveDateTime = '2026-09-12';
      mockTenantsCacheManager.getTenantDid.mockResolvedValue(testServerDid as any);
      await mockVaultRepository.put(tenantVaultId, [{
        id: defaultAssignmentIdentifier,
        kind: FhirIpsCreatorKinds.Professional,
        actorIdentifier: `urn:uuid:${EXAMPLE_KYC_CONTROLLER_USER_UUID}`,
        authorIdentifier: defaultAssignmentIdentifier,
        ownerIdentifier: defaultAssignmentIdentifier,
        role: EXAMPLE_RELATED_PERSON_ROLE,
        actorDids: [creatorDid],
      } as any], getClinicalCreatorBindingsSectionId());
      mockVaultRepository.listContainersInSection.mockImplementation(async (vaultId, sectionId) =>
        Array.from(storedRecords.entries())
          .filter(([key]) => key.startsWith(`${vaultId}|${sectionId}|`))
          .map(([, record]) => record) as any);
      mockVaultRepository.getAllSections.mockImplementation(async (vaultId) =>
        Array.from(new Set(Array.from(storedRecords.keys())
          .filter((key) => key.startsWith(`${vaultId}|`))
          .map((key) => key.split('|')[1])
          .filter(Boolean))) as any);
      mockVaultRepository.query.mockImplementation(async (vaultId, query) => {
        const sectionId = String(query?.sectionId || '');
        return Array.from(storedRecords.entries())
          .filter(([key]) => key.startsWith(`${vaultId}|${sectionId}|`))
          .map(([, record]) => record)
          .filter((record) => (query?.where || []).every((condition: any) =>
            record.indexed?.attributes?.some((attribute: any) =>
              attribute.name === condition.name && attribute.value === condition.value))) as any;
      });
      const recordId = 'observation-same-id';
      await communicationManager.process(buildClinicalBatchJob([{
        type: 'Observation-create-request-v1.0',
        request: { method: 'POST', url: 'Observation' },
        resource: {
          resourceType: 'Observation', id: recordId,
          subject: { reference: subjectDid }, status: 'preliminary',
          code: { text: 'Telephone assistant observation' },
        },
      }]));
      const sourceSectionId = getSubjectScopedSectionId(subjectDid, 'individual', 'observations');
      const initialSource = storedRecords.get(`${tenantVaultId}|${sourceSectionId}|${recordId}`);
      const initialVersion = initialSource?.['Observation.meta.versionId'];
      expect(initialVersion).toBeDefined();

      await applyDigitalTwinSecondaryUseDecision({
        vaultRepository: mockVaultRepository,
        tenantVaultId,
        claims: { ...buildDemoResearchPermitByRoleConsent({ subjectDid }) },
      });
      const twinSubjectId = await getOrCreateDigitalTwinSubjectId({
        vaultRepository: mockVaultRepository,
        tenantVaultId,
        sourceSubject: subjectDid,
      });
      const twinSectionId = getSubjectScopedSectionId(twinSubjectId, 'digitaltwin', 'observations');
      expect(Array.from(storedRecords.keys()).filter((key) => key.startsWith(`${tenantVaultId}|${twinSectionId}|`)))
        .toHaveLength(0);

      terminologyServer = createServer((request, response) => {
        const url = new URL(request.url || '/', 'http://localhost');
        expect(url.pathname).toBe('/v1/terminology/labels');
        expect(url.searchParams.get('claim')).toBe('Observation.code');
        expect(`${url.searchParams.get('system')}|${url.searchParams.get('code')}`)
          .toBe(VitalSignsCodes.BodyTemperature.claim);
        response.writeHead(200, { 'content-type': 'application/vnd.api+json' });
        response.end(JSON.stringify({ data: {
          type: 'terminology-label', id: VitalSignsCodes.BodyTemperature.claim,
          attributes: {
            system: VitalSignsCodes.BodyTemperature.system,
            code: VitalSignsCodes.BodyTemperature.code,
            text: 'Temperatura corporal normalizada',
            display: VitalSignsCodes.BodyTemperature.display,
            textLanguage: 'es',
            displayLanguage: 'en',
          },
        } }));
      });
      await new Promise<void>((resolve) => terminologyServer!.listen(0, '127.0.0.1', resolve));
      const terminologyAddress = terminologyServer.address();
      if (!terminologyAddress || typeof terminologyAddress === 'string') throw new Error('Expected TCP address');
      process.env.RESEARCH_TERMINOLOGY_BASE_URL = `http://127.0.0.1:${terminologyAddress.port}`;
      process.env.RESEARCH_TERMINOLOGY_LABELS_ENABLED = 'true';

      const updateResponse = await communicationManager.process(renderClinicalBatchJobAsFhirR4(buildClinicalBatchJob([{
        type: 'Observation-update-request-v1.0',
        request: { method: 'PUT', url: `Observation/${recordId}`, ifMatch: `W/"${initialVersion}"` },
        resource: {
          resourceType: 'Observation', id: recordId,
          meta: { claims: {
            '@context': Format.FHIR_API,
            'Observation.subject': subjectDid,
            'Observation.status': 'preliminary',
            'Observation.code-text': 'Telephone assistant observation',
            'Observation.meta.versionId': initialVersion,
          } },
          subject: { reference: subjectDid }, status: 'final',
          code: { coding: [VitalSignsCodes.BodyTemperature] },
          valueQuantity: {
            value: EXAMPLE_VITAL_SIGN_VALUE_BODY_TEMPERATURE,
            unit: VitalSignsUnits.Celsius.display,
            system: VitalSignsUnits.Celsius.system,
            code: VitalSignsUnits.Celsius.code,
          },
          effectiveDateTime,
        },
      }])));

      expect((updateResponse.body as any).data[0].response.status).toBe('200');
      const updatedSource = storedRecords.get(`${tenantVaultId}|${sourceSectionId}|${recordId}`);
      const sourceClaim = (suffix: string) => updatedSource[
        Object.keys(updatedSource).find((key) => key.endsWith(suffix)) as string
      ];
      expect(sourceClaim('Observation.code')).toBe(VitalSignsCodes.BodyTemperature.claim);
      expect(sourceClaim('Observation.value-quantity-number'))
        .toBe(String(EXAMPLE_VITAL_SIGN_VALUE_BODY_TEMPERATURE));
      expect(sourceClaim('Observation.effective-datetime')).toBe(effectiveDateTime);
      expect(sourceClaim('Observation.meta.versionId')).not.toBe(initialVersion);

      const updatedTwin = Array.from(storedRecords.entries())
        .filter(([key]) => key.startsWith(`${tenantVaultId}|${twinSectionId}|`))
        .map(([, record]) => record)
        .find((record) => Object.keys(record).some((key) => key.endsWith('Observation.subject')));
      const twinClaim = (suffix: string) => updatedTwin?.[
        Object.keys(updatedTwin || {}).find((key) => key.endsWith(suffix)) as string
      ];
      expect(twinClaim('Observation.code')).toBe(VitalSignsCodes.BodyTemperature.claim);
      expect(twinClaim('Observation.value-quantity-number'))
        .toBe(String(EXAMPLE_VITAL_SIGN_VALUE_BODY_TEMPERATURE));
      expect(twinClaim('Observation.effective-datetime')).toBe(effectiveDateTime);
      expect(twinClaim('Observation.code-text')).toBe('Temperatura corporal normalizada');
      expect(twinClaim('Observation.code-display')).toBe(VitalSignsCodes.BodyTemperature.display);

      const searchTwinBy = async (text: string) => new TwinCompositionManager(mockVaultRepository).process({
          id: randomUUID(), status: JobStatus.DRAFT, sequence: 0, createdAtTimestamp: Date.now(),
          tenantId: 'acme', jurisdiction: 'ca-bc', sector: 'animal-care', section: 'digitaltwin',
          format: Format.FHIR_R4 as any, resourceType: 'ResearchSubject', action: '_search',
          content: {
            jti: randomUUID(), thid: randomUUID(), iss: creatorDid, aud: testServerDid,
            exp: Math.floor(Date.now() / 1000) + 300, type: 'org.hl7.fhir.api.Parameters',
            body: {
              resourceType: 'Parameters',
              parameter: [
                { name: 'text', valueString: text },
                { name: 'date-from', valueDate: '2026-01-01' },
                { name: 'section', valueString: HealthcareBasicSections.Results.attributeValue },
              ],
            },
          } as any,
        });
      expect(extractBundleSearchResources((await searchTwinBy(VitalSignsCodes.BodyTemperature.code)).body))
        .toHaveLength(1);
      expect(extractBundleSearchResources((await searchTwinBy(String(VitalSignsCodes.BodyTemperature.display))).body))
        .toHaveLength(1);
    });

    it('removes the correlated digital-twin projection when the creator deletes an erroneous record', async () => {
      // Step 1. The operational record has an enabled secondary-use projection and a stable twin alias.
      const twinSubjectDid = 'urn:uuid:7b419936-4999-4a18-b21e-681dc3e6a8c0';
      mockTenantsCacheManager.getTenantDid.mockResolvedValue(testServerDid as any);
      mockVaultRepository.get.mockImplementation(async (_vaultId: string, id: string, sectionId?: string) => {
        if (id === 'immunization-mistake') return {
          id: 'immunization-mistake',
          audit: { creatorDid },
          'Immunization.subject': subjectDid,
          'Immunization.meta.versionId': 'version-current',
        } as any;
        if (String(sectionId).includes('digitaltwin_secondary_use_status')) return { status: 'enabled' } as any;
        if (String(sectionId).includes('digitaltwin_subject_aliases')) return { twinSubjectId: twinSubjectDid } as any;
        return undefined;
      });
      mockVaultRepository.listContainersInSection.mockImplementation(async (_vaultId: string, sectionId: string) =>
        String(sectionId).includes('immunizations')
          ? [{
              id: 'research-immunization-mistake',
              audit: { creatorDid, sourceRecordId: 'immunization-mistake' },
              'Immunization.subject': twinSubjectDid,
            }] as any
          : []);

      // Step 2. One creator-authorized delete removes both the operational error and only its correlated projection.
      const response = await communicationManager.process(buildClinicalBatchJob([{
        type: 'Immunization-delete-request-v1.0',
        request: { method: 'DELETE', url: 'Immunization/immunization-mistake' },
        resource: { resourceType: 'Immunization', id: 'immunization-mistake', meta: { claims: {} } },
      }]));

      expect((response.body as any).data[0].response.status).toBe('204');
      expect(mockVaultRepository.delete).toHaveBeenCalledTimes(2);
      expect(mockVaultRepository.delete).toHaveBeenCalledWith(
        'animal-care_acme',
        'research-immunization-mistake',
        getSubjectScopedSectionId(twinSubjectDid, 'digitaltwin', 'immunizations'),
      );
    });

    it('keeps create success independent when another entry is forbidden', async () => {
      // Step 1. The delete target belongs to a different authenticated creator.
      mockTenantsCacheManager.getTenantDid.mockResolvedValue(testServerDid as any);
      mockVaultRepository.get.mockResolvedValue({
        id: 'allergy-owned-by-other', audit: { creatorDid: 'did:web:clinic-a.example:professionals:vet-2' },
        'AllergyIntolerance.subject': subjectDid, 'AllergyIntolerance.meta.versionId': 'version-current',
      } as any);

      // Step 2. Batch semantics preserve the successful create and report the failed delete separately.
      const response = await communicationManager.process(buildClinicalBatchJob([
        {
          type: 'Observation-create-request-v1.0', request: { method: 'POST', url: 'Observation' },
          resource: { resourceType: 'Observation', id: 'observation-new', meta: { claims: { 'Observation.subject': subjectDid } } },
        },
        {
          type: 'AllergyIntolerance-delete-request-v1.0',
          request: { method: 'DELETE', url: 'AllergyIntolerance/allergy-owned-by-other', ifMatch: 'W/"version-current"' },
          resource: { resourceType: 'AllergyIntolerance', id: 'allergy-owned-by-other', meta: { claims: {} } },
        },
      ]));
      expect((response.body as any).data).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: 'observation-new', response: expect.objectContaining({ status: '201' }) }),
        expect.objectContaining({ id: 'allergy-owned-by-other', response: expect.objectContaining({ status: '403' }) }),
      ]));
      expect(mockVaultRepository.put).toHaveBeenCalledWith(
        'animal-care_acme',
        [expect.objectContaining({ id: 'observation-new', audit: expect.objectContaining({ creatorDid }) })],
        expect.any(String),
      );
      expect(mockVaultRepository.delete).not.toHaveBeenCalled();
    });

    it('derives the organization author and exact PractitionerRole attester from the authenticated writer binding', async () => {
      // Flow contract:
      // 1. The animal remains the clinical subject while one authenticated
      //    employee submits a section batch on behalf of its legal organization.
      // 2. Composition.author is the governed organization URN and the exact
      //    PractitionerRole assignment is Composition.attester.
      // 3. A second active assignment of that organization may correct the
      //    content, but the previous attester cannot delete the new version.
      // Authorization invariant: the sender DID never becomes author/attester.
      // Persistence invariant: audit.creatorDid records the operational sender.
      mockTenantsCacheManager.getTenantDid.mockResolvedValue(testServerDid as any);
      const firstProfessionalAssignment = `urn:uuid:${EXAMPLE_KYC_CONTROLLER_UUID}`;
      const successorProfessionalAssignment = `urn:uuid:${EXAMPLE_KYC_CONTROLLER_USER_UUID}`;
      await mockVaultRepository.put('animal-care_acme', [{
        id: firstProfessionalAssignment,
        kind: FhirIpsCreatorKinds.Professional,
        actorIdentifier: `urn:uuid:${EXAMPLE_KYC_CONTROLLER_USER_UUID}`,
        authorIdentifier: firstProfessionalAssignment,
        ownerIdentifier: EXAMPLE_PROVIDER_ORGANIZATION_AUTHORIZATION_URN_CDS,
        role: 'ISCO-08|2250',
        actorDids: [EXAMPLE_PROFESSIONAL_DID],
      } as any, {
        id: successorProfessionalAssignment,
        kind: FhirIpsCreatorKinds.Professional,
        actorIdentifier: `urn:uuid:${EXAMPLE_CLIENT_INSTANCE_UUID}`,
        authorIdentifier: successorProfessionalAssignment,
        ownerIdentifier: EXAMPLE_PROVIDER_ORGANIZATION_AUTHORIZATION_URN_CDS,
        role: HealthcareActorRoles.VeterinaryTechnicianOrAssistant,
        actorDids: [creatorDid],
      } as any], getClinicalCreatorBindingsSectionId());
      mockVaultRepository.listContainersInSection.mockImplementation(async (vaultId: string, sectionId: string) =>
        [...storedRecords.entries()]
          .filter(([key]) => key.startsWith(`${vaultId}|${sectionId}|`))
          .map(([, value]) => value));

      const response = await communicationManager.process(buildClinicalBatchJob([{
        type: 'Observation-create-request-v1.0',
        request: { method: 'POST', url: 'Observation' },
        resource: {
          resourceType: 'Observation',
          id: 'observation-delegated-author',
          subject: { reference: subjectDid },
          status: 'final',
          code: { text: 'Reviewed result' },
        },
      }], EXAMPLE_PROVIDER_ORGANIZATION_AUTHORIZATION_URN_CDS, successorProfessionalAssignment));

      expect((response.body as any).data[0].response.status).toBe('201');
      expect(mockVaultRepository.put).toHaveBeenCalledWith(
        'animal-care_acme',
        [expect.objectContaining({
          id: 'observation-delegated-author',
          [CompositionClaim.Author]: EXAMPLE_PROVIDER_ORGANIZATION_AUTHORIZATION_URN_CDS,
          [CompositionClaim.Attester]: successorProfessionalAssignment,
          audit: expect.objectContaining({ creatorDid }),
        })],
        expect.any(String),
      );

      const delegatedUpdate = await communicationManager.process(buildClinicalBatchJob([{
        type: 'Observation-update-request-v1.0',
        request: { method: 'PUT', url: 'Observation/observation-delegated-author' },
        resource: {
          resourceType: 'Observation',
          id: 'observation-delegated-author',
          subject: { reference: subjectDid },
          status: 'final',
          code: { text: 'Changed by submitter' },
        },
      }], EXAMPLE_PROVIDER_ORGANIZATION_AUTHORIZATION_URN_CDS, successorProfessionalAssignment));
      expect((delegatedUpdate.body as any).data[0].response.status).toBe('200');

      const delegatedDelete = await communicationManager.process(buildClinicalBatchJob([{
        type: 'Observation-delete-request-v1.0',
        request: { method: 'DELETE', url: 'Observation/observation-delegated-author' },
      }], EXAMPLE_PROVIDER_ORGANIZATION_AUTHORIZATION_URN_CDS, firstProfessionalAssignment, EXAMPLE_PROFESSIONAL_DID));
      expect((delegatedDelete.body as any).data[0].response.status).toBe('403');
      expect(await mockVaultRepository.get(
        'animal-care_acme',
        'observation-delegated-author',
        getSubjectScopedSectionId(subjectDid, 'individual', 'observations'),
      )).toBeDefined();
    });

    it('returns 403 and persists no clinical resource for an unbound section attester', async () => {
      // Flow contract: an authenticated employee may transport the batch, but
      // only the exact assignment bound to that session may attest its content.
      mockTenantsCacheManager.getTenantDid.mockResolvedValue(testServerDid as any);
      await mockVaultRepository.put('animal-care_acme', [{
        id: `urn:uuid:${EXAMPLE_KYC_CONTROLLER_UUID}`,
        kind: FhirIpsCreatorKinds.Professional,
        actorIdentifier: `urn:uuid:${EXAMPLE_KYC_CONTROLLER_USER_UUID}`,
        authorIdentifier: `urn:uuid:${EXAMPLE_KYC_CONTROLLER_UUID}`,
        ownerIdentifier: EXAMPLE_PROVIDER_ORGANIZATION_AUTHORIZATION_URN_CDS,
        role: HealthcareActorRoles.VeterinaryTechnicianOrAssistant,
        actorDids: [creatorDid],
      } as any], getClinicalCreatorBindingsSectionId());
      mockVaultRepository.listContainersInSection.mockImplementation(async (vaultId: string, sectionId: string) =>
        [...storedRecords.entries()]
          .filter(([key]) => key.startsWith(`${vaultId}|${sectionId}|`))
          .map(([, value]) => value));

      const response = await communicationManager.process(buildClinicalBatchJob([{
        type: 'Observation-create-request-v1.0',
        request: { method: 'POST', url: 'Observation' },
        resource: { resourceType: 'Observation', id: 'observation-forged-attester', subject: { reference: subjectDid }, status: 'final' },
      }], EXAMPLE_PROVIDER_ORGANIZATION_AUTHORIZATION_URN_CDS, `urn:uuid:${EXAMPLE_CLIENT_INSTANCE_UUID}`));

      expect((response.body as any).data[0].response.status).toBe('403');
      expect(await mockVaultRepository.get(
        'animal-care_acme',
        'observation-forged-attester',
        getSubjectScopedSectionId(subjectDid, 'individual', 'observations'),
      )).toBeUndefined();
    });

    it('returns 403 when a completed section write has no authenticated creator binding', async () => {
      // Flow contract: a standalone GW cannot accept an author/attester merely
      // because both identifiers were supplied by the caller. Enrollment must
      // already have persisted the exact RESPRSN or PractitionerRole binding.
      mockTenantsCacheManager.getTenantDid.mockResolvedValue(testServerDid as any);
      mockVaultRepository.listContainersInSection.mockResolvedValue([]);

      const assignment = `urn:uuid:${EXAMPLE_KYC_CONTROLLER_UUID}`;
      const response = await communicationManager.process(buildClinicalBatchJob([{
        type: 'Observation-create-request-v1.0',
        request: { method: 'POST', url: 'Observation' },
        resource: { resourceType: 'Observation', id: 'observation-without-binding', subject: { reference: subjectDid }, status: 'final' },
      }], assignment, assignment));

      expect((response.body as any).data[0].response.status).toBe('403');
      expect(await mockVaultRepository.get(
        'animal-care_acme',
        'observation-without-binding',
        getSubjectScopedSectionId(subjectDid, 'individual', 'observations'),
      )).toBeUndefined();
    });

    it('returns 403 when an authenticated section write omits its attester', async () => {
      // Flow contract: SDK convenience may default the current profile
      // attester, but the GW wire contract still requires the resulting exact
      // assignment identifier on every completed section write.
      mockTenantsCacheManager.getTenantDid.mockResolvedValue(testServerDid as any);
      const assignment = `urn:uuid:${EXAMPLE_KYC_CONTROLLER_UUID}`;
      await mockVaultRepository.put('animal-care_acme', [{
        id: assignment,
        kind: FhirIpsCreatorKinds.IndividualMember,
        actorIdentifier: assignment,
        authorIdentifier: assignment,
        ownerIdentifier: assignment,
        role: 'RESPRSN',
        actorDids: [creatorDid],
      } as any], getClinicalCreatorBindingsSectionId());
      mockVaultRepository.listContainersInSection.mockImplementation(async (vaultId: string, sectionId: string) =>
        [...storedRecords.entries()]
          .filter(([key]) => key.startsWith(`${vaultId}|${sectionId}|`))
          .map(([, value]) => value));

      const response = await communicationManager.process(buildClinicalBatchJob([{
        type: 'Observation-create-request-v1.0',
        request: { method: 'POST', url: 'Observation' },
        resource: { resourceType: 'Observation', id: 'observation-without-attester', subject: { reference: subjectDid }, status: 'final' },
      }], assignment, null));

      expect((response.body as any).data[0].response.status).toBe('403');
      expect(await mockVaultRepository.get(
        'animal-care_acme',
        'observation-without-attester',
        getSubjectScopedSectionId(subjectDid, 'individual', 'observations'),
      )).toBeUndefined();
    });

    it.each(['preparation', 'not-done'])('keeps a %s telephone proposal in the inbox without projecting clinical state', async (status) => {
      // Flow contract: telephone intake is first transported as an auditable
      // Communication. Until an authorized member attests a completed version,
      // its attached batch must not alter the animal's clinical index.
      mockTenantsCacheManager.getTenantDid.mockResolvedValue(testServerDid as any);
      const response = await communicationManager.process(buildClinicalBatchJob([{
        type: 'MedicationStatement-create-request-v1.0',
        request: { method: 'POST', url: 'MedicationStatement' },
        resource: {
          resourceType: 'MedicationStatement',
          id: `telephone-medication-${status}`,
          subject: { reference: subjectDid },
          status: 'active',
        },
      }], undefined, undefined, creatorDid, status));

      expect((response.body as any).data[0].response.status).toBe('200');
      expect(await mockVaultRepository.get(
        'animal-care_acme',
        `telephone-medication-${status}`,
        getSubjectScopedSectionId(subjectDid, 'individual', 'medications'),
      )).toBeUndefined();
    });
  });

  describe('convertFhirToCommMsg', () => {
    it('should correctly convert a FHIR Communication resource to a CommMsgExtended object', () => {
      const fhirResource = { ...testCommunicationAppointmentFhirR4, resourceType: 'Communication' as const };
      const expectedCommMsg = testCommMsgExtAppointmentRequest;
      const testThid = expectedCommMsg.thid;
      
      const result = communicationManager.convertFhirToCommMsg(testThid, testServerDid, fhirResource);

      // --- Assertions for DIDComm properties ---
      expect(result.thid).toEqual(testThid);
      expect(result.to).toEqual(expectedCommMsg.to);
      // The 'from' field should now be the server DID, not the one from the FHIR resource
      expect(result.from).toEqual(testServerDid);
      expect(result).toHaveProperty('id');
      expect(typeof result.id).toBe('string');
      expect(result.created_time).toBeCloseTo(expectedCommMsg.nbf);

      // --- Assertions for body payload ---
      expect(result.body.data).toHaveLength(2);
      expect(result.body.data.some((item: DataEntry) => item.type === 'Annotation')).toBe(false);

      // 1. Verify Reference
      const referenceItem = result.body.data.find((item: DataEntry) => item.type === 'Reference');
      const expectedReference = expectedCommMsg.body.data.find((item: any) => item.type === 'Reference');
      expect(referenceItem).toBeDefined();
      expect(expectedReference).toBeDefined();
      if (referenceItem && expectedReference && expectedReference.resource) {
        expect(referenceItem.resource.reference).toEqual(expectedReference.resource.reference);
        expect(referenceItem.resource?.meta?.claims?.[CommunicationClaim.NoteText]).toEqual(testAppointmentRequestText);
        expect(typeof referenceItem.id).toBe('string');
      }

      // 2. Verify Attachment
      const attachmentItem = result.body.data.find((item: DataEntry) => item.type === 'Attachment');
      const expectedAttachment = expectedCommMsg.body.data.find((item: any) => item.type === 'Attachment');
      expect(attachmentItem).toBeDefined();
      expect(expectedAttachment).toBeDefined();
      if (attachmentItem && expectedAttachment && expectedAttachment.resource) {
        expect(attachmentItem.resource.contentType).toEqual(expectedAttachment.resource.contentType);
        expect(attachmentItem.resource.data).toEqual(expectedAttachment.resource.data);
        expect(attachmentItem.resource.title).toEqual(expectedAttachment.resource.title);
        expect(attachmentItem.resource?.meta?.claims?.[CommunicationClaim.NoteText]).toEqual(testAppointmentRequestText);
        expect(typeof attachmentItem.id).toBe('string');
      }
    });

    it('distributes note texts across payload entries when counts match', () => {
      const fhirResource = {
        resourceType: 'Communication' as const,
        status: 'completed',
        payload: [
          { contentReference: { reference: 'https://example.org/ref-1' } },
          { contentReference: { reference: 'https://example.org/ref-2' } },
        ],
        note: [
          { text: 'first note' },
          { text: 'second note' },
        ],
      };

      const result = communicationManager.convertFhirToCommMsg('thread-notes-001', testServerDid, fhirResource as any);

      expect(result.body.data).toHaveLength(2);
      expect(result.body.data[0].resource?.meta?.claims?.[CommunicationClaim.NoteText]).toBe('first note');
      expect(result.body.data[1].resource?.meta?.claims?.[CommunicationClaim.NoteText]).toBe('second note');
    });
  });

  describe('process (claims-only entries)', () => {
    it('accepts a data[] entry with canonical resource.meta.claims', async () => {
      mockTenantsCacheManager.getTenantDid.mockResolvedValue(testServerDid as any);

      const decoded: IDecodedDidcommPayload = {
        jti: randomUUID(),
        thid: 'emergency-intake-thread-id',
        iss: 'did:web:api.acme.org:individual:abc:device:xyz',
        aud: 'did:web:api.acme.org',
        exp: Math.floor(Date.now() / 1000) + 300,
        type: 'org.hl7.fhir.r4.Bundle',
        body: {
          resourceType: 'Bundle',
          type: 'batch',
          data: [
            {
              type: 'Communication',
              resource: {
                resourceType: 'Communication',
                meta: { claims: {
                  '@context': 'org.hl7.fhir.api',
                  '@type': 'Communication:EmergencyIntake',
                  'Communication.subject': 'did:web:api.acme.org:individual:abc',
                  'Communication.recipient': 'did:web:api.acme.org:individual:abc',
                  'Communication.sent': '2025-11-27T20:00:00Z',
                  'Communication.text': 'Alergias: soy alérgico al látex.',
                } },
              },
              request: { method: 'POST', url: 'individual/org.hl7.fhir.api/Communication' },
            },
          ],
        } as any,
      };

      const job: JobRequest = {
        id: randomUUID(),
        status: JobStatus.DRAFT,
        sequence: 0,
        createdAtTimestamp: Date.now(),
        tenantId: 'acme',
        jurisdiction: 'es',
        sector: 'emergency',
        section: 'individual',
        format: 'org.hl7.fhir.api' as any,
        resourceType: 'Communication',
        action: '_batch',
        content: decoded,
      };

      const response = await communicationManager.process(job);
      expect(response.body?.resourceType).toBe('Bundle');
      const data = (response.body as any).data;
      expect(Array.isArray(data)).toBe(true);
      expect(data[0].type).toBe('CommMsgExtended');
      expect(data[0].resource?.body?.data?.some((d: DataEntry) => d.type === 'Annotation')).toBe(true);
    });

    it('accepts a FHIR Bundle entry[] payload with canonical resource.meta.claims', async () => {
      mockTenantsCacheManager.getTenantDid.mockResolvedValue(testServerDid as any);

      const decoded: IDecodedDidcommPayload = {
        jti: randomUUID(),
        thid: 'emergency-intake-thread-id-entry',
        iss: 'did:web:api.acme.org:individual:abc:device:xyz',
        aud: 'did:web:api.acme.org',
        exp: Math.floor(Date.now() / 1000) + 300,
        type: 'org.hl7.fhir.r4.Bundle',
        body: {
          resourceType: 'Bundle',
          type: 'batch',
          entry: [
            {
              type: 'Communication',
              resource: {
                resourceType: 'Communication',
                meta: { claims: {
                  '@context': 'org.hl7.fhir.api',
                  '@type': 'Communication:EmergencyIntake',
                  'Communication.subject': 'did:web:api.acme.org:individual:abc',
                  'Communication.recipient': 'did:web:api.acme.org:individual:abc',
                  'Communication.sent': '2025-11-27T20:00:00Z',
                  'Communication.text': 'Alergias: soy alérgico al látex.',
                } },
              },
              request: { method: 'POST', url: 'individual/org.hl7.fhir.api/Communication' },
            },
          ],
        } as any,
      };

      const job: JobRequest = {
        id: randomUUID(),
        status: JobStatus.DRAFT,
        sequence: 0,
        createdAtTimestamp: Date.now(),
        tenantId: 'acme',
        jurisdiction: 'es',
        sector: 'emergency',
        section: 'individual',
        format: 'org.hl7.fhir.api' as any,
        resourceType: 'Communication',
        action: '_batch',
        content: decoded,
      };

      const response = await communicationManager.process(job);
      expect(response.body?.resourceType).toBe('Bundle');
      const data = (response.body as any).data;
      expect(Array.isArray(data)).toBe(true);
      expect(data[0].type).toBe('CommMsgExtended');
      expect(data[0].resource?.body?.data?.some((d: DataEntry) => d.type === 'Annotation')).toBe(true);
    });
  });

  describe('process (attachment to DocumentReference projection)', () => {
    const subjectDid = 'did:web:api.acme.org:individual:abc';

    it.each([
      ['application/fhir+json', Buffer.from(JSON.stringify({ resourceType: 'Observation', status: 'final' }), 'utf8').toString('base64')],
      ['application/pdf', Buffer.from('%PDF-1.7 fake', 'utf8').toString('base64')],
      ['image/png', Buffer.from('png-binary', 'utf8').toString('base64')],
      ['image/jpeg', Buffer.from('jpg-binary', 'utf8').toString('base64')],
    ])('persists DocumentReference projection for %s', async (contentType, dataBase64) => {
      mockTenantsCacheManager.getTenantDid.mockResolvedValue(testServerDid as any);
      mockVaultRepository.vaultExists.mockResolvedValue(true as any);

      const decoded: IDecodedDidcommPayload = {
        jti: randomUUID(),
        thid: `thid-${contentType}`,
        iss: 'did:web:sender.example',
        aud: 'did:web:receiver.example',
        exp: Math.floor(Date.now() / 1000) + 300,
        type: 'org.hl7.fhir.r4.Bundle',
        body: {
          resourceType: 'Bundle',
          type: 'batch',
          data: [
            {
              type: 'Communication',
              meta: {
                claims: {
                  '@context': 'org.hl7.fhir.r4',
                  'Communication.identifier': 'comm-audit-001',
                  'Communication.subject': subjectDid,
                  'Communication.recipient': subjectDid,
                  'Communication.sent': '2026-05-17T10:00:00Z',
                },
              },
              resource: {
                resourceType: 'Communication',
                status: 'completed',
                subject: { reference: subjectDid },
                recipient: [{ reference: subjectDid }],
                payload: [{ contentAttachment: { contentType, data: dataBase64, title: 'sample' } }],
              },
            },
          ],
        } as any,
      };

      const job: JobRequest = {
        id: randomUUID(),
        status: JobStatus.DRAFT,
        sequence: 0,
        createdAtTimestamp: Date.now(),
        tenantId: 'acme',
        jurisdiction: 'es',
        sector: 'health-care',
        section: 'individual',
        format: 'org.hl7.fhir.r4' as any,
        resourceType: 'Communication',
        action: '_batch',
        content: decoded,
      };

      await communicationManager.process(job);

      const tenantVaultId = 'health-care_acme';
      const docRefSectionId = getSubjectScopedSectionId(subjectDid, 'individual', 'document-references');
      const putCalls = mockVaultRepository.put.mock.calls.filter((args) => args[0] === tenantVaultId && args[2] === docRefSectionId);
      expect(putCalls.length).toBeGreaterThan(0);
      const record = (putCalls[0][1] as any[])[0];
      const readCanonicalClaim = (claim: string) => record[claim] || record[`${Format.FHIR_API}.${claim}`];
      expect(record['@context']).toBe(Format.FHIR_API);
      expect(readCanonicalClaim('DocumentReference.subject')).toBe(subjectDid);
      expect(readCanonicalClaim('DocumentReference.contenttype')).toBe(contentType);
      expect(String(readCanonicalClaim('DocumentReference.identifier')).startsWith('urn:uuid:')).toBe(true);
      expect(String(readCanonicalClaim('DocumentReference.contenthash')).startsWith('z')).toBe(true);
      expect(record[`${Format.FHIR_R4}.DocumentReference.subject`]).toBeUndefined();
    });

    it('does not persist the same DocumentReference attachment twice when contenthash already exists', async () => {
      mockTenantsCacheManager.getTenantDid.mockResolvedValue(testServerDid as any);
      mockVaultRepository.vaultExists.mockResolvedValue(true as any);

      const dataBase64 = Buffer.from('%PDF-1.7 fake', 'utf8').toString('base64');
      const decoded: IDecodedDidcommPayload = {
        jti: randomUUID(),
        thid: 'thid-pdf-dedupe-1',
        iss: 'did:web:sender.example',
        aud: 'did:web:receiver.example',
        exp: Math.floor(Date.now() / 1000) + 300,
        type: 'org.hl7.fhir.r4.Bundle',
        body: {
          resourceType: 'Bundle',
          type: 'batch',
          data: [
            {
              type: 'Communication',
              meta: {
                claims: {
                  '@context': 'org.hl7.fhir.r4',
                  'Communication.subject': subjectDid,
                  'Communication.sent': '2026-05-17T10:00:00Z',
                },
              },
              resource: {
                resourceType: 'Communication',
                status: 'completed',
                subject: { reference: subjectDid },
                payload: [{ contentAttachment: { contentType: 'application/pdf', data: dataBase64, title: 'sample' } }],
              },
            },
          ],
        } as any,
      };

      const job: JobRequest = {
        id: randomUUID(),
        status: JobStatus.DRAFT,
        sequence: 0,
        createdAtTimestamp: Date.now(),
        tenantId: 'acme',
        jurisdiction: 'es',
        sector: 'health-care',
        section: 'individual',
        format: 'org.hl7.fhir.r4' as any,
        resourceType: 'Communication',
        action: '_batch',
        content: decoded,
      };

      await communicationManager.process(job);

      const tenantVaultId = 'health-care_acme';
      const docRefSectionId = getSubjectScopedSectionId(subjectDid, 'individual', 'document-references');
      const firstDocRefPuts = mockVaultRepository.put.mock.calls.filter(
        (args) => args[0] === tenantVaultId && args[2] === docRefSectionId,
      );
      expect(firstDocRefPuts).toHaveLength(1);

      mockVaultRepository.put.mockClear();
      mockVaultRepository.query.mockResolvedValue([{ id: 'existing-docref' }] as any);

      await communicationManager.process({
        ...job,
        id: randomUUID(),
        content: { ...decoded, thid: 'thid-pdf-dedupe-2' },
      });

      const secondDocRefPuts = mockVaultRepository.put.mock.calls.filter(
        (args) => args[0] === tenantVaultId && args[2] === docRefSectionId,
      );
      expect(secondDocRefPuts).toHaveLength(0);
    });

    it('persists DocumentReference projection when Communication carries an embedded DocumentReference attachment', async () => {
      mockTenantsCacheManager.getTenantDid.mockResolvedValue(testServerDid as any);
      mockVaultRepository.vaultExists.mockResolvedValue(true as any);

      const embeddedDocumentReference = {
        resourceType: 'DocumentReference',
        id: 'docref-ips-001',
        subject: { reference: subjectDid },
        date: '2026-05-17T10:00:00Z',
        description: 'IPS Medication Summary',
        identifier: [{ value: 'urn:uuid:docref-ips-001' }],
        content: [
          {
            attachment: {
              contentType: 'application/fhir+json',
              title: 'ips-medications.json',
              data: Buffer.from(JSON.stringify({ resourceType: 'Bundle', type: 'document', entry: [] }), 'utf8').toString('base64'),
            },
          },
        ],
      };

      const decoded: IDecodedDidcommPayload = {
        jti: randomUUID(),
        thid: 'thid-docref-embedded',
        iss: 'did:web:sender.example',
        aud: 'did:web:receiver.example',
        exp: Math.floor(Date.now() / 1000) + 300,
        type: 'org.hl7.fhir.r4.Bundle',
        body: {
          resourceType: 'Bundle',
          type: 'batch',
          data: [
            {
              type: 'Communication',
              meta: {
                claims: {
                  '@context': 'org.hl7.fhir.r4',
                  'Communication.subject': subjectDid,
                  'Communication.sent': '2026-05-17T10:00:00Z',
                },
              },
              resource: {
                resourceType: 'Communication',
                status: 'completed',
                subject: { reference: subjectDid },
                payload: [{
                  contentAttachment: {
                    contentType: 'application/fhir+json',
                    title: 'docref.json',
                    data: Buffer.from(JSON.stringify(embeddedDocumentReference), 'utf8').toString('base64'),
                  },
                }],
              },
            },
          ],
        } as any,
      };

      const job: JobRequest = {
        id: randomUUID(),
        status: JobStatus.DRAFT,
        sequence: 0,
        createdAtTimestamp: Date.now(),
        tenantId: 'acme',
        jurisdiction: 'es',
        sector: 'health-care',
        section: 'individual',
        format: 'org.hl7.fhir.r4' as any,
        resourceType: 'Communication',
        action: '_batch',
        content: decoded,
      };

      await communicationManager.process(job);

      const tenantVaultId = 'health-care_acme';
      const docRefSectionId = getSubjectScopedSectionId(subjectDid, 'individual', 'document-references');
      const putCalls = mockVaultRepository.put.mock.calls.filter((args) => args[0] === tenantVaultId && args[2] === docRefSectionId);
      expect(putCalls.length).toBeGreaterThan(0);
      const record = (putCalls[0][1] as any[])[0];
      expect(record['DocumentReference.subject'] || record['org.hl7.fhir.r4.DocumentReference.subject']).toBe(subjectDid);
      expect(record['DocumentReference.identifier'] || record['org.hl7.fhir.r4.DocumentReference.identifier']).toBe('urn:uuid:docref-ips-001');
      expect(record['DocumentReference.description'] || record['org.hl7.fhir.r4.DocumentReference.description']).toBe('IPS Medication Summary');
      expect(record['DocumentReference.contenttype'] || record['org.hl7.fhir.r4.DocumentReference.contenttype']).toBe('application/fhir+json');
    });
  });

  describe('process (FHIR Bundle resource projections)', () => {
    const subjectDid = 'did:web:api.acme.org:individual:bundle-subject-001';

    it('persists a claims-first R5 EncounterHistory milestone carried by an authorized transfer Communication', async () => {
      // Flow contract:
      // 1. An authenticated professional sends one completed Communication for the exact subject.
      // 2. Its attached batch creates one R5 EncounterHistory milestone with a stable identifier.
      // 3. The manager stores flat claims in the subject encounter collection and returns 201.
      // Authorization invariant: Communication.subject and EncounterHistory.subject are identical.
      // Persistence invariant: the stored business state contains flat claims, never a nested FHIR resource.
      const encounterHistoryResourceType = 'EncounterHistory';
      const encounterHistoryId = '11111111-2222-4333-8444-555555555555';
      const encounterHistoryIdentifier = `urn:uuid:${encounterHistoryId}`;
      const encounterReference = 'Encounter/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
      const professionalDid = 'did:web:clinic-a.example:professionals:vet-encounter-transfer';
      const tenantVaultId = 'health-care_acme';
      const encounterHistoryClaims = {
        '@context': 'org.hl7.fhir.api',
        'EncounterHistory.identifier': encounterHistoryIdentifier,
        'EncounterHistory.encounter': encounterReference,
        'EncounterHistory.subject': subjectDid,
        'EncounterHistory.status': 'in-progress',
        'EncounterHistory.actual-period-start': '2026-10-04T16:00:00.000Z',
      };
      const attachedTransferBatch = {
        resourceType: ResourceTypesFhirR4.Bundle,
        type: BundleTypes.batch,
        data: [{
          request: { method: 'POST', url: encounterHistoryResourceType },
          resource: {
            resourceType: encounterHistoryResourceType,
            id: encounterHistoryId,
            meta: { claims: encounterHistoryClaims },
          },
        }],
      };
      const job: JobRequest = {
        id: randomUUID(),
        status: JobStatus.DRAFT,
        sequence: 0,
        createdAtTimestamp: Date.now(),
        tenantId: 'acme',
        jurisdiction: 'es',
        sector: 'health-care',
        section: 'individual',
        format: Format.FHIR_R4,
        resourceType: ResourceTypesFhirR4.Communication,
        action: '_batch',
        content: {
          jti: randomUUID(),
          thid: 'thread-encounter-transfer-history-001',
          iss: professionalDid,
          aud: testServerDid,
          exp: Math.floor(Date.now() / 1000) + 300,
          type: ResourceTypesFhirR4.Bundle,
          body: {
            resourceType: ResourceTypesFhirR4.Bundle,
            type: BundleTypes.batch,
            data: [{
              type: ResourceTypesFhirR4.Communication,
              resource: {
                resourceType: ResourceTypesFhirR4.Communication,
                status: 'completed',
                subject: { reference: subjectDid },
                payload: [{ contentAttachment: {
                  contentType: EXAMPLE_CONTENT_TYPE_FHIR_JSON,
                  data: Buffer.from(JSON.stringify(attachedTransferBatch), 'utf8').toString('base64'),
                } }],
              },
            }],
          },
        } as IDecodedDidcommPayload,
      };
      mockTenantsCacheManager.getTenantDid.mockResolvedValue(testServerDid as any);
      mockTenantsCacheManager.tenantExists.mockResolvedValue(true);
      mockVaultRepository.vaultExists.mockResolvedValue(true as any);

      const result = await communicationManager.process(job);

      expect((result.body as any).data).toEqual(expect.arrayContaining([
        expect.objectContaining({
          id: encounterHistoryId,
          response: expect.objectContaining({ status: '201' }),
        }),
      ]));
      const encounterSectionId = getSubjectScopedSectionId(subjectDid, 'individual', DataCollectionIds.encounters);
      const stored = await mockVaultRepository.get(tenantVaultId, encounterHistoryId, encounterSectionId) as any;
      expect(stored).toEqual(expect.objectContaining({
        '@context': encounterHistoryClaims['@context'],
        'org.hl7.fhir.api.EncounterHistory.identifier': encounterHistoryIdentifier,
        'org.hl7.fhir.api.EncounterHistory.encounter': encounterReference,
        'org.hl7.fhir.api.EncounterHistory.subject': subjectDid,
        'org.hl7.fhir.api.EncounterHistory.status': encounterHistoryClaims['EncounterHistory.status'],
        'org.hl7.fhir.api.EncounterHistory.actual-period-start': encounterHistoryClaims['EncounterHistory.actual-period-start'],
      }));
      expect(stored.resource).toBeUndefined();
      expect(stored.resourceType).toBeUndefined();
    });

    it('deletes only a version-matched clinical resource authored by the same linked controller identity', async () => {
      // Flow contract:
      // 1. A DCR-authenticated controller creates one allergy; the resource
      //    persists only that session's creator DID while its client alias is
      //    attached to the pre-imported stable assignment.
      // 2. An email-DID session already linked to that assignment deletes the
      //    exact resource version through a different authentication channel.
      // 3. A stale version fails 412; an unrelated, unbound professional may
      //    neither delete the existing fact nor create a sibling fact.
      // Authorization invariant: subject and linked verified creator must match.
      // Persistence invariant: no email, phone or stable hash enters the resource.
      const controllerDid = 'did:web:api.acme.org:individual:controller-delete-001';
      const linkedEmailDid = 'did:web:api.acme.org:individual:controller-delete-email-001';
      const controllerPhone = '+34600111222';
      const controllerEmail = 'controller.delete@example.org';
      const allergyId = 'allergy-controller-delete-001';
      const mixedCreateId = 'allergy-controller-mixed-create-001';
      const partialSuccessCreateId = 'allergy-partial-success-create-001';
      const section = 'LOINC|48765-2';
      const tenantVaultId = 'health-care_acme';
      mockTenantsCacheManager.getTenantDid.mockResolvedValue(testServerDid as any);
      mockVaultRepository.vaultExists.mockResolvedValue(true as any);
      await mockVaultRepository.put(tenantVaultId, [{
        id: `urn:uuid:${EXAMPLE_KYC_CONTROLLER_UUID}`,
        kind: FhirIpsCreatorKinds.IndividualMember,
        actorIdentifier: `urn:uuid:${EXAMPLE_KYC_CONTROLLER_USER_UUID}`,
        authorIdentifier: `urn:uuid:${EXAMPLE_KYC_CONTROLLER_UUID}`,
        ownerIdentifier: subjectDid,
        role: EXAMPLE_RELATED_PERSON_ROLE,
        actorDids: [controllerDid, linkedEmailDid],
      } as any], getClinicalCreatorBindingsSectionId());
      mockVaultRepository.listContainersInSection.mockImplementation(async (vaultId: string, sectionId: string) =>
        [...storedRecords.entries()]
          .filter(([key]) => key.startsWith(`${vaultId}|${sectionId}|`))
          .map(([, value]) => value));

      const buildJob = (
        attachedBundle: Record<string, any>,
        issuer: string,
        thid: string,
        bearerPayload?: Record<string, any>,
      ): JobRequest => {
        if (attachedBundle.type === BundleTypes.batch) {
          attachedBundle.meta = { ...(attachedBundle.meta || {}), claims: {
            ...(attachedBundle.meta?.claims || {}),
            [CompositionClaim.Author]: subjectDid,
            [CompositionClaim.Attester]: `urn:uuid:${EXAMPLE_KYC_CONTROLLER_UUID}`,
          } };
        }
        return ({
        id: randomUUID(),
        status: JobStatus.DRAFT,
        sequence: 0,
        createdAtTimestamp: Date.now(),
        tenantId: 'acme',
        jurisdiction: 'es',
        sector: 'health-care',
        section: 'individual',
        format: 'org.hl7.fhir.r4' as any,
        resourceType: 'Communication',
        action: '_batch',
        content: {
          jti: randomUUID(),
          thid,
          iss: issuer,
          aud: testServerDid,
          exp: Math.floor(Date.now() / 1000) + 300,
          type: 'org.hl7.fhir.r4.Bundle',
          body: {
            resourceType: 'Bundle',
            type: 'batch',
            data: [{
              type: 'Communication',
              resource: {
                resourceType: 'Communication',
                status: 'completed',
                subject: { reference: subjectDid },
                topic: { coding: [{ system: 'http://loinc.org', code: '48765-2' }] },
                payload: [{
                  contentAttachment: {
                    contentType: 'application/fhir+json',
                    data: Buffer.from(JSON.stringify(attachedBundle), 'utf8').toString('base64'),
                  },
                }],
              },
            }],
          },
          ...(bearerPayload ? { meta: { bearer: { jwt: { payload: bearerPayload } } } } : {}),
        } as IDecodedDidcommPayload,
        });
      };

      // Step 1. The individual controller authors one clinical resource.
      await communicationManager.process(buildJob({
        resourceType: 'Bundle',
        type: 'batch',
        entry: [{
          request: { method: 'POST', url: 'AllergyIntolerance' },
          resource: {
            resourceType: 'AllergyIntolerance',
            id: allergyId,
            identifier: [{ value: `urn:uuid:${allergyId}` }],
            patient: { reference: subjectDid },
          },
        }],
      }, controllerDid, 'clinical-create-before-delete-001', {
        sub: 'device-login-account-001',
        azp: EXAMPLE_CLIENT_INSTANCE_UUID,
      }));

      const allergySectionId = getSubjectScopedSectionId(subjectDid, 'individual', 'allergies');
      const stored = await mockVaultRepository.get(tenantVaultId, allergyId, allergySectionId) as any;
      // The animal is the subject/owner author; the authenticated human
      // controller's RelatedPerson assignment attests this version.
      expect(stored?.[CompositionClaim.Author]).toBe(subjectDid);
      expect(stored?.[CompositionClaim.Attester]).toBe(`urn:uuid:${EXAMPLE_KYC_CONTROLLER_UUID}`);
      expect(stored?.audit?.creatorDid).toBe(controllerDid);
      expect(Object.keys(stored || {}).some((key) => /email|phone|contact/i.test(key))).toBe(false);
      expect(JSON.stringify(stored)).not.toContain(controllerPhone);
      expect(JSON.stringify(stored)).not.toContain(controllerEmail);
      const creatorBinding = await mockVaultRepository.get(
        tenantVaultId,
        `urn:uuid:${EXAMPLE_KYC_CONTROLLER_UUID}`,
        getClinicalCreatorBindingsSectionId(),
      ) as any;
      expect(creatorBinding.dcrClientIds).toContain(EXAMPLE_CLIENT_INSTANCE_UUID);
      const versionId = stored?.['AllergyIntolerance.meta.versionId'];
      expect(versionId).toBeTruthy();

      // Step 2. The same authenticated controller deletes exactly that version.
      const deleteResult = await communicationManager.process(buildJob({
        resourceType: 'Bundle',
        type: 'batch',
        entry: [
          {
            request: { method: 'POST', url: 'AllergyIntolerance' },
            resource: {
              resourceType: 'AllergyIntolerance',
              id: mixedCreateId,
              identifier: [{ value: `urn:uuid:${mixedCreateId}` }],
              patient: { reference: subjectDid },
            },
          },
          {
            request: {
              method: 'DELETE',
              url: `AllergyIntolerance/${allergyId}`,
              ifMatch: `W/"${versionId}"`,
            },
          },
        ],
      }, linkedEmailDid, 'clinical-delete-001', {
        sub: 'email-login-account-002',
        email: controllerEmail,
        email_verified: true,
      }));

      // Step 3. The fact is absent and the per-entry batch result is 204.
      expect(mockVaultRepository.delete).toHaveBeenCalledWith(tenantVaultId, allergyId, allergySectionId);
      expect(await mockVaultRepository.get(tenantVaultId, allergyId, allergySectionId)).toBeUndefined();
      expect(await mockVaultRepository.get(tenantVaultId, mixedCreateId, allergySectionId)).toBeDefined();
      expect((deleteResult.body as any).data).toEqual(expect.arrayContaining([
        expect.objectContaining({
          id: allergyId,
          response: { status: '204' },
        }),
      ]));

      // Step 4. A different actor cannot delete a controller-authored resource.
      await communicationManager.process(buildJob({
        resourceType: 'Bundle',
        type: 'batch',
        entry: [{
          request: { method: 'POST', url: 'AllergyIntolerance' },
          resource: {
            resourceType: 'AllergyIntolerance',
            id: allergyId,
            identifier: [{ value: `urn:uuid:${allergyId}` }],
            patient: { reference: subjectDid },
          },
        }],
      }, linkedEmailDid, 'clinical-recreate-before-forbidden-delete-001', {
        sub: 'email-login-account-002',
        email: controllerEmail,
        email_verified: true,
        phone_number: controllerPhone,
      }));
      const recreated = await mockVaultRepository.get(tenantVaultId, allergyId, allergySectionId) as any;
      const staleResult = await communicationManager.process(buildJob({
        resourceType: 'Bundle',
        type: 'batch',
        entry: [{
          request: {
            method: 'DELETE',
            url: `AllergyIntolerance/${allergyId}`,
            ifMatch: 'W/"stale-version"',
          },
        }],
      }, controllerDid, 'clinical-delete-stale-version-001', {
        sub: 'phone-login-account-001',
        phone_number: controllerPhone,
      }));
      expect((staleResult.body as any).data).toEqual(expect.arrayContaining([
        expect.objectContaining({ response: expect.objectContaining({ status: '412' }) }),
      ]));
      expect(await mockVaultRepository.get(tenantVaultId, allergyId, allergySectionId)).toBeDefined();

      const forbiddenResult = await communicationManager.process(buildJob({
        resourceType: 'Bundle',
        type: 'batch',
        entry: [
          {
            request: { method: 'POST', url: 'AllergyIntolerance' },
            resource: {
              resourceType: 'AllergyIntolerance',
              id: partialSuccessCreateId,
              identifier: [{ value: `urn:uuid:${partialSuccessCreateId}` }],
              patient: { reference: subjectDid },
            },
          },
          {
            request: {
              method: 'DELETE',
              url: `AllergyIntolerance/${allergyId}`,
              ifMatch: recreated['AllergyIntolerance.meta.versionId'],
            },
          },
        ],
      }, 'did:web:api.acme.org:employee:professional-001', 'clinical-delete-forbidden-001', {
        sub: 'different-professional-account-001',
        email: 'different.professional@example.org',
        email_verified: true,
      }));
      expect((forbiddenResult.body as any).data).toEqual(expect.arrayContaining([
        expect.objectContaining({
          id: partialSuccessCreateId,
          response: expect.objectContaining({ status: '403' }),
        }),
        expect.objectContaining({ response: expect.objectContaining({ status: '403' }) }),
      ]));
      expect(await mockVaultRepository.get(tenantVaultId, partialSuccessCreateId, allergySectionId)).toBeUndefined();
      expect(await mockVaultRepository.get(tenantVaultId, allergyId, allergySectionId)).toBeDefined();
    });

    it('keeps the submitter independent from the author and allows only a later same-organization document successor', async () => {
      mockTenantsCacheManager.getTenantDid.mockResolvedValue(testServerDid as any);
      mockVaultRepository.vaultExists.mockResolvedValue(true as any);
      const allergyId = EXAMPLE_ALLERGY_IDENTIFIER.split(':').at(-1)!;
      const tenantId = EXAMPLE_PROVIDER_ORGANIZATION_DID.split(':').at(-1)!;
      const bearerPayload = { sub: EXAMPLE_PROFESSIONAL_DID };
      const buildJob = (
        attachment: Record<string, any>,
        authenticatedIdentity: Record<string, any> = bearerPayload,
      ): JobRequest => ({
        id: randomUUID(),
        status: JobStatus.DRAFT,
        sequence: 0,
        createdAtTimestamp: Date.now(),
        tenantId,
        jurisdiction: EXAMPLE_HEALTHCARE_JURISDICTION,
        sector: Sector.HEALTH_CARE,
        section: 'individual',
        format: Format.FHIR_R4,
        resourceType: ResourceTypesFhirR4.Communication,
        action: '_batch',
        content: {
          jti: randomUUID(),
          thid: randomUUID(),
          iss: EXAMPLE_PROVIDER_ORGANIZATION_DID,
          aud: testServerDid,
          type: ResourceTypesFhirR4.Bundle,
          meta: { bearer: { jwt: { payload: authenticatedIdentity } } },
          body: {
            resourceType: ResourceTypesFhirR4.Bundle,
            type: BundleTypes.batch,
            data: [{
              type: ResourceTypesFhirR4.Communication,
              resource: {
                resourceType: ResourceTypesFhirR4.Communication,
                status: 'completed',
                subject: { reference: EXAMPLE_SUBJECT_DID },
                topic: { text: EXAMPLE_CLINICAL_SECTION_ALLERGIES },
                payload: [{ contentAttachment: {
                  contentType: EXAMPLE_CONTENT_TYPE_FHIR_JSON,
                  data: Buffer.from(JSON.stringify(attachment), 'utf8').toString('base64'),
                } }],
              },
            }],
          },
        } as IDecodedDidcommPayload,
      });
      const clinicalDocument = {
        resourceType: ResourceTypesFhirR4.Bundle,
        type: BundleTypes.document,
        entry: [{ resource: {
          resourceType: ResourceTypesFhirR4.Composition,
          id: EXAMPLE_IPS_COMPOSITION_IDENTIFIER,
          status: 'final',
          subject: { reference: EXAMPLE_SUBJECT_DID },
          author: [{ reference: EXAMPLE_PROFESSIONAL_DID }],
          section: [{
            code: { text: EXAMPLE_CLINICAL_SECTION_ALLERGIES },
            entry: [{ reference: `${ResourceTypesFhirR4.AllergyIntolerance}/${allergyId}` }],
          }],
        } }, { resource: {
          resourceType: ResourceTypesFhirR4.AllergyIntolerance,
          id: allergyId,
          identifier: [{ value: EXAMPLE_ALLERGY_IDENTIFIER }],
          patient: { reference: EXAMPLE_SUBJECT_DID },
        } }],
      };

      const tenantVaultId = `${Sector.HEALTH_CARE}_${tenantId}`;
      await mockVaultRepository.put(tenantVaultId, [{
        id: `urn:uuid:${EXAMPLE_KYC_CONTROLLER_UUID}`,
        kind: FhirIpsCreatorKinds.Professional,
        actorIdentifier: `urn:uuid:${EXAMPLE_KYC_CONTROLLER_USER_UUID}`,
        authorIdentifier: `urn:uuid:${EXAMPLE_KYC_CONTROLLER_UUID}`,
        ownerIdentifier: EXAMPLE_PROVIDER_ORGANIZATION_DID,
        role: 'ISCO-08|2250',
        actorDids: [EXAMPLE_PROFESSIONAL_DID],
      } as any], getClinicalCreatorBindingsSectionId());
      mockVaultRepository.listContainersInSection.mockImplementation(async (vaultId: string, sectionId: string) =>
        [...storedRecords.entries()]
          .filter(([key]) => key.startsWith(`${vaultId}|${sectionId}|`))
          .map(([, value]) => value));
      await communicationManager.process(buildJob(clinicalDocument, { sub: EXAMPLE_CONTROLLER_DID }));
      const sectionId = getSubjectScopedSectionId(EXAMPLE_SUBJECT_DID, 'individual', 'allergies');
      const stored = await mockVaultRepository.get(tenantVaultId, allergyId, sectionId) as any;
      expect(stored?.['Composition.author']).toBe(EXAMPLE_PROFESSIONAL_DID);
      expect(stored?.audit).toEqual(expect.objectContaining({
        creatorDid: EXAMPLE_CONTROLLER_DID,
        submitterDid: EXAMPLE_CONTROLLER_DID,
      }));

      const changedDocument = structuredClone(clinicalDocument);
      (changedDocument.entry[1].resource as any).onsetDateTime = EXAMPLE_ALLERGY_ONSET_DATE_TIME;
      await communicationManager.process(buildJob(changedDocument, { sub: EXAMPLE_CONTROLLER_DID }));
      const afterDelegatedUpdate = await mockVaultRepository.get(tenantVaultId, allergyId, sectionId) as any;
      expect(
        afterDelegatedUpdate?.['AllergyIntolerance.onset-datetime']
        || afterDelegatedUpdate?.['org.hl7.fhir.api.AllergyIntolerance.onset-datetime'],
      ).toBeUndefined();

      await communicationManager.process(buildJob(changedDocument));
      const afterAuthorUpdate = await mockVaultRepository.get(tenantVaultId, allergyId, sectionId) as any;
      expect(
        afterAuthorUpdate?.['AllergyIntolerance.onset-datetime']
        || afterAuthorUpdate?.['org.hl7.fhir.api.AllergyIntolerance.onset-datetime'],
      ).toBe(EXAMPLE_ALLERGY_ONSET_DATE_TIME);

      // DELETE is the exact FHIR batch wire behavior under test; the shared HTTP catalog has no delete member yet.
      const deleteBundle = {
        resourceType: ResourceTypesFhirR4.Bundle,
        type: BundleTypes.batch,
        entry: [{ request: {
          method: 'DELETE',
          url: `${ResourceTypesFhirR4.AllergyIntolerance}/${allergyId}`,
        } }],
      };
      const otherActorDeletion = await communicationManager.process(buildJob(deleteBundle, {
        sub: testServerDid,
      }));
      expect((otherActorDeletion.body as any).data[0].response.status).toBe('403');
      expect(await mockVaultRepository.get(tenantVaultId, allergyId, sectionId)).toBeDefined();

      const verifiedDeletion = await communicationManager.process(buildJob(deleteBundle));
      expect((verifiedDeletion.body as any).data[0].response.status).toBe('204');
      expect(await mockVaultRepository.get(tenantVaultId, allergyId, sectionId)).toBeUndefined();

      const externallyAuthoredDocument = structuredClone(clinicalDocument);
      (externallyAuthoredDocument.entry[0].resource as any).author = [{
        reference: EXAMPLE_PROVIDER_ORGANIZATION_DID,
      }];
      (externallyAuthoredDocument.entry[0].resource as any).date = '2026-09-01T10:00:00.000Z';
      externallyAuthoredDocument.entry.push({
        fullUrl: EXAMPLE_PROVIDER_ORGANIZATION_DID,
        resource: {
          resourceType: ResourceTypesFhirR4.Organization,
          id: EXAMPLE_KYC_CONTROLLER_UUID,
        },
      } as any);
      await communicationManager.process(buildJob(externallyAuthoredDocument));
      const externallyAuthoredRecord = await mockVaultRepository.get(
        tenantVaultId,
        allergyId,
        sectionId,
      ) as any;
      expect(externallyAuthoredRecord?.['Composition.author']).toBe(EXAMPLE_PROVIDER_ORGANIZATION_DID);
      expect(externallyAuthoredRecord?.audit).toEqual(expect.objectContaining({
        creatorDid: EXAMPLE_PROFESSIONAL_DID,
        submitterDid: EXAMPLE_PROFESSIONAL_DID,
        authorOwnerIdentifier: EXAMPLE_PROVIDER_ORGANIZATION_DID,
        documentDate: '2026-09-01T10:00:00.000Z',
      }));

      const forbiddenExternalOverwrite = structuredClone(externallyAuthoredDocument);
      (forbiddenExternalOverwrite.entry[1].resource as any).onsetDateTime = EXAMPLE_ALLERGY_ONSET_DATE_TIME;
      await communicationManager.process(buildJob(forbiddenExternalOverwrite));
      const unchangedExternalRecord = await mockVaultRepository.get(tenantVaultId, allergyId, sectionId) as any;
      expect(
        unchangedExternalRecord?.['AllergyIntolerance.onset-datetime']
        || unchangedExternalRecord?.['org.hl7.fhir.api.AllergyIntolerance.onset-datetime'],
      ).toBeUndefined();

      const laterSameOrganizationDocument = structuredClone(forbiddenExternalOverwrite);
      (laterSameOrganizationDocument.entry[0].resource as any).date = '2026-09-01T10:01:00.000Z';
      await communicationManager.process(buildJob(laterSameOrganizationDocument));
      const replacedByOrganization = await mockVaultRepository.get(tenantVaultId, allergyId, sectionId) as any;
      expect(
        replacedByOrganization?.['AllergyIntolerance.onset-datetime']
        || replacedByOrganization?.['org.hl7.fhir.api.AllergyIntolerance.onset-datetime'],
      ).toBe(EXAMPLE_ALLERGY_ONSET_DATE_TIME);

      const forbiddenExternalDeletion = await communicationManager.process(buildJob(deleteBundle));
      expect((forbiddenExternalDeletion.body as any).data[0].response.status).toBe('403');
      expect(await mockVaultRepository.get(tenantVaultId, allergyId, sectionId)).toBeDefined();
    });

    it('normalizes a native EHR section update without meta.claims and never invents a medication section', async () => {
      mockTenantsCacheManager.getTenantDid.mockResolvedValue(testServerDid as any);
      mockVaultRepository.vaultExists.mockResolvedValue(true as any);

      const section = 'LOINC|48765-2';
      const senderDid = 'did:web:sender.example';
      const assignmentIdentifier = `urn:uuid:${EXAMPLE_KYC_CONTROLLER_UUID}`;
      const tenantVaultId = 'health-care_acme';
      await mockVaultRepository.put(tenantVaultId, [{
        id: assignmentIdentifier,
        kind: FhirIpsCreatorKinds.IndividualMember,
        actorIdentifier: `urn:uuid:${EXAMPLE_KYC_CONTROLLER_USER_UUID}`,
        authorIdentifier: assignmentIdentifier,
        ownerIdentifier: subjectDid,
        role: EXAMPLE_RELATED_PERSON_ROLE,
        actorDids: [senderDid],
      } as any], getClinicalCreatorBindingsSectionId());
      mockVaultRepository.listContainersInSection.mockImplementation(async (vaultId: string, sectionId: string) =>
        [...storedRecords.entries()]
          .filter(([key]) => key.startsWith(`${vaultId}|${sectionId}|`))
          .map(([, value]) => value));
      const sectionBatch = {
        resourceType: 'Bundle',
        type: 'batch',
        meta: { claims: {
          [CompositionClaim.Author]: subjectDid,
          [CompositionClaim.Attester]: assignmentIdentifier,
        } },
        data: [{
          type: 'AllergyIntolerance-edit-request-v1.0',
          resource: {
            resourceType: 'AllergyIntolerance',
            id: 'allergy-section-update-001',
            identifier: [{ value: 'urn:uuid:allergy-section-update-001' }],
            patient: { reference: subjectDid },
            language: 'es',
            code: {
              text: 'http://snomed.info/sct|91935009',
              coding: [{ system: 'http://snomed.info/sct', code: '91935009', display: 'Peanut' }],
            },
            meta: { claims: {
              'AllergyIntolerance.code-text': 'Cacahuete',
              'AllergyIntolerance.code-display': 'Peanut',
            } },
            clinicalStatus: { coding: [{ code: 'active' }] },
            category: ['food'],
            criticality: 'high',
            onsetDateTime: '2026-07-24T10:00:00Z',
          },
        }],
      };
      const decoded: IDecodedDidcommPayload = {
        jti: randomUUID(),
        thid: 'thread-allergy-section-update-001',
        iss: senderDid,
        aud: 'did:web:receiver.example',
        exp: Math.floor(Date.now() / 1000) + 300,
        type: 'org.hl7.fhir.r4.Bundle',
        body: {
          resourceType: 'Bundle',
          type: 'batch',
          data: [{
            type: 'Communication',
            resource: {
              resourceType: 'Communication',
              status: 'completed',
              subject: { reference: subjectDid },
              payload: [
                {
                  contentCodeableConcept: {
                    coding: [{ system: 'http://loinc.org', code: '48765-2' }],
                  },
                },
                {
                contentAttachment: {
                  contentType: 'application/fhir+json',
                  data: Buffer.from(JSON.stringify(sectionBatch), 'utf8').toString('base64'),
                },
                },
              ],
            },
          }],
        } as any,
      };
      const job: JobRequest = {
        id: randomUUID(),
        status: JobStatus.DRAFT,
        sequence: 0,
        createdAtTimestamp: Date.now(),
        tenantId: 'acme',
        jurisdiction: 'es',
        sector: 'health-care',
        section: 'individual',
        format: 'org.hl7.fhir.r4' as any,
        resourceType: 'Communication',
        action: '_batch',
        content: decoded,
      };

      await communicationManager.process(job);

      const allergySectionId = getSubjectScopedSectionId(subjectDid, 'individual', 'allergies');
      const allergyPut = mockVaultRepository.put.mock.calls.find(
        (args) => args[0] === tenantVaultId && args[2] === allergySectionId,
      );
      expect(allergyPut).toBeDefined();
      const allergyRecord = (allergyPut?.[1] as any[])[0];
      expect(
        allergyRecord['AllergyIntolerance.identifier']
        || allergyRecord['org.hl7.fhir.api.AllergyIntolerance.identifier']
        || allergyRecord['org.hl7.fhir.r4.AllergyIntolerance.identifier'],
      ).toBe('urn:uuid:allergy-section-update-001');
      expect(
        allergyRecord['AllergyIntolerance.subject']
        || allergyRecord['org.hl7.fhir.api.AllergyIntolerance.subject']
        || allergyRecord['org.hl7.fhir.r4.AllergyIntolerance.subject'],
      ).toBe(subjectDid);
      expect(
        allergyRecord['AllergyIntolerance.code']
        || allergyRecord['org.hl7.fhir.api.AllergyIntolerance.code']
        || allergyRecord['org.hl7.fhir.r4.AllergyIntolerance.code'],
      ).toBe('http://snomed.info/sct|91935009');
      expect(
        allergyRecord['AllergyIntolerance.code-text']
        || allergyRecord['org.hl7.fhir.api.AllergyIntolerance.code-text'],
      ).toBe('Cacahuete');
      expect(
        allergyRecord['AllergyIntolerance.code-text']
        || allergyRecord['org.hl7.fhir.api.AllergyIntolerance.code-text'],
      ).toBe('Cacahuete');
      expect(
        allergyRecord['AllergyIntolerance.code-display']
        || allergyRecord['org.hl7.fhir.api.AllergyIntolerance.code-display'],
      ).toBe('Peanut');
      expect(
        allergyRecord['AllergyIntolerance.code-text']
        || allergyRecord['org.hl7.fhir.api.AllergyIntolerance.code-text'],
      ).not.toBe(
        allergyRecord['AllergyIntolerance.code']
        || allergyRecord['org.hl7.fhir.api.AllergyIntolerance.code'],
      );
      expect(
        allergyRecord['AllergyIntolerance.clinical-status']
        || allergyRecord['org.hl7.fhir.api.AllergyIntolerance.clinical-status']
        || allergyRecord['org.hl7.fhir.r4.AllergyIntolerance.clinical-status'],
      ).toBe('active');
      const compositionRecords = mockVaultRepository.put.mock.calls
        .filter((args) => args[0] === tenantVaultId && args[2] === getSubjectScopedSectionId(subjectDid, 'individual', 'composition'))
        .flatMap((args) => args[1] as any[]);
      const projectedSections = compositionRecords.map((record) =>
        record['Composition.section'] || record['org.hl7.fhir.r4.Composition.section']);
      expect(projectedSections).toEqual([section]);
      expect(projectedSections).not.toContain('LOINC|10160-0');
      expect(compositionRecords).toEqual(expect.arrayContaining([
        expect.objectContaining({ '@context': Format.FHIR_API }),
      ]));
      expect(compositionRecords.some((record) =>
        Object.keys(record).some((key) => key.startsWith(`${Format.FHIR_R4}.Composition.`)))).toBe(false);
    });

    it('rejects an unscoped clinical batch instead of accepting an update that reads back empty', async () => {
      mockTenantsCacheManager.getTenantDid.mockResolvedValue(testServerDid as any);
      mockVaultRepository.vaultExists.mockResolvedValue(true as any);

      const unscopedBatch = {
        resourceType: 'Bundle',
        type: 'batch',
        data: [{
          type: 'AllergyIntolerance-edit-request-v1.0',
          resource: {
            resourceType: 'AllergyIntolerance',
            id: 'allergy-unscoped-001',
            meta: { claims: {
              '@context': 'org.hl7.fhir.api',
              'AllergyIntolerance.identifier': 'urn:uuid:allergy-unscoped-001',
              'AllergyIntolerance.subject': subjectDid,
            } },
          },
        }],
      };
      const decoded: IDecodedDidcommPayload = {
        jti: randomUUID(),
        thid: 'thread-allergy-unscoped-001',
        iss: 'did:web:sender.example',
        aud: 'did:web:receiver.example',
        exp: Math.floor(Date.now() / 1000) + 300,
        type: 'org.hl7.fhir.r4.Bundle',
        body: {
          resourceType: 'Bundle',
          type: 'batch',
          data: [{
            type: 'Communication',
            meta: { claims: {
              '@context': 'org.hl7.fhir.r4',
              'Communication.subject': subjectDid,
            } },
            resource: {
              resourceType: 'Communication',
              status: 'completed',
              subject: { reference: subjectDid },
              payload: [{
                contentAttachment: {
                  contentType: 'application/fhir+json',
                  data: Buffer.from(JSON.stringify(unscopedBatch), 'utf8').toString('base64'),
                },
              }],
            },
          }],
        } as any,
      };
      const job: JobRequest = {
        id: randomUUID(),
        status: JobStatus.DRAFT,
        sequence: 0,
        createdAtTimestamp: Date.now(),
        tenantId: 'acme',
        jurisdiction: 'es',
        sector: 'health-care',
        section: 'individual',
        format: 'org.hl7.fhir.r4' as any,
        resourceType: 'Communication',
        action: '_batch',
        content: decoded,
      };

      // Step 1: process the same generic Communication path that used to return a false success.
      const result = await communicationManager.process(job);

      // Step 2: expose the contract error in the batch response and persist no clinical projection.
      expect((result.body as any).data[0].response.status).toBe('500');
      expect((result.body as any).data[0].response.outcome.issue[0].details.text)
        .toContain('requires one explicit Composition.section');
      expect(mockVaultRepository.put.mock.calls.some(
        (args) => args[2] === getSubjectScopedSectionId(subjectDid, 'individual', 'allergies'),
      )).toBe(false);
    });

    it('indexes only resource-qualified meta tags from a document index entry with arbitrary extra fields', async () => {
      mockTenantsCacheManager.getTenantDid.mockResolvedValue(testServerDid as any);
      mockVaultRepository.vaultExists.mockResolvedValue(true as any);
      const immunizationId = '77777777-7777-4777-8777-777777777777';
      const immunizationReference = `Immunization/${immunizationId}`;
      const documentBundle = {
        resourceType: 'Bundle',
        type: 'document',
        // Exact HL7 Coding under test: this root marker, rather than a child
        // resource tag, opts the document into metadata-only index projection.
        meta: { tag: [{
          system: 'http://terminology.hl7.org/CodeSystem/v3-ObservationValue',
          code: 'SUBSETTED',
          display: 'subsetted',
        }] },
        entry: [{
          fullUrl: 'Composition/44444444-4444-4444-8444-444444444444',
          resource: {
            resourceType: 'Composition',
            id: '44444444-4444-4444-8444-444444444444',
            status: 'final',
            type: { coding: [{ system: 'http://loinc.org', code: '60591-5' }] },
            subject: { reference: subjectDid },
            date: '2026-09-11T12:00:00.000Z',
            author: [{ reference: 'did:web:sender.example' }],
            title: 'Veterinary document index',
            section: [{
              code: { coding: [{ system: 'http://loinc.org', code: '11369-6' }] },
              entry: [{ reference: immunizationReference }],
            }],
          },
        }, {
          fullUrl: immunizationReference,
          resource: {
            resourceType: 'Immunization',
            id: immunizationId,
            // These native fields are deliberately untrusted decoration on a
            // metadata-only document index row. Only allowlisted meta.tag
            // codings may enrich the already persisted private claims.
            status: 'completed',
            occurrenceDateTime: '2026-09-11T11:30:00.000Z',
            language: 'ignored-native-language',
            subject: { reference: 'Patient/ignored-native-subject' },
            note: [{ text: 'ignored-native-note' }],
            arbitraryPrivatePayload: { mustBeDiscarded: true },
            meta: {
              profile: ['https://example.org/StructureDefinition/non-authoritative-index-input'],
              claims: { 'Immunization.status': 'must-not-enter-index' },
              tag: [
                { system: 'Immunization.date', code: '2026-09-11T11:30:00.000Z' },
                { system: 'Immunization.reason-code', code: 'rabies' },
                { system: 'Immunization.reason-code', code: 'travel' },
                { system: 'Observation.status', code: 'ignored-wrong-resource' },
                { system: 'Immunization.secret', code: 'ignored-not-allowlisted' },
                { system: 'Immunization.note', display: 'ignored-malformed' },
              ],
            },
          },
        }],
      };
      const decoded: IDecodedDidcommPayload = {
        jti: randomUUID(),
        thid: 'thread-minimal-index-document-001',
        iss: 'did:web:sender.example',
        aud: 'did:web:receiver.example',
        exp: Math.floor(Date.now() / 1000) + 300,
        type: 'org.hl7.fhir.r4.Bundle',
        body: {
          resourceType: 'Bundle',
          type: 'batch',
          data: [{
            type: 'Communication',
            meta: { claims: {
              '@context': 'org.hl7.fhir.r4',
              'Communication.identifier': 'comm-minimal-index-document-001',
              'Communication.subject': subjectDid,
              'Communication.sent': '2026-09-11T12:00:00.000Z',
            } },
            resource: {
              resourceType: 'Communication',
              status: 'completed',
              subject: { reference: subjectDid },
              payload: [{ contentAttachment: {
                contentType: 'application/fhir+json',
                title: 'private-document-index.json',
                data: Buffer.from(JSON.stringify(documentBundle), 'utf8').toString('base64'),
              } }],
            },
          }],
        } as any,
      };
      const job: JobRequest = {
        id: randomUUID(), status: JobStatus.DRAFT, sequence: 0, createdAtTimestamp: Date.now(),
        tenantId: 'acme', jurisdiction: 'es', sector: 'health-care', section: 'individual',
        format: 'org.hl7.fhir.r4' as any, resourceType: 'Communication', action: '_batch', content: decoded,
      };
      const immunizationsSectionId = getSubjectScopedSectionId(subjectDid, 'individual', 'immunizations');
      storedRecords.set(`health-care_acme|${immunizationsSectionId}|${immunizationId}`, {
        id: immunizationId,
        '@context': 'org.hl7.fhir.api',
        'org.hl7.fhir.api.Immunization.subject': subjectDid,
        'org.hl7.fhir.api.Immunization.vaccine-code-text': 'Private clinical vaccine detail',
        [CompositionClaim.Author]: decoded.iss,
        audit: { creatorDid: decoded.iss },
        indexed: { attributes: [] },
      });

      await communicationManager.process(job);

      const immunizationPut = mockVaultRepository.put.mock.calls.find(
        (args) => args[2] === immunizationsSectionId,
      );
      expect(immunizationPut).toBeDefined();
      const record = (immunizationPut?.[1] as any[])[0];
      expect(record['Immunization.date'] || record['org.hl7.fhir.api.Immunization.date'])
        .toBe('2026-09-11T11:30:00.000Z');
      expect(record['Immunization.reason-code'] || record['org.hl7.fhir.api.Immunization.reason-code'])
        .toBe('rabies,travel');
      expect(record['Observation.status']).toBeUndefined();
      expect(record['Immunization.secret']).toBeUndefined();
      expect(record['Immunization.note']).toBeUndefined();
      expect(record['Immunization.status'] || record['org.hl7.fhir.api.Immunization.status'])
        .toBeUndefined();
      expect(record['Immunization.language'] || record['org.hl7.fhir.api.Immunization.language'])
        .toBeUndefined();
      expect(record['Immunization.occurrence'] || record['org.hl7.fhir.api.Immunization.occurrence'])
        .toBeUndefined();
      expect(record.arbitraryPrivatePayload).toBeUndefined();
      expect(record['Immunization.subject'] || record['org.hl7.fhir.api.Immunization.subject'])
        .toBe(subjectDid);
      expect(record['org.hl7.fhir.api.Immunization.vaccine-code-text'])
        .toBe('Private clinical vaccine detail');
      expect(record.indexed.attributes).toEqual(expect.arrayContaining([
        expect.objectContaining({ name: 'org.hl7.fhir.api.Immunization.date', value: '2026-09-11T11:30:00.000Z' }),
        expect.objectContaining({ name: 'org.hl7.fhir.api.Immunization.reason-code', value: 'rabies,travel' }),
      ]));
    });

    it('requires resourceType, id, and meta.tag before treating a SUBSETTED row as minimal', () => {
      const isMinimalDocumentIndexResource = (communicationManager as any)
        .isMinimalDocumentIndexResource.bind(communicationManager);

      expect(isMinimalDocumentIndexResource({
        resourceType: 'Immunization',
        id: 'immunization-index-001',
        meta: { tag: [] },
      }, true)).toBe(true);
      expect(isMinimalDocumentIndexResource({
        resourceType: 'Immunization',
        meta: { tag: [] },
      }, true)).toBe(false);
      expect(isMinimalDocumentIndexResource({
        resourceType: '',
        id: 'immunization-index-001',
        meta: { tag: [] },
      }, true)).toBe(false);
    });

    it('projects IPS resources from an attached document bundle with indexed claims', async () => {
      mockTenantsCacheManager.getTenantDid.mockResolvedValue(testServerDid as any);
      mockVaultRepository.vaultExists.mockResolvedValue(true as any);
      const twinSubjectId = await enableDigitalTwinSecondaryUse(subjectDid);

      const documentBundle = {
        resourceType: 'Bundle',
        type: 'document',
        entry: [
          {
            resource: {
              resourceType: 'Composition',
              id: 'ips-composition-001',
              status: 'final',
              identifier: { value: EXAMPLE_IPS_COMPOSITION_IDENTIFIER },
              subject: { reference: subjectDid },
              type: { coding: [{ system: 'http://loinc.org', code: '60591-5' }] },
              date: '2026-05-22T09:00:00Z',
              author: [{ reference: EXAMPLE_PROVIDER_ORGANIZATION_DID }],
              custodian: { reference: EXAMPLE_PROVIDER_ORGANIZATION_DID },
              section: [{
                code: { coding: [{ system: 'http://loinc.org', code: '10160-0' }] },
                entry: [
                  { reference: 'MedicationStatement/medication-001' },
                  { reference: 'Consent/medication-consent-001' },
                ],
              }, {
                code: { coding: [{ system: 'http://loinc.org', code: '8716-3' }] },
                entry: [{ reference: 'Observation/observation-001' }],
              }],
              attester: [
                {
                  mode: CompositionAttesterModes.Professional,
                  time: '2026-05-22T09:00:00Z',
                  party: { reference: `urn:uuid:${EXAMPLE_KYC_CONTROLLER_UUID}` },
                },
                {
                  mode: CompositionAttesterModes.Official,
                  time: '2026-05-22T09:01:00Z',
                  party: { reference: `urn:uuid:${EXAMPLE_KYC_CONTROLLER_USER_UUID}` },
                },
              ],
            },
          },
          {
            fullUrl: EXAMPLE_PROVIDER_ORGANIZATION_DID,
            resource: {
              resourceType: 'Organization',
              id: 'provider-organization',
              identifier: [{ value: EXAMPLE_PROVIDER_ORGANIZATION_DID }],
            },
          },
          {
            resource: {
              resourceType: 'MedicationStatement',
              id: 'medication-001',
              status: 'active',
              language: 'es',
              subject: { reference: subjectDid },
              effectiveDateTime: '2026-05-22T10:00:00Z',
              medicationCodeableConcept: {
                text: 'http://www.nlm.nih.gov/research/umls/rxnorm|161',
                coding: [{
                  system: 'http://www.nlm.nih.gov/research/umls/rxnorm',
                  code: '161',
                  display: 'Paracetamol 500 MG Oral Tablet',
                  userSelected: true,
                }],
              },
              meta: { claims: {
                'MedicationStatement.code-text': 'Paracetamol 500mg',
                'MedicationStatement.code-display': 'Paracetamol 500 MG Oral Tablet',
              },
              // A child resource tag in a normal full document is ordinary
              // FHIR metadata and must not discard the imported clinical data.
              tag: [{ system: 'MedicationStatement.status', code: 'active' }] },
              identifier: [{ value: 'urn:uuid:medication-001' }],
            },
          },
          {
            resource: {
              resourceType: 'Observation',
              id: 'observation-001',
              status: 'final',
              language: 'es',
              subject: { reference: subjectDid },
              effectiveDateTime: '2026-05-22T11:00:00Z',
              effectiveTiming: { repeat: { when: ['MORN'] } },
              code: {
                coding: [{
                  system: 'http://loinc.org',
                  code: '85354-9',
                  display: 'Blood pressure panel with all children optional',
                  userSelected: true,
                }],
                text: 'Tension arterial',
              },
              identifier: [{ value: 'urn:uuid:observation-001' }],
            },
          },
          {
            resource: {
              resourceType: ResourceTypesFhirR4.Consent,
              id: 'medication-consent-001',
              status: 'active',
              patient: { reference: subjectDid },
              identifier: [{ value: 'urn:uuid:medication-consent-001' }],
              sourceReference: { reference: 'DocumentReference/medication-document-001' },
            },
          },
          {
            resource: {
              resourceType: ResourceTypesFhirR4.DocumentReference,
              id: 'medication-document-001',
              status: 'current',
              subject: { reference: subjectDid },
              date: '2026-05-22T11:30:00Z',
              identifier: [{ value: 'urn:uuid:medication-document-001' }],
              content: [{ attachment: {
                contentType: 'application/pdf',
                url: 'https://records.example.org/medication-document-001.pdf',
                title: 'Medication document',
              } }],
            },
          },
        ],
      };

      const decoded: IDecodedDidcommPayload = {
        jti: randomUUID(),
        thid: 'thread-bundle-projection-001',
        iss: 'did:web:sender.example',
        aud: 'did:web:receiver.example',
        exp: Math.floor(Date.now() / 1000) + 300,
        type: 'org.hl7.fhir.r4.Bundle',
        meta: { jws: { protected: {
          kid: EXAMPLE_CONTROLLER_SIGN_KEY.kid,
          alg: EXAMPLE_CONTROLLER_SIGN_KEY.alg,
        } } },
        body: {
          resourceType: 'Bundle',
          type: 'batch',
          data: [
            {
              type: 'Communication',
              meta: {
                claims: {
                  '@context': 'org.hl7.fhir.r4',
                  'Communication.identifier': 'comm-bundle-001',
                  'Communication.subject': subjectDid,
                  'Communication.sent': '2026-05-22T10:00:00Z',
                },
              },
              resource: {
                resourceType: 'Communication',
                status: 'completed',
                subject: { reference: subjectDid },
                payload: [
                  {
                    contentAttachment: {
                      contentType: 'application/fhir+json',
                      title: 'ips-medications.json',
                      data: Buffer.from(JSON.stringify(documentBundle), 'utf8').toString('base64'),
                    },
                  },
                ],
              },
            },
          ],
        } as any,
      };

      const job: JobRequest = {
        id: randomUUID(),
        status: JobStatus.DRAFT,
        sequence: 0,
        createdAtTimestamp: Date.now(),
        tenantId: 'acme',
        jurisdiction: 'es',
        sector: 'health-care',
        section: 'individual',
        format: 'org.hl7.fhir.r4' as any,
        resourceType: 'Communication',
        action: '_batch',
        content: decoded,
      };

      await communicationManager.process(job);

      const tenantVaultId = 'health-care_acme';
      const medicationsSectionId = getSubjectScopedSectionId(subjectDid, 'individual', 'medications');
      const observationsSectionId = getSubjectScopedSectionId(subjectDid, 'individual', 'observations');
      const documentReferencesSectionId = getSubjectScopedSectionId(subjectDid, 'individual', 'document-references');

      const medicationPut = mockVaultRepository.put.mock.calls.find(
        (args) => args[0] === tenantVaultId && args[2] === medicationsSectionId,
      );
      expect(medicationPut).toBeDefined();
      const sectionDocumentReferencePut = mockVaultRepository.put.mock.calls.find(
        (args) => args[0] === tenantVaultId
          && args[2] === documentReferencesSectionId
          && (args[1] as any[])[0]?.id === 'medication-document-001',
      );
      expect(sectionDocumentReferencePut).toBeDefined();
      const sectionDocumentReferenceRecord = (sectionDocumentReferencePut?.[1] as any[])[0];
      expect(
        sectionDocumentReferenceRecord[CompositionClaim.Section]
        || sectionDocumentReferenceRecord[`${Format.FHIR_API}.${CompositionClaim.Section}`],
      ).toBe('LOINC|10160-0');
      const medicationRecord = (medicationPut?.[1] as any[])[0];
      expect(medicationRecord.id).toBe('medication-001');
      expect(medicationRecord.audit?.creatorDid).toBe(decoded.iss);
      expect(medicationRecord.audit?.submitterDid).toBe(decoded.iss);
      expect(medicationRecord.audit?.signingKeyId).toBe(EXAMPLE_CONTROLLER_SIGN_KEY.kid);
      expect(medicationRecord[CompositionClaim.Identifier]).toBe(EXAMPLE_IPS_COMPOSITION_IDENTIFIER);
      expect(medicationRecord[CompositionClaim.Author]).toBe(EXAMPLE_PROVIDER_ORGANIZATION_DID);
      expect(medicationRecord[CompositionClaim.Custodian]).toBe(EXAMPLE_PROVIDER_ORGANIZATION_DID);
      expect(medicationRecord[CompositionClaim.Attester]).toBe([
        `urn:uuid:${EXAMPLE_KYC_CONTROLLER_UUID}`,
        `urn:uuid:${EXAMPLE_KYC_CONTROLLER_USER_UUID}`,
      ].join(','));
      expect(
        medicationRecord['MedicationStatement.subject']
        || medicationRecord['org.hl7.fhir.api.MedicationStatement.subject'],
      ).toBe(subjectDid);
      expect(
        medicationRecord['MedicationStatement.identifier']
        || medicationRecord['org.hl7.fhir.api.MedicationStatement.identifier'],
      ).toBe('urn:uuid:medication-001');
      expect(
        medicationRecord['MedicationStatement.code-display']
        || medicationRecord['org.hl7.fhir.api.MedicationStatement.code-display'],
      ).toBe('Paracetamol 500 MG Oral Tablet');
      expect(
        medicationRecord['MedicationStatement.code-text']
        || medicationRecord['org.hl7.fhir.api.MedicationStatement.code-text'],
      ).toBe('Paracetamol 500mg');
      expect(
        medicationRecord['MedicationStatement.code-text']
        || medicationRecord['org.hl7.fhir.api.MedicationStatement.code-text'],
      ).toBe('Paracetamol 500mg');
      expect(
        medicationRecord['MedicationStatement.code-text']
        || medicationRecord['org.hl7.fhir.api.MedicationStatement.code-text'],
      ).not.toBe(
        medicationRecord['MedicationStatement.code']
        || medicationRecord['org.hl7.fhir.api.MedicationStatement.code'],
      );
      expect(
        medicationRecord['MedicationStatement.language']
        || medicationRecord['org.hl7.fhir.api.MedicationStatement.language'],
      ).toBe('es');
      expect(
        medicationRecord['MedicationStatement.user-selected']
        || medicationRecord['org.hl7.fhir.api.MedicationStatement.user-selected'],
      ).toBe('true');
      expect(medicationRecord.indexed?.attributes).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'org.hl7.fhir.api.MedicationStatement.subject', value: subjectDid }),
          expect.objectContaining({ name: 'org.hl7.fhir.api.MedicationStatement.identifier', value: 'urn:uuid:medication-001' }),
          expect.objectContaining({ name: 'org.hl7.fhir.api.MedicationStatement.code-display', value: 'Paracetamol 500 MG Oral Tablet' }),
          expect.objectContaining({ name: 'org.hl7.fhir.api.MedicationStatement.code-text', value: 'Paracetamol 500mg' }),
          expect.objectContaining({ name: 'org.hl7.fhir.api.MedicationStatement.language', value: 'es' }),
          expect.objectContaining({ name: 'org.hl7.fhir.api.MedicationStatement.user-selected', value: 'true' }),
          expect.objectContaining({ name: ConfidentialDocumentIndex.Sector, value: job.sector }),
          expect.objectContaining({ name: CompositionClaim.Identifier, value: EXAMPLE_IPS_COMPOSITION_IDENTIFIER }),
          expect.objectContaining({ name: CompositionClaim.Author, value: EXAMPLE_PROVIDER_ORGANIZATION_DID }),
          expect.objectContaining({ name: CompositionClaim.Custodian, value: EXAMPLE_PROVIDER_ORGANIZATION_DID }),
          expect.objectContaining({ name: CompositionClaim.Attester, value: `urn:uuid:${EXAMPLE_KYC_CONTROLLER_UUID}` }),
          expect.objectContaining({ name: CompositionClaim.Attester, value: `urn:uuid:${EXAMPLE_KYC_CONTROLLER_USER_UUID}` }),
          expect.objectContaining({ name: ConfidentialDocumentIndex.SigningKeyId, value: EXAMPLE_CONTROLLER_SIGN_KEY.kid }),
        ]),
      );

      const observationPut = mockVaultRepository.put.mock.calls.find(
        (args) => args[0] === tenantVaultId && args[2] === observationsSectionId,
      );
      expect(observationPut).toBeDefined();
      const observationRecord = (observationPut?.[1] as any[])[0];
      expect(observationRecord.id).toBe('observation-001');
      expect(
        observationRecord['Observation.subject']
        || observationRecord['org.hl7.fhir.api.Observation.subject'],
      ).toBe(subjectDid);
      expect(
        observationRecord['Observation.identifier']
        || observationRecord['org.hl7.fhir.api.Observation.identifier'],
      ).toBe('urn:uuid:observation-001');
      expect(
        observationRecord['Observation.code-display']
        || observationRecord['org.hl7.fhir.api.Observation.code-display'],
      ).toBe('Blood pressure panel with all children optional');
      expect(
        observationRecord['Observation.code-text']
        || observationRecord['org.hl7.fhir.api.Observation.code-text'],
      ).toBe('Tension arterial');
      expect(
        observationRecord['Observation.date-when']
        || observationRecord['org.hl7.fhir.api.Observation.date-when'],
      ).toBe('MORN');
      expect(
        observationRecord['Observation.language']
        || observationRecord['org.hl7.fhir.api.Observation.language'],
      ).toBe('es');
      expect(
        observationRecord['Observation.user-selected']
        || observationRecord['org.hl7.fhir.api.Observation.user-selected'],
      ).toBe('true');
      expect(observationRecord.indexed?.attributes).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'org.hl7.fhir.api.Observation.subject', value: subjectDid }),
          expect.objectContaining({ name: 'org.hl7.fhir.api.Observation.identifier', value: 'urn:uuid:observation-001' }),
          expect.objectContaining({ name: 'org.hl7.fhir.api.Observation.code-display', value: 'Blood pressure panel with all children optional' }),
          expect.objectContaining({ name: 'org.hl7.fhir.api.Observation.code-text', value: 'Tension arterial' }),
          expect.objectContaining({ name: 'org.hl7.fhir.api.Observation.language', value: 'es' }),
          expect.objectContaining({ name: 'org.hl7.fhir.api.Observation.user-selected', value: 'true' }),
        ]),
      );

      const twinObservationSectionId = getSubjectScopedSectionId(twinSubjectId, 'digitaltwin', 'observations');
      const twinObservationPut = mockVaultRepository.put.mock.calls.find(
        (args) => args[0] === tenantVaultId && args[2] === twinObservationSectionId,
      );
      const twinObservation = (twinObservationPut?.[1] as any[])?.[0];
      const twinClaim = (suffix: string) => twinObservation[
        Object.keys(twinObservation).find((key) => key.endsWith(suffix)) as string
      ];
      expect(twinClaim('Observation.subject')).toBe(twinSubjectId);
      expect(twinClaim('Observation.code-display')).toBeUndefined();
      expect(twinClaim('Observation.code-text')).toBeUndefined();
      expect(twinClaim('Observation.date')).toBe('2026-05-22T11:00:00Z');
    });

    it('keeps DocumentReference attachments working as a compatibility wrapper around a document bundle', async () => {
      mockTenantsCacheManager.getTenantDid.mockResolvedValue(testServerDid as any);
      mockVaultRepository.vaultExists.mockResolvedValue(true as any);

      const documentBundle = {
        resourceType: 'Bundle',
        type: 'document',
        entry: [
          {
            resource: {
              resourceType: 'Composition',
              id: 'ips-composition-embedded-001',
              status: 'final',
              subject: { reference: subjectDid },
              author: [{ reference: EXAMPLE_PROVIDER_ORGANIZATION_AUTHORIZATION_URN_CDS }],
              attester: [{
                mode: CompositionAttesterModes.Professional,
                party: { reference: `urn:uuid:${EXAMPLE_KYC_CONTROLLER_UUID}` },
              }],
              type: { coding: [{ system: 'http://loinc.org', code: '60591-5' }] },
            },
          },
          {
            resource: {
              resourceType: 'MedicationStatement',
              id: 'medication-embedded-001',
              status: 'active',
              subject: { reference: subjectDid },
              effectiveDateTime: '2026-05-22T10:00:00Z',
              medicationCodeableConcept: { text: 'Ibuprofen 400mg' },
              identifier: [{ value: 'urn:uuid:medication-embedded-001' }],
            },
          },
        ],
      };
      const embeddedDocumentReference = {
        resourceType: 'DocumentReference',
        subject: { reference: subjectDid },
        identifier: [{ value: 'urn:uuid:docref-embedded-001' }],
        content: [
          {
            attachment: {
              contentType: 'application/fhir+json',
              title: 'ips-medications.json',
              data: Buffer.from(JSON.stringify(documentBundle), 'utf8').toString('base64'),
            },
          },
        ],
      };

      const decoded: IDecodedDidcommPayload = {
        jti: randomUUID(),
        thid: 'thread-bundle-docref-projection-001',
        iss: 'did:web:sender.example',
        aud: 'did:web:receiver.example',
        exp: Math.floor(Date.now() / 1000) + 300,
        type: 'org.hl7.fhir.r4.Bundle',
        body: {
          resourceType: 'Bundle',
          type: 'batch',
          data: [
            {
              type: 'Communication',
              meta: {
                claims: {
                  '@context': 'org.hl7.fhir.r4',
                  'Communication.identifier': 'comm-bundle-docref-001',
                  'Communication.subject': subjectDid,
                  'Communication.sent': '2026-05-22T10:00:00Z',
                  'Composition.section': 'LOINC|10160-0',
                },
              },
              resource: {
                resourceType: 'Communication',
                status: 'completed',
                subject: { reference: subjectDid },
                payload: [
                  {
                    contentAttachment: {
                      contentType: 'application/fhir+json',
                      title: 'ips-document-reference.json',
                      data: Buffer.from(JSON.stringify(embeddedDocumentReference), 'utf8').toString('base64'),
                    },
                  },
                ],
              },
            },
          ],
        } as any,
      };

      const job: JobRequest = {
        id: randomUUID(),
        status: JobStatus.DRAFT,
        sequence: 0,
        createdAtTimestamp: Date.now(),
        tenantId: 'acme',
        jurisdiction: 'es',
        sector: 'health-care',
        section: 'individual',
        format: 'org.hl7.fhir.r4' as any,
        resourceType: 'Communication',
        action: '_batch',
        content: decoded,
      };

      await communicationManager.process(job);

      const tenantVaultId = 'health-care_acme';
      const medicationsSectionId = getSubjectScopedSectionId(subjectDid, 'individual', 'medications');
      const medicationPut = mockVaultRepository.put.mock.calls.find(
        (args) => args[0] === tenantVaultId && args[2] === medicationsSectionId,
      );
      expect(medicationPut).toBeDefined();
      const medicationRecord = (medicationPut?.[1] as any[])[0];
      expect(medicationRecord.id).toBe('medication-embedded-001');
      expect(
        medicationRecord['MedicationStatement.identifier']
        || medicationRecord['org.hl7.fhir.api.MedicationStatement.identifier'],
      ).toBe('urn:uuid:medication-embedded-001');
      expect(medicationRecord[CompositionClaim.Author])
        .toBe(EXAMPLE_PROVIDER_ORGANIZATION_AUTHORIZATION_URN_CDS);
      expect(medicationRecord[CompositionClaim.Attester])
        .toBe(`urn:uuid:${EXAMPLE_KYC_CONTROLLER_UUID}`);
    });

    it('projects one multi-section Composition per IPS document into individual and digitaltwin scopes', async () => {
      mockTenantsCacheManager.getTenantDid.mockResolvedValue(testServerDid as any);
      mockVaultRepository.vaultExists.mockResolvedValue(true as any);
      const twinSubjectId = await enableDigitalTwinSecondaryUse(subjectDid);

      const documentBundle = {
        resourceType: 'Bundle',
        type: 'document',
        entry: [
          {
            resource: {
              resourceType: 'Composition',
              id: 'ips-composition-sections-001',
              status: 'final',
              subject: { reference: subjectDid },
              attester: [{
                mode: CompositionAttesterModes.Professional,
                party: { reference: `urn:uuid:${EXAMPLE_KYC_CONTROLLER_UUID}` },
              }],
              type: {
                coding: [{ system: 'http://loinc.org', code: '60591-5' }],
              },
              section: [
                {
                  code: {
                    coding: [{ system: 'http://loinc.org', code: '10160-0' }],
                  },
                },
                {
                  code: {
                    coding: [{ system: 'http://loinc.org', code: '8716-3' }],
                  },
                },
              ],
            },
          },
          {
            resource: {
              resourceType: 'MedicationStatement',
              id: 'medication-sections-001',
              status: 'active',
              subject: { reference: subjectDid },
              medicationCodeableConcept: { text: 'Paracetamol 500mg' },
              identifier: [{ value: 'urn:uuid:medication-sections-001' }],
            },
          },
          {
            resource: {
              resourceType: 'Observation',
              id: 'observation-sections-001',
              status: 'final',
              subject: { reference: subjectDid },
              code: {
                coding: [{ system: 'http://loinc.org', code: '85354-9', display: 'Blood pressure panel with all children optional' }],
                text: 'Blood pressure',
              },
              identifier: [{ value: 'urn:uuid:observation-sections-001' }],
            },
          },
        ],
      };

      const job: JobRequest = {
        id: randomUUID(),
        status: JobStatus.DRAFT,
        sequence: 0,
        createdAtTimestamp: Date.now(),
        tenantId: 'acme',
        jurisdiction: 'es',
        sector: 'health-care',
        section: 'individual',
        format: 'org.hl7.fhir.r4' as any,
        resourceType: 'Communication',
        action: '_batch',
        content: {
          jti: randomUUID(),
          thid: 'thread-composition-sections-001',
          iss: 'did:web:sender.example',
          aud: 'did:web:receiver.example',
          exp: Math.floor(Date.now() / 1000) + 300,
          type: 'org.hl7.fhir.r4.Bundle',
          body: {
            resourceType: 'Bundle',
            type: 'batch',
            data: [
              {
                type: 'Communication',
                meta: {
                  claims: {
                    '@context': 'org.hl7.fhir.r4',
                    'Communication.identifier': 'comm-composition-sections-001',
                    'Communication.subject': subjectDid,
                    'Communication.sent': '2026-05-22T10:00:00Z',
                    'Composition.type': 'http://loinc.org|60591-5',
                  },
                },
                resource: {
                  resourceType: 'Communication',
                  status: 'completed',
                  subject: { reference: subjectDid },
                  sent: '2026-05-22T10:00:00Z',
                  payload: [
                    {
                      contentAttachment: {
                        contentType: 'application/fhir+json',
                        title: 'ips-sections.json',
                        data: Buffer.from(JSON.stringify(documentBundle), 'utf8').toString('base64'),
                      },
                    },
                  ],
                },
              },
            ],
          } as any,
        },
      };

      await communicationManager.process(job);

      const tenantVaultId = 'health-care_acme';
      const individualCompositionSectionId = getSubjectScopedSectionId(subjectDid, 'individual', 'composition');
      const digitalTwinCompositionSectionId = getSubjectScopedSectionId(twinSubjectId, 'digitaltwin', 'composition');
      const compositionPuts = mockVaultRepository.put.mock.calls.filter(
        (args) =>
          args[0] === tenantVaultId
          && (args[2] === individualCompositionSectionId || args[2] === digitalTwinCompositionSectionId),
      );

      expect(compositionPuts).toHaveLength(2);
      const projectedSections = compositionPuts.flatMap((args) =>
        ((args[1] as any[]) || []).map((record) =>
          record['Composition.section'] || record['org.hl7.fhir.r4.Composition.section'],
        ),
      );
      expect(projectedSections).toEqual([
        'LOINC|10160-0,LOINC|8716-3',
        'LOINC|10160-0,LOINC|8716-3',
      ]);
      const researchRecords = compositionPuts
        .filter((args) => args[2] === digitalTwinCompositionSectionId)
        .flatMap((args) => (args[1] as any[]) || []);
      expect(researchRecords).toHaveLength(1);
      for (const record of researchRecords) {
        const subjectKey = Object.keys(record).find((key) => key.endsWith('Composition.subject'));
        expect(record[subjectKey as string]).toBe(twinSubjectId);
        expect(JSON.stringify(record)).not.toContain(subjectDid);
      }
    });

    it('keeps a preliminary document operational without digital-twin projection', async () => {
      mockTenantsCacheManager.getTenantDid.mockResolvedValue(testServerDid as any);
      mockVaultRepository.vaultExists.mockResolvedValue(true as any);
      mockVaultRepository.get.mockImplementation(async (_vaultId, _id, sectionId) => (
        String(sectionId || '').includes('digitaltwin_secondary_use_status')
          ? { status: 'enabled' } as any
          : undefined
      ));

      const documentBundle = {
        resourceType: ResourceTypesFhirR4.Bundle,
        type: BundleTypes.document,
        entry: [{
          resource: {
            resourceType: ResourceTypesFhirR4.Composition,
            id: 'vital-signs-composition-preliminary',
            status: 'preliminary',
            identifier: { value: EXAMPLE_IPS_COMPOSITION_IDENTIFIER },
            subject: { reference: subjectDid },
            type: { coding: [{ system: 'http://loinc.org', code: '60591-5' }] },
            date: EXAMPLE_VITAL_SIGNS_EFFECTIVE_DATE_TIME,
            author: [{ reference: EXAMPLE_PROVIDER_ORGANIZATION_DID }],
            section: [{
              code: { coding: [{ system: 'http://loinc.org', code: '8716-3' }] },
              entry: [{ reference: `Observation/${EXAMPLE_OBSERVATION_IDENTIFIER}` }],
            }],
          },
        }, {
          fullUrl: `Observation/${EXAMPLE_OBSERVATION_IDENTIFIER}`,
          resource: {
            resourceType: ResourceTypesFhirR4.Observation,
            id: EXAMPLE_OBSERVATION_IDENTIFIER,
            status: 'final',
            subject: { reference: subjectDid },
            effectiveTiming: { repeat: { when: ['MORN'] } },
            code: { coding: [VitalSignsCodes.BodyTemperature] },
            valueQuantity: {
              value: EXAMPLE_VITAL_SIGN_VALUE_BODY_TEMPERATURE,
              unit: VitalSignsUnits.Celsius.display,
              system: VitalSignsUnits.Celsius.system,
              code: VitalSignsUnits.Celsius.code,
            },
            identifier: [{ value: EXAMPLE_OBSERVATION_IDENTIFIER }],
          },
        }],
      };
      const job: JobRequest = {
        id: randomUUID(), status: JobStatus.DRAFT, sequence: 0, createdAtTimestamp: Date.now(),
        tenantId: 'acme', jurisdiction: EXAMPLE_HEALTHCARE_JURISDICTION,
        sector: Sector.HEALTH_CARE, section: 'individual', format: Format.FHIR_R4,
        resourceType: ResourceTypesFhirR4.Communication, action: '_batch',
        content: {
          jti: randomUUID(), thid: randomUUID(), iss: EXAMPLE_PROVIDER_ORGANIZATION_DID,
          aud: testServerDid, exp: Math.floor(Date.now() / 1000) + 300,
          type: 'org.hl7.fhir.r4.Bundle',
          body: {
            resourceType: ResourceTypesFhirR4.Bundle,
            type: BundleTypes.batch,
            data: [{
              type: ResourceTypesFhirR4.Communication,
              meta: { claims: {
                '@context': Format.FHIR_R4,
                [CommunicationClaim.Identifier]: EXAMPLE_COMMUNICATION_IDENTIFIER,
                [CommunicationClaim.Subject]: subjectDid,
                [CommunicationClaim.Sent]: EXAMPLE_VITAL_SIGNS_EFFECTIVE_DATE_TIME,
              } },
              resource: {
                resourceType: ResourceTypesFhirR4.Communication,
                status: 'completed', subject: { reference: subjectDid },
                payload: [{ contentAttachment: {
                  contentType: EXAMPLE_CONTENT_TYPE_FHIR_JSON,
                  data: Buffer.from(JSON.stringify(documentBundle), 'utf8').toString('base64'),
                } }],
              },
            }],
          },
        } as IDecodedDidcommPayload,
      };

      await communicationManager.process(job);

      const tenantVaultId = `${Sector.HEALTH_CARE}_acme`;
      expect(mockVaultRepository.put.mock.calls.some((args) =>
        args[0] === tenantVaultId
        && args[2] === getSubjectScopedSectionId(subjectDid, 'individual', 'composition'))).toBe(true);
      expect(mockVaultRepository.put.mock.calls.some((args) =>
        args[0] === tenantVaultId
        && args[2] === getSubjectScopedSectionId(subjectDid, 'individual', 'observations'))).toBe(true);
      expect(mockVaultRepository.put.mock.calls.some((args) => String(args[2] || '').includes('digitaltwin')))
        .toBe(false);
    });

    it('does not project duplicate clinical resources when the replayed IPS changes container ids, dates, and narrative text', async () => {
      mockTenantsCacheManager.getTenantDid.mockResolvedValue(testServerDid as any);
      mockVaultRepository.vaultExists.mockResolvedValue(true as any);

      const buildDocumentBundle = (suffix: string, compositionDate: string) => ({
        resourceType: 'Bundle',
        type: 'document',
        entry: [
          {
            resource: {
              resourceType: 'Composition',
              id: `ips-composition-${suffix}`,
              status: 'final',
              date: compositionDate,
              text: {
                status: 'generated',
                div: `<div xmlns="http://www.w3.org/1999/xhtml">Narrative ${suffix}</div>`,
              },
              subject: { reference: subjectDid },
              type: { coding: [{ system: 'http://loinc.org', code: '60591-5' }] },
              section: [{ code: { coding: [{ system: 'http://loinc.org', code: '10160-0' }] } }],
            },
          },
          {
            resource: {
              resourceType: 'MedicationStatement',
              id: `medication-${suffix}`,
              status: 'active',
              subject: { reference: subjectDid },
              effectiveDateTime: '2026-05-22T10:00:00Z',
              medicationCodeableConcept: {
                text: 'Paracetamol 500mg',
                coding: [{ system: 'http://www.nlm.nih.gov/research/umls/rxnorm', code: '161' }],
              },
              identifier: [{ value: 'urn:uuid:medication-stable-001' }],
              meta: {
                source: `ips-${suffix}`,
              },
              text: {
                status: 'generated',
                div: `<div xmlns="http://www.w3.org/1999/xhtml">Medication ${suffix}</div>`,
              },
            },
          },
          {
            resource: {
              resourceType: 'Observation',
              id: `observation-${suffix}`,
              status: 'final',
              subject: { reference: subjectDid },
              effectiveDateTime: '2026-05-22T11:00:00Z',
              code: {
                coding: [{ system: 'http://loinc.org', code: '8310-5' }],
                text: 'Body temperature',
              },
              identifier: [{ value: 'urn:uuid:observation-stable-001' }],
              meta: {
                tag: [{ code: `ips-${suffix}` }],
              },
              text: {
                status: 'generated',
                div: `<div xmlns="http://www.w3.org/1999/xhtml">Observation ${suffix}</div>`,
              },
            },
          },
        ],
      });

      const makeDecoded = (thid: string, suffix: string, sent: string): IDecodedDidcommPayload => ({
        jti: randomUUID(),
        thid,
        iss: 'did:web:sender.example',
        aud: 'did:web:receiver.example',
        exp: Math.floor(Date.now() / 1000) + 300,
        type: 'org.hl7.fhir.r4.Bundle',
        body: {
          resourceType: 'Bundle',
          type: 'batch',
          data: [
            {
              type: 'Communication',
              meta: {
                claims: {
                  '@context': 'org.hl7.fhir.r4',
                  'Communication.identifier': `comm-${suffix}`,
                  'Communication.subject': subjectDid,
                  'Communication.sent': sent,
                  'Composition.section': 'LOINC|10160-0',
                },
              },
              resource: {
                resourceType: 'Communication',
                status: 'completed',
                subject: { reference: subjectDid },
                sent,
                payload: [
                  {
                    contentAttachment: {
                      contentType: 'application/fhir+json',
                      title: `ips-${suffix}.json`,
                      data: Buffer.from(JSON.stringify(buildDocumentBundle(suffix, sent)), 'utf8').toString('base64'),
                    },
                  },
                ],
              },
            },
          ],
        } as any,
      });

      const job: JobRequest = {
        id: randomUUID(),
        status: JobStatus.DRAFT,
        sequence: 0,
        createdAtTimestamp: Date.now(),
        tenantId: 'acme',
        jurisdiction: 'es',
        sector: 'health-care',
        section: 'individual',
        format: 'org.hl7.fhir.r4' as any,
        resourceType: 'Communication',
        action: '_batch',
        content: makeDecoded('thread-ips-replay-1', 'v1', '2026-05-22T10:00:00Z'),
      };

      await communicationManager.process(job);

      const tenantVaultId = 'health-care_acme';
      const medicationsSectionId = getSubjectScopedSectionId(subjectDid, 'individual', 'medications');
      const observationsSectionId = getSubjectScopedSectionId(subjectDid, 'individual', 'observations');
      const firstMedicationPut = mockVaultRepository.put.mock.calls.find(
        (args) => args[0] === tenantVaultId && args[2] === medicationsSectionId,
      );
      const firstObservationPut = mockVaultRepository.put.mock.calls.find(
        (args) => args[0] === tenantVaultId && args[2] === observationsSectionId,
      );
      expect(firstMedicationPut).toBeDefined();
      expect(firstObservationPut).toBeDefined();

      const firstMedicationRecord = (firstMedicationPut?.[1] as any[])[0];
      const firstObservationRecord = (firstObservationPut?.[1] as any[])[0];
      const medicationVersionId =
        firstMedicationRecord['MedicationStatement.meta.versionId']
        || firstMedicationRecord['org.hl7.fhir.api.MedicationStatement.meta.versionId'];
      const observationVersionId =
        firstObservationRecord['Observation.meta.versionId']
        || firstObservationRecord['org.hl7.fhir.api.Observation.meta.versionId'];
      expect(typeof medicationVersionId).toBe('string');
      expect(typeof observationVersionId).toBe('string');

      mockVaultRepository.put.mockClear();
      mockVaultRepository.query.mockImplementation(async (_tenantVaultId, query) => {
        const where = Array.isArray(query?.where) ? query.where : [];
        const matchesMedication = where.some(
          (condition: any) => condition?.name === 'MedicationStatement.meta.versionId' && condition?.value === medicationVersionId,
        );
        const matchesObservation = where.some(
          (condition: any) => condition?.name === 'Observation.meta.versionId' && condition?.value === observationVersionId,
        );
        return matchesMedication || matchesObservation ? [{ id: 'existing-projection' }] as any : [];
      });

      await communicationManager.process({
        ...job,
        id: randomUUID(),
        content: makeDecoded('thread-ips-replay-2', 'v2', '2026-06-01T09:30:00Z'),
      });

      const secondMedicationPuts = mockVaultRepository.put.mock.calls.filter(
        (args) => args[0] === tenantVaultId && args[2] === medicationsSectionId,
      );
      const secondObservationPuts = mockVaultRepository.put.mock.calls.filter(
        (args) => args[0] === tenantVaultId && args[2] === observationsSectionId,
      );
      expect(secondMedicationPuts).toHaveLength(0);
      expect(secondObservationPuts).toHaveLength(0);
    });

    it('preserves one imported Composition without requiring the importer to own its external author graph', async () => {
      mockTenantsCacheManager.getTenantDid.mockResolvedValue(testServerDid as any);
      mockVaultRepository.vaultExists.mockResolvedValue(true as any);

      const documentBundle = {
        resourceType: 'Bundle',
        type: 'document',
        entry: [
          {
            resource: {
              resourceType: 'Composition',
              id: 'ips-composition-stable-001',
              identifier: [{ value: 'urn:uuid:ips-composition-stable-001' }],
              status: 'final',
              subject: { reference: subjectDid },
              author: [{ reference: EXAMPLE_PROVIDER_ORGANIZATION_AUTHORIZATION_URN_CDS }],
              type: { coding: [{ system: 'http://loinc.org', code: '60591-5' }] },
              section: [{ code: { coding: [{ system: 'http://loinc.org', code: '10160-0' }] } }],
            },
          },
        ],
      };

      const makeDecoded = (thid: string): IDecodedDidcommPayload => ({
        jti: randomUUID(),
        thid,
        iss: 'did:web:sender.example',
        aud: 'did:web:receiver.example',
        exp: Math.floor(Date.now() / 1000) + 300,
        type: 'org.hl7.fhir.r4.Bundle',
        body: {
          resourceType: 'Bundle',
          type: 'batch',
          data: [
            {
              type: 'Communication',
              meta: {
                claims: {
                  '@context': 'org.hl7.fhir.r4',
                  'Communication.subject': subjectDid,
                  'Communication.sent': '2026-05-22T10:00:00Z',
                  [CompositionClaim.Section]: HealthcareBasicSections.HistoryOfMedicationUse.attributeValue,
                },
              },
              resource: {
                resourceType: 'Communication',
                status: 'completed',
                subject: { reference: subjectDid },
                payload: [
                  {
                    contentAttachment: {
                      contentType: 'application/fhir+json',
                      title: 'ips-document.json',
                      data: Buffer.from(JSON.stringify(documentBundle), 'utf8').toString('base64'),
                    },
                  },
                ],
              },
            },
          ],
        } as any,
      });

      const job: JobRequest = {
        id: randomUUID(),
        status: JobStatus.DRAFT,
        sequence: 0,
        createdAtTimestamp: Date.now(),
        tenantId: 'acme',
        jurisdiction: 'es',
        sector: 'health-care',
        section: 'individual',
        format: 'org.hl7.fhir.r4' as any,
        resourceType: 'Communication',
        action: '_batch',
        content: makeDecoded('thread-composition-stable-1'),
      };

      await communicationManager.process(job);

      const tenantVaultId = 'health-care_acme';
      const compositionSectionId = getSubjectScopedSectionId(subjectDid, 'individual', 'composition');
      const firstCompositionPuts = mockVaultRepository.put.mock.calls.filter(
        (args) => args[0] === tenantVaultId && args[2] === compositionSectionId,
      );
      expect(firstCompositionPuts).toHaveLength(1);
      const firstCompositionRecord = (firstCompositionPuts[0][1] as any[])[0];
      expect(
        firstCompositionRecord['Composition.identifier']
        || firstCompositionRecord['org.hl7.fhir.r4.Composition.identifier'],
      ).toBe('urn:uuid:ips-composition-stable-001');

      mockVaultRepository.put.mockClear();
      mockVaultRepository.query.mockResolvedValue([{ id: 'existing-composition' }] as any);

      await communicationManager.process({
        ...job,
        id: randomUUID(),
        content: makeDecoded('thread-composition-stable-2'),
      });

      const secondCompositionPuts = mockVaultRepository.put.mock.calls.filter(
        (args) => args[0] === tenantVaultId && args[2] === compositionSectionId,
      );
      expect(secondCompositionPuts).toHaveLength(0);
    });
  });

  describe('process (subject-scoped communication channel persistence)', () => {
    const subjectDid = 'did:web:api.acme.org:individual:xyz';

    it('persists an auditable CommMsgExtended channel record per subject', async () => {
      mockTenantsCacheManager.getTenantDid.mockResolvedValue(testServerDid as any);
      mockVaultRepository.vaultExists.mockResolvedValue(true as any);

      const decoded: IDecodedDidcommPayload = {
        jti: randomUUID(),
        thid: 'thread-audit-001',
        iss: 'did:web:sender.example',
        aud: 'did:web:receiver.example',
        exp: Math.floor(Date.now() / 1000) + 300,
        type: 'org.hl7.fhir.r4.Bundle',
        body: {
          resourceType: 'Bundle',
          type: 'batch',
          data: [
            {
              type: 'Communication',
              resource: {
                resourceType: 'Communication',
                status: 'completed',
                meta: {
                  claims: {
                    '@context': 'org.hl7.fhir.r4',
                    'Communication.identifier': 'comm-audit-001',
                    'Communication.subject': subjectDid,
                    'Communication.recipient': subjectDid,
                    'Communication.sender': 'did:web:operator.example',
                    'Communication.sent': '2026-05-17T12:30:00Z',
                  },
                },
                subject: { reference: subjectDid },
                recipient: [{ reference: subjectDid }],
                sender: { reference: 'did:web:operator.example' },
                sent: '2026-05-17T12:30:00Z',
                note: [{ text: 'Permission update requested' }],
                payload: [
                  {
                    contentAttachment: {
                      id: 'zb2rhfJk6M9MHiMagUhM6YJ6R7Sx9nN2m7r8cfDkQ2uYbGxZq',
                      contentType: 'application/pdf',
                      data: Buffer.from('fake-pdf-content', 'utf8').toString('base64'),
                      title: 'request.pdf',
                    },
                  },
                ],
              },
            },
          ],
        } as any,
      };

      const job: JobRequest = {
        id: randomUUID(),
        status: JobStatus.DRAFT,
        sequence: 0,
        createdAtTimestamp: Date.now(),
        tenantId: 'acme',
        jurisdiction: 'es',
        sector: 'health-care',
        section: 'individual',
        format: 'org.hl7.fhir.r4' as any,
        resourceType: 'Communication',
        action: '_batch',
        content: decoded,
      };

      await communicationManager.process(job);

      const tenantVaultId = 'health-care_acme';
      const commSectionId = getSubjectScopedSectionId(subjectDid, 'individual', 'communications');
      const channelPutCalls = mockVaultRepository.put.mock.calls.filter((args) => args[0] === tenantVaultId && args[2] === commSectionId);
      expect(channelPutCalls.length).toBeGreaterThan(0);
      const channelRecord = (channelPutCalls[0][1] as any[])[0];
      expect(channelRecord.id).toBe('comm-audit-001');
      expect(channelRecord.contentType).toBe('CommMsgExtended');
      expect(channelRecord).not.toHaveProperty('resource');
      expect(channelRecord.content).toEqual({
        claims: expect.objectContaining({
          [CommunicationClaim.Identifier]: 'comm-audit-001',
          [CommunicationClaim.Subject]: subjectDid,
          [CommunicationClaim.Sent]: '2026-05-17T12:30:00Z',
          [CommunicationClaim.NoteText]: 'Permission update requested',
          [CommunicationClaim.ContentAttachmentType]: 'application/pdf',
          [CommunicationClaim.ContentAttachmentData]: Buffer.from('fake-pdf-content', 'utf8').toString('base64'),
          [CommunicationClaim.ContentAttachmentTitle]: 'request.pdf',
        }),
      });
    });

    it('persists a subjectless claims-only invitation in its addressed recipient channel', async () => {
      mockTenantsCacheManager.getTenantDid.mockResolvedValue(testServerDid as any);
      const recipient = `PractitionerRole/${EXAMPLE_KYC_CONTROLLER_UUID}`;
      const invitationData = Buffer.from('{"data":[]}', 'utf8').toString('base64');
      const job: JobRequest = {
        id: randomUUID(), status: JobStatus.DRAFT, sequence: 0, createdAtTimestamp: Date.now(),
        tenantId: 'acme', jurisdiction: 'ca-bc', sector: 'animal-care', section: 'individual',
        format: Format.FHIR_API as any, resourceType: ResourceTypesFhirR4.Communication, action: '_batch',
        content: {
          jti: randomUUID(), thid: EXAMPLE_COMMUNICATION_IDENTIFIER, iss: EXAMPLE_CONTROLLER_DID,
          aud: testServerDid, exp: Math.floor(Date.now() / 1000) + 300, type: 'api+json',
          body: { data: [{
            type: ResourceTypesFhirR4.Communication,
            resource: {
              resourceType: ResourceTypesFhirR4.Communication,
              id: EXAMPLE_COMMUNICATION_IDENTIFIER,
              meta: { claims: {
                '@context': Format.FHIR_API,
                [CommunicationClaim.Identifier]: EXAMPLE_COMMUNICATION_IDENTIFIER,
                [CommunicationClaim.Recipient]: recipient,
                [CommunicationClaim.Sender]: EXAMPLE_CONTROLLER_DID,
                [CommunicationClaim.Category]: buildExampleCommunicationParticipantProjection().category,
                [CommunicationClaim.Topic]: buildExampleCommunicationParticipantProjection().topic,
                [CommunicationClaim.ContentReference]: 'ResearchStudy/study-one',
                [CommunicationClaim.ContentAttachmentType]: HttpMediaTypes.JsonApi,
                [CommunicationClaim.ContentAttachmentData]: invitationData,
                [CommunicationClaim.ContentAttachmentTitle]: 'research-study-draft-consent.json',
              } },
            },
          }] },
        } as any,
      };

      const response = await communicationManager.process(job);

      expect((response.body as any).data[0]?.response?.status).toBe(String(200));
      const expectedSection = getSubjectScopedSectionId(recipient, 'individual', 'communications');
      const channelWrite = mockVaultRepository.put.mock.calls.find((call) => call[2] === expectedSection);
      expect(channelWrite).toBeDefined();
      const record = channelWrite?.[1]?.[0] as any;
      const documentToProtect = mockKmsService.protectConfidentialData.mock.calls[0]?.[0] as any;
      expect(documentToProtect.content).toEqual({
        claims: expect.objectContaining({
          '@context': Format.FHIR_API,
          [CommunicationClaim.Identifier]: EXAMPLE_COMMUNICATION_IDENTIFIER,
          [CommunicationClaim.Recipient]: recipient,
          [CommunicationClaim.Category]: buildExampleCommunicationParticipantProjection().category,
          [CommunicationClaim.Topic]: buildExampleCommunicationParticipantProjection().topic,
          [CommunicationClaim.ContentReference]: 'ResearchStudy/study-one',
          [CommunicationClaim.ContentAttachmentType]: HttpMediaTypes.JsonApi,
          [CommunicationClaim.ContentAttachmentData]: invitationData,
          [CommunicationClaim.ContentAttachmentTitle]: 'research-study-draft-consent.json',
        }),
      });
      expect(documentToProtect.content).not.toHaveProperty('resource');
      expect(documentToProtect).not.toHaveProperty('resource');
      expect(mockKmsService.protectAttributesNameAndValue).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ name: 'Communication.recipient-token', value: recipient }),
        ]),
        'animal-care_acme',
      );
      expect(record.indexed.attributes).toEqual(expect.arrayContaining([
        expect.objectContaining({
          name: 'protected:Communication.recipient-token',
          value: `protected:${recipient}`,
        }),
      ]));

      (mockVaultRepository.getAllSections as unknown as jest.MockedFunction<(...args: any[]) => Promise<string[]>>)
        .mockResolvedValue([expectedSection]);
      (mockVaultRepository.listContainersInSection as unknown as jest.MockedFunction<(...args: any[]) => Promise<any[]>>)
        .mockResolvedValue([record]);
      const searchResponse = await communicationManager.process({
        ...job,
        action: '_search',
        content: {
          ...(job.content as any),
          body: buildCommunicationParticipantSearchParameters(
            { subject: CommunicationParticipantPrefixes.Wildcard },
          ),
        },
      });
      const returnedClaims = (searchResponse.body as any).data[0]?.resource?.meta?.claims;
      expect(returnedClaims).toEqual(expect.objectContaining({
        [CommunicationClaim.Recipient]: recipient,
        [CommunicationClaim.Category]: buildExampleCommunicationParticipantProjection().category,
        [CommunicationClaim.Topic]: buildExampleCommunicationParticipantProjection().topic,
        [CommunicationClaim.ContentReference]: 'ResearchStudy/study-one',
        [CommunicationClaim.ContentAttachmentType]: HttpMediaTypes.JsonApi,
        [CommunicationClaim.ContentAttachmentData]: invitationData,
        [CommunicationClaim.ContentAttachmentTitle]: 'research-study-draft-consent.json',
      }));
      expect(returnedClaims[CommunicationClaim.Subject]).toBeUndefined();
    });

    it('accepts a native FHIR transport shell but persists only canonical Communication claims', async () => {
      mockTenantsCacheManager.getTenantDid.mockResolvedValue(testServerDid as any);
      const job: JobRequest = {
        id: randomUUID(), status: JobStatus.DRAFT, sequence: 0, createdAtTimestamp: Date.now(),
        tenantId: 'acme', jurisdiction: 'ca-bc', sector: 'animal-care', section: 'individual',
        format: Format.FHIR_API as any, resourceType: ResourceTypesFhirR4.Communication, action: '_batch',
        content: {
          jti: randomUUID(), thid: EXAMPLE_COMMUNICATION_IDENTIFIER, iss: EXAMPLE_CONTROLLER_DID,
          aud: testServerDid, exp: Math.floor(Date.now() / 1000) + 300, type: 'api+json',
          body: { data: [{
            type: ResourceTypesFhirR4.Communication,
            resource: {
              resourceType: ResourceTypesFhirR4.Communication,
              id: EXAMPLE_COMMUNICATION_IDENTIFIER,
              status: 'completed',
              meta: { claims: {
                '@context': Format.FHIR_API,
                [CommunicationClaim.Identifier]: EXAMPLE_COMMUNICATION_IDENTIFIER,
                [CommunicationClaim.Recipient]: `PractitionerRole/${EXAMPLE_KYC_CONTROLLER_UUID}`,
              } },
            },
          }] },
        } as any,
      };

      const response = await communicationManager.process(job);

      expect((response.body as any).data[0].response.status).toBe('200');
      expect(mockKmsService.protectConfidentialData).toHaveBeenCalledTimes(1);
      const [storageDocument] = mockKmsService.protectConfidentialData.mock.calls[0];
      expect(storageDocument.content).toEqual({
        claims: {
          '@context': Format.FHIR_API,
          [CommunicationClaim.Identifier]: EXAMPLE_COMMUNICATION_IDENTIFIER,
          [CommunicationClaim.Recipient]: `PractitionerRole/${EXAMPLE_KYC_CONTROLLER_UUID}`,
        },
      });
      expect(storageDocument).not.toHaveProperty('resource');
      expect(storageDocument).not.toHaveProperty('status', 'completed');
      expect(mockVaultRepository.put).toHaveBeenCalledTimes(1);
    });

    it('fails closed when search encounters a historical nested native Communication record', async () => {
      mockTenantsCacheManager.getTenantDid.mockResolvedValue(testServerDid as any);
      const sectionId = getSubjectScopedSectionId(EXAMPLE_SUBJECT_DID, 'individual', 'communications');
      (mockVaultRepository.getAllSections as unknown as jest.MockedFunction<(...args: any[]) => Promise<string[]>>)
        .mockResolvedValue([sectionId]);
      (mockVaultRepository.listContainersInSection as unknown as jest.MockedFunction<(...args: any[]) => Promise<any[]>>)
        .mockResolvedValue([{
        id: EXAMPLE_COMMUNICATION_IDENTIFIER,
        type: 'CommMsgExtended',
        content: {
          resource: {
            resourceType: ResourceTypesFhirR4.Communication,
            recipient: [{ reference: EXAMPLE_SUBJECT_DID }],
          },
        },
        indexed: { attributes: [] },
      }]);

      await expect(communicationManager.process({
        id: randomUUID(), status: JobStatus.DRAFT, sequence: 0, createdAtTimestamp: Date.now(),
        tenantId: 'acme', jurisdiction: EXAMPLE_HEALTHCARE_JURISDICTION, sector: Sector.HEALTH_CARE,
        section: 'individual', format: Format.FHIR_API as any,
        resourceType: ResourceTypesFhirR4.Communication, action: '_search',
        content: {
          jti: randomUUID(), thid: EXAMPLE_COMMUNICATION_IDENTIFIER, iss: EXAMPLE_CONTROLLER_DID,
          aud: testServerDid, exp: Math.floor(Date.now() / 1000) + 300, type: 'api+json',
          body: buildCommunicationParticipantSearchParameters(
            { subject: CommunicationParticipantPrefixes.Wildcard },
          ),
        } as any,
      })).rejects.toThrow('Historical native Communication requires an explicit recoverable migration.');
    });

    it('keeps non-active Consent Bundles without materializing an authorization rule', async () => {
      mockTenantsCacheManager.getTenantDid.mockResolvedValue(testServerDid as any);
      mockVaultRepository.vaultExists.mockResolvedValue(true as any);

      const permissionBundleEditor = new BundleEditor()
        .setBundleOperation(BundleOperations.create)
        .setBundleType(BundleTypes.batch)
        .setAllowedResourceType(BundleEditableResourceTypes.consent);
      permissionBundleEditor.newEntryAs(BundleEditableResourceTypes.consent)
        .setIdentifier(EXAMPLE_CONSENT_IDENTIFIER)
        .setStatus(ConsentStatuses.Draft)
        .setSubject(EXAMPLE_SUBJECT_DID)
        .setDecision(ConsentDecisions.Permit)
        .setActorIdentifierList([EXAMPLE_PROFESSIONAL_DID])
        .setPurposeList([HealthcareConsentPurposes.Treatment])
        .setSectionList([HealthcareBasicSections.PatientSummaryDocument.attributeValue])
        .doneEntry();
      const permissionBundle = permissionBundleEditor.buildJsonApi();

      const communicationClaims = {
        '@context': Format.FHIR_API,
        [CommunicationClaim.Identifier]: EXAMPLE_COMMUNICATION_IDENTIFIER,
        [CommunicationClaim.Subject]: EXAMPLE_SUBJECT_DID,
        [CommunicationClaim.Sender]: EXAMPLE_PROFESSIONAL_DID,
        [CommunicationClaim.Recipient]: EXAMPLE_SUBJECT_DID,
        [CommunicationClaim.ContentAttachmentType]: EXAMPLE_CONTENT_TYPE_FHIR_JSON,
        [CommunicationClaim.ContentAttachmentData]: Buffer.from(
          JSON.stringify(permissionBundle),
          'utf8',
        ).toString('base64'),
      };
      const job: JobRequest = {
        id: randomUUID(),
        status: JobStatus.DRAFT,
        sequence: 0,
        createdAtTimestamp: Date.now(),
        tenantId: 'acme',
        jurisdiction: EXAMPLE_HEALTHCARE_JURISDICTION,
        sector: Sector.HEALTH_CARE,
        section: 'individual',
        format: Format.FHIR_API as any,
        resourceType: ResourceTypesFhirR4.Communication,
        action: '_batch',
        content: {
          jti: randomUUID(),
          thid: EXAMPLE_COMMUNICATION_IDENTIFIER,
          iss: EXAMPLE_PROFESSIONAL_DID,
          aud: testServerDid,
          exp: Math.floor(Date.now() / 1000) + 300,
          type: 'api+json',
          body: {
            data: [{
              type: ResourceTypesFhirR4.Communication,
              resource: {
                resourceType: ResourceTypesFhirR4.Communication,
                meta: { claims: communicationClaims },
              },
            }],
          },
        } as any,
      };

      const response = await communicationManager.process(job);

      expect((response.body as any).data[0]?.response?.status).toBe('200');
      const writtenSectionIds = mockVaultRepository.put.mock.calls.map((call) => String(call[2] || ''));
      expect(writtenSectionIds.some((sectionId) => sectionId.endsWith('_rules'))).toBe(false);
      expect(writtenSectionIds.some((sectionId) => sectionId.endsWith('_consents'))).toBe(false);
      expect(writtenSectionIds.some((sectionId) => sectionId.includes('communications'))).toBe(true);

      const statuslessPermissionBundle = structuredClone(permissionBundle) as any;
      delete statuslessPermissionBundle.data[0].resource.status;
      const statuslessJob = structuredClone(job) as JobRequest;
      const statuslessCommunicationClaims = (statuslessJob.content!.body as any).data[0].resource.meta.claims;
      statuslessCommunicationClaims[CommunicationClaim.ContentAttachmentData] = Buffer.from(
        JSON.stringify(statuslessPermissionBundle),
        'utf8',
      ).toString('base64');
      mockVaultRepository.put.mockClear();

      await communicationManager.process(statuslessJob);

      const statuslessWrittenSectionIds = mockVaultRepository.put.mock.calls.map((call) => String(call[2] || ''));
      expect(statuslessWrittenSectionIds.some((sectionId) => sectionId.endsWith('_rules'))).toBe(false);
      expect(statuslessWrittenSectionIds.some((sectionId) => sectionId.includes('communications'))).toBe(true);
    });
  });

  describe('process (embedded Bundle/_search request)', () => {
    const subjectDid = 'did:web:api.acme.org:individual:ips-search-subject-001';

    it('executes Bundle/_search referenced in Communication.contentReference and returns the search response', async () => {
      mockTenantsCacheManager.getTenantDid.mockResolvedValue(testServerDid as any);
      mockVaultRepository.vaultExists.mockResolvedValue(true as any);
      mockCompositionManager.process.mockImplementation(async () => ({
        jti: randomUUID(),
        iss: testServerDid,
        aud: 'did:web:sender.example',
        exp: Math.floor(Date.now() / 1000) + 300,
        thid: 'thread-ips-search-001',
        type: 'transaction-response',
        body: {
          resourceType: 'Bundle',
          type: 'batch-response',
          data: [
            {
              type: 'Bundle-search-response-v1.0',
              response: { status: '200' },
              resource: {
                resourceType: 'Bundle',
                type: 'document',
                entry: [{ resource: { resourceType: 'Composition' } }],
              },
            },
          ],
        },
      }) as any);

      const decoded: IDecodedDidcommPayload = {
        jti: randomUUID(),
        thid: 'thread-ips-search-001',
        iss: 'did:web:sender.example',
        aud: 'did:web:receiver.example',
        exp: Math.floor(Date.now() / 1000) + 300,
        type: 'org.hl7.fhir.r4.Bundle',
        body: {
          resourceType: 'Bundle',
          type: 'batch',
          data: [
            {
              type: 'Communication',
              meta: {
                claims: {
                  '@context': 'org.hl7.fhir.r4',
                  'Communication.identifier': 'comm-ips-search-001',
                  'Communication.subject': subjectDid,
                  'Communication.sent': '2026-06-02T10:00:00Z',
                },
              },
              resource: {
                resourceType: 'Communication',
                status: 'completed',
                subject: { reference: subjectDid },
                payload: [
                  {
                    contentReference: {
                      reference: `individual/org.hl7.fhir.r4/Bundle/_search?type=document&composition.subject=${encodeURIComponent(subjectDid)}&composition.type=http%3A%2F%2Floinc.org%7C60591-5`,
                    },
                  },
                ],
              },
            },
          ],
        } as any,
      };

      const job: JobRequest = {
        id: randomUUID(),
        status: JobStatus.DRAFT,
        sequence: 0,
        createdAtTimestamp: Date.now(),
        tenantId: 'acme',
        jurisdiction: 'es',
        sector: 'health-care',
        section: 'individual',
        format: 'org.hl7.fhir.r4' as any,
        resourceType: 'Communication',
        action: '_batch',
        content: decoded,
      };

      const response = await communicationManager.process(job);
      const data = (response.body as any)?.data;
      expect(Array.isArray(data)).toBe(true);
      expect(data[0]?.type).toBe('Bundle-search-response-v1.0');
      expect(data[0]?.resource?.type).toBe('document');
      expect(mockCompositionManager.process).toHaveBeenCalledTimes(1);
      const forwardedJob = mockCompositionManager.process.mock.calls[0][0] as JobRequest;
      expect(forwardedJob.resourceType).toBe('Bundle');
      expect(forwardedJob.action).toBe('_search');
      expect((forwardedJob.content as any)?.body?.entry?.[0]?.request?.url).toBe(
        `Bundle?type=document&composition.subject=${encodeURIComponent(subjectDid)}&composition.type=http%3A%2F%2Floinc.org%7C60591-5`,
      );
    });

    it('executes Subject/$summary referenced in Communication.contentReference as a summary operation', async () => {
      // Teaching goal:
      // Prove the public-to-internal boundary: the caller submits one
      // Communication job, and only CommunicationManager delegates its
      // contentReference to the internal summary processor.
      mockTenantsCacheManager.getTenantDid.mockResolvedValue(testServerDid as any);
      mockVaultRepository.vaultExists.mockResolvedValue(true as any);
      mockCompositionManager.process.mockImplementation(async () => ({
        jti: randomUUID(),
        iss: testServerDid,
        aud: 'did:web:sender.example',
        exp: Math.floor(Date.now() / 1000) + 300,
        thid: 'thread-subject-summary-001',
        type: 'transaction-response',
        body: {
          resourceType: 'Bundle',
          type: 'batch-response',
          data: [
            {
              type: 'Bundle-summary-response-v1.0',
              response: { status: '200' },
              resource: {
                resourceType: 'Bundle',
                type: 'document',
              },
            },
          ],
        },
      }) as any);

      const decoded: IDecodedDidcommPayload = {
        jti: randomUUID(),
        thid: 'thread-subject-summary-001',
        iss: 'did:web:sender.example',
        aud: 'did:web:receiver.example',
        exp: Math.floor(Date.now() / 1000) + 300,
        type: 'org.hl7.fhir.r4.Bundle',
        body: {
          resourceType: 'Bundle',
          type: 'batch',
          data: [
            {
              type: 'Communication',
              resource: {
                resourceType: 'Communication',
                status: 'completed',
                subject: { reference: subjectDid },
                payload: [
                  {
                    contentReference: {
                      reference: `individual/org.hl7.fhir.r4/Subject/$summary?subject=${encodeURIComponent(subjectDid)}`,
                    },
                  },
                ],
              },
            },
          ],
        } as any,
      };

      const job: JobRequest = {
        id: randomUUID(),
        status: JobStatus.DRAFT,
        sequence: 0,
        createdAtTimestamp: Date.now(),
        tenantId: 'acme',
        jurisdiction: 'es',
        sector: 'health-care',
        section: 'individual',
        format: 'org.hl7.fhir.r4' as any,
        resourceType: 'Communication',
        action: '_batch',
        content: decoded,
      };

      const response = await communicationManager.process(job);
      // The test calls CommunicationManager only. A portal/BFF must never copy
      // the forwarded job below into a direct Subject/$summary HTTP request.
      const data = (response.body as any)?.data;
      expect(Array.isArray(data)).toBe(true);
      expect(data[0]?.type).toBe('Bundle-summary-response-v1.0');
      const forwardedJob = mockCompositionManager.process.mock.calls[0][0] as JobRequest;
      expect(forwardedJob.resourceType).toBe('Subject');
      expect(forwardedJob.action).toBe('$summary');
      expect((forwardedJob.content as any)?.body?.resourceType).toBe('Parameters');
      expect((forwardedJob.content as any)?.body?.parameter).toEqual([
        { name: 'subject', valueString: subjectDid },
      ]);
    });

    it('uses claims-first FHIR Parameters directly without manufacturing a native payload', async () => {
      mockTenantsCacheManager.getTenantDid.mockResolvedValue(testServerDid as any);
      mockVaultRepository.vaultExists.mockResolvedValue(true as any);
      mockCompositionManager.process.mockImplementation(async (forwardedJobInput: unknown) => {
        const forwardedJob = forwardedJobInput as JobRequest;
        return ({
          jti: randomUUID(),
          iss: testServerDid,
          aud: 'did:web:sender.example',
          exp: Math.floor(Date.now() / 1000) + 300,
          thid: 'thread-subject-summary-parameters-001',
          type: 'transaction-response',
          body: {
            resourceType: 'Bundle',
            type: 'batch-response',
            data: [{
              type: 'Bundle-summary-response-v1.0',
              response: { status: '200' },
              resource: {
                resourceType: 'Bundle',
                type: 'document',
                meta: { forwardedBody: (forwardedJob.content as any)?.body },
              },
            }],
          },
        }) as any;
      });

      const parameters = {
        resourceType: 'Parameters',
        parameter: [
          { name: 'subject', valueString: subjectDid },
          { name: 'document-type', valueString: 'http://loinc.org|60591-5' },
          { name: 'section', valueString: 'LOINC|48765-2' },
        ],
      };
      const decoded: IDecodedDidcommPayload = {
        jti: randomUUID(),
        thid: 'thread-subject-summary-parameters-001',
        iss: 'did:web:sender.example',
        aud: 'did:web:receiver.example',
        exp: Math.floor(Date.now() / 1000) + 300,
        type: 'org.hl7.fhir.api.Bundle',
        body: {
          resourceType: 'Bundle',
          type: 'batch',
          data: [{
            type: 'Communication',
            resource: {
              resourceType: 'Communication',
              meta: {
                claims: {
                  '@context': 'org.hl7.fhir.api',
                  'Communication.status': 'completed',
                  'Communication.subject': subjectDid,
                  'Communication.content-reference': 'individual/org.hl7.fhir.api/Subject/$summary',
                  'Communication.content-attachment-type': 'application/fhir+json',
                  'Communication.content-attachment-data':
                    Buffer.from(JSON.stringify(parameters), 'utf8').toString('base64'),
                },
              },
            },
          }],
        } as any,
      };
      const job: JobRequest = {
        id: randomUUID(),
        status: JobStatus.DRAFT,
        sequence: 0,
        createdAtTimestamp: Date.now(),
        tenantId: 'acme',
        jurisdiction: 'es',
        sector: 'health-care',
        section: 'individual',
        format: 'org.hl7.fhir.api' as any,
        resourceType: 'Communication',
        action: '_batch',
        content: decoded,
      };

      expect((decoded.body as any).data[0].resource.payload).toBeUndefined();
      await communicationManager.process(job);

      const forwardedJob = mockCompositionManager.process.mock.calls[0][0] as JobRequest;
      expect(forwardedJob.resourceType).toBe('Subject');
      expect(forwardedJob.action).toBe('$summary');
      expect((forwardedJob.content as any)?.body).toEqual(parameters);
    });

    it('treats Patient/$summary as an alias of Subject/$summary', async () => {
      mockTenantsCacheManager.getTenantDid.mockResolvedValue(testServerDid as any);
      mockVaultRepository.vaultExists.mockResolvedValue(true as any);
      mockCompositionManager.process.mockImplementation(async () => ({
        jti: randomUUID(),
        iss: testServerDid,
        aud: 'did:web:sender.example',
        exp: Math.floor(Date.now() / 1000) + 300,
        thid: 'thread-patient-summary-001',
        type: 'transaction-response',
        body: {
          resourceType: 'Bundle',
          type: 'batch-response',
          data: [
            {
              type: 'Bundle-summary-response-v1.0',
              response: { status: '200' },
              resource: {
                resourceType: 'Bundle',
                type: 'document',
              },
            },
          ],
        },
      }) as any);

      const decoded: IDecodedDidcommPayload = {
        jti: randomUUID(),
        thid: 'thread-patient-summary-001',
        iss: 'did:web:sender.example',
        aud: 'did:web:receiver.example',
        exp: Math.floor(Date.now() / 1000) + 300,
        type: 'org.hl7.fhir.r4.Bundle',
        body: {
          resourceType: 'Bundle',
          type: 'batch',
          data: [
            {
              type: 'Communication',
              resource: {
                resourceType: 'Communication',
                status: 'completed',
                subject: { reference: subjectDid },
                payload: [
                  {
                    contentReference: {
                      reference: `individual/org.hl7.fhir.r4/Patient/$summary?subject=${encodeURIComponent(subjectDid)}`,
                    },
                  },
                ],
              },
            },
          ],
        } as any,
      };

      const job: JobRequest = {
        id: randomUUID(),
        status: JobStatus.DRAFT,
        sequence: 0,
        createdAtTimestamp: Date.now(),
        tenantId: 'acme',
        jurisdiction: 'es',
        sector: 'health-care',
        section: 'individual',
        format: 'org.hl7.fhir.r4' as any,
        resourceType: 'Communication',
        action: '_batch',
        content: decoded,
      };

      await communicationManager.process(job);

      const forwardedJob = mockCompositionManager.process.mock.calls[0][0] as JobRequest;
      expect(forwardedJob.resourceType).toBe('Subject');
      expect(forwardedJob.action).toBe('$summary');
    });
  });

  describe('process (embedded Subject/_search request)', () => {
    it('forwards Subject/_search referenced in Communication payload with attached Parameters', async () => {
      mockTenantsCacheManager.getTenantDid.mockResolvedValue(testServerDid as any);
      mockVaultRepository.vaultExists.mockResolvedValue(true as any);
      (mockIndividualManager.process as any).mockResolvedValue({
        jti: randomUUID(),
        iss: testServerDid,
        aud: 'did:web:sender.example',
        exp: Math.floor(Date.now() / 1000) + 300,
        thid: 'thread-subject-search-001',
        type: 'transaction-response',
        body: {
          resourceType: 'Bundle',
          type: 'batch-response',
          data: [
            {
              type: 'Subject-search-response-v1.0',
              response: { status: '200' },
              resource: {
                resourceType: 'Bundle',
                type: 'searchset',
                total: 3,
                data: [{ id: 'consent-1' }, { id: 'consent-2' }, { id: 'consent-3' }],
              },
            },
          ],
        },
      } as any);

      const parametersResource = {
        resourceType: 'Parameters',
        parameter: [
          { name: 'subject', valueString: 'did:web:api.acme.org:individual:123' },
        ],
      };

      const decoded: IDecodedDidcommPayload = {
        jti: randomUUID(),
        thid: 'thread-subject-search-001',
        iss: 'did:web:sender.example',
        aud: 'did:web:receiver.example',
        exp: Math.floor(Date.now() / 1000) + 300,
        type: 'org.hl7.fhir.r4.Bundle',
        body: {
          resourceType: 'Bundle',
          type: 'batch',
          data: [
            {
              type: 'Communication',
              resource: {
                resourceType: 'Communication',
                status: 'completed',
                subject: { reference: 'did:web:api.acme.org:individual:123' },
                payload: [
                  {
                    contentReference: {
                      reference: 'individual/org.hl7.fhir.api/Subject/_search',
                    },
                    contentAttachment: {
                      contentType: 'application/fhir+json',
                      title: 'subject-search-parameters.json',
                      data: Buffer.from(JSON.stringify(parametersResource), 'utf8').toString('base64'),
                    },
                  },
                ],
              },
            },
          ],
        } as any,
      };

      const job: JobRequest = {
        id: randomUUID(),
        status: JobStatus.DRAFT,
        sequence: 0,
        createdAtTimestamp: Date.now(),
        tenantId: 'acme',
        jurisdiction: 'es',
        sector: 'health-care',
        section: 'individual',
        format: 'org.hl7.fhir.r4' as any,
        resourceType: 'Communication',
        action: '_batch',
        content: decoded,
      };

      const response = await communicationManager.process(job);
      const data = (response.body as any)?.data;
      expect(Array.isArray(data)).toBe(true);
      expect(data[0]?.type).toBe('Subject-search-response-v1.0');
      expect(mockIndividualManager.process).toHaveBeenCalledTimes(1);
      const forwardedJob = mockIndividualManager.process.mock.calls[0][0] as JobRequest;
      expect(forwardedJob.resourceType).toBe('Subject');
      expect(forwardedJob.action).toBe('_search');
      expect((forwardedJob.content as any)?.body).toEqual(parametersResource);
    });
  });

  describe('participant search and indexing', () => {
    it('stores normalized participant index attributes in channel projections', async () => {
      mockTenantsCacheManager.getTenantDid.mockResolvedValue(testServerDid as any);

      const fhirResource = {
        resourceType: 'Communication' as const,
        status: 'completed',
        category: [{
          coding: [{ system: 'https://online.unid/ns/communication-category', code: 'access-request' }],
        }],
        topic: {
          coding: [{ system: 'https://online.unid/ns/communication-topic', code: 'card-permission' }],
        },
        subject: { reference: 'did:web:subject.example' },
        sender: { reference: 'mailto:Sender@Example.org' },
        recipient: [
          { reference: 'did:web:member.example' },
          { reference: '+34 600 111 222' },
        ],
        sent: '2026-06-15T10:00:00Z',
      };

      const job: JobRequest = {
        id: randomUUID(),
        status: JobStatus.DRAFT,
        sequence: 0,
        createdAtTimestamp: Date.now(),
        tenantId: 'acme',
        jurisdiction: 'es',
        sector: 'health-care',
        section: 'individual',
        format: 'org.hl7.fhir.r4' as any,
        resourceType: 'Communication',
        action: '_batch',
        content: {
          jti: randomUUID(),
          thid: 'thread-participant-index-001',
          iss: 'did:web:sender.example',
          aud: 'did:web:gw.example',
          exp: Math.floor(Date.now() / 1000) + 300,
          type: 'api+json',
          body: {
            resourceType: 'Bundle',
            type: 'batch',
            data: [{ resource: fhirResource }],
          },
        } as any,
      };

      await communicationManager.process(job);

      const communicationSectionWrite = mockVaultRepository.put.mock.calls.find((call) =>
        String(call[2] || '').includes('communications'),
      );
      expect(communicationSectionWrite).toBeDefined();
      const storedRecord = communicationSectionWrite?.[1]?.[0] as Record<string, any>;
      expect(storedRecord.indexed?.attributes).toEqual(expect.arrayContaining([
        expect.objectContaining({ name: 'protected:Communication.sender-token', value: 'protected:email:sender@example.org' }),
        expect.objectContaining({ name: 'protected:Communication.recipient-token', value: 'protected:did:web:member.example' }),
        expect.objectContaining({ name: 'protected:Communication.recipient-token', value: 'protected:tel:+34600111222' }),
      ]));
      expect(storedRecord.content.claims[CommunicationClaim.Category]).toBe(
        'https://online.unid/ns/communication-category|access-request',
      );
      expect(storedRecord.content.claims[CommunicationClaim.Topic]).toBe(
        'https://online.unid/ns/communication-topic|card-permission',
      );
      expect(storedRecord).not.toHaveProperty(CommunicationClaim.Category);
      expect(storedRecord).not.toHaveProperty(CommunicationClaim.Topic);
    });

    it('searches communication channel records through Parameters criteria and wildcard subject scope', async () => {
      mockTenantsCacheManager.getTenantDid.mockResolvedValue(testServerDid as any);

      const firstSection = getSubjectScopedSectionId('did:web:subject.example', 'individual', 'communications');
      const secondSection = getSubjectScopedSectionId('did:web:subject.example:secondary', 'individual', 'communications');
      (mockVaultRepository.getAllSections as unknown as jest.MockedFunction<(...args: any[]) => Promise<string[]>>)
        .mockResolvedValue([
        firstSection,
        secondSection,
        'test_individual_dictionary_abc',
      ]);
      (mockVaultRepository.listContainersInSection as unknown as jest.MockedFunction<(...args: any[]) => Promise<any[]>>)
        .mockImplementation(async (...args: any[]) => {
        const sectionId = args[1] as string;
        if (sectionId === firstSection) {
          const firstProjection = buildExampleCommunicationParticipantProjection();
          // Exact serialized attachment values are the behavior under test: a
          // participant search must return the protected Communication payload.
          const invitationData = Buffer.from('{"data":[]}', 'utf8').toString('base64');
          const indexes = [
            ...buildCommunicationParticipantIndexAttributes({
              sender: firstProjection.sender,
              recipients: firstProjection.recipients,
            }),
            { name: CommunicationClaim.Category, value: firstProjection.category, unique: false },
            { name: CommunicationClaim.Topic, value: firstProjection.topic, unique: false },
          ].map(attribute => ({ ...attribute, name: `protected:${attribute.name}`, value: `protected:${attribute.value}` }));
          return [{
            id: firstProjection.id,
            contentType: 'CommMsgExtended',
            indexed: { attributes: indexes },
            content: { claims: {
              '@context': Format.FHIR_API,
              [CommunicationClaim.Identifier]: 'comm-1',
              [CommunicationClaim.PartOf]: 'channel-one',
              [CommunicationClaim.Sender]: firstProjection.sender,
              [CommunicationClaim.Recipient]: (firstProjection.recipients as string[]).join(','),
              [CommunicationClaim.Category]: firstProjection.category,
              [CommunicationClaim.Topic]: firstProjection.topic,
              [CommunicationClaim.ContentReference]: 'ResearchStudy/study-one',
              [CommunicationClaim.ContentAttachmentType]: HttpMediaTypes.JsonApi,
              [CommunicationClaim.ContentAttachmentData]: invitationData,
              [CommunicationClaim.ContentAttachmentTitle]: 'research-study-draft-consent.json',
              [CommunicationClaim.Sent]: '2026-06-15T10:00:00Z',
            } },
          }];
        }
        const secondProjection = buildExampleCommunicationParticipantProjection({
            id: 'communication-participant-record-002',
            subject: 'did:web:subject.example:secondary',
            recipients: ['did:web:somebody.else'],
          });
        return [{
          id: secondProjection.id,
          contentType: 'CommMsgExtended',
          indexed: { attributes: [] },
          content: { claims: {
            '@context': Format.FHIR_API,
            [CommunicationClaim.Identifier]: 'comm-2',
            [CommunicationClaim.Subject]: secondProjection.subject,
            [CommunicationClaim.Sender]: secondProjection.sender,
            [CommunicationClaim.Recipient]: (secondProjection.recipients as string[]).join(','),
            [CommunicationClaim.Category]: secondProjection.category,
            [CommunicationClaim.Topic]: secondProjection.topic,
            [CommunicationClaim.Sent]: '2026-06-15T11:00:00Z',
          } },
        }];
      });

      const job: JobRequest = {
        id: randomUUID(),
        status: JobStatus.DRAFT,
        sequence: 0,
        createdAtTimestamp: Date.now(),
        tenantId: 'acme',
        jurisdiction: 'es',
        sector: 'health-care',
        section: 'individual',
        format: 'org.hl7.fhir.r4' as any,
        resourceType: 'Communication',
        action: '_search',
        content: {
          jti: randomUUID(),
          thid: 'thread-participant-search-001',
          iss: 'did:web:searcher.example',
          aud: 'did:web:gw.example',
          exp: Math.floor(Date.now() / 1000) + 300,
          type: 'api+json',
          body: buildCommunicationParticipantSearchParameters(
            buildExampleCommunicationParticipantSearchInput({
              subject: CommunicationParticipantPrefixes.Wildcard,
            }),
          ),
        } as any,
      };

      const response = await communicationManager.process(job);
      const data = (response.body as any).data;
      expect(data).toHaveLength(1);
      expect(data[0].id).toBe('communication-participant-record-001');
      expect(data[0].resource.meta.claims['@context']).toBe(Format.FHIR_API);
      expect(Object.keys(data[0].resource.meta.claims).some((key) =>
        key.startsWith(`${Format.FHIR_R4}.Communication.`))).toBe(false);
      expect(data[0].resource.meta.claims[CommunicationClaim.Identifier]).toBe('comm-1');
      expect(Object.keys(data[0].resource).sort()).toEqual(['id', 'meta', 'resourceType']);
      expect(data[0].resource.resourceType).toBe(ResourceTypesFhirR4.Communication);
      expect(data[0].resource.meta.claims).toEqual(expect.objectContaining({
        [CommunicationClaim.Category]: buildExampleCommunicationParticipantProjection().category,
        [CommunicationClaim.Topic]: buildExampleCommunicationParticipantProjection().topic,
        [CommunicationClaim.ContentReference]: 'ResearchStudy/study-one',
        [CommunicationClaim.ContentAttachmentType]: HttpMediaTypes.JsonApi,
        [CommunicationClaim.ContentAttachmentData]: Buffer.from('{"data":[]}', 'utf8').toString('base64'),
        [CommunicationClaim.ContentAttachmentTitle]: 'research-study-draft-consent.json',
        [CommunicationClaim.PartOf]: 'channel-one',
      }));
      expect(Object.values(data[0].resource.meta.claims).every((value) =>
        typeof value === 'string' && value.trim().length > 0)).toBe(true);
      expect(data[0].resource.meta.claims[CommunicationClaim.Subject]).toBeUndefined();
    });
  });
});
