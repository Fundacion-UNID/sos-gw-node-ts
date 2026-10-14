// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.
// File: src/managers/ITenantsManager.ts

import { DidDocument, DidService } from "../gdc-backend-utils-node/models/did";
import { TenantAuthorizationLifecycleStatus } from '../utils/tenant-lifecycle';

/**
 * Read-only runtime resolver for non-sensitive tenant metadata.
 *
 * Why this exists:
 * - many runtime flows need only a small amount of tenant-derived information
 *   such as DID, URN, service endpoints, or authorization state
 * - those flows must not receive the full tenant registration object or any
 *   capability that could decrypt it
 *
 * What this interface is for:
 * - resolve already-derived, non-secret runtime metadata by logical `vaultId`
 * - support routing, issuer composition, and publication gating
 *
 * What this interface is not for:
 * - exposing raw tenant claims/config
 * - exposing database credentials, KMS material, seeds, or any future secrets
 * - serving as a write API for tenant registry mutation
 *
 * Who should use this:
 * - domain/runtime managers that need only safe derived metadata
 *
 * Who should not use this:
 * - code that must load or mutate full tenant registration records; that
 *   belongs in hosting/discovery/control-plane specific services with explicit
 *   privileged interfaces
 *
 * Cache policy:
 * - callers should assume this interface is backed by an in-memory runtime
 *   cache populated on first access
 * - ordinary reads should be served from cache after the first load
 * - writes must never treat the cache as the source of truth; privileged write
 *   flows must persist to storage first, then refresh or invalidate cache
 * - callers must not assume tenant metadata is immutable during process
 *   lifetime: lifecycle transitions and DID updates can change it
 */
export interface ITenantsManager {
  /**
   * Cheap existence check by logical tenant `vaultId`.
   *
   * Intended for routing/validation guards, not for reading tenant payload.
   *
   * Runtime expectation:
   * - first call may trigger a storage-backed cache fill
   * - subsequent calls should normally be served from cache
   */
  tenantExists(vaultId: string): Promise<boolean>;

  /**
   * Returns the physical collection name for a tenant vault.
   *
   * Legacy warning:
   * - this leaks storage topology into callers
   * - long term this should move behind the repository/infra boundary instead
   *   of being consumed by domain managers
   */
  getCollectionName(vaultId: string): Promise<string | undefined>;
  
  /**
   * Returns the public DID document currently associated with the tenant.
   */
  getDidDocument(vaultId: string): Promise<DidDocument | undefined>;

  /**
   * Returns only the DID identifier string of the tenant.
   */
  getTenantDid(vaultId: string): Promise<string | undefined>;

  /** Returns the ISO 3166-1 or ISO 3166-2 jurisdiction governing the tenant route. */
  getTenantJurisdiction(vaultId: string): Promise<string | undefined>;

  /**
   * Retrieves a tenant's service configurations from the cache by its internal vaultId.
   * @param vaultId The internal vaultId of the tenant.
   * @returns An array of DidService configurations or undefined if not found.
   */
  getDidServiceConfig(vaultId: string): Promise<DidService[] | undefined>;
  
  /**
   * Retrieves a tenant's sovereign URN from the cache by its internal vaultId.
   * @param vaultId The internal vaultId of the tenant (e.g., 'health-care.tenant-1').
   * @returns The URN string or undefined if not found.
   */
  getTenantIdentifierUrn(vaultId: string): Promise<string | undefined>;

  /**
   * Returns the canonical official legal-organization identifier used by
   * organization-scoped ledger assets, for example `urn:org:tax:<VAT>`.
   */
  getOrganizationIdentifierUrn(vaultId: string): Promise<string | undefined>;

  /**
   * Returns the authorization/publication lifecycle status used by discovery
   * and operational gating.
   *
   * This value should come from cached runtime metadata after the initial load;
   * consumers should not need to re-read or decrypt tenant registration
   * content just to know whether a tenant is enabled or disabled.
   */
  getTenantAuthorizationStatus(vaultId: string): Promise<TenantAuthorizationLifecycleStatus | undefined>;

  /**
   * Convenience boolean derived from authorization lifecycle state.
   */
  isTenantOperational(vaultId: string): Promise<boolean>;
  
}
