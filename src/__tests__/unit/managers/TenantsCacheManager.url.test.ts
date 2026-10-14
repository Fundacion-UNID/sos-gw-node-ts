// src/__tests__/unit/managers/TenantsCacheManager.url.test.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

import { TenantsCacheManager } from '../../../managers/TenantsCacheManager';
import { VaultMemRepository } from '../../../database/repositories/vault/vault.mem.repository';
import { KmsService } from '../../../services/KmsService';
import { CryptographyService } from 'gdc-common-utils-ts/CryptographyService';
import { AdapterCryptoSdkNode } from '../../../gdc-backend-utils-node/adapters/node/crypto';
import { testConfigTenant1, testTenant1IdentifierUrn, testHostDidWeb } from '../../data/organization.data';
import { ClaimsOrganizationSchemaorg, ClaimsServiceSchemaorg } from 'gdc-common-utils-ts/constants/schemaorg';
import { EntityConfig } from '../../../gdc-backend-utils-node/models/entity';
import { getEnvSectionId } from '../../../utils/section-env';

describe('TenantsCacheManager - tenant urls', () => {
  let tenantsCacheManager: TenantsCacheManager;
  let realKmsService: KmsService;
  let vaultRepository: VaultMemRepository;

  const hostConfig: EntityConfig = {
    id: 'host-id',
    status: 'active',
    claims: { [ClaimsOrganizationSchemaorg.alternateName]: 'host' },
    didDocument: { '@context': 'https://www.w3.org/ns/did/v1', id: testHostDidWeb },
  } as any;

  const tenantConfigWithUrl: EntityConfig = {
    ...testConfigTenant1,
    didDocument: { ...testConfigTenant1.didDocument, id: testTenant1IdentifierUrn },
    claims: {
      ...testConfigTenant1.claims,
      [ClaimsOrganizationSchemaorg.url]: 'acme.example.com',
      [ClaimsServiceSchemaorg.category]: 'health-care',
    }
  } as any;

  const tenantConfigWithoutUrl: EntityConfig = { 
    ...testConfigTenant1,
    didDocument: { ...testConfigTenant1.didDocument, id: testTenant1IdentifierUrn },
    claims: {
      ...testConfigTenant1.claims,
      [ClaimsServiceSchemaorg.category]: 'health-care',
    },
  } as any;
  delete (tenantConfigWithoutUrl.claims as any)[ClaimsOrganizationSchemaorg.url];

  const tenantConfigWithOperationalUrl: EntityConfig = {
    ...tenantConfigWithUrl,
    claims: {
      ...tenantConfigWithUrl.claims,
      'org.schema.Service.url': 'operator.acme.example.com',
    },
  } as any;

  beforeEach(async () => {
    const cryptoService = new CryptographyService(new AdapterCryptoSdkNode());
    vaultRepository = new VaultMemRepository();
    tenantsCacheManager = new TenantsCacheManager(vaultRepository, () => realKmsService, 'test-host-collection');
    realKmsService = new KmsService(cryptoService, tenantsCacheManager);

    // Exercise the public storage-backed cache boundary. Older versions of this
    // test reached into a renamed private Map, so they could pass without proving
    // that a tenant registration was loadable through the real manager path.
    jest.spyOn(realKmsService, 'unprotectConfidentialData').mockImplementation(
      async (record: any) => record.content,
    );
    await vaultRepository.put(
      'test-host-collection',
      [
        { id: 'health-care_acme_with_url', status: 'active', content: tenantConfigWithUrl },
        { id: 'health-care_acme_no_url', status: 'active', content: tenantConfigWithoutUrl },
        { id: 'health-care_acme_with_operational_url', status: 'active', content: tenantConfigWithOperationalUrl },
      ] as any,
      getEnvSectionId('tenants'),
    );

    // Spy on getDidDocument and mock its implementation
    jest.spyOn(tenantsCacheManager, 'getDidDocument').mockImplementation(async (vaultId: string) => {
      if (vaultId === 'host') return hostConfig.didDocument;
      if (vaultId === 'health-care_acme_with_url') return tenantConfigWithUrl.didDocument;
      if (vaultId === 'health-care_acme_no_url') return tenantConfigWithoutUrl.didDocument;
      if (vaultId === 'health-care_acme_with_operational_url') return tenantConfigWithOperationalUrl.didDocument;
      return undefined;
    });

  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('should return the external domain URL with https if the claim exists', async () => {
    // ACT
    const url = await tenantsCacheManager.getTenantDomainUrl('health-care_acme_with_url');
    // ASSERT
    expect(url).toBe('https://acme.example.com');
  });

  it('should construct the correct hosted URL if the external domain claim is missing', async () => {
    // ACT
    const url = await tenantsCacheManager.getTenantDomainUrl('health-care_acme_no_url');
    // ASSERT
    const hostDomain = testHostDidWeb.replace('did:web:', '');
    const urnParts = testTenant1IdentifierUrn.split(':');
    const tenantPath = String((testConfigTenant1.claims as any)[ClaimsOrganizationSchemaorg.alternateName]);
    // The jurisdiction (urnParts[3]) must be lower-cased to match the canonical URL format.
    const expectedUrl = `https://${hostDomain}/${tenantPath}/cds-${urnParts[3].toLowerCase()}/${urnParts[4]}/${urnParts[5]}`;
    expect(url).toBe(expectedUrl);
  });
  
  it('should return the host URL for the host vaultId', async () => {
    // ACT
    const url = await tenantsCacheManager.getTenantDomainUrl('host');
    // ASSERT
    const hostDomain = testHostDidWeb.replace('did:web:', '');
    expect(url).toBe(`https://${hostDomain}`);
  });

  it('should return undefined for a non-existent vaultId', async () => {
    // ACT
    const url = await tenantsCacheManager.getTenantDomainUrl('non-existent-vault');
    // ASSERT
    expect(url).toBeUndefined();
  });

  it('should return the operational URL when the service claim exists', async () => {
    const url = await tenantsCacheManager.getTenantOperationalUrl('health-care_acme_with_operational_url');
    expect(url).toBe('https://operator.acme.example.com');
  });

  it('should fall back to the hosted operational URL when no service claim exists', async () => {
    const url = await tenantsCacheManager.getTenantOperationalUrl('health-care_acme_no_url');
    const hostDomain = testHostDidWeb.replace('did:web:', '');
    const urnParts = testTenant1IdentifierUrn.split(':');
    const tenantPath = String((testConfigTenant1.claims as any)[ClaimsOrganizationSchemaorg.alternateName]);
    const expectedUrl = `https://${hostDomain}/${tenantPath}/cds-${urnParts[3].toLowerCase()}/${urnParts[4]}/${urnParts[5]}`;
    expect(url).toBe(expectedUrl);
  });
});
