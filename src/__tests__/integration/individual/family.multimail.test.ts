// Flow contract: reuse shared test fixtures and canonical types; do not introduce duplicated literals.
import { resolveHostPhysicalCollectionName } from '../../../config/storage-layout';
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
import { JobRequest, JobStatus } from 'gdc-common-utils-ts/models/confidential-job';
import { IStorageAdapter } from '../../../database/storage/IStorageAdapter';
import { ILogger } from '../../../loggers/ILogger';
import { testDefaultTenantServiceTypeClaim, testTenant1TenantId } from '../../data/organization.data';
import { ORGANIZATION_ORDER_JOB, ORGANIZATION_REGISTRATION_JOB } from '../../data/example-jobs';
import {
  ClaimsOfferSchemaorg,
  ClaimsOrderSchemaorg,
  ClaimsOrganizationSchemaorg,
  ClaimsServiceSchemaorg,
} from 'gdc-common-utils-ts/constants/schemaorg';
import { AppAuthorizationManager } from '../../../managers/AppAuthorizationManager';
import { composeHostDidWebId } from '../../../utils/did-backend';
import { getClaimValue } from '../../../utils/claims';
import { withCanonicalEntryClaims } from '../../helpers/canonical-bundle-entry';
import { FamilyRegistrationStatus, GatewayClaim } from '../../../shared/gateway-claim-contract';

/**
 * Business-matching regression for Google/email-only individual controllers.
 *
 * Case under test:
 * 1. no telephone or legal-Person claims are present
 * 2. two family organizations share one overlapping owner email
 * 3. they differ by alternateName and by the second email in the owner list
 * 4. `_search` must recover the correct organization when the caller provides
 *    the distinguishing email plus the family nickname
 */
describe('FamilyManager multi-email integration (web/app)', () => {
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
   * Step 1: create family org #1 with owner emails `mailA,mailB`.
   * Step 2: create family org #2 with owner emails `mailA,mailC`.
   * Step 3: search using `mailC + alternateName`.
   * Step 4: assert GW returns org #2, not org #1.
   */
  it('should create two organizations with same owner (multi-email) and recover one by apodo and email', async () => {
    const tenantId = testTenant1TenantId;
    const url = `/${tenantId}/cds-es/v1/health-care/individual/org.schema/Organization/_batch`;

    // Org 1: apodo "FAMILIA-UNO", emails: "parent1@example.com,parent2@example.com"
    // Org 2: apodo "FAMILIA-DOS", emails: "parent1@example.com,parent3@example.com"
    const org1Emails = 'parent1@example.com,parent2@example.com';
    const org2Emails = 'parent1@example.com,parent3@example.com';
    const individualNickname1 = 'FAMILIA-UNO';
    const individualNickname2 = 'FAMILIA-DOS';
    const ownerIdentifierValue = 'parent1@example.com';
    const providerDid = 'did:web:provider.example.com';
    const addressCountry = 'ES';

    const baseClaims = {
      [ClaimsOrganizationSchemaorg.ownerTelephone]: '',
      [ClaimsOrganizationSchemaorg.ownerEmail]: org1Emails,
      [ClaimsOrganizationSchemaorg.ownerIdentifierValue]: ownerIdentifierValue,
      [ClaimsOrganizationSchemaorg.alternateName]: individualNickname1,
      [ClaimsServiceSchemaorg.identifier]: providerDid,
      [ClaimsServiceSchemaorg.serviceType]: testDefaultTenantServiceTypeClaim,
      [ClaimsServiceSchemaorg.category]: Sector.HEALTH_CARE,
      [ClaimsOrganizationSchemaorg.addressCountry]: addressCountry,
    };
    const baseClaims2 = {
      ...baseClaims,
      [ClaimsOrganizationSchemaorg.ownerEmail]: org2Emails,
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
        jti: 'jti-dos',
        thid: 'thid-dos',
        iss: 'did:web:client.example.com',
        aud: `did:web:${tenantId}.example.com`,
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

    // Buscar org2 por owner.email y alternateName
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
              [ClaimsOrganizationSchemaorg.ownerEmail]: 'parent3@example.com',
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
    expect(String(getClaimValue(foundClaims, ClaimsOrganizationSchemaorg.ownerEmail) || '')).toContain('parent3@example.com');
    // HostingManager's deprecated direct registration path creates an active
    // administrative record immediately; only FamilyManager's Offer/Order path
    // has a pending state and returns `resume_required` before confirmation.
    expect(getClaimValue(foundClaims, GatewayClaim.FamilyRegistrationStatus)).toBe(FamilyRegistrationStatus.Existing);
  });
});
