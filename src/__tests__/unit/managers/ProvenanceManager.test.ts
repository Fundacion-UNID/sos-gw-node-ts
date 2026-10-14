// Flow contract: the organization controller persists FHIR R5 Provenance as encrypted claims and searches both standard and correlated typed-agent claims.
import { describe, expect, it, jest } from '@jest/globals';
import {
  buildPractitionerRoleReferenceFromAssignmentIdentifier,
  buildResearchStudyProvenanceResource,
} from 'vet-data-utils-ts/provenance';
import { ProvenanceManager } from '../../../managers/ProvenanceManager';

describe('ProvenanceManager', () => {
  it('writes and searches a typed professional assignment agent', async () => {
    let stored: any;
    const repository = {
      put: jest.fn(async (_collection: string, records: any[]) => { stored = records[0]; return true; }),
      listContainersInSection: jest.fn(async () => stored ? [stored] : []),
    } as any;
    const kms = {
      protectAttributesNameAndValue: jest.fn(async (values: any[]) => values.map(value => ({ ...value, name: `p:${value.name}`, value: `p:${value.value}` }))),
      protectConfidentialData: jest.fn(async (value: any) => value),
      unprotectConfidentialData: jest.fn(async (value: any) => value.content),
    } as any;
    const manager = new ProvenanceManager({ repository, kms, tenantManager: tenant('did:web:controller') });
    const who = buildPractitionerRoleReferenceFromAssignmentIdentifier('urn:uuid:123e4567-e89b-12d3-a456-426614174000');
    const resource = buildResearchStudyProvenanceResource({
      id: 'study-1-created',
      researchStudyReference: 'ResearchStudy/study-1',
      recorded: '2026-09-10T12:00:00.000Z',
      agents: [{ type: 'author', who }],
    });

    const written = await manager.process(job('_batch', resource));
    expect((written.body as any).data[0].response.status).toBe('201');
    expect(kms.protectAttributesNameAndValue).toHaveBeenCalledWith(expect.arrayContaining([
      expect.objectContaining({ name: 'Provenance.agent-author-who', value: who }),
      expect.objectContaining({ name: 'Provenance.target', value: 'ResearchStudy/study-1' }),
    ]), 'animal-research_clinic');

    const found = await manager.process(job('_search', {
      resourceType: 'Provenance', id: 'search', meta: { claims: {
        'Provenance.agent-author-who': [who],
        'Provenance.target': ['ResearchStudy/study-1'],
      } },
    }));
    expect((found.body as any).data[0].resource.id).toBe('study-1-created');
  });

  it('rejects an operational role-license URN and a non-controller', async () => {
    expect(() => buildPractitionerRoleReferenceFromAssignmentIdentifier('urn:multibase:zRoleLicenseHash')).toThrow(/professional_assignment_identifier_invalid/);
    const put = jest.fn();
    const manager = new ProvenanceManager({ repository: { put } as any, kms: {} as any, tenantManager: tenant('did:web:controller') });
    await expect(manager.process({ ...job('_batch', minimumResource()), content: { ...job('_batch', minimumResource()).content, iss: 'did:web:employee' } } as any)).rejects.toThrow(/controller/);
    expect(put).not.toHaveBeenCalled();
  });
});

function tenant(controller: string) {
  return {
    tenantExists: async () => true,
    getCollectionName: async () => 'tenant-collection',
    getTenantJurisdiction: async () => 'CA-BC',
    getTenant: async () => ({ didDocument: { controller: [controller] } }),
  } as any;
}

function job(action: string, resource: any) {
  return {
    tenantId: 'clinic', jurisdiction: 'CA-BC', sector: 'animal-research', section: 'organization',
    format: 'org.hl7.fhir.r5', resource: 'Provenance', action,
    content: { thid: `thid-provenance-${action}`, iss: 'did:web:controller', body: { data: [{ request: { method: 'POST' }, resource }] } },
  } as any;
}

function minimumResource() {
  return buildResearchStudyProvenanceResource({
    id: 'study-1-created', researchStudyReference: 'ResearchStudy/study-1', recorded: '2026-09-10T12:00:00.000Z',
    agents: [{ type: 'author', who: 'PractitionerRole/123e4567-e89b-12d3-a456-426614174000' }],
  });
}
