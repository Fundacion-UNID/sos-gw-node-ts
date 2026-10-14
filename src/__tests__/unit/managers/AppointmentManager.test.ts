// Flow contract: 1) a human Appointment in the individual profile requires one explicit subject; 2) POST and PUT persist encrypted flat claims in only that subject section; 3) search never enumerates another subject section. Authorization invariant: selecting a subject does not grant access. Persistence invariant: native FHIR fields are never stored as canonical business state.
import { describe, expect, it, jest } from '@jest/globals';
import { SchedulingManager } from '../../../managers/SchedulingManager';

const HUMAN_SUBJECT = 'Patient/patricia-doe';
const APPOINTMENT_ID = 'appointment-human-one';

describe('SchedulingManager human Appointment profile', () => {
  it('creates, edits and reads one subject appointment from its protected section', async () => {
    let stored: any;
    const repository = {
      put: jest.fn(async (_collection: string, records: any[]) => { stored = records[0]; return true; }),
      listContainersInSection: jest.fn(async () => stored ? [stored] : []),
    } as any;
    const kms = {
      protectAttributesNameAndValue: jest.fn(async (attributes: any[]) => attributes),
      protectConfidentialData: jest.fn(async (document: any) => document),
      unprotectConfidentialData: jest.fn(async (document: any) => document.content),
    } as any;
    const manager = new SchedulingManager({
      resourceType: 'Appointment', repository, kms,
      tenantManager: {
        tenantExists: async () => true,
        getCollectionName: async () => 'health-care-unid',
        getTenantJurisdiction: async () => 'ES',
      },
    });

    const created = await manager.process(job('_batch', 'POST', claims('2026-08-01T10:00:00.000Z')));
    expect((created.body as any).data[0].response.status).toBe('201');
    expect(stored.content).toEqual({ claims: expect.any(Object) });
    expect(stored.content).not.toHaveProperty('resource');

    await manager.process(job('_batch', 'PUT', claims('2026-08-01T11:30:00.000Z')));
    expect(stored.content.claims['Appointment.date']).toEqual(['2026-08-01T11:30:00.000Z']);

    const result = await manager.process(job('_search', 'POST', {
      'Appointment.subject': HUMAN_SUBJECT,
    }));
    expect((result.body as any).total).toBe(1);
    expect((result.body as any).data[0].resource.id).toBe(APPOINTMENT_ID);
    expect(repository.listContainersInSection).toHaveBeenCalledWith(
      'health-care-unid',
      expect.stringMatching(/individual_appointments_/u),
    );
  });

  it('rejects an individual appointment without an explicit subject before persistence', async () => {
    const put = jest.fn();
    const manager = new SchedulingManager({
      resourceType: 'Appointment', repository: { put } as any,
      kms: { protectAttributesNameAndValue: jest.fn(), protectConfidentialData: jest.fn() } as any,
      tenantManager: {
        tenantExists: async () => true,
        getCollectionName: async () => 'health-care-unid',
        getTenantJurisdiction: async () => 'ES',
      },
    });

    const response = await manager.process(job('_batch', 'POST', {
      'Appointment.identifier': APPOINTMENT_ID,
      'Appointment.status': 'booked',
      'Appointment.actor': HUMAN_SUBJECT,
      'Appointment.date': '2026-08-01T10:00:00.000Z',
    }));
    expect((response.body as any).data[0].response.status).toBe('400');
    expect(put).not.toHaveBeenCalled();
  });
});

function claims(date: string): Record<string, unknown> {
  return {
    'Appointment.identifier': APPOINTMENT_ID,
    'Appointment.subject': HUMAN_SUBJECT,
    'Appointment.status': 'booked',
    'Appointment.actor': HUMAN_SUBJECT,
    'Appointment.date': date,
    'Appointment.location': 'Location/human-clinic',
  };
}

function job(action: string, method: string, flatClaims: Record<string, unknown>) {
  return {
    tenantId: 'unid', jurisdiction: 'ES', sector: 'health-care', section: 'individual',
    format: 'org.hl7.fhir.api', action,
    content: { thid: `human-appointment-${action}`, body: { data: [{
      request: { method },
      resource: {
        resourceType: 'Appointment',
        id: action === '_search' ? 'search' : APPOINTMENT_ID,
        meta: { claims: { '@context': 'org.hl7.fhir.api', ...flatClaims } },
      },
    }] } },
  } as any;
}
