// Copyright 2026 Connecting Solution & Applications Ltd under the Apache License, Version 2.0.
// Flow contract: reuse shared test fixtures and canonical types; do not introduce duplicated literals.
import { resolveHostPhysicalCollectionName } from '../../config/storage-layout';
/**
 * 1. A current controller creates a ResearchStudy and associates one PractitionerRole.
 * 2. The role's existing protected creator assignment records completed DCR.
 * 3. The controller explicitly submits an active R5 Consent with ResearchSubject crus scope.
 * 4. The same controller grants exact Encounter workflow, public
 *    CommunicationRequest creation and no-read Subject Composition contribution
 *    capabilities only after the employee PractitionerRole is in each
 *    referenced operational Group.
 * 5. The controller grants organization-filtered subject registration without Group mutation or clinical read.
 * 6. A repeated research activation is idempotent; the controller can then revoke it.
 * 7. Consent search returns the inactive claims-only record through the same
 *    asynchronous HTTP queue and worker boundary.
 *
 * Authorization invariant: Communication drafts, Group membership and associatedParty alone never grant access.
 * Persistence invariant: only the explicit active Consent is stored in the isolated tenant collection.
 */
import { afterEach, expect, it } from '@jest/globals';
import {
  ClaimsOrganizationSchemaorg,
  ClaimsPersonSchemaorg,
  ClaimsServiceSchemaorg,
} from 'gdc-common-utils-ts/constants/schemaorg';
import { HealthcareConsentPurposes } from 'gdc-common-utils-ts/constants/healthcare';
import { buildStableActorIdentifier } from 'gdc-common-utils-ts/utils/actor-identifier';
import { ClaimConsent, ConsentDecisions, ConsentStatuses } from 'gdc-common-utils-ts/models/consent-rule';
import type { Sector } from 'gdc-common-utils-ts/models/urlPath';
import { projectResearchStudyR5SearchClaims } from 'vet-data-utils-ts';
import { buildVeterinaryResearchStudyActiveConsentBatch } from 'vet-sdk-core-ts/research-study';
import { OrganizationWorkflowCapabilities } from 'sos-data-utils-ts/organization-workflow-access';
import {
  buildResearchStudyPartyProjectionId,
  buildResearchStudyPartySectionId,
} from '../../managers/ResearchStudyManager';
import { buildGroupMemberProjectionId, buildGroupMemberSectionId } from '../../managers/GroupManager';
import { SUBJECT_COMPOSITION_CONTRIBUTION_ACTION } from '../../managers/ResearchStudyConsentManager';
import { resetServerConfig, startServer } from '../../server';
import { getClinicalCreatorBindingsSectionId } from '../../utils/clinical-creator-binding';
import { getEnvSectionId } from '../../utils/section-env';
import { generateTenantCollectionNameFromClaims, getTenantVaultId } from '../../utils/tenant';
import { initializeTenantServicesConfig } from '../../utils/services';
import { testPayloadCreateTenant1 } from '../data/end-to-end.data';
import {
  RESEARCH_STUDY_ACCESS_FIXTURE as fixture,
  RESEARCH_STUDY_REVIEWER_EMAIL,
  buildOrganizationSubjectRegistrationScope,
} from '../data/research-study-access.data';
import { configureAuthenticatedTestActor } from './helpers/authenticated-test-actor';
import { invokeExpress } from './helpers/invokeExpress';

afterEach(() => resetServerConfig());

it('activates one study-scoped Consent through the real HTTP queue and worker boundary', async () => {
  configureEnvironment();
  const authenticatedActor = await configureAuthenticatedTestActor();
  resetServerConfig();
  const { app, queueAdapter, tenantManager, vaultRepository, kmsService } = await startServer({ listen: false });
  try {
    const hostClaims = {
      [ClaimsOrganizationSchemaorg.addressCountry]: process.env.ORG_HOST_JURISDICTION,
      [ClaimsOrganizationSchemaorg.identifierType]: process.env.ORG_HOST_ID_TYPE,
      [ClaimsOrganizationSchemaorg.identifierValue]: process.env.ORG_HOST_ID_VALUE,
      [ClaimsServiceSchemaorg.category]: 'system',
    };
    const tenantClaims = {
      ...(testPayloadCreateTenant1.body.data[0].resource.meta.claims as any),
      [ClaimsOrganizationSchemaorg.alternateName]: fixture.tenantId,
      [ClaimsOrganizationSchemaorg.addressCountry]: 'CA',
      [ClaimsOrganizationSchemaorg.addressRegion]: fixture.jurisdiction,
      [ClaimsServiceSchemaorg.category]: fixture.sector,
    };
    const vaultId = getTenantVaultId(fixture.sector, fixture.tenantId);
    await kmsService.provisionKeys(vaultId);
    const secureTenant = await kmsService.protectConfidentialData({
      id: vaultId,
      status: 'active',
      sequence: 0,
      content: {
        claims: tenantClaims,
        didConfig: { service: initializeTenantServicesConfig(fixture.sector as Sector) },
        didDocument: {
          '@context': 'https://www.w3.org/ns/did/v1',
          id: 'did:web:tenant.integration.example',
          controller: [authenticatedActor.actorDid],
        },
      },
    } as any, 'host');
    await vaultRepository.put(
      resolveHostPhysicalCollectionName(),
      [secureTenant as any],
      getEnvSectionId('tenants'),
    );
    await tenantManager.getTenant(vaultId);

    const practitionerRoleReference = `PractitionerRole/${fixture.practitionerRoleId}`;
    const study = {
      resourceType: 'ResearchStudy', id: fixture.studyId, status: 'draft', title: 'Study access integration',
    };
    const studyClaims = projectResearchStudyR5SearchClaims(study);
    const physicalCollection = generateTenantCollectionNameFromClaims(tenantClaims);
    const protectedStudyAttributes = await kmsService.protectAttributesNameAndValue(
      Object.entries(studyClaims).flatMap(([name, values]) =>
        (values || []).map(value => ({ name, value }))) as any,
      vaultId,
    );
    const studyDocument = await kmsService.protectConfidentialData({
      id: fixture.studyId, status: 'active', sequence: 0, content: { claims: studyClaims },
      indexed: { attributes: protectedStudyAttributes },
    } as any, vaultId);
    await vaultRepository.put(physicalCollection, [studyDocument as any], 'research-studies');
    const partyClaims = {
      'ResearchStudy.party-role': ['http://hl7.org/fhir/research-study-party-role|sub-investigator'],
      'ResearchStudy.party': [practitionerRoleReference],
    };
    const partyDocument = await kmsService.protectConfidentialData({
      id: buildResearchStudyPartyProjectionId(fixture.studyId, practitionerRoleReference),
      status: 'active', sequence: 0, content: { claims: partyClaims }, indexed: { attributes: [] },
    } as any, vaultId);
    await vaultRepository.put(
      physicalCollection,
      [partyDocument as any],
      buildResearchStudyPartySectionId(fixture.studyId),
    );
    await vaultRepository.put(vaultId, [{
      id: `urn:uuid:${fixture.practitionerRoleId}`,
      kind: 'professional',
      actorIdentifier: 'urn:uuid:bdb8c91f-5597-46a9-813e-a9242f938c31',
      authorIdentifier: `urn:uuid:${fixture.practitionerRoleId}`,
      ownerIdentifier: fixture.tenantId,
      role: 'ISCO-08|2250',
      actorDids: [fixture.professionalDid],
      dcrClientIds: [fixture.clientId],
    } as any], getClinicalCreatorBindingsSectionId());
    const employeeDocument = await kmsService.protectConfidentialData({
      id: 'research-reviewer-employee', status: 'active', sequence: 0,
      content: {
        status: 'active',
        claims: {
          [ClaimsPersonSchemaorg.email]: RESEARCH_STUDY_REVIEWER_EMAIL,
          [ClaimsPersonSchemaorg.hasOccupation]: 'ISCO-08|2250',
        },
      },
    } as any, vaultId);
    await vaultRepository.put(physicalCollection, [employeeDocument as any], getEnvSectionId('employees'));
    const licenseDocument = await kmsService.protectConfidentialData({
      id: 'research-reviewer-license',
      status: 'active',
      sequence: 0,
      content: {
        status: 'active',
        issuedToEmail: RESEARCH_STUDY_REVIEWER_EMAIL,
        issuedToRole: 'ISCO-08|2250',
        activatedBy: buildStableActorIdentifier({ contactKind: 'email', contact: RESEARCH_STUDY_REVIEWER_EMAIL }),
      },
    } as any, vaultId);
    await vaultRepository.put(vaultId, [licenseDocument as any], getEnvSectionId('device-licenses'));

    const sdkBatch = buildVeterinaryResearchStudyActiveConsentBatch([{
      consentId: fixture.consentId,
      researchStudyId: fixture.studyId,
      practitionerRoleId: fixture.practitionerRoleId,
      actorRole: 'ISCO-08|2250',
      date: '2026-09-06',
    }]);
    const sdkClaims = sdkBatch.data[0].resource.meta.claims;
    expect(Object.values(sdkClaims).every((value) => typeof value === 'string')).toBe(true);
    const canonicalClaims = Object.fromEntries(Object.entries(sdkClaims)
      .filter(([name]) => name !== '@context')
      .map(([name, value]) => [name, [value]]));

    const payload = await submitAndPoll(app, authenticatedActor.authorizationHeader, authenticatedActor.actorDid, '_batch', sdkBatch.data, 'activate');
    expect(payload.data[0]).toMatchObject({
      response: { status: '201' },
      resource: { resourceType: 'Consent', id: fixture.consentId, meta: { claims: canonicalClaims } },
    });
    const stored = await vaultRepository.listContainersInSection<any>(physicalCollection, 'research-study-consents');
    expect(stored).toHaveLength(1);
    expect(stored[0].jwe).toBeDefined();
    expect(stored[0].content).toBeUndefined();
    await expect(kmsService.unprotectConfidentialData(stored[0], vaultId))
      .resolves.toEqual({ claims: canonicalClaims });
    expect(JSON.stringify(stored[0].indexed)).not.toContain(fixture.practitionerRoleId);

    const replay = await submitAndPoll(app, authenticatedActor.authorizationHeader, authenticatedActor.actorDid, '_batch', sdkBatch.data, 'replay');
    expect(replay.data[0].response.status).toBe('200');

    const workflowGroupId = 'encounter-operations-group';
    const workflowGroupReference = `Group/${workflowGroupId}`;
    const organizationReference = `Organization/${fixture.tenantId}`;
    const workflowGroupClaims = {
      'Group.type': ['practitioner'],
      'Group.membership': ['enumerated'],
      'Group.managing-entity': [organizationReference],
    };
    const workflowMemberClaims = {
      'Group.type': ['practitioner'],
      'Group.membership': ['enumerated'],
      'Group.member': [practitionerRoleReference],
    };
    const workflowGroupDocument = await kmsService.protectConfidentialData({
      id: workflowGroupId, status: 'active', sequence: 0,
      content: { claims: workflowGroupClaims }, indexed: { attributes: [] },
    } as any, vaultId);
    await vaultRepository.put(physicalCollection, [workflowGroupDocument as any], 'research-groups');
    const workflowMemberDocument = await kmsService.protectConfidentialData({
      id: buildGroupMemberProjectionId(workflowGroupId, practitionerRoleReference),
      status: 'active', sequence: 0,
      content: { claims: workflowMemberClaims }, indexed: { attributes: [] },
    } as any, vaultId);
    await vaultRepository.put(
      physicalCollection,
      [workflowMemberDocument as any],
      buildGroupMemberSectionId(workflowGroupId),
    );
    const workflowConsentId = 'encounter-operations-consent';
    const workflowClaims = {
      [ClaimConsent.status]: ConsentStatuses.Active,
      [ClaimConsent.decision]: ConsentDecisions.Permit,
      [ClaimConsent.purpose]: HealthcareConsentPurposes.Operations,
      [ClaimConsent.subject]: organizationReference,
      [ClaimConsent.sourceReference]: workflowGroupReference,
      [ClaimConsent.actorIdentifier]: practitionerRoleReference,
      [ClaimConsent.actorRole]: 'ISCO-08|2250',
      [ClaimConsent.action]: 'organization/Encounter.cruds,organization/EncounterHistory.cruds',
      [ClaimConsent.date]: '2026-10-05T12:00:00.000Z',
      [ClaimConsent.grantor]: organizationReference,
      [ClaimConsent.grantee]: practitionerRoleReference,
      [ClaimConsent.manager]: organizationReference,
      [ClaimConsent.controller]: organizationReference,
      [ClaimConsent.identifier]: `urn:uuid:${workflowConsentId}`,
    };
    const workflowAuthorized = await submitAndPoll(
      app,
      authenticatedActor.authorizationHeader,
      authenticatedActor.actorDid,
      '_batch',
      [{
        request: { method: 'POST', url: 'Consent' },
        resource: { resourceType: 'Consent', id: workflowConsentId, meta: { claims: workflowClaims } },
      }],
      'workflow-activate',
    );
    expect(workflowAuthorized.data[0]).toMatchObject({
      response: { status: '201' },
      resource: { resourceType: 'Consent', id: workflowConsentId },
    });
    const storedWorkflowConsents = await vaultRepository.listContainersInSection<any>(
      physicalCollection,
      'organization-workflow-consents',
    );
    expect(storedWorkflowConsents).toHaveLength(1);
    await expect(kmsService.unprotectConfidentialData(storedWorkflowConsents[0], vaultId)).resolves.toEqual({
      claims: Object.fromEntries(Object.entries(workflowClaims).map(([name, value]) => [name, [value]])),
    });

    const publicAlertGroupId = 'public-alert-publishing-group';
    const publicAlertGroupReference = `Group/${publicAlertGroupId}`;
    const publicAlertGroupDocument = await kmsService.protectConfidentialData({
      id: publicAlertGroupId, status: 'active', sequence: 0,
      content: { claims: workflowGroupClaims }, indexed: { attributes: [] },
    } as any, vaultId);
    await vaultRepository.put(physicalCollection, [publicAlertGroupDocument as any], 'research-groups');
    const publicAlertMemberDocument = await kmsService.protectConfidentialData({
      id: buildGroupMemberProjectionId(publicAlertGroupId, practitionerRoleReference),
      status: 'active', sequence: 0,
      content: { claims: workflowMemberClaims }, indexed: { attributes: [] },
    } as any, vaultId);
    await vaultRepository.put(
      physicalCollection,
      [publicAlertMemberDocument as any],
      buildGroupMemberSectionId(publicAlertGroupId),
    );
    const publicAlertConsentId = 'public-alert-publishing-consent';
    const publicAlertClaims = {
      ...workflowClaims,
      [ClaimConsent.sourceReference]: publicAlertGroupReference,
      [ClaimConsent.action]: OrganizationWorkflowCapabilities.CommunicationRequestCreate,
      [ClaimConsent.identifier]: `urn:uuid:${publicAlertConsentId}`,
    };
    const publicAlertAuthorized = await submitAndPoll(
      app,
      authenticatedActor.authorizationHeader,
      authenticatedActor.actorDid,
      '_batch',
      [{
        request: { method: 'POST', url: 'Consent' },
        resource: {
          resourceType: 'Consent',
          id: publicAlertConsentId,
          meta: { claims: publicAlertClaims },
        },
      }],
      'workflow-public-alert-publishing-activate',
    );
    expect(publicAlertAuthorized.data[0]).toMatchObject({
      response: { status: '201' },
      resource: { resourceType: 'Consent', id: publicAlertConsentId },
    });
    const storedPublicAlertConsents = await vaultRepository.listContainersInSection<any>(
      physicalCollection,
      'organization-workflow-consents',
    );
    expect(storedPublicAlertConsents).toHaveLength(2);
    const protectedPublicAlert = storedPublicAlertConsents.find(record => record.id === publicAlertConsentId);
    await expect(kmsService.unprotectConfidentialData(protectedPublicAlert, vaultId)).resolves.toEqual({
      claims: Object.fromEntries(Object.entries(publicAlertClaims).map(([name, value]) => [name, [value]])),
    });

    const clinicalContributionGroupId = 'clinical-contribution-group';
    const clinicalContributionGroupReference = `Group/${clinicalContributionGroupId}`;
    const clinicalContributionGroupDocument = await kmsService.protectConfidentialData({
      id: clinicalContributionGroupId, status: 'active', sequence: 0,
      content: { claims: workflowGroupClaims }, indexed: { attributes: [] },
    } as any, vaultId);
    await vaultRepository.put(physicalCollection, [clinicalContributionGroupDocument as any], 'research-groups');
    const clinicalContributionMemberDocument = await kmsService.protectConfidentialData({
      id: buildGroupMemberProjectionId(clinicalContributionGroupId, practitionerRoleReference),
      status: 'active', sequence: 0,
      content: { claims: workflowMemberClaims }, indexed: { attributes: [] },
    } as any, vaultId);
    await vaultRepository.put(
      physicalCollection,
      [clinicalContributionMemberDocument as any],
      buildGroupMemberSectionId(clinicalContributionGroupId),
    );
    const clinicalContributionConsentId = 'clinical-contribution-consent';
    const clinicalContributionClaims = {
      ...workflowClaims,
      [ClaimConsent.sourceReference]: clinicalContributionGroupReference,
      [ClaimConsent.action]: SUBJECT_COMPOSITION_CONTRIBUTION_ACTION,
      [ClaimConsent.identifier]: `urn:uuid:${clinicalContributionConsentId}`,
    };
    const clinicalContributionAuthorized = await submitAndPoll(
      app,
      authenticatedActor.authorizationHeader,
      authenticatedActor.actorDid,
      '_batch',
      [{
        request: { method: 'POST', url: 'Consent' },
        resource: {
          resourceType: 'Consent',
          id: clinicalContributionConsentId,
          meta: { claims: clinicalContributionClaims },
        },
      }],
      'workflow-clinical-contribution-activate',
    );
    expect(clinicalContributionAuthorized.data[0]).toMatchObject({
      response: { status: '201' },
      resource: { resourceType: 'Consent', id: clinicalContributionConsentId },
    });
    const storedClinicalContributionConsents = await vaultRepository.listContainersInSection<any>(
      physicalCollection,
      'organization-workflow-consents',
    );
    expect(storedClinicalContributionConsents).toHaveLength(3);
    const protectedClinicalContribution = storedClinicalContributionConsents.find(
      record => record.id === clinicalContributionConsentId,
    );
    await expect(kmsService.unprotectConfidentialData(protectedClinicalContribution, vaultId)).resolves.toEqual({
      claims: Object.fromEntries(Object.entries(clinicalContributionClaims).map(([name, value]) => [name, [value]])),
    });

    const subjectRegistrationGroupId = 'subject-registration-group';
    const subjectRegistrationGroupReference = `Group/${subjectRegistrationGroupId}`;
    const subjectRegistrationGroupDocument = await kmsService.protectConfidentialData({
      id: subjectRegistrationGroupId, status: 'active', sequence: 0,
      content: { claims: workflowGroupClaims }, indexed: { attributes: [] },
    } as any, vaultId);
    await vaultRepository.put(physicalCollection, [subjectRegistrationGroupDocument as any], 'research-groups');
    const subjectRegistrationMemberDocument = await kmsService.protectConfidentialData({
      id: buildGroupMemberProjectionId(subjectRegistrationGroupId, practitionerRoleReference),
      status: 'active', sequence: 0,
      content: { claims: workflowMemberClaims }, indexed: { attributes: [] },
    } as any, vaultId);
    await vaultRepository.put(
      physicalCollection,
      [subjectRegistrationMemberDocument as any],
      buildGroupMemberSectionId(subjectRegistrationGroupId),
    );
    const subjectRegistrationConsentId = 'subject-registration-consent';
    const subjectRegistrationClaims = {
      ...workflowClaims,
      [ClaimConsent.sourceReference]: subjectRegistrationGroupReference,
      [ClaimConsent.action]: buildOrganizationSubjectRegistrationScope(organizationReference),
      [ClaimConsent.identifier]: `urn:uuid:${subjectRegistrationConsentId}`,
    };
    const subjectRegistrationAuthorized = await submitAndPoll(
      app,
      authenticatedActor.authorizationHeader,
      authenticatedActor.actorDid,
      '_batch',
      [{
        request: { method: 'POST', url: 'Consent' },
        resource: {
          resourceType: 'Consent',
          id: subjectRegistrationConsentId,
          meta: { claims: subjectRegistrationClaims },
        },
      }],
      'workflow-subject-registration-activate',
    );
    expect(subjectRegistrationAuthorized.data[0]).toMatchObject({
      response: { status: '201' },
      resource: { resourceType: 'Consent', id: subjectRegistrationConsentId },
    });
    const storedSubjectRegistrationConsents = await vaultRepository.listContainersInSection<any>(
      physicalCollection,
      'organization-workflow-consents',
    );
    expect(storedSubjectRegistrationConsents).toHaveLength(4);

    const revokedClaims = { ...canonicalClaims, [ClaimConsent.status]: [ConsentStatuses.Inactive] };
    const revoked = await submitAndPoll(app, authenticatedActor.authorizationHeader, authenticatedActor.actorDid, '_batch', [{
      request: { method: 'PATCH', url: `Consent/${fixture.consentId}` },
      resource: {
        resourceType: 'Consent', id: fixture.consentId,
        meta: { claims: { [ClaimConsent.status]: ConsentStatuses.Inactive } },
      },
    }], 'revoke');
    expect(revoked.data[0]).toMatchObject({
      response: { status: '200' },
      resource: { resourceType: 'Consent', id: fixture.consentId, meta: { claims: revokedClaims } },
    });

    const searched = await submitAndPoll(app, authenticatedActor.authorizationHeader, authenticatedActor.actorDid, '_search', [{
      resource: {
        resourceType: 'Parameters',
        meta: { claims: { [ClaimConsent.sourceReference]: `ResearchStudy/${fixture.studyId}` } },
      },
    }], 'search');
    expect(searched.data).toHaveLength(1);
    expect(searched.data[0].resource.meta.claims).toEqual(revokedClaims);
  } finally {
    queueAdapter.stop();
  }
});

function configureEnvironment(): void {
  process.env.NODE_ENV = 'test';
  process.env.DB_PROVIDER = 'mem';
  process.env.STORAGE_PROVIDER = 'mem';
  process.env.QUEUE_PROVIDER = 'mem';
  process.env.SECTORS_ALLOWED = fixture.sector;
  process.env.ORG_HOST_LEGAL_NAME = 'Gateway Host Services';
  process.env.ORG_HOST_JURISDICTION = 'CA';
  process.env.ORG_HOST_ID_TYPE = 'BN';
  process.env.ORG_HOST_ID_VALUE = '700000001';
  process.env.ORG_HOST_ADMIN_EMAIL = 'admin@host.example';
  process.env.ORG_HOST_ADMIN_UID = 'host-admin';
  process.env.ORG_HOST_ADMIN_ROLE = 'ISCO-08|1111';
  process.env.SECURITY_MODE = 'demo';
  process.env.JSON_LEGACY = 'true';
}

async function submitAndPoll(
  app: any,
  authorization: string,
  issuer: string,
  action: '_batch' | '_search',
  data: readonly unknown[],
  suffix: string,
): Promise<any> {
  const base = `/${fixture.tenantId}/cds-${fixture.jurisdiction}/v1/${fixture.sector}/organization/org.hl7.fhir.r5/Consent`;
  const thid = `research-study-consent-integration-${suffix}`;
  const submitted = await invokeExpress(app, {
    method: 'POST', url: `${base}/${action}`,
    headers: { 'content-type': 'application/json', authorization },
    body: {
      thid, iss: issuer,
      body: { data },
    },
  });
  expect(submitted.status).toBe(202);
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const polled = await invokeExpress(app, {
      method: 'POST', url: `${base}/${action}-response`,
      headers: { 'content-type': 'application/json' },
      body: { thid },
    });
    if (polled.status === 200) return JSON.parse(polled.text);
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error('ResearchStudy Consent async response timed out.');
}
