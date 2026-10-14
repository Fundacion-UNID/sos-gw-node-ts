// Flow contract: follow docs/LOCAL_FIRST_RELEASE_CONTRACT.md; host Offer search returns one primary row per response entry and never exposes the deprecated nested search list.
import { afterAll, beforeAll } from '@jest/globals';
import { ClaimsOfferSchemaorg, ClaimsOrganizationSchemaorg } from 'gdc-common-utils-ts/constants/schemaorg';
import { HostingOfferOrderService } from '../../../managers/hosting/HostingOfferOrderService';
import { SearchResponseProfileEnvironment, SearchResponseProfiles } from '../../../utils/didcomm-response';

/** Flow contract: an authorized host Offer read decrypts Firestore-shaped pending tenant records before projecting the resumable Offer. */
describe('HostingOfferOrderService pending bootstrap reads', () => {
  beforeAll(() => {
    process.env[SearchResponseProfileEnvironment.Variable] = SearchResponseProfiles.PrimaryResource;
  });
  afterAll(() => { delete process.env[SearchResponseProfileEnvironment.Variable]; });

  it('recovers Offer claims from a JWE-only pending tenant document', async () => {
    const encrypted = {
      id: 'animal-care_704457076',
      status: 'pending',
      sequence: 0,
      jwe: { protected: 'header', ciphertext: 'ciphertext' },
      indexed: { attributes: [], hmac: 'protected-index' },
    } as any;
    const claims = {
      [ClaimsOrganizationSchemaorg.alternateName]: '704457076',
      [ClaimsOfferSchemaorg.identifier]: 'urn:cds:CA-BC:v1:animal-care:product:org.schema:Offer:pending-fixture',
    };
    const vaultRepository = {
      query: jest.fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]),
      listContainersInSection: jest.fn()
        .mockResolvedValueOnce([encrypted])
        .mockResolvedValueOnce([]),
    } as any;
    const kmsService = {
      unprotectConfidentialData: jest.fn(async () => ({ claims })),
    } as any;
    const service = new HostingOfferOrderService(
      vaultRepository,
      kmsService,
      {} as any,
      {} as any,
      { hostCollectionName: 'host-collection' } as any,
    );

    const response = await service.processOfferSearchEntry(
      { tenantId: 'host' },
      { type: 'Offer-search-request-v1.0', resource: { meta: { claims: {} } } } as any,
    );

    expect(response).toHaveLength(1);
    expect((response[0].resource as any).meta.claims).toEqual(claims);
    expect((response[0].resource as any).data).toBeUndefined();
    expect(kmsService.unprotectConfidentialData).toHaveBeenCalledWith(encrypted, 'host');
    expect(vaultRepository.listContainersInSection).toHaveBeenCalledTimes(2);
  });

  it('persists a host-authored professional-seat Offer for an active tenant controller', async () => {
    const vaultRepository = {
      put: jest.fn(async () => undefined),
    } as any;
    const kmsService = {
      protectConfidentialData: jest.fn(async (document) => ({ ...document, jwe: { ciphertext: 'protected' } })),
    } as any;
    const tenantsCacheManager = {
      isTenantOperational: jest.fn(async () => true),
    } as any;
    const service = new HostingOfferOrderService(
      vaultRepository,
      kmsService,
      tenantsCacheManager,
      {
        apiBaseUrl: 'https://gw.example.test',
        hostExternalDomain: 'gw.example.test',
        host: { jurisdiction: 'CA-BC' },
        allowedPaymentMethods: ['TestNetworkVirtual'],
      } as any,
      { hostCollectionName: 'host-collection' } as any,
    );

    const response = await service.processEmployeeLicenseOfferCreateEntry(
      { tenantId: '7654321', sector: 'animal-care' } as any,
      {
        type: 'License:Purchase',
        resource: {
          resourceType: 'Offer',
          meta: { claims: {
            '@context': 'org.schema',
            '@type': 'License:Purchase',
            'org.schema.IndividualProduct.category': 'professional',
            'org.schema.Offer.eligibleQuantity.value': 3,
          } },
        },
      } as any,
    );

    expect(response.response?.status).toBe('201');
    expect(response.resource?.meta?.claims).toEqual(expect.objectContaining({
      [ClaimsOrganizationSchemaorg.alternateName]: '7654321',
      [ClaimsOfferSchemaorg.category]: 'animal-care',
      [ClaimsOfferSchemaorg.eligibleQuantityValue]: 3,
      [ClaimsOfferSchemaorg.acceptedPaymentMethod]: 'TestNetworkVirtual',
    }));
    expect(response.resource?.meta?.claims?.[ClaimsOfferSchemaorg.serialNumber]).toBeUndefined();
    expect(tenantsCacheManager.isTenantOperational).toHaveBeenCalledWith(expect.stringContaining('7654321'));
    expect(vaultRepository.put).toHaveBeenCalledWith(
      'host-collection',
      [expect.objectContaining({ jwe: { ciphertext: 'protected' } })],
      expect.stringContaining('communications'),
    );
    expect(vaultRepository.put).not.toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Array),
      expect.stringContaining('device_licenses'),
    );
  });

});
