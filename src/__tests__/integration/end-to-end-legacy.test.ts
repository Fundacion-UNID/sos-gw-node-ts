// Flow contract: reuse shared test fixtures and canonical types; do not introduce duplicated literals.
import { resolveHostPhysicalCollectionName } from '../../config/storage-layout';
// src/__tests__/integration/end-to-end-legacy.test.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

/**
 * @file This integration test validates the "legacy" plaintext API flow.
 *
 * @architecture
 * This test suite is critical because it covers a complex asynchronous edge case:
 * the "encrypt-for-a-just-born-tenant" scenario.
 *
 * The flow is as follows:
 * 1. A plaintext JSON request to create a new tenant is sent. The API accepts it (202).
 * 2. The job is processed by the Worker, which calls the HostingManager.
 * 3. The HostingManager creates the new tenant, its keys, and its DID Document, persisting them in the database.
 * 4. Crucially, the HostingManager also explicitly loads the new tenant into the TenantsCacheManager.
 *    This makes the new tenant's configuration available to other services within the same process.
 * 5. The Worker must now encrypt the job response for the new tenant (the "encrypt-to-self" pattern).
 * 6. To do this, it asks the KmsService for the new tenant's public key.
 * 7. The KmsService, not having this key in its immediate memory, falls back to its lazy-loading mechanism:
 *    it queries the TenantsCacheManager.
 * 8. Because the HostingManager pre-emptively loaded the tenant into the cache (step 4), the KmsService
 *    finds the DID Document, extracts the public key, and successfully encrypts the response.
 *
 * This test validates that this entire chain of caching, lazy-loading, and dependency interaction works correctly.
 */

import * as express from 'express';
import { testPayloadCreateTenant1, testClaimsHostInitialization } from '../data/end-to-end.data';
import { testCommunicationAppointmentFhirR4 } from '../data/appointment.data';
import { createApiRouter } from '../../routes/api';
import { createFhirRouter } from '../../routes/fhir';
import { QueueAdapterMem } from '../../adapters/queue-mem';
import { AsyncResponseStoreMem } from '../../adapters/async-response-store.mem';
import { VaultMemRepository } from '../../database/repositories/vault/vault.mem.repository';
import { TenantsCacheManager } from '../../managers/TenantsCacheManager';
import { HostingManager } from '../../managers/HostingManager';
import { EmployeeManager } from '../../managers/EmployeeManager';
import { IndividualManager } from '../../managers/IndividualManager';
import { CredentialManager } from '../../managers/CredentialManager';
import { CompositionManager } from '../../managers/CompositionManager';
import { CommunicationManager } from '../../managers/CommunicationManager';
import { LicenseManager } from '../../managers/LicenseManager';
import { ManagerRegistry } from '../../managers/registry';
import { Worker } from '../../worker';
import { KmsService } from '../../services/KmsService';
import { CryptographyService } from 'gdc-common-utils-ts/CryptographyService';
import { AdapterCryptoSdkNode } from '../../gdc-backend-utils-node/adapters/node/crypto';
import { BlockchainAdapterMem } from '../../adapters/BlockchainAdapterMem';
import { StorageMemAdapter } from '../../database/storage/mem.storage.adapter';
import { ConsoleLogger } from '../../loggers/ConsoleLogger';
import { getEnvSectionId } from '../../utils/section-env';
import { IServerConfig } from '../../config';
import { IAuthorizationManager } from '../../managers/auth/IAuthorizationManager';
import { BundleEntry } from 'gdc-common-utils-ts/models/bundle';
import { IAccessTokenClaims } from 'gdc-common-utils-ts/models/auth';
import { ClaimsOrganizationSchemaorg, ClaimsServiceSchemaorg } from 'gdc-common-utils-ts/constants/schemaorg';
import { getTenantVaultId, generateTenantCollectionNameFromClaims } from '../../utils/tenant';
import { IncludedResource } from 'gdc-common-utils-ts/models/jsonapi';
import { getClaimsInFirstDataEntry } from 'gdc-common-utils-ts/utils/bundle-reader';
import { IKmsService } from '../../gdc-backend-utils-node/models/IKmsService';
import { invokeExpress } from './helpers/invokeExpress';
import { Sector } from 'gdc-common-utils-ts/models/urlPath';

// Mock implementation for the AuthorizationManager
class MockAuthorizationManager implements IAuthorizationManager {
  public consentStore: Map<string, boolean> = new Map();
  authorize(req: express.Request, res: express.Response, next: express.NextFunction): void {
    if (req.headers.authorization === 'Bearer mock-valid-token-for-fhir') {
      (req as any).claims = {
        iss: 'did:web:test-issuer.com', sub: 'did:web:test-employee.com', aud: 'did:web:this-gateway.com',
        scope: 'fhir:Communication.create', client_id: 'test-client',
      } as IAccessTokenClaims;
    }
    next();
  }
  public setConsent(consentId: string, hasConsent: boolean): void {
    this.consentStore.set(consentId, hasConsent);
  }
  public async canAccess(
    _claims: IAccessTokenClaims,
    _resource: BundleEntry,
    _action: string,
    consentId?: string,
  ): Promise<boolean> {
    if (!consentId) return false;
    return this.consentStore.get(consentId) ?? false;
  }
}

describe('End-to-End API Flow (Legacy / Unencrypted)', () => {
  let app: express.Express;
  let queueAdapter: QueueAdapterMem;
  let addJobSpy: jest.SpyInstance;
  let authManager: MockAuthorizationManager;
  let vaultRepository: VaultMemRepository;
  let tenantManager: TenantsCacheManager;
  let kmsService: IKmsService;

  beforeEach(async () => {
    const logger = new ConsoleLogger();
    const cryptographyService = new CryptographyService(new AdapterCryptoSdkNode());
    vaultRepository = new VaultMemRepository();
    const asyncResponseStore = new AsyncResponseStoreMem();
    
    process.env.NODE_ENV = 'development';
    process.env.DEV_SEED = 'true';
    process.env.SECURITY_MODE = 'demo';
    process.env.JSON_LEGACY = 'true';
    process.env.FHIR_LEGACY = 'true';
    process.env.DEMO_ALLOW_INSECURE_BEARER = 'true';
    
    const hostCollectionName = resolveHostPhysicalCollectionName();
    tenantManager = new TenantsCacheManager(vaultRepository, () => kmsService, hostCollectionName);
    kmsService = new KmsService(cryptographyService, tenantManager);
    await kmsService.init();

    const mockConfig: IServerConfig = {
      securityMode: 'demo',
      networkMode: 'test',
      fhirLegacy: true,
      jsonLegacy: true,
      didcommPlainEnabled: true,
      demoAllowInsecureBearer: true,
      nodeEnv: 'test', port: 3000, maxHeaderSize: 16 * 1024, apiHostname: 'testhost', hostExternalDomain: 'testhost.com',
      apiBaseUrl: 'http://testhost:3000', namespace: 'test-namespace', sectorsAllowed: [Sector.HEALTH_CARE, Sector.TEST],
      allowedPaymentMethods: ['Stripe'],
      dbProvider: 'mem', queueProvider: 'mem', storageProvider: 'mem',
      host: { legalName: 'Test Host', jurisdiction: 'us', idType: 'test-id', idValue: '12345' },
      mongo: { dbName: 'test' }, firebase: {},
    };
    const hostRuntime = { hostCollectionName, hostDid: 'did:web:testhost.com' };
    
    const hostingManager = new HostingManager(
      vaultRepository,
      kmsService,
      tenantManager,
      new StorageMemAdapter(),
      logger,
      mockConfig,
      hostRuntime,
    );
    await hostingManager.bootstrapHost(testClaimsHostInitialization);
    await tenantManager.loadHost();
    
	    const managerRegistry: ManagerRegistry = {
	      hostingManager,
	      employeeManager: new EmployeeManager(
          vaultRepository,
          kmsService,
          tenantManager,
          tenantManager,
          hostRuntime,
        ),
	      individualManager: new IndividualManager(
          vaultRepository,
          kmsService,
          tenantManager,
          new CredentialManager(vaultRepository, kmsService, tenantManager, 'testhost.com'),
          new BlockchainAdapterMem(),
          'test-ns',
          hostRuntime,
        ),
	      compositionManager: new CompositionManager(vaultRepository),
	      communicationManager: new CommunicationManager({ tenantsCacheManager: tenantManager, vaultRepository, kmsService }),
	      licenseManager: new LicenseManager(vaultRepository, kmsService),
	      tenantManager,
	    };
    
    const worker = new Worker(managerRegistry, mockConfig.apiBaseUrl, kmsService);
    queueAdapter = new QueueAdapterMem(asyncResponseStore, worker);
    addJobSpy = jest.spyOn(queueAdapter, 'addJob');

    app = express.default();
    app.use(express.json({ type: ['application/json', 'application/fhir+json'] }));
    app.use(express.urlencoded({ extended: false }));
    authManager = new MockAuthorizationManager();

    const apiRouter = createApiRouter(queueAdapter, tenantManager, kmsService, asyncResponseStore, vaultRepository, cryptographyService, mockConfig.apiBaseUrl);
    const fhirRouter = createFhirRouter(queueAdapter, authManager);
    app.use('/', apiRouter);
    app.use('/', fhirRouter);
  });

  afterEach(() => {
    jest.clearAllMocks();
    addJobSpy.mockRestore();
    queueAdapter.stop();
  });

  it('Part 1 (Legacy): should accept an unencrypted JSON request to create a new organization', async () => {
    const orgCreationPayload = { ...testPayloadCreateTenant1 };
    const registrationUrl = `/host/cds-ES/v1/test/registry/org.schema/Organization/_batch`;

    const response = await invokeExpress(app, {
      method: 'POST',
      url: registrationUrl,
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer mock-valid-token',
      },
      body: orgCreationPayload,
    });

    expect(response.status).toBe(202);
    expect(response.headers.location).toBeDefined();
    expect(addJobSpy).toHaveBeenCalledTimes(1);
    await queueAdapter.waitForEmptyQueue();
  });

  it('Part 2 (PDF Attachment): should process organization with Base64 PDF and store a URL', async () => {
    const pdfBase64 = Buffer.from('dummy-pdf-content').toString('base64');
    const orgCreationPayloadWithPdf = JSON.parse(JSON.stringify(testPayloadCreateTenant1));
    const claims = getClaimsInFirstDataEntry(orgCreationPayloadWithPdf.body);
    claims[ClaimsServiceSchemaorg.termsOfService] = pdfBase64;
    // Ensure the Service resource can be materialized into a stored document.
    claims[ClaimsServiceSchemaorg.identifier] = 'urn:uuid:service-001';
    claims[ClaimsOrganizationSchemaorg.alternateName] = 'acme-with-pdf';
    // Tenant identity is keyed by the legal identifier value, not by the display
    // alias. Reusing `acme-id` would exercise idempotency and never process this PDF.
    claims[ClaimsOrganizationSchemaorg.identifierValue] = 'acme-with-pdf';
    const registrationUrl = `/host/cds-ES/v1/test/registry/org.schema/Organization/_batch`;

    const response = await invokeExpress(app, {
      method: 'POST',
      url: registrationUrl,
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer mock-valid-token',
      },
      body: orgCreationPayloadWithPdf,
    });

    expect(response.status).toBe(202);
    expect(addJobSpy).toHaveBeenCalledTimes(1);

    await queueAdapter.waitForEmptyQueue();

    const pollingResponse = await invokeExpress(app, {
      method: 'POST',
      url: new URL(response.headers.location).pathname,
      headers: { 'content-type': 'application/json' },
      body: { thid: orgCreationPayloadWithPdf.thid },
    });
    expect(pollingResponse.status).toBe(200);
    expect(JSON.parse(pollingResponse.text).data[0]).toMatchObject({ response: { status: '201' } });

    // Registration step creates a provisional tenant record stored in the HOST vault.
    const vaultId = getTenantVaultId(
      String(claims[ClaimsServiceSchemaorg.category]),
      String(claims[ClaimsOrganizationSchemaorg.identifierValue]),
    );
    const hostCollectionName = resolveHostPhysicalCollectionName();
    const secureTenantRecord = await vaultRepository.get<any>(hostCollectionName, vaultId, getEnvSectionId('tenants'));
    expect(secureTenantRecord).toBeDefined();

    const decryptedProvisional = await kmsService.unprotectConfidentialData<any>(secureTenantRecord, 'host');
    const termsUrl = decryptedProvisional.claims[ClaimsServiceSchemaorg.termsOfService];
    const termsHash = decryptedProvisional.claims[`${ClaimsServiceSchemaorg.termsOfService}#hash`];
    
    expect(termsUrl).not.toBe(pdfBase64);
    expect(termsUrl).toContain('/local-storage/');
    expect(termsHash).toBeDefined();
  });

  describe('FHIR Communication Flow', () => {
    beforeEach(async () => {
        const orgCreationPayload = { ...testPayloadCreateTenant1 };
        const registrationUrl = `/host/cds-ES/v1/test/registry/org.schema/Organization/_batch`;
        await invokeExpress(app, {
          method: 'POST',
          url: registrationUrl,
          headers: {
            'content-type': 'application/json',
            authorization: 'Bearer mock-valid-token',
          },
          body: orgCreationPayload,
        });
        await queueAdapter.waitForEmptyQueue();
        
        // After the async job completes, explicitly load the new 'acme' tenant into the cache
        // so that subsequent API calls in other tests can find it.
        const claims = getClaimsInFirstDataEntry(testPayloadCreateTenant1.body);
        const vaultId = getTenantVaultId(
          String(claims[ClaimsServiceSchemaorg.category]),
          String(claims[ClaimsOrganizationSchemaorg.alternateName]),
        );
        await tenantManager.getTenant(vaultId);
    });

    it('should REJECT a FHIR Communication with 403 Forbidden if consent is NOT present', async () => {
      const communicationUrl = '/v1/health-care/individual/org.hl7.fhir.r4/Communication';
      const accessToken = 'Bearer mock-valid-token-for-fhir';
      const consentId = 'urn:uuid:consent-not-granted';
      const communicationResource = { 
        ...testCommunicationAppointmentFhirR4, 
        partOf: [{ reference: consentId }],
      };
      authManager.setConsent(consentId, false);
      
      const response = await invokeExpress(app, {
        method: 'POST',
        url: communicationUrl,
        headers: {
          'content-type': 'application/json',
          authorization: accessToken,
        },
        body: communicationResource,
      });

      expect(response.status).toBe(403);
    });
  });
});
