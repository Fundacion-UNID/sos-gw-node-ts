// src/managers/AppAuthorizationManager.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

import { IVaultRepository } from '../database/repositories/vault/vault.repository';
import { ITokenVerifier, VerificationResult } from '../auth/ITokenVerifier';
import { IKmsService } from '../gdc-backend-utils-node/models/IKmsService';
import { ICryptography } from 'gdc-common-utils-ts/interfaces/ICryptography';
import { ManagerError } from 'gdc-common-utils-ts/utils/manager-error';
import { IssueType } from 'gdc-common-utils-ts/models/issue';
import { DeviceLicense } from 'gdc-common-utils-ts/models/device-license';
import { ConfidentialStorageDoc } from 'gdc-common-utils-ts/models/confidential-storage';
import { getTenantVaultId } from '../utils/tenant';
import { Content } from 'gdc-common-utils-ts/utils/content';
import { getEnvSectionId } from '../utils/section-env';
import { compactVerify, decodeProtectedHeader, importJWK, type JWK } from 'jose';
import { normalizeSameAsHash, normalizeTelephoneHash } from 'gdc-common-utils-ts/utils/same-as';
import { normalizeIndexedEmail, normalizeIndexedPhone } from '../utils/indexed-contact';
import { DEFAULT_LICENSE_DEVICE_ALLOWANCE } from '../constants/domain';
import { EntityConfig } from '../gdc-backend-utils-node/models/entity';
import { decodeMultibase58btcToUUID } from 'gdc-common-utils-ts/utils/multibase58';
import { normalizeCodeSystemAndValue } from '../utils/normalize-codeAndSystem';
import { randomBytes } from 'node:crypto';
import {
  LICENSE_STATUS_ACTIVE,
  LICENSE_USER_CLASS_EMPLOYEE,
} from '../constants/domain';
import {
  openDeviceLicenseDocument,
  prepareDeviceLicenseDocumentForWrite,
} from '../utils/device-license-storage';

const HOST_BOOTSTRAP_CONTROLLER_LIFECYCLE_ROLE = 'host-bootstrap-controller';

export type ControllerProofRegistrationContext = Readonly<{
  vaultId: string;
  collectionName?: string;
}>;

export type BearerVerificationOptions = Readonly<{
  /** Accept a SMART token signed by the exact tenant named by registrationContext. */
  acceptSmartAccessToken?: boolean;
}>;

type ActivationActor = Readonly<{
  subject: string;
  email?: string;
  emailVerified?: boolean;
  phone?: string;
}>;

const PORTABLE_EMPLOYEE_AUTHORIZATION_URN_PATTERN =
  /^urn:cds-([a-z]{2}(?:-[a-z0-9]{2,3})?):v[1-9][0-9]*:organization:[a-z][a-z0-9-]*:([^:]+):member:(z[1-9A-HJ-NP-Za-km-z]+):([0-9]+)$/;

/**
 * Manages application-specific authorization logic, such as validating tokens and codes.
 * This manager is responsible for answering the question "Is this credential valid?".
 * It does not create tokens. This is separate from the FHIR-specific IAuthorizationManager.
 */
export class AppAuthorizationManager {
  private vaultRepository: IVaultRepository;
  private tokenVerifier: ITokenVerifier;
  private kmsService: IKmsService;
  private cryptographyService: ICryptography;

  constructor(
    vaultRepository: IVaultRepository,
    tokenVerifier: ITokenVerifier,
    kmsService: IKmsService,
    cryptographyService: ICryptography,
  ) {
    this.vaultRepository = vaultRepository;
    this.tokenVerifier = tokenVerifier;
    this.kmsService = kmsService;
    this.cryptographyService = cryptographyService;
  }

  /**
   * Verifies an id_token from an external provider.
   * @param idToken The token to verify.
   * @returns The verification result.
   * @throws {ManagerError} If verification fails.
   */
  public async verifyIdToken(idToken: string): Promise<VerificationResult> {
    const result = await this.tokenVerifier.verify(idToken);
    if (!result.valid) {
      throw new ManagerError(`ID token is invalid: ${result.error}`, IssueType.Security);
    }
    return result;
  }

  /**
   * Resolves the already-issued activation credential for an additional
   * installation of one exact professional assignment.
   *
   * The sector and tenant come from the routed endpoint, not from the portable
   * URN. The URN contributes the unchanged organization official identifier,
   * employee UUID and bare ISCO-08 role. A verified licensed contact is still
   * mandatory, and the returned code remains server-side input to
   * `verifyAndConsumeActivationCode` before any DCR token is minted.
   */
  public async resolveEmployeeActivationCode(
    employeeAuthorizationUrn: string,
    tenantId: string,
    jurisdiction: string,
    sector: string,
    authenticatedIdentity: ActivationActor,
  ): Promise<string> {
    const match = PORTABLE_EMPLOYEE_AUTHORIZATION_URN_PATTERN.exec(
      String(employeeAuthorizationUrn || '').trim(),
    );
    if (!match) {
      throw new ManagerError('Professional licence not found for the supplied employee authorization.', IssueType.NotFound);
    }

    const [, employeeJurisdiction, organizationOfficialId, employeeMemberId, employeeRoleCode] = match;
    if (employeeJurisdiction !== String(jurisdiction || '').trim().toLowerCase()) {
      throw new ManagerError('Professional licence not found for the supplied employee authorization.', IssueType.NotFound);
    }
    let employeeUuid: string;
    try {
      employeeUuid = decodeMultibase58btcToUUID(employeeMemberId);
    } catch {
      throw new ManagerError('Professional licence not found for the supplied employee authorization.', IssueType.NotFound);
    }
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(employeeUuid)) {
      throw new ManagerError('Professional licence not found for the supplied employee authorization.', IssueType.NotFound);
    }

    const email = normalizeIndexedEmail(String(authenticatedIdentity.email || ''));
    if (!email || authenticatedIdentity.emailVerified !== true) {
      throw new ManagerError('Professional licence resolution requires the verified licensed email.', IssueType.Forbidden);
    }

    const vaultId = getTenantVaultId(sector, tenantId);
    const documents = await this.vaultRepository.getContainersInSection<ConfidentialStorageDoc>(
      vaultId,
      getEnvSectionId('device-licenses'),
    );
    const now = Math.floor(Date.now() / 1000);
    const matches: string[] = [];
    for (const document of documents || []) {
      const license = await this.readLicense(document, vaultId);
      if (license.userClass !== 'employee') continue;
      if (license.status !== 'issued' && license.status !== 'active') continue;
      if (Number(license.exp) < now) continue;
      if (String(license.ownerOrganizationId || '') !== organizationOfficialId) continue;
      if (String(license.subjectId || '').replace(/^urn:uuid:/i, '').toLowerCase() !== employeeUuid.toLowerCase()) continue;
      if (normalizeCodeSystemAndValue(String(license.issuedToRole || '')).split(/[:|]/).pop() !== employeeRoleCode) continue;
      if (normalizeIndexedEmail(String(license.issuedToEmail || '')) !== email) continue;
      const activationCode = String(license.activationCode || '').trim();
      if (activationCode) matches.push(activationCode);
    }

    if (matches.length === 0) {
      throw new ManagerError('Professional licence not found for the supplied employee authorization.', IssueType.NotFound);
    }
    if (matches.length > 1) {
      throw new ManagerError('Multiple active professional licences match the supplied employee authorization.', IssueType.Conflict);
    }
    return matches[0];
  }

  /**
   * Verifies a generic HTTP Bearer token accepted by controller-facing routes.
   *
   * Current policy:
   * - accept a regular OIDC/Firebase `id_token`, or
   * - accept one compact JWT VP (`controller proof bearer`) signed by the
   *   controller wallet key and carrying one embedded public JWK, or
   * - on an explicitly opted-in data route, accept a tenant-signed SMART
   *   access token whose time, audience and scope claims are valid.
   *
   * SMART is never an implicit fallback for lifecycle/control-plane calls. The
   * route must opt in and supply the exact tenant vault whose key verifies it.
   *
   * This broader verifier is not the `Token/_exchange` verifier. Device token
   * exchange calls `verifyIdToken(...)` directly because the VP cannot replace
   * the trusted account/email proof required to bind an activation code.
   */
  public async verifyBearerToken(
    token: string,
    /** Compat-only public key projected from a legacy DIDComm plain envelope. */
    projectedPublicJwk?: JWK,
    /** Tenant scope used to resolve the authoritative post-DCR signing key. */
    registrationContext?: ControllerProofRegistrationContext,
    options?: BearerVerificationOptions,
  ): Promise<VerificationResult> {
    try {
      return await this.verifyIdToken(token);
    } catch (idTokenError: any) {
      try {
        return await this.verifyControllerProofBearer(token, projectedPublicJwk, registrationContext);
      } catch (vpError: any) {
        if (options?.acceptSmartAccessToken) {
          try {
            return await this.verifySmartAccessToken(token, registrationContext);
          } catch (smartError: any) {
            const idMessage = idTokenError instanceof Error ? idTokenError.message : String(idTokenError || 'verification failed');
            const vpMessage = vpError instanceof Error ? vpError.message : String(vpError || 'verification failed');
            const smartMessage = smartError instanceof Error ? smartError.message : String(smartError || 'verification failed');
            throw new ManagerError(
              `Bearer token is invalid: ${idMessage}; controller proof bearer verification also failed: ${vpMessage}; SMART access token verification also failed: ${smartMessage}`,
              IssueType.Security,
            );
          }
        }
        const idMessage = idTokenError instanceof Error ? idTokenError.message : String(idTokenError || 'verification failed');
        const vpMessage = vpError instanceof Error ? vpError.message : String(vpError || 'verification failed');
        throw new ManagerError(
          `Bearer token is invalid: ${idMessage}; controller proof bearer verification also failed: ${vpMessage}`,
          IssueType.Security,
        );
      }
    }
  }

  private async verifySmartAccessToken(
    token: string,
    registrationContext?: ControllerProofRegistrationContext,
  ): Promise<VerificationResult> {
    if (!registrationContext?.vaultId) {
      throw new ManagerError('SMART access token verification requires an exact tenant vault.', IssueType.Security);
    }
    const compact = String(token || '').trim();
    const [protectedHeader, encodedPayload, signature, ...extra] = compact.split('.');
    if (!protectedHeader || !encodedPayload || !signature || extra.length > 0) {
      throw new ManagerError('SMART access token must be a compact JWT (JWS).', IssueType.Security);
    }

    const header = decodeProtectedHeader(compact);
    const alg = String(header.alg || '').trim();
    const kid = String(header.kid || '').trim();
    const allowedAlgorithms = new Set(['ES256', 'ES256K', 'ES384', 'ML-DSA-44', 'ML-DSA-65', 'ML-DSA-87']);
    if (!kid || !allowedAlgorithms.has(alg)) {
      throw new ManagerError('SMART access token must identify a supported tenant signing key.', IssueType.Security);
    }
    const publicJwk = await this.kmsService.getPublicVerificationKey(
      registrationContext.vaultId,
      alg,
      'comm_sig',
    );
    if (!publicJwk || String(publicJwk.kid || '').trim() !== kid) {
      throw new ManagerError('SMART access token signing key is not the active key for this tenant.', IssueType.Security);
    }
    if (alg.startsWith('ES')) {
      try {
        const keyLike = await importJWK(publicJwk as JWK, alg);
        await compactVerify(compact, keyLike);
      } catch {
        throw new ManagerError('SMART access token signature is invalid.', IssueType.Security);
      }
    } else {
      const validSignature = await this.cryptographyService.verifyJws(
        { protected: protectedHeader, payload: encodedPayload, signature },
        publicJwk,
      );
      if (!validSignature) {
        throw new ManagerError('SMART access token signature is invalid.', IssueType.Security);
      }
    }

    let payload: Record<string, any>;
    try {
      payload = JSON.parse(Content.bytesToStringUTF8(Content.base64ToBytes(encodedPayload)));
    } catch {
      throw new ManagerError('SMART access token payload is not valid JSON.', IssueType.Security);
    }
    const issuer = String(payload.iss || '').trim();
    const subject = String(payload.sub || '').trim();
    const audience = String(payload.aud || '').trim();
    const scope = String(payload.scope || '').trim();
    if (!issuer.startsWith('did:') || !subject.startsWith('did:') || audience !== issuer || !scope) {
      throw new ManagerError('SMART access token issuer, subject, audience or scope is invalid.', IssueType.Security);
    }
    const now = Math.floor(Date.now() / 1000);
    const issuedAt = Number(payload.iat);
    const notBefore = Number(payload.nbf);
    const expiration = Number(payload.exp);
    if (!Number.isFinite(issuedAt) || !Number.isFinite(notBefore) || !Number.isFinite(expiration)) {
      throw new ManagerError('SMART access token requires numeric iat, nbf and exp claims.', IssueType.Security);
    }
    if (notBefore > now || issuedAt > now + 60) {
      throw new ManagerError('SMART access token is not active yet.', IssueType.Security);
    }
    if (expiration <= now) {
      throw new ManagerError('SMART access token has expired.', IssueType.Security);
    }
    return { valid: true, payload };
  }

  /**
   * Authorizes one installation with an activation code. The professional seat
   * remains active and can register additional installations up to maxDevices.
   * This logic assumes the code was found in the URL and passed to the DCR handler.
   * @param code The activation code.
   * @param tenantId The tenant associated with the code.
   * @param sector The sector associated with the tenant.
   * @returns An object with `valid: true` and the license if successful.
   * @throws {ManagerError} If the code is invalid, already used, or expired.
   */
  public async verifyAndConsumeActivationCode(
    code: string,
    tenantId: string,
    sector: string,
    authenticatedIdentity?: string | ActivationActor,
    clientInstanceId?: string,
  ): Promise<{ valid: true; license: DeviceLicense; }> {
    const now = Math.floor(Date.now() / 1000);
    const vaultId = getTenantVaultId(sector, tenantId);

    // Activation codes are not the primary ID of the license document.
    // Prefer a secure indexed lookup (HMAC-protected) and fall back to a scan in memory/dev.
    const protectedName = await this.kmsService.getHmacBase64Url('activationCode', vaultId);
    const protectedValue = await this.kmsService.getHmacBase64Url(code, vaultId);

    let licenseDocs: ConfidentialStorageDoc[] = [];
    try {
      licenseDocs = (await this.vaultRepository.query(vaultId, {
        sectionId: getEnvSectionId('device-licenses'),
        where: [{ name: protectedName, value: protectedValue }],
      })) as unknown as ConfidentialStorageDoc[];
    } catch {
      // Ignore: some repository implementations may not support query for this use case yet.
      licenseDocs = [];
    }

    if (!licenseDocs || licenseDocs.length === 0) {
      // Fallback scan (works for in-memory/dev repositories).
      const all = await this.vaultRepository.getContainersInSection<ConfidentialStorageDoc>(vaultId, getEnvSectionId('device-licenses'));
      licenseDocs = all.filter((doc) => (doc.content as any)?.activationCode === code);
    }

    if (!licenseDocs || licenseDocs.length === 0) {
      throw new ManagerError('Activation code not found or invalid.', IssueType.NotFound);
    }
    if (licenseDocs.length > 1) {
      throw new ManagerError('Multiple licenses found for the same activation code.', IssueType.Exception);
    }

    const licenseDoc = licenseDocs[0];
    const license = await this.readLicense(licenseDoc, vaultId);

    if (license.status !== 'issued' && license.status !== 'active') {
      throw new ManagerError('License is not in an activatable or active multi-device state.', IssueType.Conflict);
    }
    if (license.exp < now) {
      throw new ManagerError('Activation code has expired.', IssueType.BusinessRule);
    }

    const identity = typeof authenticatedIdentity === 'string'
      ? { subject: authenticatedIdentity }
      : authenticatedIdentity;
    const email = normalizeIndexedEmail(String(identity?.email || ''));
    const phone = normalizeIndexedPhone(String(identity?.phone || ''));
    const issuedEmail = normalizeIndexedEmail(String(license.issuedToEmail || ''));
    const issuedPhone = normalizeIndexedPhone(String(license.issuedToPhone || ''));
    if (!issuedEmail && !issuedPhone) {
      throw new ManagerError('License has no canonical email or phone actor contact.', IssueType.BusinessRule);
    }
    if (issuedEmail) {
      if (!email || email !== issuedEmail) {
        throw new ManagerError('Activation identity does not match the licensed email.', IssueType.Forbidden);
      }
      if (identity?.emailVerified === false) {
        throw new ManagerError('Activation requires a verified licensed email.', IssueType.Forbidden);
      }
    } else if (!phone || phone !== issuedPhone) {
      throw new ManagerError('Activation identity does not match the licensed phone.', IssueType.Forbidden);
    }
    const actor = issuedEmail
      ? normalizeSameAsHash(issuedEmail)
      : normalizeTelephoneHash(issuedPhone!);
    if (license.status === 'active') {
      const legacyActor = Boolean(license.activatedBy
        && !/^urn:multibase:z[^:]+$/.test(String(license.activatedBy)));
      const canMigrateLegacyActor = legacyActor;
      if (license.activatedBy && !canMigrateLegacyActor && license.activatedBy !== actor) {
        throw new ManagerError('Active seat belongs to a different authenticated user.', IssueType.Forbidden);
      }
      const activeBindings = this.readActiveDeviceBindings(license);
      const sameInstallation = clientInstanceId && activeBindings.some((binding) =>
        binding.clientInstanceId === clientInstanceId);
      const allowance = this.readDeviceAllowance(license);
      if (!sameInstallation && activeBindings.length >= allowance) {
        throw new ManagerError(`Device allowance exhausted for this license (${activeBindings.length}/${allowance}).`, IssueType.Conflict);
      }
      // Migration for active legacy seats created before activatedBy/maxDevices.
      // The first authenticated reuse claims the seat; later reuses must match.
      if (!license.activatedBy || canMigrateLegacyActor) {
        license.activatedBy = actor;
        license.maxDevices = allowance;
        licenseDoc.sequence++;
        await this.storeLicense(vaultId, licenseDoc);
      }
    } else {
      license.status = 'active';
      license.activatedAt = now;
      license.activatedBy = actor;
      license.maxDevices = this.readDeviceAllowance(license);
      licenseDoc.sequence++;
      await this.storeLicense(vaultId, licenseDoc);
    }

    return { valid: true, license };
  }

  private readDeviceAllowance(license: DeviceLicense & Record<string, any>): number {
    const value = Number(license.maxDevices);
    return Number.isInteger(value) && value > 0 ? value : DEFAULT_LICENSE_DEVICE_ALLOWANCE;
  }

  /**
   * Rotates one employee installation credential after the caller has already
   * proved a fresh verified email OTP session.
   */
  public async rotateEmployeeActivationCodeForOwnedDevice(
    tenantId: string,
    sector: string,
    authenticatedIdentity: ActivationActor,
    clientInstanceId: string,
  ): Promise<{ activationCode: string; licenseId: string; employeeRole: string; employeeActorIdentifier: string }> {
    const email = normalizeIndexedEmail(String(authenticatedIdentity.email || ''));
    if (!email || authenticatedIdentity.emailVerified !== true) {
      throw new ManagerError('Recovery requires a verified licensed email.', IssueType.Forbidden);
    }
    const installation = String(clientInstanceId || '').trim();
    if (!installation) throw new ManagerError('Recovery requires client_instance_id.', IssueType.Required);

    const vaultId = getTenantVaultId(sector, tenantId);
    const sectionId = getEnvSectionId('device-licenses');
    const documents = await this.vaultRepository.getContainersInSection<ConfidentialStorageDoc>(vaultId, sectionId);
    const matches: Array<{ document: ConfidentialStorageDoc; license: DeviceLicense & Record<string, any> }> = [];
    for (const document of documents) {
      try {
        const opened = await openDeviceLicenseDocument(document, vaultId, this.kmsService);
        const licenseEmail = normalizeIndexedEmail(String(opened.license.issuedToEmail || ''));
        const ownsInstallation = this.readActiveDeviceBindings(opened.license)
          .some(binding => String(binding.clientInstanceId || '') === installation);
        if (opened.license.userClass === LICENSE_USER_CLASS_EMPLOYEE
          && opened.license.status === LICENSE_STATUS_ACTIVE
          && ownsInstallation
          && licenseEmail === email) matches.push(opened);
      } catch {
        // An unrelated unreadable record cannot authorize recovery.
      }
    }
    if (matches.length === 0) {
      throw new ManagerError(
        'No active device matches the authenticated licensed email and installation.',
        IssueType.Forbidden,
      );
    }
    if (matches.length > 1) {
      throw new ManagerError('Multiple active seats match the same installation.', IssueType.Conflict);
    }

    const { document, license } = matches[0];
    const employeeRole = String(license.issuedToRole || license.userCategory || '').trim();
    const employeeActorIdentifier = String(license.activatedBy || '').trim();
    if (!employeeRole || !employeeActorIdentifier) {
      throw new ManagerError('Active employee seat has no complete actor binding.', IssueType.BusinessRule);
    }
    const activationCode = `lic-${randomBytes(9).toString('base64url')}`;
    license.activationCode = activationCode;
    document.status = LICENSE_STATUS_ACTIVE;
    document.sequence = Number(document.sequence || 0) + 1;
    if (this.kmsService?.protectAttributesNameAndValue) {
      document.indexed = {
        ...(document.indexed || {}),
        attributes: await this.kmsService.protectAttributesNameAndValue(
          [{ name: 'activationCode', value: activationCode, unique: true, type: 'string' }],
          vaultId,
        ),
      };
    }
    const updated = await prepareDeviceLicenseDocumentForWrite({
      document,
      license,
      vaultId,
      kmsService: this.kmsService,
    });
    await this.vaultRepository.put(vaultId, [updated], sectionId);
    return {
      activationCode,
      licenseId: license.id || document.id,
      employeeRole,
      employeeActorIdentifier,
    };
  }

  private async readLicense(
    licenseDoc: ConfidentialStorageDoc,
    vaultId: string,
  ): Promise<DeviceLicense & Record<string, any>> {
    if (licenseDoc.content !== undefined) {
      return licenseDoc.content as DeviceLicense & Record<string, any>;
    }
    return this.kmsService.unprotectConfidentialData<DeviceLicense & Record<string, any>>(licenseDoc, vaultId);
  }

  private async storeLicense(vaultId: string, licenseDoc: ConfidentialStorageDoc): Promise<void> {
    const protectedLicenseDoc = await this.kmsService.protectConfidentialData(licenseDoc, vaultId);
    await this.vaultRepository.put(vaultId, [protectedLicenseDoc], getEnvSectionId('device-licenses'));
  }

  private readActiveDeviceBindings(license: DeviceLicense & Record<string, any>): any[] {
    if (Array.isArray(license.deviceBindings)) {
      return license.deviceBindings.filter((binding: any) => binding.status === 'active');
    }
    const clientId = String(license.deviceId || '').trim();
    if (!clientId) return [];
    return [{ clientId, clientInstanceId: license.deviceInfo?.clientInstanceId || clientId, status: 'active' }];
  }

  /**
   * Verifies the signature and claims of an initial_access_token issued by the host.
   * @param token The token string to verify.
   * @returns The claims of the token if valid.
   * @throws {ManagerError} If the token is invalid.
   */
  public async verifyInitialAccessToken(token: string): Promise<any> {
    const [header, payload, signature] = token.split('.');
    if (!header || !payload || !signature) {
        throw new ManagerError('Invalid JWT format for initial_access_token.', IssueType.Security);
    }

    // 1. Verify Signature
    const hostSignKey = await this.kmsService.getPublicVerificationKey('host', undefined, 'comm_sig');
    if (!hostSignKey) {
      throw new ManagerError('Host signing key not found, cannot verify token.', IssueType.Exception);
    }
    const isValid = await this.cryptographyService.verifyJws(
      { protected: header, payload, signature },
      hostSignKey,
    );

    if (!isValid) {
      throw new ManagerError('Invalid signature for initial_access_token.', IssueType.Security);
    }

    // 2. Verify Claims
    const claims = JSON.parse(Content.bytesToStringUTF8(Content.base64ToBytes(payload)));
    if (claims.scope !== 'dcr:register') {
      throw new ManagerError("Token scope must be 'dcr:register'.", IssueType.Forbidden);
    }
    if (claims.exp < Math.floor(Date.now() / 1000)) {
      throw new ManagerError('Initial access token has expired.', IssueType.Forbidden);
    }

    return claims;
  }

  private async verifyControllerProofBearer(
    token: string,
    projectedPublicJwk?: JWK,
    registrationContext?: ControllerProofRegistrationContext,
  ): Promise<VerificationResult> {
    const compact = String(token || '').trim();
    const parts = compact.split('.');
    if (parts.length !== 3) {
      throw new ManagerError('Controller proof bearer must be a compact JWT (JWS).', IssueType.Security);
    }

    const header = decodeProtectedHeader(compact);
    const alg = String(header.alg || '').trim();
    if (!alg || alg.toLowerCase() === 'none') {
      throw new ManagerError('Controller proof bearer must be signed with a supported algorithm.', IssueType.Security);
    }

    const allowed = new Set(['ES256K', 'ES384', 'ML-DSA-44', 'ML-DSA-65', 'ML-DSA-87']);
    if (!allowed.has(alg)) {
      throw new ManagerError(`Unsupported controller proof bearer algorithm '${alg}'.`, IssueType.Security);
    }

    const payload = JSON.parse(Content.bytesToStringUTF8(Content.base64ToBytes(parts[1])));
    if (!payload?.vp || typeof payload.vp !== 'object') {
      throw new ManagerError('Controller proof bearer must carry one vp claim.', IssueType.Security);
    }

    const now = Math.floor(Date.now() / 1000);
    if (payload.exp !== undefined && Number(payload.exp) < now) {
      throw new ManagerError('Controller proof bearer has expired.', IssueType.Security);
    }
    if (payload.nbf !== undefined && Number(payload.nbf) > now) {
      throw new ManagerError('Controller proof bearer is not active yet.', IssueType.Security);
    }

    const suppliedPublicJwk = header.jwk && typeof header.jwk === 'object'
      ? header.jwk as JWK
      : projectedPublicJwk;
    const registeredPublicJwk = registrationContext
      ? await this.resolveRegisteredControllerProofJwk(
        String(payload.iss || '').trim(),
        String(header.kid || '').trim(),
        registrationContext,
      )
      : undefined;
    if (registrationContext && !registeredPublicJwk) {
      throw new ManagerError(
        'Controller proof bearer kid is not registered for this tenant.',
        IssueType.Security,
      );
    }
    // Post-DCR verification is always performed with the stored key. A JWK
    // carried by the JWT or DIDComm envelope is optional compatibility data;
    // it never becomes an authority source for a tenant-scoped operation.
    const verificationJwk = registeredPublicJwk || suppliedPublicJwk;
    if (verificationJwk && this.hasPrivateJwkMaterial(verificationJwk)) {
      throw new ManagerError('Controller proof bearer verification JWK must be public.', IssueType.Security);
    }
    if (header.kid && verificationJwk?.kid && header.kid !== verificationJwk.kid) {
      throw new ManagerError('Controller proof bearer kid does not match the projected verification JWK.', IssueType.Security);
    }

    if ((alg === 'ES256K' || alg === 'ES384') && verificationJwk) {
      try {
        const keyLike = await importJWK(verificationJwk, alg);
        await compactVerify(compact, keyLike);
      } catch (error: any) {
        const message = error instanceof Error ? error.message : String(error);
        throw new ManagerError(`Invalid controller proof bearer signature: ${message}`, IssueType.Security);
      }
    } else if (alg === 'ES256K' || alg === 'ES384') {
      throw new ManagerError('Controller proof bearer requires one public JWK in its header or decoded request meta for ES256K/ES384 verification.', IssueType.Security);
    }

    return { valid: true, payload };
  }

  private async resolveRegisteredControllerProofJwk(
    issuerDid: string,
    kid: string,
    context: ControllerProofRegistrationContext,
  ): Promise<JWK | undefined> {
    if (!issuerDid || !kid || !context.vaultId) return undefined;
    const protectedAttrName = await this.kmsService.getHmacBase64Url('kid', context.vaultId);
    const protectedAttrValue = await this.kmsService.getHmacBase64Url(kid, context.vaultId);
    const scopes = Array.from(new Set(
      [context.collectionName, context.vaultId].filter((value): value is string => Boolean(value)),
    ));

    for (const scope of scopes) {
      const documents = await this.vaultRepository.query(scope, {
        sectionId: getEnvSectionId('employees'),
        where: [{ name: protectedAttrName, value: protectedAttrValue }],
      });
      for (const document of documents || []) {
        const employee = await this.kmsService.unprotectConfidentialData<EntityConfig>(document, context.vaultId);
        const publicJwk = this.findEmployeeControllerProofJwk(employee, issuerDid, kid, false);
        if (publicJwk) return publicJwk;
      }

      if (!this.legacyRepresentativeControllerEnabled()) continue;
      const historicalDocuments = await this.vaultRepository.getContainersInSection<ConfidentialStorageDoc>(
        scope,
        getEnvSectionId('employees'),
      );
      for (const document of historicalDocuments || []) {
        const publicProjection = (document.public || {}) as Record<string, unknown>;
        if (String(publicProjection.role || '').trim() !== HOST_BOOTSTRAP_CONTROLLER_LIFECYCLE_ROLE) continue;
        const employee = await this.kmsService.unprotectConfidentialData<EntityConfig>(document, context.vaultId);
        const publicJwk = this.findEmployeeControllerProofJwk(employee, issuerDid, kid, true);
        if (publicJwk) return publicJwk;
      }
    }
    return undefined;
  }

  private findEmployeeControllerProofJwk(
    employee: EntityConfig,
    issuerDid: string,
    kid: string,
    allowStoredDidAlias: boolean,
  ): JWK | undefined {
    const didDocument = employee?.didDocument;
    const primaryDid = String(didDocument?.id || '').trim();
    const storedDidAliases = allowStoredDidAlias && Array.isArray(didDocument?.alsoKnownAs)
      ? didDocument.alsoKnownAs
        .map((alias) => String(alias || '').trim())
        .filter((alias) => alias.startsWith('did:web:'))
      : [];
    if (primaryDid !== issuerDid && !storedDidAliases.includes(issuerDid)) return undefined;
    const method = didDocument?.verificationMethod?.find((candidate) => {
      const methodKid = String((candidate.publicKeyJwk as JWK | undefined)?.kid || '').trim();
      return methodKid === kid || String(candidate.id || '').endsWith(`#${kid}`);
    });
    return method?.publicKeyJwk as JWK | undefined;
  }

  private legacyRepresentativeControllerEnabled(): boolean {
    return ['true', '1', 'yes', 'on'].includes(
      String(process.env.HOST_LEGACY_REPRESENTATIVE_CONTROLLER || '').trim().toLowerCase(),
    );
  }

  private hasPrivateJwkMaterial(jwk: JWK): boolean {
    const value = jwk as Record<string, unknown>;
    return ['d', 'dBytes', 'k', 'p', 'q', 'dp', 'dq', 'qi', 'oth']
      .some((name) => value[name] !== undefined);
  }
}
