// Flow contract: authenticated organization workflows store Encounter, ServiceRequest, triage Task, CommunicationRequest and DocumentReference as encrypted flat claims only; public requests retain an explicit dataset routing claim, attachment bytes are never indexed, and native FHIR fields fail before persistence.
import { describe, expect, it, jest } from '@jest/globals';
import {
  CommunicationRequestClaim,
  DocumentReferenceClaim,
  EncounterClaim,
  HealthcareServiceClaim,
  ServiceRequestClaim,
  TaskClaim,
} from 'fhir-data-utils-ts/claims';
import { PublicAlertOperationalClaim } from 'sos-data-utils-ts/public-notifications';
import { CareCoordinationManager, type CareCoordinationResourceType } from '../../../managers/CareCoordinationManager';
import { GATEWAY_PROFILE_TEST_SUBJECTS } from '../../../config/gateway-capability-profile';

describe('CareCoordinationManager', () => {
  it.each([
    ['Encounter', EncounterClaim.Identifier, encounterClaims()],
    ['ServiceRequest', ServiceRequestClaim.Identifier, serviceRequestClaims()],
    ['Task', TaskClaim.Identifier, taskClaims()],
    ['CommunicationRequest', CommunicationRequestClaim.Identifier, communicationRequestClaims()],
    ['DocumentReference', DocumentReferenceClaim.Identifier, documentReferenceClaims()],
    ['HealthcareService', HealthcareServiceClaim.Identifier, healthcareServiceClaims()],
  ] as const)('stores and searches %s through claims-only encrypted persistence', async (resourceType, identifierClaim, claims) => {
    let stored: any;
    const repository = {
      get: jest.fn(async () => undefined),
      put: jest.fn(async (_collection: string, records: any[]) => { stored = records[0]; return true; }),
      listContainersInSection: jest.fn(async () => stored ? [stored] : []),
    } as any;
    const kms = {
      protectAttributesNameAndValue: jest.fn(async (attributes: any[]) => attributes.map(attribute => ({ ...attribute, name: `p:${attribute.name}`, value: `p:${attribute.value}` }))),
      protectConfidentialData: jest.fn(async (document: any) => document),
      unprotectConfidentialData: jest.fn(async (document: any) => document.content),
    } as any;
    const manager = new CareCoordinationManager({
      resourceType: resourceType as CareCoordinationResourceType,
      repository,
      kms,
      tenantManager: tenantManager(),
    });

    const written = await manager.process(job(resourceType, '_batch', resource(resourceType, 'record-one', claims)));
    expect((written.body as any).data[0].response.status).toBe('201');
    expect(kms.protectConfidentialData).toHaveBeenCalledWith(expect.objectContaining({
      content: { claims: expect.objectContaining({ [identifierClaim]: ['urn:uuid:record-one'] }) },
    }), 'animal-care_clinic');
    expect(stored.content).toEqual({ claims: expect.any(Object) });
    expect(stored.content.resource).toBeUndefined();
    expect(stored.indexed.attributes.every((attribute: any) => attribute.name.startsWith('p:') && attribute.value.startsWith('p:'))).toBe(true);

    const searched = await manager.process(job(resourceType, '_search', resource(resourceType, 'search', {
      [identifierClaim]: 'urn:uuid:record-one',
    })));
    expect((searched.body as any).data[0].resource).toEqual({
      resourceType,
      id: 'record-one',
      meta: { claims: expect.objectContaining({
        [identifierClaim]: ['urn:uuid:record-one'],
        [`${resourceType}.meta.versionId`]: [expect.stringMatching(/^z/)],
      }) },
    });
  });

  it('requires the authoritative weak ETag when a triage Task is replaced', async () => {
    let stored: any;
    const repository = {
      get: jest.fn(async () => stored),
      put: jest.fn(async (_collection: string, records: any[]) => { stored = records[0]; return true; }),
      listContainersInSection: jest.fn(async () => stored ? [stored] : []),
    } as any;
    const kms = {
      protectAttributesNameAndValue: jest.fn(async (attributes: any[]) => attributes),
      protectConfidentialData: jest.fn(async (document: any) => document),
      unprotectConfidentialData: jest.fn(async (document: any) => document.content),
    } as any;
    const manager = new CareCoordinationManager({
      resourceType: 'Task', repository, kms, tenantManager: tenantManager(),
    });

    await manager.process(job('Task', '_batch', resource('Task', 'record-one', taskClaims())));
    const currentVersion = stored.content.claims['Task.meta.versionId'][0];
    const acceptedTask = resource('Task', 'record-one', {
      ...taskClaims(),
      [TaskClaim.Status]: 'accepted',
      [TaskClaim.Owner]: 'PractitionerRole/responder-one',
      [TaskClaim.LastModified]: '2026-09-26T18:01:00.000Z',
      'Task.meta.versionId': currentVersion,
    });
    const staleJob = job('Task', '_batch', acceptedTask);
    staleJob.content.body.data[0].request = {
      method: 'PUT', url: 'Task/record-one', ifMatch: 'W/"stale-version"',
    };
    const stale = await manager.process(staleJob);
    expect((stale.body as any).data[0].response.status).toBe('412');
    expect(repository.put).toHaveBeenCalledTimes(1);

    const updateJob = job('Task', '_batch', acceptedTask);
    updateJob.content.body.data[0].request = {
      method: 'PUT', url: 'Task/record-one', ifMatch: `W/"${currentVersion}"`,
    };
    const updated = await manager.process(updateJob);
    expect((updated.body as any).data[0].response).toMatchObject({
      status: '200', etag: expect.stringMatching(/^W\/"z.+"$/),
    });
    expect(stored.content.claims['Task.meta.versionId'][0]).not.toBe(currentVersion);
    expect(repository.put).toHaveBeenCalledTimes(2);
  });

  it('rejects native FHIR state and unknown claims before encryption', async () => {
    const protectConfidentialData = jest.fn();
    const manager = new CareCoordinationManager({
      resourceType: 'Encounter', repository: { put: jest.fn() } as any,
      kms: { protectConfidentialData, protectAttributesNameAndValue: jest.fn() } as any,
      tenantManager: tenantManager(),
    });
    const native = { ...resource('Encounter', 'record-one', encounterClaims()), status: 'in-progress' };
    const nativeResult = await manager.process(job('Encounter', '_batch', native));
    const unknownResult = await manager.process(job('Encounter', '_batch', resource('Encounter', 'record-one', {
      ...encounterClaims(), 'Encounter.private-note': 'not-governed',
    })));
    expect((nativeResult.body as any).data[0].response.status).toBe('400');
    expect((unknownResult.body as any).data[0].response.status).toBe('400');
    expect(protectConfidentialData).not.toHaveBeenCalled();
  });

  it('persists a public dataset CommunicationRequest without indexing its DocumentReference bytes', async () => {
    const stored: any[] = [];
    const repository = {
      get: jest.fn(async () => undefined),
      put: jest.fn(async (_collection: string, records: any[]) => { stored.push(records[0]); return true; }),
      listContainersInSection: jest.fn(async () => []),
    } as any;
    const kms = {
      protectAttributesNameAndValue: jest.fn(async (attributes: any[]) => attributes),
      protectConfidentialData: jest.fn(async (document: any) => document),
      unprotectConfidentialData: jest.fn(async (document: any) => document.content),
    } as any;
    const documentManager = new CareCoordinationManager({ resourceType: 'DocumentReference', repository, kms, tenantManager: tenantManager() });
    const requestManager = new CareCoordinationManager({ resourceType: 'CommunicationRequest', repository, kms, tenantManager: tenantManager() });

    const documentResult = await documentManager.process(job('DocumentReference', '_batch', resource('DocumentReference', 'content-one', documentReferenceClaims())));
    const requestResult = await requestManager.process(job('CommunicationRequest', '_batch', resource('CommunicationRequest', 'request-one', publicCommunicationRequestClaims())));

    expect((documentResult.body as any).data[0].response.status).toBe('201');
    expect((requestResult.body as any).data[0].response.status).toBe('201');
    expect(stored[0].indexed.attributes.map((entry: any) => entry.name)).not.toContain(DocumentReferenceClaim.ContentData);
    expect(stored[1].content.claims[PublicAlertOperationalClaim.DatasetName]).toEqual(['ca-bc_animal-care_public_blood-donation_dog_alert']);
  });
});

function tenantManager() {
  return {
    tenantExists: jest.fn(async () => true),
    getCollectionName: jest.fn(async () => 'tenant-collection'),
    getTenantJurisdiction: jest.fn(async () => 'CA-BC'),
  } as any;
}

function job(resourceType: string, action: '_batch' | '_search', resourceValue: any) {
  return {
    tenantId: 'clinic', jurisdiction: 'CA-BC', sector: 'animal-care', section: 'organization',
    format: 'org.hl7.fhir.r5', action,
    content: { thid: `${resourceType}-${action}`, body: { data: [{ request: { method: 'POST', url: `${resourceType}/${resourceValue.id}` }, resource: resourceValue }] } },
  } as any;
}

function resource(resourceType: string, id: string, claims: Record<string, unknown>) {
  return { resourceType, id, meta: { claims } };
}

function encounterClaims() {
  return {
    [EncounterClaim.Identifier]: 'urn:uuid:record-one', [EncounterClaim.Status]: 'planned',
    [EncounterClaim.Subject]: GATEWAY_PROFILE_TEST_SUBJECTS.veterinary, [EncounterClaim.ServiceProvider]: 'Organization/clinic',
    [EncounterClaim.PeriodStart]: '2026-09-26T18:00:00.000Z', [EncounterClaim.Location]: 'Location/admission',
    [EncounterClaim.Appointment]: 'Appointment/appointment-one',
  };
}

function serviceRequestClaims() {
  return {
    [ServiceRequestClaim.Identifier]: 'urn:uuid:record-one', [ServiceRequestClaim.Status]: 'active',
    [ServiceRequestClaim.Intent]: 'order', [ServiceRequestClaim.Code]: 'http://snomed.info/sct|225358003',
    [ServiceRequestClaim.Subject]: GATEWAY_PROFILE_TEST_SUBJECTS.veterinary, [ServiceRequestClaim.Requester]: 'RelatedPerson/controller-one',
    [ServiceRequestClaim.Performer]: 'HealthcareService/emergency-one', [ServiceRequestClaim.AuthoredOn]: '2026-09-26T18:00:00.000Z',
  };
}

function taskClaims() {
  return {
    [TaskClaim.Identifier]: 'urn:uuid:record-one', [TaskClaim.Status]: 'requested', [TaskClaim.Intent]: 'order',
    [TaskClaim.Code]: 'triage', [TaskClaim.For]: GATEWAY_PROFILE_TEST_SUBJECTS.veterinary, [TaskClaim.Requester]: 'RelatedPerson/controller-one',
    [TaskClaim.Owner]: 'Group/dispatch-one', [TaskClaim.Focus]: 'ServiceRequest/request-one',
    [TaskClaim.AuthoredOn]: '2026-09-26T18:00:00.000Z',
  };
}

function communicationRequestClaims() {
  return {
    [CommunicationRequestClaim.Identifier]: 'urn:uuid:record-one', [CommunicationRequestClaim.Status]: 'active',
    [CommunicationRequestClaim.Intent]: 'order',
    [CommunicationRequestClaim.Category]: 'http://terminology.hl7.org/CodeSystem/communication-category|notification',
    [CommunicationRequestClaim.Subject]: 'Group/cohort-one', [CommunicationRequestClaim.Requester]: 'Organization/blood-bank-one',
    [CommunicationRequestClaim.AuthoredOn]: '2026-09-26T18:00:00.000Z',
    [CommunicationRequestClaim.ReasonReference]: 'ResearchStudy/study-one',
  };
}

function documentReferenceClaims() {
  return {
    [DocumentReferenceClaim.Identifier]: 'urn:uuid:record-one',
    [DocumentReferenceClaim.Subject]: 'Group/public-audience-one',
    [DocumentReferenceClaim.Author]: 'PractitionerRole/publisher-one',
    [DocumentReferenceClaim.ContentType]: 'text/markdown',
    [DocumentReferenceClaim.ContentData]: 'SGVsbG8=',
    [DocumentReferenceClaim.ContentHash]: '185f8db32271fe25f561a6fc938b2e264306ec304eda518007d1764826381969',
  };
}

function publicCommunicationRequestClaims() {
  return {
    [CommunicationRequestClaim.Identifier]: 'urn:uuid:request-one',
    [CommunicationRequestClaim.Status]: 'active', [CommunicationRequestClaim.Intent]: 'order',
    [CommunicationRequestClaim.Category]: 'http://terminology.hl7.org/CodeSystem/communication-category|notification',
    [CommunicationRequestClaim.Subject]: 'Group/public-audience-one',
    [CommunicationRequestClaim.Requester]: 'PractitionerRole/publisher-one',
    [CommunicationRequestClaim.Recipient]: 'Endpoint/public-topic-one',
    [CommunicationRequestClaim.InformationProvider]: 'Organization/clinic',
    [CommunicationRequestClaim.AuthoredOn]: '2026-10-21T18:00:00.000Z',
    [CommunicationRequestClaim.OccurrencePeriodStart]: '2026-10-21T18:00:00.000Z',
    [CommunicationRequestClaim.OccurrencePeriodEnd]: '2026-10-22T18:00:00.000Z',
    [CommunicationRequestClaim.PayloadReference]: 'DocumentReference/content-one',
    [PublicAlertOperationalClaim.DatasetName]: 'ca-bc_animal-care_public_blood-donation_dog_alert',
  };
}

function healthcareServiceClaims() {
  return {
    [HealthcareServiceClaim.Identifier]: 'urn:uuid:record-one',
    [HealthcareServiceClaim.Active]: 'true',
    [HealthcareServiceClaim.Organization]: 'Organization/preventive-care',
    [HealthcareServiceClaim.Name]: 'Vaccination',
    [HealthcareServiceClaim.Location]: 'Location/main-clinic',
  };
}
