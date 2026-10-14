// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.
// File: src/managers/auth/IAuthorizationManager.ts

import { IAccessTokenClaims } from 'gdc-common-utils-ts/models/auth';
import { BundleEntry } from 'gdc-common-utils-ts/models/bundle';

/**
 * Defines the contract for the Authorization Manager.
 * This service is responsible for making fine-grained access control decisions.
 */
export interface IAuthorizationManager {
  /**
   * Checks if the requester is permitted to perform the requested action on a resource.
   * @param claims The claims from the access token.
   * @param resource The target resource.
   * @param action The action being performed (e.g., 'create', 'read').
   * @param consentId Optional specific consent ID to check against.
   * @returns A Promise resolving to `true` if permitted, `false` otherwise.
   */
  canAccess(
    claims: IAccessTokenClaims,
    resource: BundleEntry,
    action: string,
    consentId?: string,
  ): Promise<boolean>;
}
