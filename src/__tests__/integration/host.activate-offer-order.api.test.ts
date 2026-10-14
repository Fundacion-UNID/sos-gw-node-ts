// Flow contract: reuse shared test fixtures and canonical types; do not introduce duplicated literals.
process.env.DEV_SEED = 'true';
process.env.NODE_ENV = 'test';
process.env.SECURITY_MODE = 'demo';
process.env.NETWORK_MODE = 'local-network';
process.env.JSON_LEGACY = 'true';
process.env.FHIR_LEGACY = 'true';
process.env.DIDCOMM_PLAIN = 'true';
process.env.DEMO_ALLOW_INSECURE_BEARER = 'true';
process.env.DB_PROVIDER = 'mem';
process.env.STORAGE_PROVIDER = 'mem';
process.env.QUEUE_PROVIDER = 'mem';
process.env.MAINSECTOR = 'health';
process.env.SUBSECTORSALLOWED = 'care';
process.env.HOST_EXTERNAL_DOMAIN = 'host.example.com';
process.env.HOST_LEGAL_NAME = 'Test Host';
process.env.HOST_JURISDICTION = 'ES';
process.env.HOST_ID_TYPE = 'TAX';
process.env.HOST_ID_VALUE = 'VATES-B00000000';
process.env.HOST_ADMIN_EMAIL = 'host-admin@example.com';
process.env.HOST_ADMIN_UID = 'host-admin';
process.env.HOST_ADMIN_ROLE = 'RESPRSN';
process.env.HOST_TERMS_URL = 'https://host.example.com/terms';
process.env.LEDGER_ENABLED = 'true';
process.env.LEDGER_MSP_ID = 'TestMSP';

import { afterAll, afterEach, beforeAll, describe, expect, it, jest } from '@jest/globals';
import { HttpRequestMethods } from 'gdc-common-utils-ts/constants/http';
import type * as express from 'express';
import type { Server } from 'http';
import type { QueueAdapterMem } from '../../adapters/queue-mem';
import { startServer, resetServerConfig } from '../../server';
import { invokeExpress } from './helpers/invokeExpress';
import {
  ClaimsOfferSchemaorg,
  ClaimsOrderSchemaorg,
  ClaimsOrganizationSchemaorg,
  ClaimsServiceSchemaorg,
} from 'gdc-common-utils-ts/constants/schemaorg';
import { testClaimsTenant1Registration } from '../data/end-to-end.data';
import { ORGANIZATION_ORDER_REQUEST } from '../data/example-payloads';
import { ManageAssetOrganization } from '../../blockchain/fabric/v3/manageAssetOrganization';
import { ManageAssetCryptographicKey } from '../../blockchain/fabric/v3/manageAssetCryptographicKey';
import { ManageAssetSubjectKeyBinding } from '../../blockchain/fabric/v3/manageAssetSubjectKeyBinding';
import { ManageAssetArtifact } from '../../blockchain/fabric/v3/manageAssetArtifact';

function buildActivationPayload(): Record<string, unknown> {
  const vpTokenCompact = [
    Buffer.from(JSON.stringify({ alg: 'ML-DSA-44', typ: 'JWT' })).toString('base64url'),
    Buffer.from(JSON.stringify({
      sub: 'did:web:controller.example.com',
      vp: {
        verifiableCredential: [
          {
            '@context': ['https://www.w3.org/2018/credentials/v1'],
            type: ['VerifiableCredential', 'OrganizationCredential'],
            credentialSubject: {
              id: 'did:web:api.acme.org',
              taxID: 'VATES-B00112233',
              category: testClaimsTenant1Registration[ClaimsServiceSchemaorg.category],
              serviceType: testClaimsTenant1Registration[ClaimsServiceSchemaorg.serviceType],
            },
          },
          {
            '@context': ['https://www.w3.org/2018/credentials/v1'],
            type: ['VerifiableCredential', 'LegalRepresentativeCredential'],
            credentialSubject: {
              id: 'urn:person:identifier:controller-001',
              memberOf: {
                taxID: 'VATES-B00112233',
              },
              hasOccupation: {
                identifier: {
                  value: 'RESPRSN',
                },
              },
              hasCredential: {
                material: 'controller-sig-kid',
              },
            },
          },
        ],
      },
    })).toString('base64url'),
    'mock-signature',
  ].join('.');

  return {
    thid: 'activation-route-story-thid',
    jti: 'activation-route-story-jti',
    iss: 'did:web:controller.example.com',
    aud: 'did:web:host.example.com',
    type: 'application/json',
    body: {
      vp_token: vpTokenCompact,
      organizationCredential: {
        '@context': ['https://www.w3.org/2018/credentials/v1'],
        type: ['VerifiableCredential'],
        credentialSubject: {
          id: 'did:web:api.acme.org',
          taxID: 'VATES-B00112233',
          category: testClaimsTenant1Registration[ClaimsServiceSchemaorg.category],
          serviceType: testClaimsTenant1Registration[ClaimsServiceSchemaorg.serviceType],
        },
      },
      representativeCredential: {
        '@context': ['https://www.w3.org/2018/credentials/v1'],
        type: ['VerifiableCredential'],
        credentialSubject: {
          id: 'urn:person:identifier:controller-001',
          memberOf: {
            taxID: 'VATES-B00112233',
          },
          hasOccupation: { identifier: { value: 'RESPRSN' } },
          hasCredential: { material: 'controller-sig-kid' },
        },
      },
      data: [
        {
          type: 'Organization-activation-request-v1.0',
          meta: {},
          resource: {
            meta: {
              claims: { ...testClaimsTenant1Registration },
            },
          },
          request: { method: 'POST' },
        },
      ],
    },
    meta: {
      jws: {
        protected: {
          alg: 'ML-DSA-44',
          kid: 'controller-sig-kid',
          jwk: { kty: 'AKP', alg: 'ML-DSA-44', pub: 'controller-sig-pub' },
        },
      },
      jwe: {
        header: {
          enc: 'A256GCM',
          skid: 'controller-enc-kid',
          jwk: { kty: 'OKP', crv: 'ML-KEM-768', x: 'controller-enc-x' },
        },
      },
    },
  };
}

describe('Host activation Offer/Order route story', () => {
  let app: express.Express;
  let server: Server | undefined;
  let queueAdapter: QueueAdapterMem;
  const originalFetch = global.fetch;
  let ensureKeySpy: ReturnType<typeof jest.spyOn>;

  beforeAll(async () => {
    resetServerConfig();
    global.fetch = jest.fn(async () => ({
      ok: true,
      status: 200,
      headers: {
        get: (name: string) => name.toLowerCase() === 'content-type' ? 'application/json' : null,
      },
      json: async () => ({}),
      text: async () => '',
    })) as any;
    jest.spyOn(ManageAssetOrganization.prototype, 'ensureOrganization').mockResolvedValue({
      created: false,
      asset: {},
    } as any);
    ensureKeySpy = jest.spyOn(ManageAssetCryptographicKey.prototype, 'ensureKey').mockResolvedValue({
      created: false,
      asset: {},
    } as any);
    jest.spyOn(ManageAssetSubjectKeyBinding.prototype, 'upsertSubjectKeyBinding').mockResolvedValue({} as any);
    jest.spyOn(ManageAssetArtifact.prototype, 'read').mockRejectedValue(new Error('not found'));
    jest.spyOn(ManageAssetArtifact.prototype, 'upsertArtifact').mockResolvedValue({} as any);
    const serverInstance = await startServer({ listen: false });
    app = serverInstance.app;
    server = serverInstance.server;
    queueAdapter = serverInstance.queueAdapter as QueueAdapterMem;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  afterAll(async () => {
    resetServerConfig();
    global.fetch = originalFetch;
    if (queueAdapter) {
      queueAdapter.stop();
    }
    if (server) {
      await new Promise<void>((resolve, reject) => {
        server!.close((err: any) => {
          if (err) return reject(err);
          resolve();
        });
      });
    }
  });

  /**
   * Contract guard for the legacy activation flow.
   *
   * This test must fail if `_activate-response` returns `201` but does not
   * include the canonical Offer identifier in
   * `meta.claims['org.schema.Offer.identifier']`.
   *
   * Reason:
   * - `Order/_batch` must reuse that exact Offer id in
   *   `Order.acceptedOffer.identifier`
   * - validating only the final Order success is not enough, because a BFF/SDK
   *   can only continue if activation exposes the claim explicitly
   */
  it('legacy _activate-response exposes the canonical Offer identifier in meta.claims and Order reuses that exact value', async () => {
    const activationPayload = buildActivationPayload() as any;
    const activationUrl = '/host/cds-es/v1/local-network/registry/org.schema/Organization/_activate';
    const keyCallOffset = ensureKeySpy.mock.calls.length;

    const activationSubmit = await invokeExpress(app, {
      method: 'POST',
      url: activationUrl,
      headers: { 'content-type': 'application/json' },
      body: activationPayload,
    });

    expect(activationSubmit.status).toBe(202);
    expect(activationSubmit.headers.location).toContain('/_activate-response');

    await queueAdapter.waitForEmptyQueue();

    const activationPollPath = new URL(activationSubmit.headers.location, 'http://localhost').pathname;
    const activationPoll = await invokeExpress(app, {
      method: 'POST',
      url: activationPollPath,
      headers: { 'content-type': 'application/json' },
      body: { thid: activationPayload.thid },
    });

    expect(activationPoll.status).toBe(200);

    const activationResult = JSON.parse(activationPoll.text) as { data: Array<Record<string, any>> };
    const activationEntry = activationResult.data[0];
    const canonicalOfferId = activationEntry.resource?.meta?.claims?.[ClaimsOfferSchemaorg.identifier];
    const offerId = String(canonicalOfferId || '');

    expect(activationEntry.response.status).toBe('201');
    expect(activationEntry.type).toBe('Organization-activation-response-v1.0');
    expect(canonicalOfferId).toBeDefined();
    expect(typeof canonicalOfferId).toBe('string');
    expect(offerId).toContain(':Offer:');

    // The activation route may publish public and hosted DID aliases for each
    // physical JWK. It must submit each resulting thumbprint only once.
    const activationKeyCalls = ensureKeySpy.mock.calls.slice(keyCallOffset);
    const activationKeyIds = activationKeyCalls.map((call: any[]) => call[1]);
    expect(activationKeyIds.length).toBeGreaterThan(0);
    expect(new Set(activationKeyIds).size).toBe(activationKeyIds.length);

    const orderPayload = structuredClone(ORGANIZATION_ORDER_REQUEST) as any;
    orderPayload.thid = 'activation-route-order-thid';
    orderPayload.jti = 'activation-route-order-jti';
    orderPayload.iss = 'did:web:controller.example.com';
    orderPayload.aud = 'did:web:host.example.com';
    orderPayload.body.data[0].resource = orderPayload.body.data[0].resource || {};
    orderPayload.body.data[0].resource.meta = orderPayload.body.data[0].resource.meta || {};
    orderPayload.body.data[0].resource.meta.claims = {
      ...(orderPayload.body.data[0].resource?.meta?.claims || {}),
      [ClaimsOrderSchemaorg.acceptedOfferIdentifier]: offerId,
      [ClaimsOrderSchemaorg.paymentMethod]: 'Stripe',
      [ClaimsOrderSchemaorg.partOfInvoice]: 'in_activation_route_story',
    };
    orderPayload.body.data[0].meta = {};

    const orderSubmit = await invokeExpress(app, {
      method: 'POST',
      url: '/host/cds-es/v1/local-network/registry/org.schema/Order/_batch',
      headers: { 'content-type': 'application/json' },
      body: orderPayload,
    });

    expect(orderSubmit.status).toBe(202);
    expect(orderSubmit.headers.location).toContain('/_batch-response');

    await queueAdapter.waitForEmptyQueue();

    const orderPollPath = new URL(orderSubmit.headers.location, 'http://localhost').pathname;
    const orderPoll = await invokeExpress(app, {
      method: 'POST',
      url: orderPollPath,
      headers: { 'content-type': 'application/json' },
      body: { thid: orderPayload.thid },
    });

    expect(orderPoll.status).toBe(200);

    const orderResult = JSON.parse(orderPoll.text) as { data: Array<Record<string, any>> };
    const orderEntry = orderResult.data[0];

    // DEV_SEED already contains this tenant, so legacy re-registration is an
    // idempotent update and the Order reports the existing active resource.
    expect(orderEntry.response.status).toBe('200');
    expect(orderEntry.resource?.meta?.claims?.[ClaimsOrderSchemaorg.acceptedOfferIdentifier]).toBe(offerId);
  });

  /**
   * Consumer contract guard for host registry path construction.
   *
   * Host onboarding routes use the host registry network selector in the path
   * (`test`, `test-network`, `network`), not the tenant business sector
   * (`health-care`, etc.). A caller that reuses the Offer business sector in
   * the host Order URL must fail with 404 so the mismatch is explicit.
   */
  it('returns 404 when host Order/_batch uses the tenant business sector instead of the host registry network selector', async () => {
    const activationPayload = buildActivationPayload() as any;
    const uniqueTaxId = 'VATES-B00998877';
    const uniqueAlternateName = 'acme-wrong-sector';
    activationPayload.body.organizationCredential.credentialSubject.taxID = uniqueTaxId;
    activationPayload.body.representativeCredential.credentialSubject.memberOf.taxID = uniqueTaxId;
    activationPayload.body.data[0].resource.meta.claims[ClaimsOrganizationSchemaorg.identifierValue] = uniqueTaxId;
    activationPayload.body.data[0].resource.meta.claims[ClaimsOrganizationSchemaorg.taxId] = uniqueTaxId;
    activationPayload.body.data[0].resource.meta.claims[ClaimsOrganizationSchemaorg.alternateName] = uniqueAlternateName;

    const activationSubmit = await invokeExpress(app, {
      method: 'POST',
      url: '/host/cds-es/v1/local-network/registry/org.schema/Organization/_activate',
      headers: { 'content-type': 'application/json' },
      body: activationPayload,
    });

    expect(activationSubmit.status).toBe(202);
    await queueAdapter.waitForEmptyQueue();

    const activationPollPath = new URL(activationSubmit.headers.location, 'http://localhost').pathname;
    const activationPoll = await invokeExpress(app, {
      method: 'POST',
      url: activationPollPath,
      headers: { 'content-type': 'application/json' },
      body: { thid: activationPayload.thid },
    });

    expect(activationPoll.status).toBe(200);

    const activationResult = JSON.parse(activationPoll.text) as { data: Array<Record<string, any>> };
    const offerId = String(
      activationResult.data[0]?.resource?.meta?.claims?.[ClaimsOfferSchemaorg.identifier] || '',
    );
    expect(offerId).toContain(':Offer:');

    const orderPayload = structuredClone(ORGANIZATION_ORDER_REQUEST) as any;
    orderPayload.thid = 'activation-route-wrong-sector-order-thid';
    orderPayload.jti = 'activation-route-wrong-sector-order-jti';
    orderPayload.body.data[0].resource = {
      meta: {
        claims: {
          [ClaimsOrderSchemaorg.acceptedOfferIdentifier]: offerId,
          [ClaimsOrderSchemaorg.paymentMethod]: 'Stripe',
          [ClaimsOrderSchemaorg.partOfInvoice]: 'in_activation_wrong_sector_story',
        },
      },
    };
    orderPayload.body.data[0].meta = {};

    const wrongPathSubmit = await invokeExpress(app, {
      method: 'POST',
      url: '/host/cds-es/v1/health-care/registry/org.schema/Order/_batch',
      headers: { 'content-type': 'application/json' },
      body: orderPayload,
    });

    expect(wrongPathSubmit.status).toBe(404);
  });

  it('projects legal identity from the ICA OrganizationCredential when activation claims omit it', async () => {
    const activationPayload = buildActivationPayload() as any;
    const uniqueTaxId = 'VATES-B00997766';
    const credentialSubject = activationPayload.body.organizationCredential.credentialSubject;
    credentialSubject.taxID = uniqueTaxId;
    credentialSubject.legalName = 'ICA VERIFIED ORGANIZATION SL';
    credentialSubject.address = { addressCountry: 'ES' };
    activationPayload.body.representativeCredential.credentialSubject.memberOf.taxID = uniqueTaxId;

    const claims = activationPayload.body.data[0].resource.meta.claims;
    claims[ClaimsOrganizationSchemaorg.identifierValue] = uniqueTaxId;
    claims[ClaimsOrganizationSchemaorg.taxId] = uniqueTaxId;
    claims[ClaimsOrganizationSchemaorg.alternateName] = uniqueTaxId;
    delete claims[ClaimsOrganizationSchemaorg.legalName];
    delete claims[ClaimsOrganizationSchemaorg.addressCountry];

    const activationSubmit = await invokeExpress(app, {
      method: HttpRequestMethods.Post,
      url: '/host/cds-es/v1/local-network/registry/org.schema/Organization/_activate',
      headers: { 'content-type': 'application/json' },
      body: activationPayload,
    });

    expect(activationSubmit.status).toBe(202);
    await queueAdapter.waitForEmptyQueue();

    const activationPollPath = new URL(activationSubmit.headers.location, 'http://localhost').pathname;
    const activationPoll = await invokeExpress(app, {
      method: HttpRequestMethods.Post,
      url: activationPollPath,
      headers: { 'content-type': 'application/json' },
      body: { thid: activationPayload.thid },
    });
    const activationResult = JSON.parse(activationPoll.text) as { data: Array<Record<string, any>> };
    const resultClaims = activationResult.data[0]?.resource?.meta?.claims;

    expect(activationPoll.status).toBe(200);
    expect(activationResult.data[0]?.response?.status).toBe('201');
    expect(resultClaims?.[ClaimsOrganizationSchemaorg.legalName]).toBe('ICA VERIFIED ORGANIZATION SL');
    expect(resultClaims?.[ClaimsOrganizationSchemaorg.addressCountry]).toBe('ES');
  });
});
