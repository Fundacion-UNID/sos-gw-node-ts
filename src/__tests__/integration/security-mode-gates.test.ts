// Flow contract: reuse shared test fixtures and canonical types; do not introduce duplicated literals.
/**
 * Transport security contract: encrypted post-DCR traffic resolves keys by
 * issuer and kid. The pre-DCR Token/_exchange verifies the new wallet's
 * embedded signing key only as possession proof; the verified account bearer
 * and one-use activation licence remain the authority consumed by the worker.
 */
import express from 'express';
import request from 'supertest';
import { createApiRouter } from '../../routes/api';
import { AppAuthorizationManager } from '../../managers/AppAuthorizationManager';
import {
  buildDeterministicIdTokenFixture,
  buildDeterministicVpTokenFixture,
  DeterministicJwtTokenVerifier,
} from '../utils/deterministic-jwt-fixtures';
import {
  EXAMPLE_PROFILE_PROVIDER_DID,
  EXAMPLE_TENANT_IDENTIFIER,
} from 'gdc-common-utils-ts/examples/shared';
import { buildUnsignedJwt } from 'gdc-common-utils-ts/utils/jwt';
import { DataspaceSectors } from 'gdc-common-utils-ts/constants/sectors';
import { IdentityAuthRequestFields } from 'gdc-common-utils-ts/constants/identity-auth';

function buildTestApp(options?: { appAuthManager?: any; tenantsCacheManager?: any; kmsService?: any }) {
  const app = express();
  app.use(express.json({ type: ['application/json', 'application/didcomm-plain+json', 'application/fhir+json'] }));
  app.use(express.urlencoded({ extended: true }));

  const queueAdapter = {
    addJob: jest.fn(),
  } as any;

  const tenantsCacheManager = options?.tenantsCacheManager || {
    getDidServiceConfig: jest.fn(),
    getTenant: jest.fn(),
    getCollectionName: jest.fn(),
  };

  const kmsService = options?.kmsService || {
    decodeRequest: jest.fn(),
    getHmacBase64Url: jest.fn(),
    unprotectConfidentialData: jest.fn(),
    getPublicVerificationKey: jest.fn(),
    createDetachedJws: jest.fn(),
  };

  const asyncResponseStore = {
    get: jest.fn(),
    set: jest.fn(),
    delete: jest.fn(),
  } as any;

  const vaultRepository = {
    query: jest.fn(),
  } as any;

  const cryptographyService = {
    verifyDetachedJws: jest.fn(),
  } as any;

  app.use(
    createApiRouter(
      queueAdapter,
      tenantsCacheManager,
      kmsService,
      asyncResponseStore,
      vaultRepository,
      cryptographyService,
      'http://localhost:3000',
      options?.appAuthManager,
    ),
  );
  return { app, queueAdapter, tenantsCacheManager, kmsService, vaultRepository, cryptographyService };
}

describe('SECURITY_MODE content-type gates', () => {
  const targetPath = '/host/cds-es/v1/health-care/ping/org.schema/Organization/_batch';
  const credentialPath = '/host/cds-es/v1/health-care/identity/oidc/credential';
  const previousEnv = process.env;

  afterEach(() => {
    process.env = previousEnv;
  });

  it('rejects application/json in strict mode', async () => {
    process.env = {
      ...previousEnv,
      SECURITY_MODE: 'strict',
      JSON_LEGACY: 'false',
      FHIR_LEGACY: 'false',
      DIDCOMM_PLAIN: 'false',
    };

    const { app } = buildTestApp();
    const response = await request(app)
      .post(targetPath)
      .set('Content-Type', 'application/json')
      .send({ thid: 'thid-1' });

    expect(response.status).toBe(415);
  });

  it('accepts authenticated JSON only for the pre-DCR individual Organization bootstrap in strict mode', async () => {
    process.env = {
      ...previousEnv,
      SECURITY_MODE: 'strict',
      JSON_LEGACY: 'false',
      FHIR_LEGACY: 'false',
      DIDCOMM_PLAIN: 'false',
    };

    const appAuthManager = {
      verifyBearerToken: jest.fn(async () => ({ valid: true, payload: { sub: 'firebase-controller-uid' } })),
    };
    const tenantsCacheManager = {
      tenantExists: jest.fn(async () => true),
      findTenantVaultIdByIdentifierValue: jest.fn(),
      getCollectionName: jest.fn(async () => 'animal-care-tenant'),
      getDidServiceConfig: jest.fn(),
      getTenant: jest.fn(),
    };
    const { app } = buildTestApp({ appAuthManager, tenantsCacheManager });
    const response = await request(app)
      .post('/704457076/cds-ca-bc/v1/animal-care/individual/org.schema/Organization/_transaction')
      .set('Content-Type', 'application/json')
      .set('Authorization', 'Bearer firebase-id-token')
      .send({ thid: 'animal-bootstrap-thid' });

    expect(response.status).not.toBe(415);
    expect(appAuthManager.verifyBearerToken).toHaveBeenCalledWith(
      'firebase-id-token',
      undefined,
      { vaultId: 'animal-care_704457076', collectionName: 'animal-care-tenant' },
    );
  });

  it('accepts authenticated JSON only for the pre-DCR host tenant bootstrap in strict mode', async () => {
    process.env = {
      ...previousEnv,
      SECURITY_MODE: 'strict',
      JSON_LEGACY: 'false',
      FHIR_LEGACY: 'false',
      DIDCOMM_PLAIN: 'false',
    };

    const appAuthManager = {
      verifyBearerToken: jest.fn(async () => ({ valid: true, payload: { sub: 'firebase-host-controller-uid' } })),
    };
    const { app } = buildTestApp({ appAuthManager });
    const response = await request(app)
      .post('/host/cds-ca-bc/v1/test-network/registry/org.schema/Organization/_batch')
      .set('Content-Type', 'application/json')
      .set('Authorization', 'Bearer firebase-id-token')
      .send({ thid: 'tenant-bootstrap-thid' });

    expect(response.status).not.toBe(415);
    expect(appAuthManager.verifyBearerToken).toHaveBeenCalledWith(
      'firebase-id-token',
      undefined,
      undefined,
    );
  });

  it('allows the authenticated host controller to recover a pending bootstrap Offer in strict mode', async () => {
    process.env = {
      ...previousEnv,
      SECURITY_MODE: 'strict',
      JSON_LEGACY: 'false',
      FHIR_LEGACY: 'false',
      DIDCOMM_PLAIN: 'false',
    };

    const appAuthManager = {
      verifyBearerToken: jest.fn(async () => ({ valid: true, payload: { sub: 'firebase-host-controller-uid' } })),
    };
    const { app } = buildTestApp({ appAuthManager });
    const response = await request(app)
      .post('/host/cds-ca-bc/v1/test-network/registry/org.schema/Offer/_search')
      .set('Content-Type', 'application/json')
      .set('Authorization', 'Bearer firebase-id-token')
      .send({ thid: 'tenant-bootstrap-offer-recovery-thid', body: { data: [] } });

    expect(response.status).not.toBe(415);
    expect(appAuthManager.verifyBearerToken).toHaveBeenCalledWith(
      'firebase-id-token',
      undefined,
      undefined,
    );
  });

  it('accepts application/json in compat mode when JSON_LEGACY=true', async () => {
    process.env = {
      ...previousEnv,
      SECURITY_MODE: 'compat',
      JSON_LEGACY: 'true',
      FHIR_LEGACY: 'false',
      DIDCOMM_PLAIN: 'false',
    };

    const { app } = buildTestApp();
    const response = await request(app)
      .post(targetPath)
      .set('Content-Type', 'application/json')
      .send({});

    expect(response.status).toBe(400);
  });

  it('rejects application/fhir+json in compat mode when FHIR_LEGACY=false', async () => {
    process.env = {
      ...previousEnv,
      SECURITY_MODE: 'compat',
      JSON_LEGACY: 'true',
      FHIR_LEGACY: 'false',
      DIDCOMM_PLAIN: 'false',
    };

    const { app } = buildTestApp();
    const response = await request(app)
      .post(targetPath)
      .set('Content-Type', 'application/fhir+json')
      .send({});

    expect(response.status).toBe(415);
  });

  it('accepts didcomm-plaintext in demo mode', async () => {
    process.env = {
      ...previousEnv,
      SECURITY_MODE: 'demo',
      DEMO_ALLOW_INSECURE_BEARER: 'true',
      JSON_LEGACY: 'false',
      FHIR_LEGACY: 'false',
      DIDCOMM_PLAIN: 'false',
    };

    const { app } = buildTestApp();
    const response = await request(app)
      .post(targetPath)
      .set('Content-Type', 'application/didcomm-plain+json')
      .send({});

    expect(response.status).toBe(400);
  });

+  /**
   * A professional-seat Offer belongs to the tenant, but its commercial Order
   * is submitted through the host registry. The host path must keep routing the
   * Order to the host while resolving post-DCR sender keys from the issuer
   * tenant. The restricted catalog reproduces the historical staging state.
   */
  it('resolves encrypted host Order sender keys despite a historical host catalog', async () => {
    process.env = {
      ...previousEnv,
      SECURITY_MODE: 'strict',
      DEMO_ALLOW_INSECURE_BEARER: 'false',
      JSON_LEGACY: 'false',
      FHIR_LEGACY: 'false',
      DIDCOMM_PLAIN: 'false',
    };

    const tenantId = 'example-tenant';
    const tenantVaultId = `onehealth-research_${tenantId}`;
    const tenantCollection = 'tenant-physical-collection';
    const issuerDid = `did:web:gateway.example:${tenantId}:cds-es:v1:onehealth-research:employee:controller`;
    const signingKid = 'registered-signing-kid';
    const encryptionKid = 'registered-encryption-kid';
    const tenantsCacheManager = {
      tenantExists: jest.fn(async (vaultId: string) => vaultId === tenantVaultId),
      findTenantVaultIdByIdentifierValue: jest.fn(),
      getCollectionName: jest.fn(async (vaultId: string) => vaultId === tenantVaultId ? tenantCollection : 'host'),
      getDidServiceConfig: jest.fn(async () => [{
        id: '#registry:org.schema',
        selector: { section: 'registry', format: 'org.schema' },
        serviceEndpoint: 'Organization',
        actions: ['_batch', '_activate'],
      }]),
      getTenant: jest.fn(),
    };
    const kmsService = {
      decodeRequest: jest.fn(async () => ({
        content: {
          thid: 'professional-order-thid',
          iss: issuerDid,
          jti: 'professional-order-jti',
          meta: {
            jws: { protected: { alg: 'ES384', kid: signingKid }, signature: 'signature' },
            jwe: { header: { skid: encryptionKid } },
          },
          body: { data: [] },
        },
      })),
      getHmacBase64Url: jest.fn(async (value: string, vaultId: string) => `${vaultId}:${value}`),
      unprotectConfidentialData: jest.fn(async () => ({
        didDocument: {
          verificationMethod: [
            { id: `${issuerDid}#${signingKid}`, publicKeyJwk: { kty: 'EC', crv: 'P-384', x: 'x', y: 'y' } },
            { id: `${issuerDid}#${encryptionKid}`, publicKeyJwk: { kty: 'OKP', crv: 'ML-KEM-768', x: 'enc' } },
          ],
        },
      })),
    };
    const appAuthManager = { verifyBearerToken: jest.fn(async () => ({ sub: 'portal-session' })) };
    const harness = buildTestApp({ appAuthManager, tenantsCacheManager, kmsService });
    harness.vaultRepository.query.mockImplementation(async (vaultId: string) =>
      vaultId === tenantCollection ? [{ protected: 'employee-document' }] : []);
    harness.cryptographyService.verifyDetachedJws.mockResolvedValue(true);

    const response = await request(harness.app)
      .post('/host/cds-es/v1/test/registry/org.schema/Order/_batch')
      .set('Content-Type', 'application/x-www-form-urlencoded')
      .set('Authorization', 'Bearer portal-token')
      .send({ request: 'compact-jwe' });

    expect(response.status).toBe(202);
    expect(harness.vaultRepository.query).toHaveBeenCalledWith(
      tenantCollection,
      expect.objectContaining({ sectionId: expect.any(String) }),
    );
    expect(harness.queueAdapter.addJob).toHaveBeenCalledWith(
      expect.stringContaining('host:Order:_batch'),
      expect.any(Object),
    );
  });

  it('normalizes an encrypted SDK token exchange payload into the manager body contract', async () => {
    process.env = {
      ...previousEnv,
      SECURITY_MODE: 'strict',
      DEMO_ALLOW_INSECURE_BEARER: 'false',
      JSON_LEGACY: 'false',
      FHIR_LEGACY: 'false',
      DIDCOMM_PLAIN: 'false',
    };

    const appAuthManager = {
      verifyBearerToken: jest.fn(async () => ({
        valid: true,
        payload: { sub: 'verified-account-subject' },
      })),
    };
    const kmsService = {
      decodeRequest: jest.fn(async () => ({
        content: {
          thid: 'profile-activation-exchange',
          iss: 'did:web:controller.example',
          subject_token: 'single-use-activation-code',
          client_instance_id: 'browser-installation',
        },
      })),
      getHmacBase64Url: jest.fn(),
      unprotectConfidentialData: jest.fn(),
      getPublicVerificationKey: jest.fn(),
      createDetachedJws: jest.fn(),
    };
    const tenantsCacheManager = {
      tenantExists: jest.fn(async () => true),
      findTenantVaultIdByIdentifierValue: jest.fn(),
      getCollectionName: jest.fn(async () => 'tenant-physical-collection'),
      getDidServiceConfig: jest.fn(async () => [{
        id: '#identity:openid',
        selector: { section: 'identity', format: 'openid' },
        serviceEndpoint: 'Token',
        actions: ['_exchange'],
      }]),
      getTenant: jest.fn(async () => ({ authorizationStatus: 'active' })),
    };
    const { app, queueAdapter } = buildTestApp({ appAuthManager, kmsService, tenantsCacheManager });

    const response = await request(app)
      .post('/example-tenant/cds-ca-bc/v1/animal-care/identity/openid/Token/_exchange')
      .set('Authorization', 'Bearer signed-account-token')
      .type('form')
      .send({ request: 'opaque-jwe' });

    expect(response.status).toBe(202);
    expect(queueAdapter.addJob).toHaveBeenCalledTimes(1);
    expect(queueAdapter.addJob.mock.calls[0][1].content.body).toMatchObject({
      subject_token: 'single-use-activation-code',
      client_instance_id: 'browser-installation',
    });
  });

  it('verifies a new profile wallet key during pre-DCR token exchange without treating it as registered authority', async () => {
    process.env = {
      ...previousEnv,
      SECURITY_MODE: 'strict',
      DEMO_ALLOW_INSECURE_BEARER: 'false',
      JSON_LEGACY: 'false',
      FHIR_LEGACY: 'false',
      DIDCOMM_PLAIN: 'false',
    };

    const embeddedJwk = { kty: 'EC', crv: 'P-384', x: 'wallet-x', y: 'wallet-y' };
    const appAuthManager = {
      verifyBearerToken: jest.fn(async () => ({
        valid: true,
        payload: { sub: 'verified-account-subject' },
      })),
    };
    const kmsService = {
      decodeRequest: jest.fn(async () => ({
        content: {
          thid: 'profile-activation-exchange-signed',
          iss: 'did:web:portal.example:card:vetchain:12402:0000855138505354:family:owner:v3-RoleCode%7CRESPRSN',
          meta: {
            jws: {
              protected: { alg: 'ES384', kid: 'new-wallet-signing-key', jwk: embeddedJwk },
              signature: 'wallet-signature',
            },
            jwe: { header: { skid: 'new-wallet-encryption-key' } },
          },
          body: {
            subject_token: 'single-use-activation-code',
            client_instance_id: 'browser-installation',
          },
        },
      })),
      getHmacBase64Url: jest.fn(),
      unprotectConfidentialData: jest.fn(),
      getPublicVerificationKey: jest.fn(),
      createDetachedJws: jest.fn(),
    };
    const tenantsCacheManager = {
      tenantExists: jest.fn(async () => true),
      findTenantVaultIdByIdentifierValue: jest.fn(),
      getCollectionName: jest.fn(async () => 'tenant-physical-collection'),
      getDidServiceConfig: jest.fn(async () => [{
        id: '#identity:openid',
        selector: { section: 'identity', format: 'openid' },
        serviceEndpoint: 'Token',
        actions: ['_exchange'],
      }]),
      getTenant: jest.fn(async () => ({ authorizationStatus: 'active' })),
    };
    const harness = buildTestApp({ appAuthManager, kmsService, tenantsCacheManager });
    harness.cryptographyService.verifyDetachedJws.mockResolvedValue(true);

    const response = await request(harness.app)
      .post('/example-tenant/cds-ca-bc/v1/animal-care/identity/openid/Token/_exchange')
      .set('Authorization', 'Bearer signed-account-token')
      .type('form')
      .send({ request: 'opaque-jwe' });

    expect(response.status).toBe(202);
    expect(harness.cryptographyService.verifyDetachedJws).toHaveBeenCalledWith(
      expect.anything(),
      expect.any(String),
      embeddedJwk,
    );
    expect(harness.vaultRepository.query).not.toHaveBeenCalled();
    expect(harness.queueAdapter.addJob).toHaveBeenCalledTimes(1);
  });

  it('preserves the neutral employee authorization URN and explicit routed sector for the token worker', async () => {
    process.env = {
      ...previousEnv,
      SECURITY_MODE: 'strict',
      DEMO_ALLOW_INSECURE_BEARER: 'false',
      JSON_LEGACY: 'false',
      FHIR_LEGACY: 'false',
      DIDCOMM_PLAIN: 'false',
    };
    const employeeAuthorizationUrn = 'urn:cds-ca-bc:v1:organization:bn:Example-123:member:zJJPb9sJCAcnFLu8tVHGF4c:2250';
    const kmsService = {
      decodeRequest: jest.fn(async () => ({
        content: {
          thid: 'portable-professional-exchange',
          iss: 'did:web:professional.example',
          body: {
            [IdentityAuthRequestFields.EmployeeAuthorizationUrn]: employeeAuthorizationUrn,
            [IdentityAuthRequestFields.ClientInstanceId]: 'browser-installation',
          },
        },
      })),
      getHmacBase64Url: jest.fn(),
      unprotectConfidentialData: jest.fn(),
      getPublicVerificationKey: jest.fn(),
      createDetachedJws: jest.fn(),
    };
    const tenantsCacheManager = {
      tenantExists: jest.fn(async () => true),
      findTenantVaultIdByIdentifierValue: jest.fn(),
      getCollectionName: jest.fn(async () => 'tenant-physical-collection'),
      getDidServiceConfig: jest.fn(async () => [{
        id: '#identity:openid',
        selector: { section: 'identity', format: 'openid' },
        serviceEndpoint: 'Token',
        actions: ['_exchange'],
      }]),
      getTenant: jest.fn(async () => ({ authorizationStatus: 'active' })),
    };
    const appAuthManager = {
      verifyBearerToken: jest.fn(async () => ({
        valid: true,
        payload: { sub: 'verified-professional-account' },
      })),
    };
    const { app, queueAdapter } = buildTestApp({ appAuthManager, kmsService, tenantsCacheManager });

    const response = await request(app)
      .post('/example-tenant/cds-ca-bc/v1/animal-research/identity/openid/Token/_exchange')
      .set('Authorization', 'Bearer signed-account-token')
      .type('form')
      .send({ request: 'opaque-jwe' });

    expect(response.status).toBe(202);
    expect(queueAdapter.addJob).toHaveBeenCalledTimes(1);
    expect(queueAdapter.addJob.mock.calls[0][1]).toMatchObject({
      tenantId: 'example-tenant',
      jurisdiction: 'ca-bc',
      sector: 'animal-research',
      content: { body: {
        [IdentityAuthRequestFields.EmployeeAuthorizationUrn]: employeeAuthorizationUrn,
      } },
    });
  });

  it('allows host organization _activate without bearer in demo mode', async () => {
    process.env = {
      ...previousEnv,
      SECURITY_MODE: 'demo',
      DEMO_ALLOW_INSECURE_BEARER: 'false',
      JSON_LEGACY: 'true',
      FHIR_LEGACY: 'false',
      DIDCOMM_PLAIN: 'true',
    };

    const { app } = buildTestApp();
    const response = await request(app)
      .post('/host/cds-es/v1/test/registry/org.schema/Organization/_activate')
      .set('Content-Type', 'application/json')
      .send({});

    // If bearer were still mandatory here, we'd get 401.
    expect(response.status).toBe(400);
  });

  it('requires bearer in strict mode when insecure bearer is disabled', async () => {
    process.env = {
      ...previousEnv,
      SECURITY_MODE: 'strict',
      DEMO_ALLOW_INSECURE_BEARER: 'false',
      JSON_LEGACY: 'true',
      FHIR_LEGACY: 'true',
      DIDCOMM_PLAIN: 'true',
    };

    const { app } = buildTestApp();
    const response = await request(app)
      .post(credentialPath)
      .set('Content-Type', 'application/json')
      .send({});

    expect(response.status).toBe(401);
    expect(response.text || '').toContain('Missing or invalid Bearer token');
  });

  it('rejects invalid bearer in strict mode when validation is enforced', async () => {
    process.env = {
      ...previousEnv,
      SECURITY_MODE: 'strict',
      DEMO_ALLOW_INSECURE_BEARER: 'false',
      JSON_LEGACY: 'true',
      FHIR_LEGACY: 'true',
      DIDCOMM_PLAIN: 'true',
    };

    const appAuthManager = {
      verifyBearerToken: jest.fn(async () => {
        throw new Error('bad token');
      }),
    };
    const { app } = buildTestApp({ appAuthManager });
    const response = await request(app)
      .post(credentialPath)
      .set('Content-Type', 'application/json')
      .set('Authorization', 'Bearer invalid-token')
      .send({});

    expect(appAuthManager.verifyBearerToken).toHaveBeenCalledWith('invalid-token');
    expect(response.status).toBe(401);
    expect(response.text || '').toContain('Invalid Bearer token');
  });

  it('calls verifyIdToken for valid bearer in strict mode and continues request flow', async () => {
    process.env = {
      ...previousEnv,
      SECURITY_MODE: 'strict',
      DEMO_ALLOW_INSECURE_BEARER: 'false',
      JSON_LEGACY: 'true',
      FHIR_LEGACY: 'true',
      DIDCOMM_PLAIN: 'true',
    };

    const appAuthManager = {
      verifyBearerToken: jest.fn(async () => ({ sub: 'test-client' })),
    };
    const { app } = buildTestApp({ appAuthManager });
    const response = await request(app)
      .post(credentialPath)
      .set('Content-Type', 'application/json')
      .set('Authorization', 'Bearer valid-token')
      .send({});

    expect(appAuthManager.verifyBearerToken).toHaveBeenCalledWith('valid-token');
    // Should fail later due to tenant setup in this test harness, not due to bearer auth.
    expect(response.status).toBe(404);
  });

  it('propagates verified bearer payload into Organization/_issue jobs in strict mode', async () => {
    process.env = {
      ...previousEnv,
      SECURITY_MODE: 'strict',
      DEMO_ALLOW_INSECURE_BEARER: 'false',
      JSON_LEGACY: 'true',
      FHIR_LEGACY: 'true',
      DIDCOMM_PLAIN: 'true',
    };

    const appAuthManager = {
      verifyBearerToken: jest.fn(async () => ({
        valid: true,
        payload: { email: 'controller@example.org', sub: 'controller-sub-001' },
      })),
    };
    const tenantsCacheManager = {
      getDidServiceConfig: jest.fn(async () => [{
        id: '#registry:org.schema',
        selector: { section: 'registry', format: 'org.schema' },
        serviceEndpoint: 'organization',
        actions: ['_issue'],
      }]),
      getTenant: jest.fn(),
      getCollectionName: jest.fn(),
    };
    const kmsService = {
      decodeRequest: jest.fn(async () => ({
        content: {
          thid: 'issue-thid-001',
          iss: 'did:web:portal.example.org',
          meta: {
            jwe: { header: { jwk: { kty: 'EC', crv: 'P-256', x: 'x', y: 'y' } } },
          },
          body: {
            data: [{
              resource: { meta: { claims: {
                  'org.schema.Organization.alternateName': 'acme-health',
                  'org.schema.Service.category': 'health-care',
                } } },
            }],
          },
        },
      })),
      getHmacBase64Url: jest.fn(),
      unprotectConfidentialData: jest.fn(),
      getPublicVerificationKey: jest.fn(),
      createDetachedJws: jest.fn(),
    };
    const { app, queueAdapter } = buildTestApp({ appAuthManager, tenantsCacheManager, kmsService });
    const response = await request(app)
      .post('/host/cds-es/v1/health-care/registry/org.schema/Organization/_issue')
      .set('Authorization', 'Bearer valid-token')
      .type('form')
      .send({ request: 'opaque-jwe' });

    expect(response.status).toBe(202);
    expect(appAuthManager.verifyBearerToken).toHaveBeenCalledWith('valid-token', undefined, undefined);
    expect(queueAdapter.addJob).toHaveBeenCalledTimes(1);
    const queuedJob = queueAdapter.addJob.mock.calls[0][1];
    expect(queuedJob.content.meta.bearer.jwt.payload).toEqual({
      email: 'controller@example.org',
      sub: 'controller-sub-001',
    });
  });

  it('accepts a deterministically signed id_token from one virtual BFF issuer in strict mode', async () => {
    process.env = {
      ...previousEnv,
      SECURITY_MODE: 'strict',
      DEMO_ALLOW_INSECURE_BEARER: 'false',
      JSON_LEGACY: 'true',
      FHIR_LEGACY: 'true',
      DIDCOMM_PLAIN: 'true',
    };

    const fixture = await buildDeterministicIdTokenFixture({
      seed: 'gw-security-mode-seed-001',
      issuer: 'did:web:bff.demo.example',
      audience: 'gw-demo-audience',
      subject: 'controller-sub-001',
      email: 'controller@example.org',
      extraClaims: {
        tenant_id: 'acme-id',
      },
    });
    const tokenVerifier = new DeterministicJwtTokenVerifier({
      issuer: 'did:web:bff.demo.example',
      audience: 'gw-demo-audience',
      publicJwk: fixture.publicJwk,
    });
    const appAuthManager = new AppAuthorizationManager(
      {
        get: jest.fn(),
        put: jest.fn(),
        createNewVault: jest.fn(),
        vaultExists: jest.fn(),
        getVaultConfig: jest.fn(),
        createNewSection: jest.fn(),
        updateSection: jest.fn(),
        getAllSections: jest.fn(),
        sectionExists: jest.fn(),
        getContainersListInSection: jest.fn(),
        getContainersInSection: jest.fn(),
        getHistory: jest.fn(),
        query: jest.fn(),
        delete: jest.fn(),
        purge: jest.fn(),
      } as any,
      tokenVerifier,
      {
        getPublicVerificationKey: jest.fn(),
        init: jest.fn(),
        provisionKeys: jest.fn(),
        getPublicJwks: jest.fn(),
        getPublicEncryptionKey: jest.fn(),
        getHostPublicJwkSet: jest.fn(),
        decodeRequest: jest.fn(),
        signWithManagedKey: jest.fn(),
        signWithReconstructedKey: jest.fn(),
        encodeResponse: jest.fn(),
        createDetachedJws: jest.fn(),
        createCompactJws: jest.fn(),
        protectConfidentialData: jest.fn(),
        unprotectConfidentialData: jest.fn(),
        getHmacBase64Url: jest.fn(),
        protectAttributesNameAndValue: jest.fn(),
      } as any,
      {
        verifyJws: jest.fn(),
      } as any,
    );
    const tenantsCacheManager = {
      getDidServiceConfig: jest.fn(async () => [{
        id: '#registry:org.schema',
        selector: { section: 'registry', format: 'org.schema' },
        serviceEndpoint: 'organization',
        actions: ['_issue'],
      }]),
      getTenant: jest.fn(),
      getCollectionName: jest.fn(),
    };
    const kmsService = {
      decodeRequest: jest.fn(async () => ({
        content: {
          thid: 'issue-thid-oidc-001',
          iss: 'did:web:portal.example.org',
          meta: {
            jwe: { header: { jwk: { kty: 'EC', crv: 'P-256', x: 'x', y: 'y' } } },
          },
          body: {
            data: [{
              resource: { meta: { claims: {
                  'org.schema.Organization.alternateName': 'acme-health',
                  'org.schema.Service.category': 'health-care',
                } } },
            }],
          },
        },
      })),
      getHmacBase64Url: jest.fn(),
      unprotectConfidentialData: jest.fn(),
      getPublicVerificationKey: jest.fn(),
      createDetachedJws: jest.fn(),
    };
    const { app, queueAdapter } = buildTestApp({ appAuthManager, tenantsCacheManager, kmsService });
    const response = await request(app)
      .post('/host/cds-es/v1/health-care/registry/org.schema/Organization/_issue')
      .set('Authorization', `Bearer ${fixture.compactToken}`)
      .type('form')
      .send({ request: 'opaque-jwe' });

    expect(response.status).toBe(202);
    expect(queueAdapter.addJob).toHaveBeenCalledTimes(1);
    const queuedJob = queueAdapter.addJob.mock.calls[0][1];
    expect(queuedJob.content.meta.bearer.jwt.payload).toMatchObject({
      email: 'controller@example.org',
      tenant_id: 'acme-id',
      sub: 'controller-sub-001',
    });
  });

  it('accepts one deterministically signed controller proof bearer on host lifecycle routes in strict mode', async () => {
    process.env = {
      ...previousEnv,
      SECURITY_MODE: 'strict',
      DEMO_ALLOW_INSECURE_BEARER: 'false',
      JSON_LEGACY: 'true',
      FHIR_LEGACY: 'true',
      DIDCOMM_PLAIN: 'true',
    };

    const fixture = await buildDeterministicVpTokenFixture({
      seed: 'gw-security-mode-vp-seed-001',
      issuerDid: 'did:web:controller.demo.example',
      audience: 'did:web:gw.demo.example#tenant_lifecycle',
      credentials: [
        {
          credential: {
            '@context': ['https://www.w3.org/2018/credentials/v1'],
            type: ['VerifiableCredential', 'LegalRepresentativeCredential'],
            issuer: 'did:web:ica.demo.example',
            issuanceDate: '2040-01-01T00:00:00.000Z',
            credentialSubject: {
              id: 'did:web:controller.demo.example',
              memberOf: { taxID: 'B12345678' },
              hasOccupation: { identifier: { value: 'RESPRSN' } },
            },
          },
        },
      ],
    });

    const appAuthManager = new AppAuthorizationManager(
      {
        get: jest.fn(),
        put: jest.fn(),
        createNewVault: jest.fn(),
        vaultExists: jest.fn(),
        getVaultConfig: jest.fn(),
        createNewSection: jest.fn(),
        updateSection: jest.fn(),
        getAllSections: jest.fn(),
        sectionExists: jest.fn(),
        getContainersListInSection: jest.fn(),
        getContainersInSection: jest.fn(),
        getHistory: jest.fn(),
        query: jest.fn(),
        delete: jest.fn(),
        purge: jest.fn(),
      } as any,
      {
        verify: jest.fn(async () => ({ valid: false, error: 'not an id token' })),
      } as any,
      {
        getPublicVerificationKey: jest.fn(),
        init: jest.fn(),
        provisionKeys: jest.fn(),
        getPublicJwks: jest.fn(),
        getPublicEncryptionKey: jest.fn(),
        getHostPublicJwkSet: jest.fn(),
        decodeRequest: jest.fn(),
        signWithManagedKey: jest.fn(),
        signWithReconstructedKey: jest.fn(),
        encodeResponse: jest.fn(),
        createDetachedJws: jest.fn(),
        createCompactJws: jest.fn(),
        protectConfidentialData: jest.fn(),
        unprotectConfidentialData: jest.fn(),
        getHmacBase64Url: jest.fn(),
        protectAttributesNameAndValue: jest.fn(),
      } as any,
      {
        verifyJws: jest.fn(),
      } as any,
    );
    const tenantsCacheManager = {
      getDidServiceConfig: jest.fn(async () => [{
        id: '#registry:org.schema',
        selector: { section: 'registry', format: 'org.schema' },
        serviceEndpoint: 'organization',
        actions: ['_disable'],
      }]),
      getTenant: jest.fn(),
      getCollectionName: jest.fn(),
    };
    const kmsService = {
      decodeRequest: jest.fn(async () => ({
        content: {
          thid: 'disable-thid-001',
          iss: 'did:web:portal.example.org',
          meta: {
            jwe: { header: { jwk: { kty: 'EC', crv: 'P-256', x: 'x', y: 'y' } } },
          },
          body: {
            data: [{
              resource: { meta: { claims: {
                  'org.schema.Organization.identifier.value': 'B12345678',
                } } },
            }],
          },
        },
      })),
      getHmacBase64Url: jest.fn(),
      unprotectConfidentialData: jest.fn(),
      getPublicVerificationKey: jest.fn(),
      createDetachedJws: jest.fn(),
    };
    const { app, queueAdapter } = buildTestApp({ appAuthManager, tenantsCacheManager, kmsService });
    const response = await request(app)
      .post('/host/cds-es/v1/test/registry/org.schema/Organization/_disable')
      .set('Authorization', `Bearer ${fixture.compactToken}`)
      .type('form')
      .send({ request: 'opaque-jwe' });

    expect(response.status).toBe(202);
    expect(queueAdapter.addJob).toHaveBeenCalledTimes(1);
    const queuedJob = queueAdapter.addJob.mock.calls[0][1];
    expect(queuedJob.content.meta.bearer.jwt.payload.iss).toBe('did:web:controller.demo.example');
    expect(queuedJob.content.meta.bearer.jwt.payload.vp).toBeDefined();
  });

  it('passes the plain-DIDComm meta JWK into controller bearer verification', async () => {
    process.env = {
      ...previousEnv,
      SECURITY_MODE: 'compat',
      DEMO_ALLOW_INSECURE_BEARER: 'false',
      DIDCOMM_PLAIN: 'true',
    };
    const publicJwk = { kty: 'EC', crv: 'P-384', kid: 'controller-key', x: 'x', y: 'y' };
    const appAuthManager = {
      verifyBearerToken: jest.fn(async () => ({ valid: true, payload: { iss: 'did:web:controller.example' } })),
    };
    const tenantsCacheManager = {
      getDidServiceConfig: jest.fn(async () => [{
        id: '#registry:org.schema',
        selector: { section: 'registry', format: 'org.schema' },
        serviceEndpoint: 'organization',
        actions: ['_batch'],
      }]),
      getTenant: jest.fn(),
      getCollectionName: jest.fn(),
    };
    const { app, queueAdapter } = buildTestApp({ appAuthManager, tenantsCacheManager });

    const response = await request(app)
      .post('/host/cds-es/v1/test-network/registry/org.schema/Organization/_batch')
      .set('Authorization', 'Bearer controller.proof.jwt')
      .set('Content-Type', 'application/didcomm-plain+json')
      .send({ thid: 'plain-controller-submit', meta: { jws: { protected: { jwk: publicJwk } } } });

    expect(response.status).toBe(202);
    expect(appAuthManager.verifyBearerToken).toHaveBeenCalledWith('controller.proof.jwt', publicJwk, undefined);
    expect(queueAdapter.addJob).toHaveBeenCalledTimes(1);
  });

  it('binds tenant plain-DIDComm verification to the post-DCR storage scope', async () => {
    process.env = {
      ...previousEnv,
      SECURITY_MODE: 'compat',
      DEMO_ALLOW_INSECURE_BEARER: 'false',
      DIDCOMM_PLAIN: 'true',
    };
    const publicJwk = { kty: 'EC', crv: 'P-384', kid: 'controller-key', x: 'x', y: 'y' };
    const appAuthManager = {
      verifyBearerToken: jest.fn(async () => ({ valid: true, payload: { iss: 'did:web:controller.example' } })),
    };
    const tenantsCacheManager = {
      tenantExists: jest.fn(async () => true),
      findTenantVaultIdByIdentifierValue: jest.fn(),
      getDidServiceConfig: jest.fn(async () => [{
        id: '#entity:org.schema:employee:_batch',
        selector: { section: 'entity', format: 'org.schema' },
        serviceEndpoint: 'employee',
        actions: ['_batch'],
      }]),
      getTenant: jest.fn(async () => ({ status: 'active' })),
      getCollectionName: jest.fn(async () => 'tenant-physical-collection'),
    };
    const { app, queueAdapter } = buildTestApp({ appAuthManager, tenantsCacheManager });

    const response = await request(app)
      .post('/VATES-B42215152/cds-eu/v1/onehealth-research/entity/org.schema/Employee/_batch')
      .set('Authorization', 'Bearer controller.proof.jwt')
      .set('Content-Type', 'application/didcomm-plain+json')
      .send({ thid: 'plain-employee-submit', meta: { jws: { protected: { jwk: publicJwk } } } });

    expect(response.status).toBe(202);
    expect(appAuthManager.verifyBearerToken).toHaveBeenCalledWith(
      'controller.proof.jwt',
      publicJwk,
      {
        vaultId: 'onehealth-research_VATES-B42215152',
        collectionName: 'tenant-physical-collection',
      },
    );
    expect(queueAdapter.addJob).toHaveBeenCalledTimes(1);
  });

  /**
   * Journey:
   * 1. An individual data client submits one FHIR Communication with a SMART bearer.
   * 2. The route opts into tenant-signed SMART verification before scope enforcement.
   * 3. The accepted request is queued with the verified actor payload.
   * Authorization invariant: SMART opt-in is limited to an individual FHIR data route.
   * Persistence invariant: only the verified claims enter job metadata; the token is not persisted in the resource.
   */
  it('opts an individual FHIR data route into tenant-signed SMART bearer verification', async () => {
    process.env = {
      ...previousEnv,
      SECURITY_MODE: 'compat',
      DEMO_ALLOW_INSECURE_BEARER: 'false',
      JSON_LEGACY: 'false',
      FHIR_LEGACY: 'true',
      DIDCOMM_PLAIN: 'false',
    };
    const appAuthManager = {
      verifyBearerToken: jest.fn(async () => ({
        valid: true,
        payload: {
          iss: 'did:web:beta-gw.vetchain.app:tenant',
          sub: EXAMPLE_PROFILE_PROVIDER_DID,
          scope: 'organization/Composition.cruds?subject=did:web:animal.example:individual:001&section=*',
        },
      })),
    };
    const tenantsCacheManager = {
      tenantExists: jest.fn(async () => true),
      findTenantVaultIdByIdentifierValue: jest.fn(),
      getDidServiceConfig: jest.fn(async () => [{
        id: '#individual:org.hl7.fhir.r4',
        selector: { sector: DataspaceSectors.AnimalCare, section: 'individual', format: 'org.hl7.fhir.r4' },
        serviceEndpoint: 'Communication',
        actions: ['_batch'],
      }]),
      getTenant: jest.fn(async () => ({})),
      getCollectionName: jest.fn(async () => 'animal-care-tenant-collection'),
    };
    const harness = buildTestApp({ appAuthManager, tenantsCacheManager });
    const path = `/${EXAMPLE_TENANT_IDENTIFIER}/cds-CA-BC/v1/${DataspaceSectors.AnimalCare}/individual/org.hl7.fhir.r4/Communication/_batch`;

    const response = await request(harness.app)
      .post(path)
      .set('Content-Type', 'application/fhir+json')
      .set('Authorization', 'Bearer tenant.smart.token')
      .send({
        resourceType: 'Bundle',
        type: 'batch',
        id: 'smart-fhir-communication',
        thid: 'smart-fhir-communication',
        entry: [],
      });

    expect(response.status).toBe(202);
    expect(appAuthManager.verifyBearerToken).toHaveBeenCalledWith(
      'tenant.smart.token',
      undefined,
      {
        vaultId: `${DataspaceSectors.AnimalCare}_${EXAMPLE_TENANT_IDENTIFIER}`,
        collectionName: 'animal-care-tenant-collection',
      },
      { acceptSmartAccessToken: true },
    );
  });

  /**
   * Journey:
   * 1. A local FHIR client sends one Communication Bundle with an unsigned demo bearer.
   * 2. GW accepts that bearer only because the explicit demo switch is enabled.
   * 3. The queued job preserves `sub` so managers can enforce clinical author ownership.
   * Authorization invariant: this decoding path is unavailable outside demo mode.
   * Persistence invariant: the bearer stays in job security metadata, never in the FHIR resource.
   */
  it('preserves an insecure demo bearer subject for a FHIR transport job', async () => {
    process.env = {
      ...previousEnv,
      SECURITY_MODE: 'demo',
      DEMO_ALLOW_INSECURE_BEARER: 'true',
      JSON_LEGACY: 'false',
      FHIR_LEGACY: 'true',
      DIDCOMM_PLAIN: 'false',
    };
    const tenantsCacheManager = {
      tenantExists: jest.fn(async () => true),
      findTenantVaultIdByIdentifierValue: jest.fn(),
      getDidServiceConfig: jest.fn(async () => [{
        id: '#individual:org.hl7.fhir.r4',
        selector: { sector: DataspaceSectors.AnimalCare, section: 'individual', format: 'org.hl7.fhir.r4' },
        serviceEndpoint: 'Communication',
        actions: ['_batch'],
      }]),
      getTenant: jest.fn(async () => ({})),
      getCollectionName: jest.fn(),
    };
    const harness = buildTestApp({ tenantsCacheManager });
    const bearer = buildUnsignedJwt({ sub: EXAMPLE_PROFILE_PROVIDER_DID });

    const response = await request(harness.app)
      .post(`/${EXAMPLE_TENANT_IDENTIFIER}/cds-CA-BC/v1/${DataspaceSectors.AnimalCare}/individual/org.hl7.fhir.r4/Communication/_batch`)
      .set('Content-Type', 'application/fhir+json')
      .set('Authorization', `Bearer ${bearer}`)
      .send({
        resourceType: 'Bundle',
        type: 'batch',
        id: 'demo-fhir-communication',
        thid: 'demo-fhir-communication',
        entry: [],
      });

    expect(response.status).toBe(202);
    expect(harness.queueAdapter.addJob).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        content: expect.objectContaining({
          meta: expect.objectContaining({
            bearer: expect.objectContaining({
              jwt: expect.objectContaining({
                payload: expect.objectContaining({ sub: EXAMPLE_PROFILE_PROVIDER_DID }),
              }),
            }),
          }),
        }),
      }),
    );
  });
});
