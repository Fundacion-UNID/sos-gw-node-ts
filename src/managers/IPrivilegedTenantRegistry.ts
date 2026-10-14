// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

import type { DidDocument, DidService } from '../gdc-backend-utils-node/models/did';
import type { Sector } from 'gdc-common-utils-ts/models/urlPath';
import type { TenantAuthorizationLifecycleStatus } from '../utils/tenant-lifecycle';

/**
 * Privileged tenant-registry interface for control-plane and discovery flows.
 *
 * Why this exists:
 * - hosting lifecycle, public discovery, and selected operational routes
 *   legitimately need broader tenant-registry access than normal domain
 *   managers
 * - those flows may need:
 *   - full tenant registration reads
 *   - cache refresh/invalidation
 *   - reverse lookup by `identifier.value`
 *   - discovery catalog enumeration
 *   - hosted/public URL resolution
 *
 * Why this must be separate from `ITenantsManager`:
 * - `ITenantsManager` is the narrow runtime-safe interface meant for ordinary
 *   domain managers
 * - collapsing both use-cases into one interface makes it too easy to inject a
 *   privileged registry into code that should never have it
 *
 * Who should use this:
 * - hosting/control-plane services
 * - discovery/publication services and routes
 * - selected operational adapters that truly need privileged tenant-registry
 *   behavior
 *
 * Who should not use this:
 * - employee/individual/clinical/business-domain managers
 * - code that only needs issuer DID/URN or authorization booleans
 *
 * Security rule:
 * - this interface is privileged on purpose
 * - keep it out of general domain flows
 * - do not widen it casually; any new method should justify why it cannot live
 *   behind `ITenantsManager` or a more specific capability interface
 */
export interface IPrivilegedTenantRegistry {
  /**
   * Reads the full tenant registration/configuration object.
   *
   * Warning:
   * - this is broader than the runtime-safe interfaces
   * - callers must treat the returned object as privileged control-plane data
   */
  getTenant(vaultId: string): Promise<any | undefined>;

  /**
   * Invalidates and reloads the cached tenant registration/configuration.
   */
  refreshTenant(vaultId: string): Promise<any | undefined>;

  /**
   * Resolves the canonical tenant `vaultId` from a business identifier value.
   */
  findTenantVaultIdByIdentifierValue(identifierValue: string): Promise<string | undefined>;

  /**
   * Returns all autodiscoverable tenants for host-level discovery catalogs.
   */
  listAutodiscoverableTenants(): Promise<any[]>;

  /**
   * Returns the public DID document for a tenant.
   */
  getDidDocument(vaultId: string): Promise<DidDocument | undefined>;

  /**
   * Returns the public DID service configuration for a tenant.
   */
  getDidServiceConfig(vaultId: string): Promise<DidService[] | undefined>;

  /**
   * Returns the canonical public domain/base URL for a tenant.
   */
  getTenantDomainUrl(vaultId: string): Promise<string | undefined>;

  /**
   * Returns the operational API base URL for a tenant.
   */
  getTenantOperationalUrl(vaultId: string): Promise<string | undefined>;

  /**
   * Returns the business sector associated with a tenant.
   */
  getTenantSector(vaultId: string): Promise<Sector | undefined>;

  /**
   * Returns the physical collection name for a tenant vault.
   *
   * Legacy warning:
   * - this still leaks storage topology upward
   * - it remains here temporarily for control-plane flows until that concern is
   *   pushed fully into infrastructure
   */
  getCollectionName(vaultId: string): Promise<string | undefined>;

  /**
   * Returns the authorization/publication lifecycle status used by discovery
   * and hosting gates.
   */
  getTenantAuthorizationStatus(vaultId: string): Promise<TenantAuthorizationLifecycleStatus | undefined>;

  /**
   * Convenience boolean derived from authorization lifecycle state.
   */
  isTenantOperational(vaultId: string): Promise<boolean>;
}
