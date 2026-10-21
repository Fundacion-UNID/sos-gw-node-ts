// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

import type { DidDocument, DidService } from '../gdc-backend-utils-node/models/did';
import type { Sector } from 'gdc-common-utils-ts/models/urlPath';

/**
 * Tenant-registry contract specifically for public discovery/publication flows.
 *
 * Why this exists:
 * - discovery needs more than the minimal runtime-safe tenant interface
 * - but discovery does not need the whole hosting/control-plane surface either
 * - separating this contract makes the discovery dependency explicit and easier
 *   to audit
 *
 * Typical consumers:
 * - `DiscoveryService`
 * - public discovery routes under `/.well-known/...`
 * - catalog publication endpoints
 *
 * Security posture:
 * - this interface is still privileged compared to `ITenantsManager`
 * - however it should remain scoped to publication/discovery concerns
 * - avoid adding generic lifecycle mutation or unrelated hosting behavior here
 */
export interface IDiscoveryTenantRegistry {
  /** Resolves the physical tenant collection for safe status projections. */
  getCollectionName(vaultId: string): Promise<string | undefined>;
  /**
   * Reads the full tenant registration/configuration object when discovery must
   * expose stored public artifacts or legacy publication metadata.
   */
  getTenant(vaultId: string): Promise<any | undefined>;

  /**
   * Returns the tenant DID document for public resolution.
   */
  getDidDocument(vaultId: string): Promise<DidDocument | undefined>;

  /**
   * Returns published DID service entries for the tenant.
   */
  getDidServiceConfig(vaultId: string): Promise<DidService[] | undefined>;

  /**
   * Returns the public base URL for a tenant.
   */
  getTenantDomainUrl(vaultId: string): Promise<string | undefined>;

  /**
   * Returns the operational API base URL for a tenant.
   */
  getTenantOperationalUrl(vaultId: string): Promise<string | undefined>;

  /**
   * Returns the legacy signing algorithm published for discovery/issuance
   * metadata when present.
   *
   * This is public operational metadata, not a secret, so discovery should not
   * need a full tenant-registration read just to expose it.
   */
  getLegacySignAlg(vaultId: string): Promise<string | undefined>;

  /**
   * Returns all tenants that are currently eligible for autodiscovery.
   */
  listAutodiscoverableTenants(): Promise<any[]>;

  /**
   * Returns the tenant business sector used for discovery gating such as
   * FHIR-only endpoints.
   */
  getTenantSector(vaultId: string): Promise<Sector | undefined>;

  /** Returns the public jurisdiction used to validate and label datasets. */
  getTenantJurisdiction(vaultId: string): Promise<string | undefined>;

  /**
   * Returns whether public discovery/publication is operational for the tenant.
   */
  isTenantOperational(vaultId: string): Promise<boolean>;
}
