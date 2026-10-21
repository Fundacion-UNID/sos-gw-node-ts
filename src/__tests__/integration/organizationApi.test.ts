// Flow contract: reuse shared test fixtures and canonical types; do not introduce duplicated literals.
import { resolveHostPhysicalCollectionName } from '../../config/storage-layout';
/**
 * TEST SECTOR USAGE: This integration test covers both network (infra) and business (functional) sectors.
 *
 * - Network sector (e.g., 'test', 'test-network', 'network') is used for host/infra onboarding endpoints.
 * - Business sector (e.g., 'health-care', 'animal-health') is used for tenant/vaultId/resource endpoints.
 *
 * WARNING: Never mix these in test payloads or assertions. If you use the wrong sector, onboarding will fail or produce inconsistent results.
 */
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.
// File: src/__tests__/integration/organizationApi.test.ts

import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import { CryptographyService } from 'gdc-common-utils-ts/CryptographyService';
import { createApiRouter } from '../../routes/api';
import { QueueAdapter } from '../../adapters/queue';
import { TenantsCacheManager } from '../../managers/TenantsCacheManager';
import { testClaimsHostInitialization, testClaimsTenant1Registration } from '../data/end-to-end.data';
import { testEncryptedJwe1 } from '../data/async-response.data';
import { JobRequest, JobStatus } from 'gdc-common-utils-ts/models/confidential-job';
import { mockKmsService } from '../mocks/kms.mock';
import { VaultMemRepository } from '../../database/repositories/vault/vault.mem.repository';
import { AsyncResponseStoreMem, IAsyncResponseStore } from '../../adapters/async-response-store.mem';
import { IServerConfig } from '../../config';
import { Sector } from 'gdc-common-utils-ts/models/urlPath';
import { IStorageAdapter } from '../../database/storage/IStorageAdapter';
import { ILogger } from '../../loggers/ILogger';
import { generateTenantCollectionNameFromClaims } from '../../utils/tenant';
import {
  ORGANIZATION_ORDER_REQUEST,
  ORGANIZATION_REGISTRATION_REQUEST,
  withCompleteFixtureJwsProof,
  withoutIncompleteJwsProof,
} from '../data/example-payloads';
import { withCanonicalEntryClaims } from '../helpers/canonical-bundle-entry';
import { ORGANIZATION_REGISTRATION_JOB } from '../data/example-jobs';
import { IDecodedDidcommPayload } from 'gdc-common-utils-ts/models/confidential-message';
import { MlkemPrivateJwk, MlkemPublicJwk } from 'gdc-common-utils-ts/interfaces/Cryptography.types';
import { createHash } from 'crypto';
import { Content } from 'gdc-common-utils-ts/utils/content';
import { ClaimsOfferSchemaorg, ClaimsOrderSchemaorg } from 'gdc-common-utils-ts/constants/schemaorg';
import { JWK } from 'gdc-common-utils-ts/models/jwk';
import { toJwkThumbprintSha256Urn } from 'gdc-common-utils-ts/utils/jwk-thumbprint';
import { HostingManager } from '../../managers/HostingManager';
import type { IHostRuntime } from '../../managers/IHostRuntime';
import { AdapterCryptoSdkNode } from '../../gdc-backend-utils-node/adapters/node/crypto';
import { ClaimsOrganizationSchemaorg, ClaimsServiceSchemaorg } from 'gdc-common-utils-ts/constants/schemaorg';
import { getEnvSectionId } from '../../utils/section-env';
import { AppAuthorizationManager } from '../../managers/AppAuthorizationManager';
import { testAnimalResearchRegistrationClaims } from '../data/organization-registration-replay.data';

type InMemoryResponse = {
  status: number;
  headers: Record<string, string>;
  text: string;
};

async function invokeExpress(
  handler: any,
  options: { method: string; url: string; headers?: Record<string, string>; body?: any },
): Promise<InMemoryResponse> {
  const headers: Record<string, string> = {};
  let statusCode = 200;
  let responseText = '';

  const req = {
    method: options.method.toUpperCase(),
    url: options.url,
    originalUrl: options.url,
    headers: Object.fromEntries(
      Object.entries(options.headers || {}).map(([k, v]) => [k.toLowerCase(), v]),
    ),
    body: options.body,
    query: {},
    get(name: string) {
      return this.headers[name.toLowerCase()];
    },
  };

  let resolveFinished: (() => void) | undefined;
  let rejectFinished: ((err: any) => void) | undefined;
  const finished = new Promise<void>((resolve, reject) => {
    resolveFinished = resolve;
    rejectFinished = reject;
  });

  const res = {
    status(code: number) {
      statusCode = code;
      return this;
    },
    set(field: string, value: string) {
      headers[field.toLowerCase()] = value;
      return this;
    },
    setHeader(field: string, value: string) {
      headers[field.toLowerCase()] = value;
      return this;
    },
    location(value: string) {
      headers['location'] = value;
      return this;
    },
    type(value: string) {
      headers['content-type'] = value;
      return this;
    },
    send(payload: any) {
      if (payload === undefined || payload === null) {
        responseText = '';
      } else if (typeof payload === 'string') {
        responseText = payload;
      } else {
        if (!headers['content-type']) headers['content-type'] = 'application/json';
        responseText = JSON.stringify(payload);
      }
      resolveFinished?.();
      return this;
    },
    json(payload: any) {
      headers['content-type'] = 'application/json';
      responseText = JSON.stringify(payload);
      resolveFinished?.();
      return this;
    },
    end(payload?: any) {
      if (payload !== undefined) {
        this.send(payload);
      } else {
        resolveFinished?.();
      }
      return this;
    },
  };

  const handleFn = (typeof handler === 'function' ? handler : handler?.handle) as
    | ((req: any, res: any, next: (err?: any) => void) => void)
    | undefined;
  if (!handleFn) {
    throw new Error('invokeExpress: handler has no handle()');
  }

  handleFn(req, res, (err?: any) => {
    if (err) rejectFinished?.(err);
    else resolveFinished?.();
  });

  await finished;
  return { status: statusCode, headers, text: responseText };
}

// --- Mock Dependencies ---
const mockQueueAdapter: jest.Mocked<QueueAdapter> = {
  addJob: jest.fn(),
};

const mockStorageAdapter: jest.Mocked<IStorageAdapter> = {
  upload: jest.fn(),
};

const mockLogger: jest.Mocked<ILogger> = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
};

const mockAppAuthManager = {
  verifyBearerToken: jest.fn(async () => ({ payload: { sub: 'organization-api-test' } })),
} as unknown as AppAuthorizationManager;

const setupApp = (
  asyncResponseStore: IAsyncResponseStore,
  tenantsCacheManager: TenantsCacheManager,
  vaultRepository: VaultMemRepository,
) => {
  const cryptographyService = new CryptographyService(new AdapterCryptoSdkNode());
  mockKmsService.init();
  const apiRouter = createApiRouter(
    mockQueueAdapter,
    tenantsCacheManager,
    mockKmsService,
    asyncResponseStore,
    vaultRepository,
    cryptographyService,
    'http://host.example.com',
    mockAppAuthManager,
  );
  const app = express();
  app.use('/', apiRouter);
  return app;
};

describe('Organization Registration API', () => {
  let app: express.Express;
  let tenantsCacheManager: TenantsCacheManager;
  let vaultRepository: VaultMemRepository;
  let asyncResponseStore: IAsyncResponseStore;
  let mockConfig: IServerConfig;
  let cryptoService: CryptographyService;
  let externalEncrypter: MlkemPrivateJwk;
  let hostRuntime: IHostRuntime;
  const hostPublicEncKey: MlkemPublicJwk = {
    kty: 'OKP',
    crv: 'ML-KEM-768',
    kid: 'thumbprint-public-enc-key-device',
    x: 'base64url-public-enc-key-device',
  } as MlkemPublicJwk;

  let hostingManager: HostingManager;
  const originalSecurityMode = process.env.SECURITY_MODE;
  const originalDidcommPlain = process.env.DIDCOMM_PLAIN;
  const originalJsonLegacy = process.env.JSON_LEGACY;
  const originalDemoAllowInsecureBearer = process.env.DEMO_ALLOW_INSECURE_BEARER;

  beforeAll(async () => {
    process.env.SECURITY_MODE = 'demo';
    process.env.DIDCOMM_PLAIN = 'true';
    process.env.JSON_LEGACY = 'true';
    process.env.DEMO_ALLOW_INSECURE_BEARER = 'true';

    const hostCollectionName = resolveHostPhysicalCollectionName();
    vaultRepository = new VaultMemRepository();
    tenantsCacheManager = new TenantsCacheManager(vaultRepository, () => mockKmsService, hostCollectionName);
    asyncResponseStore = new AsyncResponseStoreMem();
    hostRuntime = {
      hostCollectionName,
      hostDid: 'did:web:host.example.com',
    };

    mockConfig = {
      securityMode: 'demo',
      networkMode: 'test',
      fhirLegacy: true,
      jsonLegacy: true,
      didcommPlainEnabled: true,
      demoAllowInsecureBearer: true,
      nodeEnv: 'test',
      port: 3000,
      maxHeaderSize: 16 * 1024,
      apiHostname: 'host',
      hostExternalDomain: 'host.example.com',
      apiBaseUrl: 'http://host.example.com',
      namespace: 'test-namespace',
      sectorsAllowed: [Sector.HEALTH_CARE, Sector.TEST, Sector.SYSTEM],
      dbProvider: 'mem',
      queueProvider: 'mem',
      storageProvider: 'mem',
      host: { legalName: 'Test Host', jurisdiction: 'us', idType: 'test-id', idValue: '12345' },
      mongo: { dbName: 'test' },
      firebase: {},
      allowedPaymentMethods: ['Stripe'],
    };

    mockKmsService.getHostPublicJwkSet.mockResolvedValue({ keys: [hostPublicEncKey as unknown as JWK] });

    app = setupApp(asyncResponseStore, tenantsCacheManager, vaultRepository);

    cryptoService = new CryptographyService(new AdapterCryptoSdkNode());
    mockKmsService.getHostPublicJwkSet.mockResolvedValue({ keys: [hostPublicEncKey as JWK] });
    
    const externalClientSeed = 'org-reg-v2-test-seed';
    const dsaSeed = createHash('sha256').update(externalClientSeed + '-dsa').digest().subarray(0, 32);
    const kemSeed = createHash('sha512').update(externalClientSeed + '-kem').digest().subarray(0, 64);
    const signerKeyPair = await cryptoService.generateKeyPairMlDsa(dsaSeed);
    const encrypterKeyPair = await cryptoService.generateKeyPairMlKem(kemSeed);
    externalEncrypter = { ...encrypterKeyPair.publicJWKey, dBytes: encrypterKeyPair.secretKeyBytes };
    mockKmsService.encodeResponse.mockImplementation(async (payload) =>
      cryptoService.encryptJweToCompact(payload, { cty: 'application/api+json' }, externalEncrypter, externalEncrypter),
    );
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    (asyncResponseStore as AsyncResponseStoreMem).clear();
    (vaultRepository as VaultMemRepository).clear();

    // Re-bootstrap the host before each test to ensure a clean state
    // Mocks for dependencies used by HostingManager
    mockStorageAdapter.upload.mockResolvedValue({
      publicUrl: 'https://storage.example.com/terms.pdf',
      encodedMultiHash: 'zQm...',
    });

    mockKmsService.getPublicJwks.mockImplementation(async () => ({
      keys: [
        { kid: 'sig-key-1', use: 'sig', alg: 'ML-DSA-44' } as any,
        { kid: 'enc-key-1', use: 'enc', crv: 'ML-KEM-768' } as any,
      ],
    }));

    mockKmsService.getHostPublicJwkSet.mockResolvedValue({ keys: [hostPublicEncKey as unknown as JWK] });
    mockKmsService.encodeResponse.mockImplementation(async (payload) =>
      cryptoService.encryptJweToCompact(payload, { cty: 'application/api+json' }, externalEncrypter, externalEncrypter),
    );

    hostingManager = new HostingManager(
      vaultRepository,
      mockKmsService,
      tenantsCacheManager,
      mockStorageAdapter,
      mockLogger,
      mockConfig,
      hostRuntime,
    );
    await hostingManager.bootstrapHost(testClaimsHostInitialization);
    await tenantsCacheManager.loadHost();
  });

  async function activateTenantDirectly(
    representativeCredentialId = 'did:web:controller.example.com',
    activationClaims: Record<string, unknown> = { ...testClaimsTenant1Registration },
  ): Promise<{ tenantId: string; sector: string }> {
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
                id: representativeCredentialId,
                memberOf: {
                  taxID: 'VATES-B00112233',
                },
                hasOccupation: { identifier: { value: 'RESPRSN' } },
                hasCredential: { material: 'controller-sig-kid' },
              },
            },
          ],
        },
      })).toString('base64url'),
      'mock-signature',
    ].join('.');

    const job: JobRequest = {
      id: uuidv4(),
      status: JobStatus.DRAFT,
      sequence: 0,
      createdAtTimestamp: Date.now(),
      tenantId: 'host',
      jurisdiction: 'es',
      sector: 'test' as Sector,
      section: 'registry',
      format: 'org.schema',
      action: '_activate',
      resourceType: 'Organization',
      content: {
        iss: 'did:web:controller.example.com',
        aud: 'did:web:host.example.com',
        thid: 'activation-thid',
        jti: 'activation-jti',
        type: 'json',
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
              id: representativeCredentialId,
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
              request: { method: 'POST' },
              resource: { meta: { claims: activationClaims } },
            },
          ],
        },
        meta: {
          jws: { protected: { alg: 'ML-DSA-44', kid: 'controller-sig-kid', jwk: { kty: 'AKP', alg: 'ML-DSA-44', pub: 'controller-sig-pub' } } },
          jwe: { header: { enc: 'A256GCM', skid: 'controller-enc-kid', jwk: { kty: 'OKP', crv: 'ML-KEM-768', x: 'controller-enc-x' } } },
        } as any,
      } as any,
      httpMethod: 'POST',
      requestUrl: '/host/cds-es/v1/test/registry/org.schema/Organization/_activate',
    };

    const response = await hostingManager.process(job);
    expect(response.body.data[0].response.status).toBe('201');
    const responseClaims = response.body.data[0].resource?.meta?.claims as Record<string, unknown>;
    return {
      tenantId: String(responseClaims[ClaimsOrganizationSchemaorg.alternateName]),
      sector: String(responseClaims[ClaimsServiceSchemaorg.category]),
    };
  }

  afterAll(async () => {
    process.env.SECURITY_MODE = originalSecurityMode;
    process.env.DIDCOMM_PLAIN = originalDidcommPlain;
    process.env.JSON_LEGACY = originalJsonLegacy;
    process.env.DEMO_ALLOW_INSECURE_BEARER = originalDemoAllowInsecureBearer;
    jest.clearAllMocks();
  });

  describe('tenant lifecycle authorization gating', () => {
    it('should accept activation when the representative credential subject id is a URN', async () => {
      const tenant = await activateTenantDirectly('urn:person:identifier:controller-001');

      expect(tenant).toMatchObject({
        tenantId: String(testClaimsTenant1Registration[ClaimsOrganizationSchemaorg.alternateName]),
        sector: String(testClaimsTenant1Registration[ClaimsServiceSchemaorg.category]),
      });
    });

    it('should accept activation in demo mode when ICA omits representative hasCredential but meta.jws carries the controller key id', async () => {
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
                  hasOccupation: { identifier: { value: 'RESPRSN' } },
                },
              },
            ],
          },
        })).toString('base64url'),
        'mock-signature',
      ].join('.');

      const job: JobRequest = {
        id: uuidv4(),
        status: JobStatus.DRAFT,
        sequence: 0,
        createdAtTimestamp: Date.now(),
        tenantId: 'host',
        jurisdiction: 'es',
        sector: 'test' as Sector,
        section: 'registry',
        format: 'org.schema',
        action: '_activate',
        resourceType: 'Organization',
        content: {
          iss: 'did:web:controller.example.com',
          aud: 'did:web:host.example.com',
          thid: 'activation-thid-demo-fallback',
          jti: 'activation-jti-demo-fallback',
          type: 'json',
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
              },
            },
            data: [
              {
                type: 'Organization-activation-request-v1.0',
                request: { method: 'POST' },
                resource: { meta: { claims: { ...testClaimsTenant1Registration } } },
              },
            ],
          },
          meta: {
            jws: { protected: { alg: 'ML-DSA-44', kid: 'controller-sig-kid', jwk: { kty: 'AKP', alg: 'ML-DSA-44', pub: 'controller-sig-pub' } } },
            jwe: { header: { enc: 'A256GCM', skid: 'controller-enc-kid', jwk: { kty: 'OKP', crv: 'ML-KEM-768', x: 'controller-enc-x' } } },
          } as any,
        } as any,
        httpMethod: 'POST',
        requestUrl: '/host/cds-es/v1/test/registry/org.schema/Organization/_activate',
      };

      const response = await hostingManager.process(job);

      expect(response.body.data[0].response.status).toBe('201');
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('demo-only representative hasCredential.material fallback'),
      );
      const tenantCollectionName = generateTenantCollectionNameFromClaims({
        ...testClaimsTenant1Registration,
        [ClaimsOrganizationSchemaorg.url]: 'https://api.acme.org',
      } as any);
      const proofDoc = await vaultRepository.get(
        tenantCollectionName,
        'activation-proof.json',
        getEnvSectionId('proofs'),
      );
      const proofContent = await mockKmsService.unprotectConfidentialData<any>(proofDoc as any, tenantCollectionName);
      expect(proofContent?.representativeCredential?.credentialSubject?.hasCredential?.material).toBe(
        toJwkThumbprintSha256Urn((job.content!.meta as any).jws.protected.jwk),
      );
    });

    it('should derive organization identifier claims from VC taxID when activation claims omit them', async () => {
      const activationClaims = { ...testClaimsTenant1Registration } as Record<string, unknown>;
      delete activationClaims[ClaimsOrganizationSchemaorg.alternateName];
      delete activationClaims[ClaimsOrganizationSchemaorg.identifier];
      delete activationClaims[ClaimsOrganizationSchemaorg.identifierType];
      delete activationClaims[ClaimsOrganizationSchemaorg.identifierValue];

      const tenant = await activateTenantDirectly(
        'urn:person:identifier:controller-001',
        activationClaims,
      );

      expect(tenant).toMatchObject({
        tenantId: 'VATES-B00112233',
        sector: String(testClaimsTenant1Registration[ClaimsServiceSchemaorg.category]),
      });
    });

    it('should default organization identifierType to UUID when activation claims provide a UUID value', async () => {
      const activationClaims = { ...testClaimsTenant1Registration } as Record<string, unknown>;
      delete activationClaims[ClaimsOrganizationSchemaorg.alternateName];
      delete activationClaims[ClaimsOrganizationSchemaorg.identifier];
      delete activationClaims[ClaimsOrganizationSchemaorg.identifierType];
      activationClaims[ClaimsOrganizationSchemaorg.identifierValue] = '123e4567-e89b-12d3-a456-426614174000';

      const tenant = await activateTenantDirectly(
        'urn:person:identifier:controller-001',
        activationClaims,
      );

      expect(tenant).toMatchObject({
        tenantId: '123e4567-e89b-12d3-a456-426614174000',
        sector: String(testClaimsTenant1Registration[ClaimsServiceSchemaorg.category]),
      });
    });

    it('should prefer a distinct legal identifier over taxID when deriving alternateName', async () => {
      const activationClaims = { ...testClaimsTenant1Registration } as Record<string, unknown>;
      delete activationClaims[ClaimsOrganizationSchemaorg.alternateName];
      delete activationClaims[ClaimsOrganizationSchemaorg.identifier];
      delete activationClaims[ClaimsOrganizationSchemaorg.identifierType];
      activationClaims[ClaimsOrganizationSchemaorg.identifierValue] = 'BC1234567';

      const tenant = await activateTenantDirectly(
        'urn:person:identifier:controller-001',
        activationClaims,
      );

      expect(tenant).toMatchObject({
        tenantId: 'BC1234567',
        sector: String(testClaimsTenant1Registration[ClaimsServiceSchemaorg.category]),
      });
    });

    it('should route signed organization lifecycle preflight through the host registry queue', async () => {
      const response = await invokeExpress(app, {
        method: 'POST',
        url: '/host/cds-es/v1/test/registry/org.schema/Organization/_status',
        headers: {
          'Content-Type': 'application/json',
          'App-ID': 'test-app',
          'App-Version': '1.0.0',
        },
        body: {
          thid: 'lifecycle-status-thid',
          body: { data: [{ type: 'Organization-lifecycle-status-request-v1.0', resource: { meta: { claims: {
            [ClaimsOrganizationSchemaorg.identifierValue]: testClaimsTenant1Registration[ClaimsOrganizationSchemaorg.identifierValue],
          } } } }] },
        },
      });
      expect(response.status).toBe(202);
      expect((mockQueueAdapter.addJob as jest.Mock).mock.calls[0][1].action).toBe('_status');
    });

    it('should route the protected paginated host Organization search through the host registry queue', async () => {
      const response = await invokeExpress(app, {
        method: 'POST',
        url: '/host/cds-es/v1/test/registry/org.schema/Organization/_search',
        headers: {
          'Content-Type': 'application/json',
          'App-ID': 'test-app',
          'App-Version': '1.0.0',
        },
        body: {
          thid: 'host-organization-search-thid',
          body: {
            resourceType: 'Bundle',
            type: 'searchset',
            meta: { pagination: { pageSize: 25 } },
            data: [{
              type: 'Organization-search-v1.0',
              resource: { resourceType: 'Organization', meta: { claims: {} } },
              request: { method: 'GET', url: 'Organization/_search' },
            }],
          },
        },
      });

      expect(response.status).toBe(202);
      expect((mockQueueAdapter.addJob as jest.Mock).mock.calls[0][1]).toMatchObject({
        action: '_search',
        resourceType: 'Organization',
        section: 'registry',
        format: 'org.schema',
      });
    });

    it.each(['_disable-descendants', '_purge-descendants'])(
      'should not expose the non-resource lifecycle action %s',
      async (action) => {
        // The action literal is the rejected wire contract under test.
        const response = await invokeExpress(app, {
          method: 'POST',
          url: `/host/cds-es/v1/test/registry/org.schema/Organization/${action}`,
          headers: {
            'Content-Type': 'application/json',
            'App-ID': 'test-app',
            'App-Version': '1.0.0',
          },
          body: {
            thid: `lifecycle-${action}-thid`,
            body: { data: [{ type: 'Organization-lifecycle-request-v1.0', resource: { meta: { claims: {
              [ClaimsOrganizationSchemaorg.identifierValue]: testClaimsTenant1Registration[ClaimsOrganizationSchemaorg.identifierValue],
            } } } }] },
          },
        });

        expect(response.status).toBe(404);
        expect(mockQueueAdapter.addJob).not.toHaveBeenCalled();
      },
    );

    it('should block tenant onboarding flows while disabled and allow them again after enable', async () => {
      const tenant = await activateTenantDirectly();

      const disablePayload = {
        thid: 'disable-thid',
        body: {
          data: [
            {
              type: 'Organization-disable-request-v1.0',
              resource: { meta: { claims: {
                  [ClaimsOrganizationSchemaorg.identifierValue]: testClaimsTenant1Registration[ClaimsOrganizationSchemaorg.identifierValue],
                } } },
            },
          ],
        },
      };

      const disableResponse = await invokeExpress(app, {
        method: 'POST',
        url: '/host/cds-es/v1/test/registry/org.schema/Organization/_disable',
        headers: {
          'Content-Type': 'application/json',
          'App-ID': 'test-app',
          'App-Version': '1.0.0',
        },
        body: disablePayload,
      });
      expect(disableResponse.status).toBe(202);
      const disableJob = (mockQueueAdapter.addJob as jest.Mock).mock.calls[0][1] as JobRequest;
      await hostingManager.process(disableJob);

      const employeeUrl = `/${tenant.tenantId}/cds-es/v1/${tenant.sector}/entity/org.schema/Employee/_batch`;
      const employeePayload = {
        thid: 'employee-thid-1',
        body: {
          data: [
            {
              type: 'Employee-registration-request-v1.0',
              resource: { meta: { claims: {
                  'Organization.owner.email': 'doctor@example.com',
                  'Organization.owner.hasOccupation.identifier.value': 'RESPRSN',
                } } },
              request: { method: 'POST' },
            },
          ],
        },
      };

      const blockedResponse = await invokeExpress(app, {
        method: 'POST',
        url: employeeUrl,
        headers: {
          'Content-Type': 'application/json',
          'App-ID': 'test-app',
          'App-Version': '1.0.0',
        },
        body: employeePayload,
      });
      expect(blockedResponse.status).toBe(403);
      expect(blockedResponse.text).toContain('suspended');
      expect(mockQueueAdapter.addJob).toHaveBeenCalledTimes(1);

      const enableResponse = await invokeExpress(app, {
        method: 'POST',
        url: '/host/cds-es/v1/test/registry/org.schema/Organization/_enable',
        headers: {
          'Content-Type': 'application/json',
          'App-ID': 'test-app',
          'App-Version': '1.0.0',
        },
        body: {
          thid: 'enable-thid',
          body: {
            data: [
              {
                type: 'Organization-enable-request-v1.0',
                resource: { meta: { claims: {
                    [ClaimsOrganizationSchemaorg.identifierValue]: testClaimsTenant1Registration[ClaimsOrganizationSchemaorg.identifierValue],
                  } } },
              },
            ],
          },
        },
      });
      expect(enableResponse.status).toBe(202);
      const enableJob = (mockQueueAdapter.addJob as jest.Mock).mock.calls[1][1] as JobRequest;
      await hostingManager.process(enableJob);

      const allowedResponse = await invokeExpress(app, {
        method: 'POST',
        url: employeeUrl,
        headers: {
          'Content-Type': 'application/json',
          'App-ID': 'test-app',
          'App-Version': '1.0.0',
        },
        body: {
          ...employeePayload,
          thid: 'employee-thid-2',
        },
      });
      expect(allowedResponse.status).toBe(202);
      expect(mockQueueAdapter.addJob).toHaveBeenCalledTimes(3);
    });
  });

  describe('POST /host/.../_batch (Job Submission)', () => {
    /**
     * Flow contract: a reviewed organization that has no tenant or DCR client
     * proves possession of the exact communication keys carried by its
     * transaction controller binding; the host verifies those keys before
     * queueing and retains the encryption key for the protected response.
     */
    it('accepts the reviewed controller communication binding before DCR', async () => {
      const controllerDid = 'did:web:host.example.com:7654321:cds-CA-BC:v1:animal-research:employee:controller:RESPRSN';
      const signerJwk = { kid: 'bootstrap-comm-signing', kty: 'AKP', alg: 'ML-DSA-44', pub: 'bootstrap-signing-public', use: 'sig' } as any;
      const encrypterJwk = { kid: 'bootstrap-comm-encryption', kty: 'OKP', crv: 'ML-KEM-768', x: 'bootstrap-encryption-public', use: 'enc' } as any;
      const decodedJob = structuredClone(ORGANIZATION_REGISTRATION_JOB) as JobRequest;
      const content = structuredClone(ORGANIZATION_REGISTRATION_REQUEST) as any;
      decodedJob.content = content;
      content.iss = controllerDid;
      content.meta = {
        jws: { protected: { kid: signerJwk.kid, alg: signerJwk.alg }, signature: 'bootstrap-signature' },
        jwe: { header: { skid: encrypterJwk.kid } },
      } as any;
      content.body.data[0].resource = {
        ...content.body.data[0].resource,
        controller: { did: controllerDid, jwks: { keys: [signerJwk, encrypterJwk] } },
      };
      mockKmsService.decodeRequest.mockResolvedValueOnce(decodedJob);
      const verify = jest.spyOn(CryptographyService.prototype, 'verifyDetachedJws').mockResolvedValueOnce(true);

      const response = await invokeExpress(app, {
        method: 'POST',
        url: '/host/cds-001/v1/test/registry/org.schema/Organization/_transaction',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Authorization: 'Bearer fake-oidc-id-token',
        },
        body: { request: 'reviewed-bootstrap-jwe' },
      });

      expect(response.status).toBe(202);
      expect(verify).toHaveBeenCalledWith(expect.any(Uint8Array), expect.any(String), signerJwk);
      const queued = (mockQueueAdapter.addJob as jest.Mock).mock.calls[0][1] as JobRequest;
      expect(queued.content?.meta?.jws?.protected?.jwk).toEqual(signerJwk);
      expect((queued.content?.meta?.jwe?.header as any)?.jwk).toEqual(encrypterJwk);
      verify.mockRestore();
    });

    /**
     * Flow contract: the commercial Order is signed by the same pre-DCR
     * communication wallet and is verified against the protected keys retained
     * with its pending Offer; it never requires a fictional existing DCR client.
     */
    it('accepts the pending Offer controller communication keys before DCR', async () => {
      const controllerDid = 'did:web:host.example.com:7654321:cds-CA-BC:v1:animal-research:employee:controller:RESPRSN';
      const signerJwk = { kid: 'pending-comm-signing', kty: 'AKP', alg: 'ML-DSA-44', pub: 'pending-signing-public', use: 'sig' } as any;
      const encrypterJwk = { kid: 'pending-comm-encryption', kty: 'OKP', crv: 'ML-KEM-768', x: 'pending-encryption-public', use: 'enc' } as any;
      const registrationJob = structuredClone(ORGANIZATION_REGISTRATION_JOB) as JobRequest;
      registrationJob.content = structuredClone(ORGANIZATION_REGISTRATION_REQUEST) as any;
      registrationJob.content!.iss = controllerDid;
      registrationJob.content!.body.data[0] = withCanonicalEntryClaims(
        registrationJob.content!.body.data[0],
        {
          [ClaimsOrganizationSchemaorg.addressCountry]: testAnimalResearchRegistrationClaims[ClaimsOrganizationSchemaorg.addressCountry],
          [ClaimsOrganizationSchemaorg.addressRegion]: testAnimalResearchRegistrationClaims[ClaimsOrganizationSchemaorg.addressRegion],
        },
      );
      registrationJob.content!.meta = {
        jws: { protected: { kid: signerJwk.kid, alg: signerJwk.alg, jwk: signerJwk }, signature: 'registration-signature' },
        jwe: { header: { skid: encrypterJwk.kid, jwk: encrypterJwk } },
      } as any;
      const offerResponse = await hostingManager.process(registrationJob);
      expect(offerResponse.body.data[0].resource.meta.claims[ClaimsOrganizationSchemaorg.identifier]).toContain(':ca-bc:');
      const offerId = offerResponse.body.data[0].resource.meta.claims[ClaimsOfferSchemaorg.identifier] as string;
      const pendingRows = await vaultRepository.query(hostRuntime.hostCollectionName!, {
        sectionId: getEnvSectionId('tenants'),
        where: [{ name: ClaimsOfferSchemaorg.identifier, value: offerId }],
      });
      const pendingContent = await mockKmsService.unprotectConfidentialData(pendingRows[0] as any, 'host') as any;
      expect(pendingContent.registrationControllerDid).toBe(controllerDid);

      const orderContent = structuredClone(ORGANIZATION_ORDER_REQUEST) as any;
      orderContent.iss = controllerDid;
      orderContent.meta = {
        jws: { protected: { kid: signerJwk.kid, alg: signerJwk.alg }, signature: 'order-signature' },
        jwe: { header: { skid: encrypterJwk.kid } },
      };
      orderContent.body.data[0] = withCanonicalEntryClaims(
        orderContent.body.data[0],
        { [ClaimsOrderSchemaorg.acceptedOfferIdentifier]: offerId },
      );
      mockKmsService.decodeRequest.mockResolvedValueOnce({
        ...registrationJob,
        resourceType: 'Order',
        action: '_batch',
        content: orderContent,
      });
      const verify = jest.spyOn(CryptographyService.prototype, 'verifyDetachedJws').mockResolvedValueOnce(true);

      const response = await invokeExpress(app, {
        method: 'POST',
        url: '/host/cds-001/v1/test/registry/org.schema/Order/_batch',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Authorization: 'Bearer fake-oidc-id-token',
        },
        body: { request: 'pending-order-jwe' },
      });

      expect(response.status).toBe(202);
      expect(verify).toHaveBeenCalledWith(expect.any(Uint8Array), expect.any(String), signerJwk);
      const queued = (mockQueueAdapter.addJob as jest.Mock).mock.calls[0][1] as JobRequest;
      expect((queued.content?.meta?.jwe?.header as any)?.jwk).toEqual(encrypterJwk);
      verify.mockRestore();
    });

    it('decrypts the thid from a secure form polling request', async () => {
      const thid = 'secure-poll-thread';
      const encryptedPoll = 'secure.poll.request';
      await asyncResponseStore.set(thid, { status: 'PENDING', vaultId: 'host' });
      mockKmsService.decodeRequest.mockResolvedValueOnce({
        id: 'secure-poll-job',
        status: JobStatus.DRAFT,
        sequence: 0,
        createdAtTimestamp: Date.now(),
        section: 'unknown',
        format: 'unknown',
        resourceType: 'unknown',
        action: 'unknown',
        content: {
          thid,
          jti: 'secure-poll-jti',
          iss: 'did:web:poller.example.org',
          aud: 'did:web:host.example.org',
          type: 'application/api+json',
          body: {},
        },
      });

      const response = await invokeExpress(app, {
        method: 'POST',
        url: '/host/cds-es/v1/test/registry/org.schema/Organization/_issue-response',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Authorization: 'Bearer fake-oidc-id-token',
        },
        body: { request: encryptedPoll },
      });

      expect(response.status).toBe(202);
      expect(JSON.parse(response.text)).toEqual({ thid, status: 'PENDING' });
      expect(mockKmsService.decodeRequest).toHaveBeenCalledWith(encryptedPoll);
    });

    it('should decode the request, queue a job, and return 202 Accepted', async () => {
      const registrationUrl = `/host/cds-es/v1/test/registry/org.schema/Organization/_batch`;
      const expectedPollingUrl = `http://host.example.com${registrationUrl.replace('/_batch', '/_batch-response')}`;
      // In this test, we only care that the job is queued. We don't need a valid decoded job.
      mockKmsService.decodeRequest.mockResolvedValue({
        ...ORGANIZATION_REGISTRATION_JOB,
        content: withoutIncompleteJwsProof(ORGANIZATION_REGISTRATION_REQUEST)
      } as any);

      const response = await invokeExpress(app, {
        method: 'POST',
        url: registrationUrl,
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'App-ID': 'test-app',
          'App-Version': '1.0.0',
          Authorization: 'Bearer fake-oidc-id-token',
        },
        body: { request: testEncryptedJwe1 },
      });

      expect(mockKmsService.decodeRequest).toHaveBeenCalledWith(testEncryptedJwe1);
      expect(mockQueueAdapter.addJob).toHaveBeenCalledTimes(1);
      const queuedJob = (mockQueueAdapter.addJob as jest.Mock).mock.calls[0][1] as JobRequest;
      expect(queuedJob.tenantId).toBe(ORGANIZATION_REGISTRATION_JOB.tenantId);
      expect(response.status).toBe(202);
      expect(response.headers.location).toBe(expectedPollingUrl);
    });
  });

  describe('Organization Registration v2 (Offer/Order Flow)', () => {
    it('should accept a registration request and return a verifiable Offer', async () => {
      const verify = jest.spyOn(CryptographyService.prototype, 'verifyDetachedJws').mockResolvedValue(true);
      const orgCreationPayload = withCompleteFixtureJwsProof(ORGANIZATION_REGISTRATION_REQUEST) as any;
      const { thid } = orgCreationPayload;

      // The controller calls decodeRequest. We mock its output to be the job for the manager.
      const decodedJobForManager: JobRequest = {
        ...ORGANIZATION_REGISTRATION_JOB,
        id: uuidv4(),
        status: JobStatus.DRAFT,
        sequence: 0,
        createdAtTimestamp: Date.now(),
        content: orgCreationPayload,
      };
      mockKmsService.decodeRequest.mockResolvedValue(decodedJobForManager);

      // The router queues the job. We'll capture it to simulate the worker processing it later.
      let capturedJob: JobRequest | undefined;
      mockQueueAdapter.addJob.mockImplementation(async (jobName, jobData) => {
        capturedJob = jobData;
      });

      const compactJwe = "fake.encrypted.payload"; // This can be fake as decodeRequest is mocked
      const registrationUrl = `/host/cds-es/v1/test/registry/org.schema/Organization/_batch`;
      
      // --- ACT (Phase 1) ---
      const postResponse = await invokeExpress(app, {
        method: 'POST',
        url: registrationUrl,
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'App-ID': 'test-app',
          'App-Version': '1.0.0',
          Authorization: 'Bearer fake-oidc-id-token',
        },
        body: { request: compactJwe },
      });

      // --- ASSERT (Phase 1) ---
      expect(postResponse.status).toBe(202);
      expect(mockQueueAdapter.addJob).toHaveBeenCalledTimes(1);
      expect(capturedJob).toBeDefined();

      // --- ACT (Phase 2: Simulate Worker) ---
      // Now, we simulate the worker picking up the job and processing it.
      // The hostingManager is now initialized in beforeEach.
      const workerResultPayload = await hostingManager.process(capturedJob!);
      const encryptedWorkerResult = await mockKmsService.encodeResponse(workerResultPayload, [externalEncrypter as unknown as JWK], 'host');
      await asyncResponseStore.set(thid, { status: 'COMPLETED', result: encryptedWorkerResult });

      // --- ACT (Phase 3: Polling) ---
      const pollingUrl = postResponse.headers.location;
      const pollingPath = new URL(pollingUrl).pathname;
      const pollResponse = await invokeExpress(app, {
        method: 'POST',
        url: pollingPath,
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'App-ID': 'test-app',
          'App-Version': '1.0.0',
          Authorization: 'Bearer fake-oidc-id-token',
        },
        body: { thid },
      });

      // --- ASSERT (Phase 3) ---
      expect(pollResponse.status).toBe(200);
      const encryptedFinalResponse = pollResponse.text.replace('response=', '');
      const { decryptedBytes } = await cryptoService.decryptJwe(encryptedFinalResponse, externalEncrypter);
      const finalResponse = JSON.parse(Content.bytesToStringUTF8(decryptedBytes)) as IDecodedDidcommPayload;

      const responseEntry = finalResponse.body.data[0];
      const responseClaims = responseEntry.resource.meta.claims;

      expect(responseEntry.type).toBe('Organization-registration-offer-v1.0');
      expect(responseClaims[ClaimsOfferSchemaorg.eligibleQuantityValue]).toBe(2);
      expect(responseClaims[ClaimsOfferSchemaorg.identifier]).toBeDefined();
      expect(responseClaims[ClaimsOfferSchemaorg.offeredBy]).toBe('did:web:host.example.com');
      verify.mockRestore();
    });

    it('should accept a legal registration request without alternateName and derive it from identifier.value', async () => {
      const verify = jest.spyOn(CryptographyService.prototype, 'verifyDetachedJws').mockResolvedValue(true);
      const orgCreationPayload = withCompleteFixtureJwsProof(ORGANIZATION_REGISTRATION_REQUEST) as any;
      orgCreationPayload.body.data[0] = withCanonicalEntryClaims(orgCreationPayload.body.data[0], {});
      delete (orgCreationPayload.body.data[0].resource.meta.claims as Record<string, unknown>)[ClaimsOrganizationSchemaorg.alternateName];
      const { thid } = orgCreationPayload;

      const decodedJobForManager: JobRequest = {
        ...ORGANIZATION_REGISTRATION_JOB,
        id: uuidv4(),
        status: JobStatus.DRAFT,
        sequence: 0,
        createdAtTimestamp: Date.now(),
        content: orgCreationPayload,
      };
      mockKmsService.decodeRequest.mockResolvedValue(decodedJobForManager);

      let capturedJob: JobRequest | undefined;
      mockQueueAdapter.addJob.mockImplementation(async (_jobName, jobData) => {
        capturedJob = jobData;
      });

      const registrationUrl = `/host/cds-es/v1/test/registry/org.schema/Organization/_batch`;
      const postResponse = await invokeExpress(app, {
        method: 'POST',
        url: registrationUrl,
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'App-ID': 'test-app',
          'App-Version': '1.0.0',
          Authorization: 'Bearer fake-oidc-id-token',
        },
        body: { request: 'fake-jwe-no-alt' },
      });

      expect(postResponse.status).toBe(202);
      expect(capturedJob).toBeDefined();

      const workerResultPayload = await hostingManager.process(capturedJob!);
      const encryptedWorkerResult = await mockKmsService.encodeResponse(workerResultPayload, [externalEncrypter as unknown as JWK], 'host');
      await asyncResponseStore.set(thid, { status: 'COMPLETED', result: encryptedWorkerResult });

      const pollingPath = new URL(postResponse.headers.location).pathname;
      const pollResponse = await invokeExpress(app, {
        method: 'POST',
        url: pollingPath,
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'App-ID': 'test-app',
          'App-Version': '1.0.0',
          Authorization: 'Bearer fake-oidc-id-token',
        },
        body: { thid },
      });

      expect(pollResponse.status).toBe(200);
      const encryptedFinalResponse = pollResponse.text.replace('response=', '');
      const { decryptedBytes } = await cryptoService.decryptJwe(encryptedFinalResponse, externalEncrypter);
      const finalResponse = JSON.parse(Content.bytesToStringUTF8(decryptedBytes)) as IDecodedDidcommPayload;
      const responseClaims = finalResponse.body.data[0].resource.meta.claims;

      expect(responseClaims['org.schema.Organization.identifier.value']).toBe('acme-id');
      expect(responseClaims['org.schema.Organization.alternateName']).toBe('acme-id');
      verify.mockRestore();
    });

    it('should process an Order and return a payment Communication', async () => {
      const verify = jest.spyOn(CryptographyService.prototype, 'verifyDetachedJws').mockResolvedValue(true);
      // --- ARRANGE (Phase 1: Initial Registration & Offer) ---
      const orgCreationPayload = withCompleteFixtureJwsProof(ORGANIZATION_REGISTRATION_REQUEST);
      const { thid: regThid } = orgCreationPayload;
      const registrationUrl = `/host/cds-es/v1/test/registry/org.schema/Organization/_batch`;

      const decodedRegJob: JobRequest = {
        ...ORGANIZATION_REGISTRATION_JOB,
        id: uuidv4(),
        status: JobStatus.DRAFT,
        sequence: 0,
        createdAtTimestamp: Date.now(),
        content: orgCreationPayload,
      };
      mockKmsService.decodeRequest.mockResolvedValueOnce(decodedRegJob);

      let capturedRegJob: JobRequest | undefined;
      mockQueueAdapter.addJob.mockImplementationOnce(async (jobName, jobData) => {
        capturedRegJob = jobData;
      });

      const regPostResponse = await invokeExpress(app, {
        method: 'POST',
        url: registrationUrl,
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'App-ID': 'test-app',
          'App-Version': '1.0.0',
          Authorization: 'Bearer fake-oidc-id-token',
        },
        body: { request: 'fake-jwe' },
      });
      
      const offerPayload = await hostingManager.process(capturedRegJob!);
      const encryptedOffer = await mockKmsService.encodeResponse(offerPayload, [externalEncrypter as unknown as JWK], 'host');
      await asyncResponseStore.set(regThid, { status: 'COMPLETED', result: encryptedOffer });
      
      const pollingUrl = regPostResponse.headers.location;
      const pollingPath = new URL(pollingUrl).pathname;
      const pollResponse = await invokeExpress(app, {
        method: 'POST',
        url: pollingPath,
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'App-ID': 'test-app',
          'App-Version': '1.0.0',
          Authorization: 'Bearer fake-oidc-id-token',
        },
        body: { thid: regThid },
      });

      const encryptedOfferResponse = pollResponse.text.replace('response=', '');
      const { decryptedBytes: decryptedOfferBytes } = await cryptoService.decryptJwe(encryptedOfferResponse, externalEncrypter);
      const offerResponse = JSON.parse(Content.bytesToStringUTF8(decryptedOfferBytes)) as IDecodedDidcommPayload;
      const offerClaims = offerResponse.body.data[0].resource.meta.claims;
      const offerId = offerClaims[ClaimsOfferSchemaorg.identifier] as string;
      expect(offerId).toBeDefined();

      // --- ACT (Phase 2: Submit Order) ---
      const orderPayload = withCompleteFixtureJwsProof(ORGANIZATION_ORDER_REQUEST) as any;
      orderPayload.body.data[0] = withCanonicalEntryClaims(orderPayload.body.data[0], {
        [ClaimsOrderSchemaorg.acceptedOfferIdentifier]: offerId,
      });
      const { thid: orderThid } = orderPayload;
      
      const decodedOrderJob: JobRequest = {
        ...ORGANIZATION_REGISTRATION_JOB, // Re-using for structure, but with Order content
        resourceType: 'Order',
        id: uuidv4(),
        status: JobStatus.DRAFT,
        sequence: 0,
        createdAtTimestamp: Date.now(),
        content: orderPayload,
      };
      // For this test we bypass orchestrator signature resolution by embedding a JWK,
      // matching the "full JWK" path used during initial registration.
      (decodedOrderJob.content as any).meta = (decodedOrderJob.content as any).meta || {};
      (decodedOrderJob.content as any).meta.jwe = (decodedOrderJob.content as any).meta.jwe || { header: {} };
      (decodedOrderJob.content as any).meta.jwe.header = (decodedOrderJob.content as any).meta.jwe.header || {};
      (decodedOrderJob.content as any).meta.jwe.header.jwk = hostPublicEncKey as unknown as JWK;
      mockKmsService.decodeRequest.mockResolvedValueOnce(decodedOrderJob);

      let capturedOrderJob: JobRequest | undefined;
      mockQueueAdapter.addJob.mockImplementationOnce(async (jobName, jobData) => {
        capturedOrderJob = jobData;
      });
      
      const orderUrl = `/host/cds-es/v1/test/registry/org.schema/Order/_batch`;
      const orderPostResponse = await invokeExpress(app, {
        method: 'POST',
        url: orderUrl,
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'App-ID': 'test-app',
          'App-Version': '1.0.0',
          Authorization: 'Bearer fake-oidc-id-token',
        },
        body: { request: 'fake-jwe-order' },
      });

      // --- ASSERT (Phase 2: Order Submission) ---
      expect(orderPostResponse.status).toBe(202);
      expect(mockQueueAdapter.addJob).toHaveBeenCalledTimes(2);
      expect(capturedOrderJob).toBeDefined();

      // --- ACT (Phase 3: Simulate Worker on Order & Poll) ---
      const finalResultPayload = await hostingManager.process(capturedOrderJob!);
      const encryptedFinalResult = await mockKmsService.encodeResponse(finalResultPayload, [externalEncrypter as unknown as JWK], 'host');
      await asyncResponseStore.set(orderThid, { status: 'COMPLETED', result: encryptedFinalResult });

      const orderPollingUrl = orderPostResponse.headers.location;
      const orderPollingPath = new URL(orderPollingUrl).pathname;
      const finalPollResponse = await invokeExpress(app, {
        method: 'POST',
        url: orderPollingPath,
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'App-ID': 'test-app',
          'App-Version': '1.0.0',
          Authorization: 'Bearer fake-oidc-id-token',
        },
        body: { thid: orderThid },
      });
      
      // --- ASSERT (Phase 3: Final VC) ---
      expect(finalPollResponse.status).toBe(200);
      const encryptedFinalVc = finalPollResponse.text.replace('response=', '');
      const { decryptedBytes: decryptedVcBytes } = await cryptoService.decryptJwe(encryptedFinalVc, externalEncrypter);
      const finalVcResponse = JSON.parse(Content.bytesToStringUTF8(decryptedVcBytes)) as IDecodedDidcommPayload;

      const responseEntry = finalVcResponse.body.data[0];
      expect(responseEntry.type).toBe('Organization-order-response-v1.0');
      expect(responseEntry.response.status).toBe('201');
      expect(responseEntry.resource?.meta?.claims?.[ClaimsOrderSchemaorg.acceptedOfferIdentifier]).toBe(offerId);
      verify.mockRestore();
    });
  });
});
