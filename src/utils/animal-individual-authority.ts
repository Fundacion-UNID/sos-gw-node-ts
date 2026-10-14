export type AnimalIndividualAction = 'read' | 'create' | 'update';

export type AnimalIndividualActor = Readonly<{
  kind: 'individual-controller' | 'organization-employee' | 'organization-member' | 'veterinarian';
  id: string;
  organizationId?: string;
}>;

export type AnimalIndividualController = Readonly<{
  /** Natural-person individual or legal organization that controls the animal subject. */
  kind: 'individual' | 'organization';
  id: string;
}>;

export type OrganizationControllerDelegation = Readonly<{
  controllerId: string;
  actorId: string;
  authority: 'controller';
  status: 'active' | 'suspended' | 'revoked';
}>;

export type AnimalSubjectGrant = Readonly<{
  subjectId: string;
  controllerId: string;
  granteeId: string;
  actions: readonly AnimalIndividualAction[];
  purposes: readonly string[];
  status: 'active' | 'suspended' | 'revoked';
  expiresAt?: string;
}>;

export type AnimalIndividualAuthorizationDecision =
  | Readonly<{ authorized: true; basis: 'direct-individual-controller' | 'organization-controller-delegation' | 'explicit-subject-grant' }>
  | Readonly<{ authorized: false; reason: 'explicit-subject-grant-required' }>;

/**
 * Authorizes one action against an animal, modeled canonically as an
 * `individual` subject.
 *
 * The controller relationship is subject-specific. A natural-person
 * controller acts directly. A legal organization (for example a municipality
 * responsible for a stray animal) acts only through an employee with an active
 * controller delegation. Employment, membership, shelter collaboration or a
 * veterinary role never grants access by itself: those actors need an active,
 * unexpired grant matching the exact animal, controller, action and purpose.
 *
 * This policy evaluates authority only. Persistence must still bind the
 * verified actor DID, controller relationship and grant evidence loaded from
 * protected records; browser role labels are not valid inputs.
 */
export function authorizeAnimalIndividualAction(input: Readonly<{
  subject: Readonly<{ kind: 'individual'; id: string }>;
  controller: AnimalIndividualController;
  actor: AnimalIndividualActor;
  delegation?: OrganizationControllerDelegation;
  grant?: AnimalSubjectGrant;
  action: AnimalIndividualAction;
  purpose: string;
  now: string;
}>): AnimalIndividualAuthorizationDecision {
  if (
    input.controller.kind === 'individual'
    && input.actor.kind === 'individual-controller'
    && input.actor.id === input.controller.id
  ) {
    return { authorized: true, basis: 'direct-individual-controller' };
  }

  const delegation = input.delegation;
  if (
    input.controller.kind === 'organization'
    && input.actor.kind === 'organization-employee'
    && input.actor.organizationId === input.controller.id
    && delegation?.status === 'active'
    && delegation.authority === 'controller'
    && delegation.controllerId === input.controller.id
    && delegation.actorId === input.actor.id
  ) {
    return { authorized: true, basis: 'organization-controller-delegation' };
  }

  const grant = input.grant;
  const expiresAt = grant?.expiresAt ? Date.parse(grant.expiresAt) : undefined;
  const now = Date.parse(input.now);
  const grantIsCurrent = expiresAt === undefined
    || (Number.isFinite(expiresAt) && Number.isFinite(now) && expiresAt > now);
  if (
    grant?.status === 'active'
    && grant.subjectId === input.subject.id
    && grant.controllerId === input.controller.id
    && grant.granteeId === input.actor.id
    && grant.actions.includes(input.action)
    && grant.purposes.includes(input.purpose)
    && grantIsCurrent
  ) {
    return { authorized: true, basis: 'explicit-subject-grant' };
  }

  return { authorized: false, reason: 'explicit-subject-grant-required' };
}
