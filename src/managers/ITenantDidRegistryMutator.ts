// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

import type { VerificationMethod } from '../gdc-backend-utils-node/models/did';

/**
 * Narrow mutation capability for the public DID view of a tenant.
 *
 * Why this exists:
 * - child onboarding flows (for example employee key provisioning) sometimes
 *   need to append verification methods under the parent tenant DID view
 * - those flows do not need general tenant lookup, tenant config, collection
 *   names, claims, or any decryption capability
 *
 * Who should use this:
 * - narrowly scoped creation/onboarding flows that must publish newly created
 *   verification methods under a parent tenant DID
 *
 * Who should not use this:
 * - read-only managers
 * - generic domain logic
 * - code that wants to inspect or mutate broader tenant registration data
 *
 * Security rule:
 * - this interface is intentionally write-narrow
 * - do not add methods here for reading tenant config, claims, collection
 *   names, or secrets
 */
export interface ITenantDidRegistryMutator {
  /**
   * Appends a verification method to the in-memory/public DID view of a tenant.
   *
   * Typical caller:
   * - onboarding logic after new child keys have been provisioned
   *
   * Non-goal:
   * - this is not a general tenant-registry update mechanism
   */
  addVerificationMethodToTenant(vaultId: string, verificationMethod: VerificationMethod): void;
}
