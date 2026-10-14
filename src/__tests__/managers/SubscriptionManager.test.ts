// Flow contract: a tenant registers an exact R5 topic/subscription, successful writes enter a durable outbox, and the BFF rest-hook receives notifications without widening scope.
import { SubscriptionManager } from '../../managers/SubscriptionManager';
import { VaultMemRepository } from '../../database/repositories/vault/vault.mem.repository';
import { mockKmsService } from '../mocks/kms.mock';
import { getEnvSectionId } from '../../utils/section-env';
import { getTenantVaultId } from '../../utils/tenant';

describe('SubscriptionManager', () => {
  it('persists an encrypted tenant/BFF FHIR R5 rest-hook Subscription', async () => {
    const vaultRepository = new VaultMemRepository();
    const vaultId = getTenantVaultId('health-care', 'tenant.example');
    await vaultRepository.createNewVault({ id: vaultId });
    const fetchFn = jest.fn(async () => ({ ok: true, status: 200 }));
    const manager = new SubscriptionManager({
      vaultRepository,
      kmsService: mockKmsService,
      tenantsCacheManager: { tenantExists: jest.fn(async () => true) } as any,
      fetchFn,
    });
    await manager.process({
      tenantId: 'tenant.example', jurisdiction: 'ES', sector: 'health-care',
      section: 'entity', format: 'org.hl7.fhir.r5', resourceType: 'SubscriptionTopic', action: '_batch',
      content: { body: { entry: [{ resource: {
        resourceType: 'SubscriptionTopic', id: 'new-data-topic', status: 'active',
        url: 'https://profiles.example/SubscriptionTopic/new-data',
        resourceTrigger: [{ resource: 'Observation' }],
        canFilterBy: [{ resourceType: 'Observation', filterParameter: 'patient', comparator: ['eq'] }],
      } }] } },
    } as any);
    const result = await manager.process({
      tenantId: 'tenant.example', jurisdiction: 'ES', sector: 'health-care',
      section: 'entity', format: 'org.hl7.fhir.r5', resourceType: 'Subscription', action: '_batch',
      content: { body: { resourceType: 'Bundle', type: 'batch', entry: [{ resource: {
        resourceType: 'Subscription', id: 'new-data', status: 'requested',
        topic: 'https://profiles.example/SubscriptionTopic/new-data',
        channelType: { code: 'rest-hook' }, endpoint: 'https://bff.example/fhir/subscriptions',
        filterBy: [{ resourceType: 'Observation', filterParameter: 'patient', value: 'Patient/123' }],
      } }] } },
    } as any);

    expect((result.body as any).data[0].response.status).toBe('201');
    const stored = await vaultRepository.get<any>(vaultId, 'new-data', getEnvSectionId('fhir-r5-subscriptions'));
    expect(stored?.jwe).toBeDefined();
    expect((result.body as any).data[0].resource.status).toBe('active');

    await manager.captureEvents({
      tenantId: 'tenant.example', jurisdiction: 'ES', sector: 'health-care',
      section: 'individual', format: 'org.hl7.fhir.r5', resourceType: 'Observation', action: '_batch',
      content: { body: { entry: [{ resource: {
        resourceType: 'Observation', id: 'obs-1', subject: { reference: 'Patient/123' }, status: 'final',
      } }] } },
    } as any);
    expect(fetchFn).toHaveBeenCalledTimes(2);
    const outbox = await vaultRepository.getContainersInSection<any>(vaultId, getEnvSectionId('fhir-r5-subscription-notifications'));
    expect(outbox).toHaveLength(1);
  });

  it('rejects an individual Subscription without an exact subject filter', async () => {
    const manager = new SubscriptionManager({
      vaultRepository: new VaultMemRepository(), kmsService: mockKmsService,
      tenantsCacheManager: { tenantExists: jest.fn(async () => true) } as any,
    });
    const result = await manager.process({
      tenantId: 'tenant.example', jurisdiction: 'ES', sector: 'health-care',
      section: 'individual', format: 'org.hl7.fhir.r5', resourceType: 'Subscription', action: '_batch',
      content: { body: { entry: [{ resource: {
        resourceType: 'Subscription', id: 'too-broad', status: 'requested',
        topic: 'https://profiles.example/SubscriptionTopic/new-data',
        channelType: { code: 'rest-hook' }, endpoint: 'https://bff.example/events',
      } }] } },
    } as any);
    expect((result.body as any).data[0].response.status).toBe('400');
  });

  it('notifies the BFF when DataConv writes an export-completion Communication', async () => {
    const vaultRepository = new VaultMemRepository();
    const vaultId = getTenantVaultId('onehealth-research', 'tenant.example');
    await vaultRepository.createNewVault({ id: vaultId });
    const fetchFn = jest.fn(async () => ({ ok: true, status: 200 }));
    const manager = new SubscriptionManager({
      vaultRepository, kmsService: mockKmsService,
      tenantsCacheManager: { tenantExists: jest.fn(async () => true) } as any, fetchFn,
    });
    const base = { tenantId: 'tenant.example', jurisdiction: 'ES', sector: 'onehealth-research', section: 'entity', format: 'org.hl7.fhir.r5', action: '_batch' };
    await manager.process({ ...base, resourceType: 'SubscriptionTopic', content: { body: { entry: [{ resource: {
      resourceType: 'SubscriptionTopic', id: 'research-export-ready', status: 'active',
      url: 'https://profiles.example/SubscriptionTopic/research-export-ready',
      resourceTrigger: [{ resource: 'Communication' }],
    } }] } } } as any);
    await manager.process({ ...base, resourceType: 'Subscription', content: { body: { entry: [{ resource: {
      resourceType: 'Subscription', id: 'research-export-ready', status: 'requested',
      topic: 'https://profiles.example/SubscriptionTopic/research-export-ready',
      channelType: { code: 'rest-hook' }, endpoint: 'https://bff.example/fhir/subscriptions',
    } }] } } } as any);

    await manager.captureEvents({ ...base, resourceType: 'Communication', content: { body: { entry: [{ resource: {
      resourceType: 'Communication', id: 'job-terminal-export-1', status: 'completed',
      subject: { reference: 'ResearchStudy/study-one' },
      payload: [{ contentReference: { reference: 'Task/export-1' } }],
    } }] } } } as any);

    expect(fetchFn).toHaveBeenCalledTimes(2);
    const outbox = await vaultRepository.getContainersInSection<any>(vaultId, getEnvSectionId('fhir-r5-subscription-notifications'));
    expect(outbox).toHaveLength(1);
  });
});
