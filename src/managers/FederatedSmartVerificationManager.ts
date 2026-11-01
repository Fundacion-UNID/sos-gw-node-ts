// Copyright 2026 Fundación UNID under the Apache License, Version 2.0.

import { createHash } from 'node:crypto';
import {
  calculateJwkThumbprint,
  decodeJwt,
  decodeProtectedHeader,
  importJWK,
  jwtVerify,
  type JWK,
  type JWTPayload,
} from 'jose';
import { SmartIntrospectionExtensionFields } from 'gdc-common-utils-ts/utils/smart-authorization-profile';
import { ManagerError } from 'gdc-common-utils-ts/utils/manager-error';
import { IssueType } from 'gdc-common-utils-ts/models/issue';
import type { DidDocument, VerificationMethod } from '../gdc-backend-utils-node/models/did';
import type { IKmsService } from '../gdc-backend-utils-node/models/IKmsService';
import type { IVaultRepository } from '../database/repositories/vault/vault.repository';
import type { ITenantsManager } from './ITenantsManager';
import type { IClearingHouseService } from '../services/ClearingHouseService';
import type { IReplayProtectionStore } from '../adapters/replay-protection-store';
import { getEnvSectionId } from '../utils/section-env';
import { getTenantVaultId } from '../utils/tenant';

const JWT_BEARER_ASSERTION_TYPE = 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer';
const TOKEN_INTROSPECTION_JWT_TYPE = 'token-introspection+jwt';

export type FederatedSmartVerificationInput = Readonly<{
  tenantId: string;
  jurisdiction: string;
  sector: string;
  token: string;
  tokenTypeHint?: string;
  clientAssertionType: string;
  clientAssertion: string;
  requestUrl: string;
}>;

export type FederatedSmartVerificationResult = Readonly<{
  active: boolean;
  compactResponse: string;
}>;

type FederatedSmartVerificationDependencies = Readonly<{
  kmsService: IKmsService;
  tenantsManager: ITenantsManager;
  vaultRepository: IVaultRepository;
  clearingHouseService: IClearingHouseService;
  replayProtectionStore: IReplayProtectionStore;
  now?: () => number;
  trustedIndexProviderIssuers?: () => ReadonlySet<string>;
  resolveIssuerDidDocument?: (issuer: string) => Promise<DidDocument>;
}>;

type VerifiedIndexToken = Readonly<{
  payload: JWTPayload & Record<string, unknown>;
  issuer: string;
  audience: string;
  subject: string;
  scope: string;
  purpose?: string;
  presentation: string;
  presentationHash: string;
  consentIdentifiers: string[];
  expiresAt: number;
  tokenId: string;
}>;

function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function readAudience(payload: JWTPayload): string | undefined {
  if (typeof payload.aud === 'string') return payload.aud;
  if (Array.isArray(payload.aud) && payload.aud.length === 1) return String(payload.aud[0] || '').trim() || undefined;
  return undefined;
}

function relationshipContains(
  relationship: Array<string | VerificationMethod> | undefined,
  methodId: string,
): boolean {
  return (relationship || []).some((entry) => typeof entry === 'string' ? entry === methodId : entry.id === methodId);
}

async function resolveDidWebDocument(issuer: string): Promise<DidDocument> {
  if (!issuer.startsWith('did:web:')) {
    throw new ManagerError('Federated SMART issuer must use did:web.', IssueType.Security);
  }
  const parts = issuer.slice('did:web:'.length).split(':');
  const domain = decodeURIComponent(parts.shift() || '');
  const url = parts.length > 0
    ? `https://${domain}/${parts.map(decodeURIComponent).join('/')}/did.json`
    : `https://${domain}/.well-known/did.json`;
  const response = await fetch(url, { headers: { accept: 'application/did+json, application/json' } });
  if (!response.ok) {
    throw new ManagerError('Could not resolve the federated SMART issuer DID.', IssueType.Security);
  }
  const document = await response.json() as DidDocument;
  if (document.id !== issuer) {
    throw new ManagerError('Resolved DID document does not match the federated SMART issuer.', IssueType.Security);
  }
  return document;
}

/**
 * Verifies an index-provider SMART artifact on behalf of one custodian EHR.
 *
 * The result is evidence addressed to the registered EHR client. It is not a
 * replacement bearer and it never changes the original subject, purpose,
 * scope or expiration.
 */
export class FederatedSmartVerificationManager {
  private readonly now: () => number;
  private readonly trustedIndexProviderIssuers: () => ReadonlySet<string>;
  private readonly resolveIssuerDidDocument: (issuer: string) => Promise<DidDocument>;

  constructor(private readonly dependencies: FederatedSmartVerificationDependencies) {
    this.now = dependencies.now || (() => Math.floor(Date.now() / 1000));
    this.trustedIndexProviderIssuers = dependencies.trustedIndexProviderIssuers || (() => new Set(
      String(process.env.FEDERATED_SMART_TRUSTED_ISSUERS || '')
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean),
    ));
    this.resolveIssuerDidDocument = dependencies.resolveIssuerDidDocument || resolveDidWebDocument;
  }

  public async verify(input: FederatedSmartVerificationInput): Promise<FederatedSmartVerificationResult> {
    this.assertRequestShape(input);
    const tenantVaultId = getTenantVaultId(input.sector, input.tenantId);
    if (!await this.dependencies.tenantsManager.tenantExists(tenantVaultId)) {
      throw new ManagerError('Custodian tenant does not exist.', IssueType.NotFound);
    }
    const tenantDidDocument = await this.dependencies.tenantsManager.getDidDocument(tenantVaultId);
    const tenantDid = String(tenantDidDocument?.id || '').trim();
    if (!tenantDid) {
      throw new ManagerError('Custodian tenant DID is unavailable.', IssueType.Exception);
    }

    const ehrClientId = await this.verifyRegisteredClientAssertion({
      compact: input.clientAssertion,
      requestUrl: input.requestUrl,
      tenantDid,
      tenantVaultId,
    });

    try {
      const verifiedToken = await this.verifyIndexToken(input.token);
      await this.verifyProfessionalEvidence(verifiedToken);
      const tokenIntrospection = {
        active: true,
        iss: verifiedToken.issuer,
        aud: verifiedToken.audience,
        sub: verifiedToken.subject,
        scope: verifiedToken.scope,
        purpose: verifiedToken.purpose,
        exp: verifiedToken.expiresAt,
        jti: verifiedToken.tokenId,
        consent_ids: verifiedToken.consentIdentifiers,
        token_hash: sha256Hex(input.token),
        vp_hash: verifiedToken.presentationHash,
        ledger_verified: true,
        [SmartIntrospectionExtensionFields.VpToken]: verifiedToken.presentation,
      };
      const compactResponse = await this.signResponse({
        tenantVaultId,
        tenantDid,
        ehrClientId,
        expiresAt: verifiedToken.expiresAt,
        tokenIntrospection,
      });
      return { active: true, compactResponse };
    } catch (error) {
      const compactResponse = await this.signResponse({
        tenantVaultId,
        tenantDid,
        ehrClientId,
        expiresAt: this.now() + 60,
        tokenIntrospection: { active: false },
      });
      return { active: false, compactResponse };
    }
  }

  private assertRequestShape(input: FederatedSmartVerificationInput): void {
    if (!String(input.token || '').trim()) {
      throw new ManagerError("Missing 'token' in introspection request.", IssueType.Required);
    }
    if (input.tokenTypeHint && input.tokenTypeHint !== 'access_token') {
      throw new ManagerError("Unsupported 'token_type_hint'.", IssueType.NotSupported);
    }
    if (input.clientAssertionType !== JWT_BEARER_ASSERTION_TYPE && input.clientAssertionType !== 'private_key_jwt') {
      throw new ManagerError("Unsupported 'client_assertion_type'.", IssueType.NotSupported);
    }
    if (!String(input.clientAssertion || '').trim()) {
      throw new ManagerError("Missing 'client_assertion' in introspection request.", IssueType.Required);
    }
  }

  private async verifyRegisteredClientAssertion(input: {
    compact: string;
    requestUrl: string;
    tenantDid: string;
    tenantVaultId: string;
  }): Promise<string> {
    const unverified = decodeJwt(input.compact);
    const clientId = String(unverified.iss || '').trim();
    if (!clientId || String(unverified.sub || '').trim() !== clientId) {
      throw new ManagerError('Client assertion issuer and subject must identify the same registered EHR.', IssueType.Security);
    }
    const profileDocument = await this.dependencies.vaultRepository.get<any>(
      input.tenantVaultId,
      clientId,
      getEnvSectionId('device-profiles'),
    );
    if (!profileDocument || String(profileDocument.status || 'active') !== 'active') {
      throw new ManagerError('EHR client registration is missing or inactive.', IssueType.Forbidden);
    }
    const profile = await this.dependencies.kmsService.unprotectConfidentialData<any>(
      profileDocument,
      input.tenantVaultId,
    );
    if (String(profile?.clientId || '').trim() !== clientId) {
      throw new ManagerError('EHR client assertion does not match its registered profile.', IssueType.Security);
    }

    const header = decodeProtectedHeader(input.compact);
    const algorithm = String(header.alg || '').trim();
    if (!algorithm || algorithm.toLowerCase() === 'none') {
      throw new ManagerError('EHR client assertion uses an unsupported algorithm.', IssueType.Security);
    }
    const registeredKeys = Array.isArray(profile?.jwks?.keys) ? profile.jwks.keys as JWK[] : [];
    const candidates = header.kid
      ? registeredKeys.filter((key) => String(key.kid || '') === String(header.kid))
      : registeredKeys;
    let verifiedPayload: JWTPayload | undefined;
    for (const candidate of candidates) {
      try {
        if (header.jwk && await calculateJwkThumbprint(header.jwk as JWK) !== await calculateJwkThumbprint(candidate)) {
          continue;
        }
        const result = await jwtVerify(input.compact, await importJWK(candidate, algorithm), {
          issuer: clientId,
          subject: clientId,
          audience: [input.requestUrl, input.tenantDid],
          algorithms: [algorithm],
          currentDate: new Date(this.now() * 1000),
        });
        verifiedPayload = result.payload;
        break;
      } catch {
        // Continue only through keys registered to this exact client.
      }
    }
    if (!verifiedPayload) {
      throw new ManagerError('EHR client assertion is not signed by its registered key.', IssueType.Security);
    }
    const assertionId = String(verifiedPayload.jti || '').trim();
    if (!assertionId) {
      throw new ManagerError('EHR client assertion must contain jti.', IssueType.Required);
    }
    const expiresAt = Number(verifiedPayload.exp);
    const ttlSeconds = Number.isFinite(expiresAt) ? Math.max(1, expiresAt - this.now()) : 60;
    const reserved = await this.dependencies.replayProtectionStore.reserveIfNotExists(
      `${input.tenantVaultId}:federated-smart:${clientId}:${assertionId}`,
      ttlSeconds,
    );
    if (!reserved) {
      throw new ManagerError('EHR client assertion replay detected.', IssueType.Conflict);
    }
    return clientId;
  }

  private async verifyIndexToken(compact: string): Promise<VerifiedIndexToken> {
    const unverified = decodeJwt(compact);
    const issuer = String(unverified.iss || '').trim();
    if (!issuer || !this.trustedIndexProviderIssuers().has(issuer)) {
      throw new ManagerError('Federated SMART token issuer is not trusted.', IssueType.Forbidden);
    }
    const header = decodeProtectedHeader(compact);
    const algorithm = String(header.alg || '').trim();
    if (!algorithm || algorithm.toLowerCase() === 'none' || String(header.typ || '').toLowerCase() === 'at+jwt') {
      throw new ManagerError('Federated SMART token uses an unsupported JOSE profile.', IssueType.Security);
    }
    const document = await this.resolveIssuerDidDocument(issuer);
    const keyId = String(header.kid || '').trim();
    const verificationMethod = (document.verificationMethod || []).find((method) => method.id === keyId);
    const relationshipAccepted = relationshipContains((document as any).assertionMethod, keyId)
      || relationshipContains((document as any).authentication, keyId);
    if (!verificationMethod?.publicKeyJwk || !relationshipAccepted) {
      throw new ManagerError('Federated SMART signing key is not authorized by the issuer DID.', IssueType.Security);
    }
    const { payload } = await jwtVerify(compact, await importJWK(verificationMethod.publicKeyJwk as JWK, algorithm), {
      issuer,
      audience: issuer,
      algorithms: [algorithm],
      currentDate: new Date(this.now() * 1000),
    });
    const audience = readAudience(payload);
    const subject = String(payload.sub || '').trim();
    const scope = String(payload.scope || '').trim();
    const presentation = String(payload[SmartIntrospectionExtensionFields.VpToken] || '').trim();
    const presentationHash = String(payload.vp_hash || '').trim();
    const tokenId = String(payload.jti || '').trim();
    const expiresAt = Number(payload.exp);
    const consentIdentifiers = Array.isArray(payload.consent_ids)
      ? payload.consent_ids.map((value) => String(value || '').trim()).filter(Boolean)
      : [];
    if (!audience || audience !== issuer || !subject || !scope || !presentation || !presentationHash || !tokenId) {
      throw new ManagerError('Federated SMART token is missing required authorization evidence.', IssueType.Security);
    }
    if (!Number.isFinite(expiresAt) || expiresAt <= this.now()) {
      throw new ManagerError('Federated SMART token is expired.', IssueType.Forbidden);
    }
    if (payload.ledger_verified !== true || consentIdentifiers.length === 0) {
      throw new ManagerError('Federated SMART token lacks verified consent evidence.', IssueType.Forbidden);
    }
    if (sha256Hex(presentation) !== presentationHash) {
      throw new ManagerError('Federated SMART presentation hash does not match.', IssueType.Security);
    }
    return {
      payload: payload as JWTPayload & Record<string, unknown>,
      issuer,
      audience,
      subject,
      scope,
      purpose: typeof payload.purpose === 'string' ? payload.purpose : undefined,
      presentation,
      presentationHash,
      consentIdentifiers,
      expiresAt,
      tokenId,
    };
  }

  private async verifyProfessionalEvidence(token: VerifiedIndexToken): Promise<void> {
    const acr = String(token.payload.acr || '').trim();
    const result = await this.dependencies.clearingHouseService.verifyVpToken({
      vpToken: token.presentation,
      acrValues: acr ? [acr] : [],
      tokenIssuer: token.issuer,
      tokenSubject: token.subject,
      tokenScope: token.scope,
      tokenPurpose: token.purpose,
      consentIdentifiers: token.consentIdentifiers,
    });
    if (result.ledgerVerified !== true || result.vpHash !== token.presentationHash) {
      throw new ManagerError('Clearing House could not verify current professional and consent evidence.', IssueType.Forbidden);
    }
    if (acr && result.acr !== acr) {
      throw new ManagerError('Clearing House returned a different assurance context.', IssueType.Forbidden);
    }
  }

  private async signResponse(input: {
    tenantVaultId: string;
    tenantDid: string;
    ehrClientId: string;
    expiresAt: number;
    tokenIntrospection: Record<string, unknown>;
  }): Promise<string> {
    const signingKey = await this.dependencies.kmsService.getPublicVerificationKey(
      input.tenantVaultId,
      undefined,
      'comm_sig',
    );
    if (!signingKey?.kid) {
      throw new ManagerError('Custodian tenant signing key is unavailable.', IssueType.Exception);
    }
    const now = this.now();
    return this.dependencies.kmsService.createCompactJws({
      iss: input.tenantDid,
      aud: input.ehrClientId,
      iat: now,
      nbf: now,
      exp: Math.max(now + 1, input.expiresAt),
      token_introspection: input.tokenIntrospection,
    }, signingKey.kid, input.tenantVaultId, 'comm_sig', { typ: TOKEN_INTROSPECTION_JWT_TYPE });
  }
}
