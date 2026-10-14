// Flow contract: reuse shared test fixtures and canonical types; do not introduce duplicated literals.
// src/__tests__/unit/managers/TenantsCacheManager.test.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

import { jest } from '@jest/globals';
import type { IVaultRepository } from '../../../database/repositories/vault/vault.repository';
import type { IKmsService } from '../../../gdc-backend-utils-node/models/IKmsService';
import { EntityConfig } from '../../../gdc-backend-utils-node/models/entity';
import { TenantsCacheManager } from '../../../managers/TenantsCacheManager';
import { generateTenantCollectionNameFromClaims, getTenantVaultId } from '../../../utils/tenant';
import { getEnvSectionId } from '../../../utils/section-env';
import { Sector } from 'gdc-common-utils-ts/models/urlPath';
import { DidService } from '../../../gdc-backend-utils-node/models/did';
import { ClaimsRecord } from 'gdc-common-utils-ts/models/resource-document';
import { ClaimsOrganizationSchemaorg, ClaimsServiceSchemaorg } from 'gdc-common-utils-ts/constants/schemaorg';
import { buildOrganizationDidWeb } from 'gdc-common-utils-ts/utils/did';
import { EXAMPLE_HOST_PUBLIC_DID } from 'gdc-common-utils-ts/examples/shared';
import { testConfigDataHost, testConfigTenant1 } from '../../data/organization.data';
import { testClaimsHostInitialization, testClaimsTenant1Registration } from '../../data/end-to-end.data';
import { EntityLifecycleStatus, EntityType } from '../../../gdc-backend-utils-node/models/enums';
import { applyTenantAuthorizationStatus } from '../../../utils/tenant-lifecycle';
import { DataspaceSectors } from 'gdc-common-utils-ts/constants/sectors';

describe('TenantsCacheManager', () => {
  let tenantsCacheManager: InstanceType<typeof TenantsCacheManager>;
  let mockVaultRepository: jest.Mocked<IVaultRepository>;
  let mockKmsService: jest.Mocked<IKmsService>;
  const hostCollectionName = 'test-host-collection'; // Define for the whole suite

  // --- Test Data ---
  const mockServices: DidService[] = [{ id: 'service-1', type: 'TestService', serviceEndpoint: 'https://test.com' }];

  const hostUrn = (testClaimsHostInitialization as ClaimsRecord)[ClaimsOrganizationSchemaorg.identifier];
  const hostConfig: EntityConfig = {
    id: testConfigDataHost.id,
    type: EntityType.Organization,
    status: EntityLifecycleStatus.Active,
    claims: testClaimsHostInitialization,
    didConfig: { service: [] },
    didDocument: { '@context': 'https://www.w3.org/ns/did/v1', id: hostUrn },
    meta: { lastUpdated: '' },
  };

  const tenantUrn = (testClaimsTenant1Registration as ClaimsRecord)[ClaimsOrganizationSchemaorg.identifier];
  const healthTenantDid = buildOrganizationDidWeb({
    hostDidWeb: EXAMPLE_HOST_PUBLIC_DID,
    tenantId: String(testClaimsTenant1Registration[ClaimsOrganizationSchemaorg.identifierValue]),
    jurisdiction: String(testClaimsTenant1Registration[ClaimsOrganizationSchemaorg.addressCountry]),
    sector: String(testClaimsTenant1Registration[ClaimsServiceSchemaorg.category]),
  });
  const acmeConfig: EntityConfig = {
    id: testConfigTenant1.id,
    type: EntityType.Organization,
    status: EntityLifecycleStatus.Active,
    claims: testClaimsTenant1Registration,
    didConfig: { service: mockServices },
    didDocument: { '@context': 'https://www.w3.org/ns/did/v1', id: healthTenantDid },
    meta: { lastUpdated: '' },
  };
  const suspendedAcmeConfig = applyTenantAuthorizationStatus(acmeConfig, 'suspended');
  const acmeConfigWithoutServiceType = {
    ...acmeConfig,
    claims: {
      ...acmeConfig.claims,
    },
  } as EntityConfig;
  delete (acmeConfigWithoutServiceType.claims as ClaimsRecord)[ClaimsServiceSchemaorg.serviceType];

  const acmeSector = (acmeConfig.claims as ClaimsRecord)[ClaimsServiceSchemaorg.category] as Sector;
  const acmeAlternateName = (acmeConfig.claims as ClaimsRecord)[ClaimsOrganizationSchemaorg.alternateName];
  const acmeVaultId = getTenantVaultId(acmeSector, acmeAlternateName);

  beforeEach(() => {
    mockVaultRepository = {
      getContainersInSection: jest.fn(),
      get: jest.fn(),
      query: jest.fn(),
    } as jest.Mocked<any>;

    mockKmsService = {
      unprotectConfidentialData: jest.fn(),
    } as any;

    tenantsCacheManager = new TenantsCacheManager(mockVaultRepository, () => mockKmsService, hostCollectionName);
  });

  describe('hosted tenant DID lookup', () => {
    it('returns only the tenant whose public DID matches', async () => {
      // One legal organization may operate several sector tenants. Lifecycle
      // changes must target the DID in Organization.sameAs, never the first
      // repository result for the shared legal identifier.
      const animalTenantDid = buildOrganizationDidWeb({
        hostDidWeb: EXAMPLE_HOST_PUBLIC_DID,
        tenantId: String(testClaimsTenant1Registration[ClaimsOrganizationSchemaorg.identifierValue]),
        jurisdiction: String(testClaimsTenant1Registration[ClaimsOrganizationSchemaorg.addressCountry]),
        sector: DataspaceSectors.AnimalCare,
      });
      const animalConfig = {
        ...acmeConfig,
        didDocument: { ...acmeConfig.didDocument, id: animalTenantDid },
        claims: {
          ...acmeConfig.claims,
          [ClaimsServiceSchemaorg.category]: DataspaceSectors.AnimalCare,
        },
      } as EntityConfig;
      const animalVaultId = getTenantVaultId(DataspaceSectors.AnimalCare, acmeAlternateName);

      mockVaultRepository.query.mockResolvedValue([
        { id: acmeVaultId } as any,
        { id: animalVaultId } as any,
      ]);
      mockVaultRepository.get.mockImplementation(async (_collection, id) => {
        if (id === acmeVaultId) return { id: acmeVaultId } as any;
        if (id === animalVaultId) return { id: animalVaultId } as any;
        return undefined;
      });
      mockKmsService.unprotectConfidentialData.mockImplementation((async (record: any) => {
        if (record.id === acmeVaultId) return acmeConfig;
        if (record.id === animalVaultId) return animalConfig;
        return undefined;
      }) as IKmsService['unprotectConfidentialData']);

      await expect(tenantsCacheManager.findTenantVaultIdsByIdentifierValue(
        String(testClaimsTenant1Registration[ClaimsOrganizationSchemaorg.identifierValue]),
        {
          identifierType: String(testClaimsTenant1Registration[ClaimsOrganizationSchemaorg.identifierType]),
          tenantDid: animalTenantDid,
        },
      )).resolves.toEqual([animalVaultId]);
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getCollectionName (Lazy Loading)', () => {
    it('should fetch, decrypt, cache, and return the collection name for an uncached tenant', async () => {
      // This test validates the core lazy-loading logic.
      // It ensures that when a tenant's config is requested for the first time,
      // the manager correctly queries the HOST's physical collection to find it.

      const mockAcmeRecord = { id: acmeVaultId, content: acmeConfig };
      mockVaultRepository.get.mockResolvedValue(mockAcmeRecord);
      mockKmsService.unprotectConfidentialData.mockResolvedValue(acmeConfig);
      const expectedCollectionName = generateTenantCollectionNameFromClaims(acmeConfig.claims as ClaimsRecord);

      // --- First Call (Cache Miss) ---
      const collectionName1 = await tenantsCacheManager.getCollectionName(acmeVaultId);

      expect(collectionName1).toBe(expectedCollectionName);
      expect(mockVaultRepository.get).toHaveBeenCalledTimes(1);

             // The manager should now use the PHYSICAL host collection name to find the tenant record.
       expect(mockVaultRepository.get).toHaveBeenCalledWith(hostCollectionName, acmeVaultId, getEnvSectionId('tenants'));
      expect(mockKmsService.unprotectConfidentialData).toHaveBeenCalledTimes(1);

      // --- Second Call (Cache Hit) ---
      const collectionName2 = await tenantsCacheManager.getCollectionName(acmeVaultId);

      // Assert that we get the same result without calling the repository again.
      expect(collectionName2).toBe(expectedCollectionName);
      expect(mockVaultRepository.get).toHaveBeenCalledTimes(1); // Should not be called again
      expect(mockKmsService.unprotectConfidentialData).toHaveBeenCalledTimes(1); // Should not be called again
    });

    it('should return undefined for a tenant that does not exist in the repository', async () => {
      mockVaultRepository.get.mockResolvedValue(undefined);
      const collectionName = await tenantsCacheManager.getCollectionName('non-existent-id');
      expect(collectionName).toBeUndefined();
      expect(mockVaultRepository.get).toHaveBeenCalledTimes(1);
      expect(mockKmsService.unprotectConfidentialData).not.toHaveBeenCalled();
    });
  });

  describe('getTenantDid', () => {
    // These tests now check the on-demand caching logic.
    it('should return the DID for an existing tenant', async () => {
      mockVaultRepository.get.mockResolvedValue({ id: acmeVaultId } as any);
      mockKmsService.unprotectConfidentialData.mockResolvedValue(acmeConfig);
      const result = await tenantsCacheManager.getTenantDid(acmeVaultId);
      expect(result).toBe(healthTenantDid);
    });

    it('should return the DID for the host', async () => {
      mockVaultRepository.get.mockResolvedValue({ id: 'host' } as any);
      mockKmsService.unprotectConfidentialData.mockResolvedValue(hostConfig);
      const result = await tenantsCacheManager.getTenantDid('host');
      expect(result).toBe(hostUrn);
    });

    it('should return undefined for a non-existent tenant', async () => {
      mockVaultRepository.get.mockResolvedValue(undefined);
      const result = await tenantsCacheManager.getTenantDid('non-existent-id');
      expect(result).toBeUndefined();
    });

    it('normalizes historical KMS key purposes before caching a DID document', async () => {
      const legacyConfig = {
        ...acmeConfig,
        didDocument: {
          ...acmeConfig.didDocument,
          verificationMethod: [
            { id: `${tenantUrn}#comm`, controller: tenantUrn, type: 'JsonWebKey2020', publicKeyJwk: { kid: 'comm', use: 'sig', purpose: 'comm_sig' } },
            { id: `${tenantUrn}#vc`, controller: tenantUrn, type: 'JsonWebKey2020', publicKeyJwk: { kid: 'vc', use: 'sig', purpose: 'vc_sign' } },
          ],
          assertionMethod: [`${tenantUrn}#comm`, `${tenantUrn}#vc`],
        },
      } as any;
      mockVaultRepository.get.mockResolvedValue({ id: acmeVaultId } as any);
      mockKmsService.unprotectConfidentialData.mockResolvedValue(legacyConfig);

      const result = await tenantsCacheManager.getDidDocument(acmeVaultId);

      expect(result?.authentication).toEqual([`${tenantUrn}#comm`]);
      expect(result?.assertionMethod).toEqual([`${tenantUrn}#vc`]);
      expect((result?.verificationMethod?.[0].publicKeyJwk as any).purpose).toBeUndefined();
    });
  });

  describe('getDidServiceConfig', () => {
    it('should return the service configuration for an existing tenant', async () => {
      mockVaultRepository.get.mockResolvedValue({ id: acmeVaultId } as any);
      mockKmsService.unprotectConfidentialData.mockResolvedValue(acmeConfig);
      const result = await tenantsCacheManager.getDidServiceConfig(acmeVaultId);
      expect(result).toEqual(expect.arrayContaining(mockServices));
      expect((result || []).length).toBeGreaterThanOrEqual(mockServices.length);
    });

    it('should return the service configuration for the host', async () => {
      mockVaultRepository.get.mockResolvedValue({ id: 'host' } as any);
      mockKmsService.unprotectConfidentialData.mockResolvedValue(hostConfig);
      const result = await tenantsCacheManager.getDidServiceConfig('host');
      expect(result).toEqual([]);
    });

    it('should return undefined for a non-existent tenant', async () => {
      mockVaultRepository.get.mockResolvedValue(undefined);
      const result = await tenantsCacheManager.getDidServiceConfig('non-existent-id');
      expect(result).toBeUndefined();
    });
  });

  describe('getTenantSector', () => {
    it('should correctly extract the sector from a cached tenant', async () => {
      mockVaultRepository.get.mockResolvedValue({ id: acmeVaultId } as any);
      mockKmsService.unprotectConfidentialData.mockResolvedValue(acmeConfig);
      const sector = await tenantsCacheManager.getTenantSector(acmeVaultId);
      expect(sector).toBe(acmeSector);
    });
  });

  describe('getTenantJurisdiction', () => {
    it('should correctly extract the jurisdiction from a cached tenant', async () => {
      mockVaultRepository.get.mockResolvedValue({ id: acmeVaultId } as any);
      mockKmsService.unprotectConfidentialData.mockResolvedValue(acmeConfig);
      const jurisdiction = await tenantsCacheManager.getTenantJurisdiction(acmeVaultId);
      expect(jurisdiction).toBe((acmeConfig.claims as ClaimsRecord)[ClaimsOrganizationSchemaorg.addressCountry]);
    });

    it('keeps the ISO subdivision that owns a regional legal identifier as the route jurisdiction', async () => {
      const regionalConfig = {
        ...acmeConfig,
        claims: {
          ...acmeConfig.claims,
          [ClaimsOrganizationSchemaorg.addressCountry]: 'CA',
          [ClaimsOrganizationSchemaorg.addressRegion]: 'CA-BC',
        },
      };
      mockVaultRepository.get.mockResolvedValue({ id: acmeVaultId } as any);
      mockKmsService.unprotectConfidentialData.mockResolvedValue(regionalConfig);

      await expect(tenantsCacheManager.getTenantJurisdiction(acmeVaultId)).resolves.toBe('CA-BC');
    });
  });

  describe('tenant authorization lifecycle', () => {
    it('should expose tenant authorization status from cached config', async () => {
      mockVaultRepository.get.mockResolvedValue({ id: acmeVaultId } as any);
      mockKmsService.unprotectConfidentialData.mockResolvedValue(suspendedAcmeConfig);

      await expect(tenantsCacheManager.getTenantAuthorizationStatus(acmeVaultId)).resolves.toBe('suspended');
      await expect(tenantsCacheManager.isTenantOperational(acmeVaultId)).resolves.toBe(false);
    });

    it('should default a tenant without explicit authorization metadata to active', async () => {
      mockVaultRepository.get.mockResolvedValue({ id: acmeVaultId } as any);
      mockKmsService.unprotectConfidentialData.mockResolvedValue(acmeConfig);

      await expect(tenantsCacheManager.getTenantAuthorizationStatus(acmeVaultId)).resolves.toBe('active');
      await expect(tenantsCacheManager.isTenantOperational(acmeVaultId)).resolves.toBe(true);
    });
  });

  describe('host autodiscovery tenancy', () => {
    it('should return only operational provider-capable tenants for catalog publication', async () => {
      const suspendedVaultId = `${acmeVaultId}-suspended`;
      const nonProviderVaultId = `${acmeVaultId}-non-provider`;

      mockVaultRepository.getContainersInSection.mockResolvedValue([
        { id: acmeVaultId } as any,
        { id: suspendedVaultId } as any,
        { id: nonProviderVaultId } as any,
      ]);
      mockKmsService.unprotectConfidentialData.mockImplementation(async (_record: any) => {
        if (_record.id === acmeVaultId) return acmeConfig;
        if (_record.id === suspendedVaultId) return suspendedAcmeConfig;
        if (_record.id === nonProviderVaultId) return acmeConfigWithoutServiceType;
        return undefined;
      });

      const tenants = await tenantsCacheManager.listAutodiscoverableTenants();

      expect(tenants).toHaveLength(1);
      expect(tenants[0].didDocument.id).toBe(healthTenantDid);
      expect(mockVaultRepository.getContainersInSection).toHaveBeenCalledWith(
        hostCollectionName,
        getEnvSectionId('tenants'),
      );
    });
  });
});
