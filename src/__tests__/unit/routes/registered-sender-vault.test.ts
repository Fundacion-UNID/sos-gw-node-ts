// Flow contract: post-DCR tenant requests resolve keys from the exact sector-scoped tenant vault used by Device/_dcr; the unscoped host configuration vault is never substituted for a newly activated tenant.
import {
  registeredSenderPathVaultId,
  resolveRegisteredSenderVaultIdForRoute,
} from '../../../routes/api';

describe('registered sender key custody', () => {
  it('keeps a tenant DCR profile in its exact sector-scoped vault', () => {
    expect(registeredSenderPathVaultId('813723543', 'animal-care')).toBe('animal-care_813723543');
  });

  it('keeps the host configuration vault distinct from sector-scoped DCR storage', () => {
    expect(registeredSenderPathVaultId('host', 'animal-care')).toBe('host');
  });

  it('resolves a host Order sender through the canonical tenant identifier lookup', async () => {
    const resolved = await resolveRegisteredSenderVaultIdForRoute({
      tenantId: 'host',
      businessSectorOrNetworkKind: 'test-network',
      section: 'registry',
      format: 'org.schema',
      resourceType: 'Order',
      action: '_batch',
      senderDid: 'did:web:beta-gw.vetchain.app:887404386:cds-ca-bc:v1:animal-care',
      hostNetworkKind: 'test-network',
      tenantExists: async () => false,
      findTenantVaultIdByIdentifierValue: async (identifier) =>
        identifier === '887404386' ? 'animal-care_887404386' : undefined,
    });

    expect(resolved).toBe('animal-care_887404386');
  });

  it('resolves a host tenant-lifecycle sender from its tenant DCR vault', async () => {
    const resolved = await resolveRegisteredSenderVaultIdForRoute({
      tenantId: 'host',
      businessSectorOrNetworkKind: 'test',
      section: 'registry',
      format: 'org.schema',
      resourceType: 'Organization',
      action: '_status',
      senderDid: 'did:web:127.0.0.1%3A3280:VATES-B02652741:cds-ES:v1:animal-tech:employee:controller:RESPRSN',
      hostNetworkKind: 'test',
      tenantExists: async (vaultId) => vaultId === 'animal-tech_VATES-B02652741',
      findTenantVaultIdByIdentifierValue: async () => undefined,
    });

    expect(resolved).toBe('animal-tech_VATES-B02652741');
  });

  it('does not treat the in-memory test network kind as test-network', async () => {
    const resolved = await resolveRegisteredSenderVaultIdForRoute({
      tenantId: 'host',
      businessSectorOrNetworkKind: 'test',
      section: 'registry',
      format: 'org.schema',
      resourceType: 'Order',
      action: '_batch',
      senderDid: 'did:web:beta-gw.vetchain.app:988029181:cds-CA-BC:v1:animal-care:employee:actor:RESPRSN',
      hostNetworkKind: 'test-network',
      tenantExists: async (vaultId) => vaultId === 'animal-care_988029181',
      findTenantVaultIdByIdentifierValue: async () => undefined,
    });

    expect(resolved).toBe('host');
  });
});
