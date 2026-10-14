// TDD contract: route-only network fixtures never pretend to contain an unverifiable nested signature.
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

import express from 'express';
import { createApiRouter } from '../../routes/api';
import { CryptographyService } from 'gdc-common-utils-ts/CryptographyService';
import { QueueAdapter } from '../../adapters/queue';
import { TenantsCacheManager } from '../../managers/TenantsCacheManager';
import { IDecodedDidcommPayload } from 'gdc-common-utils-ts/models/confidential-message';
import { JobRequest } from 'gdc-common-utils-ts/models/confidential-job';
import { mockKmsService } from '../mocks/kms.mock';
import { VaultMemRepository } from '../../database/repositories/vault/vault.mem.repository';
import { IAsyncResponseStore, AsyncResponseStoreMem } from '../../adapters/async-response-store.mem';
import { testEncryptedJwe1 } from '../data/async-response.data';
import { testTenant1AddressCountry, testTenant1AlternateName, testTenant1ServiceProviderCategory } from '../data/organization.data';
import { testInitialNetworkJobInput, testTenantC_DidDocument } from '../data/network-enrollment.data';
import { getTenantVaultId } from '../../utils/tenant';
import { DidService } from '../../gdc-backend-utils-node/models/did';
import { invokeExpress } from './helpers/invokeExpress';
import { AdapterCryptoSdkNode } from '../../gdc-backend-utils-node/adapters/node/crypto';

// --- Mock Dependencies ---
const mockQueueAdapter: jest.Mocked<QueueAdapter> = {
  addJob: jest.fn((jobName: string, jobData: JobRequest) => Promise.resolve()),
};
const mockAppAuthManager = {
  verifyBearerToken: jest.fn(async () => ({ payload: { sub: 'network-controller-test' } })),
} as any;

const setupApp = (asyncResponseStore: IAsyncResponseStore) => {
  const app = express();
  app.use(express.urlencoded({ extended: true }));
  app.use(express.json());

  const vaultRepository = new VaultMemRepository();
  const cryptographyService = new CryptographyService(new AdapterCryptoSdkNode());
  const tenantsCacheManager = new TenantsCacheManager(vaultRepository, () => mockKmsService, 'test-host-collection');
  
  jest.spyOn(tenantsCacheManager, 'getDidServiceConfig');
  jest.spyOn(tenantsCacheManager, 'getDidDocument');
  jest.spyOn(tenantsCacheManager, 'getTenant');

  mockKmsService.init();

  const apiRouter = createApiRouter(
    mockQueueAdapter,
    tenantsCacheManager,
    mockKmsService,
    asyncResponseStore,
    vaultRepository,
    cryptographyService,
    'http://localhost:3001',
    mockAppAuthManager,
  );
  app.use('/', apiRouter);

  return { app, tenantsCacheManager, vaultRepository };
};

describe('Network Enrollment API', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });
    it('should authorize the controller, queue a job, and return 202 Accepted', async () => {
      // --- Arrange ---
      const asyncResponseStore = new AsyncResponseStoreMem();
      const { app, tenantsCacheManager } = setupApp(asyncResponseStore);

      const tenantId = testTenant1AlternateName;
      const jurisdiction = testTenant1AddressCountry;
      const sector = testTenant1ServiceProviderCategory;
      const section = 'test-network';
      const format = 'org.schema';
      const resourceType = 'Action';
      const action = '_batch';

      const enrollmentUrl = `/${tenantId}/cds-${jurisdiction}/v1/${sector}/${section}/${format}/${resourceType}/${action}`;
      const expectedPollingUrl = `http://localhost:3001${enrollmentUrl.replace('/_batch', '/_batch-response')}`;

      // Mock the service config lookup to simulate a valid, registered tenant
      const mockTenantServices: DidService[] = [{
        id: `#${section}:${format}`,
        type: 'NetworkEnrollmentService',
        serviceEndpoint: resourceType,
        actions: [action],
        selector: { section, format },
      }];
      (tenantsCacheManager.getDidServiceConfig as jest.Mock).mockResolvedValue(mockTenantServices);
      (tenantsCacheManager.getTenant as jest.Mock).mockResolvedValue({
        didConfig: { service: mockTenantServices },
      });

	      const mockJobRequest: JobRequest = {
	        id: 'mock-job-id',
	        status: 'DRAFT' as any,
	        sequence: 0,
	        createdAtTimestamp: Date.now(),
	        tenantId: '',
	        sector,
	        section,
	        format,
	        resourceType,
	        action,
	        content: {
	          ...testInitialNetworkJobInput,
	          iss: 'did:web:some-issuer',
          meta: {
            jwe: {
              header: {
                skid: 'did:web:some-issuer#enc-key-1',
                jwk: { kty: 'OKP', crv: 'ML-KEM-768', kid: 'did:web:some-issuer#enc-key-1', x: 'mock-key' }
              }
            },
          },
        },
      };
      mockKmsService.decodeRequest.mockResolvedValue(mockJobRequest);
      
      (tenantsCacheManager.getDidDocument as jest.Mock).mockResolvedValue(testTenantC_DidDocument);

      // --- Act ---
      const response = await invokeExpress(app, {
        method: 'POST',
        url: enrollmentUrl,
        headers: { 'content-type': 'application/x-www-form-urlencoded', authorization: 'Bearer test-id-token' },
        body: { request: testEncryptedJwe1 },
      });

      // --- Assert ---
      expect(response.status).toBe(202);
      expect(response.headers.location).toBe(expectedPollingUrl);
      
      const expectedVaultId = getTenantVaultId(sector, tenantId);
      expect(tenantsCacheManager.getDidServiceConfig).toHaveBeenCalledWith(expectedVaultId);
      
      // We only need to confirm that a job was queued. The detailed mechanics of job creation
      // are tested exhaustively in `pingApi.test.ts` and don't need to be repeated here.
      expect(mockQueueAdapter.addJob).toHaveBeenCalledTimes(1);
    });

    /**
     * @security
     * This is a critical security test. It ensures that the API controller layer correctly
     * handles signature verification failures from the KMS.
     *
     * The flow is as follows:
     * 1. The client sends a JWS with an invalid signature (or a signature from an unauthorized key).
     * 2. The API controller calls `kmsService.decodeRequest`.
     * 3. The `kmsService` attempts to verify the signature. It fails.
     * 4. The `kmsService` MUST throw an exception.
     * 5. The API controller's `try...catch` block MUST catch this exception.
     * 6. The controller MUST immediately return a `401 Unauthorized` response.
     * 7. The job MUST NOT be added to the queue.
     */
    it('should return 401 Unauthorized if the KMS throws a signature verification error', async () => {
      // --- Arrange ---
      const asyncResponseStore = new AsyncResponseStoreMem();
      const { app, tenantsCacheManager } = setupApp(asyncResponseStore);

      const tenantId = testTenant1AlternateName;
      const jurisdiction = testTenant1AddressCountry;
      const sector = testTenant1ServiceProviderCategory;
      const section = 'test-network';
      const format = 'org.schema';
      const resourceType = 'Action';
      const action = '_batch';

      const enrollmentUrl = `/${tenantId}/cds-${jurisdiction}/v1/${sector}/${section}/${format}/${resourceType}/${action}`;

      // MOCK: Simulate the KMS rejecting the JWS due to an invalid signature.
      // This is the core of the test.
      mockKmsService.decodeRequest.mockRejectedValue(new Error('Invalid signature'));
      
      // --- Act ---
      const response = await invokeExpress(app, {
        method: 'POST',
        url: enrollmentUrl,
        headers: { 'content-type': 'application/x-www-form-urlencoded', authorization: 'Bearer test-id-token' },
        body: { request: testEncryptedJwe1 },
      });

      // --- Assert ---
      expect(response.status).toBe(401);
      expect(mockQueueAdapter.addJob).not.toHaveBeenCalled();
    });

    /**
     * @security
     * This test covers the **AUTHORIZATION** aspect of the API flow, specifically
     * for a request that is successfully **AUTHENTICATED**.
     *
     * It simulates a request from a legitimate employee of the tenant (e.g., `analyst@acme.org`)
     * whose signature is cryptographically valid, but who does not have the required
     * permissions (e.g., 'controller' role) to perform the requested action.
     *
     * **ARCHITECTURAL PRINCIPLE:**
     * The API Controller's responsibility is limited to:
     * 1. **Authentication:** Verifying the signature via the KMS. If it fails, return 401.
     * 2. **Path Validation:** Checking if the tenant offers the requested service endpoint. If not, return 404.
     *
     * Business-level **Authorization** (i.e., checking if this specific employee's role
     * allows this action) is the responsibility of the asynchronous **Worker** that processes the job.
     *
     * **EXPECTED BEHAVIOR:**
     * The API controller should see a valid signature for a valid route and **ACCEPT** the job
     * by returning a `202 Accepted` status. The job will be queued. The worker will later
     * process the job, discover the lack of permissions, and mark the job as 'failed' with a 403 error.
     * That final outcome would be verified in a separate end-to-end or worker-level test.
     */
    it('should return 202 Accepted for a validly signed request, even if the employee lacks specific permissions (authz is handled by worker)', async () => {
      // --- Arrange ---
      const asyncResponseStore = new AsyncResponseStoreMem();
      const { app, tenantsCacheManager } = setupApp(asyncResponseStore);

      const tenantId = testTenant1AlternateName; // 'acme'
      const jurisdiction = testTenant1AddressCountry;
      const sector = testTenant1ServiceProviderCategory;
      const section = 'test-network';
      const format = 'org.schema';
      const resourceType = 'Action';
      const action = '_batch';

      const enrollmentUrl = `/${tenantId}/cds-${jurisdiction}/v1/${sector}/${section}/${format}/${resourceType}/${action}`;

      // The service must exist for the path validation to pass.
      const mockTenantServices: DidService[] = [{
        id: `#${section}:${format}`,
        type: 'NetworkEnrollmentService',
        serviceEndpoint: resourceType,
        actions: [action],
        selector: { section, format },
      }];
      (tenantsCacheManager.getDidServiceConfig as jest.Mock).mockResolvedValue(mockTenantServices);
      (tenantsCacheManager.getTenant as jest.Mock).mockResolvedValue({
        didConfig: { service: mockTenantServices },
      });

      // We simulate a job signed by a legitimate but non-privileged employee.
      const employeeDid = `did:web:${tenantId}:employee:analyst@${tenantId}.org:analyst`;
      const employeeKid = `urn:ietf:rfc:7638:thumbprint-of-analyst-key`;
      
      const jobFromNonControllerEmployee: IDecodedDidcommPayload = {
        ...testInitialNetworkJobInput,
        iss: employeeDid,
      };
	      const mockJobRequestFromEmployee: JobRequest = {
	        id: 'mock-job-id-2',
	        status: 'DRAFT' as any,
	        sequence: 0,
	        createdAtTimestamp: Date.now(),
	        tenantId: '',
	        sector,
	        section,
	        format,
	        resourceType,
	        action,
	        content: {
	          ...jobFromNonControllerEmployee,
	          meta: {
            jwe: {
              header: {
                skid: employeeKid, // Assuming sender uses same key for signing and encryption ID
                jwk: { kty: 'OKP', crv: 'ML-KEM-768', kid: employeeKid, x: 'mock-key' }
              }
            },
          },
        },
      };
      // The KMS successfully verifies the signature (authentication is a success).
      mockKmsService.decodeRequest.mockResolvedValue(mockJobRequestFromEmployee);
      
      // The DID Document for the tenant does NOT contain the analyst's key in its assertionMethod.
      // The API controller IGNORES this; it's the worker's responsibility to check it.
      (tenantsCacheManager.getDidDocument as jest.Mock).mockResolvedValue(testTenantC_DidDocument);

      // --- Act ---
      const response = await invokeExpress(app, {
        method: 'POST',
        url: enrollmentUrl,
        headers: { 'content-type': 'application/x-www-form-urlencoded', authorization: 'Bearer test-id-token' },
        body: { request: testEncryptedJwe1 },
      });

      // --- Assert ---
      // The API's job is to accept the authenticated request for a valid route. It returns 202.
      expect(response.status).toBe(202);
      // The job is queued. The worker will later process it and fail it with a 403.
      expect(mockQueueAdapter.addJob).toHaveBeenCalledTimes(1);
    });
});
