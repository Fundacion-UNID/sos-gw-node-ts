/**
 * Live HostingManager -> connect-ica journey:
 * 1. Load one real, multi-signature terms PDF from the shared local fixture path.
 * 2. Submit the exact DIDComm plaintext envelope produced by HostingManager's ICA forwarding boundary.
 * 3. Follow connect-ica's 202 Location until the terminal verification response.
 * 4. Require successful Organization and LegalRepresentative credential entries from the same thread.
 *
 * Authorization invariant: connect-ica validates the PDF signatures against its configured local CA
 * trust material; this test never substitutes a mocked fetch or a direct Fabric-CA enrollment call.
 * Persistence invariant: the asynchronous terminal result is retrieved by the submitted thread id;
 * a failed/pending response, missing credential, or mismatched thread is never accepted as success.
 */
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { describe, expect, it } from '@jest/globals';
import type { JobRequest } from 'gdc-common-utils-ts/models/confidential-job';
import { DIDCOMM_PLAINTEXT_JSON_MEDIA_TYPE } from 'gdc-common-utils-ts/utils/didcomm-submit';
import { deriveDeterministicEcJwkPair } from 'gdc-common-utils-ts/utils/deterministic-jwk';
import { forwardOrganizationVerificationTransactionToIca } from '../../managers/hosting/ica-verification';

async function pollConnectIca(location: string, fallbackUrl?: string): Promise<any> {
  const pollingUrl = new URL(location, fallbackUrl).toString();
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const response = await fetch(pollingUrl, {
      method: 'POST',
      headers: {
        accept: DIDCOMM_PLAINTEXT_JSON_MEDIA_TYPE,
        'content-type': DIDCOMM_PLAINTEXT_JSON_MEDIA_TYPE,
      },
      body: '{}',
    });
    if (response.status === 202) {
      await new Promise((resolve) => setTimeout(resolve, 250));
      continue;
    }
    expect(response.status).toBe(200);
    return response.json();
  }
  throw new Error(`connect-ica polling did not reach a terminal response: ${pollingUrl}`);
}

describe('HostingManager live connect-ica boundary', () => {
  it(
    'submits and polls a real signed organization verification without bypassing connect-ica',
    async () => {
      const connectIcaUrl = process.env.ICA_CONNECT_URL;
      const fixturePath = process.env.ICA_REAL_TERMS_PDF_FIXTURE;
      const fixtureJurisdiction = process.env.ICA_REAL_TERMS_PDF_JURISDICTION;
      const networkKind = process.env.ICA_E2E_NETWORK_KIND;
      if (!connectIcaUrl) throw new Error('ICA_CONNECT_URL must be set for the live connect-ica E2E');
      if (!fixturePath) throw new Error('ICA_REAL_TERMS_PDF_FIXTURE must be set for the live connect-ica E2E');
      if (!fixtureJurisdiction) {
        throw new Error('ICA_REAL_TERMS_PDF_JURISDICTION must be set for the live connect-ica E2E');
      }
      if (!networkKind) throw new Error('ICA_E2E_NETWORK_KIND must be set for the live connect-ica E2E');

      const thid = `vet-gw-connect-ica-${Date.now()}`;
      const controllerPublicKeyJwk = deriveDeterministicEcJwkPair({
        seed: process.env.DEV_SEED || 'gwtemplate-demo-seed-001',
        purpose: 'hosting-connect-ica-e2e',
        alg: 'ES384',
      }).publicJwk;
      const organizationPublicKeyJwk = deriveDeterministicEcJwkPair({
        seed: process.env.DEV_SEED || 'gwtemplate-demo-seed-001',
        purpose: 'hosting-connect-ica-organization-e2e',
        alg: 'ES384',
      }).publicJwk;
      const controllerKeyId = String(controllerPublicKeyJwk.kid);
      const pdfBase64 = readFileSync(fixturePath).toString('base64');
      const job = {
        id: thid,
        tenantId: 'host',
        jurisdiction: fixtureJurisdiction,
        sector: 'animal-care',
        section: 'registry',
        format: 'org.schema',
        resourceType: 'Organization',
        action: '_transaction',
        sequence: 0,
        status: 'DRAFT',
        createdAtTimestamp: Date.now(),
        content: {
          jti: `${thid}-request`,
          thid,
          iss: 'did:web:host-vet.local',
          aud: 'did:web:ica.local',
          type: 'application/bundle-api+json',
          meta: {
            jws: {
              protected: {
                alg: 'ES384',
                kid: controllerKeyId,
                jwk: controllerPublicKeyJwk,
              },
            },
          },
          body: {},
          attachments: [{
            id: basename(fixturePath),
            media_type: 'application/pdf',
            data: { base64: pdfBase64 },
          }, {
            id: 'organization-key.jwk.json',
            media_type: 'application/jwk+json',
            data: { json: organizationPublicKeyJwk },
          }],
        },
      } as unknown as JobRequest;

      const payload = await forwardOrganizationVerificationTransactionToIca({
        job,
        entry: { type: 'Organization-verification-transaction-request-v1.0' },
        claims: {},
        resource: {
          organization: { publicKeyJwk: organizationPublicKeyJwk },
          controller: { publicKeyJwk: controllerPublicKeyJwk },
        },
        requestedSector: 'animal-care',
        resourceType: 'contract',
        organizationVerificationTransactionRequestType: 'Organization-verification-transaction-request-v1.0',
        icaDidcommPlainJsonMediaType: DIDCOMM_PLAINTEXT_JSON_MEDIA_TYPE,
        hostDid: 'did:web:host-vet.local',
        signHostAuthorizationPayload: async () => {
          throw new Error('PDF-backed ICA verification must not request a generated host proof.');
        },
        buildIcaVerifyUrl: (jurisdiction, sector, resourceType) => (
          `${connectIcaUrl.replace(/\/+$/, '')}/ica/cds-${jurisdiction}/v1/${sector}/${networkKind}/pdf/${resourceType}/_verify`
        ),
        pollIcaJsonResult: pollConnectIca,
      });

      expect(payload.thid).toBe(thid);
      const entries = payload.body?.data || [];
      expect(entries.find((entry: any) => entry.type === 'Organization-verification-v1.0')?.response?.status).toBe('200');
      expect(entries.find((entry: any) => entry.type === 'LegalRepresentative-verification-v1.0')?.response?.status).toBe('200');
      expect(entries.every((entry: any) => entry.resource?.status !== 'failed')).toBe(true);
    },
    30000,
  );
});
