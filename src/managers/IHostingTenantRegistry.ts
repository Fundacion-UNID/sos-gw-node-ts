// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

/**
 * Privileged tenant-registry contract for hosting/control-plane flows.
 *
 * Why this exists:
 * - hosting is the part of the system that creates, finalizes, enables,
 *   disables, purges, and publishes tenant registrations
 * - those flows legitimately need broader access than ordinary domain managers
 * - but that privileged access should still be explicit and scoped to hosting,
 *   rather than passing the concrete cache/registry implementation around
 *
 * Typical consumers:
 * - `HostingManager`
 * - `HostingLifecycleService`
 * - `HostingOfferOrderService`
 *
 * Security posture:
 * - this is a privileged control-plane interface
 * - it should never be injected into normal entity/resource managers
 * - it is narrower than the concrete `TenantsCacheManager` type, even though it
 *   still exposes full registration reads and cache refresh
 */
export interface IHostingTenantRegistry {
  /**
   * Lists every protected host registration for host-operator administration.
   * Unlike autodiscovery this includes suspended and non-provider tenants.
   * Callers must project a privacy-minimized response and never return the
   * registry objects directly.
   */
  listRegisteredTenants(): Promise<any[]>;

  /**
   * Reads the full tenant registration/configuration object.
   *
   * Hosting needs this when finalizing or serving lifecycle transitions on a
   * tenant registration.
   */
  getTenant(vaultId: string): Promise<any | undefined>;

  /**
   * Invalidates and reloads the cached tenant registration/configuration.
   */
  refreshTenant(vaultId: string): Promise<any | undefined>;

  /**
   * Resolves the canonical tenant `vaultId` from a business identifier value.
   *
   * Used by hosting lifecycle endpoints that operate on legal identifiers.
   */
  findTenantVaultIdByIdentifierValue(identifierValue: string): Promise<string | undefined>;

  /**
   * Returns every registration for the legal identifier, optionally narrowed
   * to its identifier type and exact hosted sector DID. Lifecycle operations
   * use this contract so sibling sectors are never selected by result order.
   */
  findTenantVaultIdsByIdentifierValue(
    identifierValue: string,
    constraints?: Readonly<{
      identifierType?: string;
      tenantDid?: string;
    }>,
  ): Promise<string[]>;

  /**
   * Returns the physical collection name for a tenant or host vault.
   *
   * Legacy warning:
   * - this still leaks storage topology into hosting logic
   * - it remains here only until collection resolution is pushed down into
   *   infrastructure/repository code
   */
  getCollectionName(vaultId: string): Promise<string | undefined>;

  /**
   * Returns whether the tenant is currently operational according to the
   * cached runtime lifecycle projection.
   *
   * Hosting should use this for lightweight gating decisions before starting
   * tenant-scoped flows that must be rejected when the tenant is disabled.
   */
  isTenantOperational(vaultId: string): Promise<boolean>;
}
