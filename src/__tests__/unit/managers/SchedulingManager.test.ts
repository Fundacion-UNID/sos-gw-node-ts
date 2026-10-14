// Flow contract: clinic scheduling resources are validated claims-first, encrypted and searched only through protected indexed attributes.
import { describe, expect, it, jest } from '@jest/globals';
import { SchedulingManager } from '../../../managers/SchedulingManager';

describe('SchedulingManager', () => {
  it.each([
    ['Location', 'Location.identifier', 'clinic-main'],
    ['Schedule', 'Schedule.identifier', 'vet-one-main'],
    ['Slot', 'Slot.identifier', 'slot-one'],
    ['AppointmentResponse', 'AppointmentResponse.identifier', 'response-one'],
    ['Appointment', 'Appointment.identifier', 'appointment-one'],
  ] as const)('writes and searches %s with protected indexed claims', async (resourceType, identifierClaim, id) => {
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
    const tenantManager = {
      tenantExists: jest.fn(async () => true), getCollectionName: jest.fn(async () => 'tenant-collection'), getTenantJurisdiction: jest.fn(async () => 'ES'),
    } as any;
    const manager = new SchedulingManager({ resourceType, repository, kms, tenantManager });
    const claims = minimumClaims(resourceType, identifierClaim, id);

    const write = await manager.process(job(resourceType, '_batch', { resourceType, id, meta: { claims } }));
    expect((write.body as any).data[0].response.status).toBe('201');
    expect(kms.protectAttributesNameAndValue).toHaveBeenCalled();
    expect(stored.content).toEqual({ claims: expect.any(Object) });
    expect(stored.content).not.toHaveProperty('resource');

    const search = await manager.process(job(resourceType, '_search', { resourceType, id: 'search', meta: { claims: { [identifierClaim]: id } } }));
    expect((search.body as any).data[0].resource).toMatchObject({ resourceType, id });
    expect(kms.protectAttributesNameAndValue).toHaveBeenLastCalledWith(expect.any(Array), 'animal-care_clinic');
  });

  it('rejects nested native FHIR fields and unknown claims before persistence', async () => {
    const put = jest.fn();
    const manager = new SchedulingManager({
      resourceType: 'Slot', repository: { put } as any,
      kms: { protectAttributesNameAndValue: jest.fn(), protectConfidentialData: jest.fn() } as any,
      tenantManager: { tenantExists: async () => true, getCollectionName: async () => 'tenant-collection', getTenantJurisdiction: async () => 'ES' } as any,
    });
    const response = await manager.process(job('Slot', '_batch', { resourceType: 'Slot', id: 'slot-one', status: 'free', meta: { claims: { 'Slot.unknown': 'x' } } }));
    expect((response.body as any).data[0].response.status).toBe('400');
    expect(put).not.toHaveBeenCalled();
  });

  it('accepts the governed Schedule planning horizon claims produced by the shared scheduling graph', async () => {
    const put = jest.fn(async () => true);
    const manager = new SchedulingManager({
      resourceType: 'Schedule', repository: { put } as any,
      kms: {
        protectAttributesNameAndValue: jest.fn(async (attributes: any[]) => attributes),
        protectConfidentialData: jest.fn(async (document: any) => document),
      } as any,
      tenantManager: { tenantExists: async () => true, getCollectionName: async () => 'tenant-collection', getTenantJurisdiction: async () => 'ES' } as any,
    });
    const claims = {
      ...minimumClaims('Schedule', 'Schedule.identifier', 'schedule-one'),
      // The shared scheduling graph projects native planningHorizon into the
      // official Schedule `date` search parameter as start/end dates.
      'Schedule.date': ['2026-10-01', '2026-10-31'],
    };

    const response = await manager.process(job('Schedule', '_batch', { resourceType: 'Schedule', id: 'schedule-one', meta: { claims } }));

    expect((response.body as any).data[0].response.status).toBe('201');
    expect(put).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['Slot', 'Slot.start'],
    ['Appointment', 'Appointment.date'],
  ] as const)('searches %s by one inclusive ge/le date range', async (resourceType, dateClaim) => {
    const stored: any[] = [];
    const repository = {
      put: jest.fn(async (_collection: string, records: any[]) => { stored.push(...records); return true; }),
      listContainersInSection: jest.fn(async () => stored),
    } as any;
    const kms = {
      protectAttributesNameAndValue: jest.fn(async (attributes: any[]) => attributes),
      protectConfidentialData: jest.fn(async (document: any) => document),
      unprotectConfidentialData: jest.fn(async (document: any) => document.content),
    } as any;
    const tenantManager = {
      tenantExists: jest.fn(async () => true), getCollectionName: jest.fn(async () => 'tenant-collection'), getTenantJurisdiction: jest.fn(async () => 'ES'),
    } as any;
    const manager = new SchedulingManager({ resourceType, repository, kms, tenantManager });
    const insideClaims = { ...minimumClaims(resourceType, `${resourceType}.identifier`, `${resourceType.toLowerCase()}-inside`), [dateClaim]: '2026-09-18T16:00:00.000Z' };
    const outsideClaims = { ...minimumClaims(resourceType, `${resourceType}.identifier`, `${resourceType.toLowerCase()}-outside`), [dateClaim]: '2026-10-18T16:00:00.000Z' };
    await manager.process(job(resourceType, '_batch', { resourceType, id: `${resourceType.toLowerCase()}-inside`, meta: { claims: insideClaims } }));
    await manager.process(job(resourceType, '_batch', { resourceType, id: `${resourceType.toLowerCase()}-outside`, meta: { claims: outsideClaims } }));

    const search = await manager.process(job(resourceType, '_search', { resourceType, id: 'search', meta: { claims: {
      [dateClaim]: ['ge2026-09-01T00:00:00.000Z', 'le2026-09-30T23:59:59.999Z'],
    } } }));

    expect((search.body as any).data.map((entry: any) => entry.resource.id)).toEqual([`${resourceType.toLowerCase()}-inside`]);
  });
});

function job(resourceType: string, action: string, resource: any) {
  return { tenantId: 'clinic', jurisdiction: 'ES', sector: 'animal-care', section: 'organization', format: 'org.hl7.fhir.api', action,
    content: { thid: `thid-${resourceType}-${action}`, body: { data: [{ request: { method: 'POST' }, resource }] } } } as any;
}

function minimumClaims(resourceType: string, identifierClaim: string, id: string): Record<string, unknown> {
  const common = { [identifierClaim]: id };
  if (resourceType === 'Location') return { ...common, 'Location.status': 'active', 'Location.name': 'Main room', 'Location.organization': 'Organization/clinic' };
  if (resourceType === 'Schedule') return { ...common, 'Schedule.active': true, 'Schedule.actor': ['Practitioner/vet-one', 'Location/clinic-main'] };
  if (resourceType === 'Slot') return { ...common, 'Slot.status': 'free', 'Slot.schedule': 'Schedule/vet-one-main', 'Slot.start': '2026-09-18T16:00:00.000Z' };
  if (resourceType === 'AppointmentResponse') return { ...common, 'AppointmentResponse.appointment': 'Appointment/appointment-one', 'AppointmentResponse.actor': 'Animal/animal-one', 'AppointmentResponse.part-status': 'accepted', 'AppointmentResponse._lastUpdated': '2026-09-09T18:00:00.000Z' };
  return { ...common, 'Appointment.status': 'booked', 'Appointment.date': '2026-09-18T16:00:00.000Z', 'Appointment.slot': ['Slot/slot-one'], 'Appointment.actor': ['Animal/animal-one', 'Practitioner/vet-one'] };
}
