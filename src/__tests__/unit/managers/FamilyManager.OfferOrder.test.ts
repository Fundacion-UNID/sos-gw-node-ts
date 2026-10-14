// Flow contract: reuse shared test fixtures and canonical types; do not introduce duplicated literals.
import { resolveHostPhysicalCollectionName } from '../../../config/storage-layout';
/**
 * TEST SECTOR USAGE: This test uses both network (infra) and business (functional) sectors.
 *
 * - Network sector (e.g., 'test', 'test-network', 'network') is used for host/infra onboarding.
 * - Business sector (e.g., 'health-care', 'animal-health') is used for tenant/vaultId/resource operations.
 *
 * WARNING: Never mix these in the test setup or assertions. If you use the wrong sector, onboarding will fail or produce inconsistent results.
 */
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.
// Always create JSDoc, do not use strings inline in keys nor values, use types instead, and reuse the data test examples.
// File: src/__tests__/unit/managers/FamilyManager.OfferOrder.test.ts

import { afterAll, beforeAll, jest } from '@jest/globals';
import { VaultMemRepository } from '../../../database/repositories/vault/vault.mem.repository';
import { IServerConfig } from '../../../config';
import { Sector } from 'gdc-common-utils-ts/models/urlPath';
import { TenantsCacheManager } from '../../../managers/TenantsCacheManager';
import { IStorageAdapter } from '../../../database/storage/IStorageAdapter';
import { ILogger } from '../../../loggers/ILogger';
import type { IKmsService } from '../../../gdc-backend-utils-node/models/IKmsService';
import { ConfidentialStorageDoc } from 'gdc-common-utils-ts/models/confidential-storage';
import { FAMILY_ORDER_REQUEST, FAMILY_REGISTRATION_REQUEST } from '../../data/example-payloads';
import * as tenantUtils from '../../../utils/tenant';
import {
  ClaimsIndividualProductSchemaorg,
  ClaimsOfferSchemaorg,
  ClaimsOrderSchemaorg,
  ClaimsOrganizationSchemaorg,
  ClaimsServiceSchemaorg,
} from 'gdc-common-utils-ts/constants/schemaorg';
import { JobRequest, JobStatus } from 'gdc-common-utils-ts/models/confidential-job';
import { getEnvSectionId } from '../../../utils/section-env';
import { getSubjectScopedSectionId } from '../../../utils/individual-sections';
import { FamilyManager } from '../../../managers/FamilyManager';
import {
  testConfigTenant1,
  testTenant1DidWebExternal,
  testTenant1TenantId,
} from '../../data/organization.data';
import { testClaimsHostInitialization } from '../../data/end-to-end.data';
import { generateLicenseOffer } from '../../../utils/offer';
import { buildOfferOrderIndexedAttributes } from '../../../utils/offer-order-read-model';
import { EntityLifecycleStatus } from '../../../gdc-backend-utils-node/models/enums';
import {
  EXAMPLE_INDIVIDUAL_CONTROLLER_ROLE_TYPE,
  EXAMPLE_INDIVIDUAL_CONTROLLER_ROLE_VALUE,
  EXAMPLE_KYC_CONTROLLER_UUID,
  EXAMPLE_PRIVATE_INDIVIDUAL_UUID,
  EXAMPLE_REGISTERED_SUBJECT_ALTERNATE_NAME,
} from 'gdc-common-utils-ts/examples/shared';
import { SearchResponseProfileEnvironment, SearchResponseProfiles } from '../../../utils/didcomm-response';
import { ResourceTypesFhirR4 } from 'gdc-common-utils-ts/constants/fhir-resource-types';
import { Format } from 'gdc-common-utils-ts/constants/Schemas';
import { RelatedPersonClaim } from 'gdc-common-utils-ts/models/interoperable-claims/related-person-claims';
import { testExamplesDidWeb } from '../../data/identity.data';
import { SecureIdTypesIndividual } from 'gdc-common-utils-ts/constants/identity-identifiers';
import {
  buildIndividualDidWeb,
  buildSecureIdValueIndividual,
} from 'gdc-common-utils-ts/utils/did';
import { testFamilyRegisterExpanded } from '../../data/family.data';


const mockStorageAdapter: jest.Mocked<IStorageAdapter> = {
  upload: jest.fn(),
};

const mockLogger: jest.Mocked<ILogger> = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
};

const mockKmsService: jest.Mocked<IKmsService> = {
  init: jest.fn(async () => {}),
  provisionKeys: jest.fn() as any,
  getPublicJwks: jest.fn() as any,
  decodeRequest: jest.fn() as any,
  signWithManagedKey: jest.fn() as any,
  signWithReconstructedKey: jest.fn() as any,
  createDetachedJws: jest.fn(async () => 'mock-jws'),
  createCompactJws: jest.fn(async () => 'mock-compact-jws'),
  encodeResponse: jest.fn() as any,
  getHostPublicJwkSet: jest.fn() as any,
  getPublicVerificationKey: jest.fn() as any,
  getPublicEncryptionKey: jest.fn() as any,
  getHmacBase64Url: jest.fn() as any,
  protectAttributesNameAndValue: jest.fn() as any,
  protectConfidentialData: jest.fn(async (doc: ConfidentialStorageDoc) => {
    const { content, ...rest } = doc;
    return { ...rest, jwe: { ciphertext: 'encrypted' }, _content: content } as any;
  }),
  unprotectConfidentialData: jest.fn(async (doc: any) => doc._content),
};

describe('FamilyManager - Offer/Order Flow', () => {
  beforeAll(() => {
    process.env[SearchResponseProfileEnvironment.Variable] = SearchResponseProfiles.PrimaryResource;
  });
  afterAll(() => { delete process.env[SearchResponseProfileEnvironment.Variable]; });

  let vaultRepository: VaultMemRepository;
  let tenantsCacheManager: TenantsCacheManager;
  let familyManager: InstanceType<typeof FamilyManager>;
  let hostCollectionName: string;
  let config: IServerConfig;

  function buildFamilyRegistrationRequestWithoutPdfAttachment(addressCountry?: string, includeOwnerIdentifier = true) {
    const payload = structuredClone(FAMILY_REGISTRATION_REQUEST) as any;
    delete payload.attachments;
    for (const entry of payload.body.data) {
      const claimBlocks = [entry.resource?.meta?.claims].filter(Boolean);
      for (const claims of claimBlocks) {
        claims[ClaimsOrganizationSchemaorg.alternateName] = EXAMPLE_REGISTERED_SUBJECT_ALTERNATE_NAME;
        claims[ClaimsOrganizationSchemaorg.identifierValue] = EXAMPLE_PRIVATE_INDIVIDUAL_UUID;
        claims[ClaimsOrganizationSchemaorg.identifierValue.replace('org.schema.', '')] = EXAMPLE_PRIVATE_INDIVIDUAL_UUID;
        if (includeOwnerIdentifier) {
          claims[ClaimsOrganizationSchemaorg.ownerIdentifierValue] = EXAMPLE_KYC_CONTROLLER_UUID;
        } else {
          delete claims[ClaimsOrganizationSchemaorg.ownerIdentifierValue];
          delete claims[ClaimsOrganizationSchemaorg.ownerIdentifierValue.replace('org.schema.', '')];
        }
        if (addressCountry) {
          claims[ClaimsOrganizationSchemaorg.addressCountry] = addressCountry;
        } else {
          delete claims[ClaimsOrganizationSchemaorg.addressCountry];
        }
      }
    }
    return payload;
  }

  beforeEach(async () => {
    jest.clearAllMocks();

    vaultRepository = new VaultMemRepository();

    hostCollectionName = resolveHostPhysicalCollectionName();

    tenantsCacheManager = new TenantsCacheManager(vaultRepository, () => mockKmsService, hostCollectionName);

    config = {
      securityMode: 'demo',
      networkMode: 'test',
      fhirLegacy: true,
      jsonLegacy: true,
      didcommPlainEnabled: true,
      demoAllowInsecureBearer: true,
      nodeEnv: 'test',
      port: 3000,
      maxHeaderSize: 32_768,
      apiHostname: 'testhost',
      hostExternalDomain: 'host.example.com',
      apiBaseUrl: 'http://host.example.com',
      namespace: 'test-namespace',
      sectorsAllowed: [Sector.HEALTH_CARE, Sector.SYSTEM, Sector.TEST],
      dbProvider: 'mem',
      queueProvider: 'mem',
      storageProvider: 'mem',
      allowedPaymentMethods: ['Stripe'],
      host: { legalName: 'Test Host', jurisdiction: 'es', idType: 'TAX', idValue: 'A12345678' },
      mongo: { dbName: 'test' },
      firebase: {},
    };

    mockStorageAdapter.upload.mockResolvedValue({
      publicUrl: 'https://storage.example.com/terms.pdf',
      encodedMultiHash: 'zQm...',
    });

    mockKmsService.getPublicJwks.mockResolvedValue({
      keys: [{ kid: 'sig-key-1', use: 'sig', alg: 'ML-DSA-44' } as any],
    });

    // FamilyManager is the unit under test. Seed one verified active tenant
    // directly from the shared organization fixture; HostingManager's own
    // activation/Order lifecycle is covered by route integration tests.
    const expectedTenantVaultId = tenantUtils.getTenantVaultId(Sector.HEALTH_CARE, testTenant1TenantId);
    const tenantConfig = structuredClone(testConfigTenant1) as any;
    tenantConfig.claims[ClaimsServiceSchemaorg.category] = Sector.HEALTH_CARE;
    tenantConfig.didDocument = {
      ...(tenantConfig.didDocument || {}),
      id: testTenant1DidWebExternal,
    };
    const secureTenantRecord = await mockKmsService.protectConfidentialData({
      id: expectedTenantVaultId,
      status: EntityLifecycleStatus.Active,
      sequence: 0,
      content: tenantConfig,
    } as ConfidentialStorageDoc, 'host');
    await vaultRepository.put(
      hostCollectionName,
      [secureTenantRecord],
      getEnvSectionId('tenants'),
    );
    const tenantRecords = await vaultRepository.getContainersInSection(hostCollectionName, getEnvSectionId('tenants'));
    expect(tenantRecords.map((record) => record.id)).toContain(expectedTenantVaultId);
    const cachedTenant = await tenantsCacheManager.refreshTenant(expectedTenantVaultId);
    expect(cachedTenant?.didDocument?.id).toBe(testTenant1DidWebExternal);
    expect(await tenantsCacheManager.getCollectionName(expectedTenantVaultId)).toBe(
      tenantUtils.generateTenantCollectionNameFromClaims(tenantConfig.claims),
    );

    familyManager = new FamilyManager(
      vaultRepository,
      mockKmsService,
      tenantsCacheManager,
      mockStorageAdapter,
      mockLogger,
      config,
    );
  });

  it('should create a pending family record and return an Offer', async () => {
    const tenantId = testTenant1TenantId;
    const familyRegistrationJob: JobRequest = {
      id: 'job-family-1',
      status: JobStatus.DRAFT,
      sequence: 0,
      createdAtTimestamp: Date.now(),
      tenantId,
      jurisdiction: 'ES',
      sector: Sector.HEALTH_CARE,
      section: 'individual',
      format: 'org.schema',
      action: '_batch',
      resourceType: 'Organization',
      content: buildFamilyRegistrationRequestWithoutPdfAttachment(),
    };

    const responsePayload = await familyManager.process(familyRegistrationJob);
    const entry = responsePayload.body.data[0];

    expect(entry.response.status).toBe('201');
    expect(entry.type).toBe('Family-registration-offer-v1.0');
    expect(entry.resource.meta.claims[ClaimsOfferSchemaorg.identifier]).toMatch(
      /^urn:cds:ES:v1:health-care:product:org\.schema:Offer:/,
    );
    expect(entry.resource.meta.claims[ClaimsOfferSchemaorg.identifier]).not.toContain('undefined');
  });

  it('creates one UUID controller assignment when a legacy registration omitted it', async () => {
    const responsePayload = await familyManager.process({
      id: 'job-family-owner-uuid',
      status: JobStatus.DRAFT,
      sequence: 0,
      createdAtTimestamp: Date.now(),
      tenantId: testTenant1TenantId,
      jurisdiction: 'ES',
      sector: Sector.HEALTH_CARE,
      section: 'individual',
      format: 'org.schema',
      action: '_batch',
      resourceType: ResourceTypesFhirR4.Organization,
      content: buildFamilyRegistrationRequestWithoutPdfAttachment(undefined, false),
    });

    expect(responsePayload.body.data[0].resource.meta.claims[
      ClaimsOrganizationSchemaorg.ownerIdentifierValue
    ]).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  });

  it('should process a family Order and finalize the family registration', async () => {
    const tenantId = testTenant1TenantId;
    const registrationWithoutOfficialIdentifier = buildFamilyRegistrationRequestWithoutPdfAttachment();
    for (const registrationEntry of registrationWithoutOfficialIdentifier.body.data) {
      if (registrationEntry.resource?.meta?.claims) {
        delete registrationEntry.resource.meta.claims[ClaimsOrganizationSchemaorg.identifierValue];
        delete registrationEntry.resource.meta.claims[ClaimsOrganizationSchemaorg.identifierValue.replace('org.schema.', '')];
      }
      if (registrationEntry.resource?.meta) {
        delete registrationEntry.resource.meta.kyc;
        delete registrationEntry.resource.meta.extensions;
      }
    }
    expect(registrationWithoutOfficialIdentifier.body.data.every((registrationEntry: any) => (
      registrationEntry.resource?.meta?.claims?.[ClaimsOrganizationSchemaorg.identifierValue] === undefined
    ))).toBe(true);
    const familyRegistrationJob: JobRequest = {
      id: 'job-family-1',
      status: JobStatus.DRAFT,
      sequence: 0,
      createdAtTimestamp: Date.now(),
      tenantId,
      jurisdiction: 'ES',
      sector: Sector.HEALTH_CARE,
      section: 'individual',
      format: 'org.schema',
      action: '_batch',
      resourceType: 'Organization',
      content: registrationWithoutOfficialIdentifier,
    };

    const offerPayload = await familyManager.process(familyRegistrationJob);
    const firstEntry = offerPayload.body.data[0];
    expect(firstEntry.response.status).toBe('201');
    const offerId = firstEntry.resource.meta.claims[ClaimsOfferSchemaorg.identifier] as string;

    const orderContent = structuredClone(FAMILY_ORDER_REQUEST) as any;
    orderContent.body.data[0].resource.meta.claims[ClaimsOrderSchemaorg.acceptedOfferIdentifier] = offerId;

    const familyOrderJob: JobRequest = {
      id: 'job-family-order-1',
      status: JobStatus.DRAFT,
      sequence: 0,
      createdAtTimestamp: Date.now(),
      tenantId,
      sector: Sector.HEALTH_CARE,
      section: 'individual',
      format: 'org.schema',
      action: '_batch',
      resourceType: 'Order',
      content: orderContent,
    };

    const finalPayload = await familyManager.process(familyOrderJob);
    const entry = finalPayload.body.data[0];
    expect(entry.response.status).toBe('201');
    expect(entry.type).toBe('Family-order-response-v1.0');
    expect(entry.resource.meta.claims[ClaimsOrderSchemaorg.acceptedOfferIdentifier]).toBe(offerId);
    expect(entry.resource.meta.claims[ClaimsIndividualProductSchemaorg.serialNumber]).toEqual(expect.any(String));

    const tenantVaultId = tenantUtils.getTenantVaultId(Sector.HEALTH_CARE, tenantId);
    const tenantCollectionName = await tenantsCacheManager.getCollectionName(tenantVaultId);
    expect(tenantCollectionName).toBeDefined();
    const communications = await vaultRepository.getContainersInSection(
      tenantCollectionName!,
      getEnvSectionId('communications'),
    );
    expect(communications.length).toBeGreaterThan(0);
    const storedIndividuals = await vaultRepository.getContainersInSection(
      tenantCollectionName!,
      getEnvSectionId('individual'),
    );
    expect(storedIndividuals.some((document) => document.id === firstEntry.resource.id)).toBe(true);
    const individualLicenses = await vaultRepository.getContainersInSection(
      tenantVaultId,
      getEnvSectionId('device-licenses'),
    );
    expect(individualLicenses).toHaveLength(2);
    expect(individualLicenses.every((document) => (
      (document as ConfidentialStorageDoc).content as { ownerOrganizationId?: string }
    ).ownerOrganizationId === firstEntry.resource.id)).toBe(true);

    const controllerLicense = individualLicenses.find((document) =>
      String(((document as ConfidentialStorageDoc).content as any)?.activationCode || '')
        === String(entry.resource.meta.claims[ClaimsIndividualProductSchemaorg.serialNumber] || ''));
    const controllerLicenseContent = (controllerLicense as ConfidentialStorageDoc | undefined)?.content as any;
    const expectedSubjectDid = buildIndividualDidWeb({
      providerDidWeb: String(firstEntry.resource.meta.claims[ClaimsOfferSchemaorg.offeredBy]),
      secureIdTypeIndividual: SecureIdTypesIndividual.Uuid,
      secureIdValueIndividual: buildSecureIdValueIndividual({
        secureIdTypeIndividual: SecureIdTypesIndividual.Uuid,
        privateIdValueIndividual: firstEntry.resource.id,
      }),
    });
    expect(controllerLicenseContent).toEqual(expect.objectContaining({
      subjectId: firstEntry.resource.id,
      issuedToRole: `${EXAMPLE_INDIVIDUAL_CONTROLLER_ROLE_TYPE}|${EXAMPLE_INDIVIDUAL_CONTROLLER_ROLE_VALUE}`,
      relatedPersonId: firstEntry.resource.meta.claims[
        ClaimsOrganizationSchemaorg.ownerIdentifierValue
      ],
      authorizedSubjectDid: expectedSubjectDid,
    }));

    const controllerAssignment = finalPayload.body.data.find(
      (candidate: any) => candidate.type === ResourceTypesFhirR4.RelatedPerson,
    );
    expect(controllerAssignment?.resource).toMatchObject({
      resourceType: ResourceTypesFhirR4.RelatedPerson,
      meta: { claims: {
        '@context': Format.FHIR_API,
        [`${Format.FHIR_API}.${RelatedPersonClaim.Identifier}`]: controllerLicenseContent?.relatedPersonId,
        [`${Format.FHIR_API}.${RelatedPersonClaim.Patient}`]: controllerLicenseContent?.authorizedSubjectDid,
        [`${Format.FHIR_API}.${RelatedPersonClaim.Relationship}`]: `${EXAMPLE_INDIVIDUAL_CONTROLLER_ROLE_TYPE}|${EXAMPLE_INDIVIDUAL_CONTROLLER_ROLE_VALUE}`,
        [`${Format.FHIR_API}.${RelatedPersonClaim.Active}`]: 'true',
      } },
    });
    expect(controllerAssignment?.resource.meta.claims[
      `${Format.FHIR_API}.${RelatedPersonClaim.Identifier}`
    ]).toBe(firstEntry.resource.meta.claims[
      ClaimsOrganizationSchemaorg.ownerIdentifierValue
    ]);

    const relatedPersonRecords = await vaultRepository.getContainersInSection(
      tenantVaultId,
      getSubjectScopedSectionId(
        String(controllerLicenseContent?.authorizedSubjectDid),
        'individual',
        'related-persons',
      ),
    );
    expect(relatedPersonRecords).toEqual([
      expect.objectContaining({
        id: controllerLicenseContent?.relatedPersonId,
        [`${Format.FHIR_API}.${RelatedPersonClaim.Identifier}`]: controllerLicenseContent?.relatedPersonId,
        [`${Format.FHIR_API}.${RelatedPersonClaim.Patient}`]: controllerLicenseContent?.authorizedSubjectDid,
        [`${Format.FHIR_API}.${RelatedPersonClaim.Relationship}`]: `${EXAMPLE_INDIVIDUAL_CONTROLLER_ROLE_TYPE}|${EXAMPLE_INDIVIDUAL_CONTROLLER_ROLE_VALUE}`,
      }),
    ]);
  });

  it('does not activate a family Order when its controller activation code cannot be issued', async () => {
    const tenantId = testTenant1TenantId;
    const offerPayload = await familyManager.process({
      id: FAMILY_REGISTRATION_REQUEST.jti,
      status: JobStatus.DRAFT,
      sequence: 0,
      createdAtTimestamp: Date.now(),
      tenantId,
      jurisdiction: 'ES',
      sector: Sector.HEALTH_CARE,
      section: 'individual',
      format: 'org.schema',
      action: '_batch',
      resourceType: 'Organization',
      content: buildFamilyRegistrationRequestWithoutPdfAttachment(),
    });
    const offerEntry = offerPayload.body.data[0];
    const offerId = offerEntry.resource.meta.claims[ClaimsOfferSchemaorg.identifier] as string;
    const orderContent = structuredClone(FAMILY_ORDER_REQUEST) as any;
    orderContent.body.data[0].resource.meta.claims[ClaimsOrderSchemaorg.acceptedOfferIdentifier] = offerId;
    mockKmsService.protectAttributesNameAndValue.mockRejectedValueOnce(
      new Error('activation-code-index-unavailable'),
    );

    const orderPayload = await familyManager.process({
      id: FAMILY_ORDER_REQUEST.jti,
      status: JobStatus.DRAFT,
      sequence: 0,
      createdAtTimestamp: Date.now(),
      tenantId,
      sector: Sector.HEALTH_CARE,
      section: 'individual',
      format: 'org.schema',
      action: '_batch',
      resourceType: 'Order',
      content: orderContent,
    });

    expect(orderPayload.body.data[0].response.status).toBe('500');
    const tenantVaultId = tenantUtils.getTenantVaultId(Sector.HEALTH_CARE, tenantId);
    const tenantCollectionName = await tenantsCacheManager.getCollectionName(tenantVaultId);
    const storedIndividuals = await vaultRepository.getContainersInSection(
      tenantCollectionName!,
      getEnvSectionId('individual'),
    );
    const storedFamily = storedIndividuals.find((document) => document.id === offerEntry.resource.id);
    const storedContent = await mockKmsService.unprotectConfidentialData(storedFamily as ConfidentialStorageDoc, tenantVaultId);
    expect((storedContent as { status: EntityLifecycleStatus }).status).toBe(EntityLifecycleStatus.Pending);
  });

  it('recovers a missing activation projection and controller assignment from its exact issued seat', async () => {
    const tenantId = testTenant1TenantId;
    const registrationContent = buildFamilyRegistrationRequestWithoutPdfAttachment();
    const offerPayload = await familyManager.process({
      id: FAMILY_REGISTRATION_REQUEST.jti,
      status: JobStatus.DRAFT,
      sequence: 0,
      createdAtTimestamp: Date.now(),
      tenantId,
      jurisdiction: 'ES',
      sector: Sector.HEALTH_CARE,
      section: 'individual',
      format: 'org.schema',
      action: '_batch',
      resourceType: 'Organization',
      content: registrationContent,
    });
    const offerId = offerPayload.body.data[0].resource.meta.claims[ClaimsOfferSchemaorg.identifier] as string;
    const orderContent = structuredClone(FAMILY_ORDER_REQUEST) as any;
    orderContent.body.data[0].resource.meta.claims[ClaimsOrderSchemaorg.acceptedOfferIdentifier] = offerId;
    // `email_verified` is the standard OIDC proof exercised by this replay authorization test.
    orderContent.meta = {
      ...orderContent.meta,
      bearer: { jwt: { payload: { email: FAMILY_ORDER_REQUEST.iss, email_verified: true } } },
    };
    const orderJob: JobRequest = {
      id: FAMILY_ORDER_REQUEST.jti,
      status: JobStatus.DRAFT,
      sequence: 0,
      createdAtTimestamp: Date.now(),
      tenantId,
      sector: Sector.HEALTH_CARE,
      section: 'individual',
      format: 'org.schema',
      action: '_batch',
      resourceType: 'Order',
      content: orderContent,
    };

    const firstOrder = await familyManager.process(orderJob);
    const activationCode = firstOrder.body.data[0].resource.meta.claims[
      ClaimsIndividualProductSchemaorg.serialNumber
    ] as string;
    expect(activationCode).toBeTruthy();

    const tenantVaultId = tenantUtils.getTenantVaultId(Sector.HEALTH_CARE, tenantId);
    const tenantCollectionName = (await tenantsCacheManager.getCollectionName(tenantVaultId))!;
    const individualId = String(offerPayload.body.data[0].resource.id);
    const individualDocument = (await vaultRepository.get<ConfidentialStorageDoc>(
      tenantCollectionName,
      individualId,
      getEnvSectionId('individual'),
    ))!;
    const individualContent = await mockKmsService.unprotectConfidentialData<any>(
      individualDocument,
      tenantVaultId,
    );
    delete individualContent.claims[ClaimsOrganizationSchemaorg.ownerIdentifierValue];
    delete individualContent.claims[ClaimsIndividualProductSchemaorg.serialNumber];
    const legacyIndividualDocument: ConfidentialStorageDoc & { meta?: Record<string, unknown> } = {
      ...individualDocument,
      sequence: Number(individualDocument.sequence || 0) + 1,
      meta: { claims: individualContent.claims },
      content: individualContent,
    };
    await vaultRepository.put(tenantCollectionName, [await mockKmsService.protectConfidentialData(
      legacyIndividualDocument,
      tenantVaultId,
    )], getEnvSectionId('individual'));

    const licenseDocuments = await vaultRepository.getContainersInSection<ConfidentialStorageDoc>(
      tenantVaultId,
      getEnvSectionId('device-licenses'),
    );
    const controllerLicenseDocument = licenseDocuments.find((document) =>
      String((document.content as any)?.activationCode || '') === activationCode)!;
    const legacyLicense = { ...(controllerLicenseDocument.content as any) };
    const obsoleteAssignmentIdentifier = String(legacyLicense.relatedPersonId);
    const originalSubjectDid = String(legacyLicense.authorizedSubjectDid);
    delete legacyLicense.relatedPersonId;
    legacyLicense.authorizedSubjectDid = testExamplesDidWeb.individual;
    legacyLicense.issuedToEmail = testFamilyRegisterExpanded['Person.email'];
    await vaultRepository.put(tenantVaultId, [{
      ...controllerLicenseDocument,
      sequence: Number(controllerLicenseDocument.sequence || 0) + 1,
      content: legacyLicense,
    }], getEnvSectionId('device-licenses'));
    await vaultRepository.delete(
      tenantVaultId,
      obsoleteAssignmentIdentifier,
      getSubjectScopedSectionId(originalSubjectDid, 'individual', 'related-persons'),
    );

    const mismatchedContactReplay = await familyManager.process({ ...orderJob, createdAtTimestamp: Date.now() });
    expect(mismatchedContactReplay.body.data[0].response.status).toBe('409');

    legacyLicense.issuedToEmail = FAMILY_ORDER_REQUEST.iss;
    await vaultRepository.put(tenantVaultId, [{
      ...controllerLicenseDocument,
      sequence: Number(controllerLicenseDocument.sequence || 0) + 2,
      content: legacyLicense,
    }], getEnvSectionId('device-licenses'));

    const replay = await familyManager.process({ ...orderJob, createdAtTimestamp: Date.now() });
    expect(replay.body.data[0].response.status).toBe('200');
    expect(replay.body.data[0].resource.meta.claims[ClaimsIndividualProductSchemaorg.serialNumber])
      .toBe(activationCode);
    expect(replay.body.data[1].response.status).toBe('201');
    expect(replay.body.data[1].resource.meta.claims[
      `${Format.FHIR_API}.${RelatedPersonClaim.Patient}`
    ]).toBe(testExamplesDidWeb.individual);
    const assignmentIdentifier = String(replay.body.data[1].resource.id);

    const repairedIndividualDocument = (await vaultRepository.get<ConfidentialStorageDoc>(
      tenantCollectionName,
      individualId,
      getEnvSectionId('individual'),
    ))!;
    const repairedIndividualContent = await mockKmsService.unprotectConfidentialData<any>(
      repairedIndividualDocument,
      tenantVaultId,
    );
    expect(repairedIndividualContent.claims[ClaimsIndividualProductSchemaorg.serialNumber])
      .toBe(activationCode);

    const putSpy = jest.spyOn(vaultRepository, 'put');
    const completeReplay = await familyManager.process({ ...orderJob, createdAtTimestamp: Date.now() });
    expect(completeReplay.body.data[1].response.status).toBe('200');
    expect(completeReplay.body.data[1].resource.id).toBe(assignmentIdentifier);
    expect(completeReplay.body.data[1].resource.meta.claims[
      `${Format.FHIR_API}.${RelatedPersonClaim.Patient}`
    ]).toBe(testExamplesDidWeb.individual);
    expect(putSpy).not.toHaveBeenCalled();
    putSpy.mockRestore();
  });

  it('recreates the missing controller seat when an authenticated active Order is replayed', async () => {
    const tenantId = testTenant1TenantId;
    const offerPayload = await familyManager.process({
      id: FAMILY_REGISTRATION_REQUEST.jti,
      status: JobStatus.DRAFT,
      sequence: 0,
      createdAtTimestamp: Date.now(),
      tenantId,
      jurisdiction: 'ES',
      sector: Sector.HEALTH_CARE,
      section: 'individual',
      format: 'org.schema',
      action: '_batch',
      resourceType: 'Organization',
      content: buildFamilyRegistrationRequestWithoutPdfAttachment(),
    });
    const individualId = String(offerPayload.body.data[0].resource.id);
    const offerId = offerPayload.body.data[0].resource.meta.claims[ClaimsOfferSchemaorg.identifier] as string;
    const orderContent = structuredClone(FAMILY_ORDER_REQUEST) as any;
    orderContent.body.data[0].resource.meta.claims[ClaimsOrderSchemaorg.acceptedOfferIdentifier] = offerId;
    orderContent.meta = {
      ...orderContent.meta,
      bearer: { jwt: { payload: { email: FAMILY_ORDER_REQUEST.iss, email_verified: true } } },
    };
    const orderJob: JobRequest = {
      id: FAMILY_ORDER_REQUEST.jti,
      status: JobStatus.DRAFT,
      sequence: 0,
      createdAtTimestamp: Date.now(),
      tenantId,
      sector: Sector.HEALTH_CARE,
      section: 'individual',
      format: 'org.schema',
      action: '_batch',
      resourceType: 'Order',
      content: orderContent,
    };
    const firstOrder = await familyManager.process(orderJob);
    const firstActivationCode = String(firstOrder.body.data[0].resource.meta.claims[
      ClaimsIndividualProductSchemaorg.serialNumber
    ]);
    const tenantVaultId = tenantUtils.getTenantVaultId(Sector.HEALTH_CARE, tenantId);
    const tenantCollectionName = (await tenantsCacheManager.getCollectionName(tenantVaultId))!;
    const licenses = await vaultRepository.getContainersInSection<ConfidentialStorageDoc>(
      tenantVaultId,
      getEnvSectionId('device-licenses'),
    );
    const controllerSeat = licenses.find((document) => (
      String((document.content as any)?.activationCode || '') === firstActivationCode
    ))!;
    await vaultRepository.delete(tenantVaultId, controllerSeat.id, getEnvSectionId('device-licenses'));

    const activeDocument = (await vaultRepository.get<ConfidentialStorageDoc>(
      tenantCollectionName,
      individualId,
      getEnvSectionId('individual'),
    ))!;
    const activeContent = await mockKmsService.unprotectConfidentialData<any>(activeDocument, tenantVaultId);
    delete activeContent.claims[ClaimsIndividualProductSchemaorg.serialNumber];
    const legacyActiveDocument: ConfidentialStorageDoc & { meta?: Record<string, unknown> } = {
      ...activeDocument,
      sequence: Number(activeDocument.sequence || 0) + 1,
      meta: { claims: activeContent.claims },
      content: activeContent,
    };
    await vaultRepository.put(tenantCollectionName, [await mockKmsService.protectConfidentialData(
      legacyActiveDocument,
      tenantVaultId,
    )], getEnvSectionId('individual'));

    const replay = await familyManager.process({ ...orderJob, createdAtTimestamp: Date.now() });
    expect(replay.body.data[0].response.status).toBe('200');
    const recoveredActivationCode = String(replay.body.data[0].resource.meta.claims[
      ClaimsIndividualProductSchemaorg.serialNumber
    ]);
    expect(recoveredActivationCode).toBeTruthy();
    const repairedLicenses = await vaultRepository.getContainersInSection<ConfidentialStorageDoc>(
      tenantVaultId,
      getEnvSectionId('device-licenses'),
    );
    expect(repairedLicenses.some((document) => (
      String((document.content as any)?.activationCode || '') === recoveredActivationCode
      && String((document.content as any)?.ownerOrganizationId || '') === individualId
    ))).toBe(true);
  });

  it('should reopen family Offer and Order records through _search for portal-style read models', async () => {
    const tenantId = testTenant1TenantId;
    const familyRegistrationJob: JobRequest = {
      id: 'job-family-search-1',
      status: JobStatus.DRAFT,
      sequence: 0,
      createdAtTimestamp: Date.now(),
      tenantId,
      jurisdiction: 'ES',
      sector: Sector.HEALTH_CARE,
      section: 'individual',
      format: 'org.schema',
      action: '_batch',
      resourceType: 'Organization',
      content: buildFamilyRegistrationRequestWithoutPdfAttachment(),
    };

    const offerPayload = await familyManager.process(familyRegistrationJob);
    const firstEntry = offerPayload.body.data[0];
    expect(firstEntry.response.status).toBe('201');
    const offerId = firstEntry.resource.meta.claims[ClaimsOfferSchemaorg.identifier] as string;

    const orderContent = structuredClone(FAMILY_ORDER_REQUEST) as any;
    orderContent.body.data[0].resource.meta.claims[ClaimsOrderSchemaorg.acceptedOfferIdentifier] = offerId;
    await familyManager.process({
      id: 'job-family-search-order-1',
      status: JobStatus.DRAFT,
      sequence: 0,
      createdAtTimestamp: Date.now(),
      tenantId,
      sector: Sector.HEALTH_CARE,
      section: 'individual',
      format: 'org.schema',
      action: '_batch',
      resourceType: 'Order',
      content: orderContent,
    });

    const offerSearch = await familyManager.process({
      id: 'job-family-offer-search-1',
      status: JobStatus.DRAFT,
      sequence: 0,
      createdAtTimestamp: Date.now(),
      tenantId,
      sector: Sector.HEALTH_CARE,
      section: 'individual',
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
    expect(offerSearch.body.total).toBeGreaterThanOrEqual(1);
    expect(offerSearch.body.data[0].resource.data).toBeUndefined();

    const orderSearch = await familyManager.process({
      id: 'job-family-order-search-1',
      status: JobStatus.DRAFT,
      sequence: 0,
      createdAtTimestamp: Date.now(),
      tenantId,
      sector: Sector.HEALTH_CARE,
      section: 'individual',
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
    expect(orderSearch.body.total).toBeGreaterThanOrEqual(1);
    expect(orderSearch.body.data[0].resource.data).toBeUndefined();
  });

  it('uses the route network even when an individual address country conflicts', async () => {
    const response = await familyManager.process({
      id: 'job-family-route-network-wins',
      status: JobStatus.DRAFT,
      sequence: 0,
      createdAtTimestamp: Date.now(),
      tenantId: testTenant1TenantId,
      jurisdiction: 'es',
      sector: Sector.HEALTH_CARE,
      section: 'individual',
      format: 'org.schema',
      action: '_batch',
      resourceType: 'Organization',
      content: buildFamilyRegistrationRequestWithoutPdfAttachment('ZZ'),
    });

    const entry = response.body.data[0];
    expect(entry.response.status).toBe('201');
    expect(entry.resource.meta.claims[ClaimsOfferSchemaorg.identifier]).toMatch(/^urn:cds:ES:v1:health-care:/);
    expect(entry.resource.meta.claims[ClaimsOrganizationSchemaorg.addressCountry]).toBe('ZZ');
  });

  it('rejects an individual Offer when the route network is absent even if addressCountry exists', async () => {
    const response = await familyManager.process({
      id: 'job-family-missing-route-network',
      status: JobStatus.DRAFT,
      sequence: 0,
      createdAtTimestamp: Date.now(),
      tenantId: testTenant1TenantId,
      sector: Sector.HEALTH_CARE,
      section: 'individual',
      format: 'org.schema',
      action: '_batch',
      resourceType: 'Organization',
      content: buildFamilyRegistrationRequestWithoutPdfAttachment('ES'),
    });

    const entry = response.body.data[0];
    expect(entry.response.status).toBe('400');
    expect(entry.response.outcome.issue[0].diagnostics).toContain('route jurisdiction');
  });

  it('should accept one portal-managed commercial family Order and emit extra individual seats', async () => {
    process.env.PAYMENT_ORCHESTRATION_MODE = 'portal-bff';
    process.env.PAYMENT_VERIFICATION_MODE = 'mock';

    const tenantId = testTenant1TenantId;
    const tenantVaultId = tenantUtils.getTenantVaultId(Sector.HEALTH_CARE, tenantId);
    const tenantCollectionName = await tenantsCacheManager.getCollectionName(tenantVaultId);
    expect(tenantCollectionName).toBeDefined();

    const extraOfferClaims = generateLicenseOffer(
      2,
      'did:web:host.example.com',
      'es',
      Sector.HEALTH_CARE,
      ['Stripe'],
      'individual' as any,
    );

    const secureOfferDoc = await mockKmsService.protectConfidentialData({
      id: String(extraOfferClaims[ClaimsOfferSchemaorg.identifier]),
      status: 'active',
      sequence: 0,
      meta: { claims: extraOfferClaims },
      indexed: {
        attributes: buildOfferOrderIndexedAttributes(extraOfferClaims),
        hmac: { id: 'urn:unsupported', type: 'Sha256HmacKey2019' },
      },
      content: { claims: extraOfferClaims },
    } as ConfidentialStorageDoc, tenantVaultId);
    await vaultRepository.put(tenantCollectionName!, [secureOfferDoc], getEnvSectionId('communications'));

    const beforeLicenses = await vaultRepository.getContainersInSection(
      tenantVaultId,
      getEnvSectionId('device-licenses'),
    );

    const orderContent = structuredClone(FAMILY_ORDER_REQUEST) as any;
    orderContent.body.data[0].resource.meta.claims[ClaimsOrderSchemaorg.acceptedOfferIdentifier] =
      String(extraOfferClaims[ClaimsOfferSchemaorg.identifier]);
    orderContent.body.data[0].resource.meta.claims[ClaimsOrderSchemaorg.paymentMethod] = 'Stripe';
    orderContent.body.data[0].resource.meta.claims[ClaimsOrderSchemaorg.partOfInvoice] = 'in_family_test_001';

    const familyOrderJob: JobRequest = {
      id: 'job-family-commercial-order-1',
      status: JobStatus.DRAFT,
      sequence: 0,
      createdAtTimestamp: Date.now(),
      tenantId,
      sector: Sector.HEALTH_CARE,
      section: 'individual',
      format: 'org.schema',
      action: '_batch',
      resourceType: 'Order',
      content: orderContent,
    };

    const responsePayload = await familyManager.process(familyOrderJob);
    const entry = responsePayload.body.data[0];
    expect(entry.response.status).toBe('201');
    expect(entry.type).toBe('Family-order-response-v1.0');
    expect(entry.resource.meta.claims[ClaimsOrderSchemaorg.acceptedOfferIdentifier]).toBe(
      extraOfferClaims[ClaimsOfferSchemaorg.identifier],
    );
    expect(entry.resource?.resourceType).toBe('Bundle');
    expect(
      entry.resource?.entry?.some?.((bundleEntry: any) => bundleEntry?.resource?.resourceType === 'Invoice'),
    ).toBe(true);

    const afterLicenses = await vaultRepository.getContainersInSection(
      tenantVaultId,
      getEnvSectionId('device-licenses'),
    );
    expect(afterLicenses.length).toBe(beforeLicenses.length + 2);
  });
});
