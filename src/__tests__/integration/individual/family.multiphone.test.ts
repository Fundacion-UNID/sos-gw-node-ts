// Flow contract: reuse shared test fixtures and canonical types; do not introduce duplicated literals.
import { resolveHostPhysicalCollectionName } from '../../../config/storage-layout';
// src/__tests__/integration/individual/family.multiphone.test.ts
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
import { generateTenantCollectionNameFromClaims, getTenantVaultId } from '../../../utils/tenant';
import { testClaimsHostInitialization } from '../../data/end-to-end.data';
import {
  ClaimsOfferSchemaorg,
  ClaimsOrderSchemaorg,
  ClaimsOrganizationSchemaorg,
  ClaimsServiceSchemaorg,
} from 'gdc-common-utils-ts/constants/schemaorg';
import { getClaimValue } from '../../../utils/claims';
import { withCanonicalEntryClaims } from '../../helpers/canonical-bundle-entry';
import { FamilyRegistrationStatus, GatewayClaim } from '../../../shared/gateway-claim-contract';
import { JobRequest, JobStatus } from 'gdc-common-utils-ts/models/confidential-job';
import { IStorageAdapter } from '../../../database/storage/IStorageAdapter';
import { ILogger } from '../../../loggers/ILogger';
import { testDefaultTenantServiceTypeClaim, testTenant1TenantId } from '../../data/organization.data';
import { ORGANIZATION_ORDER_JOB, ORGANIZATION_REGISTRATION_JOB } from '../../data/example-jobs';
import { AppAuthorizationManager } from '../../../managers/AppAuthorizationManager';
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
 * Business-matching regression for the current individual/family compatibility flow.
 *
 * Case under test:
 * 1. two family organizations share one overlapping owner phone
 * 2. they differ by alternateName and by the second phone in the owner list
 * 3. `_search` must recover the correct organization when the caller provides
 *    the distinguishing phone plus the family nickname
 */
describe('FamilyManager multi-phone integration', () => {
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
   * Step 1: create family org #1 with owner phones `phoneA,phoneB`.
   * Step 2: create family org #2 with owner phones `phoneA,phoneC`.
   * Step 3: search using `phoneC + alternateName`.
   * Step 4: assert GW returns org #2, not org #1.
   */
  it('should create two organizations with same owner (multi-phone) and recover one by apodo and phone', async () => {
    const tenantId = testTenant1TenantId;
    const url = `/${tenantId}/cds-es/v1/health-care/individual/org.schema/Organization/_batch`;

    // Org 1: apodo "FAMILIA-UNO", phones: "+34600000001,+34600000002"
    // Org 2: apodo "FAMILIA-DOS", phones: "+34600000001,+34600000003"
    const org1Phones = '+34600000001,+34600000002';
    const org2Phones = '+34600000001,+34600000003';
    const individualNickname1 = 'FAMILIA-UNO';
    const individualNickname2 = 'FAMILIA-DOS';
    const ownerEmail = 'parent@example.com';
    const providerDid = 'did:web:provider.example.com';
    const addressCountry = 'ES';

    const baseClaims = {
      [ClaimsOrganizationSchemaorg.ownerTelephone]: org1Phones,
      [ClaimsOrganizationSchemaorg.ownerEmail]: ownerEmail,
      [ClaimsOrganizationSchemaorg.ownerIdentifierValue]: ownerEmail,
      [ClaimsOrganizationSchemaorg.alternateName]: individualNickname1,
      [ClaimsServiceSchemaorg.identifier]: providerDid,
      [ClaimsServiceSchemaorg.serviceType]: testDefaultTenantServiceTypeClaim,
      [ClaimsServiceSchemaorg.category]: Sector.HEALTH_CARE,
      [ClaimsOrganizationSchemaorg.addressCountry]: addressCountry,
    };
    const baseClaims2 = {
      ...baseClaims,
      [ClaimsOrganizationSchemaorg.ownerTelephone]: org2Phones,
      [ClaimsOrganizationSchemaorg.alternateName]: individualNickname2,
    };

    // Create org1
    const job1: JobRequest = {
      id: 'job-family-uno',
      status: JobStatus.DRAFT,
      sequence: 0,
      createdAtTimestamp: Date.now(),
      tenantId,
      jurisdiction: 'es',
      sector: Sector.HEALTH_CARE,
      section: 'individual',
      format: 'org.schema',
      action: '_batch',
      resourceType: 'Organization',
      content: {
        jti: 'jti-uno',
        thid: 'thid-uno',
        iss: 'did:web:client.example.com',
        aud: `did:web:${tenantId}.example.com`,
        type: 'application/api+json',
        body: {
          data: [{
            type: 'Family-registration-form-v1.0',
            resource: { meta: { claims: baseClaims } },
          }],
        },
      },
    };
    const createResult1 = await hostingManager.process(job1);
    expect(getClaimValue(createResult1.body.data[0].resource?.meta?.claims || {}, GatewayClaim.FamilyRegistrationStatus)).toBe(FamilyRegistrationStatus.Created);

    // Create org2
    const job2: JobRequest = {
      ...job1,
      id: 'job-family-dos',
      content: {
        ...job1.content,
        iss: 'did:web:client.example.com',
        aud: `did:web:${tenantId}.example.com`,
        jti: 'jti-dos',
        thid: 'thid-dos',
        type: 'application/api+json',
        body: {
          data: [{
            type: 'Family-registration-form-v1.0',
            resource: { meta: { claims: baseClaims2 } },
          }],
        },
      },
    };
    const createResult2 = await hostingManager.process(job2);
    expect(getClaimValue(createResult2.body.data[0].resource?.meta?.claims || {}, GatewayClaim.FamilyRegistrationStatus)).toBe(FamilyRegistrationStatus.Created);

    // Buscar org2 por owner.telephone y alternateName
    const searchJob: JobRequest = {
      id: 'job-search',
      status: JobStatus.DRAFT,
      sequence: 0,
      createdAtTimestamp: Date.now(),
      tenantId,
      sector: Sector.HEALTH_CARE,
      section: 'individual',
      format: 'org.schema',
      action: '_search',
      resourceType: 'Organization',
      content: {
        jti: 'jti-search',
        thid: 'thid-search',
        iss: 'did:web:client.example.com',
        aud: `did:web:${tenantId}.example.com`,
        type: 'application/api+json',
        body: {
          data: [{
            type: 'Family-registration-form-v1.0',
            resource: { meta: { claims: {
              [ClaimsOrganizationSchemaorg.ownerTelephone]: '+34600000003',
              [ClaimsOrganizationSchemaorg.alternateName]: individualNickname2,
              [ClaimsServiceSchemaorg.category]: Sector.HEALTH_CARE,
            } } },
          }],
        },
      },
    };
    const searchResult = await hostingManager.process(searchJob);
    const foundClaims = searchResult.body.data[0].resource?.meta?.claims || {};
    expect(getClaimValue(foundClaims, ClaimsOrganizationSchemaorg.alternateName)).toBe(individualNickname2);
    expect(String(getClaimValue(foundClaims, ClaimsOrganizationSchemaorg.ownerTelephone) || '')).toContain('+34600000003');
    // This test exercises the legacy immediate-active HostingManager path.
    // Pending/resume semantics are covered by the FamilyManager Offer/Order tests.
    expect(getClaimValue(foundClaims, GatewayClaim.FamilyRegistrationStatus)).toBe(FamilyRegistrationStatus.Existing);
  });
});
