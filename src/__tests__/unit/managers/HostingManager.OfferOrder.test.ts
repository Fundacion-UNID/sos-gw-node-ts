// Flow contract: reuse shared test fixtures and canonical types; do not introduce duplicated literals.
// Host onboarding preserves network kind, tenant business sector, and Offer -> Order inventory across both search envelopes.
/**
 * TEST SECTOR USAGE: This test uses both network (infra) and business (functional) sectors.
 *
 * - Network sector (e.g., 'test', 'test-network', 'network') is used for host/infra onboarding.
 * - Business sector (e.g., 'health-care', 'animal-health') is used for tenant/vaultId/resource operations.
 *
 * WARNING: Never mix these in the test setup or assertions. If you use the wrong sector, onboarding will fail or produce inconsistent results.
 */
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.
// File: src/__tests__/unit/managers/HostingManager.OfferOrder.test.ts

import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { scryptSync } from 'node:crypto';
import { VaultMemRepository } from '../../../database/repositories/vault/vault.mem.repository';
import { IServerConfig } from '../../../config';
import { Sector } from 'gdc-common-utils-ts/models/urlPath';
import { JobStatus } from 'gdc-common-utils-ts/models/confidential-job';
import { TenantsCacheManager } from '../../../managers/TenantsCacheManager';
import { IStorageAdapter } from '../../../database/storage/IStorageAdapter';
import { ILogger } from '../../../loggers/ILogger';
import { IKmsService } from '../../../gdc-backend-utils-node/models/IKmsService';
import { ConfidentialStorageDoc } from 'gdc-common-utils-ts/models/confidential-storage';
import { EXAMPLE_LICENSE_INVALID_OFFER_ID } from 'gdc-common-utils-ts';
import { extractBundleSearchResources } from 'gdc-common-utils-ts/utils/organization-employee-lifecycle';
import { ClaimsIndividualProductSchemaorg } from 'gdc-common-utils-ts/constants/schemaorg';

// Create a mock KMS service for testing.
export const mockKmsService: jest.Mocked<IKmsService> = {
  init: jest.fn(async () => {}),
  provisionKeys: jest.fn() as jest.MockedFunction<IKmsService['provisionKeys']>,
  getPublicJwks: jest.fn() as jest.MockedFunction<IKmsService['getPublicJwks']>,
  decodeRequest: jest.fn(),
  signWithManagedKey: jest.fn(),
  signWithReconstructedKey: jest.fn(),
  encodeResponse: jest.fn(),
  protectConfidentialData: jest.fn(async (doc: ConfidentialStorageDoc, entityId: string): Promise<ConfidentialStorageDoc> => {
    // In this mock, we retain the content so that unprotect can retrieve it.
    const secureDoc = { ...doc, jwe: { ciphertext: 'encrypted-content' }, content: doc.content };
    delete (secureDoc as any).protectedAttributes;
    return secureDoc;
  }),
  unprotectConfidentialData: jest.fn(async (doc: ConfidentialStorageDoc, entityId: string) =>
    Promise.resolve(doc.content as any),
  ),
  createDetachedJws: jest.fn(),
  createCompactJws: jest.fn(),
  getHostPublicJwkSet: jest.fn(),
  getPublicVerificationKey: jest.fn(),
  getPublicEncryptionKey: jest.fn(),
  getHmacBase64Url: jest.fn(),
  protectAttributesNameAndValue: jest.fn(),
};
import {
  ORGANIZATION_REGISTRATION_JOB,
  ORGANIZATION_ORDER_JOB,
} from '../../data/example-jobs';
import { testClaimsHostInitialization } from '../../data/end-to-end.data';
import {
  ClaimsOrganizationSchemaorg,
  ClaimsOfferSchemaorg,
  ClaimsOrderSchemaorg,
  ClaimsServiceSchemaorg,
} from 'gdc-common-utils-ts/constants/schemaorg';
import * as tenantUtils from '../../../utils/tenant';
import { getEnvSectionId } from '../../../utils/section-env';
import { testTenant1LegalName } from '../../data/organization.data';
import { HostingManager } from '../../../managers/HostingManager';
import { HOST_ORDER_REQUIRED_INPUT_DISPLAY_CLAIMS } from '../../../managers/hosting/hosting-claim-contracts';
import { generateLicenseOffer } from '../../../utils/offer';
import { buildOfferOrderIndexedAttributes } from '../../../utils/offer-order-read-model';
import { GatewayClaim } from '../../../shared/gateway-claim-contract';


export const mockStorageAdapter: jest.Mocked<IStorageAdapter> = {
  upload: jest.fn(),
};

export const mockLogger: jest.Mocked<ILogger> = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
};

describe('HostingManager - Offer/Order Flow', () => {
  let hostingManager: InstanceType<typeof HostingManager>;
  let vaultRepository: VaultMemRepository;
  let mockTenantsCacheManager: jest.Mocked<TenantsCacheManager>;
  let mockConfig: IServerConfig;
  let hostCollectionName: string;

  beforeEach(async () => {
    jest.clearAllMocks();
    // Use the intelligent, self-learning mock repository
    vaultRepository = new VaultMemRepository();
    hostCollectionName = tenantUtils.generateTenantCollectionNameFromClaims(
      testClaimsHostInitialization,
    );
    mockTenantsCacheManager = new TenantsCacheManager(
      vaultRepository,
      () => mockKmsService,
      hostCollectionName,
    ) as jest.Mocked<TenantsCacheManager>;

    mockConfig = {
      securityMode: 'demo',
      networkMode: 'test',
      fhirLegacy: true,
      jsonLegacy: true,
      didcommPlainEnabled: true,
      demoAllowInsecureBearer: true,
      nodeEnv: 'test',
      port: 3000,
      apiHostname: 'testhost',
      hostExternalDomain: 'testhost.com',
      apiBaseUrl: 'http://testhost:3000',
      namespace: 'test-namespace',
      sectorsAllowed: [Sector.HEALTH_CARE, Sector.SYSTEM, Sector.HEALTH_INSURANCE],
      dbProvider: 'mem',
      queueProvider: 'mem',
      storageProvider: 'mem',
      allowedPaymentMethods: ['Stripe'],
      host: {
        legalName: 'Test Host',
        jurisdiction: 'us',
        idType: 'test-id',
        idValue: '12345',
      },
      maxHeaderSize: 16384,
      mongo: { dbName: 'test' },
      firebase: {},
    };

    hostingManager = new HostingManager(
      vaultRepository,
      mockKmsService,
      mockTenantsCacheManager,
      mockStorageAdapter,
      mockLogger,
      mockConfig,
      { hostCollectionName, hostDid: 'did:web:testhost.com' },
    );

    mockKmsService.getPublicJwks.mockResolvedValue({
      keys: [
        { kid: 'sig-key-1', use: 'sig', alg: 'ML-DSA-44' } as any,
        { kid: 'enc-key-1', use: 'enc', crv: 'ML-KEM-768' } as any,
      ],
    });

    // HostingManager expects provisioning to return at least one signing key (kty=AKP)
    // and one encryption key (kty=OKP), each with a `kid`, when it needs to build
    // an admin employee DID document during order finalization.
    mockKmsService.provisionKeys.mockResolvedValue({
      keys: [
        { kty: 'AKP', kid: 'sig-key-1', use: 'sig', alg: 'ML-DSA-44' },
        { kty: 'OKP', kid: 'enc-key-1', use: 'enc', crv: 'ML-KEM-768' },
      ],
    } as any);

    // Bootstrap the host. This will teach the mock repository the host's collection name.
    await hostingManager.bootstrapHost(testClaimsHostInitialization);
    await mockTenantsCacheManager.loadHost();

    // Mock the storage adapter to simulate a successful file upload.
    mockStorageAdapter.upload.mockResolvedValue({
      publicUrl: 'https://storage.example.com/terms.pdf',
      encodedMultiHash: 'zQm...',
    });
  });


  it('should create a PROVISIONAL tenant record and return an Offer', async () => {
    const job = structuredClone(ORGANIZATION_REGISTRATION_JOB);
    const responsePayload = await hostingManager.process(job);
    const entry = responsePayload.body.data[0];
    expect(entry.response.status).toBe('201');
    expect(entry.type).toBe('Organization-registration-offer-v1.0');
    expect(entry.resource.meta.claims[ClaimsOfferSchemaorg.identifier]).toBeDefined();

    const claims = job.content!.body!.data[0]!.resource!.meta!.claims;
    // BUSINESS sector is used for vaultId (never network sector)
    const tenantAlternateName =
      claims[ClaimsOrganizationSchemaorg.alternateName]
      || claims[ClaimsOrganizationSchemaorg.identifierValue];
    const tenantVaultId = tenantUtils.getTenantVaultId(
      claims[ClaimsServiceSchemaorg.category] as Sector,
      tenantAlternateName,
    );

    const provisionalDoc = (await vaultRepository.get(
      hostCollectionName,
      tenantVaultId,
      getEnvSectionId('tenants'),
    )) as ConfidentialStorageDoc;
    expect(provisionalDoc).toBeDefined();
    expect(provisionalDoc.content).toBeDefined();
    expect(provisionalDoc.content!.status).toBe('pending');
    expect(
      provisionalDoc.content!.claims[ClaimsOrganizationSchemaorg.legalName],
    ).toBe(testTenant1LegalName);
  });

  it('should process an Order to finalize a registration', async () => {
    // Step 1: Create the provisional registration to get an Offer ID
    const registrationJob = structuredClone(ORGANIZATION_REGISTRATION_JOB);
    const offerResponse = await hostingManager.process(registrationJob);
    const offerId = offerResponse.body.data[0].resource.meta.claims[
      ClaimsOfferSchemaorg.identifier
    ] as string;
    expect(offerId).toBeDefined();

    // Step 2: Create and process the Order
    const orderJob = structuredClone(ORGANIZATION_ORDER_JOB);
    orderJob.content!.body!.data[0]!.resource!.meta!.claims[
      ClaimsOrderSchemaorg.acceptedOfferIdentifier
    ] = offerId;

    const finalResponse = await hostingManager.process(orderJob);

    // Assert the final response
    const finalEntry = finalResponse.body.data[0];
    expect(finalEntry.response.status).toBe('201');
    expect(['Organization-order-response-v1.0', 'Organization-order-request-v1.0']).toContain(finalEntry.type);
    expect(
      finalEntry.resource.meta.claims[ClaimsOrderSchemaorg.acceptedOfferIdentifier],
    ).toBe(offerId);
    // `networkKind=test` has no blockchain, but Order must still return the
    // controller activation licence needed by Token/_exchange and DCR.
    expect(finalEntry.resource.meta.claims[ClaimsIndividualProductSchemaorg.serialNumber])
      .toEqual(expect.any(String));

    // Assert the state of the finalized tenant record in the host's vault
    const regClaims = registrationJob.content!.body!.data[0]!.resource!.meta!.claims;
    // BUSINESS sector is used for vaultId (never network sector)
    const tenantAlternateName =
      regClaims[ClaimsOrganizationSchemaorg.alternateName]
      || regClaims[ClaimsOrganizationSchemaorg.identifierValue];
    const tenantVaultId = tenantUtils.getTenantVaultId(
      regClaims[ClaimsServiceSchemaorg.category] as Sector,
      tenantAlternateName,
    );
    const finalDoc = (await vaultRepository.get(
      hostCollectionName,
      tenantVaultId,
      getEnvSectionId('tenants'),
    )) as ConfidentialStorageDoc;
    expect(finalDoc).toBeDefined();
    expect(finalDoc.content).toBeDefined();
    expect(finalDoc.sequence).toBe(1);
    expect(finalDoc.content!.status).toBe('active');
    expect(finalDoc.content!.networkStatus[0].status).toBe('active');
    expect(finalDoc.content!.didDocument).toBeDefined();
    expect(finalEntry.resource.meta.claims[GatewayClaim.OrganizationDid])
      .toBe(finalDoc.content!.didDocument.id);

    // Assert that the tenant's own vault and resources were created
    const tenantCollectionName =
      tenantUtils.generateTenantCollectionNameFromClaims(regClaims);
    const legalParticipantDoc = await vaultRepository.get(
      tenantCollectionName,
      'legal-participant.vc.json',
      getEnvSectionId('.well-known'),
    );
    expect(legalParticipantDoc).toBeDefined();
    const controllerDocs = await vaultRepository.getContainersInSection(
      tenantCollectionName,
      getEnvSectionId('employees'),
    );
    expect(controllerDocs).toHaveLength(1);
    const controllers = Array.isArray(finalDoc.content!.didDocument.controller)
      ? finalDoc.content!.didDocument.controller
      : [finalDoc.content!.didDocument.controller];
    expect(controllers).toEqual([(controllerDocs[0] as any).content?.didDocument?.id]);

    const communications = await vaultRepository.getContainersInSection(
      hostCollectionName,
      getEnvSectionId('communications'),
    );
    expect(communications.length).toBeGreaterThan(0);
  });

  it('assigns the exact delivered postal code when the pending record has a server-owned VC binding', async () => {
    const code = 'UNID-ABC1234567';
    const pepper = 'test-host-postal-pepper';
    const salt = 'test-postal-salt';
    process.env.HOST_POSTAL_ACTIVATION_PEPPER = pepper;
    const registrationJob = structuredClone(ORGANIZATION_REGISTRATION_JOB);
    const offerResponse = await hostingManager.process(registrationJob);
    const offerId = offerResponse.body.data[0].resource.meta.claims[ClaimsOfferSchemaorg.identifier] as string;
    const regClaims = registrationJob.content!.body!.data[0]!.resource!.meta!.claims;
    const alternateName = regClaims[ClaimsOrganizationSchemaorg.alternateName]
      || regClaims[ClaimsOrganizationSchemaorg.identifierValue];
    const tenantVaultId = tenantUtils.getTenantVaultId(
      regClaims[ClaimsServiceSchemaorg.category] as Sector, alternateName,
    );
    const pending = await vaultRepository.get(hostCollectionName, tenantVaultId, getEnvSectionId('tenants')) as ConfidentialStorageDoc;
    (pending.content as any).postalActivationCodeBinding = {
      algorithm: 'scrypt-v1', salt,
      digest: scryptSync(`${code}:${pepper}`, salt, 32).toString('base64url'),
    };
    await vaultRepository.put(hostCollectionName, [pending], getEnvSectionId('tenants'));
    const storedPending = await vaultRepository.get(hostCollectionName, tenantVaultId, getEnvSectionId('tenants')) as ConfidentialStorageDoc;
    expect((storedPending.content as any).postalActivationCodeBinding).toEqual(expect.objectContaining({ algorithm: 'scrypt-v1', salt }));
    expect(process.env.HOST_POSTAL_ACTIVATION_PEPPER).toBe(pepper);

    const orderJob = structuredClone(ORGANIZATION_ORDER_JOB);
    orderJob.content!.body!.data[0]!.resource!.meta!.claims[ClaimsOrderSchemaorg.acceptedOfferIdentifier] = offerId;
    orderJob.content!.body!.data[0]!.resource!.meta!.claims[ClaimsOrderSchemaorg.confirmationNumber] = code;
    const response = await hostingManager.process(orderJob);

    expect(response.body.data[0].response.status).toBe('201');
    expect(response.body.data[0].resource.meta.claims[ClaimsIndividualProductSchemaorg.serialNumber]).toBe(code);
    const licenses = await vaultRepository.getContainersInSection(tenantVaultId, getEnvSectionId('device-licenses'));
    expect(licenses.some(doc => ((doc as ConfidentialStorageDoc).content as any)?.activationCode === code)).toBe(true);
    delete process.env.HOST_POSTAL_ACTIVATION_PEPPER;
  });

  it('should accept one portal-managed commercial Order and emit extra employee seats for an active tenant', async () => {
    process.env.PAYMENT_ORCHESTRATION_MODE = 'portal-bff';
    process.env.PAYMENT_VERIFICATION_MODE = 'mock';

    const registrationJob = structuredClone(ORGANIZATION_REGISTRATION_JOB);
    const offerResponse = await hostingManager.process(registrationJob);
    const registrationOfferId = offerResponse.body.data[0].resource.meta.claims[
      ClaimsOfferSchemaorg.identifier
    ] as string;

    const registrationOrder = structuredClone(ORGANIZATION_ORDER_JOB);
    registrationOrder.content!.body!.data[0]!.resource!.meta!.claims[
      ClaimsOrderSchemaorg.acceptedOfferIdentifier
    ] = registrationOfferId;
    await hostingManager.process(registrationOrder);

    const regClaims = registrationJob.content!.body!.data[0]!.resource!.meta!.claims;
    const tenantAlternateName =
      regClaims[ClaimsOrganizationSchemaorg.alternateName]
      || regClaims[ClaimsOrganizationSchemaorg.identifierValue];
    const tenantVaultId = tenantUtils.getTenantVaultId(
      regClaims[ClaimsServiceSchemaorg.category] as Sector,
      tenantAlternateName,
    );

    const extraOfferClaims = generateLicenseOffer(
      2,
      'did:web:testhost.com',
      'us',
      Sector.HEALTH_CARE,
      ['Stripe'],
    );
    extraOfferClaims[ClaimsOrganizationSchemaorg.alternateName] = tenantAlternateName;

    const secureOfferDoc = await mockKmsService.protectConfidentialData({
      id: String(extraOfferClaims[ClaimsOfferSchemaorg.identifier]),
      status: 'active',
      sequence: 0,
      meta: { claims: extraOfferClaims },
      indexed: {
        attributes: buildOfferOrderIndexedAttributes(extraOfferClaims as Record<string, unknown>),
        hmac: { id: 'urn:unsupported', type: 'Sha256HmacKey2019' },
      },
      content: { claims: extraOfferClaims },
    } as ConfidentialStorageDoc, 'host');
    await vaultRepository.put(hostCollectionName, [secureOfferDoc], getEnvSectionId('communications'));

    const beforeLicenses = await vaultRepository.getContainersInSection(
      tenantVaultId,
      getEnvSectionId('device-licenses'),
    );

    const orderJob = structuredClone(ORGANIZATION_ORDER_JOB);
    orderJob.content!.body!.data[0]!.resource!.meta!.claims[
      ClaimsOrderSchemaorg.acceptedOfferIdentifier
    ] = String(extraOfferClaims[ClaimsOfferSchemaorg.identifier]);
    orderJob.content!.body!.data[0]!.resource!.meta!.claims[
      ClaimsOrderSchemaorg.paymentMethod
    ] = 'Stripe';
    orderJob.content!.body!.data[0]!.resource!.meta!.claims[
      ClaimsOrderSchemaorg.partOfInvoice
    ] = 'in_test_001';

    const responsePayload = await hostingManager.process(orderJob);
    const finalEntry = responsePayload.body.data[0];

    expect(finalEntry.response.status).toBe('201');
    expect(finalEntry.type).toBe('Organization-order-response-v1.0');
    expect(finalEntry.resource.meta.claims[ClaimsOrderSchemaorg.acceptedOfferIdentifier]).toBe(
      extraOfferClaims[ClaimsOfferSchemaorg.identifier],
    );
    expect(finalEntry.resource.meta.claims[ClaimsOrderSchemaorg.partOfInvoice]).toBe('in_test_001');
    expect(finalEntry.resource?.resourceType).toBe('Bundle');
    expect(
      finalEntry.resource?.entry?.some?.((bundleEntry: any) => bundleEntry?.resource?.resourceType === 'Invoice'),
    ).toBe(true);

    const afterLicenses = await vaultRepository.getContainersInSection(
      tenantVaultId,
      getEnvSectionId('device-licenses'),
    );
    expect(afterLicenses.length).toBe(beforeLicenses.length + 2);
  });

  it('should return a 404 Not Found for an Order with an invalid offerId', async () => {
    const orderJob = structuredClone(ORGANIZATION_ORDER_JOB);
    orderJob.content!.body!.data[0]!.resource!.meta!.claims[
      ClaimsOrderSchemaorg.acceptedOfferIdentifier
    ] = EXAMPLE_LICENSE_INVALID_OFFER_ID;

    const responsePayload = await hostingManager.process(orderJob);

    const errorEntry = responsePayload.body.data[0];
    expect(errorEntry.response.status).toBe('404');
    expect(errorEntry.response.outcome.issue[0].diagnostics).toContain(
      'No pending registration or commercial offer found for offerId',
    );
  });

  /**
   * Consumer contract guard for `Order/_batch`.
   *
   * This test must fail if Order processing ever starts accepting a payload
   * that omits `Order.acceptedOffer.identifier`, because that would hide a
   * broken producer (`_activate` or `_transaction`) instead of surfacing it.
   */
  it('should return a 400 Bad Request for an Order without acceptedOffer.identifier', async () => {
    // Step 1: remove both accepted-offer representations so the manager cannot
    // recover through alias resolution and must fail the consumer contract.
    const orderJob = structuredClone(ORGANIZATION_ORDER_JOB);
    delete orderJob.content!.body!.data[0]!.resource!.meta!.claims.Order?.acceptedOffer;
    delete orderJob.content!.body!.data[0]!.resource!.meta!.claims[HOST_ORDER_REQUIRED_INPUT_DISPLAY_CLAIMS[0]];
    delete orderJob.content!.body!.data[0]!.resource!.meta!.claims[ClaimsOrderSchemaorg.acceptedOfferIdentifier];

    const responsePayload = await hostingManager.process(orderJob);

    // Step 2: assert the external public claim label, not an internal storage
    // key, because that is the contract integrators actually see.
    const errorEntry = responsePayload.body.data[0];
    expect(errorEntry.response.status).toBe('400');
    expect(errorEntry.response.outcome.issue[0].diagnostics).toContain(
      `Missing required claim in Order: '${HOST_ORDER_REQUIRED_INPUT_DISPLAY_CLAIMS[0]}'`,
    );
  });

  it('should reopen hosted Offer and Order records through _search for portal-style read models', async () => {
    process.env.PAYMENT_ORCHESTRATION_MODE = 'portal-bff';
    process.env.PAYMENT_VERIFICATION_MODE = 'mock';

    const registrationJob = structuredClone(ORGANIZATION_REGISTRATION_JOB);
    const registrationOfferResponse = await hostingManager.process(registrationJob);
    const registrationOfferId = registrationOfferResponse.body.data[0].resource.meta.claims[
      ClaimsOfferSchemaorg.identifier
    ] as string;

    const registrationOrder = structuredClone(ORGANIZATION_ORDER_JOB);
    registrationOrder.content!.body!.data[0]!.resource!.meta!.claims[
      ClaimsOrderSchemaorg.acceptedOfferIdentifier
    ] = registrationOfferId;
    await hostingManager.process(registrationOrder);

    const regClaims = registrationJob.content!.body!.data[0]!.resource!.meta!.claims;
    const tenantAlternateName =
      regClaims[ClaimsOrganizationSchemaorg.alternateName]
      || regClaims[ClaimsOrganizationSchemaorg.identifierValue];

    const extraOfferClaims = generateLicenseOffer(
      2,
      'did:web:testhost.com',
      'us',
      Sector.HEALTH_CARE,
      ['Stripe'],
    );
    extraOfferClaims[ClaimsOrganizationSchemaorg.alternateName] = tenantAlternateName;
    const offerId = String(extraOfferClaims[ClaimsOfferSchemaorg.identifier]);

    const secureOfferDoc = await mockKmsService.protectConfidentialData({
      id: offerId,
      status: 'active',
      sequence: 0,
      meta: { claims: extraOfferClaims },
      indexed: {
        attributes: buildOfferOrderIndexedAttributes(extraOfferClaims as Record<string, unknown>),
        hmac: { id: 'urn:unsupported', type: 'Sha256HmacKey2019' },
      },
      content: { claims: extraOfferClaims },
    } as ConfidentialStorageDoc, 'host');
    await vaultRepository.put(hostCollectionName, [secureOfferDoc], getEnvSectionId('communications'));

    const commercialOrder = structuredClone(ORGANIZATION_ORDER_JOB);
    commercialOrder.content!.body!.data[0]!.resource!.meta!.claims[
      ClaimsOrderSchemaorg.acceptedOfferIdentifier
    ] = offerId;
    commercialOrder.content!.body!.data[0]!.resource!.meta!.claims[
      ClaimsOrderSchemaorg.paymentMethod
    ] = 'Stripe';
    commercialOrder.content!.body!.data[0]!.resource!.meta!.claims[
      ClaimsOrderSchemaorg.partOfInvoice
    ] = 'in_test_search_001';
    await hostingManager.process(commercialOrder);

    const offerSearch = await hostingManager.process({
      id: 'job-host-offer-search-1',
      status: JobStatus.DRAFT,
      sequence: 0,
      createdAtTimestamp: Date.now(),
      tenantId: tenantAlternateName,
      sector: Sector.HEALTH_CARE,
      section: 'entity',
      format: 'org.schema',
      action: '_search',
      resourceType: 'Offer',
      content: {
        body: {
          data: [{
            type: 'Offer-search-request-v1.0',
            meta: { claims: { [ClaimsOfferSchemaorg.identifier]: offerId } },
            resource: { meta: { claims: { [ClaimsOfferSchemaorg.identifier]: offerId } } },
          }],
        },
      } as any,
    });

    expect(offerSearch.body.data[0].response.status).toBe('200');
    expect(extractBundleSearchResources(offerSearch.body).length).toBeGreaterThanOrEqual(1);

    const orderSearch = await hostingManager.process({
      id: 'job-host-order-search-1',
      status: JobStatus.DRAFT,
      sequence: 0,
      createdAtTimestamp: Date.now(),
      tenantId: tenantAlternateName,
      sector: Sector.HEALTH_CARE,
      section: 'entity',
      format: 'org.schema',
      action: '_search',
      resourceType: 'Order',
      content: {
        body: {
          data: [{
            type: 'Order-search-request-v1.0',
            meta: { claims: { [ClaimsOrderSchemaorg.acceptedOfferIdentifier]: offerId } },
            resource: { meta: { claims: { [ClaimsOrderSchemaorg.acceptedOfferIdentifier]: offerId } } },
          }],
        },
      } as any,
    });

    expect(orderSearch.body.data[0].response.status).toBe('200');
    expect(extractBundleSearchResources(orderSearch.body).length).toBeGreaterThanOrEqual(1);
  });
});
