// Flow contract: 1) resolve the provider route; 2) submit exactly one Patient in Parameters; 3) authenticate the selected transport; 4) return one synchronous FHIR searchset without queueing; 5) never expose the Fabric lookup hash.
import express from 'express';
import request from 'supertest';
import { createApiRouter } from '../../routes/api';
import { ResourceTypesFhirR4 } from 'gdc-common-utils-ts/constants/fhir-resource-types';
import { HttpRequestMethods } from 'gdc-common-utils-ts/constants/http';

type PatientMatchSearchset = Readonly<{
  resourceType: 'Bundle';
  type: 'searchset';
  total: number;
  entry: readonly Record<string, unknown>[];
}>;

describe('IHE PDQm ITI-119 Patient/$match transport boundary', () => {
  const previousEnv = process.env;
  const path = '/clinic/cds-es/v1/health-care/individual/org.hl7.fhir.api/Patient/$match';
  const parameters = {
    resourceType: ResourceTypesFhirR4.Parameters,
    parameter: [{
      name: 'resource',
      resource: {
        resourceType: ResourceTypesFhirR4.Patient,
        identifier: [{ system: 'urn:oid:1.2.3.4.5', value: 'patient-123' }],
      },
    }],
  };
  const searchset: PatientMatchSearchset = {
    resourceType: ResourceTypesFhirR4.Bundle,
    type: 'searchset',
    total: 1,
    entry: [{
      resource: {
        resourceType: ResourceTypesFhirR4.Patient,
        id: 'patient-uuid',
        identifier: [{ system: 'urn:oid:1.2.3.4.5', value: 'patient-123' }],
      },
      search: { mode: 'match' },
    }],
  };

  afterEach(() => {
    process.env = previousEnv;
    jest.restoreAllMocks();
  });

  function buildApp() {
    const queueAdapter = { addJob: jest.fn() } as any;
    const tenantServices = [{
      id: '#individual:org.hl7.fhir.api',
      type: 'ApiService',
      serviceEndpoint: 'Patient',
      actions: ['$match'],
      selector: { section: 'individual', format: 'org.hl7.fhir.api' },
    }];
    const tenants = {
      tenantExists: jest.fn(async () => true),
      findTenantVaultIdByIdentifierValue: jest.fn(),
      getCollectionName: jest.fn(async () => 'tenant-collection'),
      getDidServiceConfig: jest.fn(async () => tenantServices),
      getTenant: jest.fn(async () => ({ status: 'active', didConfig: { service: tenantServices } })),
      getTenantDomainUrl: jest.fn(),
      getTenantAuthorizationStatus: jest.fn(async () => 'active'),
    } as any;
    const kms = {
      decodeRequest: jest.fn(async () => ({ content: {
        thid: 'thread-123',
        iss: 'did:web:provider.example',
        aud: 'did:web:caller.example',
        body: searchset,
      } })),
      encodeResponse: jest.fn(async () => 'compact.response.jwe'),
    } as any;
    const directJobProcessor = { process: jest.fn(async () => 'compact.response.jwe') };
    const appAuthManager = { verifyBearerToken: jest.fn(async () => ({ payload: { sub: 'actor' } })) } as any;
    const app = express();
    app.use(express.json({ type: ['application/fhir+json', 'application/didcomm-plain+json'] }));
    app.use(express.urlencoded({ extended: true }));
    app.use(createApiRouter(
      queueAdapter,
      tenants,
      kms,
      { set: jest.fn() } as any,
      { query: jest.fn() } as any,
      { verifyDetachedJws: jest.fn() } as any,
      'http://localhost:3000',
      appAuthManager,
      undefined,
      directJobProcessor,
    ));
    return { app, queueAdapter, kms, directJobProcessor, appAuthManager };
  }

  it('accepts direct legacy FHIR Parameters and returns a native searchset synchronously', async () => {
    process.env = { ...previousEnv, SECURITY_MODE: 'demo', DEMO_ALLOW_INSECURE_BEARER: 'true' };
    const { app, queueAdapter, directJobProcessor } = buildApp();

    const response = await request(app).post(path).set('Content-Type', 'application/fhir+json').send(parameters);

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('application/fhir+json');
    expect(response.body).toEqual(searchset);
    expect(directJobProcessor.process).toHaveBeenCalledTimes(1);
    expect(queueAdapter.addJob).not.toHaveBeenCalled();
  });

  it('accepts DIDComm plain with one GW data entry and returns a DIDComm response envelope', async () => {
    process.env = { ...previousEnv, SECURITY_MODE: 'demo', DEMO_ALLOW_INSECURE_BEARER: 'true' };
    const { app, queueAdapter } = buildApp();
    const envelope = {
      jti: 'request-jti',
      thid: 'thread-123',
      iss: 'did:web:caller.example',
      aud: 'did:web:provider.example',
      exp: Math.floor(Date.now() / 1000) + 300,
      type: 'application/didcomm-plain+json',
      body: { data: [{ resource: parameters, request: { method: HttpRequestMethods.Post, url: 'Patient/$match' } }] },
    };

    const response = await request(app).post(path).set('Content-Type', 'application/didcomm-plain+json').send(envelope);

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('application/didcomm-plain+json');
    expect(response.body).toMatchObject({ thid: 'thread-123', iss: envelope.aud, aud: envelope.iss, body: searchset });
    expect(queueAdapter.addJob).not.toHaveBeenCalled();
  });

  it('returns response=<compact JWE> for an authenticated strict request', async () => {
    process.env = { ...previousEnv, SECURITY_MODE: 'strict' };
    const { app, queueAdapter, kms, directJobProcessor, appAuthManager } = buildApp();
    const requesterJwk = { kty: 'OKP', crv: 'X25519', x: 'requester', kid: 'enc-1' };
    kms.decodeRequest.mockResolvedValue({
      id: 'job-1', sequence: 0, status: 'DRAFT', createdAtTimestamp: Date.now(),
      content: {
        jti: 'request-jti', thid: 'thread-123', iss: 'did:web:caller.example', aud: 'did:web:provider.example',
        exp: Math.floor(Date.now() / 1000) + 300,
        body: { data: [{ resource: parameters, request: { method: HttpRequestMethods.Post, url: 'Patient/$match' } }] },
        meta: { jwe: { header: { jwk: requesterJwk } } },
      },
    });

    const response = await request(app)
      .post(path)
      .set('Authorization', 'Bearer access-token')
      .set('Content-Type', 'application/x-www-form-urlencoded')
      .send({ request: 'compact.request.jwe' });

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('application/x-www-form-urlencoded');
    expect(response.text).toBe('response=compact.response.jwe');
    expect(directJobProcessor.process).toHaveBeenCalledTimes(1);
    expect(kms.encodeResponse).not.toHaveBeenCalled();
    expect(appAuthManager.verifyBearerToken).toHaveBeenCalledWith(
      'access-token',
      undefined,
      expect.objectContaining({ vaultId: 'health-care_clinic' }),
      { acceptSmartAccessToken: true },
    );
    expect(queueAdapter.addJob).not.toHaveBeenCalled();
  });
});
