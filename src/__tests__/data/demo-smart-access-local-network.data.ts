// Flow contract: reuse shared test fixtures and canonical types; do not introduce duplicated literals.
// Always create JSDoc, do not use strings inline in keys nor values, use types instead, and reuse the data test examples.
import { readFileSync } from 'node:fs';
import path from 'node:path';

import {
  HealthcareActorRoles,
  HealthcareBasicSections,
  HealthcareConsentPurposes,
} from 'gdc-common-utils-ts/constants/healthcare';
import { ServiceCapability } from 'gdc-common-utils-ts/constants/service-capabilities';
import { ClaimsPersonSchemaorg } from 'gdc-common-utils-ts/constants/schemaorg';
import {
  EXAMPLE_API_ORGANIZATION_DID,
  EXAMPLE_CONSENT_ATTACHMENT_CONTENT_TYPE,
  EXAMPLE_CONSENT_ATTACHMENT_DATA_BASE64,
  EXAMPLE_CONTROLLER_DID,
  EXAMPLE_HEALTHCARE_ACTOR_ROLE_PHYSICIAN,
  EXAMPLE_RESEARCH_CONTROLLER_DID,
  EXAMPLE_TENANT_IDENTIFIER,
} from 'gdc-common-utils-ts/examples/shared';
import { EXAMPLE_INTER_TENANT_ACCESS_CONTRACT_PURPOSE } from 'gdc-common-utils-ts/examples/inter-tenant-access-contract';
import { ClaimConsent, ConsentDecisions, ConsentStatuses, type ConsentRule } from 'gdc-common-utils-ts/models/consent-rule';
import { ClaimInterTenantAccessContract } from 'gdc-common-utils-ts/models/inter-tenant-access-contract';
import { MedicationStatementClaim } from 'gdc-common-utils-ts/models/interoperable-claims';
import {
  buildClientAssertionJwt,
  buildInterTenantAccessContractCredential,
  buildUnsignedProfessionalIdentityVpJwt,
  createVP,
  addVC,
} from 'gdc-common-utils-ts';
import { ResourceTypesFhirR4 } from 'gdc-common-utils-ts/constants/fhir-resource-types';
import { buildExampleCommunicationIngestionPayload } from 'gdc-common-utils-ts/examples/shared';
import {
  BundleDocumentRequestMessageTypes,
  buildCommunicationRequestOperationWithAttachedParametersClaims,
} from 'gdc-common-utils-ts/utils/communication-bundle-document-request';
import { transformCommunicationClaimsToResourceFhirR4 } from 'gdc-common-utils-ts/utils/communication-fhir-r4';
import { demoCommunicationMedicationIpsDefaults } from './demo-communication-medications-ips.data';

/**
 * Canonical ids reused by the local-network SMART access smoke.
 *
 * The goal is to keep the shell scripts free from ad-hoc strings while still
 * making each step self-explanatory in logs and polls.
 */
export const DEMO_SMART_ACCESS_LOCAL_IDS = Object.freeze({
  individualSmartThreadId: 'local-network-individual-smart-token-001',
  individualBundleSearchThreadId: 'local-network-individual-bundle-search-001',
  individualAllSectionsIngestionThreadId: 'local-network-individual-all-sections-ingestion-001',
  individualScopedSummaryThreadId: 'local-network-individual-scoped-summary-001',
  individualConsentIdentifier: 'urn:uuid:local-network-individual-ips-consent-001',
  researchRoleSmartThreadId: 'local-network-research-role-smart-token-001',
  researchRoleDeniedSmartThreadId: 'local-network-research-role-smart-token-denied-001',
  researchEmailSmartThreadId: 'local-network-research-email-smart-token-001',
  researchEmailDeniedSmartThreadId: 'local-network-research-email-smart-token-denied-001',
  digitalTwinSearchThreadId: 'local-network-digitaltwin-composition-search-001',
  researchContractIdentifier: 'urn:uuid:local-network-inter-tenant-contract-001',
  researchRoleConsentSourceReference: 'urn:demo:vetchain:research-role-consent',
  researchDirectEmailConsentSourceReference: 'urn:demo:vetchain:research-email-consent',
  researchDeniedEmailConsentSourceReference: 'urn:demo:vetchain:research-email-deny-consent',
} as const);

/** Two-section regression constraint used by the real local-network proof. */
export const DEMO_SMART_SUMMARY_ALLOWED_SECTIONS = Object.freeze([
  HealthcareBasicSections.HistoryOfMedicationUse.claim,
  HealthcareBasicSections.ProblemList.claim,
] as const);

export const DEMO_SMART_ACCESS_LOCAL_EMAILS = Object.freeze({
  individualProfessional: 'doctor1@acme.org',
  researchAllowed: 'researcher1@lab.org',
  researchDenied: 'researcher2@lab.org',
} as const);

export const DEMO_SMART_ACCESS_LOCAL_DIDS = Object.freeze({
  consumerOrganizationDid: 'did:web:api.lab.org',
  providerControllerDid: EXAMPLE_CONTROLLER_DID,
  consumerControllerDid: EXAMPLE_RESEARCH_CONTROLLER_DID,
  consumerDeviceDid: 'did:web:device.lab.org',
} as const);

function buildProviderOrganizationDid(tenantId: string): string {
  if (String(tenantId || '').trim() === EXAMPLE_TENANT_IDENTIFIER) {
    return EXAMPLE_API_ORGANIZATION_DID;
  }
  return `did:web:api.${String(tenantId || '').trim()}.org`;
}

function buildIndividualProfessionalDid(tenantId: string): string {
  return `${buildProviderOrganizationDid(tenantId)}:employee:${DEMO_SMART_ACCESS_LOCAL_EMAILS.individualProfessional}:${HealthcareActorRoles.Physician}`;
}

function buildIndividualClientId(tenantId: string): string {
  return `${buildProviderOrganizationDid(tenantId)}:employee:${DEMO_SMART_ACCESS_LOCAL_EMAILS.individualProfessional}:device:client-local-individual`;
}

function buildResearchProfessionalDid(role: string, email: string): string {
  return `${DEMO_SMART_ACCESS_LOCAL_DIDS.consumerOrganizationDid}:employee:${email}:${role}`;
}

function buildResearchClientId(email: string, suffix: string): string {
  return `${DEMO_SMART_ACCESS_LOCAL_DIDS.consumerOrganizationDid}:employee:${email}:device:${suffix}`;
}

/**
 * Builds one realistic VP token for the local individual-professional SMART
 * request. The current demo gateway accepts placeholder VPs, but this helper
 * keeps the local smoke aligned with the shared professional identity VC/VP
 * model.
 */
export function buildDemoIndividualProfessionalVpToken(input: Readonly<{
  tenantId: string;
}>): string {
  return buildUnsignedProfessionalIdentityVpJwt({
    clientId: buildIndividualClientId(input.tenantId),
    actorDid: buildIndividualProfessionalDid(input.tenantId),
    role: HealthcareActorRoles.Physician,
    email: DEMO_SMART_ACCESS_LOCAL_EMAILS.individualProfessional,
  });
}

/**
 * Builds the exact subject, actor, purpose and IPS-section consent consumed by
 * the mandatory same-portal SMART release smoke. Keeping this rule beside the
 * token fixture makes the smoke self-contained instead of relying on an
 * unrelated generic ConsentAccess example having run first.
 */
export function buildDemoIndividualIpsPermitConsent(input: Readonly<{
  tenantId: string;
  subjectDid: string;
}>): ConsentRule {
  return {
    '@context': 'org.hl7.fhir.api',
    [ClaimConsent.identifier]: DEMO_SMART_ACCESS_LOCAL_IDS.individualConsentIdentifier,
    [ClaimConsent.subject]: String(input.subjectDid || '').trim(),
    [ClaimConsent.actorIdentifier]: buildIndividualProfessionalDid(input.tenantId),
    [ClaimConsent.actorRole]: HealthcareActorRoles.Physician,
    [ClaimConsent.decision]: ConsentDecisions.Permit,
    [ClaimConsent.status]: ConsentStatuses.Active,
    [ClaimConsent.purpose]: HealthcareConsentPurposes.EmergencyTreatment,
    [ClaimConsent.action]: DEMO_SMART_SUMMARY_ALLOWED_SECTIONS.join(','),
    [ClaimConsent.date]: '2026-08-01',
    [ClaimConsent.attachmentContentType]: EXAMPLE_CONSENT_ATTACHMENT_CONTENT_TYPE,
    [ClaimConsent.attachmentData]: EXAMPLE_CONSENT_ATTACHMENT_DATA_BASE64,
  } as const;
}

/**
 * Builds one `smart/token` request body for the current local individual
 * consent smoke.
 */
export async function buildDemoIndividualSmartTokenRequest(input: Readonly<{
  tenantId: string;
  subjectDid: string;
  clientAssertionAudience?: string;
}>): Promise<Record<string, unknown>> {
  const clientId = buildIndividualClientId(input.tenantId);
  const audience = buildProviderOrganizationDid(input.tenantId);
  const scope =
    `${ServiceCapability.IndexReader}?subject=${String(input.subjectDid || '').trim()}`
    + `&section=${DEMO_SMART_SUMMARY_ALLOWED_SECTIONS.join(',')}`;
  return {
    thid: DEMO_SMART_ACCESS_LOCAL_IDS.individualSmartThreadId,
    iss: clientId,
    aud: audience,
    body: {
      client_id: clientId,
      client_assertion: await buildClientAssertionJwt({
        clientId,
        audience: input.clientAssertionAudience || audience,
      }),
      client_assertion_type: 'private_key_jwt',
      sub: buildIndividualProfessionalDid(input.tenantId),
      purpose: HealthcareConsentPurposes.EmergencyTreatment,
      scope,
      expires_in: 60,
      vp_token: buildDemoIndividualProfessionalVpToken({ tenantId: input.tenantId }),
      acr_values: 'urn:antifraud:acr:openid4vp:employee',
    },
  };
}

/** Builds the canonical all-sections IPS used by the local-network authorization proof. */
export function buildDemoIndividualAllSectionsIngestionRequest(input: Readonly<{
  subjectDid: string;
}>): Record<string, unknown> {
  const fixturePath = path.join(
    process.cwd(),
    'node_modules',
    'gdc-common-utils-ts',
    'fixtures',
    'fhir-ips-bundle-all-sections.json',
  );
  const bundle = JSON.parse(readFileSync(fixturePath, 'utf8'));
  const subjectDid = String(input.subjectDid || '').trim();
  for (const entry of Array.isArray(bundle?.entry) ? bundle.entry : []) {
    const resource = entry?.resource;
    if (!resource || typeof resource !== 'object') continue;
    if (resource.resourceType === ResourceTypesFhirR4.Composition) {
      resource.author = [{ reference: demoCommunicationMedicationIpsDefaults.externalAuthorUrn }];
    }
    if (resource?.subject?.reference) resource.subject.reference = subjectDid;
    if (resource?.patient?.reference) resource.patient.reference = subjectDid;
    for (const codeableConcept of [
      resource?.medicationCodeableConcept,
      resource?.code,
      resource?.vaccineCode,
      resource?.category?.[0],
    ]) {
      const coding = codeableConcept?.coding?.[0];
      if (!coding) continue;
      coding.userSelected = true;
      codeableConcept.text ||= coding.display;
    }
  }

  const composition = bundle.entry.find(
    (entry: any) => entry?.resource?.resourceType === ResourceTypesFhirR4.Composition,
  )?.resource;
  const medicationSection = composition?.section?.find(
    (section: any) => section?.code?.coding?.some((coding: any) => coding?.code === '10160-0'),
  );
  medicationSection?.entry?.push({
    reference: 'DocumentReference/smart-summary-authorized-medication-document',
  });
  bundle.entry.push({
    fullUrl: 'DocumentReference/smart-summary-authorized-medication-document',
    resource: {
      resourceType: ResourceTypesFhirR4.DocumentReference,
      id: 'smart-summary-authorized-medication-document',
      status: 'current',
      subject: { reference: subjectDid },
      date: '2026-08-01T10:00:00Z',
      identifier: [{ value: 'urn:uuid:smart-summary-authorized-medication-document' }],
      content: [{ attachment: {
        contentType: 'application/pdf',
        url: 'https://records.example.org/smart-summary-authorized-medication-document.pdf',
        title: 'Authorized medication document',
      } }],
    },
  });

  return {
    thid: DEMO_SMART_ACCESS_LOCAL_IDS.individualAllSectionsIngestionThreadId,
    ...buildExampleCommunicationIngestionPayload({
      subjectDid,
      ipsBundleBase64: Buffer.from(JSON.stringify(bundle), 'utf8').toString('base64'),
    }),
  };
}

/** Builds an unfiltered summary request whose effective filter must come from the SMART token. */
export function buildDemoIndividualScopedSummaryRequest(input: Readonly<{
  tenantId: string;
  subjectDid: string;
}>): Record<string, unknown> {
  const claims = buildCommunicationRequestOperationWithAttachedParametersClaims({
    subjectId: String(input.subjectDid || '').trim(),
    requesterId: buildIndividualProfessionalDid(input.tenantId),
    thid: DEMO_SMART_ACCESS_LOCAL_IDS.individualScopedSummaryThreadId,
  });
  const resource = transformCommunicationClaimsToResourceFhirR4([claims], {
    mode: 'strict',
    defaultStatus: 'completed',
  }).resources[0];
  return {
    thid: DEMO_SMART_ACCESS_LOCAL_IDS.individualScopedSummaryThreadId,
    body: {
      data: [{
        type: BundleDocumentRequestMessageTypes.CommunicationRequestSearchWithReferenceUrl,
        resource,
      }],
    },
  };
}

/**
 * Builds one canonical `Bundle/_search` request that reads the IPS document
 * for the current subject.
 */
export function buildDemoIndividualIpsSearchRequest(input: Readonly<{
  subjectDid: string;
}>): Record<string, unknown> {
  const subjectDid = String(input.subjectDid || '').trim();
  const compositionType = HealthcareBasicSections.PatientSummaryDocument.claim;
  return {
    thid: DEMO_SMART_ACCESS_LOCAL_IDS.individualBundleSearchThreadId,
    body: {
      resourceType: 'Bundle',
      type: 'batch',
      entry: [
        {
          request: {
            method: 'GET',
            url:
              `Bundle?type=document&composition.subject=${encodeURIComponent(subjectDid)}`
              + `&composition.type=${encodeURIComponent(compositionType)}`,
          },
        },
      ],
    },
  };
}

/**
 * Builds one live provider-side consent rule that allows the consumer
 * organization when the requester role matches.
 */
export function buildDemoResearchPermitByRoleConsent(input: Readonly<{
  subjectDid: string;
}>): Readonly<Record<string, unknown>> {
  return {
    '@context': 'org.hl7.fhir.api',
    [ClaimConsent.sourceReference]: DEMO_SMART_ACCESS_LOCAL_IDS.researchRoleConsentSourceReference,
    [ClaimConsent.subject]: String(input.subjectDid || '').trim(),
    [ClaimConsent.actorIdentifier]: DEMO_SMART_ACCESS_LOCAL_DIDS.consumerOrganizationDid,
    [ClaimConsent.actorRole]: EXAMPLE_HEALTHCARE_ACTOR_ROLE_PHYSICIAN,
    [ClaimConsent.decision]: ConsentDecisions.Permit,
    [ClaimConsent.status]: ConsentStatuses.Active,
    [ClaimConsent.purpose]: EXAMPLE_INTER_TENANT_ACCESS_CONTRACT_PURPOSE,
    [ClaimConsent.action]: ServiceCapability.DigitalTwinReader,
    [ClaimConsent.date]: '2026-06-30',
  } as const;
}

/**
 * Builds one live provider-side consent rule that directly targets one allowed
 * research employee email.
 */
export function buildDemoResearchPermitByEmailConsent(input: Readonly<{
  subjectDid: string;
}>): Readonly<Record<string, unknown>> {
  return {
    '@context': 'org.hl7.fhir.api',
    [ClaimConsent.sourceReference]: DEMO_SMART_ACCESS_LOCAL_IDS.researchDirectEmailConsentSourceReference,
    [ClaimConsent.subject]: String(input.subjectDid || '').trim(),
    [ClaimConsent.actorIdentifier]: DEMO_SMART_ACCESS_LOCAL_EMAILS.researchAllowed,
    [ClaimConsent.actorRole]: EXAMPLE_HEALTHCARE_ACTOR_ROLE_PHYSICIAN,
    [ClaimConsent.decision]: ConsentDecisions.Permit,
    [ClaimConsent.status]: ConsentStatuses.Active,
    [ClaimConsent.purpose]: EXAMPLE_INTER_TENANT_ACCESS_CONTRACT_PURPOSE,
    [ClaimConsent.action]: ServiceCapability.DigitalTwinReader,
    [ClaimConsent.date]: '2026-06-30',
  } as const;
}

/**
 * Builds the explicit direct-email deny used to prove that a named employee
 * cannot inherit a broader organization-role permit. A negative smoke must
 * carry an actual deny rule; absence of a different employee's permit is not
 * equivalent while a role permit remains active for the same subject.
 */
export function buildDemoResearchDenyByEmailConsent(input: Readonly<{
  subjectDid: string;
}>): Readonly<Record<string, unknown>> {
  return {
    '@context': 'org.hl7.fhir.api',
    [ClaimConsent.sourceReference]: DEMO_SMART_ACCESS_LOCAL_IDS.researchDeniedEmailConsentSourceReference,
    [ClaimConsent.subject]: String(input.subjectDid || '').trim(),
    [ClaimConsent.actorIdentifier]: DEMO_SMART_ACCESS_LOCAL_EMAILS.researchDenied,
    [ClaimConsent.actorRole]: EXAMPLE_HEALTHCARE_ACTOR_ROLE_PHYSICIAN,
    [ClaimConsent.decision]: ConsentDecisions.Deny,
    [ClaimConsent.status]: ConsentStatuses.Active,
    [ClaimConsent.purpose]: EXAMPLE_INTER_TENANT_ACCESS_CONTRACT_PURPOSE,
    [ClaimConsent.action]: ServiceCapability.DigitalTwinReader,
    [ClaimConsent.date]: '2026-06-30',
  } as const;
}

function buildDemoResearchContractCredential(input: Readonly<{
  tenantId: string;
  subjectDid: string;
  providerOrganizationDid?: string;
}>): Record<string, unknown> {
  const providerOrganizationDid = String(
    input.providerOrganizationDid || buildProviderOrganizationDid(input.tenantId),
  ).trim();
  return buildInterTenantAccessContractCredential({
    issuer: DEMO_SMART_ACCESS_LOCAL_DIDS.consumerControllerDid,
    validFrom: '2026-06-30T00:00:00.000Z',
    validUntil: '2027-06-30T00:00:00.000Z',
    additionalCredential: {
      id: DEMO_SMART_ACCESS_LOCAL_IDS.researchContractIdentifier,
      // Synthetic records for the in-memory smoke. Production clearing-house
      // verification must validate both actual contractAgreement signatures.
      proof: [
        {
          type: 'JsonWebSignature2020',
          proofPurpose: 'contractAgreement',
          verificationMethod: `${DEMO_SMART_ACCESS_LOCAL_DIDS.providerControllerDid}#contract-agreement`,
          jws: 'provider-authorized-signatory-proof',
        },
        {
          type: 'JsonWebSignature2020',
          proofPurpose: 'contractAgreement',
          verificationMethod: `${DEMO_SMART_ACCESS_LOCAL_DIDS.consumerControllerDid}#contract-agreement`,
          jws: 'consumer-authorized-signatory-proof',
        },
      ],
    },
    claims: {
      [ClaimInterTenantAccessContract.identifier]: DEMO_SMART_ACCESS_LOCAL_IDS.researchContractIdentifier,
      [ClaimInterTenantAccessContract.status]: 'executed',
      [ClaimInterTenantAccessContract.issued]: '2026-06-30T00:00:00.000Z',
      [ClaimInterTenantAccessContract.appliesStart]: '2026-06-30T00:00:00.000Z',
      [ClaimInterTenantAccessContract.appliesEnd]: '2027-06-30T00:00:00.000Z',
      [ClaimInterTenantAccessContract.providerOrganization]: providerOrganizationDid,
      [ClaimInterTenantAccessContract.consumerOrganization]: DEMO_SMART_ACCESS_LOCAL_DIDS.consumerOrganizationDid,
      [ClaimInterTenantAccessContract.providerController]: DEMO_SMART_ACCESS_LOCAL_DIDS.providerControllerDid,
      [ClaimInterTenantAccessContract.consumerController]: DEMO_SMART_ACCESS_LOCAL_DIDS.consumerControllerDid,
      [ClaimInterTenantAccessContract.capability]: ServiceCapability.DigitalTwinReader,
      [ClaimInterTenantAccessContract.purpose]: EXAMPLE_INTER_TENANT_ACCESS_CONTRACT_PURPOSE,
      [ClaimInterTenantAccessContract.instantiatesUri]: 'https://portal.example.org/contracts/local-network-research-access-001.pdf',
    },
  }) as unknown as Record<string, unknown>;
}

/**
 * Builds one VP token that carries the inter-tenant research contract VC for
 * the selected requester.
 */
export function buildDemoResearchContractVpToken(input: Readonly<{
  tenantId: string;
  subjectDid: string;
  actorDid: string;
  providerOrganizationDid?: string;
}>): string {
  const vpPayload = createVP({
    iss: DEMO_SMART_ACCESS_LOCAL_DIDS.consumerOrganizationDid,
    sub: String(input.actorDid || '').trim(),
  });
  addVC(vpPayload, buildDemoResearchContractCredential({
    tenantId: input.tenantId,
    subjectDid: input.subjectDid,
    providerOrganizationDid: input.providerOrganizationDid,
  }));
  return JSON.stringify(vpPayload);
}

/**
 * Builds one SMART token request for the local research/digital-twin flow.
 */
export async function buildDemoResearchSmartTokenRequest(input: Readonly<{
  tenantId: string;
  subjectDid: string;
  providerOrganizationDid?: string;
  actorDid: string;
  actorEmail: string;
  actorRole: string;
  clientSuffix: string;
  thid: string;
  clientAssertionAudience?: string;
}>): Promise<Record<string, unknown>> {
  const clientId = buildResearchClientId(input.actorEmail, input.clientSuffix);
  const audience = buildProviderOrganizationDid(input.tenantId);
  const scope =
    `${ServiceCapability.DigitalTwinReader}?subject=${encodeURIComponent(String(input.subjectDid || '').trim())}`;
  return {
    thid: input.thid,
    iss: clientId,
    aud: audience,
    body: {
      client_id: clientId,
      client_assertion: await buildClientAssertionJwt({
        clientId,
        audience: input.clientAssertionAudience || audience,
      }),
      client_assertion_type: 'client_assertion',
      sub: String(input.actorDid || '').trim(),
      purpose: EXAMPLE_INTER_TENANT_ACCESS_CONTRACT_PURPOSE,
      scope,
      expires_in: 60,
      vp_token: buildDemoResearchContractVpToken({
        tenantId: input.tenantId,
        subjectDid: input.subjectDid,
        actorDid: input.actorDid,
        providerOrganizationDid: input.providerOrganizationDid,
      }),
      acr_values: 'urn:antifraud:acr:openid4vp:employee',
    },
  };
}

/**
 * Builds the canonical public `ResearchSubject/_search` Parameters request.
 * GW searches the clinical resources joined by each embedded Composition.
 */
export function buildDemoDigitalTwinResearchSubjectSearchRequest(): Record<string, unknown> {
  const ibuprofenCode = demoCommunicationMedicationIpsDefaults.demoMedicationCases[0].demoMedicationCode;
  return {
    thid: DEMO_SMART_ACCESS_LOCAL_IDS.digitalTwinSearchThreadId,
    body: {
      resourceType: 'Parameters',
      parameter: [
        { name: 'section', valueString: HealthcareBasicSections.HistoryOfMedicationUse.attributeValue },
        // Research projections intentionally remove free text; use the
        // preserved coded claim for deterministic discovery.
        { name: MedicationStatementClaim.Code, valueString: ibuprofenCode },
      ],
    },
  };
}

/**
 * Returns the canonical role/email requester matrix used by the local-network
 * research smoke.
 */
export function buildDemoResearchRequesterMatrix(): Readonly<{
  allowByRole: { actorDid: string; actorEmail: string; actorRole: string; clientSuffix: string; thid: string };
  denyByRole: { actorDid: string; actorEmail: string; actorRole: string; clientSuffix: string; thid: string };
  allowByEmail: { actorDid: string; actorEmail: string; actorRole: string; clientSuffix: string; thid: string };
  denyByEmail: { actorDid: string; actorEmail: string; actorRole: string; clientSuffix: string; thid: string };
}> {
  return {
    allowByRole: {
      actorDid: buildResearchProfessionalDid(EXAMPLE_HEALTHCARE_ACTOR_ROLE_PHYSICIAN, DEMO_SMART_ACCESS_LOCAL_EMAILS.researchAllowed),
      actorEmail: DEMO_SMART_ACCESS_LOCAL_EMAILS.researchAllowed,
      actorRole: EXAMPLE_HEALTHCARE_ACTOR_ROLE_PHYSICIAN,
      clientSuffix: 'client-role-allow',
      thid: DEMO_SMART_ACCESS_LOCAL_IDS.researchRoleSmartThreadId,
    },
    denyByRole: {
      actorDid: buildResearchProfessionalDid(HealthcareActorRoles.NursingProfessional, DEMO_SMART_ACCESS_LOCAL_EMAILS.researchDenied),
      actorEmail: DEMO_SMART_ACCESS_LOCAL_EMAILS.researchDenied,
      actorRole: HealthcareActorRoles.NursingProfessional,
      clientSuffix: 'client-role-deny',
      thid: DEMO_SMART_ACCESS_LOCAL_IDS.researchRoleDeniedSmartThreadId,
    },
    allowByEmail: {
      actorDid: buildResearchProfessionalDid(EXAMPLE_HEALTHCARE_ACTOR_ROLE_PHYSICIAN, DEMO_SMART_ACCESS_LOCAL_EMAILS.researchAllowed),
      actorEmail: DEMO_SMART_ACCESS_LOCAL_EMAILS.researchAllowed,
      actorRole: EXAMPLE_HEALTHCARE_ACTOR_ROLE_PHYSICIAN,
      clientSuffix: 'client-email-allow',
      thid: DEMO_SMART_ACCESS_LOCAL_IDS.researchEmailSmartThreadId,
    },
    denyByEmail: {
      actorDid: buildResearchProfessionalDid(EXAMPLE_HEALTHCARE_ACTOR_ROLE_PHYSICIAN, DEMO_SMART_ACCESS_LOCAL_EMAILS.researchDenied),
      actorEmail: DEMO_SMART_ACCESS_LOCAL_EMAILS.researchDenied,
      actorRole: EXAMPLE_HEALTHCARE_ACTOR_ROLE_PHYSICIAN,
      clientSuffix: 'client-email-deny',
      thid: DEMO_SMART_ACCESS_LOCAL_IDS.researchEmailDeniedSmartThreadId,
    },
  } as const;
}

/**
 * Minimal claims projection for the direct-email research permit smoke.
 */
export function buildDemoResearchRequesterClaims(email: string): Readonly<Record<string, string>> {
  return Object.freeze({
    '@context': 'org.schema',
    [ClaimsPersonSchemaorg.email]: String(email || '').trim(),
  });
}
