import { ConnectionChannelRecord } from '../../../types/connection-channel';

// This suite covers only the shipped DTO contract. Persistence, lookup and
// SMART-token materialization are not implemented acceptance criteria here.
describe('Connection Channel record contract', () => {
  it('defines a canonical p2p connection shape with controllerDid + subjectDid', () => {
    const now = new Date().toISOString();
    const record: ConnectionChannelRecord = {
      id: 'f4f98027-6735-4b03-a0f2-8ccb2a7466db',
      subjectDid: 'did:web:api.acme.org:individual:subject-123',
      controllerDid: 'did:web:api.acme.org:individual:parent-controller',
      participants: [
        { did: 'did:web:api.acme.org:individual:parent-controller', role: 'controller', status: 'active' },
        { did: 'did:web:clinic.example.org:employee:doctor-1', role: 'professional', status: 'active' },
      ],
      labelsByParticipant: {
        'did:web:api.acme.org:individual:parent-controller': {
          title: 'Canal salud hijo',
          description: 'Canal principal de seguimiento',
        },
      },
      status: 'active',
      createdAt: now,
      updatedAt: now,
    };

    expect(record.controllerDid).toContain('parent-controller');
    expect(record.subjectDid).toContain('subject-123');
    expect(record.participants.length).toBeGreaterThanOrEqual(2);
  });
});
