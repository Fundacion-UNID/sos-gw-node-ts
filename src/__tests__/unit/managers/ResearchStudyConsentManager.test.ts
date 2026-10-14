// Flow contract: reuse shared test fixtures and canonical types; do not introduce duplicated literals.
import { describe, expect, it, jest } from '@jest/globals';
import { HealthcareConsentPurposes } from 'gdc-common-utils-ts/constants/healthcare';
import { ClaimConsent, ConsentDecisions, ConsentStatuses } from 'gdc-common-utils-ts/models/consent-rule';
import { ClaimsPersonSchemaorg } from 'gdc-common-utils-ts/constants/schemaorg';
import {
  ResearchStudyConsentManager,
  SUBJECT_COMPOSITION_CONTRIBUTION_ACTION,
} from '../../../managers/ResearchStudyConsentManager';
import {
  buildGroupMemberProjectionId,
  buildGroupMemberSectionId,
} from '../../../managers/GroupManager';
import {
  buildResearchStudyPartyProjectionId,
  buildResearchStudyPartySectionId,
} from '../../../managers/ResearchStudyManager';
import {
  RESEARCH_STUDY_ACCESS_FIXTURE as fixture,
  RESEARCH_STUDY_REVIEWER_EMAIL,
  buildOrganizationSubjectRegistrationScope,
  buildResearchStudyAccessClaims,
  buildResearchStudyAccessConsent,
  buildResearchStudyAccessScope,
} from '../../data/research-study-access.data';

describe('ResearchStudyConsentManager', () => {
  it('persists an operations Consent only for the exact governed Group membership and capabilities', async () => {
    const groupId = 'encounter-operations-group';
    const groupReference = `Group/${groupId}`;
    const practitionerRoleReference = `PractitionerRole/${fixture.practitionerRoleId}`;
    const organizationReference = `Organization/${fixture.tenantId}`;
    const consentId = 'encounter-operations-consent';
    const claims = {
      [ClaimConsent.status]: [ConsentStatuses.Active],
      [ClaimConsent.decision]: [ConsentDecisions.Permit],
      [ClaimConsent.purpose]: [HealthcareConsentPurposes.Operations],
      [ClaimConsent.subject]: [organizationReference],
      [ClaimConsent.sourceReference]: [groupReference],
      [ClaimConsent.actorIdentifier]: [practitionerRoleReference],
      [ClaimConsent.actorRole]: ['ISCO-08|2250'],
      [ClaimConsent.action]: ['organization/Encounter.cruds,organization/EncounterHistory.cruds'],
      [ClaimConsent.date]: ['2026-10-05T12:00:00.000Z'],
      [ClaimConsent.grantor]: [organizationReference],
      [ClaimConsent.grantee]: [practitionerRoleReference],
      [ClaimConsent.manager]: [organizationReference],
      [ClaimConsent.controller]: [organizationReference],
      [ClaimConsent.identifier]: [`urn:uuid:${consentId}`],
    };
    const harness = createHarness({ workflowGroupId: groupId });

    const result = await harness.manager.process(buildJob({
      resourceType: 'Consent',
      id: consentId,
      meta: { claims },
    }));

    expect((result.body as any).data[0]).toMatchObject({
      response: { status: '201' },
      resource: { resourceType: 'Consent', id: consentId, meta: { claims } },
    });
    expect((harness.protectConfidentialData.mock.calls.at(-1)?.[0] as any).content).toEqual({ claims });
    expect(harness.put).toHaveBeenCalledWith(
      fixture.collectionName,
      [expect.objectContaining({ jwe: expect.any(Object) })],
      'organization-workflow-consents',
    );
  });

  it('persists Subject clinical contribution without granting clinical read or organization Composition authority', async () => {
    const clinicalContributionGroupId = 'clinical-contribution-group';
    const clinicalContributionGroupReference = `Group/${clinicalContributionGroupId}`;
    const practitionerRoleReference = `PractitionerRole/${fixture.practitionerRoleId}`;
    const organizationReference = `Organization/${fixture.tenantId}`;
    const clinicalContributionConsentId = 'clinical-contribution-consent';
    const subjectCompositionContribution = SUBJECT_COMPOSITION_CONTRIBUTION_ACTION;
    expect(subjectCompositionContribution).toBe('Subject/Composition.cuds');
    expect(subjectCompositionContribution).not.toContain('.r');
    expect(subjectCompositionContribution).not.toContain('organization/Composition');
    const claims = {
      [ClaimConsent.status]: [ConsentStatuses.Active],
      [ClaimConsent.decision]: [ConsentDecisions.Permit],
      [ClaimConsent.purpose]: [HealthcareConsentPurposes.Operations],
      [ClaimConsent.subject]: [organizationReference],
      [ClaimConsent.sourceReference]: [clinicalContributionGroupReference],
      [ClaimConsent.actorIdentifier]: [practitionerRoleReference],
      [ClaimConsent.actorRole]: ['ISCO-08|3240'],
      [ClaimConsent.action]: [subjectCompositionContribution],
      [ClaimConsent.date]: ['2026-10-05T12:00:00.000Z'],
      [ClaimConsent.grantor]: [organizationReference],
      [ClaimConsent.grantee]: [practitionerRoleReference],
      [ClaimConsent.manager]: [organizationReference],
      [ClaimConsent.controller]: [organizationReference],
      [ClaimConsent.identifier]: [`urn:uuid:${clinicalContributionConsentId}`],
    };
    const harness = createHarness({
      workflowGroupId: clinicalContributionGroupId,
      professionalRole: 'ISCO-08|3240',
    });

    const result = await harness.manager.process(buildJob({
      resourceType: 'Consent',
      id: clinicalContributionConsentId,
      meta: { claims },
    }));

    expect((result.body as any).data[0]).toMatchObject({
      response: { status: '201' },
      resource: { resourceType: 'Consent', id: clinicalContributionConsentId, meta: { claims } },
    });
    expect((harness.protectConfidentialData.mock.calls.at(-1)?.[0] as any).content).toEqual({ claims });
  });

  it('persists subject registration only when the capability is filtered to the routed organization', async () => {
    const groupId = 'subject-registration-group';
    const groupReference = `Group/${groupId}`;
    const practitionerRoleReference = `PractitionerRole/${fixture.practitionerRoleId}`;
    const organizationReference = `Organization/${fixture.tenantId}`;
    const consentId = 'subject-registration-consent';
    const subjectRegistrationCapability = buildOrganizationSubjectRegistrationScope(organizationReference);
    const claims = {
      [ClaimConsent.status]: [ConsentStatuses.Active],
      [ClaimConsent.decision]: [ConsentDecisions.Permit],
      [ClaimConsent.purpose]: [HealthcareConsentPurposes.Operations],
      [ClaimConsent.subject]: [organizationReference],
      [ClaimConsent.sourceReference]: [groupReference],
      [ClaimConsent.actorIdentifier]: [practitionerRoleReference],
      [ClaimConsent.actorRole]: ['ISCO-08|2250'],
      [ClaimConsent.action]: [subjectRegistrationCapability],
      [ClaimConsent.date]: ['2026-10-05T12:00:00.000Z'],
      [ClaimConsent.grantor]: [organizationReference],
      [ClaimConsent.grantee]: [practitionerRoleReference],
      [ClaimConsent.manager]: [organizationReference],
      [ClaimConsent.controller]: [organizationReference],
      [ClaimConsent.identifier]: [`urn:uuid:${consentId}`],
    };
    const harness = createHarness({ workflowGroupId: groupId });

    const result = await harness.manager.process(buildJob({
      resourceType: 'Consent',
      id: consentId,
      meta: { claims },
    }));

    expect((result.body as any).data[0].response.status).toBe('201');
    expect(subjectRegistrationCapability).not.toContain('Group.u');
    expect(subjectRegistrationCapability).not.toContain('.r');
  });

  it.each([
    ['missing group', { workflowGroupPresent: false }, {}, '403'],
    ['missing exact member', { workflowMemberPresent: false }, {}, '403'],
    ['unsupported capability', {}, {
      [ClaimConsent.action]: ['organization/Encounter.cruds,organization/Patient.cruds'],
    }, '400'],
    ['unfiltered subject registration', {}, {
      [ClaimConsent.action]: ['organization/Subject.c'],
    }, '400'],
    ['subject registration for another organization', {}, {
      [ClaimConsent.action]: [buildOrganizationSubjectRegistrationScope('Organization/another-clinic')],
    }, '400'],
    ['different organization', {}, {
      [ClaimConsent.subject]: ['Organization/another-clinic'],
    }, '403'],
  ])('rejects workflow Consent with %s', async (_name, harnessOptions, overrides, status) => {
    const groupId = 'encounter-operations-group';
    const organizationReference = `Organization/${fixture.tenantId}`;
    const practitionerRoleReference = `PractitionerRole/${fixture.practitionerRoleId}`;
    const consentId = 'rejected-workflow-consent';
    const claims = {
      [ClaimConsent.status]: [ConsentStatuses.Active],
      [ClaimConsent.decision]: [ConsentDecisions.Permit],
      [ClaimConsent.purpose]: [HealthcareConsentPurposes.Operations],
      [ClaimConsent.subject]: [organizationReference],
      [ClaimConsent.sourceReference]: [`Group/${groupId}`],
      [ClaimConsent.actorIdentifier]: [practitionerRoleReference],
      [ClaimConsent.actorRole]: ['ISCO-08|2250'],
      [ClaimConsent.action]: ['organization/Encounter.cruds,organization/EncounterHistory.cruds'],
      [ClaimConsent.date]: ['2026-10-05T12:00:00.000Z'],
      [ClaimConsent.grantor]: [organizationReference],
      [ClaimConsent.grantee]: [practitionerRoleReference],
      [ClaimConsent.manager]: [organizationReference],
      [ClaimConsent.controller]: [organizationReference],
      [ClaimConsent.identifier]: [`urn:uuid:${consentId}`],
      ...overrides,
    };
    const harness = createHarness({ workflowGroupId: groupId, ...harnessOptions });

    const result = await harness.manager.process(buildJob({
      resourceType: 'Consent', id: consentId, meta: { claims },
    }));

    expect((result.body as any).data[0].response.status).toBe(status);
    expect(harness.put).not.toHaveBeenCalled();
  });

  it('revokes and searches an organization workflow Consent in its own claims-first section', async () => {
    const groupId = 'scheduling-operations-group';
    const practitionerRoleReference = `PractitionerRole/${fixture.practitionerRoleId}`;
    const organizationReference = `Organization/${fixture.tenantId}`;
    const consentId = 'scheduling-operations-consent';
    const activeClaims = {
      [ClaimConsent.status]: [ConsentStatuses.Active],
      [ClaimConsent.decision]: [ConsentDecisions.Permit],
      [ClaimConsent.purpose]: [HealthcareConsentPurposes.Operations],
      [ClaimConsent.subject]: [organizationReference],
      [ClaimConsent.sourceReference]: [`Group/${groupId}`],
      [ClaimConsent.actorIdentifier]: [practitionerRoleReference],
      [ClaimConsent.actorRole]: ['ISCO-08|2250'],
      [ClaimConsent.action]: ['organization/Appointment.cruds,organization/Schedule.cruds,organization/Slot.cruds'],
      [ClaimConsent.date]: ['2026-10-05T12:00:00.000Z'],
      [ClaimConsent.grantor]: [organizationReference],
      [ClaimConsent.grantee]: [practitionerRoleReference],
      [ClaimConsent.manager]: [organizationReference],
      [ClaimConsent.controller]: [organizationReference],
      [ClaimConsent.identifier]: [`urn:uuid:${consentId}`],
    };
    const harness = createHarness({ workflowGroupId: groupId });
    await harness.manager.process(buildJob({ resourceType: 'Consent', id: consentId, meta: { claims: activeClaims } }));

    const revoked = await harness.manager.process({
      ...buildJob({}),
      content: {
        ...buildJob({}).content,
        body: { data: [{
          request: { method: 'PATCH', url: `Consent/${consentId}` },
          resource: {
            resourceType: 'Consent', id: consentId,
            meta: { claims: { [ClaimConsent.status]: ConsentStatuses.Inactive } },
          },
        }] },
      },
    } as any);
    expect((revoked.body as any).data[0].response.status).toBe('200');

    const searched = await harness.manager.process(searchJob({
      [ClaimConsent.sourceReference]: [`Group/${groupId}`],
    }));
    expect((searched.body as any).data).toHaveLength(1);
    expect((searched.body as any).data[0].resource.meta.claims[ClaimConsent.status]).toEqual([ConsentStatuses.Inactive]);
  });

  it('persists a controller-approved active Consent only after the associated PractitionerRole completed DCR', async () => {
    const harness = createHarness();
    const sdkScalarConsent = {
      ...buildResearchStudyAccessConsent(),
      meta: { claims: Object.fromEntries(Object.entries(buildResearchStudyAccessClaims())
        .map(([name, values]) => [name, values[0]])) },
    };

    const result = await harness.manager.process(buildJob(sdkScalarConsent));

    expect((result.body as any).data[0]).toMatchObject({
      response: { status: '201' },
      resource: buildResearchStudyAccessConsent(),
    });
    const confidentialInput = harness.protectConfidentialData.mock.calls[0]?.[0] as any;
    expect(confidentialInput.content).toEqual({ claims: buildResearchStudyAccessClaims() });
    expect(confidentialInput.indexed.attributes).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: ClaimConsent.sourceReference }),
      expect.objectContaining({ name: ClaimConsent.actorIdentifier }),
    ]));
    expect(harness.protectAttributesNameAndValue.mock.invocationCallOrder[0])
      .toBeLessThan(harness.protectConfidentialData.mock.invocationCallOrder[0]);
    expect(harness.put).toHaveBeenCalledWith(
      fixture.collectionName,
      [expect.objectContaining({ jwe: expect.any(Object) })],
      'research-study-consents',
    );
    expect(harness.unprotectConfidentialData).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'protected-professional-license', jwe: expect.any(Object) }),
      fixture.vaultId,
    );
  });

  it.each([
    ['draft', buildResearchStudyAccessConsent({ [ClaimConsent.status]: ConsentStatuses.Draft })],
    ['delete', buildResearchStudyAccessConsent({ [ClaimConsent.action]: buildResearchStudyAccessScope(fixture.studyId, 'cruds') })],
    ['wrong study', buildResearchStudyAccessConsent({ [ClaimConsent.sourceReference]: 'ResearchStudy/another-study' })],
  ])('rejects %s instead of creating authorization', async (_caseName, consent) => {
    const harness = createHarness();
    const result = await harness.manager.process(buildJob(consent));

    expect((result.body as any).data[0].response.status).toBe('400');
    expect(harness.put).not.toHaveBeenCalled();
  });

  it('rejects a native status before indexing or encryption', async () => {
    const harness = createHarness();
    const result = await harness.manager.process(buildJob({
      ...buildResearchStudyAccessConsent(), status: ConsentStatuses.Active,
    }));
    expect((result.body as any).data[0].response.status).toBe('400');
    expect(harness.protectAttributesNameAndValue).not.toHaveBeenCalled();
    expect(harness.protectConfidentialData).not.toHaveBeenCalled();
  });

  it('rejects a party that has no DCR-bound clinical creator assignment', async () => {
    const harness = createHarness({ dcrComplete: false });
    const result = await harness.manager.process(buildJob(buildResearchStudyAccessConsent()));

    expect((result.body as any).data[0].response.status).toBe('403');
    expect(harness.put).not.toHaveBeenCalled();
  });

  it.each([
    ['different role', { bindingRole: 'ISCO-08|2211' }],
    ['missing licence', { activeLicense: false }],
    ['inactive employee', { activeEmployee: false }],
  ])('rejects a DCR binding with %s', async (_caseName, options) => {
    const harness = createHarness(options);
    const result = await harness.manager.process(buildJob(buildResearchStudyAccessConsent()));
    expect((result.body as any).data[0].response.status).toBe('403');
    expect(harness.put).not.toHaveBeenCalled();
  });

  it('rejects Consent when the exact study-scoped PractitionerRole party projection is absent', async () => {
    const harness = createHarness({ associatedParty: false });
    const result = await harness.manager.process(buildJob(buildResearchStudyAccessConsent()));

    expect((result.body as any).data[0].response.status).toBe('403');
    expect(harness.put).not.toHaveBeenCalled();
  });

  it('makes active Consent creation idempotent, revokes it explicitly, and returns the claims-first inactive record from search', async () => {
    const activeClaims = buildResearchStudyAccessClaims();
    const harness = createHarness({ initialConsentClaims: activeClaims });
    const replay = await harness.manager.process(buildJob(buildResearchStudyAccessConsent()));
    expect((replay.body as any).data[0].response.status).toBe('200');
    expect(harness.put).not.toHaveBeenCalled();

    const divergent = await harness.manager.process(buildJob(buildResearchStudyAccessConsent({
      [ClaimConsent.date]: '2026-09-07',
    })));
    expect((divergent.body as any).data[0].response.status).toBe('409');
    expect(harness.put).not.toHaveBeenCalled();

    const revoked = await harness.manager.process({
      ...buildJob(buildResearchStudyAccessConsent()),
      content: {
        ...buildJob(buildResearchStudyAccessConsent()).content,
        body: { data: [{
          request: { method: 'PATCH', url: `Consent/${fixture.consentId}` },
          resource: {
            resourceType: 'Consent', id: fixture.consentId,
            meta: { claims: { [ClaimConsent.status]: ConsentStatuses.Inactive } },
          },
        }] },
      },
    } as any);
    expect((revoked.body as any).data[0]).toMatchObject({
      response: { status: '200' },
      resource: { meta: { claims: { ...activeClaims, [ClaimConsent.status]: [ConsentStatuses.Inactive] } } },
    });
    expect((harness.protectConfidentialData.mock.calls.at(-1)?.[0] as any)).toMatchObject({
      sequence: 1,
      content: { claims: { ...activeClaims, [ClaimConsent.status]: [ConsentStatuses.Inactive] } },
    });

    const searched = await harness.manager.process(searchJob({
      [ClaimConsent.sourceReference]: [`ResearchStudy/${fixture.studyId}`],
    }));
    expect((searched.body as any).data[0].resource).toMatchObject({
      resourceType: 'Consent', id: fixture.consentId,
      meta: { claims: { [ClaimConsent.status]: [ConsentStatuses.Inactive] } },
    });
  });

  it('rejects a non-controller and a mismatched route jurisdiction before persistence', async () => {
    const nonController = createHarness();
    await expect(nonController.manager.process(buildJob(
      buildResearchStudyAccessConsent(),
      { issuer: fixture.professionalDid },
    ))).rejects.toThrow('controller');

    const wrongJurisdiction = createHarness();
    await expect(wrongJurisdiction.manager.process(buildJob(
      buildResearchStudyAccessConsent(),
      { jurisdiction: 'CA-ON' },
    ))).rejects.toThrow('jurisdiction');
    expect(nonController.put).not.toHaveBeenCalled();
    expect(wrongJurisdiction.put).not.toHaveBeenCalled();
  });
});

function buildJob(
  consent: Record<string, unknown>,
  overrides: { issuer?: string; jurisdiction?: string } = {},
) {
  return {
    tenantId: fixture.tenantId,
    sector: fixture.sector,
    jurisdiction: overrides.jurisdiction || fixture.jurisdiction,
    section: 'organization',
    format: 'org.hl7.fhir.r5',
    resourceType: 'Consent',
    action: '_batch',
    content: {
      thid: 'research-study-consent-batch',
      iss: overrides.issuer || fixture.controllerDid,
      aud: 'did:web:example.test:gw',
      body: { data: [{ request: { method: 'POST', url: 'Consent' }, resource: consent }] },
    },
  } as any;
}

function searchJob(claims: Record<string, readonly string[]>) {
  return {
    ...buildJob(buildResearchStudyAccessConsent()),
    action: '_search',
    content: {
      ...buildJob(buildResearchStudyAccessConsent()).content,
      body: { data: [{ resource: { resourceType: 'Parameters', meta: { claims } } }] },
    },
  } as any;
}

function createHarness(options: {
  dcrComplete?: boolean;
  associatedParty?: boolean;
  bindingRole?: string;
  professionalRole?: string;
  activeLicense?: boolean;
  activeEmployee?: boolean;
  initialConsentClaims?: Record<string, readonly string[]>;
  workflowGroupId?: string;
  workflowGroupPresent?: boolean;
  workflowMemberPresent?: boolean;
} = {}) {
  const dcrComplete = options.dcrComplete !== false;
  const professionalRole = options.professionalRole || 'ISCO-08|2250';
  const professionalDid = fixture.professionalDid.replace(
    /ISCO-08%7C2250$/,
    encodeURIComponent(professionalRole),
  );
  const practitionerRoleReference = `PractitionerRole/${fixture.practitionerRoleId}`;
  const study = { claims: { 'ResearchStudy.status': ['draft'] } };
  const party = { claims: {
    'ResearchStudy.party-role': ['http://hl7.org/fhir/research-study-party-role|sub-investigator'],
    'ResearchStudy.party': [practitionerRoleReference],
  } };
  const binding = {
    id: `urn:uuid:${fixture.practitionerRoleId}`,
    kind: 'professional',
    actorIdentifier: 'urn:uuid:bdb8c91f-5597-46a9-813e-a9242f938c31',
    authorIdentifier: `urn:uuid:${fixture.practitionerRoleId}`,
    ownerIdentifier: fixture.tenantId,
    role: options.bindingRole || professionalRole,
    actorDids: [professionalDid],
    dcrClientIds: dcrComplete ? [fixture.clientId] : [],
  };
  let consentRecord: any = options.initialConsentClaims
    ? { id: fixture.consentId, sequence: 0, content: { claims: options.initialConsentClaims }, indexed: { attributes: [] } }
    : undefined;
  let workflowConsentRecord: any;
  const encryptedContents = new Map<string, unknown>();
  const put = jest.fn(async (_collection: string, records: any[], section: string) => {
    if (section === 'research-study-consents') consentRecord = records[0];
    if (section === 'organization-workflow-consents') workflowConsentRecord = records[0];
    return true;
  });
  const get = jest.fn(async (_collection: string, id: string, section: string) => {
    if (section === 'research-studies' && id === fixture.studyId) return { id, content: study };
    if (section === 'research-study-consents' && id === fixture.consentId) return consentRecord;
    if (section === 'organization-workflow-consents' && id === workflowConsentRecord?.id) return workflowConsentRecord;
    if (options.associatedParty !== false
      && section === buildResearchStudyPartySectionId(fixture.studyId)
      && id === buildResearchStudyPartyProjectionId(fixture.studyId, practitionerRoleReference)) {
      return { id, content: party };
    }
    if (options.workflowGroupId && options.workflowGroupPresent !== false
      && section === 'research-groups' && id === options.workflowGroupId) {
      return { id, content: { claims: {
        'Group.type': ['practitioner'],
        'Group.membership': ['enumerated'],
        'Group.managing-entity': [`Organization/${fixture.tenantId}`],
      } } };
    }
    if (options.workflowGroupId && options.workflowMemberPresent !== false
      && section === buildGroupMemberSectionId(options.workflowGroupId)
      && id === buildGroupMemberProjectionId(options.workflowGroupId, practitionerRoleReference)) {
      return { id, content: { claims: {
        'Group.type': ['practitioner'],
        'Group.membership': ['enumerated'],
        'Group.member': [practitionerRoleReference],
      } } };
    }
    return undefined;
  });
  const listContainersInSection = jest.fn(async (_collection: string, section: string) => {
    if (section.includes('clinical_author_identity_bindings')) return [binding];
    if (section === 'research-study-consents' && consentRecord) return [consentRecord];
    if (section === 'organization-workflow-consents' && workflowConsentRecord) return [workflowConsentRecord];
    return [];
  });
  const getContainersInSection = jest.fn(async (_collection: string, section: string) => {
    if (section.includes('employees')) return [{ content: { employee: true } }];
    if (section.includes('device-licenses') && options.activeLicense !== false) return [{
      id: 'protected-professional-license',
      jwe: { ciphertext: 'protected-license' },
    }];
    return [];
  });
  const protectConfidentialData = jest.fn(async (record: any) => {
    encryptedContents.set(record.id, record.content);
    return { ...record, content: undefined, jwe: { ciphertext: 'encrypted' } };
  });
  const protectAttributesNameAndValue = jest.fn(async (attributes: any[]) => attributes);
  const unprotectConfidentialData = jest.fn(async (record: any, _tenantVaultId?: string) => record.content);
  unprotectConfidentialData.mockImplementation(async (record: any, _tenantVaultId?: string) => {
    if (encryptedContents.has(record.id)) return encryptedContents.get(record.id);
    if (record.content?.employee) return {
        status: options.activeEmployee === false ? 'inactive' : 'active',
        claims: {
          [ClaimsPersonSchemaorg.email]: RESEARCH_STUDY_REVIEWER_EMAIL,
          [ClaimsPersonSchemaorg.hasOccupation]: professionalRole,
        },
      };
    if (record.jwe?.ciphertext === 'protected-license') return {
      status: 'active',
      issuedToEmail: RESEARCH_STUDY_REVIEWER_EMAIL,
      issuedToRole: professionalRole,
      activatedBy: professionalDid.split(':employee:')[1].split(':')[0].replace(/^/, 'urn:multibase:'),
    };
    return record.content;
  });
  const tenantManager = {
    tenantExists: jest.fn(async (candidate: string) => candidate === fixture.vaultId),
    getCollectionName: jest.fn(async () => fixture.collectionName),
    getTenantJurisdiction: jest.fn(async () => fixture.jurisdiction),
    getDidDocument: jest.fn(async () => ({ id: 'did:web:example.test:tenant', controller: [fixture.controllerDid] })),
  };
  return {
    manager: new ResearchStudyConsentManager({
      vaultRepository: { get, put, listContainersInSection, getContainersInSection } as any,
      kmsService: { protectConfidentialData, unprotectConfidentialData, protectAttributesNameAndValue } as any,
      tenantManager,
    }),
    put, protectConfidentialData, protectAttributesNameAndValue, unprotectConfidentialData,
  };
}
