// Flow contract: reuse shared test fixtures and canonical types; do not introduce duplicated literals.
/**
 * Flow contract: the local-network SMART fixtures bind their research
 * Contract VC to the live provider tenant DID and emit the same canonical
 * one-section Digital Twin Parameters accepted by GW VET; local code-text
 * aliases must never return to the research search surface.
 */
import {
  HealthcareActorRoles,
  HealthcareBasicSections,
  HealthcareConsentPurposes,
} from 'gdc-common-utils-ts/constants/healthcare';
import { ServiceCapability } from 'gdc-common-utils-ts/constants/service-capabilities';
import {
  EXAMPLE_CONSENT_ATTACHMENT_CONTENT_TYPE,
  EXAMPLE_CONSENT_ATTACHMENT_DATA_BASE64,
} from 'gdc-common-utils-ts/examples/shared';
import { EXAMPLE_INTER_TENANT_ACCESS_CONTRACT_PURPOSE } from 'gdc-common-utils-ts/examples/inter-tenant-access-contract';
import { ClaimConsent, ConsentDecisions, ConsentStatuses } from 'gdc-common-utils-ts/models/consent-rule';
import { MedicationStatementClaim } from 'gdc-common-utils-ts/models/interoperable-claims';
import { getMatchingInterTenantAccessContractFromVpToken } from 'gdc-common-utils-ts/utils/inter-tenant-access-contract';
import { demoCommunicationMedicationIpsDefaults } from '../../data/demo-communication-medications-ips.data';
import {
  DEMO_SMART_ACCESS_LOCAL_DIDS,
  DEMO_SMART_ACCESS_LOCAL_EMAILS,
  DEMO_SMART_ACCESS_LOCAL_IDS,
  DEMO_SMART_SUMMARY_ALLOWED_SECTIONS,
  buildDemoDigitalTwinResearchSubjectSearchRequest,
  buildDemoIndividualIpsSearchRequest,
  buildDemoIndividualIpsPermitConsent,
  buildDemoIndividualAllSectionsIngestionRequest,
  buildDemoIndividualScopedSummaryRequest,
  buildDemoIndividualSmartTokenRequest,
  buildDemoResearchPermitByEmailConsent,
  buildDemoResearchDenyByEmailConsent,
  buildDemoResearchPermitByRoleConsent,
  buildDemoResearchRequesterMatrix,
  buildDemoResearchSmartTokenRequest,
} from '../../data/demo-smart-access-local-network.data';

describe('demo smart access local-network builders', () => {
  const tenantId = 'acme-id';
  const subjectDid = `did:web:api.${tenantId}.org:individual:subject-001`;

  it('builds the exact two-section consent and SMART scope reported by the integrator', async () => {
    const payload = await buildDemoIndividualSmartTokenRequest({ tenantId, subjectDid });
    expect((payload as any).body.scope).toBe(
      `${ServiceCapability.IndexReader}?subject=${subjectDid}`
      + `&section=${DEMO_SMART_SUMMARY_ALLOWED_SECTIONS.join(',')}`,
    );
  });

  it('builds an all-sections IPS ingestion and an unfiltered $summary request', () => {
    const ingestion = buildDemoIndividualAllSectionsIngestionRequest({ subjectDid });
    const summary = buildDemoIndividualScopedSummaryRequest({ tenantId, subjectDid });
    const ingestedBundle = JSON.parse(Buffer.from(
      (ingestion as any).body.data[0].resource.payload[0].contentAttachment.data,
      'base64',
    ).toString('utf8'));

    expect(ingestedBundle.entry.find((entry: any) => entry.resource?.resourceType === 'Composition')
      ?.resource?.section).toHaveLength(16);
    expect(JSON.stringify(ingestedBundle)).toContain('smart-summary-authorized-medication-document');
    expect((summary as any).thid).toBe(DEMO_SMART_ACCESS_LOCAL_IDS.individualScopedSummaryThreadId);
    expect(JSON.stringify(summary)).toContain('Subject/$summary');
    expect(JSON.stringify(summary)).not.toContain('filterSections');
  });

  it('builds the exact individual IPS consent required by the SMART smoke', () => {
    expect(buildDemoIndividualIpsPermitConsent({ tenantId, subjectDid })).toMatchObject({
      [ClaimConsent.subject]: subjectDid,
      [ClaimConsent.actorIdentifier]: `did:web:api.acme.org:employee:${DEMO_SMART_ACCESS_LOCAL_EMAILS.individualProfessional}:${HealthcareActorRoles.Physician}`,
      [ClaimConsent.actorRole]: HealthcareActorRoles.Physician,
      [ClaimConsent.decision]: ConsentDecisions.Permit,
      [ClaimConsent.status]: ConsentStatuses.Active,
      [ClaimConsent.purpose]: HealthcareConsentPurposes.EmergencyTreatment,
      [ClaimConsent.action]: DEMO_SMART_SUMMARY_ALLOWED_SECTIONS.join(','),
      [ClaimConsent.attachmentContentType]: EXAMPLE_CONSENT_ATTACHMENT_CONTENT_TYPE,
      [ClaimConsent.attachmentData]: EXAMPLE_CONSENT_ATTACHMENT_DATA_BASE64,
    });
  });

  it('builds one individual smart token request rooted at organization/Composition.rs', async () => {
    const payload = await buildDemoIndividualSmartTokenRequest({ tenantId, subjectDid });

    expect(payload).toMatchObject({
      thid: DEMO_SMART_ACCESS_LOCAL_IDS.individualSmartThreadId,
      body: {
        purpose: HealthcareConsentPurposes.EmergencyTreatment,
        scope: `${ServiceCapability.IndexReader}?subject=${subjectDid}&section=${DEMO_SMART_SUMMARY_ALLOWED_SECTIONS.join(',')}`,
        client_assertion_type: 'private_key_jwt',
      },
    });
    expect(String((payload as any).body.client_assertion || '')).not.toHaveLength(0);
  });

  it('builds one individual IPS search request over Bundle/_search', () => {
    expect(buildDemoIndividualIpsSearchRequest({ subjectDid })).toEqual({
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
                + `&composition.type=${encodeURIComponent(HealthcareBasicSections.PatientSummaryDocument.claim)}`,
            },
          },
        ],
      },
    });
  });

  it('builds one provider research permit by role rooted at ResearchSubject.rs', () => {
    const consent = buildDemoResearchPermitByRoleConsent({ subjectDid });
    expect(consent).toMatchObject({
      'Consent.subject': subjectDid,
      'Consent.actor-identifier': DEMO_SMART_ACCESS_LOCAL_DIDS.consumerOrganizationDid,
      'Consent.actor-role': HealthcareActorRoles.Physician,
      'Consent.purpose': EXAMPLE_INTER_TENANT_ACCESS_CONTRACT_PURPOSE,
      'Consent.action': ServiceCapability.DigitalTwinReader,
      'Consent.source-reference': DEMO_SMART_ACCESS_LOCAL_IDS.researchRoleConsentSourceReference,
    });
    expect(Object.hasOwn(consent, ClaimConsent.identifier)).toBe(false);
    expect(Object.hasOwn(consent, ClaimConsent.attachmentContentType)).toBe(false);
    expect(Object.hasOwn(consent, ClaimConsent.attachmentData)).toBe(false);
  });

  it('builds one provider research permit by direct email rooted at ResearchSubject.rs', () => {
    expect(buildDemoResearchPermitByEmailConsent({ subjectDid })).toMatchObject({
      'Consent.subject': subjectDid,
      'Consent.actor-identifier': DEMO_SMART_ACCESS_LOCAL_EMAILS.researchAllowed,
      'Consent.actor-role': HealthcareActorRoles.Physician,
      'Consent.purpose': EXAMPLE_INTER_TENANT_ACCESS_CONTRACT_PURPOSE,
      'Consent.action': ServiceCapability.DigitalTwinReader,
    });
  });

  it('builds one explicit direct-email deny that overrides the broader role permit', () => {
    expect(buildDemoResearchDenyByEmailConsent({ subjectDid })).toMatchObject({
      'Consent.subject': subjectDid,
      'Consent.actor-identifier': DEMO_SMART_ACCESS_LOCAL_EMAILS.researchDenied,
      'Consent.actor-role': HealthcareActorRoles.Physician,
      'Consent.decision': ConsentDecisions.Deny,
      'Consent.purpose': EXAMPLE_INTER_TENANT_ACCESS_CONTRACT_PURPOSE,
      'Consent.action': ServiceCapability.DigitalTwinReader,
    });
  });

  it('builds one research requester matrix with allow and deny employee variants', () => {
    expect(buildDemoResearchRequesterMatrix()).toMatchObject({
      allowByRole: {
        actorEmail: DEMO_SMART_ACCESS_LOCAL_EMAILS.researchAllowed,
        actorRole: HealthcareActorRoles.Physician,
      },
      denyByRole: {
        actorEmail: DEMO_SMART_ACCESS_LOCAL_EMAILS.researchDenied,
        actorRole: HealthcareActorRoles.NursingProfessional,
      },
      allowByEmail: {
        actorEmail: DEMO_SMART_ACCESS_LOCAL_EMAILS.researchAllowed,
      },
      denyByEmail: {
        actorEmail: DEMO_SMART_ACCESS_LOCAL_EMAILS.researchDenied,
      },
    });
  });

  it('builds one research smart token request rooted at organization/ResearchSubject.rs', async () => {
    const matrix = buildDemoResearchRequesterMatrix();
    const providerOrganizationDid = 'did:web:localhost%3A3000:acme-id:cds-CA-BC:v1:animal-care';
    const payload = await buildDemoResearchSmartTokenRequest({
      tenantId,
      subjectDid,
      providerOrganizationDid,
      ...matrix.allowByRole,
    });

    expect(payload).toMatchObject({
      thid: DEMO_SMART_ACCESS_LOCAL_IDS.researchRoleSmartThreadId,
      body: {
        purpose: EXAMPLE_INTER_TENANT_ACCESS_CONTRACT_PURPOSE,
        scope: `${ServiceCapability.DigitalTwinReader}?subject=${encodeURIComponent(subjectDid)}`,
        sub: matrix.allowByRole.actorDid,
        client_assertion_type: 'client_assertion',
      },
    });
    const vpToken = String((payload as any).body.vp_token || '');
    expect(vpToken).toContain('verifiableCredential');
    expect(getMatchingInterTenantAccessContractFromVpToken(vpToken, {
      providerOrganizationDid,
      consumerOrganizationDid: DEMO_SMART_ACCESS_LOCAL_DIDS.consumerOrganizationDid,
      requiredCapabilities: [ServiceCapability.DigitalTwinReader],
      purpose: EXAMPLE_INTER_TENANT_ACCESS_CONTRACT_PURPOSE,
    })).toBeDefined();
  });

  it('builds one canonical ResearchSubject basic search request for ibuprofen', () => {
    const ibuprofenCode = demoCommunicationMedicationIpsDefaults.demoMedicationCases[0].demoMedicationCode;
    expect(buildDemoDigitalTwinResearchSubjectSearchRequest()).toEqual({
      thid: DEMO_SMART_ACCESS_LOCAL_IDS.digitalTwinSearchThreadId,
      body: {
        resourceType: 'Parameters',
        parameter: [
          { name: 'section', valueString: HealthcareBasicSections.HistoryOfMedicationUse.attributeValue },
          { name: MedicationStatementClaim.Code, valueString: ibuprofenCode },
        ],
      },
    });
  });
});
