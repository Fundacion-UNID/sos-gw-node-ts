// Flow contract: reuse shared test fixtures and canonical types; do not introduce duplicated literals.
import { describe, expect, it, jest } from '@jest/globals';
import { ResearchStudyFlatClaimCatalog, projectResearchStudyR5SearchClaims } from 'vet-data-utils-ts';
import {
  ResearchStudyManager,
  buildResearchStudyPartyProjectionId,
} from '../../../managers/ResearchStudyManager';

const tenantId = 'research-clinic';
const sector = 'animal-care';
const jurisdiction = 'CA-BC';
const vaultId = `${sector}_${tenantId}`;
const collectionName = 'isolated-research-clinic-vault';
const controllerDid = 'did:web:example.test:controller';
const professionalDid = 'did:web:example.test:professional';
const studyId = 'study-one';
type FlatClaims = Readonly<Record<string, readonly string[] | undefined>>;
const nativeStudy = Object.freeze({
  resourceType: 'ResearchStudy', id: studyId, status: 'draft', title: 'Veterinary outcomes',
  period: { start: '2026-01-01', end: '2026-12-31' },
});
const studyClaims = projectResearchStudyR5SearchClaims(nativeStudy);
const studyResource = claimsResource(studyId, studyClaims);
const partyClaims = Object.freeze({
  'ResearchStudy.party-name': ['Reviewer'],
  'ResearchStudy.party-role': ['http://hl7.org/fhir/research-study-party-role|sub-investigator'],
  'ResearchStudy.party-period-start': ['2026-02-01'],
  'ResearchStudy.party-period-end': ['2026-06-30'],
  'ResearchStudy.party-classifier': ['review-team'],
  'ResearchStudy.party': ['PractitionerRole/reviewer-one'],
});

describe('ResearchStudyManager FHIR R5 claims-first contract', () => {
  it('persists only governed flat study claims and derives the protected index from them', async () => {
    const harness = createHarness();
    const result = await harness.manager.process(batchJob(controllerDid, [{
      type: 'ResearchStudy-v5.0.0', request: { method: 'POST', url: 'ResearchStudy' }, resource: studyResource,
    }]));

    expect((result.body as any).data[0]).toMatchObject({ response: { status: '201' }, resource: studyResource });
    const protectedRecord = harness.protectConfidentialData.mock.calls[0]?.[0] as any;
    expect(protectedRecord.content).toEqual({ claims: studyClaims });
    expect(protectedRecord.content.resourceType).toBeUndefined();
    expect(protectedRecord.content.status).toBeUndefined();
    expect(protectedRecord.indexed.attributes).toEqual(toAttributes(studyClaims));
    expect(protectedRecord.indexed.attributes.every((attribute: any) =>
      ResearchStudyFlatClaimCatalog.standardSearch.includes(attribute.name))).toBe(true);
  });

  it('rejects nested native FHIR JSON instead of retaining it beside flat claims', async () => {
    const harness = createHarness();
    const result = await harness.manager.process(batchJob(controllerDid, [{
      request: { method: 'POST', url: 'ResearchStudy' },
      resource: { ...studyResource, status: 'draft', title: 'Nested copy' },
    }]));
    expect((result.body as any).data[0]).toMatchObject({
      response: { status: '400' }, resource: { resourceType: 'OperationOutcome' },
    });
    expect(harness.put).not.toHaveBeenCalled();
    expect(harness.protectAttributesNameAndValue).not.toHaveBeenCalled();
    expect(harness.protectConfidentialData).not.toHaveBeenCalled();
  });

  it('rejects a version-specific FHIR claims namespace before indexing or encryption', async () => {
    const harness = createHarness();
    const result = await harness.manager.process(batchJob(controllerDid, [{
      request: { method: 'POST', url: 'ResearchStudy' },
      resource: claimsResource(studyId, {
        '@context': 'org.hl7.fhir.r5',
        'ResearchStudy.status': ['draft'],
      } as any),
    }]));
    expect((result.body as any).data[0]).toMatchObject({
      response: { status: '400' }, resource: { resourceType: 'OperationOutcome' },
    });
    expect(harness.put).not.toHaveBeenCalled();
    expect(harness.protectAttributesNameAndValue).not.toHaveBeenCalled();
    expect(harness.protectConfidentialData).not.toHaveBeenCalled();
  });

  it('makes deterministic POST replay idempotent and rejects divergent or legacy existing records', async () => {
    const replay = createHarness({ initialClaims: studyClaims });
    const repeated = await replay.manager.process(batchJob(controllerDid, [{
      request: { method: 'POST', url: 'ResearchStudy' }, resource: studyResource,
    }]));
    expect((repeated.body as any).data[0].response.status).toBe('200');
    expect(replay.put).not.toHaveBeenCalled();

    const conflict = createHarness({ initialClaims: studyClaims });
    const changed = await conflict.manager.process(batchJob(controllerDid, [{
      request: { method: 'POST', url: 'ResearchStudy' },
      resource: claimsResource(studyId, { ...studyClaims, 'ResearchStudy.title': ['Changed'] }),
    }]));
    expect((changed.body as any).data[0].response.status).toBe('409');
    expect(conflict.put).not.toHaveBeenCalled();

    const legacy = createHarness({ historicalNativeStudy: nativeStudy });
    const incompatible = await legacy.manager.process(batchJob(controllerDid, [{
      request: { method: 'POST', url: 'ResearchStudy' }, resource: studyResource,
    }]));
    expect((incompatible.body as any).data[0].response.status).toBe('400');
    expect(legacy.put).not.toHaveBeenCalled();
    expect(legacy.deleteRecord).not.toHaveBeenCalled();
  });

  it('stores one associated-party flat projection separately from the study claims', async () => {
    const harness = createHarness({ initialClaims: studyClaims });
    const result = await harness.manager.process(batchJob(controllerDid, [{
      type: 'ResearchStudy-v5.0.0', request: { method: 'PATCH', url: `ResearchStudy/${studyId}` },
      resource: claimsResource(studyId, partyClaims),
    }]));

    expect((result.body as any).data[0]).toMatchObject({ response: { status: '200' }, resource: claimsResource(studyId, partyClaims) });
    const protectedParty = harness.protectConfidentialData.mock.calls[0]?.[0] as any;
    expect(protectedParty.content).toEqual({ claims: partyClaims });
    expect(protectedParty.indexed.attributes).toHaveLength(toAttributes(partyClaims).length);
    expect(protectedParty.indexed.attributes).toEqual(expect.arrayContaining(toAttributes(partyClaims)));
    expect(harness.put.mock.calls[0]?.[2]).toContain('research-study-associated-parties');
    expect(harness.primaryRecord.content).toEqual({ claims: studyClaims });
  });

  it('advances an existing party projection from sequence zero to one', async () => {
    const harness = createHarness({ initialClaims: studyClaims, initialPartyClaims: partyClaims });
    await harness.manager.process(batchJob(controllerDid, [{
      request: { method: 'PATCH', url: `ResearchStudy/${studyId}` },
      resource: claimsResource(studyId, partyClaims),
    }]));
    expect((harness.protectConfidentialData.mock.calls[0]?.[0] as any).sequence).toBe(1);
  });

  it('updates the claims-first study lifecycle and explicitly removes one party without deleting the study', async () => {
    const harness = createHarness({ initialClaims: studyClaims, initialPartyClaims: partyClaims });
    const activeClaims = { ...studyClaims, 'ResearchStudy.status': ['active'] };
    const updated = await harness.manager.process(batchJob(controllerDid, [{
      request: { method: 'PUT', url: `ResearchStudy/${studyId}` },
      resource: claimsResource(studyId, activeClaims),
    }]));
    expect((updated.body as any).data[0].response.status).toBe('200');
    expect(harness.primaryRecord).toMatchObject({ sequence: 1, content: { claims: activeClaims } });

    const removed = await harness.manager.process(batchJob(controllerDid, [{
      request: { method: 'DELETE', url: `ResearchStudy/${studyId}` },
      resource: claimsResource(studyId, partyClaims),
    }]));
    expect((removed.body as any).data[0].response.status).toBe('204');
    expect(harness.primaryRecord).toBeDefined();
    expect(harness.partyRecords()).toHaveLength(0);

    const deleted = await harness.manager.process(batchJob(controllerDid, [{
      request: { method: 'DELETE', url: `ResearchStudy/${studyId}` },
      resource: { resourceType: 'ResearchStudy', id: studyId },
    }]));
    expect((deleted.body as any).data[0].response.status).toBe('204');
    expect(harness.primaryRecord).toBeUndefined();
  });

  it('keeps two parties correlated in separate records when their optional claims differ', async () => {
    const harness = createHarness({ initialClaims: studyClaims });
    const secondPartyClaims = {
      'ResearchStudy.party-role': ['http://hl7.org/fhir/research-study-party-role|study-chair'],
      'ResearchStudy.party': ['PractitionerRole/reviewer-two'],
    };

    for (const claims of [partyClaims, secondPartyClaims]) {
      await harness.manager.process(batchJob(controllerDid, [{
        request: { method: 'PATCH', url: `ResearchStudy/${studyId}` },
        resource: claimsResource(studyId, claims),
      }]));
    }

    const protectedParties = harness.protectConfidentialData.mock.calls.map((call) => call[0] as any);
    expect(protectedParties).toHaveLength(2);
    expect(protectedParties[0].id).not.toBe(protectedParties[1].id);
    expect(protectedParties[0].content).toEqual({ claims: partyClaims });
    expect(protectedParties[1].content).toEqual({ claims: secondPartyClaims });
    expect(harness.put.mock.calls.map((call) => call[2])).toEqual([
      expect.stringContaining('research-study-associated-parties'),
      expect.stringContaining('research-study-associated-parties'),
    ]);
  });

  it('rejects status changes, mixed claims and non-PractitionerRole parties in PATCH', async () => {
    for (const claims of [
      { ...partyClaims, 'ResearchStudy.status': ['active'] },
      { ...partyClaims, 'ResearchStudy.title': ['Changed'] },
      { ...partyClaims, 'ResearchStudy.party': ['Practitioner/reviewer-one'] },
    ]) {
      const harness = createHarness({ initialClaims: studyClaims });
      const result = await harness.manager.process(batchJob(controllerDid, [{
        request: { method: 'PATCH', url: `ResearchStudy/${studyId}` }, resource: claimsResource(studyId, claims),
      }]));
      expect((result.body as any).data[0].response.status).toBe('400');
      expect(harness.put).not.toHaveBeenCalled();
    }
  });

  it('fails closed without deleting a historical nested FHIR record', async () => {
    const harness = createHarness({ historicalNativeStudy: nativeStudy });
    await expect(harness.manager.process(searchJob({ 'ResearchStudy.title': ['Veterinary outcomes'] })))
      .rejects.toThrow('migration');
    expect(harness.deleteRecord).not.toHaveBeenCalled();
  });

  it('does not delete a historical study when a party PATCH encounters it', async () => {
    const harness = createHarness({ historicalNativeStudy: nativeStudy });
    const result = await harness.manager.process(batchJob(controllerDid, [{
      request: { method: 'PATCH', url: `ResearchStudy/${studyId}` },
      resource: claimsResource(studyId, partyClaims),
    }]));
    expect((result.body as any).data[0].response.status).toBe('400');
    expect(harness.deleteRecord).not.toHaveBeenCalled();
  });

  it('searches official claims and returns only the claims-first resource shape', async () => {
    const harness = createHarness({ initialClaims: studyClaims });
    const result = await harness.manager.process(searchJob({ 'ResearchStudy.title': ['Veterinary outcomes'] }));
    expect((result.body as any).data[0].resource).toEqual(studyResource);
  });

  it('returns each associated party as one correlated claims-only entry and filters by party claims', async () => {
    const secondPartyClaims = {
      'ResearchStudy.party-name': ['Second reviewer'],
      'ResearchStudy.party-role': ['http://hl7.org/fhir/research-study-party-role|study-chair'],
      'ResearchStudy.party': ['PractitionerRole/reviewer-two'],
    };
    const harness = createHarness({
      initialClaims: studyClaims,
      initialPartyClaims: [partyClaims, secondPartyClaims],
    });

    const byStudy = await harness.manager.process(searchJob({
      'ResearchStudy.title': ['Veterinary outcomes'],
    }));
    expect((byStudy.body as any).data).toEqual([
      expect.objectContaining({
        type: 'ResearchStudy-search-response-v5.0.0',
        resource: studyResource,
      }),
      expect.objectContaining({
        type: 'ResearchStudy-associated-party-search-response-v5.0.0',
        resource: claimsResource(studyId, partyClaims),
      }),
      expect.objectContaining({
        type: 'ResearchStudy-associated-party-search-response-v5.0.0',
        resource: claimsResource(studyId, secondPartyClaims),
      }),
    ]);

    const byParty = await harness.manager.process(searchJob({
      'ResearchStudy.party': ['PractitionerRole/reviewer-two'],
    }));
    expect((byParty.body as any).data).toEqual([
      expect.objectContaining({ resource: studyResource }),
      expect.objectContaining({ resource: claimsResource(studyId, secondPartyClaims) }),
    ]);
  });

  it('requires the controller for writes and rejects unknown search claims or route drift', async () => {
    const authHarness = createHarness();
    await expect(authHarness.manager.process(batchJob(professionalDid, [{
      request: { method: 'POST', url: 'ResearchStudy' }, resource: studyResource,
    }]))).rejects.toThrow('controller');

    const claimHarness = createHarness({ initialClaims: studyClaims });
    await expect(claimHarness.manager.process(searchJob({
      'ResearchStudy.not-a-search-claim': ['unsupported'],
    }))).rejects.toThrow('Unsupported ResearchStudy search claim');

    const routeHarness = createHarness({ initialClaims: studyClaims });
    await expect(routeHarness.manager.process({
      ...searchJob({ 'ResearchStudy.status': ['draft'] }), jurisdiction: 'CA-ON',
    } as any)).rejects.toThrow('jurisdiction');
  });
});

function claimsResource(id: string, claims: FlatClaims) {
  return { resourceType: 'ResearchStudy', id, meta: { claims } };
}

function batchJob(issuer: string, data: unknown[]) {
  return {
    ...baseJob(), action: '_batch',
    content: { thid: 'research-study-batch', iss: issuer, aud: 'did:web:example.test:gw', body: { data } },
  } as any;
}

function searchJob(claims: Record<string, readonly string[]>) {
  return {
    ...baseJob(), action: '_search',
    content: {
      thid: 'research-study-search', iss: professionalDid, aud: 'did:web:example.test:gw',
      body: { data: [{ resource: { resourceType: 'Parameters', meta: { claims } } }] },
    },
  } as any;
}

function baseJob() {
  return { tenantId, jurisdiction, sector, section: 'organization', format: 'org.hl7.fhir.r5', resourceType: 'ResearchStudy' };
}

function createHarness(options: {
  initialClaims?: FlatClaims;
  initialPartyClaims?: FlatClaims | readonly FlatClaims[];
  historicalNativeStudy?: any;
} = {}) {
  let primaryRecord: any = options.initialClaims
    ? { id: studyId, sequence: 0, content: { claims: options.initialClaims }, indexed: { attributes: toAttributes(options.initialClaims) } }
    : options.historicalNativeStudy
      ? { id: studyId, sequence: 0, content: options.historicalNativeStudy, indexed: { attributes: toAttributes(studyClaims) } }
      : undefined;
  const partyRecords = new Map<string, any>();
  const initialParties = Array.isArray(options.initialPartyClaims)
    ? options.initialPartyClaims
    : options.initialPartyClaims ? [options.initialPartyClaims] : [];
  for (const claims of initialParties) {
    const partyReference = claims['ResearchStudy.party']?.[0] || '';
    partyRecords.set(buildPartyId(partyReference), {
      id: buildPartyId(partyReference), sequence: 0, content: { claims }, indexed: { attributes: toAttributes(claims) },
    });
  }
  const put = jest.fn(async (_collection: string, records: any[], section: string) => {
    if (section === 'research-studies') primaryRecord = records[0];
    if (section.includes('research-study-associated-parties')) partyRecords.set(records[0].id, records[0]);
    return true;
  });
  const get = jest.fn(async (_collection: string, id: string, section: string) => {
    if (section === 'research-studies' && id === studyId) return primaryRecord;
    if (section.includes('research-study-associated-parties')) return partyRecords.get(id);
    return undefined;
  });
  const listContainersInSection = jest.fn(async (_collection: string, section: string) =>
    section === 'research-studies' && primaryRecord ? [primaryRecord]
      : section.includes('research-study-associated-parties') ? [...partyRecords.values()] : []);
  const deleteRecord = jest.fn(async (_collection?: string, _id?: string, section?: string) => {
    if (section?.includes('research-study-associated-parties')) partyRecords.delete(String(_id));
    else primaryRecord = undefined;
    return true;
  });
  const protectConfidentialData = jest.fn(async (record: any) => record);
  const protectAttributesNameAndValue = jest.fn(async (attributes: any[]) => attributes);
  const unprotectConfidentialData = jest.fn(async (record: any) => record.content);
  return {
    manager: new ResearchStudyManager({
      vaultRepository: { put, get, delete: deleteRecord, listContainersInSection } as any,
      kmsService: { protectConfidentialData, unprotectConfidentialData, protectAttributesNameAndValue } as any,
      tenantManager: {
        tenantExists: jest.fn(async (candidate: string) => candidate === vaultId),
        getCollectionName: jest.fn(async () => collectionName),
        getTenantJurisdiction: jest.fn(async () => jurisdiction),
        getDidDocument: jest.fn(async () => ({ controller: [controllerDid] })),
      },
    }),
    put, protectConfidentialData, protectAttributesNameAndValue, deleteRecord,
    get primaryRecord() { return primaryRecord; },
    partyRecords: () => [...partyRecords.values()],
  };
}

function buildPartyId(partyReference: string): string {
  return buildResearchStudyPartyProjectionId(studyId, partyReference);
}

function toAttributes(claims: FlatClaims) {
  return Object.entries(claims).flatMap(([name, values]) =>
    (values || []).map((value) => ({ name, value, unique: name === 'ResearchStudy.identifier' })));
}
