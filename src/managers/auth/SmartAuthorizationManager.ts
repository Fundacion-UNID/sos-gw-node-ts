// src/managers/auth/SmartAuthorizationManager.ts

import { IAuthorizationManager } from './IAuthorizationManager';
import { IAccessTokenClaims } from 'gdc-common-utils-ts/models/auth';

export class SmartAuthorizationManager implements IAuthorizationManager {
  public async canAccess(
    claims: IAccessTokenClaims,
    resource: any,
    action: 'read' | 'write' | 'create' | 'delete',
    consentId?: string,
  ): Promise<boolean> {
    // For now, allow all access.
    return true;
  }
}
