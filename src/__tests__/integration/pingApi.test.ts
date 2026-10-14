// TDD contract: ping routing fixtures make no JWS claim unless a complete signature is under test.
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

import express from 'express';
import { CryptographyService } from 'gdc-common-utils-ts/CryptographyService';
import { createApiRouter } from '../../routes/api';
import { QueueAdapter } from '../../adapters/queue';
import { TenantsCacheManager } from '../../managers/TenantsCacheManager';
import { mockKmsService } from '../mocks/kms.mock';
import { VaultMemRepository } from '../../database/repositories/vault/vault.mem.repository';
import { AsyncResponseStoreMem, IAsyncResponseStore } from '../../adapters/async-response-store.mem';
import { StoredJob } from '../../adapters/async-response-store.mem';
import { decodedPingMessage, testEncryptedJwePing, decodedTenantPingMessage } from '../data/ping.data';
import { testCompletedJob, testPendingJob } from '../data/async-response.data';
import { IssueType } from 'gdc-common-utils-ts/models/issue';
import { JobRequest } from 'gdc-common-utils-ts/models/confidential-job';
import { DidService } from '../../gdc-backend-utils-node/models/did';
import { Content } from 'gdc-common-utils-ts/utils/content';
import { invokeExpress } from './helpers/invokeExpress';
import { AdapterCryptoSdkNode } from '../../gdc-backend-utils-node/adapters/node/crypto';

// --- Mock Dependencies ---
const mockQueueAdapter: jest.Mocked<QueueAdapter> = {
  addJob: jest.fn(),
};

// Define a reusable setup function to create the app instance
const setupApp = (asyncResponseStore: IAsyncResponseStore) => {
  const app = express();
  app.use(express.urlencoded({ extended: true }));
  app.use(express.json());

  const vaultRepository = new VaultMemRepository();
  const cryptographyService = new CryptographyService(new AdapterCryptoSdkNode());
  const tenantsCacheManager = new TenantsCacheManager(vaultRepository, () => mockKmsService, 'test-host-collection');

  mockKmsService.init();

  const apiRouter = createApiRouter(
    mockQueueAdapter,
    tenantsCacheManager,
    mockKmsService,
    asyncResponseStore,
    vaultRepository,
    cryptographyService,
    'http://testhost.com' // Mock base URL for testing
  );
  app.use('/', apiRouter);

  return { app, tenantsCacheManager };
};

describe('Ping API Endpoint', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  const pingServiceConfig: DidService = {
    id: '#ping:standard',
    type: 'ApiService',
    serviceEndpoint: 'resource',
    actions: ['_batch'],
    selector: { section: 'ping', format: 'standard' },
  };

  describe('POST /host/.../_batch (Host Ping)', () => {
    it('should queue a job for the host and return 202', async () => {
      // --- Arrange ---
      const asyncResponseStore = new AsyncResponseStoreMem();
      const { app, tenantsCacheManager } = setupApp(asyncResponseStore);

      // Spy on the correct method used by the router for validation
      jest.spyOn(tenantsCacheManager, 'getDidServiceConfig').mockResolvedValue([pingServiceConfig]);
      
      const mockDecodedJob: JobRequest = {
        id: 'mock-job-id',
        status: 'DRAFT' as any,
        sequence: 0,
        createdAtTimestamp: Date.now(),
        content: {
          ...decodedPingMessage,
          meta: {
            jwe: {
              header: {
                skid: 'did:web:some-issuer#enc-key-1',
                jwk: { kty: 'OKP', crv: 'ML-KEM-768', kid: 'did:web:some-issuer#enc-key-1', x: 'mock-key' }
              }
            },
            bearer: {
              jwt: { payload: { email: 'ping@test.com' } },
            }
          },
        },
        tenantId: 'host',
        resourceType: 'resource',
        action: '_batch',
        sector: 'test',
        section: 'ping',
        format: 'standard'
      };
      mockKmsService.decodeRequest.mockResolvedValue(mockDecodedJob);

      const pingUrl = '/host/cds-xx/v1/test/ping/standard/resource/_batch';
      const expectedPollingUrl = `http://testhost.com${pingUrl.replace('/_batch', '/_batch-response')}`;
      // --- Act ---
      const response = await invokeExpress(app, {
        method: 'POST',
        url: pingUrl,
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: { request: testEncryptedJwePing },
      });
        
      // --- Assert ---
      expect(response.status).toBe(202);
      expect(response.headers.location).toBe(expectedPollingUrl);
      expect(mockQueueAdapter.addJob).toHaveBeenCalledTimes(1);
      
      const [jobName, jobRequest] = mockQueueAdapter.addJob.mock.calls[0];
      // The jobName should be created with the vaultId, which for the host is 'host'.
      expect(jobName).toContain('host:resource:_batch');
      // The jobRequest's tenantId should be the alternateName from the path.
      expect(jobRequest.tenantId).toBe('host');
      expect(jobRequest.sector).toBe('test');
    });
  });

  describe('POST /:tenantId/.../_batch (Tenant Ping)', () => {
    it('should queue a job for a valid tenant and return 202', async () => {
      // --- Arrange ---
      const asyncResponseStore = new AsyncResponseStoreMem();
      const { app, tenantsCacheManager } = setupApp(asyncResponseStore);

      jest.spyOn(tenantsCacheManager, 'getDidServiceConfig').mockResolvedValue([pingServiceConfig]);

      const mockDecodedJob: JobRequest = {
        id: 'mock-job-id-2',
        status: 'DRAFT' as any,
        sequence: 0,
        createdAtTimestamp: Date.now(),
        content: {
          ...decodedTenantPingMessage,
          meta: {
            jwe: {
              header: {
                skid: 'did:web:some-issuer#enc-key-1',
                jwk: { kty: 'OKP', crv: 'ML-KEM-768', kid: 'did:web:some-issuer#enc-key-1', x: 'mock-key' }
              }
            },
            bearer: {
              jwt: { payload: { email: 'ping@test.com' } },
            }
          },
        },
        tenantId: 'acme',
        resourceType: 'resource',
        action: '_batch',
        sector: 'test',
        section: 'ping',
        format: 'standard'
      };
      mockKmsService.decodeRequest.mockResolvedValue(mockDecodedJob);
      const pingUrl = '/acme/cds-xx/v1/test/ping/standard/resource/_batch';
      const expectedPollingUrl = `http://testhost.com${pingUrl.replace('/_batch', '/_batch-response')}`;

      // --- Act ---
      const response = await invokeExpress(app, {
        method: 'POST',
        url: pingUrl,
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: { request: testEncryptedJwePing },
      });

      // --- Assert ---
      expect(response.status).toBe(202);
      expect(response.headers.location).toBe(expectedPollingUrl);
      expect(mockQueueAdapter.addJob).toHaveBeenCalledTimes(1);

      const [jobName, jobRequest] = (mockQueueAdapter.addJob as jest.Mock).mock.calls[0];
      // The jobName is now created with the vaultId to ensure uniqueness.
      expect(jobName).toContain('test_acme:resource:_batch');
      // The jobRequest itself should retain the original path parameters for the worker.
      expect(jobRequest.tenantId).toBe('acme');
      expect(jobRequest.sector).toBe('test');
    });
  });

  describe('Router Security and Validation', () => {
    it('should return 404 if the tenant service config does not exist', async () => {
        const asyncResponseStore = new AsyncResponseStoreMem();
        const { app, tenantsCacheManager } = setupApp(asyncResponseStore);
        jest.spyOn(tenantsCacheManager, 'getDidServiceConfig').mockResolvedValue(undefined);
        const pingUrl = '/nonexistent-tenant/cds-xx/v1/test/ping/standard/resource/_batch';

        const response = await invokeExpress(app, {
          method: 'POST',
          url: pingUrl,
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: { request: testEncryptedJwePing },
        });

        expect(response.status).toBe(404);
        const outcomeEnvelope = JSON.parse(response.text);
        expect(outcomeEnvelope.type).toBe('application/bundle-api+json');
        expect(outcomeEnvelope.body.resourceType).toBe('Bundle');
        expect(outcomeEnvelope.body.issues.issue[0].code).toBe(IssueType.NotFound);
        expect(mockQueueAdapter.addJob).not.toHaveBeenCalled();
      });

    it('should return 404 if the service is not in the DID', async () => {
        const asyncResponseStore = new AsyncResponseStoreMem();
        const { app, tenantsCacheManager } = setupApp(asyncResponseStore);
        jest.spyOn(tenantsCacheManager, 'getDidServiceConfig').mockResolvedValue([]);
        const pingUrl = '/tenant1/cds-xx/v1/test/ping/standard/resource/_batch';

        const response = await invokeExpress(app, {
          method: 'POST',
          url: pingUrl,
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: { request: testEncryptedJwePing },
        });

        expect(response.status).toBe(404);
        expect(mockQueueAdapter.addJob).not.toHaveBeenCalled();
      });
    });

  describe('POST /host/.../_batch (Legacy JSON Ping)', () => {
    it('should reject plain JSON when JSON legacy mode is not enabled', async () => {
      // --- Arrange ---
      const originalSecurityMode = process.env.SECURITY_MODE;
      const originalJsonLegacy = process.env.JSON_LEGACY;
      process.env.SECURITY_MODE = 'compat';
      process.env.JSON_LEGACY = 'false';
      const asyncResponseStore = new AsyncResponseStoreMem();
      const { app, tenantsCacheManager } = setupApp(asyncResponseStore);
  
      // The router must still validate that the service endpoint exists
      jest.spyOn(tenantsCacheManager, 'getDidServiceConfig').mockResolvedValue([pingServiceConfig]);
  
      const pingUrl = '/host/cds-xx/v1/test/ping/standard/resource/_batch';
      const expectedPollingUrl = `http://testhost.com${pingUrl.replace('/_batch', '/_batch-response')}`;
  
      // --- Act ---
      try {
        const response = await invokeExpress(app, {
          method: 'POST',
          url: pingUrl,
          headers: { 'content-type': 'application/json' },
          body: decodedPingMessage,
        });

        // --- Assert ---
        expect(response.status).toBe(415);
        expect(mockQueueAdapter.addJob).not.toHaveBeenCalled();
      } finally {
        if (originalSecurityMode === undefined) delete process.env.SECURITY_MODE;
        else process.env.SECURITY_MODE = originalSecurityMode;
        if (originalJsonLegacy === undefined) delete process.env.JSON_LEGACY;
        else process.env.JSON_LEGACY = originalJsonLegacy;
      }
    });
  });

  describe('Job Polling (`/_batch-response`)', () => {
    const pollingUrl = '/host/cds-xx/v1/test/ping/standard/resource/_batch-response';
    const thid = decodedPingMessage.thid;

    it('should return FHIR-compatible early errors for FHIR routes', async () => {
      const asyncResponseStore = new AsyncResponseStoreMem();
      const { app } = setupApp(asyncResponseStore);
      const fhirPollingUrl = '/host/cds-xx/v1/test/individual/org.hl7.fhir.r4/Consent/_batch-response';

      const response = await invokeExpress(app, {
        method: 'POST',
        url: fhirPollingUrl,
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: {},
      });

      expect(response.status).toBe(400);
      const payload = JSON.parse(response.text);
      expect(payload.type).toBe('application/fhir+json');
      expect(payload.body.resourceType).toBe('Bundle');
      expect(payload.body.entry).toEqual([]);
      expect(payload.body.issues.issue[0].code).toBe(IssueType.Required);
    });

    it('should return raw FHIR JSON early errors in LEGACY_FHIR mode', async () => {
      const asyncResponseStore = new AsyncResponseStoreMem();
      const { app } = setupApp(asyncResponseStore);
      const fhirPollingUrl = '/host/cds-xx/v1/test/individual/org.hl7.fhir.r4/Consent/_batch-response';

      const response = await invokeExpress(app, {
        method: 'POST',
        url: fhirPollingUrl,
        headers: { 'content-type': 'application/fhir+json' },
        body: {},
      });

      expect(response.status).toBe(400);
      expect(response.headers['content-type']).toMatch(/application\/fhir\+json/);
      const payload = JSON.parse(response.text);
      expect(payload.resourceType).toBe('Bundle');
      expect(payload.entry).toEqual([]);
      expect(payload.total).toBe(0);
      expect(payload.issues.issue[0].code).toBe(IssueType.Required);
    });

    it('should return 200 OK with the result if the job is complete', async () => {
      const asyncResponseStore = new AsyncResponseStoreMem();
      asyncResponseStore.set(thid, testCompletedJob);
      const { app } = setupApp(asyncResponseStore);

      const response = await invokeExpress(app, {
        method: 'POST',
        url: pollingUrl,
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: { thid },
      });

      expect(response.status).toBe(200);
      expect(response.headers['content-type']).toMatch(/application\/x-www-form-urlencoded/);
      expect(response.text).toBe(`response=${testCompletedJob.result}`);
    });

    it('should return 202 Accepted if the job is still pending', async () => {
      const asyncResponseStore = new AsyncResponseStoreMem();
      asyncResponseStore.set(thid, testPendingJob);
      const { app } = setupApp(asyncResponseStore);

      const response = await invokeExpress(app, {
        method: 'POST',
        url: pollingUrl,
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: { thid },
      });

      expect(response.status).toBe(202);
      const payload = JSON.parse(response.text);
      expect(payload.status).toBe('PENDING');
    });

    it('should return 200 OK with a JSON result if the original job was legacy JSON', async () => {
      // --- Arrange ---
      const asyncResponseStore = new AsyncResponseStoreMem();

      // Use mockImplementation for a robust, type-safe mock.
      mockKmsService.decodeRequest.mockImplementation(async (message: string) => {
        return {
          content: {
            type: 'application/didcomm-plain+json',
            thid: decodedPingMessage.thid,
            aud: 'did:web:host',
            iss: 'did:web:test',
            body: { ping: 'pong' }, // This is the payload the test asserts
          },
        } as JobRequest;
      });
      
      const legacyCompletedJob: StoredJob = {
        status: 'COMPLETED',
        vaultId: 'host',
        contentType: 'application/json',
        result: testEncryptedJwePing, // Use a realistic JWE string from test data
      };
      asyncResponseStore.set(thid, legacyCompletedJob);
      const { app } = setupApp(asyncResponseStore);
      
      // --- Act ---
      const response = await invokeExpress(app, {
        method: 'POST',
        url: pollingUrl,
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: { thid },
      });

      // --- Assert ---
      expect(response.status).toBe(200);
      expect(response.headers['content-type']).toMatch(/application\/json/);
      expect(JSON.parse(response.text)).toEqual({ ping: 'pong' });
    });
  });
});
