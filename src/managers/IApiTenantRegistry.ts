// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

import type { DidService } from '../gdc-backend-utils-node/models/did';
import type { TenantAuthorizationLifecycleStatus } from '../utils/tenant-lifecycle';

/**
 * Tenant-registry contract for the main API router.
 *
 * Why this exists:
 * - `api.ts` mixes request routing, secure sender resolution, bearer-gated
 *   issuance, and tenant authorization checks
 * - it needs more than the narrow runtime interfaces, but less than a generic
 *   privileged registry surface
 * - making this contract explicit keeps the routing dependency auditable and
 *   avoids leaking the concrete registry/cache implementation everywhere
 *
 * Typical consumers:
 * - the dynamic API router in `routes/api.ts`
 *
 * Security posture:
 * - this is operationally privileged
 * - do not inject it into normal domain managers
 * - avoid adding unrelated hosting/discovery behavior here
 */
export interface IApiTenantRegistry {
  /**
   * Cheap existence check by logical tenant `vaultId`.
   *
   * API routing should use this when it only needs to know whether a tenant is
   * registered, instead of forcing a full tenant-registration read.
   */
  tenantExists(vaultId: string): Promise<boolean>;

  /**
   * Reads the full tenant registration/configuration object.
   *
   * Used in API routing for authorization-state checks and selected issuance
   * flows that still depend on stored public tenant artifacts.
   */
  getTenant(vaultId: string): Promise<any | undefined>;

  /**
   * Resolves the canonical tenant `vaultId` from a business identifier value.
   */
  findTenantVaultIdByIdentifierValue(identifierValue: string): Promise<string | undefined>;

  /**
   * Returns the physical collection name for a tenant vault.
   *
   * Legacy warning:
   * - this still leaks storage topology into the router
   * - it remains here until sender resolution and vault location are pushed
   *   fully behind infrastructure/repository services
   */
  getCollectionName(vaultId: string): Promise<string | undefined>;

  /**
   * Returns the published DID service configuration used for path validation.
   */
  getDidServiceConfig(vaultId: string): Promise<DidService[] | undefined>;

  /**
   * Returns the public tenant domain/base URL.
   */
  getTenantDomainUrl(vaultId: string): Promise<string | undefined>;

  /**
   * Returns the cached authorization/publication lifecycle status for the
   * tenant.
   *
   * Routing gates should prefer this over full tenant reads when they only
   * need to decide whether the tenant is active.
   */
  getTenantAuthorizationStatus(vaultId: string): Promise<TenantAuthorizationLifecycleStatus | undefined>;
}
