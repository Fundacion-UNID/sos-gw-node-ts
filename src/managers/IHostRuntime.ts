// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

/**
 * Minimal host-only runtime context for managers that need a host identifier or
 * a host-owned storage target, but must not resolve or decrypt the host tenant
 * registration.
 *
 * Why this exists:
 * - some managers only need the canonical host DID when issuing offers or
 *   building protocol responses
 * - some managers need the physical host collection name to persist
 *   host-owned records such as communications
 * - giving those managers `TenantsCacheManager` would grant much broader
 *   tenant-registry capability than they should have
 *
 * Who should use this:
 * - domain managers that only require already-derived host scalars
 *
 * Who should not use this:
 * - hosting/bootstrap/discovery/control-plane code that must inspect or mutate
 *   host registration state
 * - code that needs tenant authorization state, DID documents, claims, or any
 *   secret material
 *
 * Security rule:
 * - this interface must stay scalar-only
 * - never add decrypted config, claims objects, credentials, or mutable
 *   registry objects here
 */
export interface IHostRuntime {
  /**
   * Physical storage collection used for host-owned records.
   *
   * This is backend infrastructure data. It is exposed here only to avoid
   * making domain managers resolve tenant registry state themselves.
   */
  hostCollectionName: string;

  /**
   * Canonical `did:web` of the host runtime.
   *
   * Used as issuer/reference data in host-originated protocol flows.
   */
  hostDid: string;
}
