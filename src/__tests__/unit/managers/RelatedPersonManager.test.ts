// Flow contract: reuse shared test fixtures and canonical types; do not introduce duplicated literals.
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.
// File: src/__tests__/unit/managers/RelatedPersonManager.test.ts

import { describe, expect, it, jest, beforeEach, afterEach } from '@jest/globals';
import { RelatedPersonManager } from '../../../managers/RelatedPersonManager';
import { IVaultRepository } from '../../../database/repositories/vault/vault.repository';
import { JobRequest, JobStatus } from 'gdc-common-utils-ts/models/confidential-job';
import { getSubjectScopedSectionId } from '../../../utils/individual-sections';
import { EntityLifecycleStatus } from '../../../gdc-backend-utils-node/models/enums';
import { InteroperableLifecycleStatuses } from 'gdc-common-utils-ts/utils/interoperable-resource-operation';
import {
  SearchResponseProfileEnvironment,
  SearchResponseProfiles,
} from '../../../utils/didcomm-response';

describe('RelatedPersonManager', () => {
  /**
   * Contact-list flow contract under test:
   * 1. Every read is scoped to one explicit subject/patient.
   * 2. GW returns active and inactive relationship records as FHIR-shaped list
   *    entries but never resurrects a purged record in current readback.
   * 3. A request without a subject is rejected; collection-wide contact
   *    searches must never be available to either the web or voice channel.
   */
  const mockVaultRepository = {
    vaultExists: jest.fn(),
    get: jest.fn(),
    put: jest.fn(),
    listContainersInSection: jest.fn(),
  } as unknown as jest.Mocked<IVaultRepository>;

  const manager = new RelatedPersonManager(mockVaultRepository);

  beforeEach(() => {
    process.env[SearchResponseProfileEnvironment.Variable] = SearchResponseProfiles.PrimaryResource;
    jest.clearAllMocks();
    mockVaultRepository.vaultExists.mockResolvedValue(true as any);
    mockVaultRepository.get.mockResolvedValue(undefined as any);
    mockVaultRepository.put.mockResolvedValue(true as any);
    mockVaultRepository.listContainersInSection.mockResolvedValue([] as any);
  });

  afterEach(() => {
    delete process.env[SearchResponseProfileEnvironment.Variable];
  });

  const createJob = (overrides: Partial<JobRequest> = {}): JobRequest => ({
    id: 'job-relatedperson-1',
    status: JobStatus.DRAFT,
    sequence: 0,
    createdAtTimestamp: Date.now(),
    tenantId: 'acme',
    jurisdiction: 'es',
    sector: 'health-care',
    section: 'individual',
    format: 'org.hl7.fhir.api',
    resourceType: 'RelatedPerson',
    action: '_batch',
    content: {
      jti: 'jti-relatedperson-1',
      thid: 'thid-relatedperson-1',
      iss: 'did:web:app.example',
      aud: 'did:web:api.example',
      exp: Math.floor(Date.now() / 1000) + 300,
      type: 'org.hl7.fhir.api.Bundle',
      body: {
        resourceType: 'Bundle',
        type: 'batch',
        entry: [{
          type: 'RelatedPerson',
          resource: {
            resourceType: 'RelatedPerson',
            meta: { claims: {
              '@context': 'org.hl7.fhir.api',
              'RelatedPerson.patient': 'did:web:connector.example.com:animal:chip:z123',
              'RelatedPerson.identifier': 'urn:uuid:rel-001',
              'RelatedPerson.relationship': 'guardian',
            } },
          },
        }],
      },
    } as any,
    ...overrides,
  });

  it('stores RelatedPerson claims and returns polling location without resource id', async () => {
    const job = createJob();
    const response = await manager.process(job);
    const data = (response.body as any).data;
    expect(data[0].response.status).toBe('201');
    expect(data[0].response.location).toBe(
      '/acme/cds-es/v1/health-care/individual/org.hl7.fhir.api/RelatedPerson/_batch-response'
    );
    expect(data[0].response.location).not.toMatch(/\/RelatedPerson\/[0-9a-f]{8,}/i);

    const expectedSectionId = getSubjectScopedSectionId(
      'did:web:connector.example.com:animal:chip:z123',
      'individual',
      'related-persons',
    );
    expect(mockVaultRepository.put).toHaveBeenCalled();
    const putArgs = (mockVaultRepository.put as any).mock.calls[0];
    expect(putArgs[0]).toBe('health-care_acme');
    expect(putArgs[2]).toBe(expectedSectionId);
  });

  it('keeps family relationship separate from comma-separated contact functions', async () => {
    const job = createJob();
    const claims = (job.content as any).body.entry[0].resource.meta.claims;

    // Step 1. Kinship uses the neutral family-member code while emergency and
    // billing duties use the separate GDC RelatedPerson.role extension.
    claims['RelatedPerson.relationship'] =
      'http://terminology.hl7.org/CodeSystem/v3-RoleCode|FAMMEMB';
    claims['RelatedPerson.role'] = 'CAREGIVER,ECON,DEPEN,BILL';
    const response = await manager.process(job);

    // Step 2. GW stores both values unchanged so Communication readback and
    // blockchain-rule preparation can reproduce the controller's assertion.
    expect((response.body as any).data[0].response.status).toBe('201');
    const stored = (mockVaultRepository.put as any).mock.calls[0][1][0];
    const relationship = Object.entries(stored)
      .find(([key]) => key.endsWith('RelatedPerson.relationship'))?.[1];
    const roles = Object.entries(stored)
      .find(([key]) => key.endsWith('RelatedPerson.role'))?.[1];
    expect(relationship).toContain('|FAMMEMB');
    expect(roles).toBe('CAREGIVER,ECON,DEPEN,BILL');
  });

  it('rejects PERMITTED because an access decision is not an HL7 relationship', async () => {
    const job = createJob();
    const claims = (job.content as any).body.entry[0].resource.meta.claims;

    // Step 1. Reproduce the obsolete portal payload.
    claims['RelatedPerson.relationship'] = 'v3-RoleCode|PERMITTED';
    const response = await manager.process(job);

    // Step 2. The entry fails deterministically and nothing reaches storage.
    expect((response.body as any).data[0].response).toMatchObject({ status: '400' });
    expect((response.body as any).data[0].response.outcome.issue[0].diagnostics)
      .toContain('not a RelatedPerson relationship');
    expect(mockVaultRepository.put).not.toHaveBeenCalled();
  });

  it('fails fast when job.action is missing', async () => {
    const job = createJob({ action: '' as any });
    await expect(manager.process(job)).rejects.toThrow('Missing jurisdiction, section, format, or action.');
  });

  it('accepts canonical resource.meta.claims and stores inactive status for lifecycle-style updates', async () => {
    const job = createJob({
      content: {
        jti: 'jti-relatedperson-2',
        thid: 'thid-relatedperson-2',
        iss: 'did:web:app.example',
        aud: 'did:web:api.example',
        exp: Math.floor(Date.now() / 1000) + 300,
        type: 'org.hl7.fhir.api.Bundle',
        body: {
          resourceType: 'Bundle',
          type: 'batch',
          entry: [{
            type: 'RelatedPerson',
            resource: {
              meta: {
                status: EntityLifecycleStatus.Inactive,
                claims: {
                  '@context': 'org.hl7.fhir.api',
                  'RelatedPerson.patient': 'did:web:connector.example.com:animal:chip:z123',
                  'RelatedPerson.identifier': 'urn:uuid:rel-002',
                  'RelatedPerson.relationship': 'guardian',
                },
              },
            },
          }],
        },
      } as any,
    });

    const response = await manager.process(job);
    expect((response.body as any).data[0].response.status).toBe('201');
    expect(mockVaultRepository.put).toHaveBeenCalled();
    const stored = (mockVaultRepository.put as any).mock.calls[0][1][0];
    expect(stored.status).toBe(EntityLifecycleStatus.Inactive);
  });

  it('purges a disabled related person through the explicit _purge action', async () => {
    const job = createJob({
      action: '_purge',
      content: {
        jti: 'jti-relatedperson-3',
        thid: 'thid-relatedperson-3',
        iss: 'did:web:app.example',
        aud: 'did:web:api.example',
        exp: Math.floor(Date.now() / 1000) + 300,
        type: 'org.hl7.fhir.api.Bundle',
        body: {
          resourceType: 'Bundle',
          type: 'batch',
          entry: [{
            type: 'RelatedPerson',
            resource: {
              id: 'urn:uuid:rel-001',
              meta: {
                claims: {
                  '@context': 'org.hl7.fhir.api',
                  'RelatedPerson.patient': 'did:web:connector.example.com:animal:chip:z123',
                  'RelatedPerson.identifier': 'urn:uuid:rel-001',
                  'RelatedPerson.relationship': 'guardian',
                },
              },
            },
          }],
        },
      } as any,
    });

    mockVaultRepository.get.mockResolvedValue({
      id: 'urn:uuid:rel-001',
      status: EntityLifecycleStatus.Inactive,
      meta: {},
      'RelatedPerson.identifier': 'urn:uuid:rel-001',
      'RelatedPerson.patient': 'did:web:connector.example.com:animal:chip:z123',
    } as any);

    const response = await manager.process(job);
    expect((response.body as any).data[0].response.status).toBe('200');
    const stored = (mockVaultRepository.put as any).mock.calls[0][1][0];
    expect(stored.status).toBe(InteroperableLifecycleStatuses.Purged);
    expect(stored['RelatedPerson.lifecycle-disposition']).toBeUndefined();
    expect(stored.meta.lifecycleDisposition).toBe('purged');
  });

  it('rejects a wildcard resource id instead of expanding an implicit all-members operation', async () => {
    const job = createJob({
      action: '_purge',
      content: {
        jti: 'jti-relatedperson-wildcard',
        thid: 'thid-relatedperson-wildcard',
        iss: 'did:web:app.example',
        aud: 'did:web:api.example',
        exp: Math.floor(Date.now() / 1000) + 300,
        type: 'org.hl7.fhir.api.Bundle',
        body: {
          resourceType: 'Bundle',
          type: 'batch',
          entry: [{
            type: 'RelatedPerson',
            // The wildcard literal is the forbidden wire value under test.
            resource: { id: '*', meta: { claims: {
              '@context': 'org.hl7.fhir.api',
              'RelatedPerson.patient': 'did:web:connector.example.com:animal:chip:z123',
              'RelatedPerson.identifier': '*',
            } } },
          }],
        },
      } as any,
    });

    const response = await manager.process(job);

    expect((response.body as any).data[0].response.status).toBe('400');
    expect((response.body as any).data[0].response.outcome.issue[0].diagnostics).toContain('explicit resource.id');
    expect(mockVaultRepository.get).not.toHaveBeenCalled();
  });

  it('lists contacts only from the requested subject section', async () => {
    const subject = 'did:web:unid.online:card:uhc:personal:subject-1';
    mockVaultRepository.listContainersInSection.mockResolvedValue([{
      id: 'related-person-1',
      status: EntityLifecycleStatus.Active,
      'RelatedPerson.identifier': 'urn:uuid:related-person-1',
      'RelatedPerson.patient': subject,
      'RelatedPerson.relationship': 'http://terminology.hl7.org/CodeSystem/v3-RoleCode|FAMMEMB',
      'RelatedPerson.name': 'Doraemon',
      'RelatedPerson.telecom': 'mailto:doraemon@example.org',
      'RelatedPerson.related-entity-type': 'person',
      'RelatedPerson.actor-identifier': 'doraemon@example.org',
      'RelatedPerson.active': 'true',
    }] as any);

    const response = await manager.process(createJob({
      action: '_search',
      content: {
        jti: 'jti-relatedperson-search-1',
        thid: 'thid-relatedperson-search-1',
        iss: 'did:web:app.example',
        aud: 'did:web:api.example',
        exp: Math.floor(Date.now() / 1000) + 300,
        type: 'org.hl7.fhir.api.Parameters',
        body: {
          resourceType: 'Parameters',
          parameter: [{ name: 'patient', valueString: subject }],
        },
      } as any,
    }));

    expect(mockVaultRepository.listContainersInSection).toHaveBeenCalledWith(
      'health-care_acme',
      getSubjectScopedSectionId(subject, 'individual', 'related-persons'),
    );
    const search = (response.body as any).data[0];
    expect(search.type).toBe('RelatedPerson-search-response-v1.0');
    expect((response.body as any).total).toBe(1);
    expect(search.resource).toMatchObject({
      type: 'RelatedPerson',
      resource: {
        resourceType: 'RelatedPerson',
        id: 'related-person-1',
        meta: {
          status: EntityLifecycleStatus.Active,
          claims: {
            'RelatedPerson.identifier': 'urn:uuid:related-person-1',
            'RelatedPerson.patient': subject,
            'RelatedPerson.actor-identifier': 'doraemon@example.org',
          },
        },
      },
    });
    expect(search.resource.data).toBeUndefined();
  });

  it('omits purged contacts from current subject-scoped search readback', async () => {
    const subject = 'did:web:unid.online:card:uhc:personal:subject-1';
    mockVaultRepository.listContainersInSection.mockResolvedValue([{
      id: 'related-person-active',
      status: EntityLifecycleStatus.Active,
      'RelatedPerson.identifier': 'urn:uuid:related-person-active',
      'RelatedPerson.patient': subject,
    }, {
      id: 'related-person-purged',
      status: InteroperableLifecycleStatuses.Purged,
      meta: { lifecycleDisposition: 'purged' },
      'RelatedPerson.identifier': 'urn:uuid:related-person-purged',
      'RelatedPerson.patient': subject,
    }] as any);

    const response = await manager.process(createJob({
      action: '_search',
      content: {
        jti: 'jti-relatedperson-search-purged',
        thid: 'thid-relatedperson-search-purged',
        iss: 'did:web:app.example',
        aud: 'did:web:api.example',
        exp: Math.floor(Date.now() / 1000) + 300,
        type: 'org.hl7.fhir.api.Parameters',
        body: {
          resourceType: 'Parameters',
          parameter: [{ name: 'patient', valueString: subject }],
        },
      } as any,
    }));

    expect((response.body as any).total).toBe(1);
    expect((response.body as any).data[0].resource.resource.id).toBe('related-person-active');
  });

  it('rejects a collection-wide contact search without a subject', async () => {
    await expect(manager.process(createJob({
      action: '_search',
      content: {
        jti: 'jti-relatedperson-search-2',
        thid: 'thid-relatedperson-search-2',
        iss: 'did:web:app.example',
        aud: 'did:web:api.example',
        exp: Math.floor(Date.now() / 1000) + 300,
        type: 'org.hl7.fhir.api.Parameters',
        body: { resourceType: 'Parameters', parameter: [] },
      } as any,
    }))).rejects.toThrow('subject or patient');
  });
});
