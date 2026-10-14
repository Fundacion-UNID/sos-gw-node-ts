// Copyright 2026 Conéctate Soluciones y Aplicaciones SL under the Apache License, Version 2.0.

/** GW-specific claim keys that are not part of the shared resource vocabularies. */
export const GatewayClaim = Object.freeze({
  FamilyRegistrationStatus: 'org.schema.FamilyRegistration.status',
  FamilyRegistrationMissingFields: 'org.schema.FamilyRegistration.missingFields',
  FamilyRegistrationResultCount: 'org.schema.FamilyRegistration.resultCount',
  OrganizationDid: 'org.schema.Organization.did',
  ActivationNetworkMode: 'org.schema.Action.activation.networkMode',
  ActivationRevocationChecked: 'org.schema.Action.activation.revocationChecked',
  ActivationOnChainChecked: 'org.schema.Action.activation.onChainChecked',
  ClearingHouseAcr: 'org.schema.Action.clearingHouse.acr',
  ClearingHouseLedgerVerified: 'org.schema.Action.clearingHouse.ledgerVerified',
  TenantAuthorizationStatus: 'org.schema.Action.tenantAuthorization.status',
  TenantAuthorizationChangedBy: 'org.schema.Action.tenantAuthorization.changedBy',
  TenantAuthorizationLifecycleDisposition: 'org.schema.Action.tenantAuthorization.lifecycleDisposition',
  MessagingId: 'id',
  MessagingCount: 'count',
} as const);

/** Vet product values that distinguish an animal Individual Organization. */
export const AnimalIndividualRegistration = Object.freeze({
  SubjectKind: 'animal',
  SelfRole: 'ONESELF',
} as const);

export const FamilyRegistrationStatus = Object.freeze({
  DraftSaved: 'draft_saved',
  DraftDeleted: 'draft_deleted',
  Created: 'new_created',
  Existing: 'already_exists',
  ResumeRequired: 'resume_required',
  NotFound: 'not_found',
  Disabled: 'disabled',
  Purged: 'purged',
} as const);
