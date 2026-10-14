// Flow contract: reuse shared test fixtures and canonical types; do not introduce duplicated literals.
import { resolveHostPhysicalCollectionName } from '../../config/storage-layout';
// Flow contract: 1. provision a real in-memory tenant; 2. persist one encrypted Animal identity and its encrypted exact-match pointer; 3. submit authenticated POST Patient/$match with the original ISO chip; 4. poll the asynchronous response; 5. prove a zero-or-one certain FHIR match exposes only the public card. Authorization invariant: a locally verified bearer is mandatory and identifier resolution grants no clinical/contact permission. Persistence invariant: chip and card stay inside encrypted tenant storage while neither is supplied to Fabric and no caller-derived hash crosses the API.
import { buildSubjectIdentityBundleEntry } from 'gdc-common-utils-ts/utils/subject-identity';
import { ClaimsOrganizationSchemaorg, ClaimsServiceSchemaorg } from 'gdc-common-utils-ts/constants/schemaorg';
import { Sector } from 'gdc-common-utils-ts/models/urlPath';
import { invokeExpress } from './helpers/invokeExpress';
import { configureAuthenticatedTestActor } from './helpers/authenticated-test-actor';
import { startServer, resetServerConfig } from '../../server';
import { getTenantVaultId, generateTenantCollectionNameFromClaims } from '../../utils/tenant';
import { initializeTenantServicesConfig } from '../../utils/services';
import { getEnvSectionId } from '../../utils/section-env';
import { getIndividualSectionId } from '../../utils/individual-sections';
import { testPayloadCreateTenant1 } from '../data/end-to-end.data';
import { testTenant1TenantId } from '../data/organization.data';
import express from 'express';
import request from 'supertest';
import { createApiRouter } from '../../routes/api';
import { HttpRequestMethods } from 'gdc-common-utils-ts/constants/http';
import { ResourceTypesFhirR4 } from 'gdc-common-utils-ts/constants/fhir-resource-types';

describe('Patient $match API', () => {
  afterEach(() => resetServerConfig());

  it('resolves an original microchip through the provider without accepting a hash', async () => {
    Object.assign(process.env, {
      NODE_ENV: 'test', DB_PROVIDER: 'mem', STORAGE_PROVIDER: 'mem', QUEUE_PROVIDER: 'mem',
      SECTORS_ALLOWED: 'health-care', ORG_HOST_LEGAL_NAME: 'Gateway Host Services',
      ORG_HOST_JURISDICTION: 'ES', ORG_HOST_ID_TYPE: 'TAX', ORG_HOST_ID_VALUE: 'A0011223344',
      ORG_HOST_ADMIN_EMAIL: 'admin@host.com', ORG_HOST_ADMIN_UID: 'host-admin-001',
      ORG_HOST_ADMIN_ROLE: 'ISCO-08|1111', SECURITY_MODE: 'demo', JSON_LEGACY: 'true',
      SUBJECT_IDENTIFIER_LEDGER_ENABLED: 'false',
    });
    const authenticatedActor = await configureAuthenticatedTestActor();
    resetServerConfig();

    const { app, queueAdapter, tenantManager, vaultRepository, kmsService } = await startServer({ listen: false });
    try {
      const hostClaims = {
        [ClaimsOrganizationSchemaorg.addressCountry]: 'ES',
        [ClaimsOrganizationSchemaorg.identifierType]: 'TAX',
        [ClaimsOrganizationSchemaorg.identifierValue]: 'A0011223344',
        [ClaimsServiceSchemaorg.category]: Sector.SYSTEM,
      };
      const tenantClaims = testPayloadCreateTenant1.body.data[0].resource.meta.claims as any;
      const tenantVaultId = getTenantVaultId(tenantClaims[ClaimsServiceSchemaorg.category], testTenant1TenantId);
      await kmsService.provisionKeys(tenantVaultId);
      const protectedTenant = await kmsService.protectConfidentialData({
        id: tenantVaultId,
        sequence: 0,
        content: {
          claims: tenantClaims,
          didConfig: { service: initializeTenantServicesConfig(Sector.HEALTH_CARE) },
          didDocument: { id: 'did:web:api.acme.org', '@context': 'https://www.w3.org/ns/did/v1' },
        },
      } as any, 'host');
      await vaultRepository.put(
        resolveHostPhysicalCollectionName(),
        [protectedTenant as any],
        getEnvSectionId('tenants'),
      );
      const tenant = await tenantManager.getTenant(tenantVaultId);
      const collectionName = tenant!.collectionName;

      const cardId = 'urn:vetchain:card:animal:patient-match';
      const chip = '981020000123456';
      const identity = buildSubjectIdentityBundleEntry({
        subjectKind: 'animal', cardId,
        codingSystem: 'urn:iso:std:iso:11784-11785', jurisdiction: '', codeValue: chip,
      });
      const protectedIdentity = await kmsService.protectConfidentialData({
        id: identity.id, sequence: 0, status: 'active', content: identity,
      } as any, tenantVaultId);
      const protectedPointer = await kmsService.protectConfidentialData({
        id: identity.id, sequence: 0, status: 'active', content: { cardId },
      } as any, tenantVaultId);
      await vaultRepository.put(
        collectionName, [protectedIdentity as any], getIndividualSectionId(cardId, 'subject-identities'),
      );
      await vaultRepository.put(
        collectionName, [protectedPointer as any], getEnvSectionId('subject-identity-match-index'),
      );

      const path = `/${testTenant1TenantId}/cds-ES/v1/health-care/individual/org.hl7.fhir.api/Patient`;
      const thid = 'patient-match-chip-integration';
      const submit = await invokeExpress(app, {
        method: 'POST', url: `${path}/$match`,
        headers: { 'content-type': 'application/json', authorization: authenticatedActor.authorizationHeader },
        body: { thid, body: {
          resourceType: 'Parameters',
          parameter: [
            { name: 'resource', resource: {
              resourceType: 'Patient',
              identifier: [{ system: 'urn:iso:std:iso:11784-11785', value: chip }],
            } },
            { name: 'onlyCertainMatches', valueBoolean: true },
            { name: 'count', valueInteger: 1 },
          ],
        } },
      });
      expect(submit.status).toBe(202);

      const result = await poll(app, `${path}/$match-response`, thid);
      expect(result).toMatchObject({
        resourceType: 'Bundle', type: 'searchset', total: 1,
        entry: [{
          resource: { resourceType: 'Patient', identifier: [{ system: 'urn:ietf:rfc:3986', value: cardId }] },
          search: { mode: 'match', score: 1 },
        }],
      });
      expect(JSON.stringify(result)).not.toContain(chip);
      expect(JSON.stringify(result)).not.toContain(identity.id);

      const nativeFhir = await invokeExpress(app, {
        method: 'POST', url: `${path}/$match`,
        headers: {
          'content-type': 'application/fhir+json',
          accept: 'application/fhir+json',
          authorization: authenticatedActor.authorizationHeader,
        },
        body: {
          resourceType: 'Parameters',
          parameter: [
            { name: 'resource', resource: {
              resourceType: 'Patient',
              identifier: [{ system: 'urn:iso:std:iso:11784-11785', value: chip }],
            } },
            { name: 'onlyCertainMatches', valueBoolean: true },
          ],
        },
      });
      expect(nativeFhir.status).toBe(200);
      expect(nativeFhir.headers['content-type']).toContain('application/fhir+json');
      expect(JSON.parse(nativeFhir.text)).toMatchObject({
        resourceType: 'Bundle', type: 'searchset', total: 1,
      });

      const didcommPlain = await invokeExpress(app, {
        method: 'POST', url: `${path}/$match`,
        headers: {
          'content-type': 'application/didcomm-plain+json',
          accept: 'application/didcomm-plain+json',
          authorization: authenticatedActor.authorizationHeader,
        },
        body: {
          id: 'pdqm-plain-message', thid: 'pdqm-plain-message',
          type: 'application/didcomm-plain+json',
          from: authenticatedActor.actorDid,
          to: ['did:web:api.acme.org'],
          body: {
            resourceType: 'Bundle', type: 'batch', total: 1,
            data: [{
              type: 'Parameters', request: { method: 'POST', url: 'Patient/$match' },
              resource: {
                resourceType: 'Parameters',
                parameter: [
                  { name: 'resource', resource: {
                    resourceType: 'Patient',
                    identifier: [{ system: 'urn:iso:std:iso:11784-11785', value: chip }],
                  } },
                  { name: 'onlyCertainMatches', valueBoolean: true },
                ],
              },
            }],
          },
        },
      });
      expect(didcommPlain.status).toBe(200);
      expect(didcommPlain.headers['content-type']).toContain('application/didcomm-plain+json');
      expect(JSON.parse(didcommPlain.text).body).toMatchObject({
        resourceType: 'Bundle', type: 'searchset', total: 1,
      });
    } finally {
      queueAdapter.stop();
    }
  });
});

describe('Patient $match strict encrypted transport', () => {
  const previousEnvironment = process.env;

  afterEach(() => {
    process.env = previousEnvironment;
    jest.restoreAllMocks();
  });

  it('returns response=<compact JWE> for an authenticated strict request', async () => {
    const professionalPatientMatchPath = '/clinic/cds-es/v1/health-care/individual/org.hl7.fhir.api/Patient/$match';
    const patientIdentifierSystem = 'urn:oid:1.2.3.4.5';
    const syntheticPatientIdentifier = 'patricia-doe';
    const parameters = {
      resourceType: ResourceTypesFhirR4.Parameters,
      parameter: [{
        name: 'resource',
        resource: {
          resourceType: ResourceTypesFhirR4.Patient,
          identifier: [{ system: patientIdentifierSystem, value: syntheticPatientIdentifier }],
        },
      }],
    };
    const queueAdapter = { addJob: jest.fn() } as any;
    const tenantServices = [{
      id: '#individual:org.hl7.fhir.api',
      type: 'ApiService',
      serviceEndpoint: 'Patient',
      actions: ['$match'],
      selector: { section: 'individual', format: 'org.hl7.fhir.api' },
    }];
    const tenantRegistry = {
      tenantExists: jest.fn(async () => true),
      findTenantVaultIdByIdentifierValue: jest.fn(),
      getCollectionName: jest.fn(async () => 'tenant-collection'),
      getDidServiceConfig: jest.fn(async () => tenantServices),
      getTenant: jest.fn(async () => ({ status: 'active', didConfig: { service: tenantServices } })),
      getTenantDomainUrl: jest.fn(),
      getTenantAuthorizationStatus: jest.fn(async () => 'active'),
    } as any;
    const requesterEncryptionJwk = { kty: 'OKP', crv: 'X25519', x: 'requester', kid: 'enc-1' };
    const kmsService = {
      decodeRequest: jest.fn().mockResolvedValue({
        id: 'job-1',
        sequence: 0,
        status: 'DRAFT',
        createdAtTimestamp: Date.now(),
        content: {
          jti: 'patient-match-strict-request',
          thid: 'patient-match-strict-thread',
          iss: 'did:web:professional.example',
          aud: 'did:web:provider.example',
          exp: Math.floor(Date.now() / 1000) + 300,
          body: { data: [{
            resource: parameters,
            request: { method: HttpRequestMethods.Post, url: 'Patient/$match' },
          }] },
          meta: { jwe: { header: { jwk: requesterEncryptionJwk } } },
        },
      }),
    } as any;
    const directPatientMatchProcessor = { process: jest.fn(async () => 'compact.response.jwe') };
    const appAuthManager = {
      verifyBearerToken: jest.fn(async () => ({ payload: { sub: 'did:web:professional.example' } })),
    } as any;
    const app = express();
    app.use(express.json({ type: ['application/fhir+json', 'application/didcomm-plain+json'] }));
    app.use(express.urlencoded({ extended: true }));
    app.use(createApiRouter(
      queueAdapter,
      tenantRegistry,
      kmsService,
      { set: jest.fn() } as any,
      { query: jest.fn() } as any,
      { verifyDetachedJws: jest.fn() } as any,
      'http://localhost:3000',
      appAuthManager,
      undefined,
      directPatientMatchProcessor,
    ));
    process.env = { ...previousEnvironment, SECURITY_MODE: 'strict' };

    const response = await request(app)
      .post(professionalPatientMatchPath)
      .set('Authorization', 'Bearer access-token')
      .set('Content-Type', 'application/x-www-form-urlencoded')
      .send({ request: 'compact.request.jwe' });

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('application/x-www-form-urlencoded');
    expect(response.text).toBe('response=compact.response.jwe');
    expect(directPatientMatchProcessor.process).toHaveBeenCalledWith(
      expect.stringContaining('Patient'),
      expect.objectContaining({ resourceType: ResourceTypesFhirR4.Patient, action: '$match' }),
    );
    expect(appAuthManager.verifyBearerToken).toHaveBeenCalledWith(
      'access-token',
      undefined,
      expect.objectContaining({ vaultId: 'health-care_clinic' }),
      { acceptSmartAccessToken: true },
    );
    expect(queueAdapter.addJob).not.toHaveBeenCalled();
  });
});

async function poll(app: any, url: string, thid: string): Promise<any> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const response = await invokeExpress(app, {
      method: 'POST', url, headers: { 'content-type': 'application/json' }, body: { thid },
    });
    if (response.status === 200) return JSON.parse(response.text);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out polling ${url}`);
}
