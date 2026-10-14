/**
 * Flow contract: integration stories use one explicit synthetic ICA
 * jurisdiction, so commercial Offer/Order assertions exercise the intended
 * onboarding boundary instead of depending on a developer's local env file.
 */
process.env.DEV_SEED = 'true';
process.env.NODE_ENV = 'test';
process.env.SECURITY_MODE = 'demo';
process.env.NETWORK_MODE = 'test';
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
process.env.ICA_MODE = 'external';
process.env.ICA_URL_EXTERNAL = 'https://ica.example.com';
process.env.ICA_JURISDICTION = 'ES';

import type * as express from 'express';
import type { Server } from 'http';
import { jest } from '@jest/globals';
import type { QueueAdapterMem } from '../../../adapters/queue-mem';
import { startServer, resetServerConfig } from '../../../server';
import { invokeExpress } from './invokeExpress';
import {
  ClaimsOfferSchemaorg,
  ClaimsOrderSchemaorg,
  ClaimsOrganizationSchemaorg,
  ClaimsServiceSchemaorg,
} from 'gdc-common-utils-ts/constants/schemaorg';
import { testClaimsTenant1Registration } from '../../data/end-to-end.data';
import { ORGANIZATION_ORDER_REQUEST } from '../../data/example-payloads';

export type StoryHarness = {
  app: express.Express;
  server?: Server;
  queueAdapter: QueueAdapterMem;
};

export async function startStoryServer(): Promise<StoryHarness> {
  resetServerConfig();
  const serverInstance = await startServer({ listen: false });
  return {
    app: serverInstance.app,
    server: serverInstance.server,
    queueAdapter: serverInstance.queueAdapter as QueueAdapterMem,
  };
}

export async function stopStoryServer(harness?: StoryHarness): Promise<void> {
  resetServerConfig();
  if (harness?.queueAdapter) {
    harness.queueAdapter.stop();
  }
  if (harness?.server) {
    await new Promise<void>((resolve, reject) => {
      harness.server!.close((err: any) => {
        if (err) return reject(err);
        resolve();
      });
    });
  }
}

export async function pollJsonBody(
  app: express.Express,
  pollingUrl: string,
  thid: string,
): Promise<{ status: number; body: any }> {
  const pollPath = new URL(pollingUrl, 'http://localhost').pathname;
  const response = await invokeExpress(app, {
    method: 'POST',
    url: pollPath,
    headers: { 'content-type': 'application/json' },
    body: { thid },
  });
  return {
    status: response.status,
    body: JSON.parse(response.text),
  };
}

export function buildActivationPayload(): Record<string, unknown> {
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

export async function onboardTenantViaActivateAndOrder(app: express.Express, queueAdapter: QueueAdapterMem): Promise<string> {
  const activationPayload = buildActivationPayload() as any;
  const activationSubmit = await invokeExpress(app, {
    method: 'POST',
    url: '/host/cds-es/v1/test/registry/org.schema/Organization/_activate',
    headers: { 'content-type': 'application/json' },
    body: activationPayload,
  });
  if (activationSubmit.status !== 202) {
    throw new Error(`Activation submit failed with status ${activationSubmit.status}`);
  }

  await queueAdapter.waitForEmptyQueue();
  const activationPoll = await pollJsonBody(app, activationSubmit.headers.location, activationPayload.thid);
  if (activationPoll.status !== 200) {
    throw new Error(`Activation poll failed with status ${activationPoll.status}`);
  }

  const activationEntry = activationPoll.body.data[0];
  const offerId = String(activationEntry.resource?.meta?.claims?.[ClaimsOfferSchemaorg.identifier] || '');
  if (!offerId) {
    throw new Error('Activation flow did not return an Offer identifier.');
  }

  const orderPayload = structuredClone(ORGANIZATION_ORDER_REQUEST) as any;
  orderPayload.thid = 'activation-route-order-thid';
  orderPayload.jti = 'activation-route-order-jti';
  orderPayload.iss = 'did:web:controller.example.com';
  orderPayload.aud = 'did:web:host.example.com';
  orderPayload.body.data[0].meta = {};
  orderPayload.body.data[0].resource = {
    meta: {
      claims: {
        [ClaimsOrderSchemaorg.acceptedOfferIdentifier]: offerId,
        [ClaimsOrderSchemaorg.paymentMethod]: 'Stripe',
        [ClaimsOrderSchemaorg.partOfInvoice]: 'activation-story-invoice',
      },
    },
  };

  const orderSubmit = await invokeExpress(app, {
    method: 'POST',
    url: '/host/cds-es/v1/test/registry/org.schema/Order/_batch',
    headers: { 'content-type': 'application/json' },
    body: orderPayload,
  });
  if (orderSubmit.status !== 202) {
    throw new Error(`Activation order submit failed with status ${orderSubmit.status}`);
  }

  await queueAdapter.waitForEmptyQueue();
  const orderPoll = await pollJsonBody(app, orderSubmit.headers.location, orderPayload.thid);
  if (orderPoll.status !== 200) {
    throw new Error(`Activation order poll failed with status ${orderPoll.status}`);
  }

  return String(activationEntry.resource?.meta?.claims?.[ClaimsOrganizationSchemaorg.alternateName] || '');
}

export function installIcaVerifyFetchMock(): typeof global.fetch {
  const originalFetch = global.fetch;
  global.fetch = jest.fn(async (input: string | URL, init?: RequestInit) => {
    const url = String(input);

    if (url.includes('/_verify')) {
      return {
        ok: false,
        status: 202,
        headers: {
          get: (name: string) => {
            const normalized = name.toLowerCase();
            if (normalized === 'location') return 'https://ica.example.com/poll/verify-1';
            if (normalized === 'retry-after') return '0';
            return null;
          },
        },
        json: async () => ({}),
        text: async () => '',
      } as any;
    }

    if (url.includes('/poll/verify-1')) {
      return {
        ok: true,
        status: 200,
        headers: {
          get: (name: string) => name.toLowerCase() === 'content-type' ? 'application/json' : null,
        },
        json: async () => ({
          resourceType: 'Bundle',
          type: 'batch-response',
          total: 1,
          data: [{
            type: 'VerifyResponse-v1.0',
            resource: {
              resourceType: 'Bundle',
            },
          }],
        }),
        text: async () => '',
      } as any;
    }

    return {
      ok: true,
      status: 200,
      headers: {
        get: (name: string) => name.toLowerCase() === 'content-type' ? 'application/json' : null,
      },
      json: async () => ({}),
      text: async () => '',
    } as any;
  }) as any;
  return originalFetch;
}

export function installBasicJsonFetchMock(): typeof global.fetch {
  const originalFetch = global.fetch;
  global.fetch = jest.fn(async () => ({
    ok: true,
    status: 200,
    headers: {
      get: (name: string) => name.toLowerCase() === 'content-type' ? 'application/json' : null,
    },
    json: async () => ({}),
    text: async () => '',
  })) as any;
  return originalFetch;
}
