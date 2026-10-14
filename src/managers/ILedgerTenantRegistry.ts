// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

/**
 * Tenant-registry contract for credential-ledger routes.
 *
 * Why this exists:
 * - ledger routes only need to resolve tenant context and jurisdiction
 * - they do not need the wider hosting/discovery/control-plane surface
 *
 * Typical consumers:
 * - `routes/ledger.ts`
 *
 * Security posture:
 * - still operationally privileged because it participates in tenant-context
 *   resolution for ledger routes
 * - keep it small and ledger-specific
 */
export interface ILedgerTenantRegistry {
  /**
   * Cheap existence check by logical tenant `vaultId`.
   *
   * Ledger routing should prefer this when it only needs to know whether a
   * tenant exists, instead of forcing a full tenant-registration read.
   */
  tenantExists(vaultId: string): Promise<boolean>;

  /**
   * Returns the cached tenant jurisdiction used to resolve ledger channel
   * context.
   *
   * This is runtime metadata and should not require loading the full tenant
   * registration/configuration object.
   */
  getTenantJurisdiction(vaultId: string): Promise<string | undefined>;
}
