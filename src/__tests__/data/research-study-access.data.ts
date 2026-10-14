// Copyright 2026 Connecting Solution & Applications Ltd under the Apache License, Version 2.0.
// Flow contract: reuse governed research and organization fixtures; never duplicate authorization literals in suites.
import { HealthcareConsentPurposes } from 'gdc-common-utils-ts/constants/healthcare';
import { ClaimConsent, ConsentDecisions, ConsentStatuses } from 'gdc-common-utils-ts/models/consent-rule';
import { buildStableActorIdentifier } from 'gdc-common-utils-ts/utils/actor-identifier';

export const RESEARCH_STUDY_REVIEWER_EMAIL = 'reviewer@example.test';
const reviewerStableDidPart = buildStableActorIdentifier({
  contactKind: 'email',
  contact: RESEARCH_STUDY_REVIEWER_EMAIL,
}).replace('urn:multibase:', '');

export const RESEARCH_STUDY_ACCESS_FIXTURE = Object.freeze({
  tenantId: 'research-clinic',
  sector: 'animal-research',
  jurisdiction: 'CA-BC',
  vaultId: 'animal-research_research-clinic',
  collectionName: 'isolated-research-clinic-vault',
  controllerDid: 'did:web:example.test:controller',
  professionalDid: `did:web:example.test:animal-research:organization:taxid:research-clinic:employee:${reviewerStableDidPart}:ISCO-08%7C2250`,
  clientId: 'research-reviewer-client',
  studyId: 'study-access-one',
  practitionerRoleId: '05a9c3b9-4cd1-46c9-a296-fcab288e0d37',
  consentId: 'research-study-access-consent',
});

export function buildResearchStudyAccessScope(
  studyId: string = RESEARCH_STUDY_ACCESS_FIXTURE.studyId,
  operations: string = 'crus',
): string {
  return `organization/ResearchSubject.${operations}?study=ResearchStudy/${studyId}`;
}

export function buildOrganizationSubjectRegistrationScope(organizationReference: string): string {
  return `organization/Subject.c?organization=${organizationReference}`;
}

export function buildResearchStudyAccessClaims(overrides: Record<string, unknown> = {}) {
  const fixture = RESEARCH_STUDY_ACCESS_FIXTURE;
  const claims: Record<string, readonly string[]> = {
    [ClaimConsent.status]: [ConsentStatuses.Active],
    [ClaimConsent.decision]: [ConsentDecisions.Permit],
    [ClaimConsent.purpose]: [HealthcareConsentPurposes.Research],
    [ClaimConsent.sourceReference]: [`ResearchStudy/${fixture.studyId}`],
    [ClaimConsent.actorIdentifier]: [`PractitionerRole/${fixture.practitionerRoleId}`],
    [ClaimConsent.actorRole]: ['ISCO-08|2250'],
    [ClaimConsent.action]: [buildResearchStudyAccessScope()],
    [ClaimConsent.date]: ['2026-09-06'],
  };
  for (const [name, value] of Object.entries(overrides)) {
    claims[name] = Array.isArray(value) ? value.map(String) : [String(value)];
  }
  return claims;
}

export function buildResearchStudyAccessConsent(overrides: Record<string, unknown> = {}) {
  const fixture = RESEARCH_STUDY_ACCESS_FIXTURE;
  return {
    resourceType: 'Consent',
    id: fixture.consentId,
    meta: { claims: buildResearchStudyAccessClaims(overrides) },
  };
}
