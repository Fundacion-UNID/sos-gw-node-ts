// Flow contract: employee routes use Offer -> Order for licence inventory;
// the nonexistent License/_add path is never advertised, queued or accepted.
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

/**
 * @file Integration test for the Asynchronous Employee Onboarding API Endpoint.
 *
 * @architecture See customerApi.test.ts for a detailed explanation of the canonical pattern.
 * This test follows the same simple, focused pattern.
 */

import express from 'express';
import { createApiRouter } from '../../routes/api';
import { CryptographyService } from 'gdc-common-utils-ts/CryptographyService';
import { QueueAdapter } from '../../adapters/queue';
import { TenantsCacheManager } from '../../managers/TenantsCacheManager';
import { testEncryptedJwe1 } from '../data/async-response.data';
import { mockKmsService } from '../mocks/kms.mock';
import { VaultMemRepository } from '../../database/repositories/vault/vault.mem.repository';
import { AsyncResponseStoreMem, IAsyncResponseStore } from '../../adapters/async-response-store.mem';
import { DidService } from '../../gdc-backend-utils-node/models/did';
import { testTenant1AlternateName, testTenant1AddressCountry } from '../data/organization.data';
import { ORGANIZATION_REGISTRATION_JOB } from '../data/example-jobs'; // Using a canonical job fixture
import { invokeExpress } from './helpers/invokeExpress';
import { AdapterCryptoSdkNode } from '../../gdc-backend-utils-node/adapters/node/crypto';
import { withoutIncompleteJwsProof } from '../data/example-payloads';

// --- Mock Dependencies ---
const mockQueueAdapter: jest.Mocked<QueueAdapter> = {
  addJob: jest.fn(),
};
const mockAppAuthManager = {
  verifyBearerToken: jest.fn(async () => ({ payload: { sub: 'employee-api-test' } })),
} as any;

const setupApp = (asyncResponseStore: IAsyncResponseStore) => {
  const app = express();
  app.use(express.urlencoded({ extended: true }));
  app.use(express.json());

  const vaultRepository = new VaultMemRepository();
  const tenantsCacheManager = new TenantsCacheManager(vaultRepository, () => mockKmsService, 'test-host-collection');
  const cryptographyService = new CryptographyService(new AdapterCryptoSdkNode());

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

  return { app, tenantsCacheManager };
};

describe('Employee Onboarding API', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should decode the request, queue a job, and return 202 Accepted', async () => {
    // --- Arrange ---
    const asyncResponseStore = new AsyncResponseStoreMem();
    const { app, tenantsCacheManager } = setupApp(asyncResponseStore);

    const tenantId = testTenant1AlternateName;
    const jurisdiction = testTenant1AddressCountry.toLowerCase();
    const sector = 'health-care';
    const section = 'entity';
    const format = 'org.schema';
    const resourceType = 'Employee';
    const action = '_batch';

    const registrationUrl = `/${tenantId}/cds-${jurisdiction}/v1/${sector}/${section}/${format}/${resourceType}/${action}`;
    const expectedPollingUrl = `http://localhost:3001${registrationUrl.replace('/_batch', '/_batch-response')}`;

    const mockTenantServices: DidService[] = [
      {
        id: `#${section}:${format}`,
        type: 'EmployeeOnboardingService',
        serviceEndpoint: resourceType,
        actions: [action],
        selector: { section, format },
      },
    ];
    jest.spyOn(tenantsCacheManager, 'getDidServiceConfig').mockResolvedValue(mockTenantServices);
    jest.spyOn(tenantsCacheManager, 'getTenant').mockResolvedValue({
      didConfig: { service: mockTenantServices },
    } as any);

    // Mock decodeRequest to return a canonical, imported job fixture.
    const mockJob = {
      ...ORGANIZATION_REGISTRATION_JOB,
      content: withoutIncompleteJwsProof(ORGANIZATION_REGISTRATION_JOB.content as any),
    };
    mockKmsService.decodeRequest.mockResolvedValue(mockJob);

    // --- Act ---
    const response = await invokeExpress(app, {
      method: 'POST',
      url: registrationUrl,
      headers: { 'content-type': 'application/x-www-form-urlencoded', authorization: 'Bearer test-id-token' },
      body: { request: testEncryptedJwe1 },
    });

    // --- Assert ---
    expect(mockKmsService.decodeRequest).toHaveBeenCalledWith(testEncryptedJwe1);
    expect(mockQueueAdapter.addJob).toHaveBeenCalledTimes(1);
    const [jobName, queuedJob] = (mockQueueAdapter.addJob as jest.Mock).mock.calls[0];
    expect(jobName).toContain(`health-care_${tenantId}:Employee:_batch`);
    expect(queuedJob.tenantId).toBe(tenantId);
    expect(queuedJob.sector).toBe(sector);
    expect(queuedJob.section).toBe(section);
    expect(queuedJob.format).toBe(format);
    expect(queuedJob.resourceType).toBe(resourceType);
    expect(queuedJob.action).toBe(action);
    expect(queuedJob.content).toEqual(mockJob.content);
    expect(response.status).toBe(202);
    expect(response.headers.location).toBe(expectedPollingUrl);
  });

  it('should accept Employee/_search and return the async polling URL', async () => {
    const asyncResponseStore = new AsyncResponseStoreMem();
    const { app, tenantsCacheManager } = setupApp(asyncResponseStore);

    const tenantId = testTenant1AlternateName;
    const jurisdiction = testTenant1AddressCountry.toLowerCase();
    const sector = 'health-care';
    const section = 'entity';
    const format = 'org.schema';
    const resourceType = 'Employee';
    const action = '_search';

    const searchUrl = `/${tenantId}/cds-${jurisdiction}/v1/${sector}/${section}/${format}/${resourceType}/${action}`;
    const expectedPollingUrl = `http://localhost:3001${searchUrl}-response`;

    const mockTenantServices: DidService[] = [
      {
        id: `#${section}:${format}:employee-search`,
        type: 'EmployeeDirectoryService',
        serviceEndpoint: resourceType,
        actions: [action],
        selector: { section, format },
      },
    ];
    jest.spyOn(tenantsCacheManager, 'getDidServiceConfig').mockResolvedValue(mockTenantServices);
    jest.spyOn(tenantsCacheManager, 'getTenant').mockResolvedValue({
      didConfig: { service: mockTenantServices },
    } as any);

    const mockJob = {
      ...ORGANIZATION_REGISTRATION_JOB,
      content: withoutIncompleteJwsProof(ORGANIZATION_REGISTRATION_JOB.content as any),
    };
    mockKmsService.decodeRequest.mockResolvedValue(mockJob);

    const response = await invokeExpress(app, {
      method: 'POST',
      url: searchUrl,
      headers: { 'content-type': 'application/x-www-form-urlencoded', authorization: 'Bearer test-id-token' },
      body: { request: testEncryptedJwe1 },
    });

    expect(mockQueueAdapter.addJob).toHaveBeenCalledTimes(1);
    const [, queuedJob] = (mockQueueAdapter.addJob as jest.Mock).mock.calls[0];
    expect(queuedJob.resourceType).toBe(resourceType);
    expect(queuedJob.action).toBe(action);
    expect(response.status).toBe(202);
    expect(response.headers.location).toBe(expectedPollingUrl);
  });

  it('preserves the created employee subjectId when queueing License/_issue', async () => {
    const asyncResponseStore = new AsyncResponseStoreMem();
    const { app, tenantsCacheManager } = setupApp(asyncResponseStore);
    const tenantId = testTenant1AlternateName;
    const jurisdiction = testTenant1AddressCountry.toLowerCase();
    const issueUrl = `/${tenantId}/cds-${jurisdiction}/v1/health-care/identity/openid/License/_issue`;
    const services: DidService[] = [{
      id: '#identity:openid:license-issue',
      type: 'LicenseIssuanceService',
      serviceEndpoint: 'License',
      actions: ['_issue'],
      selector: { section: 'identity', format: 'openid' },
    }];
    jest.spyOn(tenantsCacheManager, 'getDidServiceConfig').mockResolvedValue(services);
    jest.spyOn(tenantsCacheManager, 'getTenant').mockResolvedValue({ didConfig: { service: services } } as any);
    const content = {
      thid: 'license-issue-employee-123',
      iss: 'did:web:api.acme.org:employee:admin',
      aud: 'did:web:api.acme.org',
      type: 'application/json',
      body: {
        resourceType: 'Bundle',
        type: 'batch',
        data: [{
          type: 'EmployeeLicenseInvitation-v1.0',
          meta: {
            subjectId: 'employee-123',
          },
          resource: { meta: { claims: {
              '@context': 'org.schema',
              'org.schema.Person.email': 'doctor1@acme.org',
              'org.schema.Person.hasOccupation': 'ISCO-08|2211',
              'org.schema.IndividualProduct.category': 'professional',
            } } },
          request: { method: 'POST', url: issueUrl },
        }],
      },
    };
    mockKmsService.decodeRequest.mockResolvedValue({
      ...ORGANIZATION_REGISTRATION_JOB,
      content,
    } as any);

    const response = await invokeExpress(app, {
      method: 'POST',
      url: issueUrl,
      headers: { 'content-type': 'application/x-www-form-urlencoded', authorization: 'Bearer test-id-token' },
      body: { request: testEncryptedJwe1 },
    });

    expect(response.status).toBe(202);
    expect((mockQueueAdapter.addJob as jest.Mock).mock.calls[0][1].content.body.data[0].meta.subjectId)
      .toBe('employee-123');
  });

  it('rejects License/_add even for a historical mutable Employee service declaration', async () => {
    const asyncResponseStore = new AsyncResponseStoreMem();
    const { app, tenantsCacheManager } = setupApp(asyncResponseStore);

    const tenantId = testTenant1AlternateName;
    const jurisdiction = testTenant1AddressCountry.toLowerCase();
    const sector = 'health-care';
    const section = 'entity';
    const format = 'org.schema';
    const addUrl = `/${tenantId}/cds-${jurisdiction}/v1/${sector}/${section}/${format}/License/_add`;

    const historicalTenantServices: DidService[] = [{
      id: `#${section}:${format}`,
      type: 'EmployeeOnboardingService',
      serviceEndpoint: 'Employee',
      actions: ['_create', '_batch'],
      selector: { section, format },
    }];
    jest.spyOn(tenantsCacheManager, 'getDidServiceConfig').mockResolvedValue(historicalTenantServices);
    jest.spyOn(tenantsCacheManager, 'getTenant').mockResolvedValue({
      didConfig: { service: historicalTenantServices },
    } as any);

    mockKmsService.decodeRequest.mockResolvedValue({
      ...ORGANIZATION_REGISTRATION_JOB,
      content: withoutIncompleteJwsProof(ORGANIZATION_REGISTRATION_JOB.content as any),
    });

    const response = await invokeExpress(app, {
      method: 'POST',
      url: addUrl,
      headers: { 'content-type': 'application/x-www-form-urlencoded', authorization: 'Bearer test-id-token' },
      body: { request: testEncryptedJwe1 },
    });

    expect(response.status).toBe(404);
    expect(response.headers.location).toBeUndefined();
    expect(mockQueueAdapter.addJob).not.toHaveBeenCalled();
  });

  it('accepts Offer/_create for a historical mutable Employee service declaration', async () => {
    const asyncResponseStore = new AsyncResponseStoreMem();
    const { app, tenantsCacheManager } = setupApp(asyncResponseStore);

    const tenantId = testTenant1AlternateName;
    const jurisdiction = testTenant1AddressCountry.toLowerCase();
    const sector = 'health-care';
    const section = 'entity';
    const format = 'org.schema';
    const createOfferUrl = `/${tenantId}/cds-${jurisdiction}/v1/${sector}/${section}/${format}/Offer/_create`;

    const historicalTenantServices: DidService[] = [{
      id: `#${section}:${format}`,
      type: 'EmployeeOnboardingService',
      serviceEndpoint: 'Employee',
      actions: ['_create', '_batch'],
      selector: { section, format },
    }];
    jest.spyOn(tenantsCacheManager, 'getDidServiceConfig').mockResolvedValue(historicalTenantServices);
    jest.spyOn(tenantsCacheManager, 'getTenant').mockResolvedValue({
      didConfig: { service: historicalTenantServices },
    } as any);

    mockKmsService.decodeRequest.mockResolvedValue({
      ...ORGANIZATION_REGISTRATION_JOB,
      content: withoutIncompleteJwsProof(ORGANIZATION_REGISTRATION_JOB.content as any),
    });

    const response = await invokeExpress(app, {
      method: 'POST',
      url: createOfferUrl,
      headers: { 'content-type': 'application/x-www-form-urlencoded', authorization: 'Bearer test-id-token' },
      body: { request: testEncryptedJwe1 },
    });

    expect(response.status).toBe(202);
    expect(response.headers.location).toBe(`http://localhost:3001${createOfferUrl}-response`);
    expect(mockQueueAdapter.addJob).toHaveBeenCalledTimes(1);
    const [, queuedJob] = (mockQueueAdapter.addJob as jest.Mock).mock.calls[0];
    expect(queuedJob.resourceType).toBe('Offer');
    expect(queuedJob.action).toBe('_create');
  });

});
