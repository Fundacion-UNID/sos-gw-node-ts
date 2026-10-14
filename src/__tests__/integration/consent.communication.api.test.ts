// Flow contract: reuse shared test fixtures and canonical types; do not introduce duplicated literals.
import { resolveHostPhysicalCollectionName } from '../../config/storage-layout';
// Flow contract: locally authored Consent projections require one cryptographically verified actor and dual-profile search readback.
import { extractBundleSearchResources } from 'gdc-common-utils-ts/utils/organization-employee-lifecycle';
import { invokeExpress } from './helpers/invokeExpress';
import { getTenantVaultId, generateTenantCollectionNameFromClaims } from '../../utils/tenant';
import { ClaimsOrganizationSchemaorg, ClaimsServiceSchemaorg } from 'gdc-common-utils-ts/constants/schemaorg';
import {
  HealthcareConsentActions,
  HealthcareConsentPurposes,
} from 'gdc-common-utils-ts/constants/index';
import {
  getHealthcareRoleByClaim,
  HealthcareActorRoles,
} from 'gdc-common-utils-ts/constants/healthcare';
import { testPayloadCreateTenant1 } from '../data/end-to-end.data';
import { initializeTenantServicesConfig } from '../../utils/services';
import { Sector } from 'gdc-common-utils-ts/models/urlPath';
import { startServer, resetServerConfig } from '../../server';
import { getEnvSectionId } from '../../utils/section-env';
import { getIndividualSectionId, getSubjectScopedSectionId } from '../../utils/individual-sections';
import { ClaimConsent } from 'gdc-common-utils-ts/models/consent-rule';
import { ConsentDecisions, ConsentStatuses } from 'gdc-common-utils-ts/models/consent-rule';
import { getClaimValue } from '../../utils/claims';
import { testTenant1TenantId } from '../data/organization.data';
import { knownDomainsReversedEnum } from 'gdc-common-utils-ts/models/urlPath';
import {
  EXAMPLE_CONSENT_DATE,
  EXAMPLE_EMAIL_PROFESSIONAL,
  EXAMPLE_HEALTHCARE_ACTOR_ROLE_PHYSICIAN,
  EXAMPLE_HEALTHCARE_JURISDICTION,
  EXAMPLE_PROVIDER_ORGANIZATION_DID,
  EXAMPLE_SECONDARY_EU_COUNTRY,
  EXAMPLE_SUBJECT_DID,
} from 'gdc-common-utils-ts/examples/shared';
import { configureAuthenticatedTestActor } from './helpers/authenticated-test-actor';
import { CommunicationClaim } from 'gdc-common-utils-ts/models/interoperable-claims/communication-claims';

const ODRL_MEDIA_TYPE = 'application/odrl+json';
const FHIR_JSON_MEDIA_TYPE = 'application/fhir+json';

function buildCommunicationBatchPath(
  tenantId: string,
  jurisdiction: string,
  sector: string,
  format: string,
  action: '_batch' | '_batch-response',
): string {
  return `/${tenantId}/cds-${jurisdiction}/v1/${sector}/individual/${format}/Communication/${action}`;
}

function buildIdentifierUuidForTesting(
  resourceType: 'consent',
  qualifier: 'professional' | 'organization' | 'jurisdictions' | 'draft',
  sequence: number,
): string {
  return `urn:uuid:${resourceType}-${qualifier}-${String(sequence).padStart(3, '0')}`;
}

describe('Consent via Communication API (integration)', () => {
  afterEach(() => {
    resetServerConfig();
  });

  it('ingests three separate consent permissions via Communication and persists readable consent projections', async () => {
    process.env.NODE_ENV = 'test';
    process.env.DB_PROVIDER = 'mem';
    process.env.STORAGE_PROVIDER = 'mem';
    process.env.QUEUE_PROVIDER = 'mem';
    process.env.SECTORS_ALLOWED = 'health-care';
    process.env.ORG_HOST_LEGAL_NAME = 'Gateway Host Services';
    process.env.ORG_HOST_JURISDICTION = 'ES';
    process.env.ORG_HOST_ID_TYPE = 'TAX';
    process.env.ORG_HOST_ID_VALUE = 'A0011223344';
    process.env.ORG_HOST_ADMIN_EMAIL = 'admin@host.com';
    process.env.ORG_HOST_ADMIN_UID = 'host-admin-001';
    process.env.ORG_HOST_ADMIN_ROLE = 'ISCO-08|1111';
    process.env.SECURITY_MODE = 'demo';
    process.env.JSON_LEGACY = 'true';
    const authenticatedActor = await configureAuthenticatedTestActor();

    resetServerConfig();

    const { app, queueAdapter, tenantManager, vaultRepository, kmsService } = await startServer({ listen: false });
    try {
      const hostBootstrapClaims = {
        [ClaimsOrganizationSchemaorg.addressCountry]: process.env.ORG_HOST_JURISDICTION,
        [ClaimsOrganizationSchemaorg.identifierType]: process.env.ORG_HOST_ID_TYPE,
        [ClaimsOrganizationSchemaorg.identifierValue]: process.env.ORG_HOST_ID_VALUE,
        [ClaimsServiceSchemaorg.category]: Sector.SYSTEM,
      };
      const hostCollectionName = resolveHostPhysicalCollectionName();
      const tenantClaims = testPayloadCreateTenant1.body.data[0].resource.meta.claims as any;
      const tenantVaultId = getTenantVaultId(
        tenantClaims[ClaimsServiceSchemaorg.category],
        testTenant1TenantId,
      );

      const tenantConfig = {
        claims: tenantClaims,
        didConfig: { service: initializeTenantServicesConfig(Sector.HEALTH_CARE) },
        didDocument: { id: 'did:web:api.acme.org', '@context': 'https://www.w3.org/ns/did/v1' },
      };

      await kmsService.provisionKeys(tenantVaultId);
      const secureTenantRecord = await kmsService.protectConfidentialData(
        { id: tenantVaultId, sequence: 0, content: tenantConfig } as any,
        'host',
      );
      await vaultRepository.put(hostCollectionName, [secureTenantRecord as any], getEnvSectionId('tenants'));
      await tenantManager.getTenant(tenantVaultId);

      const subjectDid = EXAMPLE_SUBJECT_DID;
      const consentBundleSummaryNote = 'Bundle of Consents containing: 0 personal consents, 1 professional consent, 1 organizational consent, 1 jurisdictional consent.';
      const allSectionsWildcard = '*';
      const communicationFormat = knownDomainsReversedEnum['org.hl7.fhir.r4'];
      const consentClaimsContext = knownDomainsReversedEnum['org.hl7.fhir.api'];
      const makeAttachment = (agreement: string) => Buffer.from(
        JSON.stringify({ agreement }),
        'utf8',
      ).toString('base64');
      const makeConsentResource = (
        identifier: string,
        actorIdentifier: string,
        purpose: string,
        action: string,
        attachmentData: string,
      ) => ({
        resourceType: 'Consent',
        status: 'active',
        meta: {
          claims: {
            '@context': consentClaimsContext,
            [ClaimConsent.decision]: ConsentDecisions.Permit,
            [ClaimConsent.subject]: subjectDid,
            [ClaimConsent.identifier]: identifier,
            [ClaimConsent.grantee]: actorIdentifier,
            [ClaimConsent.date]: EXAMPLE_CONSENT_DATE,
            [ClaimConsent.purpose]: purpose,
            [ClaimConsent.action]: action,
            [ClaimConsent.actorIdentifier]: actorIdentifier,
            [ClaimConsent.actorRole]: EXAMPLE_HEALTHCARE_ACTOR_ROLE_PHYSICIAN,
            [ClaimConsent.attachmentContentType]: ODRL_MEDIA_TYPE,
            [ClaimConsent.attachmentData]: attachmentData,
          },
        },
      });

      const consent1 = makeConsentResource(
        buildIdentifierUuidForTesting('consent', 'professional', 1),
        EXAMPLE_EMAIL_PROFESSIONAL,
        HealthcareConsentPurposes.Treatment,
        allSectionsWildcard,
        makeAttachment('professional full IPS access'),
      );
      const consent2 = makeConsentResource(
        buildIdentifierUuidForTesting('consent', 'organization', 1),
        EXAMPLE_PROVIDER_ORGANIZATION_DID,
        HealthcareConsentPurposes.EmergencyTreatment,
        HealthcareConsentActions.PatientSummaryDocument,
        makeAttachment('organization emergency treatment access'),
      );
      const consent3 = makeConsentResource(
        buildIdentifierUuidForTesting('consent', 'jurisdictions', 1),
        `${EXAMPLE_HEALTHCARE_JURISDICTION},${EXAMPLE_SECONDARY_EU_COUNTRY}`,
        HealthcareConsentPurposes.EmergencyTreatment,
        HealthcareConsentActions.PatientSummaryDocument,
        makeAttachment('jurisdiction emergency treatment access'),
      );

      const thidBatch = 'communication-consent-batch-001';
      const submitResp = await invokeExpress(app, {
        method: 'POST',
        url: buildCommunicationBatchPath(
          testTenant1TenantId,
          EXAMPLE_HEALTHCARE_JURISDICTION,
          Sector.HEALTH_CARE,
          communicationFormat,
          '_batch',
        ),
        headers: { 'content-type': 'application/json', authorization: authenticatedActor.authorizationHeader },
        body: {
          thid: thidBatch,
          body: {
            resourceType: 'Bundle',
            type: 'batch',
            entry: [
              {
                request: { method: 'POST', url: 'individual/org.hl7.fhir.r4/Communication' },
                resource: {
                  resourceType: 'Communication',
                  status: 'completed',
                  meta: {
                    claims: {
                      '@context': communicationFormat,
                      'Communication.subject': subjectDid,
                      'Communication.sent': '2026-05-22T10:00:00Z',
                    },
                  },
                  subject: { reference: subjectDid },
                  sent: '2026-05-22T10:00:00Z',
                  note: [{ text: consentBundleSummaryNote }],
                  payload: [
                    {
                      contentAttachment: {
                        contentType: FHIR_JSON_MEDIA_TYPE,
                        title: 'consent-professional.json',
                        data: Buffer.from(JSON.stringify(consent1), 'utf8').toString('base64'),
                      },
                    },
                    {
                      contentAttachment: {
                        contentType: FHIR_JSON_MEDIA_TYPE,
                        title: 'consent-organization.json',
                        data: Buffer.from(JSON.stringify(consent2), 'utf8').toString('base64'),
                      },
                    },
                    {
                      contentAttachment: {
                        contentType: FHIR_JSON_MEDIA_TYPE,
                        title: 'consent-jurisdictions.json',
                        data: Buffer.from(JSON.stringify(consent3), 'utf8').toString('base64'),
                      },
                    },
                  ],
                },
              },
            ],
          },
        },
      });
      expect(submitResp.status).toBe(202);

      let batchPayload: any;
      for (let i = 0; i < 50; i++) {
        const pollResp = await invokeExpress(app, {
          method: 'POST',
          url: buildCommunicationBatchPath(
            testTenant1TenantId,
            EXAMPLE_HEALTHCARE_JURISDICTION,
            Sector.HEALTH_CARE,
            communicationFormat,
            '_batch-response',
          ),
          headers: { 'content-type': 'application/json' },
          body: { thid: thidBatch },
        });
        if (pollResp.status === 200) {
          batchPayload = JSON.parse(pollResp.text);
          break;
        }
        await new Promise((r) => setTimeout(r, 50));
      }

      expect(batchPayload?.resourceType).toBe('Bundle');
      expect(batchPayload?.data?.[0]?.response?.status).toBe('200');

      const attachments = await vaultRepository.getContainersInSection(
        tenantVaultId,
        getIndividualSectionId(subjectDid, 'attachments'),
      );
      const rules = await vaultRepository.getContainersInSection(
        tenantVaultId,
        getIndividualSectionId(subjectDid, 'rules'),
      );
      const consents = await vaultRepository.getContainersInSection(
        tenantVaultId,
        getSubjectScopedSectionId(subjectDid, 'individual', 'consents'),
      );

      expect(attachments).toHaveLength(3);
      expect(rules).toHaveLength(3);
      expect(consents).toHaveLength(3);
      expect(rules.map((rule: any) => getClaimValue(rule, ClaimConsent.identifier)).sort()).toEqual([
        buildIdentifierUuidForTesting('consent', 'jurisdictions', 1),
        buildIdentifierUuidForTesting('consent', 'organization', 1),
        buildIdentifierUuidForTesting('consent', 'professional', 1),
      ]);
      expect(rules.every((rule: any) => !getClaimValue(rule, ClaimConsent.attachmentData))).toBe(true);
      expect(consents.map((consent: any) => getClaimValue(consent, ClaimConsent.identifier)).sort()).toEqual([
        buildIdentifierUuidForTesting('consent', 'jurisdictions', 1),
        buildIdentifierUuidForTesting('consent', 'organization', 1),
        buildIdentifierUuidForTesting('consent', 'professional', 1),
      ]);
      expect(consents.map((consent: any) => getClaimValue(consent, ClaimConsent.actorIdentifier)).sort()).toEqual([
        `${EXAMPLE_HEALTHCARE_JURISDICTION},${EXAMPLE_SECONDARY_EU_COUNTRY}`,
        EXAMPLE_PROVIDER_ORGANIZATION_DID,
        EXAMPLE_EMAIL_PROFESSIONAL,
      ]);
      expect(consents.map((consent: any) => getClaimValue(consent, ClaimConsent.purpose)).sort()).toEqual([
        HealthcareConsentPurposes.EmergencyTreatment,
        HealthcareConsentPurposes.EmergencyTreatment,
        HealthcareConsentPurposes.Treatment,
      ].sort());
      const physician = getHealthcareRoleByClaim(HealthcareActorRoles.Physician);
      expect(physician).toBeDefined();
      const canonicalPhysicianRole = `${physician!.codingSystem}|${physician!.code}`;
      expect(consents.map((consent: any) => getClaimValue(consent, ClaimConsent.actorRole))).toEqual([
        canonicalPhysicianRole,
        canonicalPhysicianRole,
        canonicalPhysicianRole,
      ]);

      // A request uses the same FHIR Consent vocabulary as the eventual rule,
      // but `draft` keeps it inbox-only until the controller accepts it.
      const draftConsentBase = makeConsentResource(
        buildIdentifierUuidForTesting('consent', 'draft', 1),
        EXAMPLE_EMAIL_PROFESSIONAL,
        HealthcareConsentPurposes.Treatment,
        HealthcareConsentActions.PatientSummaryDocument,
        makeAttachment('draft professional access request'),
      );
      const draftConsent = {
        ...draftConsentBase,
        status: ConsentStatuses.Draft,
        meta: {
          ...draftConsentBase.meta,
          claims: {
            ...draftConsentBase.meta.claims,
            [ClaimConsent.status]: ConsentStatuses.Draft,
          },
        },
      };
      const draftConsentBundle = {
        resourceType: 'Bundle',
        type: 'batch',
        entry: [{
          request: { method: 'POST', url: 'Consent' },
          resource: draftConsent,
        }],
      };
      const thidDraft = 'communication-consent-draft-001';
      const draftSubmitResp = await invokeExpress(app, {
        method: 'POST',
        url: buildCommunicationBatchPath(
          testTenant1TenantId,
          EXAMPLE_HEALTHCARE_JURISDICTION,
          Sector.HEALTH_CARE,
          communicationFormat,
          '_batch',
        ),
        headers: { 'content-type': 'application/json', authorization: authenticatedActor.authorizationHeader },
        body: {
          thid: thidDraft,
          body: {
            resourceType: 'Bundle',
            type: 'batch',
            entry: [{
              request: { method: 'POST', url: 'individual/org.hl7.fhir.r4/Communication' },
              resource: {
                resourceType: 'Communication',
                status: 'completed',
                subject: { reference: subjectDid },
                payload: [{
                  contentAttachment: {
                    contentType: FHIR_JSON_MEDIA_TYPE,
                    title: 'draft-consent-request.json',
                    data: Buffer.from(JSON.stringify(draftConsentBundle), 'utf8').toString('base64'),
                  },
                }],
              },
            }],
          },
        },
      });
      expect(draftSubmitResp.status).toBe(202);

      let draftPayload: any;
      for (let i = 0; i < 50; i++) {
        const pollResp = await invokeExpress(app, {
          method: 'POST',
          url: buildCommunicationBatchPath(
            testTenant1TenantId,
            EXAMPLE_HEALTHCARE_JURISDICTION,
            Sector.HEALTH_CARE,
            communicationFormat,
            '_batch-response',
          ),
          headers: { 'content-type': 'application/json' },
          body: { thid: thidDraft },
        });
        if (pollResp.status === 200) {
          draftPayload = JSON.parse(pollResp.text);
          break;
        }
        await new Promise((r) => setTimeout(r, 50));
      }
      expect(draftPayload?.data?.[0]?.response?.status).toBe('200');
      expect(await vaultRepository.getContainersInSection(
        tenantVaultId,
        getIndividualSectionId(subjectDid, 'rules'),
      )).toHaveLength(3);

      const thidRead = 'communication-consent-read-001';
      const readResp = await invokeExpress(app, {
        method: 'POST',
        url: buildCommunicationBatchPath(
          testTenant1TenantId,
          EXAMPLE_HEALTHCARE_JURISDICTION,
          Sector.HEALTH_CARE,
          communicationFormat,
          '_batch',
        ),
        headers: { 'content-type': 'application/json', authorization: authenticatedActor.authorizationHeader },
        body: {
          thid: thidRead,
          body: {
            resourceType: 'Bundle',
            type: 'batch',
            entry: [
              {
                request: { method: 'POST', url: 'individual/org.hl7.fhir.r4/Communication' },
                resource: {
                  resourceType: 'Communication',
                  status: 'completed',
                  subject: { reference: subjectDid },
                  payload: [
                    {
                      contentReference: {
                        reference: 'individual/org.hl7.fhir.api/Subject/_search',
                      },
                      contentAttachment: {
                        contentType: FHIR_JSON_MEDIA_TYPE,
                        title: 'subject-consent-search-parameters.json',
                        data: Buffer.from(JSON.stringify({
                          resourceType: 'Parameters',
                          parameter: [
                            { name: 'subject', valueString: subjectDid },
                          ],
                        }), 'utf8').toString('base64'),
                      },
                    },
                  ],
                },
              },
            ],
          },
        },
      });
      expect(readResp.status).toBe(202);

      let readPayload: any;
      for (let i = 0; i < 50; i++) {
        const pollResp = await invokeExpress(app, {
          method: 'POST',
          url: buildCommunicationBatchPath(
            testTenant1TenantId,
            EXAMPLE_HEALTHCARE_JURISDICTION,
            Sector.HEALTH_CARE,
            communicationFormat,
            '_batch-response',
          ),
          headers: { 'content-type': 'application/json' },
          body: { thid: thidRead },
        });
        if (pollResp.status === 200) {
          readPayload = JSON.parse(pollResp.text);
          break;
        }
        await new Promise((r) => setTimeout(r, 50));
      }

      expect(readPayload?.resourceType).toBe('Bundle');
      expect(readPayload?.data?.[0]?.response?.status).toBe('200');
      expect(readPayload?.data?.[0]?.type).toBe('Subject-search-response-v1.0');
      expect(extractBundleSearchResources(readPayload)).toHaveLength(3);

      const communications = await vaultRepository.getContainersInSection(
        tenantVaultId,
        getSubjectScopedSectionId(subjectDid, 'individual', 'communications'),
      );
      expect(communications).toHaveLength(3);
      const readableCommunicationClaims = await Promise.all(communications.map(async (communication: any) => {
        const content = await kmsService.unprotectConfidentialData<any>(communication, tenantVaultId);
        return content?.claims;
      }));
      expect(
        readableCommunicationClaims.some((claims: any) => claims?.[CommunicationClaim.NoteText] === consentBundleSummaryNote),
      ).toBe(true);
    } finally {
      queueAdapter.stop();
    }
  });
});
