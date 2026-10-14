// src/managers/TokenManager.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

import { IKmsService } from '../gdc-backend-utils-node/models/IKmsService';
import { ManagerError } from 'gdc-common-utils-ts/utils/manager-error';
import { IssueType } from 'gdc-common-utils-ts/models/issue';
import type { ITenantsManager } from './ITenantsManager';

/**
 * Manages the business logic for creating and signing system-level tokens,
 * such as the `initial_access_token`. Its sole responsibility is token creation.
 * It does not perform any validation of inputs.
 */
export class TokenManager {
  private kmsService: IKmsService;
  private tenantsCacheManager: ITenantsManager;

  constructor(
    kmsService: IKmsService,
    tenantsCacheManager: ITenantsManager
  ) {
    this.kmsService = kmsService;
    this.tenantsCacheManager = tenantsCacheManager;
  }

  /**
   * Creates a short-lived `initial_access_token` for the DCR flow.
   * @param claims - The claims to include in the token, e.g., `sub`, `jti`, `act_code`.
   * @param lifetimeSeconds - The lifetime of the token in seconds.
   * @returns A promise that resolves to the compact JWT string.
   */
  public async createInitialAccessToken(claims: any, lifetimeSeconds: number): Promise<string> {
    const now = Math.floor(Date.now() / 1000);

    // 1. Get Host DID for the 'iss' claim
    const hostDidDoc = await this.tenantsCacheManager.getDidDocument('host');
    const hostDid = hostDidDoc?.id;
    if (!hostDid) {
        throw new ManagerError('Could not resolve host DID. System not properly configured.', IssueType.Exception);
    }

    // 2. Get Host signing key for the 'kid' in the header
    const hostSignKey = await this.kmsService.getPublicVerificationKey('host', undefined, 'comm_sig');
    if (!hostSignKey || !hostSignKey.kid) {
        throw new ManagerError('Could not resolve host signing key.', IssueType.Exception);
    }

    // 3. Construct the JWT payload (the protected header is produced by the KMS).
    const jwtPayload = {
        ...claims, // Spread the input claims first
        iss: hostDid,
        aud: 'urn:gateway:dcr',
        exp: now + lifetimeSeconds,
        nbf: now,
        scope: 'dcr:register',
    };

    // Must be a standard compact JWS (HEADER.PAYLOAD.SIGNATURE) so the verifier can validate it.
    return this.kmsService.createCompactJws(jwtPayload, hostSignKey.kid, 'host', 'comm_sig');
  }
}
