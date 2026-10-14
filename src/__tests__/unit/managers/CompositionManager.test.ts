// Flow contract: reuse shared test fixtures and canonical types; do not introduce duplicated literals.
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.
// File: src/__tests__/unit/managers/CompositionManager.test.ts
// Flow contract: digital-twin search applies one Composition section, ANDs text/date within each governed resource family, ORs families, and returns each pseudonymous subject once.

import { describe, expect, it, jest, beforeEach } from '@jest/globals';
import {
  CompositionManager,
} from '../../../managers/CompositionManager';
import { TwinCompositionManager, TWIN_COMPOSITION_SECTION_RESOURCE_CONFIG } from '../../../managers/TwinCompositionManager';
import { IVaultRepository } from '../../../database/repositories/vault/vault.repository';
import { JobRequest, JobStatus } from 'gdc-common-utils-ts/models/confidential-job';
import {
  DataCollectionIds,
  HealthcareBasicSections,
  HealthcareSummarySections,
} from 'gdc-common-utils-ts/constants/index';
import { getSubjectScopedSectionId } from '../../../utils/individual-sections';
import {
  COMPOSITION_BATCH_ENTRY_EXAMPLE,
  COMPOSITION_SEARCH_BUNDLE_EXAMPLE,
  COMPOSITION_SEARCH_PARAMETERS_EXAMPLE,
} from '../../../api-examples';
import { buildOrganizationDidWeb, buildProfessionalDidWeb } from 'gdc-common-utils-ts/utils/did';
import { extractBundleSearchResources } from 'gdc-common-utils-ts/utils/organization-employee-lifecycle';
import { ResourceTypesFhirR4 } from 'gdc-common-utils-ts/constants/fhir-resource-types';
import { FhirIpsCreatorKinds } from 'gdc-common-utils-ts/utils/fhir-ips-creator-identity';
import { CompositionAttesterModes } from 'gdc-common-utils-ts';
import {
  EXAMPLE_HOST_PUBLIC_HOSTNAME,
  EXAMPLE_HEALTHCARE_ACTOR_ROLE_PHYSICIAN,
  EXAMPLE_IPS_COMPOSITION_IDENTIFIER,
  EXAMPLE_KYC_CONTROLLER_USER_UUID,
  EXAMPLE_KYC_CONTROLLER_UUID,
  EXAMPLE_PROFESSIONAL_DID,
  EXAMPLE_ROUTE_VERSION,
  EXAMPLE_SUBJECT_DID,
  EXAMPLE_TENANT_SERVICE_DID,
  EXAMPLE_TENANT_ROUTE_CONTEXT,
} from 'gdc-common-utils-ts/examples/shared';
import {
  ExampleEmployeeEmails,
  ExampleEmployeeRoles,
} from 'gdc-common-utils-ts/examples/employee';
import { getDigitalTwinSubjectAliasSectionId } from '../../../utils/digital-twin-research-projection';
import { EXAMPLE_INTER_TENANT_ACCESS_CONTRACT_PROVIDER_ORGANIZATION_URN } from 'gdc-common-utils-ts/examples/inter-tenant-access-contract';
import { getClinicalCreatorBindingsSectionId } from '../../../utils/ips-bundle';

const HOSTED_ORGANIZATION_DID = buildOrganizationDidWeb({
  hostDidWeb: `did:web:${EXAMPLE_HOST_PUBLIC_HOSTNAME}`,
  tenantId: EXAMPLE_TENANT_ROUTE_CONTEXT.tenantId,
  jurisdiction: EXAMPLE_TENANT_ROUTE_CONTEXT.jurisdiction,
  version: EXAMPLE_ROUTE_VERSION,
  sector: EXAMPLE_TENANT_ROUTE_CONTEXT.sector,
});
const OPERATIONAL_EMPLOYEE_DID = buildProfessionalDidWeb({
  organizationDidWeb: HOSTED_ORGANIZATION_DID,
  email: ExampleEmployeeEmails.SharedProfessional,
  role: ExampleEmployeeRoles.Doctor,
});
const REGISTERED_TWIN_SUBJECT = 'urn:uuid:00000000-0000-4000-8000-000000000101';

/**
 * Flow contract: authorized callers search one tenant's pseudonymous twins;
 * basic discovery applies OR across requested IPS sections and AND across
 * text and clinical-date constraints on the same resource, then returns each
 * twin Composition once without exposing the internal search document.
 */
describe('CompositionManager', () => {
  const mockVaultRepository = {
    vaultExists: jest.fn(),
    put: jest.fn(),
    query: jest.fn(),
    getContainersInSection: jest.fn(),
    listContainersInSection: jest.fn(),
    getAllSections: jest.fn(),
    get: jest.fn(),
    delete: jest.fn(),
  } as unknown as jest.Mocked<IVaultRepository>;

  const manager = new CompositionManager(mockVaultRepository);

  beforeEach(() => {
    jest.clearAllMocks();
    mockVaultRepository.vaultExists.mockResolvedValue(true as any);
    mockVaultRepository.put.mockResolvedValue(true as any);
    mockVaultRepository.query.mockResolvedValue([] as any);
    mockVaultRepository.getContainersInSection.mockImplementation(async (_vaultId: string, sectionId: string) => (
      sectionId === getDigitalTwinSubjectAliasSectionId()
        ? [{ id: 'source-subject-hash', twinSubjectId: REGISTERED_TWIN_SUBJECT }]
        : []
    ) as any);
    mockVaultRepository.listContainersInSection.mockResolvedValue([] as any);
    mockVaultRepository.getAllSections.mockResolvedValue([] as any);
    mockVaultRepository.get.mockResolvedValue({ twinSubjectId: REGISTERED_TWIN_SUBJECT } as any);
    mockVaultRepository.delete.mockResolvedValue(true as any);
  });

  const createJob = (overrides: Partial<JobRequest> = {}): JobRequest => ({
    id: 'job-comp-1',
    status: JobStatus.DRAFT,
    sequence: 0,
    createdAtTimestamp: Date.now(),
    tenantId: 'acme',
    jurisdiction: 'es',
    sector: 'animal-research',
    section: 'digitaltwin',
    format: 'org.hl7.fhir.api',
    resourceType: 'Composition',
    action: '_batch',
    content: {
      jti: 'jti-comp-1',
      thid: 'thid-comp-1',
      iss: 'did:web:clinic.example.com:employee:loader',
      aud: 'did:web:api.example.com',
      exp: Math.floor(Date.now() / 1000) + 300,
      type: 'org.hl7.fhir.api.Bundle',
      body: {
        resourceType: 'Bundle',
        type: 'batch',
        entry: [
          {
            ...COMPOSITION_BATCH_ENTRY_EXAMPLE,
            resource: {
              ...(COMPOSITION_BATCH_ENTRY_EXAMPLE as any).resource,
              meta: { claims: {
                ...(COMPOSITION_BATCH_ENTRY_EXAMPLE as any).resource.meta.claims,
                '@type': 'Composition:ResearcherWorkingSelection',
                'Composition.subject': REGISTERED_TWIN_SUBJECT,
              } },
            },
          },
        ],
      } as any,
    } as any,
    ...overrides,
  });

  it('fails fast when job.section is missing', async () => {
    const job = createJob({ section: '' as any });
    await expect(manager.process(job)).rejects.toThrow('Missing required job.section');
  });

  it('returns polling path without resource id and stores in digitaltwin scope', async () => {
    const job = createJob();
    const response = await manager.process(job);
    const data = (response.body as any).data;
    expect(data[0].response.status).toBe('201');
    expect(data[0].response.location).toBe(
      '/acme/cds-es/v1/animal-research/digitaltwin/org.hl7.fhir.api/Composition/_batch-response'
    );
    expect(data[0].response.location).not.toMatch(/\/Composition\/[0-9a-f]{8,}/i);

    const expectedSectionId = getSubjectScopedSectionId(
      REGISTERED_TWIN_SUBJECT,
      'digitaltwin',
      'composition',
    );
    expect(mockVaultRepository.put).toHaveBeenCalled();
    const putArgs = (mockVaultRepository.put as any).mock.calls[0];
    expect(putArgs[0]).toBe('animal-research_acme');
    expect(putArgs[2]).toBe(expectedSectionId);
  });

  it('limits Subject/$summary to the sections carried by the authenticated SMART scope', async () => {
    const subjectDid = EXAMPLE_SUBJECT_DID;
    const problemSection = HealthcareBasicSections.ProblemList.attributeValue;
    const medicationSection = HealthcareBasicSections.HistoryOfMedicationUse.attributeValue;
    const allergySection = HealthcareBasicSections.AllergiesAndIntolerances.attributeValue;

    mockVaultRepository.listContainersInSection.mockImplementation(async (_vaultId: string, sectionId: string) => {
      if (sectionId === getSubjectScopedSectionId(subjectDid, 'individual', DataCollectionIds.composition)) {
        return [{
          id: 'composition-smart-section-contract',
          'Composition.identifier': 'urn:uuid:composition-smart-section-contract',
          'Composition.subject': subjectDid,
          'Composition.section': [problemSection, medicationSection, allergySection].join(','),
          'Composition.date': '2026-10-05T00:00:00Z',
          'Composition.author': EXAMPLE_TENANT_SERVICE_DID,
          'Composition.type': HealthcareBasicSections.PatientSummaryDocument.attributeValue,
        }] as any;
      }
      if (sectionId === getSubjectScopedSectionId(subjectDid, 'individual', DataCollectionIds.conditions)) {
        return [{
          id: 'condition-smart-section-contract',
          'Condition.identifier': 'urn:uuid:condition-smart-section-contract',
          'Condition.subject': subjectDid,
          'Composition.section': problemSection,
        }] as any;
      }
      if (sectionId === getSubjectScopedSectionId(subjectDid, 'individual', DataCollectionIds.medications)) {
        return [{
          id: 'medication-smart-section-contract',
          'MedicationStatement.identifier': 'urn:uuid:medication-smart-section-contract',
          'MedicationStatement.subject': subjectDid,
          'MedicationStatement.status': 'active',
          'Composition.section': medicationSection,
        }] as any;
      }
      if (sectionId === getSubjectScopedSectionId(subjectDid, 'individual', DataCollectionIds.allergies)) {
        return [{
          id: 'allergy-smart-section-contract',
          'AllergyIntolerance.identifier': 'urn:uuid:allergy-smart-section-contract',
          'AllergyIntolerance.subject': subjectDid,
          'Composition.section': allergySection,
        }] as any;
      }
      return [] as any;
    });

    const response = await manager.process(createJob({
      sector: 'animal-care',
      section: 'individual',
      format: 'org.hl7.fhir.r4',
      resourceType: 'Subject',
      action: '$summary',
      content: {
        ...(createJob().content as any),
        meta: {
          bearer: {
            jwt: {
              payload: {
                scope: `organization/Composition.rs?subject=${encodeURIComponent(subjectDid)}&section=${problemSection},${medicationSection}`,
              },
            },
          },
        },
        body: {
          resourceType: ResourceTypesFhirR4.Parameters,
          parameter: [{ name: 'subject', valueString: subjectDid }],
        },
      } as any,
    }));

    const summary = (response.body as any).data[0].resource;
    const composition = summary.entry.find((entry: any) => entry.resource?.resourceType === ResourceTypesFhirR4.Composition)?.resource;
    const returnedSections = composition.section.map((section: any) => section.code.coding[0].code);
    const returnedResourceTypes = summary.entry.map((entry: any) => entry.resource?.resourceType);

    expect(returnedSections).toEqual([
      problemSection.split('|')[1],
      medicationSection.split('|')[1],
    ]);
    expect(returnedResourceTypes).toContain(ResourceTypesFhirR4.Condition);
    expect(returnedResourceTypes).toContain(ResourceTypesFhirR4.MedicationStatement);
    expect(returnedResourceTypes).not.toContain(ResourceTypesFhirR4.AllergyIntolerance);
  });

  it('rejects a digital-twin working selection whose author differs from the authenticated employee', async () => {
    const entry = structuredClone((createJob().content as any).body.entry[0]);
    entry.resource.meta.claims['Composition.author'] = `${OPERATIONAL_EMPLOYEE_DID}:another`;
    const response = await manager.process(createJob({
      content: {
        ...(createJob().content as any),
        meta: { bearer: { jwt: { payload: { sub: OPERATIONAL_EMPLOYEE_DID } } } },
        body: { resourceType: 'Bundle', type: 'batch', entry: [entry] },
      } as any,
    }));

    const data = (response.body as any).data;
    expect(data[0].response.status).toBe('400');
    expect(JSON.stringify(data[0])).toContain('author must match the authenticated employee');
    expect(mockVaultRepository.put).not.toHaveBeenCalled();
  });

  it('rejects a direct canonical digital-twin Composition write', async () => {
    const entry = structuredClone((createJob().content as any).body.entry[0]);
    delete entry.resource.meta.claims['@type'];
    const response = await manager.process(createJob({
      content: {
        ...(createJob().content as any),
        body: { resourceType: 'Bundle', type: 'batch', entry: [entry] },
      } as any,
    }));

    const data = (response.body as any).data;
    expect(data[0].response.status).toBe('400');
    expect(JSON.stringify(data[0])).toContain('ResearcherWorkingSelection');
    expect(mockVaultRepository.put).not.toHaveBeenCalled();
  });

  it('preserves an externally authored IPS and rejects a local controller overwrite', async () => {
    const entry = structuredClone((createJob().content as any).body.entry[0]);
    delete entry.resource.meta.claims['@type'];
    entry.resource.meta.claims['Composition.identifier'] = EXAMPLE_IPS_COMPOSITION_IDENTIFIER;
    entry.resource.meta.claims['Composition.author'] = EXAMPLE_INTER_TENANT_ACCESS_CONTRACT_PROVIDER_ORGANIZATION_URN;
    entry.resource = {
      resourceType: 'Composition',
      id: EXAMPLE_IPS_COMPOSITION_IDENTIFIER.split(':').at(-1),
      meta: { claims: entry.resource.meta.claims },
    };
    const importJob = createJob({
      section: 'individual',
      content: {
        ...(createJob().content as any),
        meta: { bearer: { jwt: { payload: { sub: OPERATIONAL_EMPLOYEE_DID } } } },
        body: { resourceType: 'Bundle', type: 'batch', entry: [entry] },
      } as any,
    });

    mockVaultRepository.get.mockResolvedValueOnce(undefined as any);
    const imported = await manager.process(structuredClone(importJob));
    expect((imported.body as any).data[0].response.status).toBe('201');
    const storedRecord = (mockVaultRepository.put as any).mock.calls[0][1][0];
    expect(storedRecord['Composition.author']).toBe(
      EXAMPLE_INTER_TENANT_ACCESS_CONTRACT_PROVIDER_ORGANIZATION_URN,
    );

    mockVaultRepository.get.mockResolvedValueOnce(storedRecord as any);
    const localOverwrite = await manager.process(structuredClone(importJob));
    expect((localOverwrite.body as any).data[0].response.status).toBe('403');
    expect(JSON.stringify((localOverwrite.body as any).data[0])).toContain(
      'externally authored IPS',
    );
    expect(mockVaultRepository.put).toHaveBeenCalledTimes(1);
  });

  it('purges only the private individual-to-twin link during index-provider offboarding', async () => {
    const sourceSubject = 'did:web:patient.example.org:individual:real-subject';
    const response = await manager.process(createJob({
      section: 'individual',
      resourceType: 'ResearchSubject',
      action: '_purge',
      content: {
        ...(createJob().content as any),
        body: {
          resourceType: 'Parameters',
          parameter: [{ name: 'subject', valueString: sourceSubject }],
        },
      } as any,
    }));

    expect((response.body as any).resourceType).toBe('Parameters');
    expect((response.body as any).parameter).toEqual([{ name: 'purged', valueBoolean: true }]);
    expect(mockVaultRepository.delete).toHaveBeenCalledTimes(1);
    expect(mockVaultRepository.put).toHaveBeenCalledTimes(1);
  });

  it('rejects a working selection whose subject is an operational DID', async () => {
    const entry = structuredClone((createJob().content as any).body.entry[0]);
    entry.resource.meta.claims['Composition.subject'] = 'did:web:patient.example.org:individual:real-subject';
    const response = await manager.process(createJob({
      content: {
        ...(createJob().content as any),
        body: { resourceType: 'Bundle', type: 'batch', entry: [entry] },
      } as any,
    }));

    const data = (response.body as any).data;
    expect(data[0].response.status).toBe('400');
    expect(JSON.stringify(data[0])).toContain('valid urn:uuid');
    expect(mockVaultRepository.put).not.toHaveBeenCalled();
  });

  it('rejects an invented UUID URN that is absent from the private alias registry', async () => {
    mockVaultRepository.getContainersInSection.mockResolvedValue([] as any);
    const entry = structuredClone((createJob().content as any).body.entry[0]);
    entry.resource.meta.claims['Composition.subject'] = 'urn:uuid:00000000-0000-4000-8000-000000000999';
    const response = await manager.process(createJob({
      content: {
        ...(createJob().content as any),
        body: { resourceType: 'Bundle', type: 'batch', entry: [entry] },
      } as any,
    }));

    const data = (response.body as any).data;
    expect(data[0].response.status).toBe('400');
    expect(JSON.stringify(data[0])).toContain('not registered for this tenant');
    expect(mockVaultRepository.put).not.toHaveBeenCalled();
  });

  it('ignores OperationOutcome entries from preconversion payload', async () => {
    const job = createJob({
      content: {
        ...(createJob().content as any),
        body: {
          resourceType: 'Bundle',
          type: 'batch',
          data: [
            {
              resource: {
                resourceType: 'OperationOutcome',
                issue: [
                  {
                    severity: 'warning',
                    code: 'processing',
                    diagnostics: 'Missing required LOINC mapping for section:family',
                  },
                ],
              },
            },
          ],
        } as any,
      } as any,
    });

    const response = await manager.process(job);
    const data = (response.body as any).data;
    expect(data).toHaveLength(1);
    expect(data[0].type).toBe('OperationOutcome');
    expect(data[0].response.status).toBe('200');
    expect(mockVaultRepository.put).not.toHaveBeenCalled();
  });

  it('supports _search with FHIR Bundle entry.request.url format', async () => {
    mockVaultRepository.listContainersInSection.mockResolvedValue([{ id: 'comp-1' }] as any);
    const job = createJob({
      action: '_search',
      section: 'individual',
      content: {
        ...(createJob().content as any),
        body: COMPOSITION_SEARCH_BUNDLE_EXAMPLE as any,
      } as any,
    });

    const response = await manager.process(job);
    const data = (response.body as any).data;
    const resources = extractBundleSearchResources(response.body) as any[];
    expect(data[0].type).toBe('Composition-search-response-v1.0');
    expect(resources).toHaveLength(1);
  });

  it('supports _search with FHIR Parameters format', async () => {
    mockVaultRepository.listContainersInSection.mockResolvedValue([{ id: 'comp-1' }, { id: 'comp-2' }] as any);
    const job = createJob({
      action: '_search',
      section: 'individual',
      content: {
        ...(createJob().content as any),
        body: COMPOSITION_SEARCH_PARAMETERS_EXAMPLE as any,
      } as any,
    });

    const response = await manager.process(job);
    const data = (response.body as any).data;
    const resources = extractBundleSearchResources(response.body);
    expect(data[0].type).toBe('Composition-search-response-v1.0');
    expect(resources).toHaveLength(2);
  });

  it('supports _search with POST wrapper entries carrying FHIR Parameters', async () => {
    mockVaultRepository.listContainersInSection.mockResolvedValue([{ id: 'comp-1' }] as any);
    const job = createJob({
      action: '_search',
      section: 'individual',
      content: {
        ...(createJob().content as any),
        body: {
          resourceType: 'Bundle',
          type: 'batch',
          entry: [
            {
              request: {
                method: 'POST',
                url: 'Bundle/_search',
              },
              resource: {
                resourceType: 'Parameters',
                parameter: [
                  ...COMPOSITION_SEARCH_PARAMETERS_EXAMPLE.parameter,
                ],
              },
            },
          ],
        },
      } as any,
    });

    const response = await manager.process(job);
    const data = (response.body as any).data;
    const resources = extractBundleSearchResources(response.body);
    expect(data[0].type).toBe('Composition-search-response-v1.0');
    expect(resources).toHaveLength(1);
  });

  it('supports Subject/$summary with FHIR Parameters format in supported sectors', async () => {
    const subjectDid = 'did:web:api.acme.org:individual:summary-subject-001';
    mockVaultRepository.getContainersInSection.mockImplementation(async (_vaultId: string, sectionId: string) => {
      if (sectionId === getSubjectScopedSectionId(subjectDid, 'individual', 'composition')) {
        return [
          {
            id: 'composition-summary-001',
            'Composition.identifier': 'composition-summary-001',
            'Composition.subject': subjectDid,
            'Composition.section': HealthcareBasicSections.HistoryOfMedicationUse.attributeValue,
            'Composition.date': '2026-06-01T10:00:00Z',
            'Composition.author': 'did:web:provider.example.org',
            'Composition.type': HealthcareBasicSections.PatientSummaryDocument.attributeValue,
          },
        ] as any;
      }
      return [] as any;
    });

    const job = createJob({
      sector: 'health-care',
      section: 'individual',
      format: 'org.hl7.fhir.r4',
      resourceType: 'Subject',
      action: '$summary',
      content: {
        ...(createJob().content as any),
        body: {
          resourceType: 'Parameters',
          parameter: [
            { name: 'subject', valueString: subjectDid },
          ],
        } as any,
      } as any,
    });

    const response = await manager.process(job);
    const data = (response.body as any).data;
    expect(data[0].type).toBe('Bundle-summary-response-v1.0');
    expect(data[0].resource.resourceType).toBe('Bundle');
    expect(data[0].resource.type).toBe('document');
  });

  it('rejects digitaltwin materialization for an operational subject DID', async () => {
    const operationalSubjectDid = 'did:web:api.acme.org:individual:summary-subject-001';
    const job = createJob({
      sector: 'health-care',
      section: 'digitaltwin',
      format: 'org.hl7.fhir.r4',
      resourceType: 'ResearchSubject',
      action: '$summary',
      content: {
        ...(createJob().content as any),
        body: {
          resourceType: 'Parameters',
          parameter: [{ name: 'subject', valueString: operationalSubjectDid }],
        },
      } as any,
    });

    await expect(manager.process(job)).rejects.toThrow('tenant-registered urn:uuid');
  });

  it('supports digitaltwin ResearchSubject/$summary with org.hl7.fhir.r4 materialization', async () => {
    const subjectDid = REGISTERED_TWIN_SUBJECT;
    mockVaultRepository.listContainersInSection.mockImplementation(async (_vaultId: string, sectionId: string) => {
      if (sectionId === getSubjectScopedSectionId(subjectDid, 'digitaltwin', DataCollectionIds.composition)) {
        return [
          {
            id: 'composition-twin-summary-001',
            'Composition.identifier': 'urn:uuid:composition-twin-summary-001',
            'Composition.subject': subjectDid,
            'Composition.section': HealthcareBasicSections.HistoryOfMedicationUse.attributeValue,
            'Composition.date': '2026-06-01T10:00:00Z',
            'Composition.author': 'did:web:provider.example.org',
            'Composition.type': HealthcareBasicSections.PatientSummaryDocument.attributeValue,
          },
        ] as any;
      }
      if (sectionId === getSubjectScopedSectionId(subjectDid, 'digitaltwin', DataCollectionIds.medications)) {
        return [
          {
            id: 'medication-twin-summary-001',
            'MedicationStatement.identifier': 'urn:uuid:medication-twin-summary-001',
            'MedicationStatement.subject': subjectDid,
            'MedicationStatement.status': 'active',
            'MedicationStatement.medication-text': 'Lisinopril 10 mg',
            'MedicationStatement.code-display': 'Lisinopril 10 MG Oral Tablet',
            'MedicationStatement.code-text': 'Lisinopril 10 mg',
          },
        ] as any;
      }
      return [] as any;
    });

    const job = createJob({
      sector: 'health-care',
      section: 'digitaltwin',
      format: 'org.hl7.fhir.r4',
      resourceType: 'ResearchSubject',
      action: '$summary',
      content: {
        ...(createJob().content as any),
        body: {
          resourceType: 'Parameters',
          parameter: [
            { name: 'subject', valueString: subjectDid },
          ],
        } as any,
      } as any,
    });

    const response = await manager.process(job);
    const data = (response.body as any).data;
    expect(data[0].type).toBe('Bundle-summary-response-v1.0');
    expect(data[0].resource.resourceType).toBe('Bundle');
    expect(data[0].resource.type).toBe('document');
    expect(data[0].resource.entry[0].fullUrl).toMatch(/^urn:uuid:/);
    expect(data[0].resource.entry[0].resource.resourceType).toBe('Composition');
    expect(data[0].resource.entry.some((entry: any) => entry.resource?.resourceType === 'MedicationStatement')).toBe(true);
  });

  it('returns one current native Immunization per business identifier in $summary', async () => {
    const subjectDid = 'did:web:api.acme.org:individual:immunization-summary-001';
    mockVaultRepository.listContainersInSection.mockImplementation(async (_vaultId: string, sectionId: string) => {
      if (sectionId === getSubjectScopedSectionId(subjectDid, 'individual', DataCollectionIds.composition)) {
        return [{
          id: 'composition-immunization-summary-001',
          'Composition.identifier': 'urn:uuid:composition-immunization-summary-001',
          'Composition.subject': subjectDid,
          'Composition.section': HealthcareBasicSections.Immunizations.attributeValue,
          'Composition.type': HealthcareBasicSections.PatientSummaryDocument.attributeValue,
        }] as any;
      }
      if (sectionId === getSubjectScopedSectionId(subjectDid, 'individual', DataCollectionIds.immunizations)) {
        return [
          {
            id: 'old-storage-version',
            'Immunization.identifier': 'urn:uuid:covid-dose-2',
            'Immunization.subject': subjectDid,
            'Immunization.status': 'completed',
            'Immunization.date': '2026-01-01T10:00:00Z',
            'Immunization.vaccine-code': 'http://hl7.org/fhir/sid/cvx|208',
            'Immunization.lot-number': 'OLD-LOT',
          },
          {
            id: 'current-storage-version',
            'Immunization.identifier': 'urn:uuid:covid-dose-2',
            'Immunization.subject': subjectDid,
            'Immunization.status': 'completed',
            'Immunization.date': '2026-01-01T10:00:00Z',
            'Immunization.vaccine-code': 'http://hl7.org/fhir/sid/cvx|208',
            'Immunization.lot-number': 'CURRENT-LOT',
          },
        ] as any;
      }
      return [] as any;
    });

    const response = await manager.process(createJob({
      sector: 'health-care',
      section: 'individual',
      format: 'org.hl7.fhir.r4',
      resourceType: 'Subject',
      action: '$summary',
      content: {
        ...(createJob().content as any),
        body: {
          resourceType: 'Parameters',
          parameter: [{ name: 'subject', valueString: subjectDid }],
        },
      } as any,
    }));

    const bundle = (response.body as any).data[0].resource;
    const immunizations = bundle.entry.filter((entry: any) => entry.resource?.resourceType === 'Immunization');
    expect(immunizations).toHaveLength(1);
    expect(immunizations[0].resource).toMatchObject({
      identifier: [{ value: 'urn:uuid:covid-dose-2' }],
      status: 'completed',
      occurrenceDateTime: '2026-01-01T10:00:00Z',
      lotNumber: 'CURRENT-LOT',
    });
  });

  it('exports a role-bound professional with its organization as author and PractitionerRole as attester', async () => {
    const subjectDid = REGISTERED_TWIN_SUBJECT;
    const practitionerIdentifier = `urn:uuid:${EXAMPLE_KYC_CONTROLLER_USER_UUID}`;
    const practitionerRoleIdentifier = `urn:uuid:${EXAMPLE_KYC_CONTROLLER_UUID}`;
    mockVaultRepository.listContainersInSection.mockImplementation(async (_vaultId: string, sectionId: string) => {
      if (sectionId === getSubjectScopedSectionId(subjectDid, 'individual', DataCollectionIds.composition)) {
        return [{
          id: 'composition-role-author-summary-001',
          'Composition.identifier': 'urn:uuid:composition-role-author-summary-001',
          'Composition.subject': subjectDid,
          'Composition.section': HealthcareBasicSections.HistoryOfMedicationUse.attributeValue,
          'Composition.type': HealthcareBasicSections.PatientSummaryDocument.attributeValue,
          'Composition.author': EXAMPLE_TENANT_SERVICE_DID,
        }] as any;
      }
      if (sectionId === getSubjectScopedSectionId(subjectDid, 'individual', DataCollectionIds.medications)) {
        return [{
          id: 'medication-section-provenance-001',
          'MedicationStatement.identifier': 'urn:uuid:medication-section-provenance-001',
          'MedicationStatement.subject': subjectDid,
          'MedicationStatement.status': 'active',
          'MedicationStatement.medication-text': 'Section-authored medication',
          'Composition.section': HealthcareBasicSections.HistoryOfMedicationUse.attributeValue,
          'Composition.author': EXAMPLE_TENANT_SERVICE_DID,
          'Composition.attester': practitionerRoleIdentifier,
          'Composition.attester-mode': CompositionAttesterModes.Professional,
        }] as any;
      }
      if (sectionId === getClinicalCreatorBindingsSectionId()) {
        return [{
          id: practitionerRoleIdentifier,
          kind: FhirIpsCreatorKinds.Professional,
          actorIdentifier: practitionerIdentifier,
          authorIdentifier: practitionerRoleIdentifier,
          ownerIdentifier: EXAMPLE_TENANT_SERVICE_DID,
          role: EXAMPLE_HEALTHCARE_ACTOR_ROLE_PHYSICIAN,
          actorDids: [EXAMPLE_PROFESSIONAL_DID],
        }] as any;
      }
      return [] as any;
    });

    const response = await manager.process(createJob({
      sector: 'health-care',
      section: 'individual',
      format: 'org.hl7.fhir.r4',
      resourceType: 'Subject',
      action: '$summary',
      content: {
        ...(createJob().content as any),
        body: {
          resourceType: ResourceTypesFhirR4.Parameters,
          parameter: [{ name: 'subject', valueString: subjectDid }],
        },
      } as any,
    }));

    const bundle = (response.body as any).data[0].resource;
    expect(bundle.entry[0].resource.author).toEqual([{ reference: EXAMPLE_TENANT_SERVICE_DID }]);
    expect(bundle.entry[0].resource.attester).toEqual([{
      mode: CompositionAttesterModes.Professional,
      party: { reference: practitionerRoleIdentifier },
    }]);
    expect(bundle.entry).toEqual(expect.arrayContaining([
      expect.objectContaining({
        fullUrl: practitionerIdentifier,
        resource: expect.objectContaining({ resourceType: ResourceTypesFhirR4.Practitioner }),
      }),
      expect.objectContaining({
        fullUrl: practitionerRoleIdentifier,
        resource: expect.objectContaining({
          resourceType: ResourceTypesFhirR4.PractitionerRole,
          practitioner: { reference: practitionerIdentifier },
          organization: { reference: EXAMPLE_TENANT_SERVICE_DID },
        }),
      }),
    ]));
  });

  it('supports digitaltwin ResearchSubject/$summary with org.hl7.fhir.api claims-first materialization', async () => {
    const subjectDid = REGISTERED_TWIN_SUBJECT;
    mockVaultRepository.listContainersInSection.mockImplementation(async (_vaultId: string, sectionId: string) => {
      if (sectionId === getSubjectScopedSectionId(subjectDid, 'digitaltwin', DataCollectionIds.composition)) {
        return [
          {
            id: 'composition-twin-summary-api-001',
            '@context': 'org.hl7.fhir.r4',
            'org.hl7.fhir.r4.Composition.identifier': 'urn:uuid:composition-twin-summary-api-001',
            'org.hl7.fhir.r4.Composition.subject': subjectDid,
            'org.hl7.fhir.r4.Composition.section': HealthcareBasicSections.VitalSigns.attributeValue,
            'org.hl7.fhir.r4.Composition.date': '2026-06-01T10:00:00Z',
            'org.hl7.fhir.r4.Composition.author': 'did:web:provider.example.org',
            'org.hl7.fhir.r4.Composition.attester': 'urn:uuid:attester-one,urn:uuid:attester-two',
            'org.hl7.fhir.r4.Composition.attester-mode': 'professional,legal',
            'org.hl7.fhir.r4.Composition.attester-time': '2026-06-01T10:01:00Z,2026-06-01T10:02:00Z',
            'org.hl7.fhir.r4.Composition.type': HealthcareBasicSections.PatientSummaryDocument.attributeValue,
          },
        ] as any;
      }
      if (sectionId === getSubjectScopedSectionId(subjectDid, 'digitaltwin', DataCollectionIds.observations)) {
        return [
          {
            id: 'observation-twin-summary-api-001',
            '@context': 'org.hl7.fhir.r4',
            'org.hl7.fhir.r4.Observation.identifier': 'urn:uuid:observation-twin-summary-api-001',
            'org.hl7.fhir.r4.Observation.subject': subjectDid,
            'org.hl7.fhir.r4.Observation.status': 'final',
            'org.hl7.fhir.r4.Observation.code-text': 'Blood pressure systolic',
            'org.hl7.fhir.r4.Observation.code-display': 'Blood pressure',
          },
        ] as any;
      }
      return [] as any;
    });

    const job = createJob({
      sector: 'health-care',
      section: 'digitaltwin',
      format: 'org.hl7.fhir.api',
      resourceType: 'ResearchSubject',
      action: '$summary',
      content: {
        ...(createJob().content as any),
        body: {
          resourceType: 'Parameters',
          parameter: [
            { name: 'subject', valueString: subjectDid },
          ],
        } as any,
      } as any,
    });

    const response = await manager.process(job);
    const data = (response.body as any).data;
    const bundle = data[0].resource;
    expect(data[0].type).toBe('Bundle-summary-response-v1.0');
    expect(bundle.resourceType).toBe('Bundle');
    expect(bundle.type).toBe('document');
    expect(bundle.entry[0].fullUrl).toMatch(/^urn:uuid:/);
    expect(bundle.entry[0].resource).toEqual(expect.objectContaining({
      resourceType: 'Composition',
      id: expect.any(String),
      meta: {
        claims: expect.objectContaining({
          'Composition.subject': subjectDid,
          'Composition.attester': 'urn:uuid:attester-one,urn:uuid:attester-two',
          'Composition.attester-mode': 'professional,legal',
          'Composition.attester-time': '2026-06-01T10:01:00Z,2026-06-01T10:02:00Z',
        }),
      },
      attester: [
        {
          mode: 'professional',
          party: { reference: 'urn:uuid:attester-one' },
          time: '2026-06-01T10:01:00Z',
        },
        {
          mode: 'legal',
          party: { reference: 'urn:uuid:attester-two' },
          time: '2026-06-01T10:02:00Z',
        },
      ],
    }));
    const nonCompositionEntry = bundle.entry.find((entry: any) => entry.resource?.resourceType === 'Observation');
    expect(nonCompositionEntry.resource).toEqual({
      resourceType: 'Observation',
      id: 'observation-twin-summary-api-001',
      meta: {
        claims: expect.objectContaining({
          'Observation.subject': subjectDid,
        }),
      },
    });
  });

  it('declares the searchable digital twin IPS section to resource map', () => {
    expect(TWIN_COMPOSITION_SECTION_RESOURCE_CONFIG[HealthcareBasicSections.HistoryOfMedicationUse.attributeValue]).toEqual([
      { collectionIds: [DataCollectionIds.medications], resourceType: 'MedicationStatement' },
    ]);
    expect(TWIN_COMPOSITION_SECTION_RESOURCE_CONFIG[HealthcareBasicSections.VitalSigns.attributeValue]).toEqual([
      { collectionIds: [DataCollectionIds.observations], resourceType: 'Observation' },
    ]);
    expect(TWIN_COMPOSITION_SECTION_RESOURCE_CONFIG[HealthcareBasicSections.AdvanceDirectives.attributeValue]).toEqual([
      { collectionIds: [DataCollectionIds.consents], resourceType: 'Consent' },
    ]);
    expect(TWIN_COMPOSITION_SECTION_RESOURCE_CONFIG[HealthcareSummarySections.PregnancyHistory.attributeValue]).toEqual([
      { collectionIds: [DataCollectionIds.observations], resourceType: 'Observation' },
    ]);
  });

  it('searches text across several sections and resource types inside an inclusive date range', async () => {
    const subjectDid = REGISTERED_TWIN_SUBJECT;
    const medicationSection = HealthcareBasicSections.HistoryOfMedicationUse.attributeValue;
    const resultSection = HealthcareBasicSections.Results.attributeValue;
    const medicationSectionId = getSubjectScopedSectionId(subjectDid, 'digitaltwin', 'medications');
    const observationSectionId = getSubjectScopedSectionId(subjectDid, 'digitaltwin', 'observations');
    const compositionSectionId = getSubjectScopedSectionId(subjectDid, 'digitaltwin', 'composition');
    mockVaultRepository.getAllSections.mockResolvedValue([
      medicationSectionId,
      observationSectionId,
      compositionSectionId,
    ] as any);
    mockVaultRepository.listContainersInSection.mockImplementation(async (_vaultId: string, sectionId: string) => {
      if (sectionId === medicationSectionId) return [{
        id: 'medication-search-document',
        'MedicationStatement.subject': subjectDid,
        '__digitalTwinSearch.text': 'Tratamiento antiinflamatorio\u001fIbuprofen',
        '__digitalTwinSearch.date': '2026-04-10T12:00:00.000Z',
      }] as any;
      if (sectionId === observationSectionId) return [{
        id: 'observation-outside-range',
        'Observation.subject': subjectDid,
        '__digitalTwinSearch.text': 'Ibuprofen plasma level',
        '__digitalTwinSearch.date': '2024-04-10T12:00:00.000Z',
      }] as any;
      if (sectionId === compositionSectionId) return [{
        id: 'composition-basic-search',
        'Composition.subject': subjectDid,
        'Composition.section': `${medicationSection},${resultSection}`,
      }] as any;
      return [] as any;
    });

    const response = await new TwinCompositionManager(mockVaultRepository).process(createJob({
      action: '_search',
      resourceType: 'ResearchSubject',
      content: {
        ...(createJob().content as any),
        body: {
          resourceType: 'Parameters',
          parameter: [
            { name: 'section', valueString: medicationSection },
            { name: 'section', valueString: resultSection },
            { name: 'date-from', valueDate: '2026-01-01' },
            { name: 'text', valueString: 'IBUPROFEN' },
          ],
        },
      } as any,
    }));

    const result = extractBundleSearchResources(response.body) as any[];
    expect((response.body as any).data[0].type).toBe('ResearchSubject-search-response-v1.0');
    expect(result).toHaveLength(1);
    expect(result).toEqual([expect.objectContaining({
      resourceType: 'ResearchSubject',
      meta: expect.objectContaining({ claims: expect.objectContaining({
        '@context': 'org.hl7.fhir.api',
        'ResearchSubject.identifier': subjectDid,
        'Composition.subject': subjectDid,
        id: 'composition-basic-search',
      }) }),
    })]);
    expect(result[0]).not.toHaveProperty('composition');
    expect(JSON.stringify(result)).not.toContain('__digitalTwinSearch');
  });

  it('searches an anonymous projection by its retained canonical code when the derived text index is absent', async () => {
    const subjectDid = REGISTERED_TWIN_SUBJECT;
    const resultSection = HealthcareBasicSections.Results.attributeValue;
    const observationSectionId = getSubjectScopedSectionId(subjectDid, 'digitaltwin', 'observations');
    const compositionSectionId = getSubjectScopedSectionId(subjectDid, 'digitaltwin', 'composition');
    mockVaultRepository.getAllSections.mockResolvedValue([observationSectionId, compositionSectionId] as any);
    mockVaultRepository.listContainersInSection.mockImplementation(async (_vaultId: string, sectionId: string) => {
      if (sectionId === observationSectionId) return [{
        id: 'anonymous-observation-without-derived-text',
        'Observation.subject': subjectDid,
        'Observation.code': 'http://loinc.org|8310-5',
        'Observation.code-display': 'Body temperature:Temp:Pt:^Patient:Qn',
        '__digitalTwinSearch.date': '2026-09-11',
      }] as any;
      if (sectionId === compositionSectionId) return [{
        id: 'composition-existing-projection',
        'Composition.subject': subjectDid,
        'Composition.section': resultSection,
      }] as any;
      return [] as any;
    });

    const response = await new TwinCompositionManager(mockVaultRepository).process(createJob({
      action: '_search',
      resourceType: 'ResearchSubject',
      content: {
        ...(createJob().content as any),
        body: {
          resourceType: 'Parameters',
          parameter: [
            { name: 'section', valueString: resultSection },
            { name: 'date-from', valueDate: '2026-01-01' },
            { name: 'text', valueString: '8310-5' },
          ],
        },
      } as any,
    }));

    expect(extractBundleSearchResources(response.body)).toHaveLength(1);
  });

  it('returns a matching ResearchSubject when a consented leaf projection exists before a Composition is persisted', async () => {
    const subjectDid = REGISTERED_TWIN_SUBJECT;
    const resultSection = HealthcareBasicSections.Results.attributeValue;
    const observationSectionId = getSubjectScopedSectionId(subjectDid, 'digitaltwin', DataCollectionIds.observations);
    mockVaultRepository.getAllSections.mockResolvedValue([observationSectionId] as any);
    mockVaultRepository.listContainersInSection.mockImplementation(async (_vaultId: string, sectionId: string) => {
      if (sectionId === observationSectionId) return [{
        id: 'observation-created-after-consent',
        'Observation.subject': subjectDid,
        'Observation.code': 'http://loinc.org|8310-5',
        '__digitalTwinSearch.text': 'http://loinc.org|8310-5',
        '__digitalTwinSearch.date': '2026-06-11T08:30:00Z',
      }] as any;
      return [] as any;
    });

    const response = await new TwinCompositionManager(mockVaultRepository).process(createJob({
      action: '_search',
      resourceType: 'ResearchSubject',
      content: {
        ...(createJob().content as any),
        body: {
          resourceType: 'Parameters',
          parameter: [
            { name: 'section', valueString: resultSection },
            { name: 'date-from', valueDate: '2026-01-01' },
            { name: 'text', valueString: '8310-5' },
          ],
        },
      } as any,
    }));

    const resources = extractBundleSearchResources(response.body) as any[];
    expect(resources).toHaveLength(1);
    expect(resources[0]?.meta?.claims).toEqual(expect.objectContaining({
      'ResearchSubject.identifier': subjectDid,
      'Composition.subject': subjectDid,
      'Composition.section': resultSection,
    }));
  });

  it('rejects a basic search whose end date precedes its start date', async () => {
    await expect(manager.process(createJob({
      action: '_search',
      content: {
        ...(createJob().content as any),
        body: {
          resourceType: 'Parameters',
          parameter: [
            { name: 'section', valueString: HealthcareBasicSections.Results.attributeValue },
            { name: 'date-from', valueDate: '2026-08-20' },
            { name: 'date-to', valueDate: '2026-08-01' },
            { name: 'text', valueString: 'pressure' },
          ],
        },
      } as any,
    }))).rejects.toThrow('date-to must be on or after date-from');
  });

  const searchableSectionFixtures = [
    {
      title: 'History of Medication Use / MedicationStatement',
      subjectDid: 'did:web:api.acme.org:research-subject:med-001',
      sectionToken: HealthcareBasicSections.HistoryOfMedicationUse.attributeValue,
      resourceType: 'MedicationStatement',
      sectionIdSuffix: 'medications',
      displayClaimKey: 'MedicationStatement.code-display',
      displayValue: 'Paracetamol 500 MG Oral Tablet',
      displaySearchValue: 'oral tablet',
      textClaimKey: 'MedicationStatement.code-text',
      textValue: 'Paracetamol oral treatment',
      textSearchValue: 'treatment',
      expectedCompositionId: 'comp-med-1',
    },
    {
      title: 'Allergies and Intolerances / AllergyIntolerance',
      subjectDid: 'did:web:api.acme.org:research-subject:alg-001',
      sectionToken: HealthcareBasicSections.AllergiesAndIntolerances.attributeValue,
      resourceType: 'AllergyIntolerance',
      sectionIdSuffix: 'allergies',
      displayClaimKey: 'AllergyIntolerance.code-display',
      displayValue: 'Penicillin allergy',
      displaySearchValue: 'penicillin',
      textClaimKey: 'AllergyIntolerance.code-text',
      textValue: 'Penicillin intolerance reaction',
      textSearchValue: 'reaction',
      expectedCompositionId: 'comp-alg-1',
    },
    {
      title: 'Problem List / Condition',
      subjectDid: 'did:web:api.acme.org:research-subject:cond-001',
      sectionToken: HealthcareBasicSections.ProblemList.attributeValue,
      resourceType: 'Condition',
      sectionIdSuffix: 'conditions',
      displayClaimKey: 'Condition.code-display',
      displayValue: 'Type 2 diabetes mellitus',
      displaySearchValue: 'diabetes',
      textClaimKey: 'Condition.code-text',
      textValue: 'Chronic endocrine condition',
      textSearchValue: 'endocrine',
      expectedCompositionId: 'comp-cond-1',
    },
    {
      title: 'Results / Observation',
      subjectDid: 'did:web:api.acme.org:research-subject:result-observation-001',
      sectionToken: HealthcareBasicSections.Results.attributeValue,
      resourceType: 'Observation',
      sectionIdSuffix: 'observations',
      displayClaimKey: 'Observation.code-display',
      displayValue: 'Hemoglobin [Mass/volume] in Blood',
      displaySearchValue: 'hemoglobin',
      textClaimKey: 'Observation.code-text',
      textValue: 'Blood lab observation',
      textSearchValue: 'lab',
      expectedCompositionId: 'comp-result-observation-1',
    },
    {
      title: 'Results / DiagnosticReport',
      subjectDid: 'did:web:api.acme.org:research-subject:result-report-001',
      sectionToken: HealthcareBasicSections.Results.attributeValue,
      resourceType: 'DiagnosticReport',
      sectionIdSuffix: 'diagnostic-reports',
      displayClaimKey: 'DiagnosticReport.code-display',
      displayValue: 'Chest radiology report',
      displaySearchValue: 'radiology',
      textClaimKey: 'DiagnosticReport.code-text',
      textValue: 'Thorax imaging diagnostic report',
      textSearchValue: 'imaging',
      expectedCompositionId: 'comp-result-report-1',
    },
    {
      title: 'Procedures / Procedure',
      subjectDid: 'did:web:api.acme.org:research-subject:proc-001',
      sectionToken: HealthcareBasicSections.Procedures.attributeValue,
      resourceType: 'Procedure',
      sectionIdSuffix: 'procedures',
      displayClaimKey: 'Procedure.code-display',
      displayValue: 'Appendectomy procedure',
      displaySearchValue: 'appendectomy',
      textClaimKey: 'Procedure.code-text',
      textValue: 'Appendix removal surgery',
      textSearchValue: 'removal',
      expectedCompositionId: 'comp-proc-1',
    },
    {
      title: 'Immunizations / Immunization',
      subjectDid: 'did:web:api.acme.org:research-subject:imm-001',
      sectionToken: HealthcareBasicSections.Immunizations.attributeValue,
      resourceType: 'Immunization',
      sectionIdSuffix: 'immunizations',
      displayClaimKey: 'Immunization.code-display',
      displayValue: 'COVID-19 vaccine',
      displaySearchValue: 'covid',
      textClaimKey: 'Immunization.code-text',
      textValue: 'SARS-CoV-2 immunization event',
      textSearchValue: 'immunization',
      expectedCompositionId: 'comp-imm-1',
    },
    {
      title: 'Functional Status / Condition',
      subjectDid: 'did:web:api.acme.org:research-subject:func-001',
      sectionToken: HealthcareBasicSections.FunctionalStatus.attributeValue,
      resourceType: 'Condition',
      sectionIdSuffix: 'conditions',
      displayClaimKey: 'Condition.code-display',
      displayValue: 'Reduced mobility',
      displaySearchValue: 'mobility',
      textClaimKey: 'Condition.code-text',
      textValue: 'Functional limitation in ambulation',
      textSearchValue: 'ambulation',
      expectedCompositionId: 'comp-func-1',
    },
    {
      title: 'Plan of Care / CarePlan',
      subjectDid: 'did:web:api.acme.org:research-subject:care-001',
      sectionToken: HealthcareBasicSections.PlanOfCare.attributeValue,
      resourceType: 'CarePlan',
      sectionIdSuffix: 'care-plans',
      displayClaimKey: 'CarePlan.code-display',
      displayValue: 'Home monitoring care plan',
      displaySearchValue: 'monitoring',
      textClaimKey: 'CarePlan.code-text',
      textValue: 'Daily home care plan',
      textSearchValue: 'daily',
      expectedCompositionId: 'comp-care-1',
    },
    {
      title: 'Plan of Treatment / CarePlan',
      subjectDid: 'did:web:api.acme.org:research-subject:treatment-001',
      sectionToken: HealthcareBasicSections.PlanOfTreatment.attributeValue,
      resourceType: 'CarePlan',
      sectionIdSuffix: 'care-plans',
      displayClaimKey: 'CarePlan.code-display',
      displayValue: 'Treatment follow-up plan',
      displaySearchValue: 'follow-up',
      textClaimKey: 'CarePlan.code-text',
      textValue: 'Longitudinal treatment plan',
      textSearchValue: 'longitudinal',
      expectedCompositionId: 'comp-treatment-1',
    },
    {
      title: 'Social History / Observation',
      subjectDid: 'did:web:api.acme.org:research-subject:social-001',
      sectionToken: HealthcareBasicSections.SocialHistory.attributeValue,
      resourceType: 'Observation',
      sectionIdSuffix: 'observations',
      displayClaimKey: 'Observation.code-display',
      displayValue: 'Tobacco smoking status',
      displaySearchValue: 'smoking',
      textClaimKey: 'Observation.code-text',
      textValue: 'Former smoker',
      textSearchValue: 'smoker',
      expectedCompositionId: 'comp-social-1',
    },
    {
      title: 'Vital Signs / Observation',
      subjectDid: 'did:web:api.acme.org:research-subject:vs-001',
      sectionToken: HealthcareBasicSections.VitalSigns.attributeValue,
      resourceType: 'Observation',
      sectionIdSuffix: 'observations',
      displayClaimKey: 'Observation.code-display',
      displayValue: 'Blood pressure panel',
      displaySearchValue: 'pressure',
      textClaimKey: 'Observation.code-text',
      textValue: 'Tension arterial',
      textSearchValue: 'tension',
      expectedCompositionId: 'comp-vs-1',
    },
    {
      title: 'Advance Directives / Consent',
      subjectDid: 'did:web:api.acme.org:research-subject:consent-001',
      sectionToken: HealthcareBasicSections.AdvanceDirectives.attributeValue,
      resourceType: 'Consent',
      sectionIdSuffix: 'consents',
      displayClaimKey: 'Consent.code-display',
      displayValue: 'Advance healthcare directive',
      displaySearchValue: 'directive',
      textClaimKey: 'Consent.code-text',
      textValue: 'Future care wishes',
      textSearchValue: 'wishes',
      expectedCompositionId: 'comp-consent-1',
    },
    {
      title: 'History of Past Illness / Condition',
      subjectDid: 'did:web:api.acme.org:research-subject:past-001',
      sectionToken: HealthcareBasicSections.HistoryOfPastIllness.attributeValue,
      resourceType: 'Condition',
      sectionIdSuffix: 'conditions',
      displayClaimKey: 'Condition.code-display',
      displayValue: 'Asthma',
      displaySearchValue: 'asthma',
      textClaimKey: 'Condition.code-text',
      textValue: 'Respiratory chronic illness',
      textSearchValue: 'respiratory',
      expectedCompositionId: 'comp-past-1',
    },
    {
      title: 'Pregnancy History / Observation',
      subjectDid: 'did:web:api.acme.org:research-subject:preg-001',
      sectionToken: HealthcareSummarySections.PregnancyHistory.attributeValue,
      resourceType: 'Observation',
      sectionIdSuffix: 'observations',
      displayClaimKey: 'Observation.code-display',
      displayValue: 'Pregnancy status',
      displaySearchValue: 'pregnancy',
      textClaimKey: 'Observation.code-text',
      textValue: 'Gravida and parity history',
      textSearchValue: 'gravida',
      expectedCompositionId: 'comp-preg-1',
    },
    {
      title: 'Goals and Preferences / Consent',
      subjectDid: 'did:web:api.acme.org:research-subject:goal-001',
      sectionToken: HealthcareSummarySections.GoalsAndPreferences.attributeValue,
      resourceType: 'Consent',
      sectionIdSuffix: 'consents',
      displayClaimKey: 'Consent.code-display',
      displayValue: 'Goals of care preferences',
      displaySearchValue: 'preferences',
      textClaimKey: 'Consent.code-text',
      textValue: 'Goals of care discussion',
      textSearchValue: 'goals',
      expectedCompositionId: 'comp-goal-1',
    },
  ] as const;

  const searchableSectionCases = searchableSectionFixtures.flatMap((fixture) => ([
    {
      title: `${fixture.title} / code-display`,
      subjectDid: fixture.subjectDid,
      sectionToken: fixture.sectionToken,
      resourceType: fixture.resourceType,
      sectionIdSuffix: fixture.sectionIdSuffix,
      storedClaims: { [fixture.displayClaimKey]: fixture.displayValue },
      searchParameterName: `${fixture.resourceType}.code-display`,
      searchValue: fixture.displaySearchValue,
      expectedCompositionId: fixture.expectedCompositionId,
    },
    {
      title: `${fixture.title} / code-text`,
      subjectDid: fixture.subjectDid,
      sectionToken: fixture.sectionToken,
      resourceType: fixture.resourceType,
      sectionIdSuffix: fixture.sectionIdSuffix,
      storedClaims: { [fixture.textClaimKey]: fixture.textValue },
      searchParameterName: `${fixture.resourceType}.code-text`,
      searchValue: fixture.textSearchValue,
      expectedCompositionId: fixture.expectedCompositionId,
    },
  ]));

  it.each(searchableSectionCases)(
    'supports digitaltwin Composition/_search for $title',
    async ({
      subjectDid,
      sectionToken,
      resourceType,
      sectionIdSuffix,
      storedClaims,
      searchParameterName,
      searchValue,
      expectedCompositionId,
    }) => {
      const resourceSectionId = getSubjectScopedSectionId(subjectDid, 'digitaltwin', sectionIdSuffix);
      const compositionSectionId = getSubjectScopedSectionId(subjectDid, 'digitaltwin', 'composition');
      mockVaultRepository.getAllSections.mockResolvedValue([
        resourceSectionId,
        compositionSectionId,
      ] as any);
      mockVaultRepository.listContainersInSection.mockImplementation(async (_vaultId: string, sectionId: string) => {
        if (sectionId === resourceSectionId) {
          return [
            {
              id: `resource-${expectedCompositionId}`,
              [`${resourceType}.subject`]: subjectDid,
              ...storedClaims,
              indexed: { attributes: [] },
            },
          ] as any;
        }
        if (sectionId === compositionSectionId) {
          return [
            {
              id: expectedCompositionId,
              'Composition.subject': subjectDid,
              'Composition.section': sectionToken,
              'Composition.type': HealthcareBasicSections.PatientSummaryDocument.attributeValue,
            },
          ] as any;
        }
        return [] as any;
      });

      const job = createJob({
        action: '_search',
        content: {
          ...(createJob().content as any),
          body: {
            resourceType: 'Parameters',
            parameter: [
              { name: 'section', valueString: sectionToken },
              { name: searchParameterName, valueString: searchValue },
            ],
          } as any,
        } as any,
      });

      const response = await manager.process(job);
      const data = (response.body as any).data;
      const resources = extractBundleSearchResources(response.body) as any[];
      expect(data[0].type).toBe('Composition-search-response-v1.0');
      expect(resources).toHaveLength(1);
      expect(resources[0].id).toBe(expectedCompositionId);
    },
  );

  it('intersects multiple resource-family matches before returning ResearchSubjects', async () => {
    const sectionToken = HealthcareBasicSections.Results.attributeValue;
    const subjectA = 'urn:uuid:00000000-0000-4000-8000-000000000201';
    const subjectB = 'urn:uuid:00000000-0000-4000-8000-000000000202';
    const observationA = getSubjectScopedSectionId(subjectA, 'digitaltwin', 'observations');
    const reportA = getSubjectScopedSectionId(subjectA, 'digitaltwin', 'diagnostic-reports');
    const reportB = getSubjectScopedSectionId(subjectB, 'digitaltwin', 'diagnostic-reports');
    const compositionA = getSubjectScopedSectionId(subjectA, 'digitaltwin', 'composition');
    const compositionB = getSubjectScopedSectionId(subjectB, 'digitaltwin', 'composition');
    mockVaultRepository.getAllSections.mockResolvedValue([
      observationA, reportA, reportB, compositionA, compositionB,
    ] as any);
    mockVaultRepository.listContainersInSection.mockImplementation(async (_vaultId: string, sectionId: string) => {
      if (sectionId === observationA) return [{
        'Observation.subject': subjectA,
        'Observation.code-display': 'Blood pressure panel',
        'Observation.date': '2026-04-10T10:00:00Z',
      }] as any;
      if (sectionId === reportA) return [{
        'DiagnosticReport.subject': subjectA,
        'DiagnosticReport.code-display': 'Blood pressure report',
        'DiagnosticReport.date': '2026-04-11T10:00:00Z',
      }] as any;
      if (sectionId === reportB) return [{
        'DiagnosticReport.subject': subjectB,
        'DiagnosticReport.code-display': 'Blood pressure report',
        'DiagnosticReport.date': '2026-05-12T10:00:00Z',
      }] as any;
      if (sectionId === compositionA) return [{ id: 'comp-a', 'Composition.section': sectionToken }] as any;
      if (sectionId === compositionB) return [{ id: 'comp-b', 'Composition.section': sectionToken }] as any;
      return [] as any;
    });

    const response = await manager.process(createJob({
      action: '_search',
      content: {
        ...(createJob().content as any),
        body: {
          resourceType: 'Parameters',
          parameter: [
            { name: 'Composition.section', valueString: sectionToken },
            { name: 'Observation.code-display', valueString: 'blood pressure' },
            { name: 'Observation.date', valueString: 'ge2026-01-01' },
            { name: 'Observation.date', valueString: 'le2026-08-26' },
            { name: 'DiagnosticReport.code-display', valueString: 'blood pressure' },
            { name: 'DiagnosticReport.date', valueString: 'ge2026-01-01' },
            { name: 'DiagnosticReport.date', valueString: 'le2026-08-26' },
          ],
        } as any,
      } as any,
    }));

    const resources = extractBundleSearchResources(response.body) as any[];
    expect(resources).toHaveLength(1);
    expect(resources.map((entry: any) => entry.id)).toEqual(['comp-a']);
  });

  it('rejects local code-text in the canonical Composition.section search profile', async () => {
    await expect(manager.process(createJob({
      action: '_search',
      content: {
        ...(createJob().content as any),
        body: {
          resourceType: 'Parameters',
          parameter: [
            { name: 'Composition.section', valueString: HealthcareBasicSections.Results.attributeValue },
            { name: 'Observation.code-text', valueString: 'tension arterial' },
            { name: 'Observation.date', valueString: 'ge2026-01-01' },
          ],
        } as any,
      } as any,
    }))).rejects.toThrow('code-display');
  });

  it('supports digitaltwin Composition/_search by section plus MedicationStatement code-display and code-text together', async () => {
    const subjectDid = 'did:web:api.acme.org:research-subject:med-combo-001';
    const medicationSectionId = getSubjectScopedSectionId(subjectDid, 'digitaltwin', 'medications');
    const compositionSectionId = getSubjectScopedSectionId(subjectDid, 'digitaltwin', 'composition');
    mockVaultRepository.getAllSections.mockResolvedValue([
      medicationSectionId,
      compositionSectionId,
    ] as any);
    mockVaultRepository.listContainersInSection.mockImplementation(async (_vaultId: string, sectionId: string) => {
      if (sectionId === medicationSectionId) {
        return [
          {
            id: 'med-combo-1',
            'MedicationStatement.subject': subjectDid,
            'MedicationStatement.code-display': 'Paracetamol 500 MG Oral Tablet',
            'MedicationStatement.code-text': 'Paracetamol 500mg cada 8 horas',
            'MedicationStatement.medication-text': 'Paracetamol 500mg cada 8 horas',
            indexed: { attributes: [] },
          },
        ] as any;
      }
      if (sectionId === compositionSectionId) {
        return [
          {
            id: 'comp-med-combo-1',
            'Composition.subject': subjectDid,
            'Composition.section': HealthcareBasicSections.HistoryOfMedicationUse.attributeValue,
            'Composition.type': HealthcareBasicSections.PatientSummaryDocument.attributeValue,
          },
        ] as any;
      }
      return [] as any;
    });

    const response = await manager.process(createJob({
      action: '_search',
      content: {
        ...(createJob().content as any),
        body: {
          resourceType: 'Parameters',
          parameter: [
            { name: 'section', valueString: HealthcareBasicSections.HistoryOfMedicationUse.attributeValue },
            { name: 'MedicationStatement.code-display', valueString: 'paracetamol' },
            { name: 'MedicationStatement.code-text', valueString: 'paracetamol' },
          ],
        } as any,
      } as any,
    }));

    const resources = extractBundleSearchResources(response.body) as any[];
    expect(resources).toHaveLength(1);
    expect(resources[0].id).toBe('comp-med-combo-1');
  });

  it('supports digitaltwin Composition/_search by section plus Observation code-display and code-text together', async () => {
    const subjectDid = 'did:web:api.acme.org:research-subject:obs-combo-001';
    const observationSectionId = getSubjectScopedSectionId(subjectDid, 'digitaltwin', 'observations');
    const compositionSectionId = getSubjectScopedSectionId(subjectDid, 'digitaltwin', 'composition');
    mockVaultRepository.getAllSections.mockResolvedValue([
      observationSectionId,
      compositionSectionId,
    ] as any);
    mockVaultRepository.listContainersInSection.mockImplementation(async (_vaultId: string, sectionId: string) => {
      if (sectionId === observationSectionId) {
        return [
          {
            id: 'obs-combo-1',
            'Observation.subject': subjectDid,
            'Observation.code-display': 'Blood pressure panel with all children optional',
            'Observation.code-text': 'Blood pressure',
            indexed: { attributes: [] },
          },
        ] as any;
      }
      if (sectionId === compositionSectionId) {
        return [
          {
            id: 'comp-obs-combo-1',
            'Composition.subject': subjectDid,
            'Composition.section': HealthcareBasicSections.VitalSigns.attributeValue,
            'Composition.type': HealthcareBasicSections.PatientSummaryDocument.attributeValue,
          },
        ] as any;
      }
      return [] as any;
    });

    const response = await manager.process(createJob({
      action: '_search',
      content: {
        ...(createJob().content as any),
        body: {
          resourceType: 'Parameters',
          parameter: [
            { name: 'section', valueString: HealthcareBasicSections.VitalSigns.attributeValue },
            { name: 'Observation.code-display', valueString: 'pressure' },
            { name: 'Observation.code-text', valueString: 'pressure' },
          ],
        } as any,
      } as any,
    }));

    const resources = extractBundleSearchResources(response.body) as any[];
    expect(resources).toHaveLength(1);
    expect(resources[0].id).toBe('comp-obs-combo-1');
  });

  it('supports digitaltwin Composition/_search by section plus Composition.meta-tag for one researcher selection', async () => {
    const subjectDid = 'did:web:api.lab.org:research-subject:selection-tag-001';
    const compositionSectionId = getSubjectScopedSectionId(subjectDid, 'digitaltwin', 'composition');
    const selectionCompositionId = 'research-selection-01JZ4CV2G1X2M5Y8Y3V4W6Q7R8';
    const selectionTag = {
      id: 'Composition.meta.tag[0]',
      system: 'urn:research:tag:score',
      code: '10',
    };

    mockVaultRepository.getAllSections.mockResolvedValue([
      compositionSectionId,
    ] as any);
    mockVaultRepository.listContainersInSection.mockImplementation(async (_vaultId: string, sectionId: string) => {
      if (sectionId === compositionSectionId) {
        return [
          {
            id: selectionCompositionId,
            'Composition.identifier': selectionCompositionId,
            'Composition.subject': subjectDid,
            'Composition.section': HealthcareBasicSections.HistoryOfMedicationUse.attributeValue,
            'Composition.type': HealthcareBasicSections.PatientSummaryDocument.attributeValue,
            'Composition.author': OPERATIONAL_EMPLOYEE_DID,
            meta: { tag: [selectionTag] },
            tag: [selectionTag],
          },
          {
            id: `${selectionCompositionId}-another-employee`,
            'Composition.identifier': `${selectionCompositionId}-another-employee`,
            'Composition.subject': subjectDid,
            'Composition.section': HealthcareBasicSections.HistoryOfMedicationUse.attributeValue,
            'Composition.type': HealthcareBasicSections.PatientSummaryDocument.attributeValue,
            'Composition.author': `${OPERATIONAL_EMPLOYEE_DID}:another`,
            meta: { tag: [selectionTag] },
            tag: [selectionTag],
          },
        ] as any;
      }
      return [] as any;
    });

    const response = await manager.process(createJob({
      action: '_search',
      content: {
        ...(createJob().content as any),
        meta: { bearer: { jwt: { payload: { sub: OPERATIONAL_EMPLOYEE_DID } } } },
        body: {
          resourceType: 'Parameters',
          parameter: [
            { name: 'section', valueString: HealthcareBasicSections.HistoryOfMedicationUse.attributeValue },
            { name: 'Composition.meta-tag', valueCoding: { system: 'urn:research:tag:score', code: '10' } },
          ],
        } as any,
      } as any,
    }));

    const data = (response.body as any).data;
    const resources = extractBundleSearchResources(response.body) as any[];
    expect(data[0].type).toBe('Composition-search-response-v1.0');
    expect(resources).toHaveLength(1);
    expect(resources[0].id).toBe(selectionCompositionId);
    expect(resources[0].meta?.tag?.[0]?.system).toBe('urn:research:tag:score');
    expect(resources[0].meta?.tag?.[0]?.code).toBe('10');
  });
});
