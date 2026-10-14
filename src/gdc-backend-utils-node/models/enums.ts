// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.
// File: src/models/enums.ts

/**
 * Defines the lifecycle status of an entity record within the gateway.
 */
export enum EntityLifecycleStatus {
  Pending = 'pending',
  Active = 'active',
  Inactive = 'inactive',
  EnteredInError = 'entered-in-error',
}

/**
 * Defines the status of an organization's access to a specific network.
 */
export enum NetworkAccessStatus {
  PendingVerification = 'pending_verification',
  Active = 'active',
  Revoked = 'revoked',
}

/**
 * Defines the known entity types, used for type discrimination.
 */
export enum EntityType {
  Organization = 'Organization',
  Person = 'Person',
  Practitioner = 'Practitioner',
  Service = 'Service',
}

/**
 * Defines the identifiers for known networks.
 * While the data model allows for any string for future-proofing, this enum should be
 * used in the implementation code to ensure consistency.
 */
export enum NetworkName {
  Test = 'test',
  TestNetwork = 'test-network',
  Production = 'production',
}

/**
 * Defines the canonical `type` strings for Bundle entries, representing specific business actions.
 */
export enum BundleEntryType {
  // Hosting & Registration
  OrgRegistrationForm = 'Organization-registration-form-v1.0',
  OrgRegistrationOffer = 'Organization-registration-offer-v1.0',
  OrgOrderRequest = 'Organization-order-request-v1.0',

  // Add other entry types here as they are defined...
}
