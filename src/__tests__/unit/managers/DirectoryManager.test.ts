// Flow contract: the organization controller persists and searches only claims-first schema.org Organization/Place/Service/Product directory records through protected GW VET attributes.
import { describe, expect, it, jest } from '@jest/globals';
import { DirectoryManager } from '../../../managers/DirectoryManager';

describe('DirectoryManager', () => {
  it.each([
    ['Organization', 'org.schema.Organization.identifier', 'companion-animal-care', {
      'org.schema.Organization.parentOrganization.identifier': 'did:web:clinic.example',
      'org.schema.Organization.name': 'Companion animal care',
      'org.schema.Organization.sameAs': 'Organization/companion-animal-care',
      'org.schema.Organization.location.identifier': 'clinic-main',
      'Organization.user-selected': 'false',
    }],
    ['Place', 'org.schema.Place.identifier', 'clinic-main', {
      'org.schema.Place.owner.identifier': 'did:web:clinic.example', 'org.schema.Place.name': 'Main clinic',
      'org.schema.Place.address.addressCountry': 'CA', 'org.schema.Place.address.postalCode': 'V3K 3V9',
      'org.schema.Place.geo.latitude': '49.2446', 'org.schema.Place.geo.longitude': '-122.8926', 'Place.user-selected': 'false',
    }],
    ['Service', 'org.schema.Service.identifier', 'vaccination', {
      'org.schema.Service.provider.identifier': 'did:web:clinic.example',
      'org.schema.Service.availableChannel.serviceLocation.identifier': 'clinic-main',
      'org.schema.Service.name': 'Vaccination', 'org.schema.Service.serviceType': 'vaccination', 'Service.user-selected': 'false',
    }],
    ['Product', 'org.schema.Product.identifier', 'animal-cover-plus', {
      'org.schema.Product.provider.identifier': 'did:web:clinic.example',
      'org.schema.Product.name': 'Animal Cover Plus', 'org.schema.Product.additionalType': 'insurance-plan',
      'Product.user-selected': false,
    }],
  ] as const)('writes and searches %s using protected claims', async (resourceType, identifierClaim, id, additionalClaims) => {
    let stored: any;
    const repository = {
      put: jest.fn(async (_collection: string, records: any[]) => { stored = records[0]; return true; }),
      listContainersInSection: jest.fn(async () => stored ? [stored] : []),
    } as any;
    const kms = {
      protectAttributesNameAndValue: jest.fn(async (attributes: any[]) => attributes.map(attribute => ({ ...attribute, name: `p:${attribute.name}`, value: `p:${attribute.value}` }))),
      protectConfidentialData: jest.fn(async (document: any) => document),
      unprotectConfidentialData: jest.fn(async (document: any) => document.content),
    } as any;
    const tenantManager = { tenantExists: async () => true, getCollectionName: async () => 'tenant-collection', getTenantJurisdiction: async () => 'CA-BC', getTenant: async () => ({ didDocument: { controller: ['did:web:controller'] } }) } as any;
    const manager = new DirectoryManager({ resourceType, repository, kms, tenantManager });
    const resource = { resourceType, id, meta: { claims: { [identifierClaim]: id, ...additionalClaims } } };

    const write = await manager.process(job(resourceType, '_batch', resource));
    expect((write.body as any).data[0].response.status).toBe('201');
    expect(stored.content).toEqual({ resource: expect.objectContaining({ resourceType, id }) });
    expect(repository.put).toHaveBeenCalledWith('tenant-collection', expect.any(Array),
      resourceType === 'Organization' ? 'organizations' : resourceType === 'Place' ? 'places' : resourceType === 'Service' ? 'services' : 'products');

    const search = await manager.process(job(resourceType, '_search', { resourceType, id: 'search', meta: { claims: { [identifierClaim]: id } } }));
    expect((search.body as any).data[0].resource).toMatchObject({ resourceType, id });
  });

  it('rejects nested native Place fields and non-schema routes before persistence', async () => {
    const put = jest.fn();
    const manager = new DirectoryManager({
      resourceType: 'Place', repository: { put } as any,
      kms: { protectAttributesNameAndValue: jest.fn(), protectConfidentialData: jest.fn() } as any,
      tenantManager: { tenantExists: async () => true, getCollectionName: async () => 'tenant-collection', getTenantJurisdiction: async () => 'CA-BC', getTenant: async () => ({ didDocument: { controller: ['did:web:controller'] } }) } as any,
    });
    const invalid = { resourceType: 'Place', id: 'clinic-main', address: {}, meta: { claims: { 'org.schema.Place.identifier': 'clinic-main' } } };
    const response = await manager.process(job('Place', '_batch', invalid));
    expect((response.body as any).data[0].response.status).toBe('400');
    expect(put).not.toHaveBeenCalled();
    await expect(manager.process({ ...job('Place', '_search', invalid), format: 'org.hl7.fhir.api' } as any)).rejects.toThrow(/schema.org directory route/);
  });
});

function job(resourceType: string, action: string, resource: any) {
  return { tenantId: 'clinic', jurisdiction: 'CA-BC', sector: 'animal-care', section: 'organization', format: 'org.schema', action,
    content: { thid: `thid-${resourceType}-${action}`, iss: 'did:web:controller', body: { data: [{ request: { method: 'POST' }, resource }] } } } as any;
}
