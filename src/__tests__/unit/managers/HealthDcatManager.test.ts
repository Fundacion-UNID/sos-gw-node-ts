// Flow contract: only the authenticated organization controller persists searchable HealthDCAT resources, which are encrypted and indexed by governed flat claims.
import { describe, expect, it, jest } from '@jest/globals';
import { HealthDcatManager } from '../../../managers/HealthDcatManager';

describe('HealthDcatManager', () => {
  it.each(['Catalog', 'Dataset', 'CatalogRecord', 'Distribution', 'DataService'] as const)('writes and searches %s', async (resourceType) => {
    let stored: any;
    const repository = { put: jest.fn(async (_collection: string, records: any[]) => { stored = records[0]; return true; }), listContainersInSection: jest.fn(async () => stored ? [stored] : []) } as any;
    const kms = { protectAttributesNameAndValue: jest.fn(async (values: any[]) => values.map(value => ({ ...value, name: `p:${value.name}`, value: `p:${value.value}` }))), protectConfidentialData: jest.fn(async (value: any) => value), unprotectConfidentialData: jest.fn(async (value: any) => value.content) } as any;
    const tenantManager = tenant('did:web:controller');
    const manager = new HealthDcatManager({ resourceType, repository, kms, tenantManager });
    const resource = minimumResource(resourceType);
    const written = await manager.process(job(resourceType, '_batch', resource));
    expect((written.body as any).data[0].response.status).toBe('201');
    expect(kms.protectAttributesNameAndValue).toHaveBeenCalled();
    const found = await manager.process(job(resourceType, '_search', { resourceType, id: 'search', meta: { claims: { 'dct.identifier': resource.id } } }));
    expect((found.body as any).data[0].resource.id).toBe(resource.id);
  });

  it('rejects a non-controller before persistence', async () => {
    const put = jest.fn();
    const manager = new HealthDcatManager({ resourceType: 'CatalogRecord', repository: { put } as any, kms: {} as any, tenantManager: tenant('did:web:controller') });
    await expect(manager.process({ ...job('CatalogRecord', '_batch', minimumResource('CatalogRecord')), content: { ...job('CatalogRecord', '_batch', minimumResource('CatalogRecord')).content, iss: 'did:web:employee' } } as any)).rejects.toThrow(/controller/);
    expect(put).not.toHaveBeenCalled();
  });
});

function tenant(controller: string) { return { tenantExists: async () => true, getCollectionName: async () => 'tenant-collection', getTenantJurisdiction: async () => 'CA-BC', getTenant: async () => ({ didDocument: { controller: [controller] } }) } as any; }
function job(resourceType: string, action: string, resource: any) { return { tenantId: 'clinic', jurisdiction: 'CA-BC', sector: 'animal-research', section: 'organization', format: 'org.w3.dcat', action, content: { thid: `thid-${resourceType}-${action}`, iss: 'did:web:controller', body: { data: [{ request: { method: 'POST' }, resource }] } } } as any; }
function minimumResource(resourceType: string) {
  const claims: Record<string, unknown> = { 'dct.identifier': `${resourceType.toLowerCase()}-1` };
  if (resourceType === 'Catalog') Object.assign(claims, { 'dct.title': 'Catalog', 'dct.description': 'Catalog', 'dct.publisher': 'did:web:clinic.example', 'dcatap.applicableLegislation': ['http://data.europa.eu/eli/reg/2025/327/oj'] });
  if (resourceType === 'Dataset') Object.assign(claims, { 'dct.title': 'Dataset', 'dct.description': 'Dataset', 'dct.publisher': 'did:web:clinic.example', 'geodcatap.custodian': 'did:web:clinic.example', 'dct.accessRights': 'NON_PUBLIC', 'healthdcatap.healthCategory': ['urn:health-category:example'], 'healthdcatap.hdab': 'did:web:hdab.example', 'healthdcatap.hasStructuredData': false });
  if (resourceType === 'CatalogRecord') Object.assign(claims, { 'foaf.primaryTopic': 'Dataset/dataset-1', 'adms.status': 'published', 'dct.modified': '2026-09-10T12:00:00.000Z' });
  if (resourceType === 'Distribution') Object.assign(claims, { 'dct.title': 'Access', 'dcat.accessURL': 'https://hdab.example/apply', 'dct.format': 'http://publications.europa.eu/resource/authority/file-type/JSON', 'dct.accessRights': 'NON_PUBLIC' });
  if (resourceType === 'DataService') Object.assign(claims, { 'dct.title': 'Search', 'dct.publisher': 'did:web:clinic.example', 'dcat.endpointURL': 'https://host.example/dsp/catalog', 'dcat.servesDataset': ['Dataset/dataset-1'], 'dct.accessRights': 'RESTRICTED' });
  return { resourceType, id: `${resourceType.toLowerCase()}-1`, meta: { claims } };
}
