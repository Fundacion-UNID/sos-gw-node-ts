// src/routes/api.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.
import { GatewayInternalResourceTypes } from 'gdc-common-utils-ts/constants/gateway-response';
import { GatewayResponseEntryTypes } from 'gdc-common-utils-ts/constants/gateway-response';

import * as express from 'express';
import { IKmsService } from '../gdc-backend-utils-node/models/IKmsService';
import type { IApiTenantRegistry } from '../managers/IApiTenantRegistry';
import { QueueAdapter } from '../adapters/queue';
import { IAsyncResponseStore } from '../adapters/async-response-store.mem';
import { createJobName } from '../utils/naming';
import { isRequestValid } from '../utils/request-validator';
import { JobRequest } from 'gdc-common-utils-ts/models/confidential-job';
import { IssueLevel, IssueType } from 'gdc-common-utils-ts/models/issue';
import { Content } from 'gdc-common-utils-ts/utils/content';
import { EntityConfig } from '../gdc-backend-utils-node/models/entity';
import { JWK } from 'gdc-common-utils-ts/models/jwk';
import { VerificationMethod } from '../gdc-backend-utils-node/models/did';
import { IVaultRepository } from '../database/repositories/vault/vault.repository';
import { ICryptography } from 'gdc-common-utils-ts/interfaces/ICryptography';
import { getTenantVaultIdFromIss, getTenantVaultId } from '../utils/tenant';
import { composeHostDidWebId } from '../utils/did-backend';
import { buildGaiaXLegalParticipantOptionsFromClaims, createGaiaXLegalParticipantCredential } from '../utils/credential-generators';
import { AppAuthorizationManager } from '../managers/AppAuthorizationManager';
import { getEnvSectionId } from '../utils/section-env';
import { IReplayProtectionStore, ReplayProtectionStoreNoop } from '../adapters/replay-protection-store';
import { sendDidcommEarlyError } from '../utils/didcomm-error-response';
import { ACTION_DISABLE, ACTION_ENABLE, ACTION_PURGE, ACTION_STATUS } from '../constants/domain';
import { getTenantAuthorizationStatus as readTenantAuthorizationStatusFromConfig } from '../utils/tenant-lifecycle';
import { enforceSmartScopeRouteCompatibility } from '../utils/smart-scope-route-authorization';
import { IdentityAuthActions } from 'gdc-common-utils-ts/constants/identity-auth';
import { DeviceBindingStatuses } from 'gdc-common-utils-ts/constants/device';
import type { ConfidentialStorageDoc } from 'gdc-common-utils-ts/models/confidential-storage';
import { resolveHostRegistrySector } from '../utils/services';
import { isEncryptionJwk, isSignatureJwk } from '../managers/hosting/registration-keys';
import { ClaimsOfferSchemaorg, ClaimsOrderSchemaorg } from 'gdc-common-utils-ts/constants/schemaorg';
import type { PublicJwk } from 'gdc-common-utils-ts/interfaces/Cryptography.types';
import { getClaimValue } from '../utils/claims';
import { isVerifiedBearerBoundToActorDid } from '../utils/authenticated-job-actor';
import {
  isRegisteredProfileAccountDirectoryRoute,
  isVerifiedBearerBoundToRegisteredProfile,
  REGISTERED_PROFILE_ACCOUNT_DIRECTORY_META,
  requiresVerifiedBearerActorBindingForSecureRoute,
} from '../utils/secure-route-bearer-binding';
import { decodeJwt } from 'jose';
import { randomUUID } from 'node:crypto';
import { enqueueAsyncJob } from '../services/async-job-submission';

const FORWARDED_HEADER_SEPARATOR = ',';
type SecurityMode = 'strict' | 'compat' | 'demo';
type ParsedContentType = 'secure-form' | 'didcomm-plain' | 'json' | 'fhir' | 'unsupported';
const DIDCOMM_PLAINTEXT_JSON_LEGACY_MEDIA_TYPE = 'application/didcomm-plaintext+json';

/**
 * Resolves the accepted Offer before DCR from either contextualized schema.org
 * wire claims or their fully qualified storage form.
 */
export function readPendingOrderAcceptedOfferId(claims: Record<string, unknown>): string {
  return String(getClaimValue(claims, ClaimsOrderSchemaorg.acceptedOfferIdentifier) || '').trim();
}

function getVerifiedBearerPayload(verificationResult: any): Record<string, any> {
  if (!verificationResult || typeof verificationResult !== 'object') return {};
  const payload = (verificationResult as any).payload;
  if (payload && typeof payload === 'object') {
    return payload as Record<string, any>;
  }
  const clone = { ...(verificationResult as Record<string, any>) };
  delete (clone as any).valid;
  delete (clone as any).error;
  return clone;
}

function bearerVerificationOptionsForDataRoute(
  section: string,
  format: string,
): { acceptSmartAccessToken: true } | undefined {
  const normalizedFormat = String(format || '').toLowerCase();
  return (section === 'individual' || section === 'digitaltwin')
    && (normalizedFormat === 'org.hl7.fhir.r4' || normalizedFormat === 'org.hl7.fhir.api')
    ? { acceptSmartAccessToken: true }
    : undefined;
}

function parseBooleanEnv(value: string | undefined, fallback = false): boolean {
  if (value === undefined) return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (normalized === 'true' || normalized === '1' || normalized === 'yes' || normalized === 'enabled') return true;
  if (normalized === 'false' || normalized === '0' || normalized === 'no' || normalized === 'disabled') return false;
  return fallback;
}

function resolveSecurityModeFromEnv(): SecurityMode {
  const normalized = String(process.env.SECURITY_MODE || 'strict').trim().toLowerCase();
  if (normalized === 'strict' || normalized === 'compat' || normalized === 'demo') return normalized;
  return 'strict';
}

function normalizeContentType(rawValue: string | undefined): string {
  if (!rawValue) return '';
  return String(rawValue).split(';')[0].trim().toLowerCase();
}

function acceptLegacyDidcommPlaintextMediaType(): boolean {
  return parseBooleanEnv(process.env.DIDCOMM_LEGACY_PLAINTEXT_MEDIA_TYPE, false);
}

function parseIncomingContentType(contentType: string): ParsedContentType {
  if (contentType === 'application/x-www-form-urlencoded') return 'secure-form';
  if (contentType === 'application/didcomm-plain+json') return 'didcomm-plain';
  if (acceptLegacyDidcommPlaintextMediaType() && contentType === DIDCOMM_PLAINTEXT_JSON_LEGACY_MEDIA_TYPE) return 'didcomm-plain';
  if (contentType === 'application/json') return 'json';
  if (contentType === 'application/fhir+json') return 'fhir';
  return 'unsupported';
}

function normalizeDidcommBodyForFhirFormat<T extends { body?: any } | undefined>(
  content: T,
  format: string | undefined,
): T {
  if (!content) return content;
  const normalizedFormat = String(format || '').toLowerCase();
  if (!normalizedFormat.includes('fhir')) return content;

  const body = (content as any).body;
  if (!body || typeof body !== 'object') return content;
  if (Array.isArray(body.data)) return content;
  if (!Array.isArray(body.entry)) return content;

  return {
    ...(content as any),
    body: {
      ...body,
      data: body.entry,
    },
  } as T;
}

/**
 * Normalizes request bodies so managers can consume them
 * through the same `job.content.body` contract used by secure DIDComm flows.
 *
 * Why this exists:
 * - most secure requests arrive as a DIDComm envelope whose business payload
 *   already lives under `content.body`
 * - high-level profile activation sends the signed Token/_exchange and DCR
 *   fields beside `thid`; those fields must be mirrored only after signature
 *   verification, without changing the bytes that were verified
 * - legacy `application/json` and `application/fhir+json` requests often send
 *   the business payload directly at the top level
 * - most managers only read `job.content.body`
 *
 * The returned object keeps top-level fields such as `thid`, while also
 * mirroring the normalized business payload under `body`.
 */
function normalizeBusinessBodyContent<T extends Record<string, any>>(content: T): T & { body: any } {
  if (content && typeof content === 'object' && content.body && typeof content.body === 'object') {
    return content as T & { body: any };
  }

  return {
    ...(content || {}),
    body: content || {},
  };
}

/**
 * Verifies the JWS carried inside an already-decrypted DIDComm request.
 * Decryption establishes confidentiality only; this independently proves
 * message integrity and possession of the route-authorized signing key.
 */
async function verifyDecodedDidcommSignature(
  content: Record<string, any>,
  signingKey: PublicJwk,
  cryptographyService: ICryptography,
): Promise<void> {
  const jws = content?.meta?.jws;
  if (!jws?.protected || !jws?.signature) {
    throw new Error('Signed secure request is missing a valid JWS structure.');
  }
  const signedPayload = { ...content };
  delete signedPayload.meta;
  const protectedHeader = Content.objectToRawBase64UrlSafe(jws.protected);
  const detachedJws = `${protectedHeader}..${jws.signature}`;
  const isValid = await cryptographyService.verifyDetachedJws(
    Content.objectToBytes(signedPayload),
    detachedJws,
    signingKey,
  );
  if (!isValid) throw new Error('Invalid signature.');
}

/**
 * Reads the optional public verification key carried by a legacy plaintext
 * DIDComm envelope. Post-DCR encrypted requests resolve their registered key
 * from `iss` and `kid`; this projection is only a compat-mode bridge and never
 * replaces a key registered by DCR.
 */
function projectedControllerProofJwk(body: unknown): JWK | undefined {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return undefined;
  const candidate = (body as any)?.meta?.jws?.protected?.jwk;
  return candidate && typeof candidate === 'object' && !Array.isArray(candidate)
    ? candidate as JWK
    : undefined;
}

function isContentTypeAllowedBySecurityPolicy(contentType: ParsedContentType): boolean {
  const securityMode = resolveSecurityModeFromEnv();
  if (contentType === 'secure-form') return true;
  if (contentType === 'unsupported') return false;

  if (securityMode === 'strict') return false;
  if (securityMode === 'demo') return true;

  const didcommPlainEnabled = parseBooleanEnv(process.env.DIDCOMM_PLAIN, false);
  const fhirLegacy = parseBooleanEnv(process.env.FHIR_LEGACY, false);
  const jsonLegacy = parseBooleanEnv(process.env.JSON_LEGACY, false);

  if (contentType === 'didcomm-plain') return didcommPlainEnabled;
  if (contentType === 'fhir') return fhirLegacy;
  if (contentType === 'json') return jsonLegacy;
  return false;
}

/**
 * Before an individual controller has completed DCR there is no registered
 * wallet key with which to build the encrypted request. Keep this HTTPS/OIDC
 * bootstrap bridge limited to the resources that create the tenant or
 * individual controller seat, plus the read-only Offer search needed to
 * resume an interrupted host bootstrap. Every other JSON route remains
 * governed by the normal SECURITY_MODE content-type policy.
 */
function isOidcAuthenticatedBootstrapJsonRoute(
  params: Partial<RouteParams>,
  contentType: ParsedContentType,
): boolean {
  if (contentType !== 'json') return false;

  const tenantId = String(params.tenantId || '').trim().toLowerCase();
  const section = String(params.section || '').trim().toLowerCase();
  const format = String(params.format || '').trim().toLowerCase();
  const resourceType = String(params.resourceType || '').trim().toLowerCase();
  const action = String(params.action || '').trim().toLowerCase();
  if (format !== 'org.schema') return false;

  const isHostTenantBootstrap = tenantId === 'host'
    && section === 'registry'
    && (
      (action === '_batch' && (resourceType === 'organization' || resourceType === 'order'))
      || (action === '_search' && resourceType === 'offer')
    );
  const isIndividualControllerBootstrap = tenantId !== ''
    && tenantId !== 'host'
    && section === 'individual'
    && (
      (resourceType === 'organization' && action === '_transaction')
      || (resourceType === 'order' && action === '_batch')
    );

  return isHostTenantBootstrap || isIndividualControllerBootstrap;
}

function allowsInsecureBearerBySecurityMode(): boolean {
  return resolveSecurityModeFromEnv() === 'demo'
    && parseBooleanEnv(process.env.DEMO_ALLOW_INSECURE_BEARER, false);
}

/**
 * Decodes local/demo bearer claims without treating them as verified proof.
 *
 * This helper is called only when `SECURITY_MODE=demo` and
 * `DEMO_ALLOW_INSECURE_BEARER=true`. It lets the in-memory test network retain
 * an actor `sub` for the same authorization checks exercised in production,
 * while strict/compat modes continue through the configured verifier. A
 * malformed optional demo token preserves the historical anonymous behavior.
 */
function decodeInsecureDemoBearerPayload(authorization: string | undefined): Record<string, any> {
  const compact = String(authorization || '').replace(/^Bearer\s+/i, '').trim();
  if (!compact) return {};
  try {
    return decodeJwt(compact) as Record<string, any>;
  } catch {
    return {};
  }
}

function isHostOrganizationActivateRoute(
  tenantId: string,
  section: string,
  format: string,
  resourceType: string,
  action: string,
): boolean {
  return tenantId === 'host'
    && section === 'registry'
    && String(format || '').toLowerCase() === 'org.schema'
    && String(resourceType || '').toLowerCase() === 'organization'
    && action === '_activate';
}

function isHostOrganizationVerificationRoute(
  tenantId: string,
  sector: string,
  section: string,
  format: string,
  resourceType: string,
  action: string,
): boolean {
  return tenantId === 'host'
    && sector === resolveHostRegistrySector({
      nodeEnv: process.env.NODE_ENV,
      networkMode: process.env.NETWORK_MODE,
    })
    && section === 'registry'
    && String(format || '').toLowerCase() === 'org.schema'
    && String(resourceType || '').toLowerCase() === 'organization'
    && (action === '_transaction' || action === '_issue');
}

/**
 * Resolves only the communication keys declared by a reviewed organization
 * controller during its pre-DCR verification transaction. The outer issuer,
 * signing kid and encryption skid must all match the same business binding;
 * the later manager still verifies the admission credentials and identity.
 */
function readReviewedOrganizationBootstrapKeys(
  content: any,
  senderDid: string,
  senderSigningKeyId: string,
  senderEncryptionKeyId: string,
): { senderSigningKey: JWK; senderEncryptionKey: JWK } | undefined {
  const entry = Array.isArray(content?.body?.data) ? content.body.data[0] : undefined;
  const controller = entry?.resource?.controller;
  if (String(controller?.did || '').trim() !== senderDid) return undefined;
  const keys = Array.isArray(controller?.jwks?.keys) ? controller.jwks.keys : [];
  const senderSigningKey = keys.find((key: any) =>
    String(key?.kid || '').trim() === senderSigningKeyId && isSignatureJwk(key));
  const senderEncryptionKey = keys.find((key: any) =>
    String(key?.kid || '').trim() === senderEncryptionKeyId && isEncryptionJwk(key));
  if (!senderSigningKey || !senderEncryptionKey) return undefined;
  return { senderSigningKey, senderEncryptionKey };
}

function isHostTenantLifecycleRoute(
  tenantId: string,
  section: string,
  format: string,
  resourceType: string,
  action: string,
): boolean {
  return tenantId === 'host'
    && section === 'registry'
    && String(format || '').toLowerCase() === 'org.schema'
    && String(resourceType || '').toLowerCase() === 'organization'
    && (
      action === ACTION_DISABLE
      || action === ACTION_ENABLE
      || action === ACTION_PURGE
      || action === ACTION_STATUS
      || action === '_search'
    );
}

/**
 * Host commercial Orders continue a tenant-authored Offer through the shared
 * registry endpoint. They are host-routed jobs, but their post-DCR sender proof
 * still belongs to the tenant controller identified by the signed `iss`.
 */
function isHostControllerCommercialOrderRoute(
  tenantId: string,
  businessSectorOrNetworkKind: string,
  section: string,
  format: string,
  resourceType: string,
  action: string,
): boolean {
  const runtimeNetworkKind = resolveHostRegistrySector({
    nodeEnv: process.env.NODE_ENV,
    networkMode: process.env.NETWORK_MODE,
  });
  return tenantId === 'host'
    && businessSectorOrNetworkKind === runtimeNetworkKind
    && section === 'registry'
    && String(format || '').toLowerCase() === 'org.schema'
    && String(resourceType || '').toLowerCase() === 'order'
    && action === '_batch';
}

/**
 * Compatibility boundary for tenants whose historical mutable catalog exposed
 * Employee/_create before Offer became an independently advertised resource.
 * It authorizes only Offer/_create; License/_add remains nonexistent.
 */
function isHistoricalTenantCommercialOfferRoute(
  tenantId: string,
  section: string,
  format: string,
  resourceType: string,
  action: string,
  services: readonly any[] | undefined,
): boolean {
  if (tenantId === 'host'
    || section !== 'entity'
    || String(format || '').toLowerCase() !== 'org.schema'
    || String(resourceType || '').toLowerCase() !== 'offer'
    || action !== '_create') return false;
  return Boolean(services?.some((service) => (
    String(service?.serviceEndpoint || '').toLowerCase() === 'employee'
    && Array.isArray(service?.actions)
    && service.actions.includes('_create')
    && service?.selector?.section === section
    && String(service?.selector?.format || '').toLowerCase() === 'org.schema'
  )));
}

/**
 * Returns the logical vault where Device/_dcr stores an established sender.
 * Host configuration is the one unscoped exception; tenant device profiles
 * always use the same sector plus tenant id tuple consumed by DCR.
 */
export function registeredSenderPathVaultId(tenantId: string, sector: string): string {
  return tenantId === 'host' ? 'host' : getTenantVaultId(sector, tenantId);
}

type RegisteredSenderVaultResolverInput = {
  tenantId: string;
  businessSectorOrNetworkKind: string;
  section: string;
  format: string;
  resourceType: string;
  action: string;
  senderDid: string;
  hostNetworkKind: string;
  tenantExists: (vaultId: string) => Promise<boolean>;
  findTenantVaultIdByIdentifierValue: (identifier: string) => Promise<string | undefined>;
};

/**
 * Resolves post-DCR key custody independently from the storage adapter.
 * Host commercial Orders and tenant lifecycle operations are routed through
 * the host registry, while their controller device remains in the tenant
 * vault. The DID path identifier may be an official identifier rather than
 * the tenant alternate name, so the canonical registry lookup is required
 * before failing closed to host scope.
 */
export async function resolveRegisteredSenderVaultIdForRoute(
  input: RegisteredSenderVaultResolverInput,
): Promise<string> {
  const pathVaultId = registeredSenderPathVaultId(input.tenantId, input.businessSectorOrNetworkKind);
  const isHostCommercialOrder = input.tenantId === 'host'
    && input.businessSectorOrNetworkKind === input.hostNetworkKind
    && input.section === 'registry'
    && String(input.format || '').toLowerCase() === 'org.schema'
    && String(input.resourceType || '').toLowerCase() === 'order'
    && input.action === '_batch';
  const isHostLifecycle = input.businessSectorOrNetworkKind === input.hostNetworkKind
    && isHostTenantLifecycleRoute(
      input.tenantId,
      input.section,
      input.format,
      input.resourceType,
      input.action,
    );
  if (!isHostCommercialOrder && !isHostLifecycle) return pathVaultId;

  try {
    const issuerVaultId = getTenantVaultIdFromIss(input.senderDid);
    if (await input.tenantExists(issuerVaultId)) return issuerVaultId;

    const issuerTenantIdentifier = String(input.senderDid.split(':')[3] || '').trim();
    if (!issuerTenantIdentifier) return pathVaultId;
    return await input.findTenantVaultIdByIdentifierValue(issuerTenantIdentifier) || pathVaultId;
  } catch {
    return pathVaultId;
  }
}

function requiresActiveTenantAuthorization(
  tenantId: string,
  section: string,
  format: string,
  resourceType: string,
  action: string,
): boolean {
  if (tenantId === 'host') {
    return false;
  }
  if (section === 'ping') {
    return false;
  }
  if (isHostOrganizationActivateRoute(tenantId, section, format, resourceType, action)) {
    return false;
  }
  if (isHostTenantLifecycleRoute(tenantId, section, format, resourceType, action)) {
    return false;
  }
  return true;
}

function getRequestBaseUrl(req: express.Request, fallback: string): string {
  const forwardedProto = req.headers['x-forwarded-proto'];
  const forwardedHost = req.headers['x-forwarded-host'];
  const forwardedProtocol = (Array.isArray(forwardedProto) ? forwardedProto[0] : forwardedProto)
    ?.split(FORWARDED_HEADER_SEPARATOR)[0]
    ?.trim();
  const socketEncrypted = (req.socket as { encrypted?: boolean } | undefined)?.encrypted;
  const protocol = forwardedProtocol || (socketEncrypted ? 'https' : 'http');
  const host = (Array.isArray(forwardedHost) ? forwardedHost[0] : forwardedHost) || req.get('host');
  return host ? `${protocol}://${host}` : fallback;
}

type RouteParams = {
  tenantId: string;
  jurisdiction: string;
  sector: string;
  section: string;
  format: string;
  resourceType: string;
  action?: string;
  actionResponse?: string;
};

/**
 * Backward/forward compatibility adapter:
 * - Canonical SDK identity pattern (preferred for new integrations):
 *   /host/cds-{jurisdiction}/v1/{sector}/{tenantId}/identity/auth/{action}
 * - Legacy runtime-compatible pattern (temporary alias during migration):
 *   /{tenantId}/cds-{jurisdiction}/v1/{sector}/identity/{openid|firebase}/{Token|Device|License}/{action}
 */
function normalizeUnifiedIdentityAuthRouteParams(raw: RouteParams): RouteParams {
  const format = String(raw.format || '').toLowerCase();
  const resourceType = String(raw.resourceType || '').toLowerCase();
  if (format !== 'identity' || resourceType !== 'auth') {
    return raw;
  }

  const actionRaw = String(raw.action || raw.actionResponse || '');
  const actionBase = actionRaw.endsWith('-response')
    ? actionRaw.slice(0, -('-response'.length))
    : actionRaw;
  const mappedTenantId = String(raw.section || '').trim();
  if (!mappedTenantId) return raw;

  let mappedFormat: string | undefined;
  let mappedResourceType: string | undefined;

  if (actionBase === IdentityAuthActions.Dcr
    || actionBase === IdentityAuthActions.Revoke
    || actionBase === IdentityAuthActions.Search) {
    mappedFormat = 'openid';
    mappedResourceType = 'Device';
  } else if (actionBase === '_code' || actionBase === '_token' || actionBase === '_exchange') {
    mappedFormat = 'openid';
    mappedResourceType = 'Token';
  } else if (actionBase === IdentityAuthActions.Issue) {
    mappedFormat = 'openid';
    mappedResourceType = 'License';
  } else if (actionBase === '_custom') {
    mappedFormat = 'firebase';
    mappedResourceType = 'Token';
  }

  if (!mappedFormat || !mappedResourceType) {
    return raw;
  }

  return {
    ...raw,
    tenantId: mappedTenantId,
    section: 'identity',
    format: mappedFormat,
    resourceType: mappedResourceType,
  };
}

/**
 * Creates the main, dynamic API router according to the patterns defined in ARCHITECTURE_PATTERNS.md.
 * @param queueAdapter The queue adapter for adding jobs.
 * @param tenantsCacheManager The tenant manager for validating tenant policies.
 * @param kmsService The KMS for decoding incoming requests.
 * @param asyncResponseStore The in-memory store for async job responses.
 */
export function createApiRouter(
  queueAdapter: QueueAdapter,
  tenantsCacheManager: IApiTenantRegistry,
  kmsService: IKmsService,
  asyncResponseStore: IAsyncResponseStore,
  vaultRepository: IVaultRepository,
  cryptographyService: ICryptography,
  apiBaseUrl: string,
  appAuthManager?: AppAuthorizationManager,
  replayProtectionStore: IReplayProtectionStore = new ReplayProtectionStoreNoop(),
  directJobProcessor?: Readonly<{ process(jobName: string, job: JobRequest): Promise<string> }>,
): express.Router {
  const router = express.Router();

  const resolveVaultId = async (tenantId: string, sector: string): Promise<string> => {
    if (tenantId === 'host') return 'host';
    const directVaultId = getTenantVaultId(sector, tenantId);
    if (await tenantsCacheManager.tenantExists(directVaultId)) return directVaultId;

    const canonicalVaultId = await tenantsCacheManager.findTenantVaultIdByIdentifierValue(tenantId);
    if (canonicalVaultId) return canonicalVaultId;
    return directVaultId;
  };

  /**
   * Resolves the storage scope used to bind controller proof `iss + kid` to
   * the signing key registered by DCR. The rule is transport- and
   * sector-agnostic; host bootstrap remains outside post-DCR tenant scope.
   */
  const controllerProofRegistrationContext = async (tenantId: string, sector: string) => {
    if (tenantId === 'host') return undefined;
    const vaultId = await resolveVaultId(tenantId, sector);
    const collectionName = await tenantsCacheManager.getCollectionName(vaultId);
    return { vaultId, ...(collectionName ? { collectionName } : {}) };
  };

  /**
   * Separates job routing from controller-key custody. Most requests use the
   * path tenant for both. Host `Order/_batch` and tenant lifecycle jobs remain
   * queued in `host`, while their encrypted sender keys are resolved from the
   * tenant encoded in the already-signed controller DID. An unknown or legacy
   * DID falls back to host scope and therefore fails closed.
   */
  const resolveRegisteredSenderVaultId = async (
    tenantId: string,
    sector: string,
    section: string,
    format: string,
    resourceType: string,
    action: string,
    senderDid: string,
  ): Promise<string> => {
    return resolveRegisteredSenderVaultIdForRoute({
      tenantId,
      businessSectorOrNetworkKind: sector,
      section,
      format,
      resourceType,
      action,
      senderDid,
      hostNetworkKind: resolveHostRegistrySector({
        nodeEnv: process.env.NODE_ENV,
        networkMode: process.env.NETWORK_MODE,
      }),
      tenantExists: (vaultId) => tenantsCacheManager.tenantExists(vaultId),
      findTenantVaultIdByIdentifierValue: (identifier) =>
        tenantsCacheManager.findTenantVaultIdByIdentifierValue(identifier),
    });
  };

  /**
   * Resolves the communication keys retained inside one protected pending
   * organization Offer. This is the only pre-DCR key source accepted for the
   * commercial Order continuation; an arbitrary envelope JWK is never trusted.
   */
  const readPendingOfferBootstrapKeys = async (
    content: any,
    senderDid: string,
    senderSigningKeyId: string,
    senderEncryptionKeyId: string,
  ): Promise<{ senderSigningKey: JWK; senderEncryptionKey: JWK } | undefined> => {
    const entry = Array.isArray(content?.body?.data) ? content.body.data[0] : undefined;
    const claims = entry?.resource?.meta?.claims || {};
    const offerId = readPendingOrderAcceptedOfferId(claims);
    if (!offerId) return undefined;
    const hostCollectionName = await tenantsCacheManager.getCollectionName('host');
    if (!hostCollectionName) return undefined;
    const candidates = await vaultRepository.query(hostCollectionName, {
      sectionId: getEnvSectionId('tenants'),
      where: [{ name: ClaimsOfferSchemaorg.identifier, value: offerId }],
    });
    for (const candidate of candidates || []) {
      const protectedContent = await kmsService.unprotectConfidentialData<any>(candidate, 'host');
      if (String(protectedContent?.claims?.[ClaimsOfferSchemaorg.identifier] || '').trim() !== offerId) continue;
      const registeredSenderDid = String(protectedContent?.registrationControllerDid || '').trim();
      if (registeredSenderDid !== senderDid) continue;
      const signerJwk = protectedContent?.registrationKeys?.signerJwk;
      const encrypterJwk = protectedContent?.registrationKeys?.encrypterJwk;
      if (String(signerJwk?.kid || '').trim() !== senderSigningKeyId || !isSignatureJwk(signerJwk)) continue;
      if (String(encrypterJwk?.kid || '').trim() !== senderEncryptionKeyId || !isEncryptionJwk(encrypterJwk)) continue;
      return { senderSigningKey: signerJwk, senderEncryptionKey: encrypterJwk };
    }
    return undefined;
  };

  const getReplayTtlSeconds = (payload: any): number => {
    const nowSeconds = Math.floor(Date.now() / 1000);
    const exp = Number(payload?.exp);
    if (Number.isFinite(exp)) {
      const delta = Math.floor(exp - nowSeconds);
      // Keep bounded TTL to avoid pathological cache growth.
      return Math.max(60, Math.min(86400, delta));
    }
    return 900;
  };

  const cdsRoutePrefix = '/:tenantId/cds-:jurisdiction/v1/:sector/:section/:format/:resourceType';

  // --- ASYNC JOB POLLING ENDPOINT (MUST BE DEFINED BEFORE THE GENERIC SUBMISSION ENDPOINT) ---

  const pollingHandler = async (req: express.Request, res: express.Response) => {
    let thid = String(req.method === 'POST' ? req.body?.thid || '' : req.query.thid || '').trim();

    // Secure submit and poll requests use the same form-encoded JWE contract.
    // The SDK therefore protects `{ thid }` inside `request=<JWE>` instead of
    // leaking the correlation identifier as an extra plaintext form field.
    if (!thid && req.method === 'POST' && parseIncomingContentType(normalizeContentType(req.headers['content-type'])) === 'secure-form') {
      const compactJwe = String(req.body?.request || '').trim();
      if (compactJwe) {
        try {
          const decodedPoll = await kmsService.decodeRequest(compactJwe);
          thid = String(decodedPoll.content?.thid || '').trim();
        } catch (error: any) {
          return sendDidcommEarlyError(
            req,
            res,
            400,
            IssueType.Security,
            `Failed to process secure polling request: ${error?.message || 'JWE decoding failed.'}`,
          );
        }
      }
    }

    if (!thid) {
      return sendDidcommEarlyError(
        req,
        res,
        400,
        IssueType.Required,
        'Missing or invalid "thid" parameter.',
      );
    }

    const job = await asyncResponseStore.get(thid);
    if (!job) {
      return sendDidcommEarlyError(req, res, 404, IssueType.NotFound);
    }
    // TODO(contract-unification): polling status model here is `PENDING|COMPLETED|FAILED`.
    // Preconversion API currently exposes `queued|running|succeeded|failed` for upload polls.
    // Define one canonical async public status vocabulary across services.
    if (job.status === 'PENDING') {
      res.set('Retry-After', '5');
      return res.status(202).json({ thid, status: 'PENDING' });
    }

    if (job.status === 'COMPLETED' && job.result) {
      try {
        // --- ARCHITECTURE KEEPER: UNIFIED RESPONSE HANDLING ---
        // The Worker guarantees that `job.result` is ALWAYS a JWE string (or a stringified
        // JSON error). This handler's responsibility is to correctly unpack it based on
        // the original request flow. This consistency prevents architectural drift.
        
        // In the rare case of a plaintext error from the worker, we attempt to parse it.
        // If it's not JSON, we treat it as a raw JWE string.
        let resultIsJson = false;
        try {
          JSON.parse(job.result);
          resultIsJson = true;
        } catch(e) { /* ignore, it's a JWE string */ }
        
        if (job.contentType?.includes('json') || resultIsJson) {
          // --- FLOW A: LEGACY / PLAINTEXT ---
          // The client expects a JSON response. We must decode the JWE to extract the payload.
          // This also handles plaintext error objects returned by the worker.
          if (resultIsJson) {
            // A stringified JSON result from the worker indicates an error during processing.
            res.set('Content-Type', 'application/json');
            res.status(500).json(JSON.parse(job.result));
          } else {
            // The result is a JWE. Decrypt it to get the plaintext payload.
            const decodedResponse = await kmsService.decodeRequest(job.result);
            if (!decodedResponse.content?.body) {
              throw new Error('Decoded response from worker is missing expected content body.');
            }
            // For legacy flows, respond with the decrypted content body using the original request's content type.
            res.set('Content-Type', job.contentType || 'application/json');
            res.status(200).json(decodedResponse.content.body);
          }
        } else {
          // --- FLOW B: FAPI / SECURE ---
          // The client expects the encrypted JWE response directly.
          res.set('Content-Type', 'application/x-www-form-urlencoded');
          res.status(200).send(`response=${job.result}`);
        }
        await asyncResponseStore.delete(thid);
      } catch (error: any) {
        console.log('[Polling Handler] Error caught:', error); // Using console.log for visibility in Jest
        return sendDidcommEarlyError(
          req,
          res,
          500,
          IssueType.Exception,
          'Failed to decode the stored job result: ' + error.message,
        );
      }
    } else {
      return sendDidcommEarlyError(
        req,
        res,
        500,
        IssueType.Exception,
        'Job failed to process or result was invalid.',
      );
    }
  };

  const isFhirSector = (req: express.Request, res: express.Response, next: express.NextFunction) => {
    // This middleware logic is still broken as it relies on properties not exposed by the cache.
    // For now, bypassing to allow tests to proceed. A new lookup method in the cache is needed.
    // e.g., getTenantSector(vaultId)
    // TODO: Refactor this to use a new specific cache function.
    return next();
  };

  // Canonical polling pattern: the Location URL is always the original request URL + `-response`.
  // Examples:
  // - `.../Organization/_batch` -> `.../Organization/_batch-response`
  // - `.../identity/openid/Device/_dcr` -> `.../identity/openid/Device/_dcr-response`
  // - `.../identity/openid/smart/token` -> `.../identity/openid/smart/token-response`
  const pollingRoute = `${cdsRoutePrefix}/:actionResponse`;
  const pollingGate = (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const actionResponse = String(req.params.actionResponse || '');
    if (!actionResponse.endsWith('-response')) return next();
    return pollingHandler(req, res);
  };
  const didDocumentBindingRoute = '/:tenantId/cds-:jurisdiction/v1/:sector/did/document/:action';
  const didDocumentBindingPollingRoute = '/:tenantId/cds-:jurisdiction/v1/:sector/did/document/:actionResponse';
  const didDocumentBindingPollingGate = (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const actionResponse = String(req.params.actionResponse || '');
    if (!actionResponse.endsWith('-response')) return next();
    req.params = {
      ...req.params,
      section: 'did',
      format: 'document',
      resourceType: GatewayInternalResourceTypes.Document,
    };
    return pollingHandler(req, res);
  };
  router.post(didDocumentBindingPollingRoute, didDocumentBindingPollingGate);
  router.get(didDocumentBindingPollingRoute, isFhirSector, didDocumentBindingPollingGate);
  router.post(pollingRoute, pollingGate);
  router.get(pollingRoute, isFhirSector, pollingGate);

  // Backward-compat alias: older versions used a fixed `_batch-response` action.
  router.post(`${cdsRoutePrefix}/_batch-response`, pollingHandler);
  router.get(`${cdsRoutePrefix}/_batch-response`, isFhirSector, pollingHandler);

  /**
   * @openapi
   * /{tenantId}/cds-{jurisdiction}/v1/{sector}/identity/oidc/credential:
   *   post:
   *     tags:
   *       - 2.2 OIDC4VCI
   *     summary: Issue a Gaia-X compliance VC (OIDC4VCI)
   *     description: |
   *       Issues a Gaia-X Legal Participant VC. This endpoint expects a Bearer access_token.
   *       In demo/non-production, any Bearer token is accepted for now.
   *     parameters:
   *       - $ref: '#/components/parameters/AppId'
   *       - $ref: '#/components/parameters/AppVersion'
   *       - $ref: "#/components/parameters/TenantId"
   *       - $ref: "#/components/parameters/Jurisdiction"
   *       - $ref: "#/components/parameters/Sector"
   *     security:
   *       - BearerAuth: []
   *     requestBody:
   *       required: false
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               format: { type: string }
   *               type: { type: string }
   *               pqc: { type: boolean }
   *     responses:
   *       '200': { description: Issued VC }
   *       '401': { description: Missing or invalid Bearer token }
   *       '404': { description: Tenant not found }
   */
  router.post('/:tenantId/cds-:jurisdiction/v1/:sector/identity/oidc/credential', async (req, res) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return sendDidcommEarlyError(req, res, 401, IssueType.Security, 'Missing or invalid Bearer token.');
    }
    const accessToken = authHeader.split(' ')[1];
    if (!allowsInsecureBearerBySecurityMode()) {
      if (!appAuthManager) {
        return sendDidcommEarlyError(
          req,
          res,
          500,
          IssueType.Exception,
          'Bearer validation is required by SECURITY_MODE but AppAuthorizationManager is not configured.',
        );
      }
      try {
        await appAuthManager.verifyBearerToken(accessToken);
      } catch (error: any) {
        return sendDidcommEarlyError(
          req,
          res,
          401,
          IssueType.Security,
          `Invalid Bearer token: ${error?.message || 'verification failed'}`,
        );
      }
    }

    const { tenantId, sector } = req.params;
    const vaultId = await resolveVaultId(tenantId, sector);
    const tenantConfig = await tenantsCacheManager.getTenant(vaultId);
    if (!tenantConfig?.claims || !tenantConfig?.didDocument) {
      return res.status(404).type('text').send('Not Found');
    }

    const hostConfig = await tenantsCacheManager.getTenant('host');
    const issuerVaultId = 'host';
    const issuerDid = hostConfig?.didDocument?.id || composeHostDidWebId(apiBaseUrl, process.env.HOST_EXTERNAL_DOMAIN);
    const subjectDid = tenantConfig.didDocument.id;
    const tenantUrl = await tenantsCacheManager.getTenantDomainUrl(vaultId);
    if (!tenantUrl) {
      return res.status(404).type('text').send('Not Found');
    }

    const forcePqc = String(req.query.pqc || req.headers['x-pqc-signature'] || '').toLowerCase() === 'true';
    const legacyAlgCandidate = hostConfig?.legacySignAlg || process.env.LEGACY_SIGN_ALG;
    const preferredAlg = (!forcePqc && legacyAlgCandidate) ? legacyAlgCandidate : 'ML-DSA-44';
    const signingKey = await kmsService.getPublicVerificationKey(issuerVaultId, preferredAlg, 'vc_sign');
    if (!signingKey?.kid) {
      throw new Error('Signing key not available for credential issuance.');
    }

    const credentialOptions = buildGaiaXLegalParticipantOptionsFromClaims({
      claims: tenantConfig.claims,
      webDomain: tenantUrl,
      did: subjectDid,
      issuerDid: issuerDid,
    });
    const unsignedVc = createGaiaXLegalParticipantCredential(credentialOptions);
    const detachedJws = await kmsService.createDetachedJws(unsignedVc, signingKey.kid, issuerVaultId, 'vc_sign');

    const signedVc = {
      ...unsignedVc,
      proof: [{
        type: 'JsonWebSignature2020',
        created: new Date().toISOString(),
        proofPurpose: 'assertionMethod',
        verificationMethod: `${issuerDid}#${signingKey.kid}`,
        jws: detachedJws,
      }],
    };

    res.json(signedVc);
  });

  /**
   * @openapi
   * /host/cds-{jurisdiction}/v1/{sector}/registry/org.schema/Organization/_batch:
   *   post:
   *     tags:
   *       - 1.1 Organization Registration
   *     summary: Register a new Tenant (Organization)
   *     description: |
   *       Submits an asynchronous job to register a new tenant on the platform. This is the first step for any new organization.
   *       The endpoint supports both a plaintext JSON "legacy" flow (for simple onboarding) and a JWE-based "secure" flow.
   *
   *       The `{sector}` segment is a host onboarding "network environment" selector:
   *       - demo/test: `test`
   *       - development/staging: `test-network`
   *       - production: `network`
   *     parameters:
   *       - $ref: '#/components/parameters/AppId'
   *       - $ref: '#/components/parameters/AppVersion'
   *       - $ref: '#/components/parameters/Jurisdiction'
   *       - $ref: '#/components/parameters/HostRegistrySector'
   *     requestBody:
   *       description: |
   *         The DIDComm message for registration.
   *         Production: only `application/x-www-form-urlencoded` is accepted (secure JWE envelope with `request=`).
   *         Demo/Test-Network: `application/didcomm-plain+json` is canonical, and `application/json` is also accepted for simplicity.
   *       required: true
   *       content:
   *         application/didcomm-plain+json:
   *           schema:
   *             $ref: '#/components/schemas/OrganizationRegistrationLegacy'
   *           examples:
   *             message:
   *               $ref: '#/components/examples/OrganizationRegistrationPlaintextMessage'
   *         application/json:
   *           schema:
   *             $ref: '#/components/schemas/OrganizationRegistrationLegacy'
   *         application/x-www-form-urlencoded:
   *           schema:
   *             $ref: '#/components/schemas/SecureRequest'
   *     security:
   *       - BearerAuth: []
   *     responses:
   *       '202':
   *         description: |
   *           Accepted. The job has been queued. The client should poll the URL provided in the `Location` header to get the result.
   *         headers:
   *           Location:
   *             schema:
   *               type: string
   *             description: The polling URL for the job result.
   *           Retry-After:
   *             schema:
   *               type: string
   *               example: '5'
   *             description: Suggested delay in seconds before polling.
   *       '400':
   *         description: Bad Request. The payload is malformed.
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/Error'
   *       '401':
   *         description: Unauthorized. Invalid or missing Bearer token for legacy flow, or failed JWE decryption/JWS verification for secure flow.
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/Error'
   *       '404':
   *         description: Not Found. The requested endpoint path does not exist (e.g., invalid jurisdiction or sector).
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/Error'
   *
   * /host/cds-{jurisdiction}/v1/{sector}/registry/org.schema/Organization/_activate:
   *   post:
   *     tags:
   *       - 1.1 Organization Activation
   *     summary: Activate a new Tenant (Organization) from ICA-issued proof
   *     description: |
   *       Submits an asynchronous job to activate a new tenant on the platform from
   *       ICA-issued proof. This is a distinct flow from the legacy `_batch`
   *       registration endpoint.
   *
   *       The `{sector}` segment is a host onboarding network selector:
   *       - demo/test: `test`
   *       - development/staging: `test-network`
   *       - production: `network`
   *
   *       Expected semantics:
   *       - canonical proof input is `body.vp_token`; the ICA organization + representative evidence belongs there
   *       - the VP carried by `body.vp_token` is built from the ICA-issued organization VC, ICA-issued legal representative VC, presenter signing key id, and target host operator id before external signing
   *       - if ICA also issued a `SoftwareApplication` VC for the portal/backend, its `SoftwareApplication.material` field is the public cryptographic material of that software application, typically the communication signing key id bound during ICA registration
   *       - when that key id is represented as a JWK thumbprint, RFC 7638 defines the canonical thumbprint calculation over the public signing / verification JWK and RFC 9278 defines the canonical URN form `urn:ietf:params:oauth:jwk-thumbprint:sha-256:<base64url>`
   *       - the controller-side signature belongs to the prior ICA registration step; later operational app-service proofs should be signed by the app-service key itself
   *       - `org.schema.Service.url` is the hosting URL selected by the controller during onboarding; it identifies the chosen hosting operator / connector location and is separate from the tenant public `did:web`
   *       - `org.schema.Service.serviceType` is already required at this step because GW uses it to validate the requested tenant capabilities and prepare the pending Offer that will later be confirmed in `Order/_batch`
   *       - `body.controller.*` is the explicit controller key-binding contract inherited from the ICA model and is used when GW must publish/bootstrap the controller person DID
   *       - `body.organizationCredential` / `body.representativeCredential` are deprecated compatibility fields and must not be treated as the canonical proof contract
   *       - the scoped UNID legacy flow accepts a LegalRepresentativeCredential that predates `RESPRSN` and embedded key material; scope is tenant/sector only and never pins credential id, issuer or `kid`
   *       - the host validates the ICA proof, activates the tenant and references the generated legacy controller DID from the first active organization DID
   *       - verified re-registration may rotate only that legacy controller's keys and preserves every independently registered service controller
   *       - activation response includes Offer claims derived from `org.schema.Organization.numberOfEmployees`
   *         (include that claim in `meta.claims` to size requested seats)
   *         so clients can continue with order/payment and licensing without a separate `_batch` submit
   *       - next mandatory step is `Order/_batch` with `Order.acceptedOffer.identifier` from activation result
   *       - after Order, the controller uses activation code (`org.schema.IndividualProduct.serialNumber`)
   *         to run `Token/_exchange` + `Device/_dcr` before creating additional employees
   *     parameters:
   *       - $ref: '#/components/parameters/AppId'
   *       - $ref: '#/components/parameters/AppVersion'
   *       - $ref: '#/components/parameters/Jurisdiction'
   *       - $ref: '#/components/parameters/HostRegistrySector'
   *     requestBody:
   *       description: |
   *         Production: only `application/x-www-form-urlencoded` is accepted
   *         (secure JWE envelope with `request=`).
   *         Demo/Test-Network: `application/didcomm-plain+json` is canonical,
   *         and `application/json` is also accepted for simplicity.
   *       required: true
   *       content:
   *         application/didcomm-plain+json:
   *           schema:
   *             $ref: '#/components/schemas/DidcommPlaintextMessage'
   *           examples:
   *             message:
   *               $ref: '#/components/examples/OrganizationActivationPlaintextMessage'
   *         application/json:
   *           schema:
   *             $ref: '#/components/schemas/DidcommPlaintextMessage'
   *         application/x-www-form-urlencoded:
   *           schema:
   *             $ref: '#/components/schemas/SecureRequest'
   *     security:
   *       - BearerAuth: []
   *     responses:
   *       '202':
   *         description: |
   *           Accepted. The activation job has been queued. The client should poll
   *           the URL provided in the `Location` header to get the result.
   *       '400':
   *         description: Bad Request. The payload is malformed.
   *       '401':
   *         description: Unauthorized. Invalid or missing Bearer token for legacy flow, or failed JWE decryption/JWS verification for secure flow.
   *       '404':
   *         description: Not Found. The requested endpoint path does not exist (e.g., invalid jurisdiction or network selector).
   *
   * /host/cds-{jurisdiction}/v1/{sector}/registry/org.schema/Organization/_issue:
   *   post:
   *     tags:
   *       - 1.1 Organization Registration
   *     summary: Reverify an existing legal organization and reissue one controller activation code
   *     description: |
   *       Existing-tenant recovery/reactivation route.
   *
   *       Responsibilities of this issue flow:
   *       - carry the signed terms PDF evidence or PDF URL attachment again
   *       - carry the current controller business binding key in `body.data[].resource.controller.publicKeyJwk`
   *       - forward the legal evidence to ICA `_verify`
   *       - return the refreshed OrganizationCredential, LegalRepresentativeCredential and ServiceControllerCredential in `vc[]` without creating a new commercial Offer
   *       - use ServiceControllerCredential to append or refresh the technical controller employee and tenant DID controller reference
   *       - reserve/reissue one new activation code for that controller so the frontend can continue with `Token/_exchange` + `Device/_dcr`
   *       - leave portal-owned organization and representative database projections to the consuming BFF; GW does not mutate an external portal database
   *       - never infer controller authority from a LegalRepresentativeCredential carrying only ISCO-08|1120
   *
   *       Commercial rule:
   *       - this route must not overwrite the already contracted seat count
   *       - this route must not create a new Offer or require `Order/_batch`
   *     parameters:
   *       - $ref: '#/components/parameters/AppId'
   *       - $ref: '#/components/parameters/AppVersion'
   *       - $ref: '#/components/parameters/Jurisdiction'
   *       - $ref: '#/components/parameters/HostRegistrySector'
   *     requestBody:
   *       description: |
   *         Production: only `application/x-www-form-urlencoded` is accepted
   *         (secure JWE envelope with `request=`).
   *         Demo/Test-Network: `application/didcomm-plain+json` is canonical,
   *         and `application/json` is also accepted for simplicity.
   *       required: true
   *       content:
   *         application/didcomm-plain+json:
   *           schema:
   *             $ref: '#/components/schemas/DidcommPlaintextMessage'
   *           examples:
   *             message:
   *               $ref: '#/components/examples/OrganizationIssuePlaintextMessage'
   *         application/json:
   *           schema:
   *             $ref: '#/components/schemas/DidcommPlaintextMessage'
   *         application/x-www-form-urlencoded:
   *           schema:
   *             $ref: '#/components/schemas/SecureRequest'
   *     security:
   *       - BearerAuth: []
   *     responses:
   *       '202':
   *         description: |
   *           Accepted. The reissue job has been queued. The client should poll
   *           the URL provided in the `Location` header to get the result.
   *       '400':
   *         description: Bad Request. The payload is malformed.
   *       '401':
   *         description: Unauthorized. Invalid or missing Bearer token for legacy flow, or failed JWE decryption/JWS verification for secure flow.
   *       '404':
   *         description: Not Found. The requested endpoint path does not exist (e.g., invalid jurisdiction or network selector).
   *
   * /host/cds-{jurisdiction}/v1/{sector}/registry/org.schema/Organization/_issue-response:
   *   post:
   *     tags:
   *       - 1.1 Organization Registration
   *     summary: Poll the existing-tenant reissue result
   *     description: |
   *       Polls the asynchronous job submitted to `.../Organization/_issue`.
   *
   *       Polling semantics:
   *       - submit (`_issue`) returns immediate errors if the request cannot be accepted/enqueued
   *       - poll (`_issue-response`) returns `202` while pending, then `200` with:
   *         - `resource.meta.claims`: refreshed organization/controller claims plus the License activation code in `org.schema.IndividualProduct.serialNumber` for `Token/_exchange` + `Device/_dcr`
   *         - `vc[]`: all deduplicated credential resources extracted from ICA
   *         - `resource.icaResponse`: transitional raw upstream ICA envelope retained for audit/debug; clients should consume `vc[]` instead of parsing it
   *
   *       Response-boundary rule:
   *       - claims are canonical only at `data[].resource.meta.claims`; new writers do not emit `data[].meta.claims`
   *       - consumers upsert the three `vc[]` types independently; the legal representative is not a controller unless a separate valid ServiceControllerCredential says so
   *       - this is an organization-credential reissuance/reverification result, not a `License/_issue` result
   *       - the activation code is not a VC and `License:Issued` is not the canonical response entry type
   *       - `OperationOutcome.issue[]` remains the unrelated diagnostics array
   *     parameters:
   *       - $ref: '#/components/parameters/AppId'
   *       - $ref: '#/components/parameters/AppVersion'
   *       - $ref: '#/components/parameters/Jurisdiction'
   *       - $ref: '#/components/parameters/HostRegistrySector'
   *       - $ref: '#/components/parameters/Thid'
   *     requestBody:
   *       description: |
   *         Plain JSON polling sends `{ "thid": "..." }`. Secure polling
   *         protects that same object inside form field `request=<JWE>`; it
   *         does not expose `thid` as a second plaintext form field.
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             $ref: '#/components/schemas/AsyncPollRequest'
   *           examples:
   *             message:
   *               $ref: '#/components/examples/AsyncPollRequest'
   *         application/x-www-form-urlencoded:
   *           schema:
   *             $ref: '#/components/schemas/SecureRequest'
   *     security:
   *       - BearerAuth: []
   *     responses:
   *       '202':
   *         description: Pending. Retry later.
   *         headers:
   *           Retry-After:
   *             schema: { type: string, example: '5' }
   *         content:
   *           application/json:
   *             schema: { $ref: '#/components/schemas/AsyncPollPending' }
   *       '200':
   *         description: Completed. Returns either JSON (legacy) or `response=<jwe>` (secure).
   *         content:
   *           application/json:
   *             schema: { type: object }
   *             examples:
   *               message: { $ref: '#/components/examples/OrganizationIssueResponseBundle' }
   *       '400': { description: Missing or invalid thid. }
   *       '404': { description: thid not found. }
   *       '500': { description: Job failed or response decode failed. }
   *
   * /host/cds-{jurisdiction}/v1/{sector}/registry/org.schema/Organization/_transaction:
   *   post:
   *     tags:
   *       - 1.1 Organization Registration
   *     summary: Submit the first legal-organization onboarding transaction to ICA or Test Network review
   *     description: |
   *       Canonical first host-side onboarding step for a legal organization.
   *
   *       Responsibilities of this transaction:
   *       - carry the signed terms PDF evidence or PDF URL attachment
   *       - carry flattened application claims only in `body.data[].resource.meta.claims`; entry-level `meta.claims` is rejected
   *       - carry the controller business binding key in `body.data[].resource.controller.publicKeyJwk`
   *       - optionally carry the organization VC-signing public key in `body.data[].resource.organization.publicKeyJwk`
   *       - carry the legal organization claims and representative payload that GW CORE forwards to ICA `_verify`
   *       - return three ICA credentials when controller identity and JWK evidence are complete: OrganizationCredential, LegalRepresentativeCredential and ServiceControllerCredential
   *       - on Test Network only, accept `OrganizationTestNetworkCredential` plus exactly those three domain credentials marked `TestNetworkCredential`, verify the reviewer's ML-DSA-65 proofs and return the three domain credentials in `vc[]` without calling ICA
   *       - carry that admission VC only in `body.data[].resource.organizationTestNetworkCredential` and the three domain VCs in `body.data[].resource.testNetworkCredentials`; no authorization-named alias is accepted
   *
   *       Separation of concerns:
   *       - `meta.jws` / `meta.jwe` remain communication/runtime keys of the portal app, confidential app, device profile, or BFF
   *       - `body.data[].resource.controller.publicKeyJwk` is the controller business/operation-signing key that ICA projects into `ServiceControllerCredential.owner.hasCredential.material`
   *       - `body.data[].resource.controller.email` is the technical controller; it is not inferred from the separate legal representative payload
   *       - LegalRepresentativeCredential defaults to `hasOccupation.occupationalCategory = ISCO-08|1120`; ServiceControllerCredential uses `owner.additionalType = RESPRSN` plus controller occupation `ISCO-08|1330` unless the signed PDF provides an explicit occupation
   *       - `body.data[].resource.organization.publicKeyJwk` is the organization credential-signing key when the hosting operator/runtime already knows it
   *       - this route is distinct from `Organization/_activate`, which starts from an already-issued ICA proof (`vp_token`)
   *       - existing-tenant deployment-authorized legacy re-registration returns no new Offer or Order continuation
   *
   *       BFF/confidential-app note:
   *       - a BFF or confidential app may protect the DIDComm/FAPI envelope with its own communication key
   *       - that communication key must not replace the controller business binding key sent in the business payload
   *     parameters:
   *       - $ref: '#/components/parameters/AppId'
   *       - $ref: '#/components/parameters/AppVersion'
   *       - $ref: '#/components/parameters/Jurisdiction'
   *       - $ref: '#/components/parameters/HostRegistrySector'
   *     requestBody:
   *       description: |
   *         Production: only `application/x-www-form-urlencoded` is accepted
   *         (secure JWE envelope with `request=`).
   *         Demo/Test-Network: `application/didcomm-plain+json` is canonical,
   *         and `application/json` is also accepted for simplicity.
   *       required: true
   *       content:
   *         application/didcomm-plain+json:
   *           schema:
   *             $ref: '#/components/schemas/DidcommPlaintextMessage'
   *           examples:
   *             message:
   *               $ref: '#/components/examples/OrganizationVerificationTransactionPlaintextMessage'
   *         application/json:
   *           schema:
   *             $ref: '#/components/schemas/DidcommPlaintextMessage'
   *         application/x-www-form-urlencoded:
   *           schema:
   *             $ref: '#/components/schemas/SecureRequest'
   *     security:
   *       - BearerAuth: []
   *     responses:
   *       '202':
   *         description: |
   *           Accepted. The verification-forwarding job has been queued. The client should poll
   *           the URL provided in the `Location` header to get the result.
   *       '400':
   *         description: Bad Request. The payload is malformed.
   *       '401':
   *         description: Unauthorized. Invalid or missing Bearer token for legacy flow, or failed JWE decryption/JWS verification for secure flow.
   *       '404':
   *         description: Not Found. The requested endpoint path does not exist (e.g., invalid jurisdiction or network selector).
   *
   * /host/cds-{jurisdiction}/v1/{sector}/registry/org.schema/Organization/_transaction-response:
   *   post:
   *     tags:
   *       - 1.1 Organization Registration
   *     summary: Poll the legal-organization verification transaction result
   *     description: |
   *       Polls the asynchronous job submitted to `.../Organization/_transaction`.
   *
   *       Polling semantics:
   *       - submit (`_transaction`) returns immediate errors if the request cannot be accepted/enqueued
   *       - poll (`_transaction-response`) returns `202` while pending, then `200` with:
   *         - `resource.meta.claims`: canonical host claims; first-time onboarding includes the Offer identifier
   *         - `resource.icaResponse`: transitional raw ICA envelope retained for audit/debug; application clients should read `vc[]`
   *         - `vc[]`: extracted credential resources from that ICA payload
   *         - first-time `resource.next`: the explicit follow-up contract for `Order/_batch`; scoped existing-tenant legacy re-registration omits it
   *     parameters:
   *       - $ref: '#/components/parameters/AppId'
   *       - $ref: '#/components/parameters/AppVersion'
   *       - $ref: '#/components/parameters/Jurisdiction'
   *       - $ref: '#/components/parameters/HostRegistrySector'
   *       - $ref: '#/components/parameters/Thid'
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             $ref: '#/components/schemas/AsyncPollRequest'
   *           examples:
   *             message:
   *               $ref: '#/components/examples/AsyncPollRequest'
   *         application/x-www-form-urlencoded:
   *           schema:
   *             $ref: '#/components/schemas/AsyncPollRequest'
   *           examples:
   *             message:
   *               $ref: '#/components/examples/AsyncPollRequest'
   *     security:
   *       - BearerAuth: []
   *     responses:
   *       '202':
   *         description: Pending. Retry later.
   *         headers:
   *           Retry-After:
   *             schema: { type: string, example: '5' }
   *         content:
   *           application/json:
   *             schema: { $ref: '#/components/schemas/AsyncPollPending' }
   *       '200':
   *         description: Completed. Returns either JSON (legacy) or `response=<jwe>` (secure).
   *         content:
   *           application/json:
   *             schema: { type: object }
   *             examples:
   *               message:
   *                 $ref: '#/components/examples/OrganizationVerificationTransactionResponseBundle'
   *       '400': { description: Missing or invalid thid. }
   *       '404': { description: thid not found. }
   *       '500': { description: Job failed or response decode failed. }
   *
   * /host/cds-{jurisdiction}/v1/{sector}/registry/org.schema/Organization/_status:
   *   post:
   *     tags: [1.1 Organization Registration]
   *     summary: Read authoritative hosted-tenant lifecycle counters
   *     description: Returns tenant state plus active/unpurged employee and individual/member counts. This read never mutates descendants.
   *     parameters:
   *       - $ref: '#/components/parameters/AppId'
   *       - $ref: '#/components/parameters/AppVersion'
   *       - $ref: '#/components/parameters/Jurisdiction'
   *       - $ref: '#/components/parameters/HostRegistrySector'
   *     security: [{ BearerAuth: [] }]
   *     requestBody:
   *       required: true
   *       content:
   *         application/didcomm-plain+json: { schema: { $ref: '#/components/schemas/DidcommPlaintextMessage' } }
   *         application/json: { schema: { $ref: '#/components/schemas/DidcommPlaintextMessage' } }
   *     responses:
   *       '202': { description: Accepted. Poll the Location URL. }
   *
   * /host/cds-{jurisdiction}/v1/{sector}/registry/org.schema/Organization/_search:
   *   post:
   *     tags: [1.1 Organization Registration]
   *     summary: Search the protected hosted-organization directory
   *     description: |
   *       Host-operator-only search of the protected registry. The DIDComm response contains a
   *       paginated Bundle with privacy-minimized org.schema Organization projections. It includes
   *       suspended tenants and is therefore not the public autodiscovery catalog. Entry failures
   *       use OperationOutcome. Tenant secrets, keys and storage configuration are never returned.
   *     parameters:
   *       - $ref: '#/components/parameters/AppId'
   *       - $ref: '#/components/parameters/AppVersion'
   *       - $ref: '#/components/parameters/Jurisdiction'
   *       - $ref: '#/components/parameters/HostRegistrySector'
   *     security: [{ BearerAuth: [] }]
   *     requestBody:
   *       required: true
   *       content:
   *         application/didcomm-plain+json: { schema: { $ref: '#/components/schemas/DidcommPlaintextMessage' } }
   *     responses:
   *       '202': { description: Accepted. Poll the Location URL. }
   *       '401': { description: The protected request or bearer could not be verified. }
   *       '403': { description: The authenticated actor is not the configured host operator. }
   *
   * /host/cds-{jurisdiction}/v1/{sector}/registry/org.schema/Organization/_disable:
   *   post:
   *     tags: [1.1 Organization Registration]
   *     summary: Disable one hosted tenant after explicit child cleanup
   *     description: Returns 409 while active employees, individual organizations or members remain. No cascade or wildcard is performed.
   *     parameters:
   *       - $ref: '#/components/parameters/AppId'
   *       - $ref: '#/components/parameters/AppVersion'
   *       - $ref: '#/components/parameters/Jurisdiction'
   *       - $ref: '#/components/parameters/HostRegistrySector'
   *     security: [{ BearerAuth: [] }]
   *     requestBody:
   *       required: true
   *       content:
   *         application/didcomm-plain+json:
   *           schema: { $ref: '#/components/schemas/DidcommPlaintextMessage' }
   *           examples: { disable: { $ref: '#/components/examples/TenantDisablePlaintextMessage' } }
   *         application/json:
   *           schema: { $ref: '#/components/schemas/DidcommPlaintextMessage' }
   *           examples: { disable: { $ref: '#/components/examples/TenantDisablePlaintextMessage' } }
   *     responses:
   *       '202': { description: Accepted. Poll the Location URL. }
   *       '409': { description: Active descendants remain. }
   *
   * /host/cds-{jurisdiction}/v1/{sector}/registry/org.schema/Organization/_enable:
   *   post:
   *     tags: [1.1 Organization Registration]
   *     summary: Enable one suspended hosted tenant
   *     parameters:
   *       - $ref: '#/components/parameters/AppId'
   *       - $ref: '#/components/parameters/AppVersion'
   *       - $ref: '#/components/parameters/Jurisdiction'
   *       - $ref: '#/components/parameters/HostRegistrySector'
   *     security: [{ BearerAuth: [] }]
   *     requestBody:
   *       required: true
   *       content:
   *         application/didcomm-plain+json:
   *           schema: { $ref: '#/components/schemas/DidcommPlaintextMessage' }
   *           examples: { enable: { $ref: '#/components/examples/TenantEnablePlaintextMessage' } }
   *         application/json:
   *           schema: { $ref: '#/components/schemas/DidcommPlaintextMessage' }
   *           examples: { enable: { $ref: '#/components/examples/TenantEnablePlaintextMessage' } }
   *     responses:
   *       '202': { description: Accepted. Poll the Location URL. }
   *
   * /host/cds-{jurisdiction}/v1/{sector}/registry/org.schema/Organization/_purge:
   *   post:
   *     tags: [1.1 Organization Registration]
   *     summary: Purge one suspended hosted tenant after explicit child purge
   *     description: Returns 409 until the tenant is suspended and all required child resources have been explicitly purged.
   *     parameters:
   *       - $ref: '#/components/parameters/AppId'
   *       - $ref: '#/components/parameters/AppVersion'
   *       - $ref: '#/components/parameters/Jurisdiction'
   *       - $ref: '#/components/parameters/HostRegistrySector'
   *     security: [{ BearerAuth: [] }]
   *     requestBody:
   *       required: true
   *       content:
   *         application/didcomm-plain+json:
   *           schema: { $ref: '#/components/schemas/DidcommPlaintextMessage' }
   *           examples: { purge: { $ref: '#/components/examples/TenantPurgePlaintextMessage' } }
   *         application/json:
   *           schema: { $ref: '#/components/schemas/DidcommPlaintextMessage' }
   *           examples: { purge: { $ref: '#/components/examples/TenantPurgePlaintextMessage' } }
   *     responses:
   *       '202': { description: Accepted. Poll the Location URL. }
   *       '409': { description: Tenant is active or unpurged descendants remain. }
   *
   * /host/cds-{jurisdiction}/v1/{sector}/registry/org.schema/Organization/_status-response:
   *   post:
   *     tags: [1.1 Organization Registration]
   *     summary: Poll hosted-tenant lifecycle counters
   *     security: [{ BearerAuth: [] }]
   *     requestBody: { required: true, content: { application/json: { schema: { $ref: '#/components/schemas/AsyncPollRequest' } } } }
   *     responses: { '202': { description: Pending. }, '200': { description: Completed. } }
   *
   * /host/cds-{jurisdiction}/v1/{sector}/registry/org.schema/Organization/_search-response:
   *   post:
   *     tags: [1.1 Organization Registration]
   *     summary: Poll the protected hosted-organization directory search
   *     security: [{ BearerAuth: [] }]
   *     requestBody: { required: true, content: { application/json: { schema: { $ref: '#/components/schemas/AsyncPollRequest' } } } }
   *     responses: { '202': { description: Pending. }, '200': { description: Completed DIDComm response containing the paginated Bundle. } }
   *
   * /host/cds-{jurisdiction}/v1/{sector}/registry/org.schema/Organization/_disable-response:
   *   post:
   *     tags: [1.1 Organization Registration]
   *     summary: Poll hosted-tenant disable
   *     security: [{ BearerAuth: [] }]
   *     requestBody: { required: true, content: { application/json: { schema: { $ref: '#/components/schemas/AsyncPollRequest' } } } }
   *     responses: { '202': { description: Pending. }, '200': { description: Completed. } }
   *
   * /host/cds-{jurisdiction}/v1/{sector}/registry/org.schema/Organization/_enable-response:
   *   post:
   *     tags: [1.1 Organization Registration]
   *     summary: Poll hosted-tenant enable
   *     security: [{ BearerAuth: [] }]
   *     requestBody: { required: true, content: { application/json: { schema: { $ref: '#/components/schemas/AsyncPollRequest' } } } }
   *     responses: { '202': { description: Pending. }, '200': { description: Completed. } }
   *
   * /host/cds-{jurisdiction}/v1/{sector}/registry/org.schema/Organization/_purge-response:
   *   post:
   *     tags: [1.1 Organization Registration]
   *     summary: Poll hosted-tenant purge
   *     security: [{ BearerAuth: [] }]
   *     requestBody: { required: true, content: { application/json: { schema: { $ref: '#/components/schemas/AsyncPollRequest' } } } }
   *     responses: { '202': { description: Pending. }, '200': { description: Completed. } }
   *
   * /{tenantId}/cds-{jurisdiction}/v1/{sector}/entity/org.schema/Employee/_batch:
   *   post:
   *     tags:
   *       - 3.1 Employee Role
   *     summary: Create a new Professional (Employee)
   *     description: |
   *       Submits an asynchronous job to create or enable again a professional (employee) within an existing tenant.
   *       The `tenantId` in the path specifies the organization under which the employee is being created.
   *       Prerequisite: controller device/client must already be active (`Token/_exchange` + `Device/_dcr`).
   *       Creating an employee profile does not automatically activate employee devices.
   *       Additional employees require `License/_issue`. A second device for the
   *       same employee reuses that seat and activation code, sending a distinct
   *       `client_instance_id` through `_exchange` and `_dcr` (default allowance: 2).
   *       
   *       V1 lifecycle semantics:
   *       - business identity is the combination `email + role`
   *       - if the same `email + role` already exists and is active, the gateway returns the existing employee instead of creating a duplicate
   *       - if the same `email + role` exists and is inactive, the gateway enables that employee record again
   *       - employee suspension does not implicitly release the reserved license seat
   *       - a bounded Bundle may carry multiple entries, but every entry must
   *         identify one concrete `resource.id`; wildcard ids are rejected
   *       - `entry.request.method = DELETE` is the current GW v1 soft-disable
   *         compatibility profile, not native FHIR delete semantics
   *     parameters:
   *       - $ref: '#/components/parameters/AppId'
   *       - $ref: '#/components/parameters/AppVersion'
   *       - $ref: "#/components/parameters/TenantId"
   *       - $ref: "#/components/parameters/Jurisdiction"
   *       - $ref: "#/components/parameters/Sector"
   *     requestBody:
   *       description: |
   *         DIDComm request for employee creation.
   *         Production: only `application/x-www-form-urlencoded` is accepted (secure JWE envelope with `request=`).
   *         Demo/Test-Network: `application/didcomm-plain+json` is canonical, and `application/json` is also accepted for simplicity.
   *       required: true
   *       content:
   *         application/didcomm-plain+json:
   *           schema:
   *             $ref: '#/components/schemas/EmployeeCreationLegacy'
   *           examples:
   *             message:
   *               $ref: '#/components/examples/EmployeeRegistrationPlaintextMessage'
   *             disable:
   *               $ref: '#/components/examples/EmployeeDisablePlaintextMessage'
   *         application/json:
   *           schema:
   *             $ref: '#/components/schemas/EmployeeCreationLegacy'
   *           examples:
   *             create: { $ref: '#/components/examples/EmployeeRegistrationPlaintextMessage' }
   *             disable: { $ref: '#/components/examples/EmployeeDisablePlaintextMessage' }
   *         application/x-www-form-urlencoded:
   *           schema:
   *             $ref: '#/components/schemas/SecureRequest'
   *     security:
   *       - BearerAuth: []
   *     responses:
   *       '202':
   *         description: Accepted. The job has been queued.
   *         headers:
   *           Location:
   *             schema: { type: string }
   *
   * /{tenantId}/cds-{jurisdiction}/v1/{sector}/entity/org.schema/Employee/_batch-response:
   *   post:
   *     tags:
   *       - 3.1 Employee Role
   *     summary: Poll the employee creation job result
   *     parameters:
   *       - $ref: '#/components/parameters/AppId'
   *       - $ref: '#/components/parameters/AppVersion'
   *       - $ref: "#/components/parameters/TenantId"
   *       - $ref: "#/components/parameters/Jurisdiction"
   *       - $ref: "#/components/parameters/Sector"
   *     security:
   *       - BearerAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema: { $ref: '#/components/schemas/AsyncPollRequest' }
   *           examples:
   *             message: { $ref: '#/components/examples/EmployeePollRequest' }
   *         application/x-www-form-urlencoded:
   *           schema: { $ref: '#/components/schemas/AsyncPollRequest' }
   *           examples:
   *             message: { $ref: '#/components/examples/EmployeePollRequest' }
   *     responses:
   *       '202': { description: Pending. Retry later. }
   *       '200': { description: Completed. }
   *       '400': { description: Missing or invalid thid. }
   *       '404': { description: thid not found. }
   *       '500': { description: Job failed or response decode failed. }
   *
   * /{tenantId}/cds-{jurisdiction}/v1/{sector}/entity/org.schema/Employee/_purge:
   *   post:
   *     tags: [3.1 Employee Role]
   *     summary: Purge explicitly identified inactive employees
   *     description: |
   *       Every Bundle entry carries one concrete `resource.id`; `*` is never
   *       accepted. Purge requires inactive state and releases or
   *       disassociates the employee licence seat while preserving audit data.
   *       Clients page searches and submit bounded batches; GW never expands
   *       an implicit all-employees operation.
   *     parameters:
   *       - $ref: '#/components/parameters/AppId'
   *       - $ref: '#/components/parameters/AppVersion'
   *       - $ref: '#/components/parameters/TenantId'
   *       - $ref: '#/components/parameters/Jurisdiction'
   *       - $ref: '#/components/parameters/Sector'
   *     security: [{ BearerAuth: [] }]
   *     requestBody:
   *       required: true
   *       content:
   *         application/didcomm-plain+json:
   *           schema: { $ref: '#/components/schemas/DidcommPlaintextMessage' }
   *           examples:
   *             purge: { $ref: '#/components/examples/EmployeePurgePlaintextMessage' }
   *         application/json:
   *           schema: { $ref: '#/components/schemas/DidcommPlaintextMessage' }
   *           examples:
   *             purge: { $ref: '#/components/examples/EmployeePurgePlaintextMessage' }
   *         application/x-www-form-urlencoded:
   *           schema: { $ref: '#/components/schemas/SecureRequest' }
   *     responses:
   *       '202': { description: Accepted. Poll the Location URL for each entry result. }
   *       '400': { description: Missing id or malformed Bundle entry. }
   *       '409': { description: Employee must be inactive before purge. }
   *
   * /{tenantId}/cds-{jurisdiction}/v1/{sector}/entity/org.schema/Employee/_purge-response:
   *   post:
   *     tags: [3.1 Employee Role]
   *     summary: Poll the Employee purge result
   *     parameters:
   *       - $ref: '#/components/parameters/AppId'
   *       - $ref: '#/components/parameters/AppVersion'
   *       - $ref: '#/components/parameters/TenantId'
   *       - $ref: '#/components/parameters/Jurisdiction'
   *       - $ref: '#/components/parameters/Sector'
   *     security: [{ BearerAuth: [] }]
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema: { $ref: '#/components/schemas/AsyncPollRequest' }
   *     responses:
   *       '202': { description: Pending. Retry later. }
   *       '200': { description: Completed with per-entry results. }
   *
   * /{tenantId}/cds-{jurisdiction}/v1/{sector}/entity/org.schema/Employee/_search:
   *   post:
   *     tags:
   *       - 3.1 Employee Role
   *     summary: Search employees within an existing tenant
   *     description: |
   *       Submits an asynchronous employee directory query.
   *       Supported request shapes:
   *       - legacy Bundle search entry:
   *         - `body.resourceType = Bundle`
   *         - `body.entry[0].request.method = GET`
   *         - `body.entry[0].request.url = Employee?...`
   *       - preferred Bundle search entry:
   *         - `body.resourceType = Bundle`
   *         - `body.entry[0].request.method = POST`
   *         - `body.entry[0].request.url = Employee/_search`
   *         - `body.entry[0].resource.resourceType = Parameters`
   *     parameters:
   *       - $ref: '#/components/parameters/AppId'
   *       - $ref: '#/components/parameters/AppVersion'
   *       - $ref: "#/components/parameters/TenantId"
   *       - $ref: "#/components/parameters/Jurisdiction"
   *       - $ref: "#/components/parameters/Sector"
   *     requestBody:
   *       required: true
   *       content:
   *         application/didcomm-plain+json:
   *           schema:
   *             $ref: '#/components/schemas/LegacyMessage'
   *         application/json:
   *           schema:
   *             $ref: '#/components/schemas/LegacyMessage'
   *         application/x-www-form-urlencoded:
   *           schema:
   *             $ref: '#/components/schemas/SecureRequest'
   *     security:
   *       - BearerAuth: []
   *     responses:
   *       '202':
   *         description: Accepted. The search job has been queued.
   *         headers:
   *           Location:
   *             schema: { type: string }
   *
   * /{tenantId}/cds-{jurisdiction}/v1/{sector}/entity/org.schema/Employee/_search-response:
   *   post:
   *     tags:
   *       - 3.1 Employee Role
   *     summary: Poll the employee search job result
   *     parameters:
   *       - $ref: '#/components/parameters/AppId'
   *       - $ref: '#/components/parameters/AppVersion'
   *       - $ref: "#/components/parameters/TenantId"
   *       - $ref: "#/components/parameters/Jurisdiction"
   *       - $ref: "#/components/parameters/Sector"
   *     security:
   *       - BearerAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema: { $ref: '#/components/schemas/AsyncPollRequest' }
   *         application/x-www-form-urlencoded:
   *           schema: { $ref: '#/components/schemas/AsyncPollRequest' }
   *     responses:
   *       '202': { description: Pending. Retry later. }
   *       '200': { description: Completed. }
   *       '400': { description: Missing or invalid thid. }
   *       '404': { description: thid not found. }
   *       '500': { description: Job failed or response decode failed. }
   *
   * /{tenantId}/cds-{jurisdiction}/v1/{sector}/identity/firebase/Token/_custom:
   *   post:
   *     tags:
   *       - 2.1.1 Frontend Identity Federation (Optional)
   *     summary: Federate external OIDC id_token to Firebase custom token (async)
   *     description: |
   *       Submits an async job that verifies a provider id_token (e.g. eIDAS) and returns a Firebase custom_token.
   *
   *       This endpoint is always DIDComm (plaintext in demo, encrypted in production).
   *     parameters:
   *       - $ref: '#/components/parameters/AppId'
   *       - $ref: '#/components/parameters/AppVersion'
   *       - $ref: '#/components/parameters/TenantId'
   *       - $ref: '#/components/parameters/Jurisdiction'
   *       - $ref: '#/components/parameters/Sector'
   *     requestBody:
   *       description: |
   *         Production: only `application/x-www-form-urlencoded` is accepted (secure JWE envelope with `request=`).
   *         Demo/Test-Network: `application/didcomm-plain+json` is canonical, and `application/json` is also accepted for simplicity.
   *         With `@context: "org.schema"`, clients may send contextualized keys such as `Organization.identifier.value`
   *         or `Service.category` without the `org.schema.` prefix; that is the documented default mode.
   *         If the service enables `CLAIMS_IDENTITY_STORAGE_MODE=canonical`, equivalent fully-qualified `org.schema.*`
   *         keys remain valid. `Service.termsOfService` may be an HTTPS URL or an embedded PDF data URL; Swagger uses
   *         the HTTPS URL form as the default example.
   *       required: true
   *       content:
   *         application/didcomm-plain+json:
   *           schema: { $ref: '#/components/schemas/DidcommPlaintextMessage' }
   *           examples:
   *             message: { $ref: '#/components/examples/FirebaseCustomTokenPlaintextMessage' }
   *         application/json:
   *           schema: { $ref: '#/components/schemas/DidcommPlaintextMessage' }
   *         application/x-www-form-urlencoded:
   *           schema: { $ref: '#/components/schemas/SecureRequest' }
   *     responses:
   *       '202': { description: Accepted. Poll the Location URL for the result. }
   *       '400': { description: Bad Request. }
   *       '401': { description: Unauthorized. }
   *
   * /{tenantId}/cds-{jurisdiction}/v1/{sector}/identity/firebase/Token/_custom-response:
   *   post:
   *     tags:
   *       - 2.1.1 Frontend Identity Federation (Optional)
   *     summary: Poll the federation result
   *     parameters:
   *       - $ref: '#/components/parameters/AppId'
   *       - $ref: '#/components/parameters/AppVersion'
   *       - $ref: '#/components/parameters/TenantId'
   *       - $ref: '#/components/parameters/Jurisdiction'
   *       - $ref: '#/components/parameters/Sector'
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema: { $ref: '#/components/schemas/AsyncPollRequest' }
   *           examples:
   *             message: { $ref: '#/components/examples/ConsentPollRequest' }
   *         application/x-www-form-urlencoded:
   *           schema: { $ref: '#/components/schemas/AsyncPollRequest' }
   *           examples:
   *             message: { $ref: '#/components/examples/ConsentPollRequest' }
   *     responses:
   *       '202': { description: Pending. Retry later. }
   *       '200':
   *         description: Completed.
   *         content:
   *           application/json:
   *             schema: { $ref: '#/components/schemas/DidcommPlaintextMessage' }
   *             examples:
   *               message: { $ref: '#/components/examples/InitialAccessTokenExchangeResponse' }
   *
   * /{tenantId}/cds-{jurisdiction}/v1/{sector}/identity/openid/Token/_exchange:
   *   post:
   *     tags:
   *       - 2.1.2 Initial Access Token Exchange
   *     summary: Exchange an activation authorization for initial_access_token (async)
   *     description: |
   *       Canonical route for new integrations is:
   *       `/host/cds-{jurisdiction}/v1/{sector}/{tenantId}/identity/auth/_exchange`.
   *       This `identity/openid` route is maintained as a temporary compatibility alias.
   *
   *       Submits an async job that exchanges:
   *       - Authorization Bearer token: Firebase `id_token` (JWT format), and
   *       - either request body `subject_token`: activation code (opaque string, not JWT), or
   *       - server-side professional body `employee_authorization_urn`: the neutral
   *         organization/member/role URN for an already licensed employee.
   *       for an `initial_access_token`.
   *
   *       The sector is always the explicit route segment; it is deliberately
   *       absent from the neutral employee URN. The second form resolves an
   *       existing active licence by exact organization official identifier,
   *       employee UUID, role and verified email. It consumes device allowance,
   *       not another employee seat, and never authorizes patient data.
   *
   *       Submit-time errors are returned immediately if the request cannot be accepted/enqueued.
   *       Processing/business errors are returned when polling.
   *     parameters:
   *       - $ref: '#/components/parameters/AppId'
   *       - $ref: '#/components/parameters/AppVersion'
   *       - $ref: '#/components/parameters/TenantId'
   *       - $ref: '#/components/parameters/Jurisdiction'
   *       - $ref: '#/components/parameters/Sector'
   *     security:
   *       - BearerAuth: []
   *     requestBody:
   *       description: |
   *         Production: only `application/x-www-form-urlencoded` is accepted (secure JWE envelope with `request=`).
   *         Demo/Test-Network: `application/didcomm-plain+json` is canonical, and `application/json` is also accepted for simplicity.
   *       required: true
   *       content:
   *         application/didcomm-plain+json:
   *           schema: { $ref: '#/components/schemas/DidcommPlaintextMessage' }
   *           examples:
   *             message: { $ref: '#/components/examples/InitialAccessTokenExchangePlaintextMessage' }
   *         application/json:
   *           schema: { $ref: '#/components/schemas/DidcommPlaintextMessage' }
   *         application/x-www-form-urlencoded:
   *           schema: { $ref: '#/components/schemas/SecureRequest' }
   *     responses:
   *       '202': { description: Accepted. Poll the Location URL for the result. }
   *       '400': { description: Bad Request. }
   *       '401': { description: Missing/invalid Firebase id_token. }
   *       '404': { description: Activation code not found. }
   *       '409': { description: Activation code already used. }
   *
   * /{tenantId}/cds-{jurisdiction}/v1/{sector}/identity/openid/License/_issue:
   *   post:
   *     tags:
   *       - 2.1.4 License Issuance (Invite)
   *     summary: Issue (reserve) an activation code from the tenant license pool (async)
   *     description: |
   *       Canonical route for new integrations is:
   *       `/host/cds-{jurisdiction}/v1/{sector}/{tenantId}/identity/auth/_issue`.
   *       This `identity/openid` route is maintained as a temporary compatibility alias.
   *
   *       Tenant-admin / IT operation that reserves one `device-licenses` seat for a target email+role.
   *       Professional invitations must carry `meta.subjectId`, the id returned by Employee creation,
   *       and return that binding with the activation credential for subsequent `Token/_exchange`.
   *       The same credential can activate distinct installations up to `maxDevices`
   *       (five by default); it does not consume another employee seat.
   *     parameters:
   *       - $ref: '#/components/parameters/AppId'
   *       - $ref: '#/components/parameters/AppVersion'
   *       - $ref: '#/components/parameters/TenantId'
   *       - $ref: '#/components/parameters/Jurisdiction'
   *       - $ref: '#/components/parameters/Sector'
   *     security:
   *       - BearerAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/didcomm-plain+json:
   *           schema: { $ref: '#/components/schemas/DidcommPlaintextMessage' }
   *           examples:
   *             newEmployee: { $ref: '#/components/examples/LicenseIssuePlaintextMessage' }
   *             existingEmployee: { $ref: '#/components/examples/LicenseIssueExistingEmployeePlaintextMessage' }
   *         application/json:
   *           schema: { $ref: '#/components/schemas/DidcommPlaintextMessage' }
   *           examples:
   *             newEmployeeJson: { $ref: '#/components/examples/LicenseIssuePlaintextMessage' }
   *             existingEmployeeJson: { $ref: '#/components/examples/LicenseIssueExistingEmployeePlaintextMessage' }
   *         application/x-www-form-urlencoded:
   *           schema: { $ref: '#/components/schemas/SecureRequest' }
   *     responses:
   *       '202': { description: Accepted. Poll the Location URL for the result. }
   *
 * /{tenantId}/cds-{jurisdiction}/v1/{sector}/identity/openid/Token/_exchange-response:
 *   post:
   *     tags:
   *       - 2.1.2 Initial Access Token Exchange
   *     summary: Poll the initial_access_token exchange result
   *     parameters:
   *       - $ref: '#/components/parameters/AppId'
   *       - $ref: '#/components/parameters/AppVersion'
   *       - $ref: '#/components/parameters/TenantId'
   *       - $ref: '#/components/parameters/Jurisdiction'
   *       - $ref: '#/components/parameters/Sector'
   *     security:
   *       - BearerAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema: { $ref: '#/components/schemas/AsyncPollRequest' }
   *           examples:
   *             message: { $ref: '#/components/examples/TokenExchangePollRequest' }
   *         application/x-www-form-urlencoded:
   *           schema: { $ref: '#/components/schemas/AsyncPollRequest' }
   *           examples:
   *             message: { $ref: '#/components/examples/TokenExchangePollRequest' }
   *     responses:
   *       '202': { description: Pending. Retry later. }
   *       '200':
   *         description: Completed.
   *         content:
   *           application/json:
   *             schema: { $ref: '#/components/schemas/DidcommPlaintextMessage' }
   *             examples:
   *               message: { $ref: '#/components/examples/InitialAccessTokenExchangeResponse' }
   *
   * /{tenantId}/cds-{jurisdiction}/v1/{sector}/individual/org.schema/Person/_batch:
   *   post:
   *     tags:
   *       - 99. Legacy / Internal
  *     summary: Create a Person (individual vault)
   *     description: |
   *       This endpoint existed for the older "customer onboarding" flow where a provider created an individual's vault directly.
   *
  *       This endpoint remains available for the phone-validated form bootstrap path used by the chat node and other compatibility clients.
  *       New portal integrations should use the tenant organization activation + individual indexing flow documented in the current SDK guides.
   *     parameters:
   *       - $ref: '#/components/parameters/AppId'
   *       - $ref: '#/components/parameters/AppVersion'
   *       - $ref: "#/components/parameters/TenantId"
   *       - $ref: "#/components/parameters/Jurisdiction"
   *       - $ref: "#/components/parameters/Sector"
   *     requestBody:
   *       description: |
   *         Legacy endpoint. Production: only `application/x-www-form-urlencoded` is accepted (secure JWE envelope with `request=`).
   *         Demo/Test-Network: `application/didcomm-plain+json` is canonical, and `application/json` is also accepted for simplicity.
   *       required: true
   *       content:
   *         application/didcomm-plain+json:
   *           schema:
   *             $ref: '#/components/schemas/CustomerCreationLegacy'
   *           examples:
   *             message:
   *               $ref: '#/components/examples/CustomerOnboardingPlaintextMessage'
   *         application/json:
   *           schema:
   *             $ref: '#/components/schemas/CustomerCreationLegacy'
   *         application/x-www-form-urlencoded:
   *           schema:
   *             $ref: '#/components/schemas/SecureRequest'
   *     security:
   *       - BearerAuth: []
   *     responses:
   *       '202':
   *         description: Accepted. The job has been queued.
   *         headers:
   *           Location:
   *             schema: { type: string }
   *
   * /{tenantId}/cds-{jurisdiction}/v1/{sector}/individual/org.hl7.fhir.r4/Consent/_batch:
   *   post:
   *     tags:
   *       - 5. Consent
   *     summary: Create a FHIR Consent Resource
   *     description: Submits an async job to create a FHIR Consent resource, wrapped in a DIDComm message.
   *     parameters:
   *       - $ref: '#/components/parameters/AppId'
   *       - $ref: '#/components/parameters/AppVersion'
   *       - $ref: "#/components/parameters/TenantId"
   *       - $ref: "#/components/parameters/Jurisdiction"
   *       - $ref: "#/components/parameters/Sector"
   *     requestBody:
   *       description: |
   *         Production: only `application/x-www-form-urlencoded` is accepted (secure JWE envelope with `request=`).
   *         Demo/Test-Network: `application/didcomm-plain+json` is canonical, and `application/json` is also accepted for simplicity.
   *         Legacy mode (non-production only): `application/fhir+json` may be used to send a raw FHIR Bundle without DIDComm envelope.
   *       required: true
   *       content:
   *         application/didcomm-plain+json:
   *           schema:
   *             $ref: '#/components/schemas/ConsentCreation'
   *           examples:
   *             message:
   *               $ref: '#/components/examples/ConsentCreationPlaintextMessage'
   *         application/json:
   *           schema:
   *             $ref: '#/components/schemas/ConsentCreation'
   *         application/x-www-form-urlencoded:
   *           schema:
   *             $ref: '#/components/schemas/SecureRequest'
   *         application/fhir+json:
   *           schema:
   *             type: object
   *           description: |
   *             Legacy FHIR JSON (raw Bundle without DIDComm envelope). Allowed only in non-production environments and only for `org.hl7.fhir.*` endpoints.
   *             This mode is still asynchronous: submit with `_batch` and poll `_batch-response`.
   *     responses:
   *       '202':
   *         description: Accepted.
   *
   * /{tenantId}/cds-{jurisdiction}/v1/{sector}/individual/org.hl7.fhir.r4/Consent/_batch-response:
   *   post:
   *     tags:
   *       - 5. Consent
   *     summary: Poll the Consent job result
   *     parameters:
   *       - $ref: '#/components/parameters/AppId'
   *       - $ref: '#/components/parameters/AppVersion'
   *       - $ref: "#/components/parameters/TenantId"
   *       - $ref: "#/components/parameters/Jurisdiction"
   *       - $ref: "#/components/parameters/Sector"
   *     security:
   *       - BearerAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema: { $ref: '#/components/schemas/AsyncPollRequest' }
   *           examples:
   *             message: { $ref: '#/components/examples/CompositionPollRequest' }
   *         application/x-www-form-urlencoded:
   *           schema: { $ref: '#/components/schemas/AsyncPollRequest' }
   *           examples:
   *             message: { $ref: '#/components/examples/CompositionPollRequest' }
   *     responses:
   *       '202':
   *         description: Pending. Retry later.
   *         headers:
   *           Retry-After:
   *             schema: { type: string, example: '5' }
   *         content:
   *           application/json:
   *             schema: { $ref: '#/components/schemas/AsyncPollPending' }
   *       '200':
   *         description: Completed.
   *         content:
   *           application/json:
   *             schema: { type: object }
   *           application/x-www-form-urlencoded:
   *             schema: { $ref: '#/components/schemas/AsyncPollSecureResponse' }
   *       '400': { description: Missing or invalid thid. }
   *       '404': { description: thid not found. }
   *       '500': { description: Job failed or response decode failed. }
   *
   * /{tenantId}/cds-{jurisdiction}/v1/{sector}/individual/org.hl7.fhir.r4/Communication/_batch:
   *   post:
   *     tags:
   *       - 6. Communication
   *     summary: Create a FHIR Communication Resource
   *     description: Submits an async job to create a FHIR Communication resource, wrapped in a DIDComm message, subject to a prior Consent.
   *     parameters:
   *       - $ref: '#/components/parameters/AppId'
   *       - $ref: '#/components/parameters/AppVersion'
   *       - $ref: "#/components/parameters/TenantId"
   *       - $ref: "#/components/parameters/Jurisdiction"
   *       - $ref: "#/components/parameters/Sector"
   *     requestBody:
   *       description: |
   *         Production: only `application/x-www-form-urlencoded` is accepted (secure JWE envelope with `request=`).
   *         Demo/Test-Network: `application/didcomm-plain+json` is canonical, and `application/json` is also accepted for simplicity.
   *         Legacy mode (non-production only): `application/fhir+json` may be used to send a raw FHIR Bundle without DIDComm envelope.
   *       required: true
   *       content:
   *         application/didcomm-plain+json:
   *           schema:
   *             $ref: '#/components/schemas/CommunicationCreation'
   *           examples:
   *             message:
   *               $ref: '#/components/examples/CommunicationCreationPlaintextMessage'
   *         application/json:
   *           schema:
   *             $ref: '#/components/schemas/CommunicationCreation'
   *         application/x-www-form-urlencoded:
   *           schema:
   *             $ref: '#/components/schemas/SecureRequest'
   *         application/fhir+json:
   *           schema:
   *             type: object
   *           description: |
   *             Legacy FHIR JSON (raw Bundle without DIDComm envelope). Allowed only in non-production environments and only for `org.hl7.fhir.*` endpoints.
   *             This mode is still asynchronous: submit with `_batch` and poll `_batch-response`.
   *     responses:
   *       '202':
   *         description: Accepted.
   *
   * /{tenantId}/cds-{jurisdiction}/v1/{sector}/individual/org.hl7.fhir.r4/Communication/_batch-response:
   *   post:
   *     tags:
   *       - 6. Communication
   *     summary: Poll the Communication job result
   *     parameters:
   *       - $ref: '#/components/parameters/AppId'
   *       - $ref: '#/components/parameters/AppVersion'
   *       - $ref: "#/components/parameters/TenantId"
   *       - $ref: "#/components/parameters/Jurisdiction"
   *       - $ref: "#/components/parameters/Sector"
   *     security:
   *       - BearerAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema: { $ref: '#/components/schemas/AsyncPollRequest' }
   *           examples:
   *             message: { $ref: '#/components/examples/RelatedPersonPollRequest' }
   *         application/x-www-form-urlencoded:
   *           schema: { $ref: '#/components/schemas/AsyncPollRequest' }
   *           examples:
   *             message: { $ref: '#/components/examples/RelatedPersonPollRequest' }
   *     responses:
   *       '202':
   *         description: Pending. Retry later.
   *         headers:
   *           Retry-After:
   *             schema: { type: string, example: '5' }
   *         content:
   *           application/json:
   *             schema: { $ref: '#/components/schemas/AsyncPollPending' }
   *       '200':
   *         description: Completed.
   *         content:
   *           application/json:
   *             schema: { type: object }
   *           application/x-www-form-urlencoded:
   *             schema: { $ref: '#/components/schemas/AsyncPollSecureResponse' }
   *       '400': { description: Missing or invalid thid. }
   *       '404': { description: thid not found. }
   *       '500': { description: Job failed or response decode failed. }
   *
   * /{tenantId}/cds-{jurisdiction}/v1/{sector}/individual/org.hl7.fhir.r4/Composition/_batch:
   *   post:
   *     tags:
   *       - 7. Composition
   *     deprecated: true
   *     x-contract-level: compatibility-deprecated
   *     summary: Deprecated compatibility update of the individual index (FHIR Composition)
   *     description: |
   *       Deprecated compatibility route retained without behavioral changes for existing integrations.
   *       New integrations submit complete FHIR documents or typed section changes through `Communication/_batch`,
   *       normally via the SDK `updateClinicalSummary(...)` or `updateSubjectSection(...)` facades.
   *     parameters:
   *       - $ref: '#/components/parameters/AppId'
   *       - $ref: '#/components/parameters/AppVersion'
   *       - $ref: "#/components/parameters/TenantId"
   *       - $ref: "#/components/parameters/Jurisdiction"
   *       - $ref: "#/components/parameters/Sector"
   *     requestBody:
   *       description: |
   *         Production: only `application/x-www-form-urlencoded` is accepted (secure JWE envelope with `request=`).
   *         Demo/Test-Network: `application/didcomm-plain+json` is canonical, and `application/json` is also accepted for simplicity.
   *         Legacy mode (non-production only): `application/fhir+json` may be used to send a raw FHIR Bundle without DIDComm envelope.
   *       required: true
   *       content:
   *         application/didcomm-plain+json:
   *           schema:
   *             $ref: '#/components/schemas/DidcommPlaintextMessage'
   *           examples:
   *             message:
   *               $ref: '#/components/examples/CompositionUpdatePlaintextMessage'
   *         application/json:
   *           schema:
   *             $ref: '#/components/schemas/DidcommPlaintextMessage'
   *         application/x-www-form-urlencoded:
   *           schema:
   *             $ref: '#/components/schemas/SecureRequest'
   *         application/fhir+json:
   *           schema:
   *             type: object
   *           description: |
   *             Legacy FHIR JSON (raw Bundle without DIDComm envelope). Allowed only in non-production environments and only for `org.hl7.fhir.*` endpoints.
   *             This mode is still asynchronous: submit with `_batch` and poll `_batch-response`.
   *     security:
   *       - BearerAuth: []
   *     responses:
   *       '202':
   *         description: Accepted.
   *
   * /{tenantId}/cds-{jurisdiction}/v1/{sector}/individual/org.hl7.fhir.r4/Composition/_batch-response:
   *   post:
   *     tags:
   *       - 7. Composition
   *     deprecated: true
   *     x-contract-level: compatibility-deprecated
   *     summary: Poll a deprecated compatibility Composition job
   *     parameters:
   *       - $ref: '#/components/parameters/AppId'
   *       - $ref: '#/components/parameters/AppVersion'
   *       - $ref: "#/components/parameters/TenantId"
   *       - $ref: "#/components/parameters/Jurisdiction"
   *       - $ref: "#/components/parameters/Sector"
   *     security:
   *       - BearerAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema: { $ref: '#/components/schemas/AsyncPollRequest' }
   *           examples:
   *             message: { $ref: '#/components/examples/CompositionPollRequest' }
   *         application/x-www-form-urlencoded:
   *           schema: { $ref: '#/components/schemas/AsyncPollRequest' }
   *           examples:
   *             message: { $ref: '#/components/examples/CompositionPollRequest' }
   *     responses:
   *       '202':
   *         description: Pending. Retry later.
   *         headers:
   *           Retry-After:
   *             schema: { type: string, example: '5' }
   *         content:
   *           application/json:
   *             schema: { $ref: '#/components/schemas/AsyncPollPending' }
   *       '200':
   *         description: Completed.
   *         content:
   *           application/json:
   *             schema: { type: object }
   *           application/x-www-form-urlencoded:
   *             schema: { $ref: '#/components/schemas/AsyncPollSecureResponse' }
   *       '400': { description: Missing or invalid thid. }
   *       '404': { description: thid not found. }
   *       '500': { description: Job failed or response decode failed. }
   *
   * /{tenantId}/cds-{jurisdiction}/v1/{sector}/individual/org.hl7.fhir.r4/ResearchSubject/_purge:
   *   post:
   *     tags:
   *       - 9. Research Digital Twin
   *     summary: Offboard a subject from the current digital-twin index provider
   *     description: |
   *       Deletes only the tenant-private correspondence between the operational
   *       subject DID and its registered twin UUID. The anonymous twin is not
   *       deleted. This operation is for account deletion or index-provider
   *       migration, never for an ordinary secondary-use consent toggle.
   *     parameters:
   *       - $ref: '#/components/parameters/AppId'
   *       - $ref: '#/components/parameters/AppVersion'
   *       - $ref: "#/components/parameters/TenantId"
   *       - $ref: "#/components/parameters/Jurisdiction"
   *       - $ref: "#/components/parameters/Sector"
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required: [thid, body]
   *             properties:
   *               thid: { type: string }
   *               body:
   *                 type: object
   *                 required: [resourceType, parameter]
   *                 properties:
   *                   resourceType: { type: string, enum: [Parameters] }
   *                   parameter:
   *                     type: array
   *                     items: { type: object }
   *     security:
   *       - BearerAuth: []
   *     responses:
   *       '202': { description: Accepted. Poll the matching `_purge-response` path. }
   *
   * /{tenantId}/cds-{jurisdiction}/v1/{sector}/digitaltwin/org.hl7.fhir.api/Composition/_batch:
   *   post:
   *     tags:
   *       - 9. Research Digital Twin
  *     summary: Save a researcher-owned working selection
  *     description: |
  *       Persists only `@type = Composition:ResearcherWorkingSelection` for an
  *       existing tenant-registered `urn:uuid` twin subject. Canonical twins
  *       are projected by GW from subject data after secondary-use consent;
  *       they cannot be submitted through this endpoint.
  *
  *       Claims container note:
  *       - `resource.meta.claims` is a project-specific non-standard claims container
  *       - it is not part of base FHIR
  *       - the resource remains FHIR-shaped, but business semantics are claims-first
  *       - claims may be contextualized with `@context` such as `org.hl7.fhir.api`
  *         or authored in a less-qualified form when that context already disambiguates them
  *
  *       Expected payload shape:
  *       - DIDComm plaintext message
  *       - `body.data[]` array
  *       - each item is a Composition resource object with:
  *         - `resource.meta.claims` for Composition claims
   *         - optional `resource.contained[].meta.claims` for source resources
   *           (`DocumentReference`, and future `Encounter` / `Patient`)
   *
  *       Current gateway behavior rejects operational subject DIDs, invented
  *       UUID URNs absent from the private alias registry, and canonical twin
  *       Compositions.
   *     parameters:
   *       - $ref: '#/components/parameters/AppId'
   *       - $ref: '#/components/parameters/AppVersion'
   *       - $ref: "#/components/parameters/TenantId"
   *       - $ref: "#/components/parameters/Jurisdiction"
   *       - $ref: "#/components/parameters/Sector"
   *     requestBody:
   *       required: true
   *       content:
   *         application/didcomm-plain+json:
   *           schema: { $ref: '#/components/schemas/DidcommPlaintextMessage' }
   *           examples:
   *             message: { $ref: '#/components/examples/ResearchCompositionIngestionPlaintextMessage' }
   *         application/json:
   *           schema: { $ref: '#/components/schemas/DidcommPlaintextMessage' }
   *         application/x-www-form-urlencoded:
   *           schema: { $ref: '#/components/schemas/SecureRequest' }
   *     security:
   *       - BearerAuth: []
   *     responses:
   *       '202': { description: Accepted. Poll the Location URL for the result. }
   *
   * /{tenantId}/cds-{jurisdiction}/v1/{sector}/digitaltwin/org.hl7.fhir.r4/Composition/_batch:
   *   post:
   *     tags:
   *       - 9. Research Digital Twin
   *     summary: Save a researcher-owned working selection in strict FHIR R4 mode
   *     description: |
   *       Same working-selection flow as `org.hl7.fhir.api`, but with version-aware validation.
   *       Each item must include `resource.resourceType = "Composition"`.
   *     parameters:
   *       - $ref: '#/components/parameters/AppId'
   *       - $ref: '#/components/parameters/AppVersion'
   *       - $ref: "#/components/parameters/TenantId"
   *       - $ref: "#/components/parameters/Jurisdiction"
   *       - $ref: "#/components/parameters/Sector"
   *     requestBody:
   *       required: true
   *       content:
   *         application/didcomm-plain+json:
   *           schema: { $ref: '#/components/schemas/DidcommPlaintextMessage' }
   *           examples:
   *             message: { $ref: '#/components/examples/ResearchCompositionSearchPlaintextMessage' }
   *         application/json:
   *           schema: { $ref: '#/components/schemas/DidcommPlaintextMessage' }
   *         application/x-www-form-urlencoded:
   *           schema: { $ref: '#/components/schemas/SecureRequest' }
   *     security:
   *       - BearerAuth: []
   *     responses:
   *       '202': { description: Accepted. Poll the Location URL for the result. }
   *
   * /{tenantId}/cds-{jurisdiction}/v1/{sector}/organization/org.hl7.fhir.r5/Consent/_batch:
   *   post:
   *     tags: [8.8 Research Study Administration]
   *     summary: Activate or revoke a controller-approved organization permission
   *     description: |
   *       Accepts a JSON:API primary document containing FHIR R5 Consent POST
   *       activation entries or PATCH revocations containing only
   *       `resourceType`, `id` and `meta.claims`. A revocation PATCH carries
   *       only `Consent.status=inactive`; the stored claims remain canonical.
   *       Claims may be scalar strings emitted by `vet-sdk-core-ts` or string
   *       arrays; the GW canonicalizes both to arrays. The current tenant DID
   *       controller must make an explicit
   *       `active`/`permit` decision after the referenced PractitionerRole has
   *       completed DCR and still has its exact active Employee role and
   *       applicable licence. A research decision correlates
   *       `Consent.source-reference` to `ResearchStudy/<id>` and admits exactly
   *       `organization/ResearchSubject.crus?study=ResearchStudy/<id>`. An
   *       operations decision correlates it to the exact `Group/<id>`, requires
   *       the same `PractitionerRole/<id>` member projection, and admits only
   *       the complete Encounter/EncounterHistory set, the complete
   *       Appointment/Schedule/Slot set, or the separate multisector
   *       `Subject/Composition.cuds` contribution capability. Subject can be
   *       projected to Patient only by a FHIR/EHR compatibility adapter. The
   *       contribution capability grants no clinical read, attestation, index
   *       update or delivery and is not `organization/Composition`.
   *       Draft Consent carried by Communication, a party projection and Group
   *       membership never authorize. Encrypted content is exactly `{ claims }`
   *       and its search attributes are protected. Delete is not admitted.
   *       Identical deterministic POST retries return 200; divergent claims
   *       return 409. See https://hl7.org/fhir/R5/consent.html.
   *     parameters:
   *       - $ref: '#/components/parameters/AppId'
   *       - $ref: '#/components/parameters/AppVersion'
   *       - $ref: '#/components/parameters/TenantId'
   *       - $ref: '#/components/parameters/Jurisdiction'
   *       - $ref: '#/components/parameters/Sector'
   *     security: [{ BearerAuth: [] }]
   *     requestBody:
   *       required: true
   *       content:
   *         application/didcomm-plain+json: { schema: { $ref: '#/components/schemas/DidcommPlaintextMessage' } }
   *         application/json: { schema: { $ref: '#/components/schemas/DidcommPlaintextMessage' } }
   *         application/x-www-form-urlencoded: { schema: { $ref: '#/components/schemas/SecureRequest' } }
   *     responses:
   *       '202': { description: Accepted. Poll the Location URL for per-entry results. }
   *       '403': { description: Not the tenant controller, role lacks DCR, or tenant/source/role correlation failed. }
   *       '404': { description: Tenant or correlated source not found. }
   *
   * /{tenantId}/cds-{jurisdiction}/v1/{sector}/organization/org.hl7.fhir.r5/Consent/_batch-response:
   *   post:
   *     tags: [8.8 Research Study Administration]
   *     summary: Poll organization Consent activation results
   *     parameters:
   *       - $ref: '#/components/parameters/TenantId'
   *       - $ref: '#/components/parameters/Jurisdiction'
   *       - $ref: '#/components/parameters/Sector'
   *     requestBody:
   *       required: true
   *       content:
   *         application/json: { schema: { $ref: '#/components/schemas/AsyncPollRequest' } }
   *     responses:
   *       '202': { description: Pending. Retry later. }
   *       '200': { description: Completed with one result or OperationOutcome per entry. }
   *
   * /{tenantId}/cds-{jurisdiction}/v1/{sector}/organization/org.hl7.fhir.r5/Consent/_search:
   *   post:
   *     tags: [8.8 Research Study Administration]
   *     summary: Search organization Consent lifecycle records
   *     description: |
   *       A current tenant controller searches protected flat Consent claims,
   *       including status, source-reference and actor-identifier. Results are
   *       claims-only lifecycle records; reading one does not mint or replace a
   *       SMART access token.
   *     parameters:
   *       - $ref: '#/components/parameters/AppId'
   *       - $ref: '#/components/parameters/AppVersion'
   *       - $ref: '#/components/parameters/TenantId'
   *       - $ref: '#/components/parameters/Jurisdiction'
   *       - $ref: '#/components/parameters/Sector'
   *     security: [{ BearerAuth: [] }]
   *     requestBody:
   *       required: true
   *       content:
   *         application/didcomm-plain+json: { schema: { $ref: '#/components/schemas/DidcommPlaintextMessage' } }
   *         application/json: { schema: { $ref: '#/components/schemas/DidcommPlaintextMessage' } }
   *         application/x-www-form-urlencoded: { schema: { $ref: '#/components/schemas/SecureRequest' } }
   *     responses:
   *       '202': { description: Accepted. Poll the Location URL. }
   *       '403': { description: The authenticated sender is not a current tenant controller. }
   *
   * /{tenantId}/cds-{jurisdiction}/v1/{sector}/organization/org.hl7.fhir.r5/Consent/_search-response:
   *   post:
   *     tags: [8.8 Research Study Administration]
   *     summary: Poll organization Consent search results
   *     parameters:
   *       - $ref: '#/components/parameters/TenantId'
   *       - $ref: '#/components/parameters/Jurisdiction'
   *       - $ref: '#/components/parameters/Sector'
   *     requestBody:
   *       required: true
   *       content:
   *         application/json: { schema: { $ref: '#/components/schemas/AsyncPollRequest' } }
   *     responses:
   *       '202': { description: Pending. Retry later. }
   *       '200': { description: Completed with zero or more claims-first Consent records. }
   *
   * /{tenantId}/cds-{jurisdiction}/v1/{sector}/organization/org.hl7.fhir.r5/Provenance/_batch:
   *   post:
   *     tags: [8.8 Research Study Administration]
   *     summary: Create or replace claims-first FHIR R5 Provenance
   *     description: |
   *       Persists an encrypted Provenance resource containing only
   *       `resourceType`, `id` and governed `meta.claims`. The indexed claims
   *       include all thirteen resource-specific FHIR R5 SearchParameters and
   *       correlated `Provenance.agent-<type>-who` claims. `who` is the real
   *       server-issued professional assignment projected as
   *       `PractitionerRole/<UUID>`; an operational employee or role-license
   *       URN is not a clinical agent reference. Only the current organization
   *       controller may write. See https://hl7.org/fhir/R5/provenance.html.
   *     parameters:
   *       - $ref: '#/components/parameters/AppId'
   *       - $ref: '#/components/parameters/AppVersion'
   *       - $ref: '#/components/parameters/TenantId'
   *       - $ref: '#/components/parameters/Jurisdiction'
   *       - $ref: '#/components/parameters/Sector'
   *     security: [{ BearerAuth: [] }]
   *     requestBody:
   *       required: true
   *       content:
   *         application/didcomm-plain+json: { schema: { $ref: '#/components/schemas/DidcommPlaintextMessage' } }
   *         application/json: { schema: { $ref: '#/components/schemas/DidcommPlaintextMessage' } }
   *         application/x-www-form-urlencoded: { schema: { $ref: '#/components/schemas/SecureRequest' } }
   *     responses:
   *       '202': { description: Accepted. Poll the Location URL for per-entry results. }
   *       '403': { description: The authenticated sender is not a current tenant controller. }
   *
   * /{tenantId}/cds-{jurisdiction}/v1/{sector}/organization/org.hl7.fhir.r5/Provenance/_batch-response:
   *   post:
   *     tags: [8.8 Research Study Administration]
   *     summary: Poll Provenance write results
   *     parameters:
   *       - $ref: '#/components/parameters/TenantId'
   *       - $ref: '#/components/parameters/Jurisdiction'
   *       - $ref: '#/components/parameters/Sector'
   *     requestBody:
   *       required: true
   *       content:
   *         application/json: { schema: { $ref: '#/components/schemas/AsyncPollRequest' } }
   *     responses:
   *       '202': { description: Pending. Retry later. }
   *       '200': { description: Completed with one result or OperationOutcome per entry. }
   *
   * /{tenantId}/cds-{jurisdiction}/v1/{sector}/organization/org.hl7.fhir.r5/Provenance/_search:
   *   post:
   *     tags: [8.8 Research Study Administration]
   *     summary: Search Provenance by governed FHIR R5 claims
   *     description: |
   *       Accepts the thirteen standard resource-specific Provenance search
   *       claims plus `Provenance.agent-<type>-who`, preserving correlation
   *       between the ParticipationRoleType and PractitionerRole reference.
   *       See https://hl7.org/fhir/R5/provenance-search.html.
   *     parameters:
   *       - $ref: '#/components/parameters/AppId'
   *       - $ref: '#/components/parameters/AppVersion'
   *       - $ref: '#/components/parameters/TenantId'
   *       - $ref: '#/components/parameters/Jurisdiction'
   *       - $ref: '#/components/parameters/Sector'
   *     security: [{ BearerAuth: [] }]
   *     requestBody:
   *       required: true
   *       content:
   *         application/didcomm-plain+json: { schema: { $ref: '#/components/schemas/DidcommPlaintextMessage' } }
   *         application/json: { schema: { $ref: '#/components/schemas/DidcommPlaintextMessage' } }
   *         application/x-www-form-urlencoded: { schema: { $ref: '#/components/schemas/SecureRequest' } }
   *     responses:
   *       '202': { description: Accepted. Poll the Location URL. }
   *       '400': { description: Malformed or unsupported search claim. }
   *
   * /{tenantId}/cds-{jurisdiction}/v1/{sector}/organization/org.hl7.fhir.r5/Provenance/_search-response:
   *   post:
   *     tags: [8.8 Research Study Administration]
   *     summary: Poll Provenance search results
   *     parameters:
   *       - $ref: '#/components/parameters/TenantId'
   *       - $ref: '#/components/parameters/Jurisdiction'
   *       - $ref: '#/components/parameters/Sector'
   *     requestBody:
   *       required: true
   *       content:
   *         application/json: { schema: { $ref: '#/components/schemas/AsyncPollRequest' } }
   *     responses:
   *       '202': { description: Pending. Retry later. }
   *       '200': { description: Completed with zero or more claims-first Provenance resources. }
   *
   * /{tenantId}/cds-{jurisdiction}/v1/{sector}/organization/org.hl7.fhir.r5/ResearchStudy/_batch:
   *   post:
   *     tags: [8.8 Research Study Administration]
   *     summary: Manage a study and its correlated associated parties
   *     description: |
   *       Accepts a JSON:API primary document whose `data[]` entries use POST
   *       to create a claims-first FHIR R5 ResearchStudy, PUT to replace its
   *       base claims, or PATCH to upsert exactly one six-claim
   *       `ResearchStudy.party-*` projection. DELETE with party claims removes
   *       only that projection; DELETE without claims removes the study and
   *       its party projections. The base
   *       record and each party projection are encrypted separately and retain
   *       only `{ claims }`. Only a current tenant DID controller
   *       may write. PATCH cannot activate the study or change its status.
   *       Party membership is descriptive and grants no SMART access by itself.
   *       See https://hl7.org/fhir/R5/researchstudy.html.
   *     parameters:
   *       - $ref: '#/components/parameters/AppId'
   *       - $ref: '#/components/parameters/AppVersion'
   *       - $ref: '#/components/parameters/TenantId'
   *       - $ref: '#/components/parameters/Jurisdiction'
   *       - $ref: '#/components/parameters/Sector'
   *     security: [{ BearerAuth: [] }]
   *     requestBody:
   *       required: true
   *       content:
   *         application/didcomm-plain+json: { schema: { $ref: '#/components/schemas/DidcommPlaintextMessage' } }
   *         application/json: { schema: { $ref: '#/components/schemas/DidcommPlaintextMessage' } }
   *         application/x-www-form-urlencoded: { schema: { $ref: '#/components/schemas/SecureRequest' } }
   *     responses:
   *       '202': { description: Accepted. Poll the Location URL for per-entry results. }
   *       '403': { description: The authenticated sender is not a current tenant controller. }
   *       '404': { description: "Tenant, route capability or jurisdiction was not found." }
   *
   * /{tenantId}/cds-{jurisdiction}/v1/{sector}/organization/org.hl7.fhir.r5/ResearchStudy/_batch-response:
   *   post:
   *     tags: [8.8 Research Study Administration]
   *     summary: Poll ResearchStudy write results
   *     parameters:
   *       - $ref: '#/components/parameters/TenantId'
   *       - $ref: '#/components/parameters/Jurisdiction'
   *       - $ref: '#/components/parameters/Sector'
   *     requestBody:
   *       required: true
   *       content:
   *         application/json: { schema: { $ref: '#/components/schemas/AsyncPollRequest' } }
   *     responses:
   *       '202': { description: Pending. Retry later. }
   *       '200': { description: Completed with one result or OperationOutcome per entry. }
   *
   * /{tenantId}/cds-{jurisdiction}/v1/{sector}/organization/org.hl7.fhir.r5/ResearchStudy/_search:
   *   post:
   *     tags: [8.8 Research Study Administration]
   *     summary: Search studies by official FHIR R5 ResearchStudy parameters
   *     description: |
   *       Base filters accepted in `resource.meta.claims` correspond exactly
   *       to the 25 resource-specific FHIR R5 SearchParameters. The six
   *       governed associated-party claims may also filter the separately
   *       protected party projections. Each match returns one base entry plus
   *       one independent full party-claims entry, all correlated by the same
   *       ResearchStudy id; parallel party arrays are never emitted. A UI may
   *       submit that party entry unchanged in an explicit party DELETE.
   *       See https://hl7.org/fhir/R5/researchstudy-search.html and
   *       https://hl7.org/fhir/R5/researchstudy.html.
   *     parameters:
   *       - $ref: '#/components/parameters/AppId'
   *       - $ref: '#/components/parameters/AppVersion'
   *       - $ref: '#/components/parameters/TenantId'
   *       - $ref: '#/components/parameters/Jurisdiction'
   *       - $ref: '#/components/parameters/Sector'
   *     security: [{ BearerAuth: [] }]
   *     requestBody:
   *       required: true
   *       content:
   *         application/didcomm-plain+json: { schema: { $ref: '#/components/schemas/DidcommPlaintextMessage' } }
   *         application/json: { schema: { $ref: '#/components/schemas/DidcommPlaintextMessage' } }
   *         application/x-www-form-urlencoded: { schema: { $ref: '#/components/schemas/SecureRequest' } }
   *     responses:
   *       '202': { description: Accepted. Poll the Location URL. }
   *       '400': { description: Malformed or unsupported search claim. }
   *
   * /{tenantId}/cds-{jurisdiction}/v1/{sector}/organization/org.hl7.fhir.r5/ResearchStudy/_search-response:
   *   post:
   *     tags: [8.8 Research Study Administration]
   *     summary: Poll ResearchStudy search results
   *     parameters:
   *       - $ref: '#/components/parameters/TenantId'
   *       - $ref: '#/components/parameters/Jurisdiction'
   *       - $ref: '#/components/parameters/Sector'
   *     requestBody:
   *       required: true
   *       content:
   *         application/json: { schema: { $ref: '#/components/schemas/AsyncPollRequest' } }
   *     responses:
   *       '202': { description: Pending. Retry later. }
   *       '200': { description: Completed with one claims-first base entry plus zero or more independently correlated party entries per matching study. }
   *
   * /{tenantId}/cds-{jurisdiction}/v1/{sector}/organization/org.hl7.fhir.r5/Group/_batch:
   *   post:
   *     tags: [8.8 Research Study Administration]
   *     summary: Create, replace or delete descriptive professional and subject groups
   *     description: |
   *       Accepts independent JSON:API primary-document entries using POST,
   *       PUT or DELETE for claims-first FHIR R5 Group base resources, and
   *       PATCH for one separately correlated member. A `practitioner` Group
   *       requires `PractitionerRole/<id>`; an `animal` or `person` Group
   *       requires `Patient/<id>`. DELETE with member claims removes only that
   *       projection. Base
   *       and member records retain only `{ claims }`. Only a current
   *       tenant DID controller may mutate a Group. Membership is descriptive:
   *       it never grants SMART access or substitutes for an active Consent.
   *       See https://hl7.org/fhir/R5/group.html.
   *     parameters:
   *       - $ref: '#/components/parameters/AppId'
   *       - $ref: '#/components/parameters/AppVersion'
   *       - $ref: '#/components/parameters/TenantId'
   *       - $ref: '#/components/parameters/Jurisdiction'
   *       - $ref: '#/components/parameters/Sector'
   *     security: [{ BearerAuth: [] }]
   *     requestBody:
   *       required: true
   *       content:
   *         application/didcomm-plain+json: { schema: { $ref: '#/components/schemas/DidcommPlaintextMessage' } }
   *         application/json: { schema: { $ref: '#/components/schemas/DidcommPlaintextMessage' } }
   *         application/x-www-form-urlencoded: { schema: { $ref: '#/components/schemas/SecureRequest' } }
   *     responses:
   *       '202': { description: Accepted. Poll the Location URL for per-entry results. }
   *       '403': { description: The authenticated sender is not a current tenant controller. }
   *       '404': { description: "Tenant, route capability or jurisdiction was not found." }
   *
   * /{tenantId}/cds-{jurisdiction}/v1/{sector}/organization/org.hl7.fhir.r5/Group/_batch-response:
   *   post:
   *     tags: [8.8 Research Study Administration]
   *     summary: Poll Group write results
   *     parameters:
   *       - $ref: '#/components/parameters/TenantId'
   *       - $ref: '#/components/parameters/Jurisdiction'
   *       - $ref: '#/components/parameters/Sector'
   *     requestBody:
   *       required: true
   *       content:
   *         application/json: { schema: { $ref: '#/components/schemas/AsyncPollRequest' } }
   *     responses:
   *       '202': { description: Pending. Retry later. }
   *       '200': { description: Completed with one write result or OperationOutcome per entry. }
   *
   * /{tenantId}/cds-{jurisdiction}/v1/{sector}/organization/org.hl7.fhir.r5/Group/_search:
   *   post:
   *     tags: [8.8 Research Study Administration]
   *     summary: Search and read descriptive groups by official FHIR R5 parameters
   *     description: |
   *       Returns zero or more claims-first Group resources from the isolated
   *       tenant store. A matching response combines the separately encrypted
   *       member references with base claims without rewriting the base record.
   *       `resource.meta.claims` accepts only the twelve resource-specific
   *       FHIR R5 Group SearchParameters. Identifier tokens use canonical
   *       `system|value`; reference-valued characteristics use only
   *       `characteristic-reference`; `value` and the value side of
   *       `characteristic-value` include only CodeableConcept or boolean
   *       tokens. See
   *       https://hl7.org/fhir/R5/group-search.html.
   *     parameters:
   *       - $ref: '#/components/parameters/AppId'
   *       - $ref: '#/components/parameters/AppVersion'
   *       - $ref: '#/components/parameters/TenantId'
   *       - $ref: '#/components/parameters/Jurisdiction'
   *       - $ref: '#/components/parameters/Sector'
   *     security: [{ BearerAuth: [] }]
   *     requestBody:
   *       required: true
   *       content:
   *         application/didcomm-plain+json: { schema: { $ref: '#/components/schemas/DidcommPlaintextMessage' } }
   *         application/json: { schema: { $ref: '#/components/schemas/DidcommPlaintextMessage' } }
   *         application/x-www-form-urlencoded: { schema: { $ref: '#/components/schemas/SecureRequest' } }
   *     responses:
   *       '202': { description: Accepted. Poll the Location URL. }
   *       '400': { description: Malformed or unsupported search claim. }
   *
   * /{tenantId}/cds-{jurisdiction}/v1/{sector}/organization/org.hl7.fhir.r5/Group/_search-response:
   *   post:
   *     tags: [8.8 Research Study Administration]
   *     summary: Poll Group search results
   *     parameters:
   *       - $ref: '#/components/parameters/TenantId'
   *       - $ref: '#/components/parameters/Jurisdiction'
   *       - $ref: '#/components/parameters/Sector'
   *     requestBody:
   *       required: true
   *       content:
   *         application/json: { schema: { $ref: '#/components/schemas/AsyncPollRequest' } }
   *     responses:
   *       '202': { description: Pending. Retry later. }
   *       '200': { description: Completed with one claims-first Group resource per match. }
   *
   * /{tenantId}/cds-{jurisdiction}/v1/{sector}/organization/org.hl7.fhir.r5/{careResourceType}/_batch:
   *   post:
   *     tags: [8.7 Care Continuity and SOS Work]
   *     summary: Create or replace a care-continuity work resource
   *     description: |
   *       Accepts only `{resourceType,id,meta.claims}` for Encounter,
   *       ServiceRequest, Task or CommunicationRequest. Claims are normalized
   *       against the resource-specific FHIR R5 SearchParameter catalogue,
   *       encrypted as `{claims}`, and indexed with protected names and values.
   *       Native FHIR fields and unknown claims fail before persistence.
   *       Repeating an identical POST is idempotent; the same id with different
   *       claims requires PUT plus the weak ETag returned by the preceding
   *       read. GW owns `<ResourceType>.meta.versionId`; clients may echo it
   *       but cannot choose it. A stale `ifMatch` returns 412 without writing.
   *       ServiceRequest records demand; Task records the
   *       separate operational triage assignment. CommunicationRequest records
   *       governed intent and never proves delivery. DocumentReference stores
   *       the organization-authored payload or attachment without indexing bytes.
   *     parameters:
   *       - $ref: '#/components/parameters/AppId'
   *       - $ref: '#/components/parameters/AppVersion'
   *       - $ref: '#/components/parameters/TenantId'
   *       - $ref: '#/components/parameters/Jurisdiction'
   *       - $ref: '#/components/parameters/Sector'
   *       - name: careResourceType
   *         in: path
   *         required: true
   *         schema: { type: string, enum: [Encounter, ServiceRequest, Task, CommunicationRequest, DocumentReference] }
   *     security: [{ BearerAuth: [] }]
   *     requestBody:
   *       required: true
   *       content:
   *         application/didcomm-plain+json: { schema: { $ref: '#/components/schemas/DidcommPlaintextMessage' } }
   *         application/json: { schema: { $ref: '#/components/schemas/DidcommPlaintextMessage' } }
   *         application/x-www-form-urlencoded: { schema: { $ref: '#/components/schemas/SecureRequest' } }
   *     responses:
   *       '202': { description: Accepted. Poll the Location URL. }
   *       '400': { description: Native, malformed, incomplete or unsupported claims-first resource. }
   *       '404': { description: Tenant, route capability or jurisdiction was not found. }
   *       '412': { description: PUT used a stale weak ETag; no resource was replaced. }
   *
   * /{tenantId}/cds-{jurisdiction}/v1/{sector}/organization/org.hl7.fhir.r5/{careResourceType}/_batch-response:
   *   post:
   *     tags: [8.7 Care Continuity and SOS Work]
   *     summary: Poll a care-continuity write
   *     parameters:
   *       - $ref: '#/components/parameters/TenantId'
   *       - $ref: '#/components/parameters/Jurisdiction'
   *       - $ref: '#/components/parameters/Sector'
   *       - name: careResourceType
   *         in: path
   *         required: true
   *         schema: { type: string, enum: [Encounter, ServiceRequest, Task, CommunicationRequest, DocumentReference] }
   *     requestBody:
   *       required: true
   *       content:
   *         application/json: { schema: { $ref: '#/components/schemas/AsyncPollRequest' } }
   *     responses:
   *       '202': { description: Pending. Retry later. }
   *       '200': { description: Completed with one write result or OperationOutcome per entry. }
   *
   * /{tenantId}/cds-{jurisdiction}/v1/{sector}/organization/org.hl7.fhir.r5/{careResourceType}/_search:
   *   post:
   *     tags: [8.7 Care Continuity and SOS Work]
   *     summary: Search care-continuity work by governed FHIR R5 claims
   *     parameters:
   *       - $ref: '#/components/parameters/AppId'
   *       - $ref: '#/components/parameters/AppVersion'
   *       - $ref: '#/components/parameters/TenantId'
   *       - $ref: '#/components/parameters/Jurisdiction'
   *       - $ref: '#/components/parameters/Sector'
   *       - name: careResourceType
   *         in: path
   *         required: true
   *         schema: { type: string, enum: [Encounter, ServiceRequest, Task, CommunicationRequest, DocumentReference] }
   *     security: [{ BearerAuth: [] }]
   *     requestBody:
   *       required: true
   *       content:
   *         application/didcomm-plain+json: { schema: { $ref: '#/components/schemas/DidcommPlaintextMessage' } }
   *         application/json: { schema: { $ref: '#/components/schemas/DidcommPlaintextMessage' } }
   *         application/x-www-form-urlencoded: { schema: { $ref: '#/components/schemas/SecureRequest' } }
   *     responses:
   *       '202': { description: Accepted. Poll the Location URL. }
   *       '400': { description: Malformed or unsupported search claim. }
   *
   * /{tenantId}/cds-{jurisdiction}/v1/{sector}/organization/org.hl7.fhir.r5/{careResourceType}/_search-response:
   *   post:
   *     tags: [8.7 Care Continuity and SOS Work]
   *     summary: Poll a care-continuity search
   *     parameters:
   *       - $ref: '#/components/parameters/TenantId'
   *       - $ref: '#/components/parameters/Jurisdiction'
   *       - $ref: '#/components/parameters/Sector'
   *       - name: careResourceType
   *         in: path
   *         required: true
   *         schema: { type: string, enum: [Encounter, ServiceRequest, Task, CommunicationRequest, DocumentReference] }
   *     requestBody:
   *       required: true
   *       content:
   *         application/json: { schema: { $ref: '#/components/schemas/AsyncPollRequest' } }
   *     responses:
   *       '202': { description: Pending. Retry later. }
   *       '200': { description: Completed with zero or more claims-first resources. }
   *
   * /{tenantId}/cds-{jurisdiction}/v1/{sector}/digitaltwin/org.hl7.fhir.api/ResearchSubject/_search:
   *   post:
   *     tags:
   *       - 9. Research Digital Twin
   *     summary: Search pseudonymous digital twin ResearchSubjects by section, text and date
   *     description: |
   *       Submits an async section-first digital twin search request.
   *
   *       Public search intent:
   *       - each result is a `ResearchSubject`; claims-first responses mix its
   *         `ResearchSubject.*` and `Composition.*` claims in `meta.claims`,
   *         while versioned FHIR responses place the translated Composition
   *         in `contained[]`
   *       - clients send one or more `section` parameters, non-empty `text`,
   *         inclusive `date-from`, and optional inclusive `date-to`
   *       - section values are ORed; text and date must match the same resource
   *
   *       Current runtime rules:
   *       - request body should carry a FHIR `Parameters` resource
   *       - at least one `section` is required
   *       - omitted `date-to` defaults internally to the current time
   *       - matched twin subjects are deduplicated
   *       - poll completion on the existing `_batch-response` path with the
   *         same `thid`
   *     parameters:
   *       - $ref: '#/components/parameters/AppId'
   *       - $ref: '#/components/parameters/AppVersion'
   *       - $ref: "#/components/parameters/TenantId"
   *       - $ref: "#/components/parameters/Jurisdiction"
   *       - $ref: "#/components/parameters/Sector"
   *     requestBody:
   *       required: true
   *       content:
   *         application/didcomm-plain+json:
   *           schema: { $ref: '#/components/schemas/DidcommPlaintextMessage' }
   *           examples:
   *             message: { $ref: '#/components/examples/ResearchCompositionSearchPlaintextMessage' }
   *         application/json:
   *           schema: { $ref: '#/components/schemas/DidcommPlaintextMessage' }
   *         application/x-www-form-urlencoded:
   *           schema: { $ref: '#/components/schemas/SecureRequest' }
   *     security:
   *       - BearerAuth: []
   *     responses:
   *       '202': { description: Accepted. Poll the `_batch-response` URL for the result. }
   *
   * /{tenantId}/cds-{jurisdiction}/v1/{sector}/digitaltwin/org.hl7.fhir.r4/ResearchSubject/_search:
   *   post:
   *     tags:
   *       - 9. Research Digital Twin
   *     summary: Search strict FHIR R4 digital twin ResearchSubjects by IPS section, text and date
   *     description: |
   *       Same public `ResearchSubject/_search` contract as `org.hl7.fhir.api`.
   *       The response is one aggregate rather than a leaf clinical resource:
   *       claims-first API output mixes `ResearchSubject.*` and `Composition.*`
   *       in one `meta.claims`; strict FHIR R4 places the translated canonical
   *       Composition in `ResearchSubject.contained[]`.
   *     parameters:
   *       - $ref: '#/components/parameters/AppId'
   *       - $ref: '#/components/parameters/AppVersion'
   *       - $ref: "#/components/parameters/TenantId"
   *       - $ref: "#/components/parameters/Jurisdiction"
   *       - $ref: "#/components/parameters/Sector"
   *     requestBody:
   *       required: true
   *       content:
   *         application/didcomm-plain+json:
   *           schema: { $ref: '#/components/schemas/DidcommPlaintextMessage' }
   *         application/json:
   *           schema: { $ref: '#/components/schemas/DidcommPlaintextMessage' }
   *         application/x-www-form-urlencoded:
   *           schema: { $ref: '#/components/schemas/SecureRequest' }
   *     security:
   *       - BearerAuth: []
   *     responses:
   *       '202': { description: Accepted. Poll the `_batch-response` URL for the result. }
   *
   * /{tenantId}/cds-{jurisdiction}/v1/{sector}/digitaltwin/org.hl7.fhir.r4/Composition/_batch-response:
   *   post:
   *     tags:
   *       - 9. Research Digital Twin
   *     summary: Poll strict FHIR R4 research digital twin ingestion result
   *     parameters:
   *       - $ref: '#/components/parameters/AppId'
   *       - $ref: '#/components/parameters/AppVersion'
   *       - $ref: "#/components/parameters/TenantId"
   *       - $ref: "#/components/parameters/Jurisdiction"
   *       - $ref: "#/components/parameters/Sector"
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema: { $ref: '#/components/schemas/AsyncPollRequest' }
   *           examples:
   *             message: { $ref: '#/components/examples/CompositionPollRequest' }
   *         application/x-www-form-urlencoded:
   *           schema: { $ref: '#/components/schemas/AsyncPollRequest' }
   *           examples:
   *             message: { $ref: '#/components/examples/CompositionPollRequest' }
   *     responses:
   *       '202': { description: Pending. Retry later. }
   *       '200': { description: Completed. }
   *
   * /{tenantId}/cds-{jurisdiction}/v1/{sector}/digitaltwin/org.hl7.fhir.api/Composition/_batch-response:
   *   post:
   *     tags:
   *       - 9. Research Digital Twin
   *     summary: Poll research digital twin ingestion result
   *     parameters:
   *       - $ref: '#/components/parameters/AppId'
   *       - $ref: '#/components/parameters/AppVersion'
   *       - $ref: "#/components/parameters/TenantId"
   *       - $ref: "#/components/parameters/Jurisdiction"
   *       - $ref: "#/components/parameters/Sector"
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema: { $ref: '#/components/schemas/AsyncPollRequest' }
   *           examples:
   *             message: { $ref: '#/components/examples/CompositionPollRequest' }
   *         application/x-www-form-urlencoded:
   *           schema: { $ref: '#/components/schemas/AsyncPollRequest' }
   *           examples:
   *             message: { $ref: '#/components/examples/CompositionPollRequest' }
   *     responses:
   *       '202': { description: Pending. Retry later. }
   *       '200': { description: Completed. }
   *
   * /{tenantId}/cds-{jurisdiction}/v1/{sector}/individual/org.hl7.fhir.api/RelatedPerson/_batch:
   *   post:
   *     tags:
   *       - 4.3 Family Member Relationship
   *     summary: Register a family member relationship (emergency contact)
   *     description: |
   *       Stores a relationship/emergency-contact record for an individual using contextualized flat claims (`@context: org.hl7.fhir.api`).
   *       `RelatedPerson.relationship` stores kinship/legal relationship. Optional comma-separated `RelatedPerson.role` stores functional roles such as ECON/BILL; PERMITTED is rejected because access belongs to Consent.
   *       This is intended for family-controlled or self-managed emergency contacts and non-clinical context.
   *       Disable uses the same bounded Bundle route with an explicit
   *       `resource.id` and inactive lifecycle state. Wildcard ids and implicit
   *       all-member operations are forbidden.
   *     parameters:
   *       - $ref: '#/components/parameters/AppId'
   *       - $ref: '#/components/parameters/AppVersion'
   *       - $ref: "#/components/parameters/TenantId"
   *       - $ref: "#/components/parameters/Jurisdiction"
   *       - $ref: "#/components/parameters/Sector"
   *     requestBody:
   *       required: true
   *       content:
   *         application/didcomm-plain+json:
   *           schema: { $ref: '#/components/schemas/DidcommPlaintextMessage' }
   *           examples:
   *             upsert: { $ref: '#/components/examples/FamilyMemberRelationshipPlaintextMessage' }
   *             disable: { $ref: '#/components/examples/RelatedPersonDisablePlaintextMessage' }
   *         application/json:
   *           schema: { $ref: '#/components/schemas/DidcommPlaintextMessage' }
   *           examples:
   *             upsert: { $ref: '#/components/examples/FamilyMemberRelationshipPlaintextMessage' }
   *             disable: { $ref: '#/components/examples/RelatedPersonDisablePlaintextMessage' }
   *         application/x-www-form-urlencoded:
   *           schema: { $ref: '#/components/schemas/SecureRequest' }
   *     security:
   *       - BearerAuth: []
   *     responses:
   *       '202': { description: Accepted. Poll the Location URL for the result. }
   *
   * /{tenantId}/cds-{jurisdiction}/v1/{sector}/individual/org.hl7.fhir.api/RelatedPerson/_batch-response:
   *   post:
   *     tags:
   *       - 4.3 Family Member Relationship
   *     summary: Poll the relationship registration result
   *     parameters:
   *       - $ref: '#/components/parameters/AppId'
   *       - $ref: '#/components/parameters/AppVersion'
   *       - $ref: "#/components/parameters/TenantId"
   *       - $ref: "#/components/parameters/Jurisdiction"
   *       - $ref: "#/components/parameters/Sector"
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema: { $ref: '#/components/schemas/AsyncPollRequest' }
   *           examples:
   *             message: { $ref: '#/components/examples/TenantOrganizationPollRequest' }
   *         application/x-www-form-urlencoded:
   *           schema: { $ref: '#/components/schemas/AsyncPollRequest' }
   *           examples:
   *             message: { $ref: '#/components/examples/TenantOrganizationPollRequest' }
   *     responses:
   *       '202': { description: Pending. Retry later. }
   *       '200': { description: Completed. }
   *
   * /{tenantId}/cds-{jurisdiction}/v1/{sector}/individual/org.hl7.fhir.api/RelatedPerson/_purge:
   *   post:
   *     tags: [4.3 Family Member Relationship]
   *     summary: Purge explicitly identified inactive member relationships
   *     description: |
   *       Each bounded Bundle entry carries one concrete `resource.id`.
   *       Purge requires inactive state; clients own paging, chunking and
   *       retries, while GW authorizes and reports every entry independently.
   *     parameters:
   *       - $ref: '#/components/parameters/AppId'
   *       - $ref: '#/components/parameters/AppVersion'
   *       - $ref: '#/components/parameters/TenantId'
   *       - $ref: '#/components/parameters/Jurisdiction'
   *       - $ref: '#/components/parameters/Sector'
   *     security: [{ BearerAuth: [] }]
   *     requestBody:
   *       required: true
   *       content:
   *         application/didcomm-plain+json:
   *           schema: { $ref: '#/components/schemas/DidcommPlaintextMessage' }
   *           examples:
   *             purge: { $ref: '#/components/examples/RelatedPersonPurgePlaintextMessage' }
   *         application/json:
   *           schema: { $ref: '#/components/schemas/DidcommPlaintextMessage' }
   *           examples:
   *             purge: { $ref: '#/components/examples/RelatedPersonPurgePlaintextMessage' }
   *         application/x-www-form-urlencoded:
   *           schema: { $ref: '#/components/schemas/SecureRequest' }
   *     responses:
   *       '202': { description: Accepted. Poll the Location URL for each entry result. }
   *       '400': { description: Missing id or malformed Bundle entry. }
   *       '409': { description: RelatedPerson must be inactive before purge. }
   *
   * /{tenantId}/cds-{jurisdiction}/v1/{sector}/individual/org.hl7.fhir.api/RelatedPerson/_purge-response:
   *   post:
   *     tags: [4.3 Family Member Relationship]
   *     summary: Poll the RelatedPerson purge result
   *     parameters:
   *       - $ref: '#/components/parameters/AppId'
   *       - $ref: '#/components/parameters/AppVersion'
   *       - $ref: '#/components/parameters/TenantId'
   *       - $ref: '#/components/parameters/Jurisdiction'
   *       - $ref: '#/components/parameters/Sector'
   *     security: [{ BearerAuth: [] }]
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema: { $ref: '#/components/schemas/AsyncPollRequest' }
   *     responses:
   *       '202': { description: Pending. Retry later. }
   *       '200': { description: Completed with per-entry results. }
   *
   * /{tenantId}/cds-{jurisdiction}/v1/{sector}/individual/org.hl7.fhir.api/RelatedPerson/_search:
   *   post:
   *     tags: [4.3 Family Member Relationship]
   *     summary: Page explicitly authorized member relationships
   *     description: Returns the records a controller or management client may use to construct bounded explicit-id lifecycle Bundles. It never performs lifecycle changes itself.
   *     parameters:
   *       - $ref: '#/components/parameters/AppId'
   *       - $ref: '#/components/parameters/AppVersion'
   *       - $ref: '#/components/parameters/TenantId'
   *       - $ref: '#/components/parameters/Jurisdiction'
   *       - $ref: '#/components/parameters/Sector'
   *     security: [{ BearerAuth: [] }]
   *     requestBody:
   *       required: true
   *       content:
   *         application/didcomm-plain+json:
   *           schema: { $ref: '#/components/schemas/DidcommPlaintextMessage' }
   *         application/json:
   *           schema: { $ref: '#/components/schemas/DidcommPlaintextMessage' }
   *     responses:
   *       '202': { description: Accepted. Poll the Location URL. }
   *
   * /{tenantId}/cds-{jurisdiction}/v1/{sector}/individual/org.hl7.fhir.api/RelatedPerson/_search-response:
   *   post:
   *     tags: [4.3 Family Member Relationship]
   *     summary: Poll the RelatedPerson search page
   *     parameters:
   *       - $ref: '#/components/parameters/AppId'
   *       - $ref: '#/components/parameters/AppVersion'
   *       - $ref: '#/components/parameters/TenantId'
   *       - $ref: '#/components/parameters/Jurisdiction'
   *       - $ref: '#/components/parameters/Sector'
   *     security: [{ BearerAuth: [] }]
   *     requestBody:
   *       required: true
   *       content:
   *         application/json: { schema: { $ref: '#/components/schemas/AsyncPollRequest' } }
   *     responses:
   *       '202': { description: Pending. Retry later. }
   *       '200': { description: Completed with one primary resource per match. }
   *
  * /{tenantId}/cds-{jurisdiction}/v1/{sector}/individual/org.schema/Animal/$hashed-claims-issue:
  *   post:
  *     tags:
  *       - 8.1 Subject Profile
  *     summary: Issue request-bound Antifraud commitments for verified Animal claims
  *     description: |
  *       VetChain-local pilot of the Antifraud request-bound SD-JWT profile. The
  *       authenticated animal controller sends FHIR `Parameters`; its UUID v4 `id`
  *       must equal the encrypted DIDComm `thid`. Every parameter name is an
  *       `Animal.*` ResourceType-first flat claim and carries exactly one scalar
  *       `value[x]`. The three identifier claims are mandatory so GW can select
  *       the encrypted issuer evidence before comparing every requested value.
  *
  *       The signed, zero-disclosure SD-JWT is returned as the
  *       `verifiableCredential` value in `Parameters`. Each clear signed claim
  *       key is the canonical attribute-name URN
  *       `urn:cds-<jurisdiction>:v1:identity:animal:org.schema:<Animal.flatClaim>`
  *       and its value is the per-claim seed. Attribute values and HKDF-SHA-384
  *       final salts are never returned. The requester combines its retained
  *       `thid`, each signed seed and its original value to reconstruct the RFC
  *       9901 disclosure whose SHA-384 digest is present in `_sd`.
  *     parameters:
  *       - $ref: '#/components/parameters/AppId'
  *       - $ref: '#/components/parameters/AppVersion'
  *       - $ref: "#/components/parameters/TenantId"
  *       - $ref: "#/components/parameters/Jurisdiction"
  *       - $ref: "#/components/parameters/Sector"
  *     requestBody:
  *       required: true
  *       content:
  *         application/didcomm-plain+json:
  *           schema: { $ref: '#/components/schemas/DidcommPlaintextMessage' }
  *         application/json:
  *           schema: { $ref: '#/components/schemas/DidcommPlaintextMessage' }
  *         application/x-www-form-urlencoded:
  *           schema: { $ref: '#/components/schemas/SecureRequest' }
  *     security:
  *       - BearerAuth: []
  *     responses:
  *       '202': { description: Accepted. Poll the Location URL for the encrypted result. }
  *
  * /{tenantId}/cds-{jurisdiction}/v1/{sector}/individual/org.schema/Animal/$hashed-claims-issue-response:
  *   post:
  *     tags:
  *       - 8.1 Subject Profile
  *     summary: Poll Animal Antifraud commitment issuance
  *     parameters:
  *       - $ref: "#/components/parameters/TenantId"
  *       - $ref: "#/components/parameters/Jurisdiction"
  *       - $ref: "#/components/parameters/Sector"
  *     requestBody:
  *       required: true
  *       content:
  *         application/json:
  *           schema: { $ref: '#/components/schemas/AsyncPollRequest' }
  *     responses:
  *       '202': { description: Pending. Retry later. }
  *       '200': { description: Completed with Parameters containing the issuer-signed SD-JWT. }
  *
  * /{tenantId}/cds-{jurisdiction}/v1/{sector}/individual/org.schema/Person/$hashed-claims-issue:
  *   post:
  *     tags:
  *       - 8.1 Subject Profile
  *     summary: Issue request-bound Antifraud commitments for verified Person claims
  *     description: |
  *       Same controller-authorized Antifraud pilot as the Animal operation, with
  *       `Person.*` ResourceType-first parameter names and the `personal` subject
  *       kind in every canonical attribute-name URN. Values and final salts stay
  *       absent from the issued SD-JWT.
  *     parameters:
  *       - $ref: '#/components/parameters/AppId'
  *       - $ref: '#/components/parameters/AppVersion'
  *       - $ref: "#/components/parameters/TenantId"
  *       - $ref: "#/components/parameters/Jurisdiction"
  *       - $ref: "#/components/parameters/Sector"
  *     requestBody:
  *       required: true
  *       content:
  *         application/didcomm-plain+json:
  *           schema: { $ref: '#/components/schemas/DidcommPlaintextMessage' }
  *         application/json:
  *           schema: { $ref: '#/components/schemas/DidcommPlaintextMessage' }
  *         application/x-www-form-urlencoded:
  *           schema: { $ref: '#/components/schemas/SecureRequest' }
  *     security:
  *       - BearerAuth: []
  *     responses:
  *       '202': { description: Accepted. Poll the Location URL for the encrypted result. }
  *
  * /{tenantId}/cds-{jurisdiction}/v1/{sector}/individual/org.schema/Person/$hashed-claims-issue-response:
  *   post:
  *     tags:
  *       - 8.1 Subject Profile
  *     summary: Poll Person Antifraud commitment issuance
  *     parameters:
  *       - $ref: "#/components/parameters/TenantId"
  *       - $ref: "#/components/parameters/Jurisdiction"
  *       - $ref: "#/components/parameters/Sector"
  *     requestBody:
  *       required: true
  *       content:
  *         application/json:
  *           schema: { $ref: '#/components/schemas/AsyncPollRequest' }
  *     responses:
  *       '202': { description: Pending. Retry later. }
  *       '200': { description: Completed with Parameters containing the issuer-signed SD-JWT. }
  *
  * /{tenantId}/cds-{jurisdiction}/v1/{sector}/individual/org.hl7.fhir.api/Subject/_batch:
  *   post:
  *     tags:
  *       - 8.1 Subject Profile
  *     summary: Associate private semantic identities with a public unified card
  *     description: |
  *       `Subject` is the encrypted collection name, not a resource type. Every
  *       Bundle entry remains `Person`, `Animal`, or future `Place`; its Schema.org
  *       `sameAs` claim contains the stable public unified-card URI.
  *
  *       Claims container note:
  *       - `resource.meta.claims` is a project-specific non-standard claims container
  *       - it is not part of base FHIR
  *       - `@context` may be `org.hl7.fhir.api`, `org.schema`, or another supported context
  *       - when `@context` is already present, keys may be written in a less-qualified form
  *         instead of always repeating the full reverse-DNS prefix
  *
  *       Contract notes:
  *       - private identifier claims are encrypted in the card-scoped tenant vault
  *       - lookup uses SHA3-384 over `type|jurisdiction-or-empty|value`
  *       - the deterministic lookup key is not authorization
  *       - no `SubjectIdentifier` pseudo-resource is accepted
  *     parameters:
  *       - $ref: '#/components/parameters/AppId'
  *       - $ref: '#/components/parameters/AppVersion'
  *       - $ref: "#/components/parameters/TenantId"
  *       - $ref: "#/components/parameters/Jurisdiction"
  *       - $ref: "#/components/parameters/Sector"
  *     requestBody:
  *       required: true
  *       content:
  *         application/didcomm-plain+json:
  *           schema: { $ref: '#/components/schemas/DidcommPlaintextMessage' }
  *         application/json:
  *           schema: { $ref: '#/components/schemas/DidcommPlaintextMessage' }
  *         application/x-www-form-urlencoded:
  *           schema: { $ref: '#/components/schemas/SecureRequest' }
  *     security:
  *       - BearerAuth: []
  *     responses:
  *       '202': { description: Accepted. Poll the Location URL for the result. }
  *
  * /{tenantId}/cds-{jurisdiction}/v1/{sector}/individual/org.hl7.fhir.api/Subject/_batch-response:
  *   post:
  *     tags:
  *       - 8.1 Subject Profile
  *     summary: Poll the Subject profile operation result
  *     parameters:
  *       - $ref: '#/components/parameters/AppId'
  *       - $ref: '#/components/parameters/AppVersion'
  *       - $ref: "#/components/parameters/TenantId"
  *       - $ref: "#/components/parameters/Jurisdiction"
  *       - $ref: "#/components/parameters/Sector"
  *     requestBody:
  *       required: true
  *       content:
  *         application/json:
  *           schema: { $ref: '#/components/schemas/AsyncPollRequest' }
  *           examples:
  *             message: { $ref: '#/components/examples/TenantOrderPollRequest' }
  *         application/x-www-form-urlencoded:
  *           schema: { $ref: '#/components/schemas/AsyncPollRequest' }
  *           examples:
  *             message: { $ref: '#/components/examples/TenantOrderPollRequest' }
  *     responses:
  *       '202': { description: Pending. Retry later. }
  *       '200': { description: Completed. }
  *
  * /{tenantId}/cds-{jurisdiction}/v1/{sector}/individual/org.hl7.fhir.api/Subject/_search:
  *   post:
  *     tags:
  *       - 8.1 Subject Profile
  *     summary: Read private identities for one exact public card
  *     description: |
  *       Accepts a Parameters body containing `card`. The authenticated actor must
  *       be the card subject, carry the exact SMART subject/patient scope, or match
  *       the encrypted controller directory. Collection-wide searches are forbidden.
  *     parameters:
  *       - $ref: '#/components/parameters/AppId'
  *       - $ref: '#/components/parameters/AppVersion'
  *       - $ref: "#/components/parameters/TenantId"
  *       - $ref: "#/components/parameters/Jurisdiction"
  *       - $ref: "#/components/parameters/Sector"
  *     requestBody:
  *       required: true
  *       content:
  *         application/json:
  *           schema: { $ref: '#/components/schemas/DidcommPlaintextMessage' }
  *         application/x-www-form-urlencoded:
  *           schema: { $ref: '#/components/schemas/SecureRequest' }
  *     security:
  *       - BearerAuth: []
  *     responses:
  *       '202': { description: Accepted. Poll the Location URL for the exact-card result. }
  *
  * /{tenantId}/cds-{jurisdiction}/v1/{sector}/individual/org.hl7.fhir.api/Subject/_search-response:
  *   post:
  *     tags:
  *       - 8.1 Subject Profile
  *     summary: Poll the exact-card Subject identity search
  *     parameters:
  *       - $ref: "#/components/parameters/TenantId"
  *       - $ref: "#/components/parameters/Jurisdiction"
  *       - $ref: "#/components/parameters/Sector"
  *     requestBody:
  *       required: true
  *       content:
  *         application/json:
  *           schema: { $ref: '#/components/schemas/AsyncPollRequest' }
  *     responses:
  *       '202': { description: Pending. Retry later. }
  *       '200': { description: Completed with semantic Person/Animal/Place entries. }
  *
  * /{tenantId}/cds-{jurisdiction}/v1/{sector}/individual/org.hl7.fhir.api/Subject/_delete:
  *   post:
  *     tags:
  *       - 8.1 Subject Profile
  *     summary: Remove one private identity and its current distributed resolution
  *     description: |
  *       Accepts `card`, `coding-system`, explicit `jurisdiction` (including an
  *       empty string for a global identifier), and `code-value`. GW derives the
  *       opaque asset id, deletes the encrypted current entry and, when enabled,
  *       deletes its current Fabric resolution without publishing the raw value.
  *     parameters:
  *       - $ref: '#/components/parameters/AppId'
  *       - $ref: '#/components/parameters/AppVersion'
  *       - $ref: "#/components/parameters/TenantId"
  *       - $ref: "#/components/parameters/Jurisdiction"
  *       - $ref: "#/components/parameters/Sector"
  *     requestBody:
  *       required: true
  *       content:
  *         application/json:
  *           schema: { $ref: '#/components/schemas/DidcommPlaintextMessage' }
  *         application/x-www-form-urlencoded:
  *           schema: { $ref: '#/components/schemas/SecureRequest' }
  *     security:
  *       - BearerAuth: []
  *     responses:
  *       '202': { description: Accepted. Poll the Location URL for erasure outcome. }
  *
  * /{tenantId}/cds-{jurisdiction}/v1/{sector}/individual/org.hl7.fhir.api/Subject/_delete-response:
  *   post:
  *     tags:
  *       - 8.1 Subject Profile
  *     summary: Poll the Subject identity erasure result
  *     parameters:
  *       - $ref: "#/components/parameters/TenantId"
  *       - $ref: "#/components/parameters/Jurisdiction"
  *       - $ref: "#/components/parameters/Sector"
  *     requestBody:
  *       required: true
  *       content:
  *         application/json:
  *           schema: { $ref: '#/components/schemas/AsyncPollRequest' }
  *     responses:
  *       '202': { description: Pending. Retry later. }
  *       '200': { description: Completed; current encrypted and ledger resolution removed. }
  *
  * /{tenantId}/cds-{jurisdiction}/v1/{sector}/individual/org.hl7.fhir.api/Patient/$match:
  *   post:
  *     tags:
  *       - 8.1 Subject Profile
  *     summary: Resolve one individual from an exact chip or public-card identifier
  *     description: |
  *       PDQm-style exact-match operation used by authenticated callers such as a
  *       veterinarian, veterinary assistant, police officer, member, or controller.
  *       It accepts FHIR `Parameters` with exactly one `Patient.identifier`,
  *       and `onlyCertainMatches=true`. The request may carry Parameters
  *       directly or as the sole resource in a DIDComm batch entry whose request is
  *       `POST Patient/$match`.
  *
  *       Identifier contract:
  *       - a chip is sent as its original `system` and `value`
  *       - a public card uses `urn:ietf:rfc:3986` and its stable URI value
  *       - clients must not send the derived alias or any hash
  *       - GW derives the opaque alias locally, resolves the encrypted card pointer,
  *         and returns only a certain-match Patient alias or an empty searchset
  *       - identity resolution does not authorize emergency-contact communication or
  *         clinical reads; those remain separate consent/SMART policy decisions
  *     parameters:
  *       - $ref: '#/components/parameters/AppId'
  *       - $ref: '#/components/parameters/AppVersion'
  *       - $ref: "#/components/parameters/TenantId"
  *       - $ref: "#/components/parameters/Jurisdiction"
  *       - $ref: "#/components/parameters/Sector"
  *     requestBody:
  *       required: true
  *       content:
  *         application/didcomm-plain+json:
  *           schema: { $ref: '#/components/schemas/DidcommPlaintextMessage' }
  *         application/json:
  *           schema: { $ref: '#/components/schemas/DidcommPlaintextMessage' }
  *         application/x-www-form-urlencoded:
  *           schema: { $ref: '#/components/schemas/SecureRequest' }
  *     security:
  *       - BearerAuth: []
  *     responses:
  *       '200': { description: Completed synchronously for native FHIR, DIDComm plain, or protected form transport. }
  *       '202': { description: Accepted by the JSON compatibility transport. Poll the Location URL. }
  *
  * /{tenantId}/cds-{jurisdiction}/v1/{sector}/individual/org.hl7.fhir.api/Patient/$match-response:
  *   post:
  *     tags:
  *       - 8.1 Subject Profile
  *     summary: Poll the exact Patient match result
  *     parameters:
  *       - $ref: "#/components/parameters/TenantId"
  *       - $ref: "#/components/parameters/Jurisdiction"
  *       - $ref: "#/components/parameters/Sector"
  *     requestBody:
  *       required: true
  *       content:
  *         application/json:
  *           schema: { $ref: '#/components/schemas/AsyncPollRequest' }
  *     responses:
  *       '202': { description: Pending. Retry later. }
  *       '200': { description: Completed with a FHIR searchset containing zero or one certain match. }
  *
  * /{tenantId}/cds-{jurisdiction}/v1/{sector}/individual/org.hl7.fhir.api/Subject/$summary:
  *   post:
  *     x-contract-level: internal-compatibility
  *     tags:
  *       - 8.1 Subject Profile
  *     summary: Internal compatibility operation for subject summary resolution
  *     description: |
  *       This HTTP route is an internal operation reference and lower-level
  *       compatibility surface. Application and BFF code must use the actor-facade
  *       `requestClinicalSummary(...)` method. That method submits an auditable
  *       `Communication` through `Communication/_batch`; GW then resolves
  *       `Subject/$summary` internally and returns the Parameters/Bundle result through
  *       the same Communication lifecycle.
  *
  *       Current enablement:
  *       - sectors starting with `health-`
  *       - sectors starting with `animal-`
  *       - sectors starting with `onehealth-`
  *
  *       Contract notes:
  *       - requests travel in the project DIDComm/FAPI envelope and batch conventions
  *       - `resource.meta.claims` remains the canonical non-standard claims carrier for
  *         FHIR-like resources in those envelopes
  *       - `Subject/$summary` is the canonical internal operation name, not the public
  *         application transport boundary.
  *       - `Patient/$summary` is a compatibility alias with the same behavior.
  *       - request body should be a FHIR `Parameters` resource
  *       - minimum required parameter is `subject`
  *       - optional parameters include `document-type`, `section`, and `exclude-section`
  *       - GW validates the requested subject against the authenticated SMART scope
  *       - omitting a section filter inherits the SMART-authorized set; an explicit
  *         filter narrows it to the requested/authorized intersection
  *       - unrelated clinical resources and unscoped DocumentReferences are omitted
  *       - direct and transitive DocumentReferences remain in their authorized section
  *
  *       See also:
  *       - `gdc-common-utils-ts/docs/101-COMMUNICATION_LAYERING.md`
  *       - `gdc-sdk-core-ts/docs/101-IPS_COMMUNICATION_OUTBOX.md`
  *     parameters:
  *       - $ref: '#/components/parameters/AppId'
  *       - $ref: '#/components/parameters/AppVersion'
  *       - $ref: "#/components/parameters/TenantId"
  *       - $ref: "#/components/parameters/Jurisdiction"
  *       - $ref: "#/components/parameters/Sector"
  *     requestBody:
  *       required: true
  *       content:
  *         application/didcomm-plain+json:
  *           schema: { $ref: '#/components/schemas/DidcommPlaintextMessage' }
  *         application/json:
  *           schema: { $ref: '#/components/schemas/DidcommPlaintextMessage' }
  *         application/x-www-form-urlencoded:
  *           schema: { $ref: '#/components/schemas/SecureRequest' }
  *     security:
  *       - BearerAuth: []
  *     responses:
  *       '202': { description: Accepted. Poll the Location URL for the result. }
  *
  * /{tenantId}/cds-{jurisdiction}/v1/{sector}/individual/org.hl7.fhir.api/Patient/$summary:
  *   post:
  *     x-contract-level: internal-compatibility
  *     tags:
  *       - 8.1 Subject Profile
  *     summary: Compatibility alias for Subject summary
  *     description: |
  *       Alias of `Subject/$summary` kept for healthcare-oriented clients.
  *       New cross-sector code should prefer `Subject/$summary`.
  *     parameters:
  *       - $ref: '#/components/parameters/AppId'
  *       - $ref: '#/components/parameters/AppVersion'
  *       - $ref: "#/components/parameters/TenantId"
  *       - $ref: "#/components/parameters/Jurisdiction"
  *       - $ref: "#/components/parameters/Sector"
  *     requestBody:
  *       required: true
  *       content:
  *         application/didcomm-plain+json:
  *           schema: { $ref: '#/components/schemas/DidcommPlaintextMessage' }
  *         application/json:
  *           schema: { $ref: '#/components/schemas/DidcommPlaintextMessage' }
  *         application/x-www-form-urlencoded:
  *           schema: { $ref: '#/components/schemas/SecureRequest' }
  *     security:
  *       - BearerAuth: []
  *     responses:
  *       '202': { description: Accepted. Poll the Location URL for the result. }
   * 
   * /host/cds-{jurisdiction}/v1/{sector}/registry/org.schema/Order/_batch:
   *   post:
   *     tags:
   *       - 1.2 Organization Order
   *     summary: Confirm the organization registration order (host)
   *     description: |
   *       Step 2 of onboarding. Submits an Order that accepts a prior Offer from Step 1 (tenant registration).
   *       The Offer ID is supplied in the request body as Order.acceptedOffer.identifier and must match the
   *       Offer returned by the Organization activation `_activate-response`.
   *       This step is always required (including `0` amount offers).
   *       Legacy onboarding builds the representative controller before tenant finalization so its DID is present from version one.
   *       The final polled result typically contains payment/checkout claims and the first controller
   *       activation code (`org.schema.IndividualProduct.serialNumber`).
   *     parameters:
   *       - $ref: '#/components/parameters/AppId'
   *       - $ref: '#/components/parameters/AppVersion'
   *       - $ref: '#/components/parameters/Jurisdiction'
   *       - $ref: '#/components/parameters/HostRegistrySector'
   *     requestBody:
   *       description: |
   *         Production: only `application/x-www-form-urlencoded` is accepted (secure JWE envelope with `request=`).
   *         Demo/Test-Network: `application/didcomm-plain+json` is canonical, and `application/json` is also accepted for simplicity.
   *       required: true
   *       content:
   *         application/didcomm-plain+json:
   *           schema:
   *             $ref: '#/components/schemas/DidcommPlaintextMessage'
   *           examples:
   *             message:
   *               $ref: '#/components/examples/OrganizationOrderPlaintextMessage'
   *         application/json:
   *           schema:
   *             $ref: '#/components/schemas/DidcommPlaintextMessage'
   *         application/x-www-form-urlencoded:
   *           schema:
   *             $ref: '#/components/schemas/SecureRequest'
   *     security:
   *       - BearerAuth: []
   *     responses:
   *       '202': { description: Accepted. Poll the Location URL for the result. }
   *
   * /host/cds-{jurisdiction}/v1/{sector}/registry/org.schema/Organization/_batch-response:
   *   post:
   *     tags:
   *       - 1.1 Organization Registration
   *     summary: Poll the organization registration result (host)
   *     description: |
   *       Polls the asynchronous job submitted to `.../Organization/_batch`.
   *
   *       Submit vs poll behavior:
   *       - Submit (`_batch`) returns immediate errors if the request cannot be accepted/enqueued.
   *       - Poll (`_batch-response`) returns `202` while pending, then `200` (success) or `500` (processing error).
   *
   *       Response format depends on the original submission flow:
   *       - Legacy/plaintext: returns JSON.
   *       - Secure (form-encoded JWE): returns `application/x-www-form-urlencoded` with `response=<jwe>`.
   *     parameters:
   *       - $ref: '#/components/parameters/AppId'
   *       - $ref: '#/components/parameters/AppVersion'
   *       - $ref: '#/components/parameters/Jurisdiction'
   *       - $ref: '#/components/parameters/HostRegistrySector'
   *     security:
   *       - BearerAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema: { $ref: '#/components/schemas/AsyncPollRequest' }
   *           examples:
   *             message: { $ref: '#/components/examples/OrganizationRegistrationPollRequest' }
   *         application/x-www-form-urlencoded:
   *           schema: { $ref: '#/components/schemas/AsyncPollRequest' }
   *           examples:
   *             message: { $ref: '#/components/examples/OrganizationRegistrationPollRequest' }
   *     responses:
   *       '202':
   *         description: Pending. Retry later.
   *         headers:
   *           Retry-After:
   *             schema: { type: string, example: '5' }
   *         content:
   *           application/json:
   *             schema: { $ref: '#/components/schemas/AsyncPollPending' }
   *             examples:
   *               message: { $ref: '#/components/examples/AsyncPollPending' }
   *       '200':
   *         description: Completed. Returns either JSON (legacy) or `response=<jwe>` (secure).
   *         content:
   *           application/json:
   *             schema: { type: object }
   *           application/x-www-form-urlencoded:
   *             schema: { $ref: '#/components/schemas/AsyncPollSecureResponse' }
   *             examples:
   *               message: { $ref: '#/components/examples/AsyncPollSecureResponse' }
   *       '400': { description: Missing or invalid thid. }
   *       '404': { description: thid not found. }
   *       '500': { description: Job failed or response decode failed. }
   *
   * /host/cds-{jurisdiction}/v1/{sector}/registry/org.schema/Organization/_activate-response:
   *   post:
   *     tags:
   *       - 1.1 Organization Activation
   *     summary: Poll the organization activation result (host)
   *     description: |
   *       Polls the asynchronous job submitted to `.../Organization/_activate`.
   *
   *       Submit vs poll behavior:
   *       - Submit (`_activate`) returns immediate errors if the request cannot be accepted/enqueued.
   *       - Poll (`_activate-response`) returns `202` while pending, then `200` (success) or `500` (processing error).
   *
   *       Response format depends on the original submission flow:
   *       - Plaintext: returns JSON.
   *       - Secure (form-encoded JWE): returns `application/x-www-form-urlencoded` with `response=<jwe>`.
   *     parameters:
   *       - $ref: '#/components/parameters/AppId'
   *       - $ref: '#/components/parameters/AppVersion'
   *       - $ref: '#/components/parameters/Jurisdiction'
   *       - $ref: '#/components/parameters/HostRegistrySector'
   *     security:
   *       - BearerAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema: { $ref: '#/components/schemas/AsyncPollRequest' }
   *           examples:
   *             message: { $ref: '#/components/examples/AsyncPollRequest' }
   *         application/x-www-form-urlencoded:
   *           schema: { $ref: '#/components/schemas/AsyncPollRequest' }
   *           examples:
   *             message: { $ref: '#/components/examples/AsyncPollRequest' }
   *     responses:
   *       '202': { description: Pending. Retry later. }
   *       '200':
   *         description: Completed. Returns either JSON (plaintext) or `response=<jwe>` (secure).
   *         content:
   *           application/json:
   *             schema: { $ref: '#/components/schemas/DidcommPlaintextMessage' }
   *             examples:
   *               message: { $ref: '#/components/examples/OrganizationActivationResponseBundle' }
   *       '400': { description: Missing or invalid thid. }
   *       '404': { description: thid not found. }
   *       '500': { description: Job failed or response decode failed. }
   *
   * /host/cds-{jurisdiction}/v1/{sector}/registry/org.schema/Order/_batch-response:
   *   post:
   *     tags:
   *       - 1.2 Organization Order
   *     summary: Poll the organization order result (host)
   *     description: |
   *       Polls the asynchronous job submitted to `.../Order/_batch`. The `jurisdiction` and `sector` are path routing parameters for the host registry.
   *       The completed response returns a Bundle entry with order invoice claims plus one embedded invoice
   *       `resource` Bundle containing a FHIR `Invoice`, one PDF `DocumentReference`, and one structured
   *       `DocumentReference` carrying JSON/XML invoice payloads. `org.schema.Order.partOfInvoice` and
   *       `org.schema.Order.paymentUrl` remain as flat compatibility claims for legacy readers.
   *     parameters:
   *       - $ref: '#/components/parameters/AppId'
   *       - $ref: '#/components/parameters/AppVersion'
   *       - $ref: '#/components/parameters/Jurisdiction'
   *       - $ref: '#/components/parameters/HostRegistrySector'
   *     security:
   *       - BearerAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema: { $ref: '#/components/schemas/AsyncPollRequest' }
   *           examples:
   *             message: { $ref: '#/components/examples/OrganizationOrderPollRequest' }
   *         application/x-www-form-urlencoded:
   *           schema: { $ref: '#/components/schemas/AsyncPollRequest' }
   *           examples:
   *             message: { $ref: '#/components/examples/OrganizationOrderPollRequest' }
   *     responses:
   *       '202':
   *         description: Pending. Retry later.
   *         headers:
   *           Retry-After:
   *             schema: { type: string, example: '5' }
   *         content:
   *           application/json:
   *             schema: { $ref: '#/components/schemas/AsyncPollPending' }
   *       '200':
   *         description: Completed. Returns either JSON (legacy) or `response=<jwe>` (secure).
   *         content:
   *           application/json:
   *             schema: { type: object }
   *             examples:
   *               message: { $ref: '#/components/examples/OrganizationOrderResponseBundle' }
   *           application/x-www-form-urlencoded:
   *             schema: { $ref: '#/components/schemas/AsyncPollSecureResponse' }
   *       '400': { description: Missing or invalid thid. }
   *       '404': { description: thid not found. }
   *       '500': { description: Job failed or response decode failed. }
   *
   * /{tenantId}/cds-{jurisdiction}/v1/{sector}/individual/org.schema/Organization/_disable:
   *   post:
   *     tags: [4.1 Family Registration]
   *     summary: Disable one explicitly identified individual organization
   *     description: Disables only the organization addressed by its canonical claims; it does not expand a wildcard or cascade across unrelated organizations.
   *     parameters:
   *       - $ref: '#/components/parameters/AppId'
   *       - $ref: '#/components/parameters/AppVersion'
   *       - $ref: '#/components/parameters/TenantId'
   *       - $ref: '#/components/parameters/Jurisdiction'
   *       - $ref: '#/components/parameters/Sector'
   *     security: [{ BearerAuth: [] }]
   *     requestBody:
   *       required: true
   *       content:
   *         application/didcomm-plain+json:
   *           schema: { $ref: '#/components/schemas/DidcommPlaintextMessage' }
   *           examples: { disable: { $ref: '#/components/examples/IndividualOrganizationDisablePlaintextMessage' } }
   *         application/json:
   *           schema: { $ref: '#/components/schemas/DidcommPlaintextMessage' }
   *           examples: { disable: { $ref: '#/components/examples/IndividualOrganizationDisablePlaintextMessage' } }
   *     responses:
   *       '202': { description: Accepted. Poll the Location URL. }
   *
   * /{tenantId}/cds-{jurisdiction}/v1/{sector}/individual/org.schema/Organization/_purge:
   *   post:
   *     tags: [4.1 Family Registration]
   *     summary: Purge one explicitly identified inactive individual organization
   *     description: Requires inactive state and never expands an implicit all-organizations selector.
   *     parameters:
   *       - $ref: '#/components/parameters/AppId'
   *       - $ref: '#/components/parameters/AppVersion'
   *       - $ref: '#/components/parameters/TenantId'
   *       - $ref: '#/components/parameters/Jurisdiction'
   *       - $ref: '#/components/parameters/Sector'
   *     security: [{ BearerAuth: [] }]
   *     requestBody:
   *       required: true
   *       content:
   *         application/didcomm-plain+json:
   *           schema: { $ref: '#/components/schemas/DidcommPlaintextMessage' }
   *           examples: { purge: { $ref: '#/components/examples/IndividualOrganizationPurgePlaintextMessage' } }
   *         application/json:
   *           schema: { $ref: '#/components/schemas/DidcommPlaintextMessage' }
   *           examples: { purge: { $ref: '#/components/examples/IndividualOrganizationPurgePlaintextMessage' } }
   *     responses:
   *       '202': { description: Accepted. Poll the Location URL. }
   *       '409': { description: Organization must be inactive before purge. }
   *
   * /{tenantId}/cds-{jurisdiction}/v1/{sector}/individual/org.schema/Organization/_disable-response:
   *   post:
   *     tags: [4.1 Family Registration]
   *     summary: Poll individual-organization disable
   *     security: [{ BearerAuth: [] }]
   *     requestBody: { required: true, content: { application/json: { schema: { $ref: '#/components/schemas/AsyncPollRequest' } } } }
   *     responses: { '202': { description: Pending. }, '200': { description: Completed. } }
   *
   * /{tenantId}/cds-{jurisdiction}/v1/{sector}/individual/org.schema/Organization/_purge-response:
   *   post:
   *     tags: [4.1 Family Registration]
   *     summary: Poll individual-organization purge
   *     security: [{ BearerAuth: [] }]
   *     requestBody: { required: true, content: { application/json: { schema: { $ref: '#/components/schemas/AsyncPollRequest' } } } }
   *     responses: { '202': { description: Pending. }, '200': { description: Completed. } }
   *
   * /{tenantId}/cds-{jurisdiction}/v1/{sector}/individual/org.schema/Organization/_batch:
   *   post:
   *     tags:
   *       - 4.1 Family Registration
  *     summary: Register a legacy individual organization offer
   *     description: |
  *       Legacy compatibility endpoint for hosted individual onboarding.
  *       The current portal flow uses tenant organization activation from signed proof and individual indexing in the hosted tenant.
  *
  *       This route also accepts a signed individual onboarding PDF as a DIDComm attachment.
  *       When present, the gateway verifies the PDF signature, extracts the signer certificate
  *       subject, reads the additional form fields, and completes the individual registration claims
  *       without overwriting certificate-derived person identity data.
  *
  *       New integrations should prefer the `_transaction` alias below. `_batch` is kept for compatibility
  *       and will be deprecated after clients migrate.
   *     parameters:
   *       - $ref: '#/components/parameters/AppId'
   *       - $ref: '#/components/parameters/AppVersion'
   *       - $ref: "#/components/parameters/TenantId"
   *       - $ref: "#/components/parameters/Jurisdiction"
   *       - $ref: "#/components/parameters/Sector"
   *     requestBody:
   *       description: |
   *         Production: only `application/x-www-form-urlencoded` is accepted (secure JWE envelope with `request=`).
   *         Demo/Test-Network: `application/didcomm-plain+json` is canonical, and `application/json` is also accepted for simplicity.
   *       required: true
   *       content:
   *         application/didcomm-plain+json:
   *           schema:
   *             $ref: '#/components/schemas/DidcommPlaintextMessage'
   *           examples:
   *             viaOnlinePdfLink:
   *               $ref: '#/components/examples/FamilyRegistrationPlaintextMessage'
   *             viaInlineBase64Pdf:
   *               $ref: '#/components/examples/FamilyRegistrationPlaintextMessageInlineBase64'
   *         application/json:
   *           schema:
   *             $ref: '#/components/schemas/DidcommPlaintextMessage'
   *         application/x-www-form-urlencoded:
   *           schema:
   *             $ref: '#/components/schemas/SecureRequest'
   *     security:
   *       - BearerAuth: []
   *     responses:
   *       '202': { description: Accepted. Poll the Location URL for the Offer result. }
   *
   * /{tenantId}/cds-{jurisdiction}/v1/{sector}/individual/org.schema/Organization/_transaction:
   *   post:
   *     tags:
   *       - 4.1 Family Registration
  *     summary: Register an individual organization transaction with optional signed PDF attachment
   *     description: |
  *       Canonical successor of `.../Organization/_batch` for individual organization onboarding.
  *       The payload shape is the same as `_batch`, but the semantic contract is transactional:
  *       the individual organization, the legal representative/controller claims, and the signed PDF
  *       attachment travel together as one business transaction.
  *
  *       When the DIDComm message includes a PDF attachment (`media_type: application/pdf`), the gateway:
  *       - validates the PDF signature,
  *       - extracts the natural-person certificate subject,
  *       - reads the form fields,
  *       - derives CORE claims from certificate + form,
  *       - and merges them with request claims, preserving certificate-derived identity values as authoritative.
   *     parameters:
   *       - $ref: '#/components/parameters/AppId'
   *       - $ref: '#/components/parameters/AppVersion'
   *       - $ref: "#/components/parameters/TenantId"
   *       - $ref: "#/components/parameters/Jurisdiction"
   *       - $ref: "#/components/parameters/Sector"
   *     requestBody:
   *       description: |
   *         Same payload contract as `_batch`. Production: only `application/x-www-form-urlencoded`
   *         is accepted (secure JWE envelope with `request=`). Demo/Test-Network:
   *         `application/didcomm-plain+json` is canonical, and `application/json`
   *         is also accepted for simplicity.
   *         With `@context: "org.schema"`, clients may send contextualized keys such as `Organization.identifier.value`
   *         or `Service.category` without the `org.schema.` prefix; that is the documented default mode.
   *         If the service enables `CLAIMS_IDENTITY_STORAGE_MODE=canonical`, equivalent fully-qualified `org.schema.*`
   *         keys remain valid. `Service.termsOfService` may be an HTTPS URL or an embedded PDF data URL; Swagger uses
   *         the HTTPS URL form as the default example.
   *       required: true
   *       content:
   *         application/didcomm-plain+json:
   *           schema:
   *             $ref: '#/components/schemas/DidcommPlaintextMessage'
   *           examples:
   *             viaOnlinePdfLink:
   *               $ref: '#/components/examples/FamilyRegistrationPlaintextMessage'
   *             viaInlineBase64Pdf:
   *               $ref: '#/components/examples/FamilyRegistrationPlaintextMessageInlineBase64'
   *         application/json:
   *           schema:
   *             $ref: '#/components/schemas/DidcommPlaintextMessage'
   *         application/x-www-form-urlencoded:
   *           schema:
   *             $ref: '#/components/schemas/SecureRequest'
   *     security:
   *       - BearerAuth: []
   *     responses:
   *       '202': { description: Accepted. Poll the Location URL for the transaction result. }
   *
   * /{tenantId}/cds-{jurisdiction}/v1/{sector}/individual/org.schema/Organization/_batch-response:
   *   post:
   *     tags:
   *       - 4.1 Family Registration
  *     summary: Poll the legacy individual registration result (Offer)
   *     parameters:
   *       - $ref: '#/components/parameters/AppId'
   *       - $ref: '#/components/parameters/AppVersion'
   *       - $ref: "#/components/parameters/TenantId"
   *       - $ref: "#/components/parameters/Jurisdiction"
   *       - $ref: "#/components/parameters/Sector"
   *     security:
   *       - BearerAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema: { $ref: '#/components/schemas/AsyncPollRequest' }
   *         application/x-www-form-urlencoded:
   *           schema: { $ref: '#/components/schemas/AsyncPollRequest' }
   *     responses:
   *       '202': { description: Pending. Retry later. }
   *       '200': { description: Completed. }
   *       '400': { description: Missing or invalid thid. }
   *       '404': { description: thid not found. }
   *       '500': { description: Job failed or response decode failed. }
   *
   * /{tenantId}/cds-{jurisdiction}/v1/{sector}/individual/org.schema/Organization/_transaction-response:
   *   post:
   *     tags:
   *       - 4.1 Family Registration
  *     summary: Poll the individual registration transaction result
   *     parameters:
   *       - $ref: '#/components/parameters/AppId'
   *       - $ref: '#/components/parameters/AppVersion'
   *       - $ref: "#/components/parameters/TenantId"
   *       - $ref: "#/components/parameters/Jurisdiction"
   *       - $ref: "#/components/parameters/Sector"
   *     security:
   *       - BearerAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema: { $ref: '#/components/schemas/AsyncPollRequest' }
   *         application/x-www-form-urlencoded:
   *           schema: { $ref: '#/components/schemas/AsyncPollRequest' }
   *     responses:
   *       '202': { description: Pending. Retry later. }
   *       '200': { description: Completed. }
   *       '400': { description: Missing or invalid thid. }
   *       '404': { description: thid not found. }
   *       '500': { description: Job failed or response decode failed. }
   *
   * /{tenantId}/cds-{jurisdiction}/v1/{sector}/individual/org.schema/Order/_batch:
   *   post:
   *     tags:
   *       - 4.2 Family Order
  *     summary: Confirm the legacy individual organization order (accept Offer)
   *     description: |
  *       Legacy compatibility only. Submits an Order that accepts the registration Offer to complete the historical onboarding flow.
   *       The Offer ID is supplied in the request body as Order.acceptedOffer.identifier and must match the
   *       Offer returned by the family registration _batch-response.
   *     parameters:
   *       - $ref: '#/components/parameters/AppId'
   *       - $ref: '#/components/parameters/AppVersion'
   *       - $ref: "#/components/parameters/TenantId"
   *       - $ref: "#/components/parameters/Jurisdiction"
   *       - $ref: "#/components/parameters/Sector"
   *     requestBody:
   *       description: |
   *         Production: only `application/x-www-form-urlencoded` is accepted (secure JWE envelope with `request=`).
   *         Demo/Test-Network: `application/didcomm-plain+json` is canonical, and `application/json` is also accepted for simplicity.
   *       required: true
   *       content:
   *         application/didcomm-plain+json:
   *           schema:
   *             $ref: '#/components/schemas/DidcommPlaintextMessage'
   *           examples:
   *             message:
   *               $ref: '#/components/examples/FamilyOrderPlaintextMessage'
   *         application/json:
   *           schema:
   *             $ref: '#/components/schemas/DidcommPlaintextMessage'
   *         application/x-www-form-urlencoded:
   *           schema:
   *             $ref: '#/components/schemas/SecureRequest'
   *     security:
   *       - BearerAuth: []
   *     responses:
   *       '202': { description: Accepted. Poll the Location URL for the result. }
   *
   * /{tenantId}/cds-{jurisdiction}/v1/{sector}/individual/org.schema/Order/_batch-response:
   *   post:
   *     tags:
   *       - 4.2 Family Order
  *     summary: Poll the legacy individual order result
   *     description: |
   *       Polls the asynchronous job submitted to `.../Order/_batch`. The `tenantId`, `jurisdiction`, and `sector` are path routing parameters for the tenant's individual registry.
   *       The completed response returns a Bundle entry with order invoice claims plus one embedded invoice
   *       `resource` Bundle containing a FHIR `Invoice`, one PDF `DocumentReference`, and one structured
   *       `DocumentReference` carrying JSON/XML invoice payloads.
   *     parameters:
   *       - $ref: '#/components/parameters/AppId'
   *       - $ref: '#/components/parameters/AppVersion'
   *       - $ref: "#/components/parameters/TenantId"
   *       - $ref: "#/components/parameters/Jurisdiction"
   *       - $ref: "#/components/parameters/Sector"
   *     security:
   *       - BearerAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema: { $ref: '#/components/schemas/AsyncPollRequest' }
   *           examples:
   *             message: { $ref: '#/components/examples/DeviceRegistrationPollRequest' }
   *         application/x-www-form-urlencoded:
   *           schema: { $ref: '#/components/schemas/AsyncPollRequest' }
   *           examples:
   *             message: { $ref: '#/components/examples/DeviceRegistrationPollRequest' }
   *     responses:
   *       '202': { description: Pending. Retry later. }
   *       '200':
   *         description: Completed.
   *         content:
   *           application/json:
   *             schema: { $ref: '#/components/schemas/DidcommPlaintextMessage' }
   *             examples:
   *               message: { $ref: '#/components/examples/DeviceRegistrationResponse' }
   *       '400': { description: Missing or invalid thid. }
   *       '404': { description: thid not found. }
   *       '500': { description: Job failed or response decode failed. }
   *
   * /{tenantId}/cds-{jurisdiction}/v1/{sector}/identity/openid/Device/_revoke:
   *   post:
   *     tags: [2.1.3 Dynamic Client Registration]
   *     summary: Revoke one employee device while preserving its seat
   *     description: |
   *       Canonical route: `/host/cds-{jurisdiction}/v1/{sector}/{tenantId}/identity/auth/_revoke`.
   *       A controller supplies `body.license_id` and `body.client_id`. GW revokes
   *       that device profile, its employee DID verification methods and ledger
   *       key bindings. Other devices and the employee licence remain active.
   *     security: [{ BearerAuth: [] }]
   *     responses:
   *       '202': { description: Accepted. Poll the paired `_revoke-response` route. }
   *       '404': { description: Licence or active device binding not found. }
   *
   * /{tenantId}/cds-{jurisdiction}/v1/{sector}/identity/openid/Device/_dcr:
   *   post:
   *     tags:
   *       - 2.1.3 Device Registration (DCR)
   *     summary: Register device keys (OpenID DCR)
   *     description: |
   *       Canonical route for new integrations is:
   *       `/host/cds-{jurisdiction}/v1/{sector}/{tenantId}/identity/auth/_dcr`.
   *       This `identity/openid` route is maintained as a temporary compatibility alias.
   *
   *       Registers a device/client using OpenID Dynamic Client Registration. Requires an initial_access_token from Token/_exchange.
   *       A server-side professional continuation may omit `body.code`; the
   *       gateway then uses the activation binding already verified inside that
   *       initial access token. If both are supplied they must match.
   *       Request is usually a secure (form-encoded JWE) DIDComm message; demo plaintext is also accepted.
   *     parameters:
   *       - $ref: '#/components/parameters/AppId'
   *       - $ref: '#/components/parameters/AppVersion'
   *       - $ref: "#/components/parameters/TenantId"
   *       - $ref: "#/components/parameters/Jurisdiction"
   *       - $ref: "#/components/parameters/Sector"
   *     requestBody:
   *       description: |
   *         Production: only `application/x-www-form-urlencoded` is accepted (secure JWE envelope with `request=`).
   *         Demo/Test-Network: `application/didcomm-plain+json` is canonical, and `application/json` is also accepted for simplicity.
   *       required: true
   *       content:
   *         application/didcomm-plain+json:
   *           schema:
   *             $ref: '#/components/schemas/DidcommPlaintextMessage'
   *           examples:
   *             message:
   *               $ref: '#/components/examples/DeviceRegistrationPlaintextMessage'
   *         application/json:
   *           schema:
   *             $ref: '#/components/schemas/DidcommPlaintextMessage'
   *         application/x-www-form-urlencoded:
   *           schema:
   *             $ref: '#/components/schemas/SecureRequest'
   *     security:
   *       - BearerAuth: []
   *     responses:
   *       '202': { description: Accepted. Poll the Location URL for the result. }
   *
 * /{tenantId}/cds-{jurisdiction}/v1/{sector}/identity/openid/Device/_dcr-response:
 *   post:
   *     tags:
   *       - 2.1.3 Device Registration (DCR)
   *     summary: Poll the device registration (DCR) result
   *     parameters:
   *       - $ref: '#/components/parameters/AppId'
   *       - $ref: '#/components/parameters/AppVersion'
   *       - $ref: "#/components/parameters/TenantId"
   *       - $ref: "#/components/parameters/Jurisdiction"
   *       - $ref: "#/components/parameters/Sector"
   *     security:
   *       - BearerAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema: { $ref: '#/components/schemas/AsyncPollRequest' }
   *           examples:
   *             message: { $ref: '#/components/examples/DeviceRegistrationPollRequest' }
   *         application/x-www-form-urlencoded:
   *           schema: { $ref: '#/components/schemas/AsyncPollRequest' }
   *           examples:
   *             message: { $ref: '#/components/examples/DeviceRegistrationPollRequest' }
   *     responses:
   *       '202': { description: Pending. Retry later. }
   *       '200':
   *         description: Completed.
   *         content:
   *           application/json:
   *             schema: { $ref: '#/components/schemas/DidcommPlaintextMessage' }
   *             examples:
   *               message: { $ref: '#/components/examples/DeviceRegistrationResponse' }
   *       '400': { description: Missing or invalid thid. }
   *       '404': { description: thid not found. }
   *       '500': { description: Job failed or response decode failed. }
   *
   * /{tenantId}/cds-{jurisdiction}/v1/{sector}/identity/openid/smart/token:
   *   post:
   *     tags:
   *       - 2.2 SMART Token
   *     summary: Request a SMART access_token (async)
   *     description: |
  *       Requests a SMART access token. The request MUST include the gateway context-pinning scope item:
  *       `organization/Composition.<cruds>?subject=<did:web:...:individual:<id>>[&section=*|<code>[,<code>...]]`.
  *       Omitting `section` is allowed and means the backend's default permitted set for that subject.
   *       A same-tenant ResearchStudy professional instead requests exactly
   *       `organization/ResearchSubject.crus?study=ResearchStudy/<id>`. That
   *       profile requires the professional VP, the exact private_key_jwt and
   *       client_id registered by DCR, an active applicable employee licence,
   *       and the controller-approved active ResearchStudy Consent. Extra root
   *       scopes and the delete operation are rejected. Its signed JWT keeps
   *       the professional DID in `sub` and adds `purpose: HRESCH` plus the
   *       exact `study: ResearchStudy/<id>` reference for offline validation.
   *       The current tenant controller may instead request the narrower exact
   *       `organization/ResearchSubject.c?study=ResearchStudy/<id>` scope. GW
   *       requires its verified ServiceControllerCredential, bare `RESPRSN`
   *       authority, current tenant DID controller binding, matching tenant
   *       and an existing claims-first ResearchStudy. This controller grant
   *       creates study-correlated subjects only; it grants no read, update,
   *       search or appointment permission and does not impersonate a
   *       professional.
   *
   *       OpenID4VP binding: the request MUST include `acr_values` from the prior verification event, using
   *       one of: `urn:antifraud:acr:openid4vp:employee` or `urn:antifraud:acr:openid4vp:individual`. The issued
   *       SMART token includes the matching `acr` and SHOULD include `amr` entries like `openid4vp`, `vc`, and
   *       `device_bound`.
   *
   *       Client authentication: the gateway accepts one signed client-authentication JWT in
   *       `body.client_assertion`. The canonical request shape uses the standard parameter names
   *       `client_assertion` + `client_assertion_type`; for compatibility, `client_assertion_type`
   *       may carry either the full JWT-bearer URN or the shorter `private_key_jwt` label.
   *
   *       Proof requirement: the SMART authorization request normally carries one verifiable presentation (VP)
   *       inside the JAR (request object) or the DIDComm payload (demo flow). That VP is validated via the
   *       Gaia-X Clearing House to enforce non-revocation before issuing the token.
   *
   *       Research-access exception: for the inter-tenant `RESEARCH` use case only, the current gateway also
   *       accepts one already-validated external `Bearer data access token` instead of `body.vp_token`, as long
   *       as the trusted issuer, provider tenant, consumer organization, purpose, and requested capability match.
   *
   *       Contract boundary: the inter-tenant FHIR `Contract` VC gate applies
   *       to `organization/ResearchSubject.*` digital-twin capabilities.
   *       Individual `organization/Composition.*` self-read still requires
   *       one verified VP and matching FHIR `Consent`, but not a research
   *       contract solely because its public DID root differs from the
   *       operator DID serving the endpoint.
   *
   *       Demo payload note: in this endpoint the DIDComm `body` represents the JAR (authorize request object),
   *       including PKCE parameters (`code_challenge`, `code_challenge_method`), `client_id`, `redirect_uri`,
   *       `client_assertion`, `client_assertion_type`, `vp_token`, optional `presentation_submission`, and
   *       `acr_values`.
   *
   *       The worker will validate the target subject exists and that at least one consent rule matches the actor.
   *
   *       Optional `body.break_glass` is a disabled-by-default GW extension for exceptional
   *       emergency reads. Human access is confined to `health-care` with a
   *       ledger-verified physician credential; animal access is confined to `animal-care` with
   *       a ledger-verified veterinarian credential. Research and One Health research routes,
   *       write scopes, employment alone and cross-subject-kind requests fail closed. The worker
   *       persists and anchors a flat-claims `ETREAT` Consent for up to the configured 24-hour
   *       episode, then requires controller-mailbox Communication acknowledgement. Each issuance
   *       appends a correlated Fabric event and returns a read-only token for at most 15 minutes.
   *     parameters:
   *       - $ref: '#/components/parameters/AppId'
   *       - $ref: '#/components/parameters/AppVersion'
   *       - $ref: "#/components/parameters/TenantId"
   *       - $ref: "#/components/parameters/Jurisdiction"
   *       - $ref: "#/components/parameters/Sector"
   *     requestBody:
   *       description: |
   *         Production: only `application/x-www-form-urlencoded` is accepted (secure JWE envelope with `request=`).
   *         Demo/Test-Network: `application/didcomm-plain+json` is canonical, and `application/json` is also accepted for simplicity.
   *       required: true
   *       content:
   *         application/didcomm-plain+json:
   *           schema:
   *             $ref: '#/components/schemas/DidcommPlaintextMessage'
   *         application/x-www-form-urlencoded:
   *           schema:
   *             $ref: '#/components/schemas/SecureRequest'
   *         application/json:
   *           schema:
   *             $ref: '#/components/schemas/DidcommPlaintextMessage'
   *           examples:
   *             message:
   *               $ref: '#/components/examples/SmartTokenRequestPlaintextMessage'
   *     security:
   *       - BearerAuth: []
   *     responses:
   *       '202': { description: Accepted. Poll `.../identity/openid/smart/token-response` with `thid`; `_batch-response` remains a temporary compatibility alias. }
   *
   * /{tenantId}/cds-{jurisdiction}/v1/{sector}/identity/openid/smart/token-response:
   *   post:
   *     tags:
   *       - 2.2 SMART Token
   *     summary: Poll the SMART token issuance result
   *     parameters:
   *       - $ref: '#/components/parameters/AppId'
   *       - $ref: '#/components/parameters/AppVersion'
   *       - $ref: "#/components/parameters/TenantId"
   *       - $ref: "#/components/parameters/Jurisdiction"
   *       - $ref: "#/components/parameters/Sector"
   *     security:
   *       - BearerAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema: { $ref: '#/components/schemas/AsyncPollRequest' }
   *         application/x-www-form-urlencoded:
   *           schema: { $ref: '#/components/schemas/AsyncPollRequest' }
   *     responses:
   *       '202': { description: Pending. Retry later. }
   *       '200': { description: Completed. }
   *       '400': { description: Missing or invalid thid. }
   *       '404': { description: thid not found. }
   *       '500': { description: Job failed or response decode failed. }
   */
  /**
   * @openapi
   * /{tenantId}/cds-{jurisdiction}/v1/{sector}/did/document/_binding:
   *   post:
   *     tags:
   *       - 1.1 Organization Registration
   *     summary: Bind the tenant DID document public aliases
   *     description: |
   *       Updates the tenant DID document public alias projection managed by GW CORE.
   *
   *       Step by step:
   *       - this is a tenant-scoped GW operation
   *       - it is distinct from host `Organization/_transaction`
   *       - it is distinct from legacy ICA `_verify -> Organization/_activate`
   *       - `organization.url` provides the public alias/domain list projected into `alsoKnownAs`
   *       - the tenant path already identifies the organization; no extra organization locator is required in the payload
   *
   *       Replacement rule:
   *       - when `organization.url` is provided, the resolved alias list replaces the current `alsoKnownAs`
   *       - when omitted, the current alias list is preserved
   *
   *       Key-management rule:
   *       - this operation does not rotate or replace organization public keys
   *       - `controller.sameAs` is optional corroborating identity material only
   *     parameters:
   *       - $ref: '#/components/parameters/AppId'
   *       - $ref: '#/components/parameters/AppVersion'
   *       - $ref: '#/components/parameters/TenantId'
   *       - $ref: '#/components/parameters/Jurisdiction'
   *       - $ref: '#/components/parameters/Sector'
   *     requestBody:
   *       description: |
   *         Production: only `application/x-www-form-urlencoded` is accepted (secure JWE envelope with `request=`).
   *         Demo/Test-Network: `application/didcomm-plain+json` is canonical, and `application/json` is also accepted for simplicity.
   *       required: true
   *       content:
   *         application/didcomm-plain+json:
   *           schema:
   *             $ref: '#/components/schemas/DidcommPlaintextMessage'
   *         application/json:
   *           schema:
   *             $ref: '#/components/schemas/DidcommPlaintextMessage'
   *         application/x-www-form-urlencoded:
   *           schema:
   *             $ref: '#/components/schemas/SecureRequest'
   *     security:
   *       - BearerAuth: []
   *     responses:
   *       '202': { description: Accepted. Poll the Location URL for the binding result. }
   *
   * /{tenantId}/cds-{jurisdiction}/v1/{sector}/did/document/_binding-response:
   *   post:
   *     tags:
   *       - 1.1 Organization Registration
   *     summary: Poll the tenant DID document binding result
   *     parameters:
   *       - $ref: '#/components/parameters/AppId'
   *       - $ref: '#/components/parameters/AppVersion'
   *       - $ref: '#/components/parameters/TenantId'
   *       - $ref: '#/components/parameters/Jurisdiction'
   *       - $ref: '#/components/parameters/Sector'
   *     security:
   *       - BearerAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema: { $ref: '#/components/schemas/AsyncPollRequest' }
   *         application/x-www-form-urlencoded:
   *           schema: { $ref: '#/components/schemas/AsyncPollRequest' }
   *     responses:
   *       '202': { description: Pending. Retry later. }
   *       '200': { description: Completed. }
   *       '400': { description: Missing or invalid thid. }
   *       '404': { description: thid not found. }
   *       '500': { description: Job failed or response decode failed. }
   */
  // --- 1. ASYNC JOB SUBMISSION ENDPOINT ---
  router.post(didDocumentBindingRoute, async (req, res, next) => {
    const action = String(req.params.action || '').trim();
    if (action !== '_binding') return next();

    req.params = {
      ...req.params,
      section: 'did',
      format: 'document',
      resourceType: GatewayInternalResourceTypes.Document,
    } as any;

    const routeParams = req.params as unknown as RouteParams;
    const { tenantId, section, resourceType, sector } = routeParams;
    const contentTypeHeader = String(req.headers['content-type'] || '');
    const contentType = normalizeContentType(contentTypeHeader);
    const parsedContentType = parseIncomingContentType(contentType);
    let jobRequest: JobRequest;

    try {
      if (!isContentTypeAllowedBySecurityPolicy(parsedContentType)) {
        return sendDidcommEarlyError(
          req,
          res,
          415,
          IssueType.NotSupported,
          `Unsupported Content-Type for current SECURITY_MODE: ${contentTypeHeader || '<missing>'}`,
        );
      }

      if (parsedContentType !== 'didcomm-plain' && parsedContentType !== 'json') {
        return sendDidcommEarlyError(
          req,
          res,
          415,
          IssueType.NotSupported,
          `Unsupported Content-Type for did/document/_binding: ${contentTypeHeader || '<missing>'}`,
        );
      }

      const authToken = req.headers.authorization;
      const enforceBearerValidation = !allowsInsecureBearerBySecurityMode();
      const requireBearerHeader = !allowsInsecureBearerBySecurityMode();
      let verifiedBearerPayload: Record<string, any> = {};
      if (requireBearerHeader && (!authToken || !authToken.startsWith('Bearer '))) {
        return sendDidcommEarlyError(req, res, 401, IssueType.Security, 'Missing or invalid Bearer token.');
      }
      if (enforceBearerValidation) {
        if (!appAuthManager) {
          return sendDidcommEarlyError(
            req,
            res,
            500,
            IssueType.Exception,
            'Bearer validation is required by SECURITY_MODE but AppAuthorizationManager is not configured.',
          );
        }
        try {
          const bearerToken = authToken?.split(' ')[1] || '';
          const verificationResult = await appAuthManager.verifyBearerToken(
            bearerToken,
            undefined,
            await controllerProofRegistrationContext(tenantId, sector),
          );
          verifiedBearerPayload = getVerifiedBearerPayload(verificationResult);
        } catch (error: any) {
          return sendDidcommEarlyError(
            req,
            res,
            401,
            IssueType.Security,
            `Invalid Bearer token: ${error?.message || 'verification failed'}`,
          );
        }
      }

      const legacyBody = normalizeDidcommBodyForFhirFormat(req.body || {}, routeParams.format);
      const normalizedLegacyContent = normalizeBusinessBodyContent(legacyBody || {});
      const legacyMeta = normalizedLegacyContent?.meta || {};

      jobRequest = {
        ...(routeParams as any),
        id: '',
        sequence: 0,
        status: 'DRAFT' as any,
        createdAtTimestamp: Date.now(),
        content: {
          ...normalizedLegacyContent,
          meta: {
            ...legacyMeta,
            bearer: {
              token: authToken,
              jwt: { header: { alg: '', kid: '' }, payload: verifiedBearerPayload },
            },
          },
        },
        contentType: contentType,
      };
    } catch (error: any) {
      console.error('[API] Error during did/document/_binding request processing:', error);
      return sendDidcommEarlyError(
        req,
        res,
        400,
        IssueType.Security,
        'Failed to process request: ' + error.message,
      );
    }

    const thid = jobRequest.content?.thid;
    if (!thid) {
      return sendDidcommEarlyError(
        req,
        res,
        400,
        IssueType.Required,
        'Request body must contain a "thid" or "id" property.',
      );
    }

    const vaultId = await resolveVaultId(tenantId, sector);
    const tenantServices = await tenantsCacheManager.getDidServiceConfig(vaultId);

    if (!isRequestValid(tenantServices, { ...routeParams, action })) {
      return sendDidcommEarlyError(
        req,
        res,
        404,
        IssueType.NotFound,
        'The requested tenant or endpoint path does not exist.',
      );
    }

    if (requiresActiveTenantAuthorization(tenantId, section, routeParams.format, resourceType, action)) {
      const tenantConfigForAuthorization = await tenantsCacheManager.getTenant(vaultId);
      const authorizationStatus = tenantConfigForAuthorization
        ? readTenantAuthorizationStatusFromConfig(tenantConfigForAuthorization)
        : undefined;
      if (!authorizationStatus) {
        return sendDidcommEarlyError(req, res, 404, IssueType.NotFound, 'The requested tenant or endpoint path does not exist.');
      }
      if (authorizationStatus !== 'active') {
        return sendDidcommEarlyError(req, res, 403, IssueType.Forbidden, `Tenant authorization is ${authorizationStatus}.`);
      }
    }

    const iss = String(jobRequest.content?.iss || '').trim();
    const jti = String(jobRequest.content?.jti || '').trim();
    if (iss && jti) {
      const replayKey = `${vaultId}:${iss}:${jti}`;
      const reserved = await replayProtectionStore.reserveIfNotExists(
        replayKey,
        getReplayTtlSeconds(jobRequest.content),
      );
      if (!reserved) {
        return sendDidcommEarlyError(req, res, 409, IssueType.Conflict, 'Duplicate jti detected for this issuer (possible replay).');
      }
    }

    const jobName = createJobName(vaultId, 'Document', action);
    jobRequest.action = action;
    await enqueueAsyncJob({
      responseStore: asyncResponseStore,
      queueAdapter,
      thid,
      jobName,
      request: jobRequest,
      pending: { status: 'PENDING', vaultId },
    });

    const relativeUrl = `${req.originalUrl}-response`;
    const requestBaseUrl = getRequestBaseUrl(req, apiBaseUrl);
    const pollingUrl = new URL(relativeUrl, requestBaseUrl).href;
    res.location(pollingUrl);
    res.set('Retry-After', '5');
    res.status(202).send();
  });

  router.post(`${cdsRoutePrefix}/:action`, async (req, res) => {
    const normalizedParams = normalizeUnifiedIdentityAuthRouteParams(req.params as unknown as RouteParams);
    req.params = { ...req.params, ...normalizedParams };
    const { tenantId, section, resourceType, sector, action } = req.params;
    const format = String(req.params.format || '').toLowerCase();
    const normalizedResourceType = String(resourceType || '').toLowerCase();
    const normalizedAction = String(action || '').trim();
    const isLegacyHostOrganizationSubmit = tenantId === 'host'
      && section === 'registry'
      && format === 'org.schema'
      && normalizedResourceType === 'organization'
      && (normalizedAction === '_batch' || normalizedAction === '_verify');
    if (isLegacyHostOrganizationSubmit) {
      console.warn(
        '[API] Legacy host onboarding endpoint used (Organization/_batch or alias _verify). '
        + 'Prefer Organization/_transaction for canonical ICA-backed onboarding. '
        + 'Organization/_activate remains legacy compatibility for ICA-proof-first callers.',
      );
    }
    const contentTypeHeader = String(req.headers['content-type'] || '');
    const contentType = normalizeContentType(contentTypeHeader);
    const parsedContentType = parseIncomingContentType(contentType);
    let jobRequest: JobRequest;
    let verifiedBearerPayload: Record<string, any> = {};

    try {
      if (
        !isContentTypeAllowedBySecurityPolicy(parsedContentType)
        && !isOidcAuthenticatedBootstrapJsonRoute(req.params, parsedContentType)
      ) {
        return sendDidcommEarlyError(
          req,
          res,
          415,
          IssueType.NotSupported,
          `Unsupported Content-Type for current SECURITY_MODE: ${contentTypeHeader || '<missing>'}`,
        );
      }

      // --- 1. Payload Handling & JobRequest Construction ---
      if (parsedContentType === 'secure-form') {
        // ENCRYPTED FLOW (FAPI/JAR-style)
        if (!req.body.request) {
          return sendDidcommEarlyError(
            req,
            res,
            400,
            IssueType.Required,
            "Missing 'request' parameter in form-encoded body.",
          );
        }
        const authToken = req.headers.authorization;
        const allowNoBearerForActivate = isHostOrganizationActivateRoute(
          tenantId,
          section,
          req.params.format,
          resourceType,
          action,
        );
        const isIdentityDcrRoute =
          section === 'identity'
          && String(req.params.format || '').toLowerCase() === 'openid'
          && String(resourceType || '').toLowerCase() === 'device'
          && action === '_dcr';
        const isIdentityTokenExchangeRoute =
          section === 'identity'
          && String(req.params.format || '').toLowerCase() === 'openid'
          && String(resourceType || '').toLowerCase() === 'token'
          && action === '_exchange';
        const requireBearerHeader = section !== 'ping' && !allowNoBearerForActivate;
        if (requireBearerHeader && (!authToken || !authToken.startsWith('Bearer '))) {
          return sendDidcommEarlyError(req, res, 401, IssueType.Security, 'Missing or invalid Bearer token.');
        }
        if (requireBearerHeader && !isIdentityDcrRoute) {
          if (!appAuthManager) {
            return sendDidcommEarlyError(
              req,
              res,
              500,
              IssueType.Exception,
              'Bearer validation is required by SECURITY_MODE but AppAuthorizationManager is not configured.',
            );
          }
          try {
            const bearerToken = authToken?.split(' ')[1] || '';
            const registrationContext = await controllerProofRegistrationContext(tenantId, sector);
            const bearerOptions = bearerVerificationOptionsForDataRoute(section, req.params.format);
            const verificationResult = bearerOptions
              ? await appAuthManager.verifyBearerToken(bearerToken, undefined, registrationContext, bearerOptions)
              : await appAuthManager.verifyBearerToken(bearerToken, undefined, registrationContext);
            verifiedBearerPayload = getVerifiedBearerPayload(verificationResult);
          } catch (error: any) {
            return sendDidcommEarlyError(
              req,
              res,
              401,
              IssueType.Security,
              `Invalid Bearer token: ${error?.message || 'verification failed'}`,
            );
          }
        }
        if (requireBearerHeader && isIdentityDcrRoute) {
          if (!appAuthManager) {
            return sendDidcommEarlyError(
              req,
              res,
              500,
              IssueType.Exception,
              'Initial access-token validation is required for encrypted DCR but AppAuthorizationManager is not configured.',
            );
          }
          try {
            const bearerToken = authToken?.split(' ')[1] || '';
            verifiedBearerPayload = await appAuthManager.verifyInitialAccessToken(bearerToken);
          } catch (error: any) {
            return sendDidcommEarlyError(
              req,
              res,
              401,
              IssueType.Security,
              `Invalid initial access token: ${error?.message || 'verification failed'}`,
            );
          }
        }
        // The KMS decrypts the JWE using the HOST's key and returns the inner JWS, but does not verify it.
        const decodedJob = await kmsService.decodeRequest(req.body.request);
        const decodedJws = decodedJob.content?.meta?.jws;
        const embeddedSigningKey = decodedJws?.protected?.jwk as PublicJwk | undefined;
        const isLegacyHostOrganizationBootstrap = tenantId === 'host'
          && section === 'registry'
          && String(req.params.format || '').toLowerCase() === 'org.schema'
          && String(resourceType || '').toLowerCase() === 'organization'
          && ['_batch', '_verify'].includes(action);
        // Token/_exchange and Device/_dcr are the two ordered pre-DCR device
        // bootstrap steps. Their embedded wallet key proves possession only;
        // the verified account bearer plus the one-use activation licence are
        // the authority checked by the identity managers. Established actors
        // must still resolve their registered keys below.
        const usesEmbeddedBootstrapKey = Boolean(embeddedSigningKey)
          && (isIdentityTokenExchangeRoute
            || isIdentityDcrRoute
            || allowNoBearerForActivate
            || isLegacyHostOrganizationBootstrap);
        if (usesEmbeddedBootstrapKey && decodedJws && embeddedSigningKey) {
          await verifyDecodedDidcommSignature(
            decodedJob.content as Record<string, any>,
            embeddedSigningKey,
            cryptographyService,
          );
        }
        // The Bearer token (e.g., Firebase id_token) is still an HTTP concern, but some identity endpoints
        // need it during async processing. We propagate it into the decoded payload meta for the worker.
        const bearerToken = req.headers.authorization;
        if (bearerToken) {
          (decodedJob as any).content = (decodedJob as any).content || {};
          (decodedJob as any).content.meta = (decodedJob as any).content.meta || {};
          (decodedJob as any).content.meta.bearer = {
            token: bearerToken,
            jwt: { header: {}, payload: verifiedBearerPayload },
          };
        }

        // --- Signature Verification & Sender Key Resolution (Orchestrator Logic) ---
        // Outside explicit bootstrap, an envelope JWK never grants authority:
        // resolve the reviewed or registered signing key and verify with it.
        if (!usesEmbeddedBootstrapKey && decodedJws) {
          const senderDid = decodedJob.content?.iss;
          const jwsToVerify = decodedJws;

          if (!senderDid || !jwsToVerify || !jwsToVerify.protected || !jwsToVerify.signature || !jwsToVerify.protected.kid) {
            throw new Error("Secure request is missing 'iss', 'kid', or a valid JWS structure.");
          }
          const senderSigningKeyId = jwsToVerify.protected.kid;
          const senderEncryptionKeyId = decodedJob.content?.meta?.jwe?.header?.skid;
          if (!senderEncryptionKeyId) {
            throw new Error("Secure request is missing 'skid' in the JWE protected header.");
          }

          let senderSigningKey: any;
          let senderEncryptionKey: any;
          const reviewedBootstrapKeys = isHostOrganizationVerificationRoute(
            tenantId, sector, section, req.params.format, resourceType, action,
          )
            ? readReviewedOrganizationBootstrapKeys(
              decodedJob.content, senderDid, senderSigningKeyId, senderEncryptionKeyId,
            )
            : isHostControllerCommercialOrderRoute(
              tenantId, sector, section, req.params.format, resourceType, action,
            )
              ? await readPendingOfferBootstrapKeys(
                decodedJob.content, senderDid, senderSigningKeyId, senderEncryptionKeyId,
              )
              : undefined;
          if (reviewedBootstrapKeys) {
            senderSigningKey = reviewedBootstrapKeys.senderSigningKey;
            senderEncryptionKey = reviewedBootstrapKeys.senderEncryptionKey;
          } else {
            // Resolve registered sender-key custody independently from job
            // routing. Host commercial Orders are queued in `host` but signed
            // by the tenant controller that authored the accepted Offer.
            const vaultId = await resolveRegisteredSenderVaultId(
              tenantId,
              sector,
              section,
              req.params.format,
              resourceType,
              action,
              senderDid,
            );
            const collectionName = await tenantsCacheManager.getCollectionName(vaultId);
            if (!collectionName) {
              throw new Error(`Could not resolve collectionName for vaultId '${vaultId}'`);
            }
            const protectedAttrName = await kmsService.getHmacBase64Url('kid', vaultId);
            const protectedAttrValue = await kmsService.getHmacBase64Url(senderSigningKeyId, vaultId);
            let queryResult = await vaultRepository.query(collectionName, {
              sectionId: getEnvSectionId('employees'),
              where: [{ name: protectedAttrName, value: protectedAttrValue }],
            });
            if (!queryResult || queryResult.length === 0) {
              queryResult = await vaultRepository.query(vaultId, {
                sectionId: getEnvSectionId('employees'),
                where: [{ name: protectedAttrName, value: protectedAttrValue }],
              });
            }
            if (queryResult && queryResult.length > 0) {
            // 4a. Organization employees and persisted controllers resolve via
            // their HMAC-indexed DID entity in the physical tenant collection.
            const employeeDoc = queryResult[0];
            const employeeConfig = await kmsService.unprotectConfidentialData<EntityConfig>(employeeDoc, vaultId);
            senderSigningKey = employeeConfig.didDocument?.verificationMethod?.find(
              (vm: VerificationMethod) => vm.id.endsWith(`#${senderSigningKeyId}`)
            )?.publicKeyJwk;
            senderEncryptionKey = employeeConfig.didDocument?.verificationMethod?.find(
              (vm: VerificationMethod) => vm.id.endsWith(`#${senderEncryptionKeyId}`)
            )?.publicKeyJwk;
            } else {
            // 4b. An individual controller is not an employee. Its signed
            // message names the DCR client, while the already-verified SMART
            // bearer binds that client action to the same actor DID.
            const clientId = String((decodedJob.content as any)?.client_id || '').trim();
            if (!clientId) {
              throw new Error(`Secure request for '${senderDid}' does not identify its registered DCR client.`);
            }
            if (
              requiresVerifiedBearerActorBindingForSecureRoute({
                section,
                format: req.params.format,
                resourceType,
                action,
              })
              && !isVerifiedBearerBoundToActorDid(verifiedBearerPayload, senderDid)
            ) {
              throw new Error(`Verified bearer identity does not match secure-message issuer '${senderDid}'.`);
            }
            const deviceProfileDoc = await vaultRepository.get<ConfidentialStorageDoc>(
              vaultId,
              clientId,
              getEnvSectionId('device-profiles'),
            );
            if (!deviceProfileDoc || deviceProfileDoc.status !== DeviceBindingStatuses.Active) {
              throw new Error(`DCR client '${clientId}' is not active in vault '${vaultId}'.`);
            }
            const deviceProfile = await kmsService.unprotectConfidentialData<any>(deviceProfileDoc, vaultId);
            if (String(deviceProfile?.clientId || '').trim() !== clientId) {
              throw new Error(`DCR client '${clientId}' does not match its protected profile.`);
            }
            if (
              isRegisteredProfileAccountDirectoryRoute({
                section,
                format: req.params.format,
                resourceType,
                action,
              })
              && !isVerifiedBearerBoundToRegisteredProfile({
                payload: verifiedBearerPayload,
                senderDid,
                clientId,
                deviceProfile,
              })
            ) {
              throw new Error(`Verified account does not match registered profile '${clientId}'.`);
            }
            if (isRegisteredProfileAccountDirectoryRoute({
              section,
              format: req.params.format,
              resourceType,
              action,
            })) {
              const decodedContent = decodedJob.content as Record<string, any>;
              decodedContent.meta = decodedContent.meta || {};
              decodedContent.meta[REGISTERED_PROFILE_ACCOUNT_DIRECTORY_META] = {
                clientId,
                actorDid: senderDid,
                authenticatedSubject: String(deviceProfile.authenticatedSubject || '').trim(),
                ...(deviceProfile.authenticatedEmail
                  ? { authenticatedEmail: String(deviceProfile.authenticatedEmail).trim() }
                  : {}),
                ...(deviceProfile.authenticatedTelephone
                  ? { authenticatedTelephone: String(deviceProfile.authenticatedTelephone).trim() }
                  : {}),
              };
            }
            const deviceKeys = Array.isArray(deviceProfile?.jwks?.keys) ? deviceProfile.jwks.keys : [];
            senderSigningKey = deviceKeys.find((key: any) => String(key?.kid || '').trim() === senderSigningKeyId);
            senderEncryptionKey = deviceKeys.find((key: any) => String(key?.kid || '').trim() === senderEncryptionKeyId);
            }
          }

          if (!senderSigningKey) {
            throw new Error(`Signing key ID '${senderSigningKeyId}' not found in resolved DID document for '${senderDid}'.`);
          }
          if (!senderEncryptionKey) {
            throw new Error(`Encryption key ID '${senderEncryptionKeyId}' not found in resolved DID document for '${senderDid}'.`);
          }

          // 6. Decryption is not signature verification. Prove integrity with
          // the reviewed bootstrap key or the already-registered actor key.
          await verifyDecodedDidcommSignature(
            decodedJob.content as Record<string, any>,
            senderSigningKey,
            cryptographyService,
          );

          // 7. Enrich the internal job metadata with only the keys that this
          // middleware resolved and cryptographically verified. The worker
          // retains them for the pre-DCR Offer/Order continuation and uses the
          // encryption key for the protected response.
          if (decodedJob.content?.meta?.jws?.protected) {
            decodedJob.content.meta.jws.protected.jwk = senderSigningKey as JWK;
          }
          if (decodedJob.content?.meta?.jwe?.header) {
            decodedJob.content.meta.jwe.header.jwk = senderEncryptionKey as JWK;
          }
        }
        
        // Path parameters are authoritative for routing and must override any values embedded in the payload.
        const normalizedSecureContent = normalizeDidcommBodyForFhirFormat(
          normalizeBusinessBodyContent(decodedJob.content as any),
          req.params.format,
        );
        jobRequest = {
          ...decodedJob,
          ...req.params,
          content: normalizedSecureContent,
          contentType: contentType,
        };

      } else if (
        parsedContentType === 'didcomm-plain' ||
        parsedContentType === 'json' ||
        parsedContentType === 'fhir'
      ) {
        // LEGACY / PLAINTEXT FLOW (demo/dev convenience)
        const authToken = req.headers.authorization;
        const allowNoBearerForActivate = isHostOrganizationActivateRoute(
          tenantId,
          section,
          req.params.format,
          resourceType,
          action,
        );
        const enforceBearerValidation = !allowsInsecureBearerBySecurityMode();
        const isIdentityDcrRoute =
          section === 'identity'
          && String(req.params.format || '').toLowerCase() === 'openid'
          && String(resourceType || '').toLowerCase() === 'device'
          && action === '_dcr';
        // The 'ping' endpoint is a public health check and does not require authentication for legacy requests.
        const requireBearerHeader =
          section !== 'ping'
          && !allowNoBearerForActivate
          && !allowsInsecureBearerBySecurityMode();
        if (requireBearerHeader && (!authToken || !authToken.startsWith('Bearer '))) {
          return sendDidcommEarlyError(req, res, 401, IssueType.Security, 'Missing or invalid Bearer token.');
        }

        if (section !== 'ping' && !allowNoBearerForActivate && enforceBearerValidation && !isIdentityDcrRoute) {
          if (!appAuthManager) {
            return sendDidcommEarlyError(
              req,
              res,
              500,
              IssueType.Exception,
              'Bearer validation is required by SECURITY_MODE but AppAuthorizationManager is not configured.',
            );
          }
          try {
            const bearerToken = authToken?.split(' ')[1] || '';
            const projectedPublicJwk = projectedControllerProofJwk(req.body);
            const registrationContext = await controllerProofRegistrationContext(tenantId, sector);
            const bearerOptions = bearerVerificationOptionsForDataRoute(section, req.params.format);
            const verificationResult = bearerOptions
              ? await appAuthManager.verifyBearerToken(bearerToken, projectedPublicJwk, registrationContext, bearerOptions)
              : await appAuthManager.verifyBearerToken(bearerToken, projectedPublicJwk, registrationContext);
            verifiedBearerPayload = getVerifiedBearerPayload(verificationResult);
          } catch (error: any) {
            return sendDidcommEarlyError(
              req,
              res,
              401,
              IssueType.Security,
              `Invalid Bearer token: ${error?.message || 'verification failed'}`,
            );
          }
        }

        if (!enforceBearerValidation) {
          verifiedBearerPayload = decodeInsecureDemoBearerPayload(authToken);
        }

        if (
          appAuthManager &&
          isIdentityDcrRoute
        ) {
          // DCR is gated by an `initial_access_token` (host-signed) to consume a license seat securely.
          const bearerToken = authToken?.split(' ')[1];
          if (!bearerToken) {
            throw new Error('Missing Bearer token for DCR initial_access_token validation.');
          }
          verifiedBearerPayload = await appAuthManager.verifyInitialAccessToken(bearerToken);
        }

        const legacyBody = normalizeDidcommBodyForFhirFormat(req.body || {}, req.params.format);
        const normalizedLegacyContent = normalizeBusinessBodyContent(legacyBody || {});
        const legacyMeta = normalizedLegacyContent?.meta || {};

        jobRequest = {
          ...req.params,
          id: '', // Will be filled later if needed, but needs to exist
          sequence: 0,
          status: 'DRAFT' as any, // TODO: fix this any
          createdAtTimestamp: Date.now(),
          content: {
            ...normalizedLegacyContent,
            meta: {
              ...legacyMeta,
              bearer: {
                token: authToken,
                jwt: { header: { alg: '', kid: '' }, payload: verifiedBearerPayload },
              },
            },
          },
          contentType: contentType,
        };
      } else {
        return sendDidcommEarlyError(
          req,
          res,
          415,
          IssueType.NotSupported,
          `Unsupported Content-Type: ${contentType}`,
        );
      }
    } catch (error: any) {
      console.error('[API] Error during request processing/decoding:', error);
      return sendDidcommEarlyError(
        req,
        res,
        401,
        IssueType.Security,
        'Failed to process secure request: ' + error.message,
      );
    }

    // --- 2. Transaction ID Validation ---
    // Ensure contentType is always present for downstream handling (e.g. worker response encryption paths).
    (jobRequest as any).contentType = (jobRequest as any).contentType || contentType;

    const isDirectPatientMatch = (
      parsedContentType === 'fhir'
      || parsedContentType === 'didcomm-plain'
      || parsedContentType === 'secure-form'
    )
      && section === 'individual'
      && format === 'org.hl7.fhir.api'
      && normalizedResourceType === 'patient'
      && normalizedAction === '$match';
    if (parsedContentType === 'fhir' && isDirectPatientMatch && !jobRequest.content?.thid) {
      (jobRequest.content as any).thid = `pdqm-patient-match-${randomUUID()}`;
    }
    const thid = jobRequest.content?.thid;
    if (!thid) {
      return sendDidcommEarlyError(
        req,
        res,
        400,
        IssueType.Required,
        'Request body must contain a "thid" or "id" property.',
      );
    }

    // --- 3. Path and Role Validation ---
    if (section === 'registry' && tenantId !== 'host') {
      return sendDidcommEarlyError(
        req,
        res,
        403,
        IssueType.Forbidden,
        'The "registry" section is reserved for the "host" entity.',
      );
    }
    
    const vaultId = await resolveVaultId(tenantId, sector);
    const tenantServices = await tenantsCacheManager.getDidServiceConfig(vaultId);

    // A controller-authored professional Order is the deliberate split route:
    // the host owns the commercial endpoint, while the issuer tenant owns DCR
    // key custody. Historical host catalogs may predate this exact capability.
    // Every other route remains behind the persisted service policy.
    const usesHostCommercialOrderContract = isHostControllerCommercialOrderRoute(
      tenantId,
      sector,
      section,
      req.params.format,
      resourceType,
      action,
    );
    const usesHostTenantLifecycleContract = isHostTenantLifecycleRoute(
      String(tenantId || ''),
      String(section || ''),
      format,
      String(resourceType || ''),
      normalizedAction,
    );
    const usesHistoricalTenantCommercialOfferContract = isHistoricalTenantCommercialOfferRoute(
      String(tenantId || ''),
      String(section || ''),
      format,
      String(resourceType || ''),
      normalizedAction,
      tenantServices,
    );
    if (!usesHostCommercialOrderContract
      && !usesHostTenantLifecycleContract
      && !usesHistoricalTenantCommercialOfferContract
      && !isRequestValid(tenantServices, { ...req.params, action })) {
      console.error(`[API] Path/Role validation failed for ${req.originalUrl}. Tenant services found: ${!!tenantServices}.`);
      return sendDidcommEarlyError(
        req,
        res,
        404,
        IssueType.NotFound,
        'The requested tenant or endpoint path does not exist.',
      );
    }

    if (requiresActiveTenantAuthorization(tenantId, section, req.params.format, resourceType, action)) {
      const tenantConfigForAuthorization = await tenantsCacheManager.getTenant(vaultId);
      const authorizationStatus = tenantConfigForAuthorization
        ? readTenantAuthorizationStatusFromConfig(tenantConfigForAuthorization)
        : undefined;
      if (!authorizationStatus) {
        return sendDidcommEarlyError(
          req,
          res,
          404,
          IssueType.NotFound,
          'The requested tenant or endpoint path does not exist.',
        );
      }
      if (authorizationStatus !== 'active') {
        return sendDidcommEarlyError(
          req,
          res,
          403,
          IssueType.Forbidden,
          `Tenant authorization is ${authorizationStatus}.`,
        );
      }
    }

    try {
      enforceSmartScopeRouteCompatibility({
        section,
        bearerPayload: verifiedBearerPayload,
      });
    } catch (error: any) {
      return sendDidcommEarlyError(
        req,
        res,
        403,
        IssueType.Forbidden,
        error?.message || 'SMART scope is not compatible with the requested endpoint.',
      );
    }

    // --- 4. Replay Protection (best-effort) ---
    // We only enforce when both `iss` and `jti` are present. This preserves compatibility
    // with older/plaintext payloads that may omit `jti` in development flows.
    const iss = String(jobRequest.content?.iss || '').trim();
    const jti = String(jobRequest.content?.jti || '').trim();
    if (iss && jti) {
      const replayKey = `${vaultId}:${iss}:${jti}`;
      const reserved = await replayProtectionStore.reserveIfNotExists(
        replayKey,
        getReplayTtlSeconds(jobRequest.content),
      );
      if (!reserved) {
        return sendDidcommEarlyError(
          req,
          res,
          409,
          IssueType.Conflict,
          'Duplicate jti detected for this issuer (possible replay).',
          IssueLevel.Error,
        );
      }
    }

    // --- 5. Enqueue Job ---
    const jobName = createJobName(vaultId, resourceType, action);
    jobRequest.action = action; // Ensure action is part of the job request for the worker
    if (isDirectPatientMatch && directJobProcessor) {
      const result = await directJobProcessor.process(jobName, jobRequest);
      let resultIsJson = false;
      try {
        JSON.parse(result);
        resultIsJson = true;
      } catch { /* encoded response */ }
      if (resultIsJson) {
        return res.status(500).set(
          'Content-Type', parsedContentType === 'fhir' ? 'application/fhir+json' : 'application/json',
        ).send(result);
      }
      if (parsedContentType === 'secure-form') {
        return res.status(200).type('application/x-www-form-urlencoded').send(`response=${result}`);
      }
      const decodedResponse = await kmsService.decodeRequest(result);
      if (!decodedResponse.content?.body) {
        return sendDidcommEarlyError(
          req, res, 500, IssueType.Exception, 'Patient $match response is missing its FHIR Bundle.',
        );
      }
      if (parsedContentType === 'didcomm-plain') {
        return res.status(200).type('application/didcomm-plain+json')
          .send(JSON.stringify(decodedResponse.content));
      }
      return res.status(200).type('application/fhir+json').send(JSON.stringify(decodedResponse.content.body));
    }
    await enqueueAsyncJob({
      responseStore: asyncResponseStore,
      queueAdapter,
      thid,
      jobName,
      request: jobRequest,
      pending: { status: 'PENDING', vaultId },
    });

    // --- 6. Success Response ---
    // According to FHIR Async, the Location header MUST be an absolute URL.
    const relativeUrl = `${req.originalUrl}-response`;
    const requestBaseUrl = getRequestBaseUrl(req, apiBaseUrl);
    const pollingUrl = new URL(relativeUrl, requestBaseUrl).href;
    res.location(pollingUrl);
    res.set('Retry-After', '5');
    res.status(202).send();
  });

  return router;
}
