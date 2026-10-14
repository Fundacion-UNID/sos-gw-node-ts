import { authorizeAnimalIndividualAction } from '../../../utils/animal-individual-authority';

/**
 * VetChain authority contract: the animal is the individual subject. A
 * natural person or an organization controls that subject; organizations act
 * through explicitly authorized employees, while collaborators and veterinary
 * professionals require an exact invitation/grant for the animal and action.
 */
describe('animal individual authority', () => {
  const subjectId = 'did:web:vet.example:individual:animal-001';
  const municipalityId = 'did:web:vet.example:organization:municipality-001';
  const now = '2026-08-25T18:00:00.000Z';

  it('allows a natural-person controller to add data to its exact animal individual', () => {
    expect(authorizeAnimalIndividualAction({
      subject: { kind: 'individual', id: subjectId },
      controller: { kind: 'individual', id: 'did:web:vet.example:individual:controller-001' },
      actor: { kind: 'individual-controller', id: 'did:web:vet.example:individual:controller-001' },
      action: 'create',
      purpose: 'animal-care',
      now,
    })).toEqual({ authorized: true, basis: 'direct-individual-controller' });
  });

  it('allows an authorized municipal employee to act for the organization controller', () => {
    expect(authorizeAnimalIndividualAction({
      subject: { kind: 'individual', id: subjectId },
      controller: { kind: 'organization', id: municipalityId },
      actor: { kind: 'organization-employee', id: 'did:web:vet.example:employee:controller-001', organizationId: municipalityId },
      delegation: {
        controllerId: municipalityId,
        actorId: 'did:web:vet.example:employee:controller-001',
        authority: 'controller',
        status: 'active',
      },
      action: 'create',
      purpose: 'animal-welfare',
      now,
    })).toEqual({ authorized: true, basis: 'organization-controller-delegation' });
  });

  it('rejects an employee whose employment is not an active controller delegation', () => {
    expect(authorizeAnimalIndividualAction({
      subject: { kind: 'individual', id: subjectId },
      controller: { kind: 'organization', id: municipalityId },
      actor: { kind: 'organization-employee', id: 'did:web:vet.example:employee:member-001', organizationId: municipalityId },
      action: 'create',
      purpose: 'animal-welfare',
      now,
    })).toEqual({ authorized: false, reason: 'explicit-subject-grant-required' });
  });

  it.each([
    ['organization-member', 'did:web:vet.example:member:shelter-collaborator-001'],
    ['veterinarian', 'did:web:vet.example:professional:veterinarian-001'],
  ] as const)('allows an invited %s only through an exact active subject grant', (kind, actorId) => {
    expect(authorizeAnimalIndividualAction({
      subject: { kind: 'individual', id: subjectId },
      controller: { kind: 'organization', id: municipalityId },
      actor: { kind, id: actorId, organizationId: municipalityId },
      grant: {
        subjectId,
        controllerId: municipalityId,
        granteeId: actorId,
        actions: ['read', 'create'],
        purposes: ['animal-care', 'animal-welfare'],
        status: 'active',
        expiresAt: '2026-09-25T18:00:00.000Z',
      },
      action: 'create',
      purpose: 'animal-care',
      now,
    })).toEqual({ authorized: true, basis: 'explicit-subject-grant' });
  });

  it('does not treat the veterinarian role as authority without an invitation', () => {
    expect(authorizeAnimalIndividualAction({
      subject: { kind: 'individual', id: subjectId },
      controller: { kind: 'organization', id: municipalityId },
      actor: { kind: 'veterinarian', id: 'did:web:vet.example:professional:veterinarian-002' },
      action: 'create',
      purpose: 'animal-care',
      now,
    })).toEqual({ authorized: false, reason: 'explicit-subject-grant-required' });
  });

  it.each([
    ['wrong animal', { subjectId: 'did:web:vet.example:individual:animal-999', actions: ['create'], purposes: ['animal-care'], status: 'active' }],
    ['wrong action', { subjectId, actions: ['read'], purposes: ['animal-care'], status: 'active' }],
    ['wrong purpose', { subjectId, actions: ['create'], purposes: ['animal-research'], status: 'active' }],
    ['expired grant', { subjectId, actions: ['create'], purposes: ['animal-care'], status: 'active', expiresAt: '2026-08-24T18:00:00.000Z' }],
  ] as const)('rejects an invited actor with %s', (_label, partialGrant) => {
    const actorId = 'did:web:vet.example:member:collaborator-002';
    expect(authorizeAnimalIndividualAction({
      subject: { kind: 'individual', id: subjectId },
      controller: { kind: 'organization', id: municipalityId },
      actor: { kind: 'organization-member', id: actorId, organizationId: municipalityId },
      grant: {
        controllerId: municipalityId,
        granteeId: actorId,
        ...partialGrant,
      },
      action: 'create',
      purpose: 'animal-care',
      now,
    })).toEqual({ authorized: false, reason: 'explicit-subject-grant-required' });
  });
});
