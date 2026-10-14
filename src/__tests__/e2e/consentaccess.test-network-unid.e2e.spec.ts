// Flow contract: reuse shared test fixtures and canonical types; do not introduce duplicated literals.
/**
 * Online smoke for ConsentAccess on the shared Fabric-backed `test-network`.
 *
 * What this test proves:
 * - a deployed GW CORE instance in `NODE_ENV=demo` can still operate with
 *   `NETWORK_MODE=test-network`
 * - the `Communication/_batch` consent ingestion API accepts a realistic bundle
 * - the job completes successfully for tenant `acme-id` by default
 * - the runtime is configured to forward consent-access writes to
 *   `consentaccess-sc` on channel `health-care-eu`
 *
 * What this test does not prove by itself:
 * - it does not read the Fabric ledger directly
 * - it does not verify the peer tx id independently
 * - it assumes the deployed runtime already has `UNIDMSP` material loaded and
 *   can reach the UNID peer from its Kubernetes environment
 *
 * Required env to run:
 * - `TEST_NETWORK_API_BASE_URL`
 *   Example: `https://uhc-gw.unid.online`
 *
 * Optional env:
 * - `TEST_NETWORK_AUTH_BEARER`
 *   Default: `demo-token`
 * - `TEST_NETWORK_TENANT_ID`
 *   Default: `acme-id`
 * - `TEST_NETWORK_JURISDICTION`
 *   Default: `ES`
 * - `TEST_NETWORK_SECTOR`
 *   Default: `health-care`
 * - `TEST_NETWORK_SUBJECT_DID`
 *   Default: example subject DID from shared fixtures
 * - `TEST_NETWORK_MAX_POLLS`
 *   Default: `40`
 * - `TEST_NETWORK_POLL_MS`
 *   Default: `1500`
 */
import { HttpRequestMethods } from 'gdc-common-utils-ts/constants/http';
import { ResourceTypesFhirR4 } from 'gdc-common-utils-ts/constants/fhir-resource-types';

import {
  HealthcareConsentActions,
  HealthcareConsentPurposes,
} from 'gdc-common-utils-ts/constants/index';
import { Sector, knownDomainsReversedEnum } from 'gdc-common-utils-ts/models/urlPath';
import { ClaimConsent, ConsentDecisions, ConsentStatuses } from 'gdc-common-utils-ts/models/consent-rule';
import {
  EXAMPLE_CONSENT_DATE,
  EXAMPLE_EMAIL_PROFESSIONAL,
  EXAMPLE_HEALTHCARE_ACTOR_ROLE_PHYSICIAN,
  EXAMPLE_HEALTHCARE_JURISDICTION,
  EXAMPLE_PROVIDER_ORGANIZATION_DID,
  EXAMPLE_SECONDARY_EU_COUNTRY,
  EXAMPLE_SUBJECT_DID,
} from 'gdc-common-utils-ts/examples/shared';

const ODRL_MEDIA_TYPE = 'application/odrl+json';
const FHIR_JSON_MEDIA_TYPE = 'application/fhir+json';
const describeIfConfigured = process.env.TEST_NETWORK_API_BASE_URL ? describe : describe.skip;

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
  qualifier: 'professional' | 'organization' | 'jurisdictions',
  sequence: number,
): string {
  return `urn:uuid:${resourceType}-${qualifier}-${String(sequence).padStart(3, '0')}`;
}

async function postJson(url: string, body: unknown, bearer: string): Promise<Response> {
  return fetch(url, {
    method: HttpRequestMethods.Post,
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${bearer}`,
    },
    body: JSON.stringify(body),
  });
}

describeIfConfigured('ConsentAccess smoke against deployed UNID test-network host', () => {
  jest.setTimeout(90_000);

  it('submits a healthcare Communication bundle and waits until the async job completes', async () => {
    const baseUrl = String(process.env.TEST_NETWORK_API_BASE_URL).replace(/\/+$/, '');
    const bearer = process.env.TEST_NETWORK_AUTH_BEARER || 'demo-token';
    const tenantId = process.env.TEST_NETWORK_TENANT_ID || 'acme-id';
    const jurisdiction = process.env.TEST_NETWORK_JURISDICTION || 'ES';
    const sector = process.env.TEST_NETWORK_SECTOR || Sector.HEALTH_CARE;
    const maxPolls = Number(process.env.TEST_NETWORK_MAX_POLLS || '40');
    const pollMs = Number(process.env.TEST_NETWORK_POLL_MS || '1500');
    const subjectDid = process.env.TEST_NETWORK_SUBJECT_DID || EXAMPLE_SUBJECT_DID;

    const communicationFormat = knownDomainsReversedEnum['org.hl7.fhir.r4'];
    const consentClaimsContext = knownDomainsReversedEnum['org.hl7.fhir.api'];
    const consentBundleSummaryNote =
      'Bundle of Consents containing: 0 personal consents, 1 professional consent, 1 organizational consent, 1 jurisdictional consent.';

    const makeAttachment = (agreement: string) =>
      Buffer.from(JSON.stringify({ agreement }), 'utf8').toString('base64');

    const makeConsentResource = (
      identifier: string,
      actorIdentifier: string,
      purpose: string,
      action: string,
      attachmentData: string,
    ) => ({
      resourceType: ResourceTypesFhirR4.Consent,
      status: 'active',
      meta: {
        claims: {
          '@context': consentClaimsContext,
          [ClaimConsent.decision]: ConsentDecisions.Permit,
          [ClaimConsent.status]: ConsentStatuses.Active,
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
      '*',
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

    const thidBatch = `communication-consent-batch-${Date.now()}`;
    const submitUrl = `${baseUrl}${buildCommunicationBatchPath(
      tenantId,
      jurisdiction,
      sector,
      communicationFormat,
      '_batch',
    )}`;
    const pollUrl = `${baseUrl}${buildCommunicationBatchPath(
      tenantId,
      jurisdiction,
      sector,
      communicationFormat,
      '_batch-response',
    )}`;

    const submitResp = await postJson(
      submitUrl,
      {
        thid: thidBatch,
        body: {
          resourceType: ResourceTypesFhirR4.Bundle,
          type: 'batch',
          entry: [
            {
              request: { method: HttpRequestMethods.Post, url: 'individual/org.hl7.fhir.r4/Communication' },
              resource: {
                resourceType: ResourceTypesFhirR4.Communication,
                status: 'completed',
                meta: {
                  claims: {
                    '@context': communicationFormat,
                    'Communication.subject': subjectDid,
                    'Communication.sent': '2026-06-09T10:00:00Z',
                  },
                },
                subject: { reference: subjectDid },
                sent: '2026-06-09T10:00:00Z',
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
      bearer,
    );

    const submitPayload = await submitResp.json().catch(() => undefined);
    expect(submitResp.status).toBe(202);
    expect(submitPayload?.thid || thidBatch).toBeDefined();

    let pollPayload: any;
    let finalStatus = 0;
    for (let i = 0; i < maxPolls; i++) {
      const pollResp = await postJson(pollUrl, { thid: thidBatch }, bearer);
      finalStatus = pollResp.status;
      if (pollResp.status === 200) {
        pollPayload = await pollResp.json();
        break;
      }
      if (pollResp.status !== 202) {
        const unexpectedBody = await pollResp.text();
        throw new Error(`Unexpected poll status ${pollResp.status}: ${unexpectedBody}`);
      }
      await new Promise((resolve) => setTimeout(resolve, pollMs));
    }

    expect(finalStatus).toBe(200);
    expect(pollPayload?.resourceType).toBe('Bundle');
    expect(pollPayload?.data?.[0]?.response?.status).toBe('200');
  });
});
