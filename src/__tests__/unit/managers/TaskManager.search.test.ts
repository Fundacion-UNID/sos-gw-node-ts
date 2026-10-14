// Flow contract: staging Task search returns one subject-scoped Task row per
// outer Bundle entry without a nested resource.data list.
import { afterAll, beforeAll, describe, expect, it, jest } from '@jest/globals';
import { createTaskService } from 'tasks-core-node-ts';
import { TaskManager } from '../../../managers/TaskManager';
import { SearchResponseProfileEnvironment, SearchResponseProfiles } from '../../../utils/didcomm-response';

/**
 * Flow contract: shared voice/web Task readback
 *
 * 1. Both channels create through the same TaskManager/TaskService.
 * 2. `_search` requires one subject and returns only that subject's tasks.
 * 3. Status changes keep using PUT/PATCH/DELETE on the same task id.
 */
describe('TaskManager subject search', () => {
  beforeAll(() => {
    process.env[SearchResponseProfileEnvironment.Variable] = SearchResponseProfiles.PrimaryResource;
  });
  afterAll(() => { delete process.env[SearchResponseProfileEnvironment.Variable]; });

  it('creates, edits and reads a task for exactly one subject', async () => {
    const manager = new TaskManager({
      taskService: createTaskService({ defaultChannels: ['phone'] }),
      tenantsCacheManager: {
        getTenantIdentifierUrn: jest.fn(async () => 'urn:uuid:unid'),
        getTenantDid: jest.fn(async () => 'did:web:unid'),
      } as any,
    });

    // Step 1. The portal creates the same Task shape used by voice reminders.
    await manager.process(job('_batch', [{
      request: { method: 'POST' },
      resource: { resourceType: 'Task', id: 'task-1', description: 'Preparar informe', meta: { claims: { '@context': 'org.hl7.fhir.api', 'Task.id': 'task-1', 'Task.subject': 'did:web:subject-example', 'Task.status': 'active', 'Task.channel': 'web,email,sms', 'controller-email': 'subject-example@example.org', 'subject-phone': '+34600000000' } } },
    }]));

    // Step 2. Editing changes the existing task without changing its subject.
    await manager.process(job('_batch', [{
      request: { method: 'PUT' },
      resource: { resourceType: 'Task', id: 'task-1', description: 'Preparar informe firmado', meta: { claims: { '@context': 'org.hl7.fhir.api', 'Task.id': 'task-1', 'Task.subject': 'did:web:subject-example', 'Task.status': 'active', 'Task.channel': 'web,email,sms', 'controller-email': 'subject-example@example.org', 'subject-phone': '+34600000000' } } },
    }]));

    // Step 3. Subject-scoped readback returns the backend-confirmed edit.
    const response = await manager.process(job('_search', [{ resource: { resourceType: 'Task', meta: { claims: { 'Task.subject': 'did:web:subject-example' } } } }]));
    expect((response.body as any).total).toBe(1);
    expect((response.body as any).data[0].resource.id).toBe('task-1');
    expect((response.body as any).data[0].resource.resource.description).toBe('Preparar informe firmado');
    expect((response.body as any).data[0].resource.meta.claims).toMatchObject({
      'Task.channel': 'web,email,sms',
      'controller-email': 'subject-example@example.org',
      'subject-phone': '+34600000000',
    });

    // Step 4. FHIR lifecycle states are reversible until entered-in-error and
    // every mutation is confirmed through the same subject-scoped search.
    await manager.process(job('_batch', [taskUpdate('cancelled')]));
    let lifecycle = await manager.process(job('_search', [{ resource: { resourceType: 'Task', meta: { claims: { 'Task.subject': 'did:web:subject-example' } } } }]));
    expect((lifecycle.body as any).data[0].resource.meta.claims['Task.status']).toBe('cancelled');

    await manager.process(job('_batch', [taskUpdate('requested')]));
    lifecycle = await manager.process(job('_search', [{ resource: { resourceType: 'Task', meta: { claims: { 'Task.subject': 'did:web:subject-example' } } } }]));
    expect((lifecycle.body as any).data[0].resource.meta.claims['Task.status']).toBe('requested');

    await manager.process(job('_batch', [taskUpdate('entered-in-error')]));
    lifecycle = await manager.process(job('_search', [{ resource: { resourceType: 'Task', meta: { claims: { 'Task.subject': 'did:web:subject-example' } } } }]));
    expect((lifecycle.body as any).data[0].resource.meta.claims['Task.status']).toBe('entered-in-error');
  });

  it('schedules an immunization recommendation reminder with ordered channel candidates', async () => {
    const manager = new TaskManager({
      taskService: createTaskService({ defaultChannels: ['telephone'] }),
      tenantsCacheManager: {
        getTenantIdentifierUrn: jest.fn(async () => 'urn:uuid:unid'),
        getTenantDid: jest.fn(async () => 'did:web:unid'),
      } as any,
    });

    const create = await manager.process(job('_batch', [{
      request: { method: 'POST', url: 'Task' },
      resource: { resourceType: 'Task', id: 'rabies-reminder-1m', description: 'Rabies vaccination due', meta: { claims: {
        '@context': 'org.hl7.fhir.api',
        'Task.id': 'rabies-reminder-1m',
        'Task.status': 'requested',
        'Task.for': 'did:web:subject-example',
        'Task.focus': 'ImmunizationRecommendation/rabies-recommendation',
        'Task.scheduled-at': '2027-04-23',
        'Task.channel': 'push,email,sms,whatsapp,telephone',
      } } },
    }]));

    expect((create.body as any).data[0].response.status).toBe('200');
    const response = await manager.process(job('_search', [{ resource: { resourceType: 'Task', meta: { claims: { 'Task.subject': 'did:web:subject-example' } } } }]));
    expect((response.body as any).data[0].resource.meta.claims).toMatchObject({
      'Task.status': 'scheduled',
      'Task.scheduled-at': '2027-04-23T00:00:00.000Z',
      'Task.channel': 'push,email,sms,whatsapp,telephone',
      'Task.focus': 'ImmunizationRecommendation/rabies-recommendation',
    });
  });

  function taskUpdate(status: string) {
    return {
      request: { method: 'PUT' },
      resource: { resourceType: 'Task', id: 'task-1', description: 'Preparar informe firmado', meta: { claims: { '@context': 'org.hl7.fhir.api', 'Task.id': 'task-1', 'Task.subject': 'did:web:subject-example', 'Task.status': status, 'Task.channel': 'web,email,sms', 'controller-email': 'subject-example@example.org', 'subject-phone': '+34600000000' } } },
    };
  }

  function job(action: string, data: any[]) {
    return {
      tenantId: 'unid', jurisdiction: 'ES', sector: 'health-care', section: 'individual', format: 'org.hl7.fhir.api', action,
      content: { thid: `thid-${action}`, aud: 'did:web:client', body: { data } },
    } as any;
  }
});
