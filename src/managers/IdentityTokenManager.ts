// src/managers/IdentityTokenManager.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

import { randomUUID } from 'crypto';
import { IJobProcessor } from './registry';
import { JobRequest } from 'gdc-common-utils-ts/models/confidential-job';
import { IDecodedDidcommPayload } from 'gdc-common-utils-ts/models/confidential-message';
import { ManagerError } from 'gdc-common-utils-ts/utils/manager-error';
import { IssueType } from 'gdc-common-utils-ts/models/issue';
import { AppAuthorizationManager } from './AppAuthorizationManager';
import { TokenManager } from './TokenManager';
import { federateOidcIdTokenToFirebaseCustomToken } from '../auth/OidcFederationService';
import { IdentityAuthRequestFields } from 'gdc-common-utils-ts/constants/identity-auth';

type TokenExchangeBody = {
  [IdentityAuthRequestFields.SubjectToken]?: string;
  [IdentityAuthRequestFields.EmployeeAuthorizationUrn]?: string;
  [IdentityAuthRequestFields.ClientInstanceId]?: string;
};

type EmployeeRecoveryBody = {
  client_instance_id?: string;
};

type FirebaseCustomTokenBody = {
  provider?: string;
  id_token?: string;
};

/**
 * Owns activation-code exchange for modern controller/employee devices.
 *
 * `_exchange` deliberately calls `verifyIdToken`, not the broader
 * controller-route Bearer verifier: a controller VP proves role authority but
 * does not prove the account/email binding consumed with the activation code.
 * The historical representative already bound by legacy Organization
 * `_activate` does not enter this exchange/DCR continuation for that same key.
 */
export class IdentityTokenManager implements IJobProcessor {
  constructor(
    private readonly appAuthManager: AppAuthorizationManager,
    private readonly tokenManager: TokenManager,
  ) {}

  public async process(job: JobRequest): Promise<IDecodedDidcommPayload> {
    const thid = job.content?.thid;
    if (!thid) throw new ManagerError('Missing thid.', IssueType.Required);

    const action = String(job.action || '').trim();
    if (!action) {
      throw new ManagerError('Missing action.', IssueType.Required);
    }
    if (action === '_exchange') return this.processInitialAccessTokenExchange(job);
    if (action === '_recover') return this.processEmployeeWalletRecovery(job);
    if (action === '_custom') return this.processFirebaseCustomToken(job);

    throw new ManagerError(`Unsupported action for Token: ${action}`, IssueType.NotSupported);
  }

  /** Issues a replacement credential only after a fresh marked email-OTP login. */
  private async processEmployeeWalletRecovery(job: JobRequest): Promise<IDecodedDidcommPayload> {
    const thid = job.content!.thid!;
    const bearer = (job.content as any)?.meta?.bearer?.token as string | undefined;
    const idToken = bearer?.startsWith('Bearer ') ? bearer.slice('Bearer '.length) : undefined;
    if (!idToken) throw new ManagerError('Missing Bearer token.', IssueType.Security);

    const verificationResult = await this.appAuthManager.verifyIdToken(idToken);
    const payload = (verificationResult.payload || {}) as any;
    const email = String(payload.email || '').trim();
    const authTime = Number(payload.auth_time);
    const now = Math.floor(Date.now() / 1000);
    if (!payload.sub
      || !email
      || payload.email_verified !== true
      || payload.professional_auth_method !== 'email_otp'
      || !Number.isFinite(authTime)
      || authTime > now + 30
      || now - authTime > 300) {
      throw new ManagerError('Recovery requires a fresh verified email OTP session.', IssueType.Security);
    }
    const tenantId = String(job.tenantId || '').trim();
    const sector = String(job.sector || '').trim();
    if (!tenantId || !sector) throw new ManagerError('Recovery route scope is incomplete.', IssueType.Required);
    const body = (job.content?.body || {}) as EmployeeRecoveryBody;
    const clientInstanceId = String(body.client_instance_id || '').trim();
    if (!clientInstanceId) throw new ManagerError('Missing client_instance_id.', IssueType.Required);

    const rotated = await this.appAuthManager.rotateEmployeeActivationCodeForOwnedDevice(
      tenantId,
      sector,
      { subject: payload.sub, email, emailVerified: true },
      clientInstanceId,
    );
    return {
      jti: job.content?.jti || thid,
      thid,
      iss: job.content?.aud as string,
      aud: job.content?.iss as string,
      type: 'application/json',
      body: {
        activation_code: rotated.activationCode,
        license_id: rotated.licenseId,
        employee_role: rotated.employeeRole,
        employee_same_as: rotated.employeeActorIdentifier,
      },
    };
  }

  private async processInitialAccessTokenExchange(job: JobRequest): Promise<IDecodedDidcommPayload> {
    const thid = job.content!.thid!;

    const bearer = (job.content as any)?.meta?.bearer?.token as string | undefined;
    const idToken = bearer?.startsWith('Bearer ') ? bearer.slice('Bearer '.length) : undefined;
    if (!idToken) {
      throw new ManagerError('Missing Bearer token.', IssueType.Security);
    }

    const verificationResult = await this.appAuthManager.verifyIdToken(idToken);
    const {
      sub: userId,
      tenant_id: tenantIdFromToken,
      email,
      email_verified: emailVerified,
      phone_number: phone,
    } = (verificationResult.payload || {}) as any;
    if (!userId) {
      throw new ManagerError('Missing sub claim in id_token.', IssueType.Security);
    }
    const routedTenantId = String(job.tenantId || '').trim();
    if (!routedTenantId) {
      throw new ManagerError('Missing routed tenant for token exchange.', IssueType.BusinessRule);
    }
    if (tenantIdFromToken && tenantIdFromToken !== routedTenantId) {
      throw new ManagerError('tenant_id claim does not match the route tenant.', IssueType.Forbidden);
    }

    // Personal Firebase identities are not tenant accounts and therefore do
    // not carry a tenant_id custom claim. The canonical identity route already
    // names the target tenant; the activation code is then verified inside that
    // exact tenant vault before any token is issued. Organization tokens may
    // still carry tenant_id, in which case the equality check above is strict.
    const tenantId = routedTenantId;

    const body = (job.content?.body || {}) as TokenExchangeBody;
    const actor = { subject: userId, email, emailVerified, phone };
    const employeeAuthorizationUrn = body[IdentityAuthRequestFields.EmployeeAuthorizationUrn];
    const activationCode = body[IdentityAuthRequestFields.SubjectToken] || (employeeAuthorizationUrn
      ? await this.appAuthManager.resolveEmployeeActivationCode(
        employeeAuthorizationUrn,
        tenantId,
        job.jurisdiction as string,
        job.sector as string,
        actor,
      )
      : undefined);
    if (!activationCode) throw new ManagerError(
      'Token exchange requires subject_token or employee_authorization_urn.',
      IssueType.Value,
    );

    await this.appAuthManager.verifyAndConsumeActivationCode(
      activationCode,
      tenantId,
      job.sector as string,
      actor,
      body[IdentityAuthRequestFields.ClientInstanceId],
    );

    const tokenLifetime = 60;
    const claims = {
      sub: userId,
      jti: randomUUID(),
      act_code: activationCode,
      tenant_id: tenantId,
      scope: 'dcr:register',
    };
    const accessToken = await this.tokenManager.createInitialAccessToken(claims, tokenLifetime);

    return {
      jti: job.content?.jti || thid,
      thid,
      iss: job.content?.aud as string,
      aud: job.content?.iss as string,
      type: 'application/json',
      body: {
        initial_access_token: accessToken,
        token_type: 'Bearer',
        expires_in: tokenLifetime,
        scope: 'dcr:register',
      },
    };
  }

  private async processFirebaseCustomToken(job: JobRequest): Promise<IDecodedDidcommPayload> {
    const thid = job.content!.thid!;
    const body = (job.content?.body || {}) as FirebaseCustomTokenBody;
    const provider = body.provider;
    const idToken = body.id_token;
    if (provider !== 'eidas') {
      throw new ManagerError('Unsupported provider. Expected "eidas".', IssueType.Value);
    }
    if (!idToken || typeof idToken !== 'string') {
      throw new ManagerError('Missing id_token in request body.', IssueType.Value);
    }

    const result = await federateOidcIdTokenToFirebaseCustomToken({ provider, idToken });

    return {
      jti: job.content?.jti || thid,
      thid,
      iss: job.content?.aud as string,
      aud: job.content?.iss as string,
      type: 'application/json',
      body: {
        firebase_custom_token: result.firebaseCustomToken,
        provider: result.provider,
        subject: result.subject,
        ...(result.email ? { email: result.email } : {}),
      },
    };
  }
}
