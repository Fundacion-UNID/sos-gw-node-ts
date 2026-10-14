// Flow contract: reuse shared test fixtures and canonical types; do not introduce duplicated literals.
import { resolveHostPhysicalCollectionName } from '../../../config/storage-layout';
// TDD contract: family route fixtures either carry a complete valid signature or make no signature claim.
// Always create JSDoc, do not use strings inline in keys nor values, use types instead, and reuse the data test examples.

import express from 'express';
import { createApiRouter } from '../../../routes/api';
import { VaultMemRepository } from '../../../database/repositories/vault/vault.mem.repository';
import { TenantsCacheManager } from '../../../managers/TenantsCacheManager';
import { AsyncResponseStoreMem } from '../../../adapters/async-response-store.mem';
import { CryptographyService } from 'gdc-common-utils-ts/CryptographyService';
import { AdapterCryptoSdkNode } from '../../../gdc-backend-utils-node/adapters/node/crypto';
import { mockKmsService } from '../../mocks/kms.mock';
import { HostingManager } from '../../../managers/HostingManager';
import { Sector } from 'gdc-common-utils-ts/models/urlPath';
import { generateTenantCollectionNameFromClaims } from '../../../utils/tenant';
import { testClaimsHostInitialization } from '../../data/end-to-end.data';
import { ORGANIZATION_ORDER_JOB, ORGANIZATION_REGISTRATION_JOB } from '../../data/example-jobs';
import {
  ClaimsOfferSchemaorg,
  ClaimsOrderSchemaorg,
  ClaimsOrganizationSchemaorg,
  ClaimsServiceSchemaorg,
} from 'gdc-common-utils-ts/constants/schemaorg';
import { getClaimValue } from '../../../utils/claims';
import { withCanonicalEntryClaims } from '../../helpers/canonical-bundle-entry';
import { FAMILY_REGISTRATION_REQUEST, withoutIncompleteJwsProof } from '../../data/example-payloads';
import { JobRequest, JobStatus } from 'gdc-common-utils-ts/models/confidential-job';
import { IStorageAdapter } from '../../../database/storage/IStorageAdapter';
import { ILogger } from '../../../loggers/ILogger';
import { testTenant1TenantId } from '../../data/organization.data';
import { AppAuthorizationManager } from '../../../managers/AppAuthorizationManager';
import { getTenantVaultId } from '../../../utils/tenant';
import { composeHostDidWebId } from '../../../utils/did-backend';

async function invokeExpress(
  handler: any,
  options: { method: string; url: string; headers?: Record<string, string>; body?: any },
): Promise<{ status: number; headers: Record<string, string>; text: string }> {
  const headers: Record<string, string> = {};
  let statusCode = 200;
  let responseText = '';

  const req = {
    method: options.method.toUpperCase(),
    url: options.url,
    originalUrl: options.url,
    headers: Object.fromEntries(Object.entries(options.headers || {}).map(([k, v]) => [k.toLowerCase(), v])),
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
    getHeader(field: string) {
      return headers[field.toLowerCase()];
    },
    removeHeader(field: string) {
      delete headers[field.toLowerCase()];
    },
    location(value: string) {
      headers['location'] = value;
      return this;
    },
    json(payload: any) {
      headers['content-type'] = 'application/json';
      responseText = JSON.stringify(payload);
      resolveFinished?.();
      return this;
    },
    send(payload?: any) {
      responseText = typeof payload === 'string' ? payload : '';
      resolveFinished?.();
      return this;
    },
    end() {
      resolveFinished?.();
      return this;
    },
  };

  const handleFn = (typeof handler === 'function' ? handler : handler?.handle) as
    | ((req: any, res: any, next: (err?: any) => void) => void)
    | undefined;
  if (!handleFn) throw new Error('invokeExpress: handler has no handle()');

  handleFn(req, res, (err?: any) => {
    if (err) rejectFinished?.(err);
    else resolveFinished?.();
  });

  await finished;
  return { status: statusCode, headers, text: responseText };
}

/**
 * Step-by-step route coverage for current individual/family compatibility endpoints.
 *
 * Why this suite exists:
 * 1. prove the route validator accepts the current individual organization paths
 * 2. prove submit returns async `202 + Location`
 * 3. avoid mixing this route smoke suite with the richer business matching
 *    semantics covered in `family.multiphone` and `family.multimail`
 */
describe('[/individual/org.schema/Organization/_batch] Integration Tests (sandbox-safe)', () => {
  const mockQueueAdapter = { addJob: jest.fn() };
  const mockStorageAdapter: jest.Mocked<IStorageAdapter> = { upload: jest.fn() };
  const mockLogger: jest.Mocked<ILogger> = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
  const mockAppAuthManager = {
    verifyBearerToken: jest.fn(async () => ({ payload: { sub: 'test-user', tenant_id: testTenant1TenantId } })),
  } as unknown as AppAuthorizationManager;

  let app: express.Express;
  let vaultRepository: VaultMemRepository;
  let tenantsCacheManager: TenantsCacheManager;
  let hostingManager: HostingManager;

  beforeEach(async () => {
    jest.clearAllMocks();
    vaultRepository = new VaultMemRepository();
    const hostCollectionName = resolveHostPhysicalCollectionName();
    tenantsCacheManager = new TenantsCacheManager(vaultRepository, () => mockKmsService, hostCollectionName);

    const config = {
      nodeEnv: 'test',
      port: 3000,
      apiHostname: 'host',
      hostExternalDomain: 'host.example.com',
      apiBaseUrl: 'http://host.example.com',
      namespace: 'test-namespace',
      sectorsAllowed: [Sector.HEALTH_CARE, Sector.SYSTEM, Sector.TEST],
      dbProvider: 'mem',
      queueProvider: 'mem',
      storageProvider: 'mem',
      allowedPaymentMethods: ['Stripe'],
      host: { legalName: 'Test Host', jurisdiction: 'us', idType: 'test-id', idValue: '12345' },
      mongo: { dbName: 'test' },
      firebase: {},
    } as any;

    mockStorageAdapter.upload.mockResolvedValue({
      publicUrl: 'https://storage.example.com/terms.pdf',
      encodedMultiHash: 'zQm...',
    });

    mockKmsService.getPublicJwks.mockResolvedValue({
      keys: [
        { kid: 'sig-key-1', use: 'sig', alg: 'ML-DSA-44' } as any,
        { kid: 'enc-key-1', use: 'enc', crv: 'ML-KEM-768' } as any,
      ],
    });

    hostingManager = new HostingManager(
      vaultRepository,
      mockKmsService,
      tenantsCacheManager,
      mockStorageAdapter,
      mockLogger,
      config,
      { hostCollectionName, hostDid: composeHostDidWebId(config.apiBaseUrl, config.hostExternalDomain) } as any,
    );

    await hostingManager.bootstrapHost(testClaimsHostInitialization);
    await tenantsCacheManager.loadHost();

    // Create and finalize the provider tenant so the API path validator allows `individual/org.schema/Organization`.
    // These canonical fixtures contain nested mutable claims. A shallow copy leaks
    // accepted offer identifiers across tests and can make tenant activation order-dependent.
    const regJob = structuredClone(ORGANIZATION_REGISTRATION_JOB);
    regJob.sector = Sector.HEALTH_CARE;
    regJob.jurisdiction = 'es';
    regJob.content = {
      ...regJob.content,
      body: {
        ...regJob.content!.body,
        data: regJob.content!.body!.data.map((entry: any) => withCanonicalEntryClaims(entry, {
          [ClaimsServiceSchemaorg.category]: Sector.HEALTH_CARE,
        })),
      },
    } as any;
    const offerPayload = await hostingManager.process(regJob);
    expect(offerPayload.body.data[0]).toMatchObject({ response: { status: '201' } });
    const offerId = getClaimValue<string>(
      offerPayload.body.data[0].resource?.meta?.claims || {},
      ClaimsOfferSchemaorg.identifier,
    );
    expect(offerId).toBeDefined();
    const orderJob = structuredClone(ORGANIZATION_ORDER_JOB);
    orderJob.sector = Sector.HEALTH_CARE;
    orderJob.jurisdiction = 'es';
    orderJob.content!.body!.data[0] = withCanonicalEntryClaims(orderJob.content!.body!.data[0]!, {
      [ClaimsOrderSchemaorg.acceptedOfferIdentifier]: offerId,
    });
    const orderPayload = await hostingManager.process(orderJob);
    expect(orderPayload.body.data[0]).toMatchObject({ response: { status: '201' } });
    await tenantsCacheManager.refreshTenant(getTenantVaultId(Sector.HEALTH_CARE, testTenant1TenantId));

    const asyncResponseStore = new AsyncResponseStoreMem();
    const crypto = new CryptographyService(new AdapterCryptoSdkNode());
    const apiRouter = createApiRouter(
      mockQueueAdapter as any,
      tenantsCacheManager,
      mockKmsService,
      asyncResponseStore,
      vaultRepository,
      crypto,
      'http://host.example.com',
      mockAppAuthManager,
    );

    app = express();
    app.use('/', apiRouter);
  });

  /**
   * Step 1: submit the legacy compatibility `_batch` path.
   * Step 2: assert the router accepts it and enqueues one async job.
   * Step 3: assert the poll location points to `_batch-response`.
   */
  it('should return 202 Accepted for a valid family registration request', async () => {
    const tenantId = testTenant1TenantId;
    const url = `/${tenantId}/cds-es/v1/health-care/individual/org.schema/Organization/_batch`;

	    const decodedJob: JobRequest = {
	      id: 'job-family-1',
	      status: JobStatus.DRAFT,
	      sequence: 0,
	      createdAtTimestamp: Date.now(),
	      tenantId,
	      sector: Sector.HEALTH_CARE,
	      section: 'individual',
	      format: 'org.schema',
	      action: '_batch',
	      resourceType: 'Organization',
	      content: withoutIncompleteJwsProof(FAMILY_REGISTRATION_REQUEST) as any,
	    };
    mockKmsService.decodeRequest.mockResolvedValueOnce(decodedJob as any);

    const response = await invokeExpress(app, {
      method: 'POST',
      url,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'App-ID': 'test-app',
        'App-Version': '1.0.0',
        Authorization: 'Bearer fake-oidc-id-token',
      },
      body: { request: 'fake.encrypted.payload' },
    });

    expect(response.status).toBe(202);
    expect(response.headers.location).toBeDefined();
    expect(response.headers.location).toContain(`${url.replace('/_batch', '/_batch-response')}`);
    expect(mockQueueAdapter.addJob).toHaveBeenCalledTimes(1);
  });

  /**
   * Step 1: submit the current `_transaction` alias for the same family input.
   * Step 2: assert the alias is accepted by the same route validator.
   * Step 3: assert polling continues through `_transaction-response`.
   */
  it('should return 202 Accepted for the _transaction alias on family registration', async () => {
    const tenantId = testTenant1TenantId;
    const url = `/${tenantId}/cds-es/v1/health-care/individual/org.schema/Organization/_transaction`;

    const decodedJob: JobRequest = {
      id: 'job-family-transaction-1',
      status: JobStatus.DRAFT,
      sequence: 0,
      createdAtTimestamp: Date.now(),
      tenantId,
      sector: Sector.HEALTH_CARE,
      section: 'individual',
      format: 'org.schema',
      action: '_transaction',
      resourceType: 'Organization',
      content: withoutIncompleteJwsProof(FAMILY_REGISTRATION_REQUEST) as any,
    };
    mockKmsService.decodeRequest.mockResolvedValueOnce(decodedJob as any);

    const response = await invokeExpress(app, {
      method: 'POST',
      url,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'App-ID': 'test-app',
        'App-Version': '1.0.0',
        Authorization: 'Bearer fake-oidc-id-token',
      },
      body: { request: 'fake.encrypted.payload' },
    });

    expect(response.status).toBe(202);
    expect(response.headers.location).toBeDefined();
    expect(response.headers.location).toContain(`${url.replace('/_transaction', '/_transaction-response')}`);
    expect(mockQueueAdapter.addJob).toHaveBeenCalledTimes(1);
  });

  /**
   * Step 1: submit the explicit individual purge route.
   * Step 2: carry the minimum locator claims required by current GW matching.
   * Step 3: assert the router exposes the async `_purge-response` poll path.
   */
  it('should return 202 Accepted for the _purge action on individual organization', async () => {
    const tenantId = testTenant1TenantId;
    const url = `/${tenantId}/cds-es/v1/health-care/individual/org.schema/Organization/_purge`;

    const decodedJob: JobRequest = {
      id: 'job-family-purge-1',
      status: JobStatus.DRAFT,
      sequence: 0,
      createdAtTimestamp: Date.now(),
      tenantId,
      sector: Sector.HEALTH_CARE,
      section: 'individual',
      format: 'org.schema',
      action: '_purge',
      resourceType: 'Organization',
      content: {
        ...withoutIncompleteJwsProof(FAMILY_REGISTRATION_REQUEST),
        body: {
          data: [{
            type: 'Family-purge-request-v1.0',
            resource: { meta: { claims: {
                [ClaimsOrganizationSchemaorg.ownerTelephone]: '+34600000001',
                [ClaimsOrganizationSchemaorg.ownerEmail]: 'parent@example.com',
                [ClaimsOrganizationSchemaorg.alternateName]: 'Ana',
                [ClaimsServiceSchemaorg.category]: Sector.HEALTH_CARE,
              } } },
          }],
        },
      } as any,
    };
    mockKmsService.decodeRequest.mockResolvedValueOnce(decodedJob as any);

    const response = await invokeExpress(app, {
      method: 'POST',
      url,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'App-ID': 'test-app',
        'App-Version': '1.0.0',
        Authorization: 'Bearer fake-oidc-id-token',
      },
      body: { request: 'fake.encrypted.payload' },
    });

    expect(response.status).toBe(202);
    expect(response.headers.location).toBeDefined();
    expect(response.headers.location).toContain(`${url.replace('/_purge', '/_purge-response')}`);
    expect(mockQueueAdapter.addJob).toHaveBeenCalledTimes(1);
  });
});
