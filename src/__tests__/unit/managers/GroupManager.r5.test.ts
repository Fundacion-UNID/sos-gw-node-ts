// Flow contract: reuse shared test fixtures and canonical types; do not introduce duplicated literals.
import { describe, expect, it, jest } from '@jest/globals';
import {
  buildVeterinaryResearchStudyGroupCreateEntry,
  buildVeterinaryResearchStudyReviewTeamGroupSearch,
} from 'vet-sdk-core-ts/research-study';
import {
  projectGroupPractitionerRoleMemberFlatClaimResources,
  projectGroupR5FlatClaimsResource,
} from 'vet-data-utils-ts';
import {
  GroupManager,
  buildGroupMemberProjectionId,
  buildGroupMemberSectionId,
} from '../../../managers/GroupManager';
import {
  researchGroupFixture,
  researchGroupRouteFixture,
  researchGroupSearchProjectionFixture,
} from '../../data/research-group.data';
import { GATEWAY_PROFILE_TEST_SUBJECTS } from '../../../config/gateway-capability-profile';

const vaultId = `${researchGroupRouteFixture.sector}_${researchGroupRouteFixture.tenantId}`;
const baseGroupResource = projectGroupR5FlatClaimsResource({ ...researchGroupSearchProjectionFixture, member: [] });
const memberResources = projectGroupPractitionerRoleMemberFlatClaimResources({
  groupId: researchGroupFixture.id,
  members: researchGroupFixture.member.map((member) => ({
    ...member,
    entity: { ...member.entity, type: 'PractitionerRole' as const },
  })),
});
const animalCampaignGroupResource = {
  resourceType: 'Group' as const,
  id: 'campaign-cohort-one',
  meta: { claims: {
    'Group.identifier': ['https://soschain.org/fhir/NamingSystem/alert-cohort|urn:uuid:11111111-1111-4111-8111-111111111111'],
    'Group.name': ['Frozen eligible animal cohort'],
    'Group.type': ['animal'],
    'Group.membership': ['enumerated'],
  } },
};
const animalCampaignMemberResource = {
  resourceType: 'Group' as const,
  id: animalCampaignGroupResource.id,
  meta: { claims: {
    'Group.type': ['animal'],
    'Group.membership': ['enumerated'],
    'Group.member': [GATEWAY_PROFILE_TEST_SUBJECTS.veterinary],
  } },
};

describe('GroupManager FHIR R5 claims-first professional and subject-group workflow contract', () => {
  it('persists the SDK-derived ResearchStudy association as canonical Group.identifier claims', async () => {
    const studyId = '8b168f80-98d4-4d85-b441-3f11cac124f7';
    const entry = buildVeterinaryResearchStudyGroupCreateEntry({
      researchStudyId: studyId,
      group: { ...researchGroupFixture, member: [] },
    });
    const harness = createHarness();

    const created = await harness.manager.process(batchJob([entry]));

    expect((created.body as any).data[0].response.status).toBe('201');
    expect(harness.recordsIn('research-groups')[0].content.claims['Group.identifier'])
      .toEqual([buildVeterinaryResearchStudyReviewTeamGroupSearch(studyId).identifier]);
  });

  it('persists only base flat claims and HMAC-indexes attributes before encryption', async () => {
    const harness = createHarness();
    const created = await harness.manager.process(batchJob([{
      request: { method: 'POST', url: 'Group' }, resource: baseGroupResource,
    }]));

    expect((created.body as any).data[0].resource).toEqual(baseGroupResource);
    const protectedRecord = harness.protectConfidentialData.mock.calls[0]?.[0] as any;
    expect(protectedRecord.content).toEqual({ claims: baseGroupResource.meta.claims });
    expect(protectedRecord.content.resourceType).toBeUndefined();
    expect(harness.protectAttributesNameAndValue.mock.invocationCallOrder[0])
      .toBeLessThan(harness.protectConfidentialData.mock.invocationCallOrder[0]);
  });

  it('stores two PractitionerRole members as distinct correlated claims-only records', async () => {
    const harness = createHarness({ baseResource: baseGroupResource });
    for (const member of memberResources) {
      await harness.manager.process(batchJob([{
        request: { method: 'PATCH', url: `Group/${researchGroupFixture.id}` }, resource: member,
      }]));
    }

    const section = buildGroupMemberSectionId(researchGroupFixture.id);
    const memberRecords = harness.recordsIn(section);
    expect(memberRecords).toHaveLength(2);
    expect(memberRecords.map((record) => record.id)).toEqual(memberResources.map((member) =>
      buildGroupMemberProjectionId(researchGroupFixture.id, member.meta.claims['Group.member'][0])));
    expect(memberRecords.map((record) => record.content)).toEqual(memberResources.map((member) => ({ claims: member.meta.claims })));
    expect(harness.recordsIn('research-groups')[0].content).toEqual({ claims: baseGroupResource.meta.claims });
  });

  it('stores an enumerated animal campaign cohort without treating membership as authority', async () => {
    const harness = createHarness();
    const created = await harness.manager.process(batchJob([{
      request: { method: 'POST', url: 'Group' }, resource: animalCampaignGroupResource,
    }]));
    const memberAdded = await harness.manager.process(batchJob([{
      request: { method: 'PATCH', url: `Group/${animalCampaignGroupResource.id}` },
      resource: animalCampaignMemberResource,
    }]));

    expect((created.body as any).data[0].response.status).toBe('201');
    expect((memberAdded.body as any).data[0].response.status).toBe('200');
    expect(harness.recordsIn(buildGroupMemberSectionId(animalCampaignGroupResource.id))[0].content)
      .toEqual({ claims: animalCampaignMemberResource.meta.claims });
  });

  it('keeps animal and person member references separated by Group.type', async () => {
    const animalHarness = createHarness({ baseResource: animalCampaignGroupResource });
    const patientDisguisedAsAnimal = {
      ...animalCampaignMemberResource,
      meta: { claims: {
        ...animalCampaignMemberResource.meta.claims,
        'Group.member': [GATEWAY_PROFILE_TEST_SUBJECTS.human],
      } },
    };
    const rejectedAnimalMember = await animalHarness.manager.process(batchJob([{
      request: { method: 'PATCH', url: `Group/${animalCampaignGroupResource.id}` },
      resource: patientDisguisedAsAnimal,
    }]));

    expect((rejectedAnimalMember.body as any).data[0].response.status).toBe('400');
    expect(JSON.stringify((rejectedAnimalMember.body as any).data[0].response.outcome)).toContain('Animal/<id>');
    expect(animalHarness.recordsIn(buildGroupMemberSectionId(animalCampaignGroupResource.id))).toHaveLength(0);
  });

  it('makes deterministic POST replay idempotent and rejects divergent or legacy existing records', async () => {
    const replay = createHarness({ baseResource: baseGroupResource });
    const repeated = await replay.manager.process(batchJob([{
      request: { method: 'POST', url: 'Group' }, resource: baseGroupResource,
    }]));
    expect((repeated.body as any).data[0].response.status).toBe('200');
    expect(replay.put).not.toHaveBeenCalled();

    const conflict = createHarness({ baseResource: baseGroupResource });
    const changed = await conflict.manager.process(batchJob([{
      request: { method: 'POST', url: 'Group' },
      resource: { ...baseGroupResource, meta: { claims: { ...baseGroupResource.meta.claims, 'Group.name': ['Changed'] } } },
    }]));
    expect((changed.body as any).data[0].response.status).toBe('409');
    expect(conflict.put).not.toHaveBeenCalled();

    const legacy = createHarness({ historicalNative: researchGroupFixture });
    const incompatible = await legacy.manager.process(batchJob([{
      request: { method: 'POST', url: 'Group' }, resource: baseGroupResource,
    }]));
    expect((incompatible.body as any).data[0].response.status).toBe('400');
    expect(legacy.put).not.toHaveBeenCalled();
    expect(legacy.deleteRecord).not.toHaveBeenCalled();
  });

  it('advances an existing member projection from sequence zero to one', async () => {
    const harness = createHarness({ baseResource: baseGroupResource, memberResources: [memberResources[0]] });
    await harness.manager.process(batchJob([{
      request: { method: 'PATCH', url: `Group/${researchGroupFixture.id}` }, resource: memberResources[0],
    }]));
    expect((harness.protectConfidentialData.mock.calls[0]?.[0] as any).sequence).toBe(1);
  });

  it('explicitly removes one member projection while retaining the claims-first study-linked Group', async () => {
    const harness = createHarness({ baseResource: baseGroupResource, memberResources });
    const removed = await harness.manager.process(batchJob([{
      request: { method: 'DELETE', url: `Group/${researchGroupFixture.id}` },
      resource: memberResources[0],
    }]));

    expect((removed.body as any).data[0].response.status).toBe('204');
    expect(harness.recordsIn('research-groups')).toHaveLength(1);
    expect(harness.recordsIn(buildGroupMemberSectionId(researchGroupFixture.id))).toHaveLength(1);
    expect(harness.recordsIn('research-groups')[0].content.claims['Group.identifier'])
      .toEqual(baseGroupResource.meta.claims['Group.identifier']);
  });

  it('searches by a protected member projection and returns one combined flat-claims Group', async () => {
    const harness = createHarness({ baseResource: baseGroupResource, memberResources });
    const searched = await harness.manager.process(searchJob({
      'Group.member': memberResources[0].meta.claims['Group.member'],
    }));

    expect((searched.body as any).data).toHaveLength(1);
    expect((searched.body as any).data[0].resource).toEqual({
      ...baseGroupResource,
      meta: { claims: {
        ...baseGroupResource.meta.claims,
        'Group.member': memberResources.map((member) => member.meta.claims['Group.member'][0]),
      } },
    });
  });

  it('rejects native JSON, mixed base/member claims and non-PractitionerRole member projections', async () => {
    const attempts = [
      { ...baseGroupResource, member: researchGroupFixture.member },
      { ...baseGroupResource, meta: { claims: { ...baseGroupResource.meta.claims, ...memberResources[0].meta.claims } } },
      { ...memberResources[0], meta: { claims: { ...memberResources[0].meta.claims, 'Group.member': ['Practitioner/reviewer-one'] } } },
    ];
    for (const resource of attempts) {
      const harness = createHarness({ baseResource: baseGroupResource });
      const method = 'member' in resource ? 'POST' : 'PATCH';
      const result = await harness.manager.process(batchJob([{
        request: { method, url: method === 'POST' ? 'Group' : `Group/${researchGroupFixture.id}` }, resource,
      }]));
      expect((result.body as any).data[0].response.status).toBe('400');
      expect(harness.put).not.toHaveBeenCalled();
      expect(harness.protectAttributesNameAndValue).not.toHaveBeenCalled();
    }
  });

  it('requires a controller, fails closed on historical native records, and deletes member projections explicitly', async () => {
    const denied = createHarness({ baseResource: baseGroupResource });
    await expect(denied.manager.process(batchJob([{
      request: { method: 'PUT', url: `Group/${researchGroupFixture.id}` }, resource: baseGroupResource,
    }], researchGroupRouteFixture.professionalDid))).rejects.toThrow('controller');

    const historical = createHarness({ historicalNative: researchGroupFixture });
    await expect(historical.manager.process(searchJob({ 'Group.name': ['Research reviewers'] })))
      .rejects.toThrow('migration');
    expect(historical.deleteRecord).not.toHaveBeenCalled();

    const removable = createHarness({ baseResource: baseGroupResource, memberResources });
    await removable.manager.process(batchJob([{
      request: { method: 'DELETE', url: `Group/${researchGroupFixture.id}` },
      resource: { resourceType: 'Group', id: researchGroupFixture.id },
    }]));
    expect(removable.recordsIn('research-groups')).toHaveLength(0);
    expect(removable.recordsIn(buildGroupMemberSectionId(researchGroupFixture.id))).toHaveLength(0);
  });

  it('never deletes incompatible historical content encountered during PATCH or member search', async () => {
    const historicalBase = createHarness({ historicalNative: researchGroupFixture });
    const patch = await historicalBase.manager.process(batchJob([{
      request: { method: 'PATCH', url: `Group/${researchGroupFixture.id}` }, resource: memberResources[0],
    }]));
    expect((patch.body as any).data[0].response.status).toBe('400');
    expect(historicalBase.deleteRecord).not.toHaveBeenCalled();

    const historicalMember = createHarness({ baseResource: baseGroupResource, historicalNativeMember: researchGroupFixture.member[0] });
    await expect(historicalMember.manager.process(searchJob({ 'Group.name': ['Research reviewers'] })))
      .rejects.toThrow('migration');
    expect(historicalMember.deleteRecord).not.toHaveBeenCalled();
  });
});

function batchJob(data: unknown[], issuer: string = researchGroupRouteFixture.controllerDid) {
  return {
    ...baseJob(issuer), action: '_batch',
    content: { ...baseJob(issuer).content, thid: 'research-group-batch', body: { data } },
  } as any;
}

function searchJob(claims: Record<string, readonly string[]>) {
  return {
    ...baseJob(researchGroupRouteFixture.professionalDid), action: '_search',
    content: {
      ...baseJob(researchGroupRouteFixture.professionalDid).content, thid: 'research-group-search',
      body: { data: [{ resource: { resourceType: 'Parameters', meta: { claims } } }] },
    },
  } as any;
}

function baseJob(issuer: string) {
  return {
    tenantId: researchGroupRouteFixture.tenantId, jurisdiction: researchGroupRouteFixture.jurisdiction,
    sector: researchGroupRouteFixture.sector, section: 'organization', format: 'org.hl7.fhir.r5', resourceType: 'Group',
    content: { thid: 'research-group', iss: issuer, aud: researchGroupRouteFixture.gatewayDid },
  };
}

function createHarness(options: {
  baseResource?: any;
  memberResources?: readonly any[];
  historicalNative?: any;
  historicalNativeMember?: any;
} = {}) {
  const sections = new Map<string, Map<string, any>>();
  const putRecord = (section: string, record: any) => {
    if (!sections.has(section)) sections.set(section, new Map());
    sections.get(section)!.set(record.id, record);
  };
  if (options.baseResource) putRecord('research-groups', stored(options.baseResource.id, options.baseResource.meta.claims));
  if (options.historicalNative) putRecord('research-groups', {
    id: options.historicalNative.id, content: options.historicalNative,
    indexed: { attributes: [{ name: 'Group.name', value: options.historicalNative.name }] },
  });
  for (const member of options.memberResources || []) {
    putRecord(
      buildGroupMemberSectionId(member.id),
      stored(buildGroupMemberProjectionId(member.id, member.meta.claims['Group.member'][0]), member.meta.claims),
    );
  }
  if (options.historicalNativeMember) {
    putRecord(buildGroupMemberSectionId(researchGroupFixture.id), {
      id: 'historical-member', content: options.historicalNativeMember, indexed: { attributes: [] },
    });
  }
  const put = jest.fn(async (_collection: string, records: any[], section: string) => {
    records.forEach((record) => putRecord(section, record)); return true;
  });
  const get = jest.fn(async (_collection: string, id: string, section: string) => sections.get(section)?.get(id));
  const deleteRecord = jest.fn(async (_collection: string, id: string, section: string) => sections.get(section)?.delete(id) || false);
  const listContainersInSection = jest.fn(async (_collection: string, section: string) => [...(sections.get(section)?.values() || [])]);
  const protectAttributesNameAndValue = jest.fn(async (attributes: any[]) => attributes);
  const protectConfidentialData = jest.fn(async (record: any) => record);
  const unprotectConfidentialData = jest.fn(async (record: any) => record.content);
  return {
    manager: new GroupManager({
      vaultRepository: { put, get, delete: deleteRecord, listContainersInSection } as any,
      kmsService: { protectAttributesNameAndValue, protectConfidentialData, unprotectConfidentialData } as any,
      tenantManager: {
        tenantExists: jest.fn(async (candidate: string) => candidate === vaultId),
        getCollectionName: jest.fn(async () => researchGroupRouteFixture.collectionName),
        getTenantJurisdiction: jest.fn(async () => researchGroupRouteFixture.jurisdiction),
        getDidDocument: jest.fn(async () => ({ controller: [researchGroupRouteFixture.controllerDid] })),
      },
    } as any),
    put, deleteRecord, protectAttributesNameAndValue, protectConfidentialData,
    recordsIn: (section: string) => [...(sections.get(section)?.values() || [])],
  };
}

function stored(id: string, claims: Record<string, readonly string[]>) {
  return {
    id, sequence: 0, content: { claims },
    indexed: { attributes: Object.entries(claims).flatMap(([name, values]) =>
      values.map((value) => ({ name, value, unique: name === 'Group.identifier' }))) },
  };
}
