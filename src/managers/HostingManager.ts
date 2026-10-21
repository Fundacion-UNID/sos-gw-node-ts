// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.
// File: src/managers/HostingManager.ts
// Always create JSDoc, do not use strings inline in keys nor values, use types instead, and reuse the data test examples.
import { ResourceTypesFhirR4 } from 'gdc-common-utils-ts/constants/fhir-resource-types';
import { HttpStatusCodes } from 'gdc-common-utils-ts/constants/http';

import { v4 as uuidv4, validate as uuidValidate } from 'uuid';
import { IServerConfig } from '../config';
import { IKmsService } from '../gdc-backend-utils-node/models/IKmsService';
import { IVaultRepository } from '../database/repositories/vault/vault.repository';
import { IStorageAdapter } from '../database/storage/IStorageAdapter';
import { BundleJsonApi, BundleEntry, ErrorEntry } from 'gdc-common-utils-ts/models/bundle';
import { ConfidentialStorageDoc } from 'gdc-common-utils-ts/models/confidential-storage';
import { DidDocument, DidService } from 'gdc-common-utils-ts/models/did';
import { OrganizationConfig } from '../gdc-backend-utils-node/models/entity';
import { ManagerError } from 'gdc-common-utils-ts/utils/manager-error';
import { IssueLevel, IssueType } from 'gdc-common-utils-ts/models/issue';
import { IncludedResource } from 'gdc-common-utils-ts/models/jsonapi';
import { JobRequest } from 'gdc-common-utils-ts/models/confidential-job';
import { DidCommDecodedMetadata, IDecodedDidcommPayload } from 'gdc-common-utils-ts/models/confidential-message';
import { ClaimsRecord } from 'gdc-common-utils-ts/models/resource-document';
import { ClaimsIndividualProductSchemaorg, ClaimsOfferSchemaorg, ClaimsOrderSchemaorg, ClaimsOrganizationSchemaorg, ClaimsPersonSchemaorg, ClaimsServiceSchemaorg } from 'gdc-common-utils-ts/constants/schemaorg';
import { Sector } from 'gdc-common-utils-ts/models/urlPath';
import type { PostalActivationCodeBinding } from 'gdc-common-utils-ts/utils/organization-test-network-credential';
import { getBundleResponseTypeForAction } from '../utils/bundle';
import { getClaimValue, normalizeContextualizedClaims } from '../utils/claims';
import { validateNewOrganizationClaims } from '../utils/claims-validator';
import { applyLegacyX509Metadata, composeHostDidWebId, createHostedDidWeb, getBaseUrlFromDidWeb, populateDidDocumentFromJwks } from '../utils/did-backend';
import { populateDidDocumentServices } from '../utils/did-document';
import { createOperationOutcome } from '../utils/outcome';
import { determineResourceId } from '../utils/resource';
import { initializeHostServicesConfig, initializeTenantServicesConfig } from '../utils/services';
import { generateTenantCollectionNameFromClaims, getTenantVaultId, isValidTenantAlternateName } from '../utils/tenant';
import { AllowedIndexableClaims } from '../gdc-backend-utils-node/models/indexing';
import { createEmployeeUrn, createOrganizationUrn, parseTenantUrn } from '../utils/urn';
import { ILogger } from '../loggers/ILogger';
import type { IHostingTenantRegistry } from './IHostingTenantRegistry';
import type { IHostRuntime } from './IHostRuntime';
import { generateLicenseOffer } from '../utils/offer';
import { VerifiableCredentialV2 } from 'gdc-common-utils-ts/models/verifiable-credential';
import { EntityLifecycleStatus, EntityType, NetworkAccessStatus, NetworkName, BundleEntryType } from '../gdc-backend-utils-node/models/enums';
import { EntityConfig } from '../gdc-backend-utils-node/models/entity';
import { ParameterData } from 'gdc-common-utils-ts/models/params';
import { normalizeCodeSystemAndValue } from '../utils/normalize-codeAndSystem';
import { VerificationMethod } from 'gdc-common-utils-ts/models/did';
import { PublicJwk } from 'gdc-common-utils-ts/interfaces/Cryptography.types';
import { DeviceLicense } from 'gdc-common-utils-ts/models/device-license';
import { issueActivationCodeFromPool, reserveTechnicalControllerSeat } from '../utils/license-issuance';
import {
  LICENSE_STATUS_ACTIVE,
  LICENSE_STATUS_AVAILABLE,
  LICENSE_STATUS_ISSUED,
  LICENSE_TYPE_MOBILE,
  LICENSE_USER_CLASS_EMPLOYEE,
} from '../constants/domain';
import { shouldUseFabricLedger } from '../adapters/credential-ledger-resolver';
import { buildStableActorIdentifier } from 'gdc-common-utils-ts/utils/actor-identifier';
import { resolveLedgerOrganizationId } from '../utils/ledger-organization-registration-helpers';
import {
  buildIssuedRoleLicenseLedgerIdentity,
  ensureIssuedRoleLicenseOnLedger,
} from '../utils/ledger-role-license';
import { registerControllerKeysOnLedger } from '../utils/ledger-device-registration';
import { buildPaymentCommunication, readOfferPaymentContext } from '../utils/order-communication';
import { buildGatewayInvoiceBundle } from '../utils/invoice-bundle';
import { verifyOrderPaymentConfirmation } from '../utils/payment-confirmation';
import { buildPdfSignatureEvidence, PdfSignatureEvidence } from '../utils/pdf-evidence';
import { getPersonOccupationClaim } from '../utils/occupation';
import { slugFromDomain } from '../utils/slug';
import { getEnvSectionId } from '../utils/section-env';
import { normalizeIndexedEmail, splitIndexedEmails, splitIndexedPhones } from '../utils/indexed-contact';
import {
  buildOfferOrderIndexedAttributes,
  readProjectedOfferOrderClaims,
} from '../utils/offer-order-read-model';
import { HostingOfferOrderService } from './hosting/HostingOfferOrderService';
import { HostingLifecycleService } from './hosting/HostingLifecycleService';
import { canonicalizeBundleEntryMetadata } from '../utils/canonical-entry-metadata';
import { processHostOrderEntry } from './hosting/process-order-entry';
import { createPendingTenantRegistration } from './hosting/create-pending-tenant-registration';
import {
  buildOrganizationIssueResponseResource,
  buildOrganizationVerificationTransactionResponseResource,
  createOrganizationIssueClaims,
  processOrganizationIssue as processOrganizationIssueExternal,
  processOrganizationVerificationTransaction as processOrganizationVerificationTransactionExternal,
} from './hosting/process-organization-verification';
import { processOrganizationActivation as processOrganizationActivationExternal } from './hosting/process-organization-activation';
import { allowsLegacyRepresentativeBootstrap } from './hosting/legacy-representative-bootstrap-policy';
import { persistExistingTenantControllerBinding as persistExistingTenantControllerBindingExternal } from './hosting/persist-existing-tenant-controller-binding';
import { finalizeTenantConfig as finalizeTenantConfigExternal } from './hosting/finalize-tenant-config';
import { handleServiceAttachment } from './hosting/service-attachment';
import {
  extractContainedServiceResource,
  extractResourcesFromClaims,
  extractServiceEvidenceList,
} from './hosting/resource-extraction';
import {
  persistHostConfig as persistHostConfigExternal,
  persistTenantConfig as persistTenantConfigExternal,
} from './hosting/persist-host-config';
import {
  pollIcaResult as pollIcaResultExternal,
  requestIcaEnrollment as requestIcaEnrollmentExternal,
  storeIcaMessage as storeIcaMessageExternal,
} from './hosting/ica-enrollment';
import {
  extractCredentialResourcesFromIcaPayload as extractCredentialResourcesFromIcaPayloadExternal,
  forwardOrganizationVerificationTransactionToIca as forwardOrganizationVerificationTransactionToIcaExternal,
} from './hosting/ica-verification';
import {
  ActivationMaterial as ExternalActivationMaterial,
  ActivationParticipantMaterial as ExternalActivationParticipantMaterial,
  VpCredentialObject as ExternalVpCredentialObject,
  applyLegalOrganizationIdentityCompatibility as applyLegalOrganizationIdentityCompatibilityExternal,
  inferJurisdictionFromLegalIdentifier as inferJurisdictionFromLegalIdentifierExternal,
  extractDidFromCredential as extractDidFromCredentialExternal,
  decodeVpTokenPayload as decodeVpTokenPayloadExternal,
  decodeEmbeddedCredential as decodeEmbeddedCredentialExternal,
  credentialHasAnyType as credentialHasAnyTypeExternal,
  extractCredentialFromVpToken as extractCredentialFromVpTokenExternal,
  normalizeTenantPublicUrl as normalizeTenantPublicUrlExternal,
  normalizeTenantOperationalUrl as normalizeTenantOperationalUrlExternal,
  getOperationalServiceBaseUrl as getOperationalServiceBaseUrlExternal,
  buildTenantAlsoKnownAs as buildTenantAlsoKnownAsExternal,
  extractActivationMaterial as extractActivationMaterialExternal,
  extractActivationParticipantMaterial as extractActivationParticipantMaterialExternal,
  backfillOrganizationActivationRouteDefaults as backfillOrganizationActivationRouteDefaultsExternal,
  logActivationIdentityDiagnostics as logActivationIdentityDiagnosticsExternal,
} from './hosting/activation-helpers';
import {
  buildIcaSectorBaseUrl as buildIcaSectorBaseUrlExternal,
  buildIcaVerifyUrl as buildIcaVerifyUrlExternal,
  buildIcaDidCreateUrl as buildIcaDidCreateUrlExternal,
  extractJurisdictionFromIcaDidWeb as extractJurisdictionFromIcaDidWebExternal,
  extractJurisdictionFromIcaUrl as extractJurisdictionFromIcaUrlExternal,
  getIcaVerifyBaseUrl as getIcaVerifyBaseUrlExternal,
  pollIcaJsonResult as pollIcaJsonResultExternal,
  registerDidDocumentWithIca as registerDidDocumentWithIcaExternal,
  resolveAbsoluteUrl as resolveAbsoluteUrlExternal,
  resolveIcaJurisdiction as resolveIcaJurisdictionExternal,
} from './hosting/ica-did-registration';
import {
  extractRegistrationKeys as extractRegistrationKeysExternal,
  findJwkByUse as findJwkByUseExternal,
  isEncryptionJwk as isEncryptionJwkExternal,
  isSignatureJwk as isSignatureJwkExternal,
  mergeActivationJwks as mergeActivationJwksExternal,
  normalizeBindingAliasList as normalizeBindingAliasListExternal,
} from './hosting/registration-keys';
import {
  buildControllerEntityConfig as buildControllerEntityConfigExternal,
  storeControllerEntityConfig as storeControllerEntityConfigExternal,
} from './hosting/controller-entity-config';
import { processTenantDidDocumentBinding as processTenantDidDocumentBindingExternal } from './hosting/process-tenant-did-document-binding';
import { ensureAuthorityTenant as ensureAuthorityTenantExternal } from './hosting/ensure-authority-tenant';
import { reconcilePersistedHostRuntimeConfig as reconcilePersistedHostRuntimeConfigExternal } from './hosting/reconcile-host-runtime-config';
import {
  findStoredControllerRoleByEmail as findStoredControllerRoleByEmailExternal,
  resolveOrganizationIssueControllerIdentity as resolveOrganizationIssueControllerIdentityExternal,
} from './hosting/organization-issue-controller-identity';
import { processRegistrationEntry as processRegistrationEntryExternal } from './hosting/process-registration-entry';
import { processOfferOrderSearch as processOfferOrderSearchExternal } from './hosting/process-offer-order-search';
import {
  HOST_ACTIVATE_REQUIRED_INPUT_CLAIMS,
  HOST_ACTIVATE_REQUIRED_OUTPUT_CLAIMS,
  HOST_TRANSACTION_REQUIRED_INPUT_CLAIMS,
  HOST_TRANSACTION_REQUIRED_OUTPUT_CLAIMS,
} from './hosting/hosting-claim-contracts';
import { SERVICE_ADDITIONAL_TYPE_CLAIM } from '../utils/service-capability-claims';
import { ClearingHouseService, IClearingHouseService } from '../services/ClearingHouseService';
import { JwkSet } from 'gdc-common-utils-ts/models/jwk';
import {
  parseServiceCapabilityTokens,
} from 'gdc-common-utils-ts/constants/service-capabilities';
import {
  validateActivationServiceAuthorizationPolicy,
} from 'gdc-common-utils-ts/utils/activation-policy';
import {
  DefaultActivationTrustAdapter,
  IActivationTrustAdapter,
} from '../adapters/activation-trust.adapter';
import {
  applyTenantAuthorizationStatus,
  getTenantAuthorizationStatus,
  TenantAuthorizationLifecycleStatus,
} from '../utils/tenant-lifecycle';
import {
  ACTION_DISABLE,
  ACTION_ENABLE,
  ACTION_PURGE,
  ACTION_STATUS,
} from '../constants/domain';
import { toJwkThumbprintSha256Urn } from 'gdc-common-utils-ts/utils/jwk-thumbprint';
import type { ICryptography } from 'gdc-common-utils-ts/interfaces/ICryptography';
import { verifyOrganizationTestNetworkCredential } from './hosting/organization-test-network-credential';
import { registerOrganizationOnLedger } from '../utils/ledger-organization-registration';
import { OrganizationDidBindingEntryTypes } from 'gdc-common-utils-ts/utils/organization-did-binding';
import {
  DIDCOMM_DEFAULT_ACCEPT_HEADER,
  DIDCOMM_PLAINTEXT_JSON_MEDIA_TYPE,
} from 'gdc-common-utils-ts/utils/didcomm-submit';

// Transitional ICA transport contract:
// GW host routes use the newer `application/didcomm-plain+json`, but the
// current dataspace-ica-ts `_verify` endpoint still expects the legacy plain
// DIDComm media type on this internal forward hop.
const ICA_DIDCOMM_PLAIN_JSON_MEDIA_TYPE = 'application/didcomm-plain+json';

type ActivationParticipantMaterial = ExternalActivationParticipantMaterial;
type ActivationMaterial = ExternalActivationMaterial;
type VpCredentialObject = ExternalVpCredentialObject;
type LegalOrganizationVerificationTransactionResource = Readonly<{
  controller?: Record<string, unknown>;
  organization?: Record<string, unknown>;
  legalRepresentativePayload?: Record<string, unknown>;
  legalRepresentative?: Record<string, unknown>;
  verification?: Record<string, unknown>;
}>;

type LegalOrganizationVerificationTransactionEntry = Readonly<{
  type?: string;
  meta?: {
    claims?: ClaimsRecord;
  };
  resource?: LegalOrganizationVerificationTransactionResource;
}>;
type LegalOrganizationVerificationTransactionNextStep = Readonly<{
  action: 'Order/_batch';
  acceptedOffer: {
    identifier?: string;
    identifierClaim: typeof ClaimsOrderSchemaorg.acceptedOfferIdentifier;
  };
}>;
type LegalOrganizationVerificationTransactionResponseResource = Readonly<{
  icaResponse?: unknown;
  verificationResponse?: unknown;
  next?: LegalOrganizationVerificationTransactionNextStep;
}>;
type LegalOrganizationIssueResponseResource = Readonly<{
  icaResponse: unknown;
}>;
const ORGANIZATION_VERIFICATION_TRANSACTION_RESPONSE_TYPE = 'Organization-verification-transaction-response-v1.0';
const ORGANIZATION_VERIFICATION_TRANSACTION_REQUEST_TYPE = 'Organization-verification-transaction-request-v1.0';
const ORGANIZATION_VERIFICATION_TRANSACTION_NEXT_ACTION = 'Order/_batch';
const ORGANIZATION_ISSUE_RESPONSE_TYPE = 'Organization-issue-response-v1.0';
/**
 * Technical runtime marker copied outside encrypted employee content for the
 * host bootstrap controller created during tenant onboarding.
 *
 * Why this exists:
 * - the bootstrap controller is an implementation detail needed to initialize
 *   the hosted tenant
 * - tenant lifecycle scans must ignore this synthetic employee so it does not
 *   block later `disable` or `purge` operations
 *
 * The canonical business role remains inside protected claims and, when
 * searchable, in `indexed.attributes`. This marker is only a lightweight
 * operational projection for lifecycle inspection.
 */
const HOST_BOOTSTRAP_CONTROLLER_LIFECYCLE_ROLE = 'host-bootstrap-controller';
const JWK_THUMBPRINT_SHA256_URN_PREFIX = 'urn:ietf:params:oauth:jwk-thumbprint:sha-256:';

/**
 * Manages the initial onboarding of new tenants onto the Gateway.
 *
 * @architecture
 * This manager's responsibility is strictly limited to the **Phase 1 Onboarding** process, which grants
 * a new tenant an active account on the Gateway and automatically enables them for the `test` network.
 *
 * It follows a two-step Offer/Order pattern:
 * 1.  `processOrganizationRegistration`: Creates a provisional (`pending`) tenant record and returns an `Offer`.
 * 2.  `processOrder`: Finalizes the registration upon `Order` confirmation, activates the tenant for the `test`
 *     network, and creates a provisional, host-signed `legal-participant.vc.json` to facilitate frontend development and testing.
 *
 * The subsequent, more complex process of onboarding to the `production` network is handled by a separate
 * set of managers (e.g., `NetworkEnrollmentManager`) and is initiated by a separate user action.
 */
export class HostingManager {
  private vaultRepository: IVaultRepository;
  private kmsService: IKmsService;
  private tenantsCacheManager: IHostingTenantRegistry;
  private storageAdapter: IStorageAdapter;
  private logger: ILogger;
  private config: IServerConfig;
  private hostRuntime: IHostRuntime;
  private clearingHouseService: IClearingHouseService;
  private activationTrustAdapter: IActivationTrustAdapter;
  private offerOrderService: HostingOfferOrderService;
  private lifecycleService: HostingLifecycleService;
  private cryptographyService?: ICryptography;

  constructor(
    vaultRepository: IVaultRepository,
    kmsService: IKmsService,
    tenantsCacheManager: IHostingTenantRegistry,
    storageAdapter: IStorageAdapter,
    logger: ILogger,
    config: IServerConfig,
    hostRuntime?: IHostRuntime,
    clearingHouseService?: IClearingHouseService,
    activationTrustAdapter?: IActivationTrustAdapter,
    cryptographyService?: ICryptography,
  ) {
    this.vaultRepository = vaultRepository;
    this.kmsService = kmsService;
    this.tenantsCacheManager = tenantsCacheManager;
    this.storageAdapter = storageAdapter;
    this.logger = logger;
    this.config = config;
    this.hostRuntime = hostRuntime || {
      hostCollectionName: 'host',
      hostDid: composeHostDidWebId(config.apiBaseUrl, config.hostExternalDomain),
    };
    this.clearingHouseService = clearingHouseService || new ClearingHouseService();
    this.activationTrustAdapter = activationTrustAdapter || new DefaultActivationTrustAdapter(this.clearingHouseService);
    this.cryptographyService = cryptographyService;
    this.offerOrderService = new HostingOfferOrderService(
      this.vaultRepository,
      this.kmsService,
      this.tenantsCacheManager,
      this.config,
      this.hostRuntime,
    );
    this.lifecycleService = new HostingLifecycleService(
      this.vaultRepository,
      this.kmsService,
      this.tenantsCacheManager,
      this.config,
      this.hostRuntime,
      this.storageAdapter,
      (error, type, meta) => this.handleError(error, type, meta),
    );
  }

  public async bootstrapHost(hostClaims: ClaimsRecord): Promise<void> {
    const { organization, person, service } = this.extractResources(hostClaims);
    const processedService = await this._handleServiceAttachment(service);
    const allClaims = { ...hostClaims, ...(processedService?.meta.claims || {}) };
    await this.persistHostConfig(organization, allClaims, [person, processedService!]);
  }

  /**
   * Reconciles the persisted host runtime registration with the current code-defined
   * service surface.
   *
   * Why this exists:
   * - the host tenant record is persisted once and then reused across restarts
   * - newly added host runtime endpoints (for example `Organization/_transaction`)
   *   will not become routable if the stored `didConfig.service` remains stale
   * - startup must therefore refresh the host runtime projection without
   *   re-running the full bootstrap or mutating business identity claims
   *
   * What this updates:
   * - `didConfig.service`
   * - `didDocument.service`
   * - legacy x509 metadata derived from runtime config
   * - `meta.lastUpdated`
   *
   * What this preserves:
   * - host claims and identity
   * - host keys / verification methods
   * - well-known VCs and other persisted host artifacts
   *
   * @returns `true` when the stored host runtime projection was rewritten,
   *          otherwise `false`.
   */
  public async reconcilePersistedHostRuntimeConfig(): Promise<boolean> {
    return reconcilePersistedHostRuntimeConfigExternal({
      config: this.config,
      hostRuntime: this.hostRuntime,
      vaultRepository: this.vaultRepository,
      kmsService: this.kmsService,
      tenantsCacheManager: this.tenantsCacheManager,
    });
  }

  /**
   * Normalizes the legal-organization identity claims used by host onboarding.
   *
   * Precedence rules:
   * - If `identifier.value` is already present, it is treated as the canonical
   *   legal identifier for onboarding and path routing.
   * - If `identifier.value` is missing but ICA provides
   *   `organizationCredential.credentialSubject.taxID`, that tax ID backfills
   *   `identifier.value`.
   * - If `identifier.type` is missing, GW infers `UUID` for UUID values and
   *   otherwise falls back to `TAX`.
   * - If `alternateName` is missing for a legal organization, GW derives it
   *   from the final canonical `identifier.value`.
   *
   * This makes the path-facing tenant id (`alternateName`) explicit:
   * - tax-id-only onboarding becomes `taxID -> identifier.value -> alternateName`
   * - if a jurisdiction uses a different legal registration identifier and
   *   sends it in `identifier.value`, that legal identifier wins over `taxID`
   *   for `alternateName`, `tenantId`, and `vaultId`.
   */
  private applyLegalOrganizationIdentityCompatibility(
    claims: ClaimsRecord,
    organizationCredential?: unknown,
  ): ClaimsRecord {
    return applyLegalOrganizationIdentityCompatibilityExternal(claims, organizationCredential);
  }

  private inferJurisdictionFromLegalIdentifier(identifierValue?: string): string | undefined {
    return inferJurisdictionFromLegalIdentifierExternal(identifierValue);
  }

  /**
   * Maps a host registry sector string to a NetworkName enum value.
   *
   * @param hostSector {string} Must be a NETWORK sector ('test', 'test-network', 'network').
   * @returns {NetworkName}
   * @warning Only use for infra/host logic. Never pass a business sector here.
   * @todo If you ever change sector handling, audit all usages for sector confusion.
   */
  private mapHostRegistrySectorToNetworkName(hostSector?: string): NetworkName {
    switch (String(hostSector || '').trim().toLowerCase()) {
      case 'test-network':
        return NetworkName.TestNetwork;
      case 'network':
        return NetworkName.Production;
      case 'test':
      default:
        return NetworkName.Test;
    }
  }

  private getCurrentUrnNetwork(): 'test' | 'test-network' | 'network' {
    const mode = String(this.config.networkMode || '').trim().toLowerCase();
    if (mode === 'test' || mode === 'test-network' || mode === 'network') {
      return mode;
    }
    return 'test';
  }

  private extractDidFromCredential(credential: any): string | undefined {
    return extractDidFromCredentialExternal(credential);
  }

  private decodeVpTokenPayload(vpToken?: string): Record<string, any> | undefined {
    return decodeVpTokenPayloadExternal(vpToken);
  }

  private decodeEmbeddedCredential(candidate: unknown): VpCredentialObject | undefined {
    return decodeEmbeddedCredentialExternal(candidate);
  }

  private credentialHasAnyType(credential: VpCredentialObject | undefined, acceptedTypes: string[]): boolean {
    return credentialHasAnyTypeExternal(credential, acceptedTypes);
  }

  private extractCredentialFromVpToken(vpToken: string | undefined, acceptedTypes: string[]): VpCredentialObject | undefined {
    return extractCredentialFromVpTokenExternal(vpToken, acceptedTypes);
  }

  private normalizeTenantPublicUrl(urlOrDomain?: string): string | undefined {
    return normalizeTenantPublicUrlExternal(urlOrDomain);
  }

  private normalizeTenantOperationalUrl(urlOrDomain?: string): string | undefined {
    return normalizeTenantOperationalUrlExternal(urlOrDomain);
  }

  private getOperationalServiceBaseUrl(claims: ClaimsRecord, options?: { operationalTenantUrl?: string; publicTenantUrl?: string; }): string | undefined {
    return getOperationalServiceBaseUrlExternal(claims, options);
  }

  private buildTenantAlsoKnownAs(params: {
    tenantUrn: string;
    primaryDid: string;
    externalDid?: string;
    hostedDid: string;
    publicTenantUrl?: string;
    hostedPublicUrl?: string;
  }): string[] {
    return buildTenantAlsoKnownAsExternal(params);
  }

  private extractActivationMaterial(entry: BundleEntry, body: any) {
    return extractActivationMaterialExternal({ entry, body });
  }

  private extractActivationParticipantMaterial(...candidates: Array<any>): ActivationParticipantMaterial | undefined {
    return extractActivationParticipantMaterialExternal(...candidates);
  }

  private warnOnLegacyActivationCredentialFields(activation: {
    legacyOrganizationCredential?: any;
    legacyRepresentativeCredential?: any;
    legacyControllerCredential?: any;
  }): void {
    const usedLegacyFields = [
      activation.legacyOrganizationCredential ? 'organizationCredential' : undefined,
      activation.legacyRepresentativeCredential ? 'representativeCredential' : undefined,
      activation.legacyControllerCredential ? 'controllerCredential' : undefined,
    ].filter((value): value is string => Boolean(value));
    if (!usedLegacyFields.length) {
      return;
    }
    this.logger.warn?.(
      `[HostingManager] _activate received deprecated legacy compatibility field(s): ${usedLegacyFields.join(', ')}. `
      + 'Canonical proof must be carried in vp_token; controller.* is the explicit controller key-binding contract.',
    );
  }

  private isDemoSecurityMode(): boolean {
    return this.config.securityMode === 'demo' || String(this.config.nodeEnv || '').trim().toLowerCase() === 'demo';
  }

  private isDevelopmentOrDemoDiagnosticsEnabled(): boolean {
    const nodeEnv = String(this.config.nodeEnv || '').trim().toLowerCase();
    return this.isDemoSecurityMode() || nodeEnv === 'development';
  }

  private backfillOrganizationActivationRouteDefaults(
    claims: ClaimsRecord,
    routeJurisdiction?: string,
  ): ClaimsRecord {
    return backfillOrganizationActivationRouteDefaultsExternal(claims, routeJurisdiction);
  }

  private logActivationIdentityDiagnostics(
    stage: string,
    claims: ClaimsRecord,
    routeJurisdiction?: string,
  ): void {
    logActivationIdentityDiagnosticsExternal({
      enabled: this.isDevelopmentOrDemoDiagnosticsEnabled(),
      stage,
      claims,
      routeJurisdiction,
    });
  }

  private assertActivationUrnInputs(claims: ClaimsRecord): void {
    const missing: string[] = [];
    if (!String(claims[ClaimsOrganizationSchemaorg.addressCountry] || '').trim()) {
      missing.push(ClaimsOrganizationSchemaorg.addressCountry);
    }
    if (!String(claims[ClaimsOrganizationSchemaorg.identifierType] || '').trim()) {
      missing.push(ClaimsOrganizationSchemaorg.identifierType);
    }
    if (!String(claims[ClaimsOrganizationSchemaorg.identifierValue] || '').trim()) {
      missing.push(ClaimsOrganizationSchemaorg.identifierValue);
    }
    if (missing.length > 0) {
      throw new ManagerError(
        `Missing required claim(s) for activation organization URN: ${missing.join(', ')}`,
        IssueType.Required,
      );
    }
  }

  private createOrganizationUrnSafely(
    claims: ClaimsRecord,
    requestedSector: Sector,
  ): string {
    this.assertActivationUrnInputs(claims);
    try {
      return createOrganizationUrn({
        namespace: this.config.namespace,
        network: this.getCurrentUrnNetwork(),
        jurisdiction: claims[ClaimsOrganizationSchemaorg.addressCountry] as string,
        sector: requestedSector,
        idType: claims[ClaimsOrganizationSchemaorg.identifierType] as string,
        idValue: claims[ClaimsOrganizationSchemaorg.identifierValue] as string,
      });
    } catch (error: any) {
      throw new ManagerError(
        `Failed to construct activation organization URN: ${String(error?.message || error || 'unknown error')}`,
        IssueType.Required,
      );
    }
  }

  private extractRepresentativeCredentialBindingValue(representativeCredential: any): string | undefined {
    const credentialData = representativeCredential?.credentialSubject?.hasCredential;
    const candidates = Array.isArray(credentialData) ? credentialData : [credentialData];
    for (const candidate of candidates) {
      if (!candidate) {
        continue;
      }
      if (typeof candidate === 'string' && candidate.trim()) {
        return candidate.trim();
      }
      if (typeof candidate === 'object') {
        const value = String(
          (candidate as any).material
          || (candidate as any).value
          || (candidate as any).identifier?.value
          || '',
        ).trim();
        if (value) {
          return value;
        }
      }
    }
    return undefined;
  }

  private async normalizeRepresentativeBindingMaterial(params: {
    publicKeyJwk?: PublicJwk;
    kid?: string;
  }): Promise<string | undefined> {
    if (params.publicKeyJwk) {
      try {
        return toJwkThumbprintSha256Urn(params.publicKeyJwk);
      } catch {
        // Fall through to kid normalization when the provided JWK cannot be
        // thumbprinted canonically.
      }
    }

    const rawKid = String(params.kid || '').trim();
    if (!rawKid) {
      return undefined;
    }
    if (rawKid.startsWith(JWK_THUMBPRINT_SHA256_URN_PREFIX)) {
      return rawKid;
    }
    return `${JWK_THUMBPRINT_SHA256_URN_PREFIX}${rawKid}`;
  }

  private async applyDemoRepresentativeBindingFallback(
    activation: ActivationMaterial,
    jobMeta?: DidCommDecodedMetadata,
  ): Promise<ActivationMaterial> {
    if (!this.isDemoSecurityMode() || !activation.representativeCredential) {
      return activation;
    }
    if (this.extractRepresentativeCredentialBindingValue(activation.representativeCredential)) {
      return activation;
    }

    const fallbackMaterial = await this.normalizeRepresentativeBindingMaterial({
      publicKeyJwk: activation.controllerBinding?.publicKeyJwk || jobMeta?.jws?.protected?.jwk as PublicJwk | undefined,
      kid: activation.controllerBinding?.publicKeyJwk?.kid || jobMeta?.jws?.protected?.kid,
    });
    if (!fallbackMaterial) {
      return activation;
    }

    this.logger.warn?.(
      '[HostingManager] _activate applied demo-only representative hasCredential.material fallback from controller/DIDComm metadata.',
    );

    return {
      ...activation,
      representativeCredential: {
        ...activation.representativeCredential,
        credentialSubject: {
          ...(activation.representativeCredential?.credentialSubject || {}),
          hasCredential: {
            material: fallbackMaterial,
          },
        },
      },
    };
  }

  private buildIcaSectorBaseUrl(jurisdiction: string, sector: string): string {
    return buildIcaSectorBaseUrlExternal({
      jurisdiction,
      sector,
      config: this.config,
      isDemoSecurityMode: this.isDemoSecurityMode.bind(this),
      isDevelopmentOrDemoDiagnosticsEnabled: this.isDevelopmentOrDemoDiagnosticsEnabled.bind(this),
    });
  }

  private extractJurisdictionFromIcaDidWeb(value?: string): string | undefined {
    return extractJurisdictionFromIcaDidWebExternal(value);
  }

  private extractJurisdictionFromIcaUrl(value?: string): string | undefined {
    return extractJurisdictionFromIcaUrlExternal(value);
  }

  private resolveIcaJurisdiction(routeJurisdiction?: string, configuredBaseUrl?: string): string {
    return resolveIcaJurisdictionExternal({
      routeJurisdiction,
      configuredBaseUrl,
      config: this.config,
      isDemoSecurityMode: this.isDemoSecurityMode.bind(this),
      isDevelopmentOrDemoDiagnosticsEnabled: this.isDevelopmentOrDemoDiagnosticsEnabled.bind(this),
    });
  }

  private buildIcaDidCreateUrl(jurisdiction: string, sector: string): string | undefined {
    return buildIcaDidCreateUrlExternal({
      jurisdiction,
      sector,
      config: this.config,
      isDemoSecurityMode: this.isDemoSecurityMode.bind(this),
      isDevelopmentOrDemoDiagnosticsEnabled: this.isDevelopmentOrDemoDiagnosticsEnabled.bind(this),
    });
  }

  private resolveAbsoluteUrl(location: string, baseUrl?: string): string {
    return resolveAbsoluteUrlExternal(location, baseUrl);
  }

  private async pollIcaJsonResult(location: string, baseUrl?: string, attempts: number = 5): Promise<any | undefined> {
    return pollIcaJsonResultExternal({ location, baseUrl, attempts });
  }

  private async registerDidDocumentWithIca(params: {
    vpToken: string;
    presentationSubmission?: any;
    jurisdiction: string;
    sector: string;
    organizationCredential: any;
    representativeCredential: any;
    organizationDidDocument: DidDocument;
    controllerDidDocument: DidDocument;
    organizationBinding?: ActivationParticipantMaterial;
    controllerBinding?: ActivationParticipantMaterial;
  }): Promise<any | undefined> {
    return registerDidDocumentWithIcaExternal({
      ...params,
      config: this.config,
      isDemoSecurityMode: this.isDemoSecurityMode.bind(this),
      isDevelopmentOrDemoDiagnosticsEnabled: this.isDevelopmentOrDemoDiagnosticsEnabled.bind(this),
    });
  }

  private normalizeBindingAliasList(value: unknown): string[] {
    return normalizeBindingAliasListExternal(value);
  }

  private extractRegistrationKeys(jobMeta?: DidCommDecodedMetadata) {
    return extractRegistrationKeysExternal(jobMeta);
  }

  private findJwkByUse(jwks: JwkSet | undefined, use: 'sig' | 'enc'): PublicJwk | undefined {
    return findJwkByUseExternal(jwks, use);
  }

  private isSignatureJwk(key: any): boolean {
    return isSignatureJwkExternal(key);
  }

  private isEncryptionJwk(key: any): boolean {
    return isEncryptionJwkExternal(key);
  }

  private mergeActivationJwks(keys: Array<PublicJwk | undefined>, jwks?: JwkSet): JwkSet {
    return mergeActivationJwksExternal(keys, jwks);
  }

  private async buildControllerEntityConfig(
    legalRep: IncludedResource,
    tenantUrn: string,
    hostedTenantDid: string,
    vaultId: string,
    registrationKeys?: { signerJwk?: PublicJwk; encrypterJwk?: PublicJwk },
    explicitBinding?: ActivationParticipantMaterial,
  ): Promise<EntityConfig> {
    return buildControllerEntityConfigExternal({
      legalRep,
      tenantUrn,
      hostedTenantDid,
      kmsService: this.kmsService,
      mergeActivationJwks: this.mergeActivationJwks.bind(this),
      findJwkByUse: this.findJwkByUse.bind(this),
      isSignatureJwk: this.isSignatureJwk.bind(this),
      isEncryptionJwk: this.isEncryptionJwk.bind(this),
      registrationKeys,
      explicitBinding,
    });
  }

  /**
   * Persists the synthetic bootstrap controller employee created for hosted
   * tenant initialization.
   *
   * Important behavior:
   * - this employee is not treated as a normal descendant for lifecycle gates
   * - a lightweight technical marker is copied to `doc.public.role`
   * - `HostingLifecycleService` uses that marker to ignore this record when it
   *   counts remaining employees before tenant `disable`/`purge`
   *
   * This keeps lifecycle scans on the lightweight container projection and
   * avoids hydrating the encrypted JWE just to recognize the bootstrap record.
   */
  private async storeControllerEntityConfig(
    controllerConfig: EntityConfig,
    tenantCollectionName: string,
    vaultId: string,
  ): Promise<void> {
    await storeControllerEntityConfigExternal({
      controllerConfig,
      tenantCollectionName,
      vaultId,
      kmsService: this.kmsService,
      vaultRepository: this.vaultRepository,
      bootstrapLifecycleRole: HOST_BOOTSTRAP_CONTROLLER_LIFECYCLE_ROLE,
    });
  }

  async process(job: JobRequest, environment?: string, isBootstrap: boolean = false): Promise<IDecodedDidcommPayload> {
    const issuerDid = composeHostDidWebId(this.config.apiBaseUrl, this.config.hostExternalDomain);
    
    try {
      switch (job.resourceType) {
        case 'Organization':
          if (job.action === '_transaction') {
            return await this.processOrganizationVerificationTransaction(job);
          }
          if (job.action === '_issue') {
            return await this.processOrganizationIssue(job);
          }
          if (job.action === '_activate') {
            return await this.processOrganizationActivation(job, environment);
          }
          if (
            job.action === ACTION_DISABLE
            || job.action === ACTION_ENABLE
            || job.action === ACTION_PURGE
            || job.action === ACTION_STATUS
          ) {
            return await this.processOrganizationLifecycle(job);
          }
          return await this.processOrganizationRegistration(job, environment, isBootstrap);
        case 'Document':
          if (job.section === 'did' && job.format === 'document' && job.action === '_binding') {
            return await this.processTenantDidDocumentBinding(job);
          }
          throw new ManagerError(`Unsupported action for Document: '${job.action}'`, IssueType.NotSupported);
        case 'Offer':
          if (job.action === '_search') {
            return await this.processOfferOrderSearch(job);
          }
          if (job.action === '_create') {
            return await this.processEmployeeLicenseOfferCreate(job);
          }
          throw new ManagerError(`Unsupported action for Offer: '${job.action}'`, IssueType.NotSupported);
        case 'Order':
          if (job.action === '_search') {
            return await this.processOfferOrderSearch(job);
          }
          return await this.processOrder(job, environment);
        default:
          throw new ManagerError(`Unsupported resourceType for hosting process: '${job.resourceType}'`, IssueType.NotSupported);
      }
    } catch (error) {
      const entry = (job.content?.body?.data && job.content.body.data[0]) ? job.content.body.data[0] : { type: job.resourceType || 'unknown' };
      const errorEntry = this.handleError(error, entry.type, entry.meta);
      return {
        jti: uuidv4(),
        type: 'hosting-response',
        thid: job.content?.thid as string,
        iss: issuerDid,
        aud: job.content?.iss as string,
        body: {
          data: [errorEntry],
          resourceType: ResourceTypesFhirR4.Bundle,
          type: 'batch-response',
          total: 1,
        },
      };
    }
  }

  private async processTenantDidDocumentBinding(job: JobRequest): Promise<IDecodedDidcommPayload> {
    return processTenantDidDocumentBindingExternal({
      job,
      issuerDid: composeHostDidWebId(this.config.apiBaseUrl, this.config.hostExternalDomain),
      hostCollectionName: this.hostRuntime.hostCollectionName,
      kmsService: this.kmsService,
      vaultRepository: this.vaultRepository,
      tenantsCacheManager: this.tenantsCacheManager,
      normalizeBindingAliasList: this.normalizeBindingAliasList.bind(this),
    });
  }

  /**
   * Forwards the first host-side legal-organization onboarding transaction to
   * ICA `_verify`.
   *
   * Separation of concerns:
   * - GW/portal/BFF communication keys remain in `meta.jws` / `meta.jwe`
   * - controller business binding material remains in
   *   `body.data[].resource.controller.publicKeyJwk`
   * - optional organization credential-signing material remains in
   *   `body.data[].resource.organization.publicKeyJwk`
   * - `_activate` remains a legacy compatibility route for callers that
   *   already start from an ICA proof, but this `_transaction` flow does not
   *   require it as a follow-up step
   *
   * Minimum gateway-enforced input claims:
   * - `HOST_TRANSACTION_REQUIRED_INPUT_CLAIMS`
   *
   * Minimum gateway-enforced output claims:
   * - `HOST_TRANSACTION_REQUIRED_OUTPUT_CLAIMS`
   */
  private async processOrganizationVerificationTransaction(job: JobRequest): Promise<IDecodedDidcommPayload> {
    return processOrganizationVerificationTransactionExternal({
      job,
      issuerDid: composeHostDidWebId(this.config.apiBaseUrl, this.config.hostExternalDomain),
      config: this.config,
      normalizeClaims: this.applyLegalOrganizationIdentityCompatibility.bind(this),
      createPendingTenantRegistrationFromClaims: this.createPendingTenantRegistrationFromClaims.bind(this),
      createOrganizationIssueClaimsFromClaims: this.createOrganizationIssueClaimsFromClaims.bind(this),
      forwardOrganizationVerificationTransactionToIca: this.forwardOrganizationVerificationTransactionToIca.bind(this),
      extractCredentialResourcesFromIcaPayload: this.extractCredentialResourcesFromIcaPayload.bind(this),
      reregisterExistingLegacyRepresentativeController: this.reregisterExistingLegacyRepresentativeController.bind(this),
      verifyTestNetworkAdmissionCredential: async ({ credential, claims, resource }) => {
        if (!this.cryptographyService) {
          throw new ManagerError('Host authorization cryptography is not configured.', IssueType.NotSupported);
        }
        const trustedIssuers = String(process.env.HOST_ORGANIZATION_AUTHORIZATION_ISSUERS || '')
          .split(',')
          .map(value => value.trim())
          .filter(Boolean);
        const trustedSigners = parseOrganizationAuthorizationSigners(
          process.env.HOST_ORGANIZATION_AUTHORIZATION_SIGNERS,
        );
        return verifyOrganizationTestNetworkCredential({
          credential,
          claims,
          controller: resource.controller,
          organization: resource.organization,
          controllerEmail: String(resource.controller?.email || ''),
          legalRepresentativeEmail: String(resource.legalRepresentativePayload?.email || resource.legalRepresentative?.email || ''),
          testNetworkCredentials: resource.testNetworkCredentials,
          cryptography: this.cryptographyService,
          trustedIssuers,
          trustedSigners,
        });
      },
    });
  }

  /** Re-registers a deployment-authorized historical legal representative for an active tenant. */
  private async reregisterExistingLegacyRepresentativeController(input: {
    claims: ClaimsRecord;
    credentials?: Array<Record<string, unknown>>;
    representativeCredential?: Record<string, unknown>;
    environment?: string;
    jobMeta?: DidCommDecodedMetadata;
  }): Promise<ClaimsRecord | undefined> {
    const representativeCredential = input.representativeCredential || input.credentials?.find((credential) => {
      const types = Array.isArray(credential.type) ? credential.type : [credential.type];
      return types.includes('LegalRepresentativeCredential');
    });
    const normalizedClaims = this.applyLegalOrganizationIdentityCompatibility(input.claims);
    if (!allowsLegacyRepresentativeBootstrap({
      representativeCredential,
      enabled: process.env.HOST_LEGACY_REPRESENTATIVE_CONTROLLER,
    })) return undefined;

    validateNewOrganizationClaims(normalizedClaims);
    const alternateName = String(normalizedClaims[ClaimsOrganizationSchemaorg.alternateName] || '').trim();
    const sector = String(normalizedClaims[ClaimsServiceSchemaorg.category] || '').trim() as Sector;
    const vaultId = getTenantVaultId(sector, alternateName);
    if (!await this.vaultRepository.vaultExists(vaultId)) return undefined;

    const { person } = this.extractResources(normalizedClaims, input.environment);
    if (!person) throw new ManagerError('Legacy representative re-registration requires representative claims.', IssueType.Required);

    const tenantUrn = createOrganizationUrn({
      namespace: this.config.namespace,
      network: this.getCurrentUrnNetwork(),
      jurisdiction: normalizedClaims[ClaimsOrganizationSchemaorg.addressCountry] as string,
      sector,
      idType: normalizedClaims[ClaimsOrganizationSchemaorg.identifierType] as string,
      idValue: normalizedClaims[ClaimsOrganizationSchemaorg.identifierValue] as string,
    });
    const hostedTenantDid = createHostedDidWeb(
      composeHostDidWebId(this.config.apiBaseUrl, this.config.hostExternalDomain),
      alternateName,
      {
        jurisdiction: normalizedClaims[ClaimsOrganizationSchemaorg.addressCountry] as string,
        version: 'v1',
        sector,
      },
    );
    const controllerConfig = await this.buildControllerEntityConfig(
      person,
      tenantUrn,
      hostedTenantDid,
      vaultId,
      this.extractRegistrationKeys(input.jobMeta),
    );
    const storedDoc = await this.vaultRepository.get(
      this.hostRuntime.hostCollectionName!, vaultId, getEnvSectionId('tenants'),
    ) as ConfidentialStorageDoc | undefined;
    if (!storedDoc) throw new ManagerError(`Tenant registry document not found for '${vaultId}'.`, IssueType.NotFound);
    const storedTenant = await this.kmsService.unprotectConfidentialData(storedDoc, 'host') as OrganizationConfig;
    // A pending tenant is still between its reviewed transaction and Order.
    // Let the pending-registration continuation preserve its original Offer
    // and backfill the verified pre-DCR communication binding; the active-
    // tenant controller re-registration path requires a finalized tenant DID.
    if (storedTenant.status === EntityLifecycleStatus.Pending) return undefined;
    const controllerDid = controllerConfig.didDocument?.id;
    if (!storedTenant.didDocument?.id || !controllerDid) {
      throw new ManagerError('Legacy representative re-registration requires tenant and controller DID documents.', IssueType.Required);
    }
    const currentControllers = Array.isArray(storedTenant.didDocument.controller)
      ? storedTenant.didDocument.controller
      : storedTenant.didDocument.controller ? [storedTenant.didDocument.controller] : [];
    const updatedDoc = {
      ...storedDoc,
      sequence: Number(storedDoc.sequence || 0) + 1,
      content: {
        ...storedTenant,
        didDocument: { ...storedTenant.didDocument, controller: Array.from(new Set([...currentControllers, controllerDid])) },
        meta: { ...(storedTenant.meta || {}), lastUpdated: new Date().toISOString() },
      },
    };
    const secureUpdatedDoc = await this.kmsService.protectConfidentialData(updatedDoc, 'host');
    await this.vaultRepository.put(this.hostRuntime.hostCollectionName!, [secureUpdatedDoc], getEnvSectionId('tenants'));
    const tenantCollectionName = await this.tenantsCacheManager.getCollectionName(vaultId)
      || generateTenantCollectionNameFromClaims(normalizedClaims);
    if (!await this.vaultRepository.vaultExists(tenantCollectionName)) {
      await this.vaultRepository.createNewVault({ id: tenantCollectionName });
    }
    await this.storeControllerEntityConfig(controllerConfig, tenantCollectionName, vaultId);
    const representativeActivationCode = await this.reconcileLegacyRepresentativeEmployeeSeats({
      tenantVaultId: vaultId,
      tenantId: alternateName,
      claims: normalizedClaims,
    });
    await this.tenantsCacheManager.refreshTenant(vaultId);
    return {
      ...normalizedClaims,
      [ClaimsOrganizationSchemaorg.identifier]: tenantUrn,
      ...(representativeActivationCode ? {
        [ClaimsIndividualProductSchemaorg.serialNumber]: representativeActivationCode,
        [ClaimsIndividualProductSchemaorg.category]: 'professional',
      } : {}),
    };
  }

  /**
   * Repairs the historical legal-organization onboarding invariant without
   * replacing any independently registered controller or assigned seat.
   *
   * Legacy re-registration guarantees a two-seat employee pool: one seat may
   * already belong to a technical controller and the verified representative
   * receives the other. Replays reuse the representative's existing
   * issued/active seat and reserve the exact free second initial seat for a
   * later technical-controller binding. They never replace an assigned seat.
   */
  private async reconcileLegacyRepresentativeEmployeeSeats(input: {
    tenantVaultId: string;
    tenantId: string;
    claims: ClaimsRecord;
  }): Promise<string | undefined> {
    const sectionId = getEnvSectionId('device-licenses');
    const all = await this.vaultRepository.getContainersInSection<ConfidentialStorageDoc>(
      input.tenantVaultId,
      sectionId,
    ) || [];
    const employeeSeats = all.filter((doc) => {
      const license = doc.content as DeviceLicense | undefined;
      return license?.userClass === LICENSE_USER_CLASS_EMPLOYEE;
    });
    const email = normalizeIndexedEmail(
      String(input.claims[ClaimsPersonSchemaorg.email] || ''),
    );
    const role = getPersonOccupationClaim(input.claims);
    const representativeSeat = email && role ? employeeSeats.find((doc) => {
      const license = doc.content as DeviceLicense | undefined;
      return normalizeIndexedEmail(String(license?.issuedToEmail || '')) === email
        && normalizeCodeSystemAndValue(String(license?.issuedToRole || ''))
          === normalizeCodeSystemAndValue(role)
        && (license?.status === LICENSE_STATUS_ISSUED || license?.status === LICENSE_STATUS_ACTIVE);
    }) : undefined;
    const hasAvailableSeat = employeeSeats.some((doc) =>
      (doc.content as DeviceLicense | undefined)?.status === LICENSE_STATUS_AVAILABLE);
    const minimumTotal = !representativeSeat && !hasAvailableSeat
      ? Math.max(2, employeeSeats.length + 1)
      : Math.max(2, employeeSeats.length);
    const now = Math.floor(Date.now() / 1000);
    const missing = Math.max(0, minimumTotal - employeeSeats.length);
    const created: ConfidentialStorageDoc[] = [];
    for (let index = 0; index < missing; index += 1) {
      const id = uuidv4();
      const license: DeviceLicense = {
        id,
        tenantId: input.tenantId,
        orderId: `legacy-default:${input.tenantId}`,
        userClass: LICENSE_USER_CLASS_EMPLOYEE,
        userCategory: 'default',
        type: LICENSE_TYPE_MOBILE,
        status: LICENSE_STATUS_AVAILABLE,
        plan: 'default',
        renewalCycle: '12m',
        reactivationEnabled: false,
        exp: now + 31_536_000,
      };
      created.push({ id, status: LICENSE_STATUS_AVAILABLE, sequence: 0, content: license });
    }
    if (created.length > 0) {
      await this.vaultRepository.put(input.tenantVaultId, created, sectionId);
      employeeSeats.push(...created);
    }

    if (!email || !role) return undefined;
    const organizationOfficialId = resolveLedgerOrganizationId(input.claims);
    const jurisdiction = String(
      input.claims[ClaimsOrganizationSchemaorg.addressCountry] || '',
    ).trim();
    if (!jurisdiction) {
      throw new Error('Legal-representative licence requires the authoritative organization jurisdiction.');
    }
    const stableActorIdentifier = buildStableActorIdentifier({ contactKind: 'email', contact: email });
    const ledgerIdentity = buildIssuedRoleLicenseLedgerIdentity({
      organizationId: organizationOfficialId,
      jurisdiction,
      contactKind: 'email',
      contact: email,
      licensedRole: role,
    });
    const issued = representativeSeat
      ? {
          activationCode: String((representativeSeat.content as DeviceLicense).activationCode || '').trim() || undefined,
          licenseId: representativeSeat.id,
        }
      : await issueActivationCodeFromPool({
          vaultRepository: this.vaultRepository,
          kmsService: this.kmsService,
          tenantVaultId: input.tenantVaultId,
          userClass: LICENSE_USER_CLASS_EMPLOYEE,
          type: LICENSE_TYPE_MOBILE,
          email,
          role,
          ownerOrganizationId: organizationOfficialId,
          stableActorIdentifier,
          beforePersist: async () => {
            await ensureIssuedRoleLicenseOnLedger({
              identity: ledgerIdentity,
              sector: String(input.claims[ClaimsServiceSchemaorg.category] || '').trim(),
            });
          },
        });
    if (representativeSeat) {
      await ensureIssuedRoleLicenseOnLedger({
        identity: ledgerIdentity,
        sector: String(input.claims[ClaimsServiceSchemaorg.category] || '').trim(),
      });
      const current = representativeSeat.content as DeviceLicense;
      if (current.ownerOrganizationId !== organizationOfficialId
        || current.activatedBy !== stableActorIdentifier) {
        current.ownerOrganizationId = organizationOfficialId;
        current.activatedBy = stableActorIdentifier;
        representativeSeat.sequence = Number(representativeSeat.sequence || 0) + 1;
        await this.vaultRepository.put(input.tenantVaultId, [representativeSeat], sectionId);
      }
    }
    const hasFreeSecondInitialSeat = employeeSeats.length === 2
      && employeeSeats.some((doc) => doc.id !== issued.licenseId
        && (doc.content as DeviceLicense | undefined)?.status === LICENSE_STATUS_AVAILABLE);
    if (hasFreeSecondInitialSeat) {
      await reserveTechnicalControllerSeat({
        vaultRepository: this.vaultRepository,
        tenantVaultId: input.tenantVaultId,
        representativeLicenseId: issued.licenseId,
        ownerOrganizationId: organizationOfficialId,
      });
    }
    const { activationCode } = issued;
    return activationCode;
  }

  /**
   * Repairs the deployment-wide historical representative seat invariant at
   * startup, before a controller opens the tenant inventory.
   *
   * This migration reads only the already verified tenant registration claims.
   * It never invents an actor from portal state and never replaces an existing
   * controller/employee seat. When an old tenant filled every existing seat
   * before reserving the representative, one additional seat is created so the
   * mandatory reservation does not evict another actor.
   */
  public async reconcileLegacyRepresentativeSeatInventories(): Promise<number> {
    const enabled = String(process.env.HOST_LEGACY_REPRESENTATIVE_CONTROLLER || '').trim().toLowerCase();
    if (!['true', '1', 'yes', 'on'].includes(enabled)) return 0;
    const records = await this.vaultRepository.getContainersInSection<ConfidentialStorageDoc>(
      this.hostRuntime.hostCollectionName,
      getEnvSectionId('tenants'),
    );
    let reconciled = 0;
    for (const record of records || []) {
      if (!record?.id || record.id === 'host') continue;
      try {
        const tenant = await this.kmsService.unprotectConfidentialData<OrganizationConfig>(record, 'host');
        const claims = tenant?.claims as ClaimsRecord | undefined;
        const tenantId = String(claims?.[ClaimsOrganizationSchemaorg.alternateName] || '').trim();
        const sector = String(claims?.[ClaimsServiceSchemaorg.category] || '').trim() as Sector;
        if (!claims || !tenantId || !sector) continue;
        const tenantVaultId = getTenantVaultId(sector, tenantId);
        await this.reconcileLegacyRepresentativeEmployeeSeats({ tenantVaultId, tenantId, claims });
        // The logical tenant vault id is stable, but older deployments could
        // persist employees in a different physical collection. Resolve the
        // authoritative mapping first and retain the deterministic and logical
        // names only as compatibility fallbacks. This is especially important
        // during startup, before a portal can repair a missing public
        // `didDocument.controller` through an authenticated request.
        const employeeCollectionCandidates = Array.from(new Set([
          await this.tenantsCacheManager.getCollectionName(tenantVaultId),
          generateTenantCollectionNameFromClaims(claims),
          tenantVaultId,
        ].filter((value): value is string => Boolean(value))));
        const employeeDocumentsById = new Map<string, ConfidentialStorageDoc>();
        for (const collectionName of employeeCollectionCandidates) {
          try {
            const documents = await this.vaultRepository.getContainersInSection<ConfidentialStorageDoc>(
              collectionName,
              getEnvSectionId('employees'),
            );
            for (const document of documents || []) {
              if (document?.id) employeeDocumentsById.set(document.id, document);
            }
          } catch {
            // A compatibility candidate may not exist in historical storage.
          }
        }
        const employeeDocuments = Array.from(employeeDocumentsById.values());
        const storedControllerDids: string[] = [];
        for (const employeeDocument of employeeDocuments || []) {
          try {
            const employee = await this.kmsService.unprotectConfidentialData<EntityConfig>(
              employeeDocument,
              tenantVaultId,
            );
            const role = normalizeCodeSystemAndValue(String(
              employee?.claims?.[ClaimsPersonSchemaorg.additionalType] || '',
            ));
            const did = String(employee?.didDocument?.id || '').trim();
            if (
              employee?.status === EntityLifecycleStatus.Active
              && (role === 'resprsn' || role.endsWith(':resprsn'))
              && did
            ) {
              storedControllerDids.push(did);
            }
          } catch {
            // An unreadable employee cannot be promoted into the public DID.
          }
        }
        const currentControllers = Array.isArray(tenant.didDocument?.controller)
          ? tenant.didDocument.controller
          : tenant.didDocument?.controller ? [tenant.didDocument.controller] : [];
        const nextControllers = Array.from(new Set([...currentControllers, ...storedControllerDids]));
        if (nextControllers.length !== currentControllers.length) {
          const updatedTenant = {
            ...tenant,
            didDocument: { ...tenant.didDocument, controller: nextControllers },
            meta: { ...(tenant.meta || {}), lastUpdated: new Date().toISOString() },
          };
          const updatedDocument = {
            ...record,
            sequence: Number(record.sequence || 0) + 1,
            content: updatedTenant,
          };
          const protectedDocument = await this.kmsService.protectConfidentialData(updatedDocument, 'host');
          await this.vaultRepository.put(
            this.hostRuntime.hostCollectionName,
            [protectedDocument],
            getEnvSectionId('tenants'),
          );
          await this.tenantsCacheManager.refreshTenant(tenantVaultId);
        }
        reconciled += 1;
      } catch (error) {
        this.logger.warn?.(
          `[HostingManager] Historical representative seat reconciliation skipped for tenant '${record.id}': ${String((error as Error)?.message || error)}`,
        );
      }
    }
    return reconciled;
  }

  /**
   * Reprojects each persisted tenant's current canonical service catalog.
   *
   * This startup migration preserves legal identity, keys, controllers and
   * non-GW custom services. It removes obsolete resource-specific Digital Twin
   * searches because `ResearchSubject` is the only public twin aggregate; its
   * canonical `Composition` remains internal to that aggregate.
   */
  public async reconcileTenantServiceCatalog(): Promise<number> {
    const records = await this.vaultRepository.getContainersInSection<ConfidentialStorageDoc>(
      this.hostRuntime.hostCollectionName,
      getEnvSectionId('tenants'),
    );
    let reconciled = 0;
    for (const record of records || []) {
      if (!record?.id || record.id === 'host') continue;
      const tenant = await this.kmsService.unprotectConfidentialData<OrganizationConfig>(record, 'host');
      const claims = tenant?.claims as ClaimsRecord | undefined;
      const tenantId = String(claims?.[ClaimsOrganizationSchemaorg.alternateName] || '').trim();
      if (!claims || !tenantId || !tenant.didDocument?.id) continue;

      const sector = String(claims[ClaimsServiceSchemaorg.category] || '').trim() as Sector;
      const jurisdiction = String(claims[ClaimsOrganizationSchemaorg.addressCountry] || '').trim();
      if (!sector || !jurisdiction) continue;
      const publicTenantUrl = this.normalizeTenantPublicUrl(
        claims[ClaimsOrganizationSchemaorg.url] as string | undefined,
      );
      const operationalTenantUrl = this.getOperationalServiceBaseUrl(claims);
      const hostedByDefault = !publicTenantUrl?.startsWith('https://')
        || (!!operationalTenantUrl && !!publicTenantUrl
          && new URL(operationalTenantUrl).host !== new URL(publicTenantUrl).host);
      const publicBaseUrl = hostedByDefault
        ? this.config.apiBaseUrl
        : (publicTenantUrl || this.config.apiBaseUrl);
      const serviceBaseUrl = operationalTenantUrl || publicBaseUrl;
      const didConfigServices = initializeTenantServicesConfig(
        sector,
        [],
        claims[ClaimsServiceSchemaorg.serviceType] as string | undefined,
        claims[SERVICE_ADDITIONAL_TYPE_CLAIM] as string | undefined,
      );
      const canonicalServices = populateDidDocumentServices(
        tenant.didDocument.id,
        publicBaseUrl,
        didConfigServices,
        true,
        { alternateName: tenantId, jurisdiction, version: 'v1', sector },
        serviceBaseUrl,
      );
      const canonicalIds = new Set(canonicalServices.map((service) => service.id));
      const retainedCustomServices = (tenant.didDocument.service || []).filter((service) => (
        !canonicalIds.has(service.id)
        && !this.isObsoleteDigitalTwinSearchService(tenant.didDocument!.id, service)
      ));
      const nextServices = [...canonicalServices, ...retainedCustomServices];
      if (JSON.stringify(tenant.didDocument.service || []) === JSON.stringify(nextServices)) continue;

      const nextTenant: OrganizationConfig = {
        ...tenant,
        didConfig: { ...(tenant.didConfig || {}), service: didConfigServices },
        didDocument: { ...tenant.didDocument, service: nextServices },
        meta: { ...(tenant.meta || {}), lastUpdated: new Date().toISOString() },
      };
      const protectedRecord = await this.kmsService.protectConfidentialData({
        ...record,
        sequence: Number(record.sequence || 0) + 1,
        content: nextTenant,
      }, 'host');
      await this.vaultRepository.put(
        this.hostRuntime.hostCollectionName,
        [protectedRecord],
        getEnvSectionId('tenants'),
      );
      await this.tenantsCacheManager.refreshTenant(getTenantVaultId(sector, tenantId));
      reconciled += 1;
    }
    return reconciled;
  }

  /** Identifies pre-ResearchSubject public twin search routes. */
  private isObsoleteDigitalTwinSearchService(tenantDid: string, service: DidService): boolean {
    const id = String(service?.id || '').trim().toLowerCase();
    const prefix = `${String(tenantDid || '').trim().toLowerCase()}#digitaltwin:`;
    if (!id.startsWith(prefix) || !id.endsWith(':_search')) return false;
    const resourceType = id.slice(prefix.length, -':_search'.length).split(':').at(-1);
    return resourceType !== 'researchsubject';
  }

  private async processOrganizationIssue(job: JobRequest): Promise<IDecodedDidcommPayload> {
    return processOrganizationIssueExternal({
      job,
      issuerDid: composeHostDidWebId(this.config.apiBaseUrl, this.config.hostExternalDomain),
      config: this.config,
      normalizeClaims: this.applyLegalOrganizationIdentityCompatibility.bind(this),
      createPendingTenantRegistrationFromClaims: this.createPendingTenantRegistrationFromClaims.bind(this),
      createOrganizationIssueClaimsFromClaims: this.createOrganizationIssueClaimsFromClaims.bind(this),
      forwardOrganizationVerificationTransactionToIca: this.forwardOrganizationVerificationTransactionToIca.bind(this),
      extractCredentialResourcesFromIcaPayload: this.extractCredentialResourcesFromIcaPayload.bind(this),
      persistExistingTenantControllerBinding: ({ claims, controller, controllerCredential, verifiedSignerKid, transactionId }) =>
        persistExistingTenantControllerBindingExternal({
          claims,
          controller,
          controllerCredential,
          verifiedSignerKid,
          transactionId,
          hostCollectionName: this.hostRuntime.hostCollectionName,
          vaultRepository: this.vaultRepository,
          kmsService: this.kmsService,
          tenantsCacheManager: this.tenantsCacheManager,
          registerControllerKeysOnLedger,
        }),
    });
  }

  /**
   * Projects the host `_transaction-response` contract into one explicit object
   * that portal/BFF callers can consume without reverse-engineering GW state.
   *
   * Why this shape exists:
   * - `icaResponse` preserves the verification VCs/Bundle returned by ICA
   * - `meta.claims` already carries the generated host-side commercial offer
   * - `resource.next` makes the next mandatory host action explicit so the
   *   caller can continue directly with `Order/_batch`
   *
   * Contract rule:
   * - `_transaction` is the canonical legal-organization onboarding step
   * - `_activate` remains a legacy compatibility route, not a required
   *   continuation after `_transaction`
   * - the response prepares the host-side pending registration/offer state
   *   later consumed by Order
   *
   * Canonical claim rule:
   * - the real Offer contract must live in `resource.meta.claims['org.schema.Offer.identifier']`
   * - `resource.next.acceptedOffer.identifier` is only a derived workflow hint
   * - tests must fail if the canonical claim disappears, even if `resource.next`
   *   still contains a copied identifier
   */
  private buildOrganizationVerificationTransactionResponseResource(
    icaResponse: unknown,
    processedClaims: ClaimsRecord,
  ): LegalOrganizationVerificationTransactionResponseResource {
    return buildOrganizationVerificationTransactionResponseResource(icaResponse, processedClaims);
  }

  private buildOrganizationIssueResponseResource(
    icaResponse: unknown,
    processedClaims: ClaimsRecord,
  ): LegalOrganizationIssueResponseResource {
    return buildOrganizationIssueResponseResource(icaResponse, processedClaims);
  }

  /**
   * Creates the same provisional host-side registration state used by the
   * legacy registration offer flow, but starting from the claims already
   * validated for host `_transaction`.
   *
   * Step by step:
   * 1. normalize legal-organization identity compatibility fields
   * 2. ensure a tenant alternateName exists, falling back to the tenant route id
   * 3. validate the requested tenant sector against host policy
   * 4. derive the canonical organization identifier and commercial offer claims
   * 5. persist one `pending` host-side registration record indexed by offer id
   *
   * This helper is intentionally reused by both:
   * - direct organization registration (`Organization/_batch`)
   * - host legal verification transaction (`Organization/_transaction`)
   *
   * so the canonical flow can continue with `Order/_batch` without legacy `_activate`.
   */
  private async createPendingTenantRegistrationFromClaims(input: {
    claims: ClaimsRecord;
    environment?: string;
    jobMeta?: DidCommDecodedMetadata;
    fallbackAlternateName?: string;
    primaryDid?: string;
    registrationControllerDid?: string;
    postalActivationCodeBinding?: PostalActivationCodeBinding;
  }): Promise<ClaimsRecord> {
    return createPendingTenantRegistration({
      claims: input.claims,
      environment: input.environment,
      jobMeta: input.jobMeta,
      fallbackAlternateName: input.fallbackAlternateName,
      primaryDid: input.primaryDid,
      registrationControllerDid: input.registrationControllerDid,
      postalActivationCodeBinding: input.postalActivationCodeBinding,
      config: this.config,
      vaultRepository: this.vaultRepository,
      kmsService: this.kmsService,
      hostRuntime: this.hostRuntime,
      applyLegalOrganizationIdentityCompatibility: this.applyLegalOrganizationIdentityCompatibility.bind(this),
      extractResources: this.extractResources.bind(this),
      handleServiceAttachment: this._handleServiceAttachment.bind(this),
      withHostedOrganizationOfferClaims: this.withHostedOrganizationOfferClaims.bind(this),
      extractRegistrationKeys: this.extractRegistrationKeys.bind(this),
      getCurrentUrnNetwork: this.getCurrentUrnNetwork.bind(this),
    });
  }

  private async createOrganizationIssueClaimsFromClaims(input: {
    claims: ClaimsRecord;
    environment?: string;
    fallbackAlternateName?: string;
    bearerPayload?: Record<string, any>;
  }): Promise<ClaimsRecord> {
    return createOrganizationIssueClaims({
      claims: input.claims,
      environment: input.environment,
      fallbackAlternateName: input.fallbackAlternateName,
      bearerPayload: input.bearerPayload,
      config: this.config,
      vaultRepository: this.vaultRepository,
      kmsService: this.kmsService,
      getEnvSectionId,
      applyLegalOrganizationIdentityCompatibility: this.applyLegalOrganizationIdentityCompatibility.bind(this),
      extractResources: (claims, environment) => {
        const { organization, service } = this.extractResources(claims, environment);
        return { organization, service };
      },
      handleServiceAttachment: this._handleServiceAttachment.bind(this),
      getCurrentUrnNetwork: this.getCurrentUrnNetwork.bind(this),
    });
  }

  private async resolveOrganizationIssueControllerIdentity(input: {
    claims: ClaimsRecord;
    bearerPayload?: Record<string, any>;
    tenantVaultId: string;
  }): Promise<{ email?: string; role?: string; }> {
    return resolveOrganizationIssueControllerIdentityExternal({
      ...input,
      securityMode: this.config.securityMode,
      vaultRepository: this.vaultRepository,
      kmsService: this.kmsService,
    });
  }

  private async findStoredControllerRoleByEmail(
    tenantVaultId: string,
    email: string | undefined,
  ): Promise<string | undefined> {
    return findStoredControllerRoleByEmailExternal({
      tenantVaultId,
      email,
      vaultRepository: this.vaultRepository,
      kmsService: this.kmsService,
    });
  }

  private getIcaVerifyBaseUrl(): string {
    const configuredBaseUrl = this.config.ica?.mode === 'internal'
      ? this.config.ica?.internalUrl
      : this.config.ica?.externalUrl || this.config.ica?.internalUrl;
    if (!configuredBaseUrl) {
      throw new ManagerError('ICA verification URL is not configured.', IssueType.NotSupported);
    }
    return configuredBaseUrl.replace(/\/+$/, '');
  }

  private buildIcaVerifyUrl(jurisdiction: string, sector: string, resourceType: string): string {
    return buildIcaVerifyUrlExternal({
      jurisdiction,
      sector,
      resourceType,
      config: this.config,
      isDemoSecurityMode: this.isDemoSecurityMode.bind(this),
      isDevelopmentOrDemoDiagnosticsEnabled: this.isDevelopmentOrDemoDiagnosticsEnabled.bind(this),
    });
  }

  private async forwardOrganizationVerificationTransactionToIca(input: {
    job: JobRequest;
    entry: LegalOrganizationVerificationTransactionEntry;
    claims: ClaimsRecord;
    resource: LegalOrganizationVerificationTransactionResource;
    requestedSector: string;
    resourceType: string;
  }): Promise<any> {
    const hostDid = composeHostDidWebId(this.config.apiBaseUrl, this.config.hostExternalDomain);
    return forwardOrganizationVerificationTransactionToIcaExternal({
      ...input,
      organizationVerificationTransactionRequestType: ORGANIZATION_VERIFICATION_TRANSACTION_REQUEST_TYPE,
      icaDidcommPlainJsonMediaType: ICA_DIDCOMM_PLAIN_JSON_MEDIA_TYPE,
      hostJurisdiction: this.config.host.jurisdiction,
      buildIcaVerifyUrl: this.buildIcaVerifyUrl.bind(this),
      pollIcaJsonResult: this.pollIcaJsonResult.bind(this),
      hostDid,
      signHostAuthorizationPayload: async (payload) => {
        const signingKey = await this.kmsService.getPublicVerificationKey('host', 'ES384', 'comm_sig');
        const kid = String(signingKey?.kid || '').trim();
        if (!kid) {
          throw new ManagerError(
            'VetChain host ES384 communication signing key is required for PDF-free ICA verification.',
            IssueType.NotSupported,
          );
        }
        return this.kmsService.createCompactJws(
          payload,
          kid,
          'host',
          'comm_sig',
          {
            typ: 'application/didcomm-signed+json',
            cty: 'application/didcomm-plain+json',
            alg: 'ES384',
            kid: `${hostDid}#${kid}`,
          },
        );
      },
    });
  }

  /**
   * Extracts credential resources from the raw ICA verification envelope.
   *
   * Transitional response contract:
   * - `resource.icaResponse` keeps the full raw ICA payload for debugging
   * - `resource.vc[]` exposes only credential resources so callers can consume
   *   the verification outcome directly
   */
  private extractCredentialResourcesFromIcaPayload(icaResponse: unknown): Array<Record<string, unknown>> {
    return extractCredentialResourcesFromIcaPayloadExternal(icaResponse);
  }

  /**
   * Reads already-persisted Offer/Order records so portal/BFF code can build
   * list/detail screens without reading raw vault sections directly.
   */
  private async processOfferOrderSearch(job: JobRequest): Promise<IDecodedDidcommPayload> {
    return processOfferOrderSearchExternal({
      job,
      issuerDid: composeHostDidWebId(this.config.apiBaseUrl, this.config.hostExternalDomain),
      handleError: this.handleError.bind(this),
      processOfferSearchEntry: this.processOfferSearchEntry.bind(this),
      processOrderSearchEntry: this.processOrderSearchEntry.bind(this),
    });
  }

  private async processOfferSearchEntry(job: JobRequest, entry: BundleEntry): Promise<BundleEntry[]> {
    return this.offerOrderService.processOfferSearchEntry(job, entry);
  }

  /** Creates host-policy professional-seat Offers from controller requests. */
  private async processEmployeeLicenseOfferCreate(job: JobRequest): Promise<IDecodedDidcommPayload> {
    const responseEntries: (BundleEntry | ErrorEntry)[] = [];
    for (const entry of job.content?.body?.data || []) {
      try {
        responseEntries.push(
          await this.offerOrderService.processEmployeeLicenseOfferCreateEntry(job, entry),
        );
      } catch (error) {
        responseEntries.push(this.handleError(error, entry.type, entry.meta));
      }
    }
    return {
      jti: uuidv4(),
      type: 'hosting-response',
      thid: job.content?.thid as string,
      iss: composeHostDidWebId(this.config.apiBaseUrl, this.config.hostExternalDomain),
      aud: job.content?.iss as string,
      exp: Math.floor(Date.now() / 1000) + 300,
      body: {
        data: responseEntries,
        resourceType: ResourceTypesFhirR4.Bundle,
        type: getBundleResponseTypeForAction(job.action),
        total: responseEntries.length,
      },
    };
  }

  private async processOrderSearchEntry(job: JobRequest, entry: BundleEntry): Promise<BundleEntry[]> {
    return this.offerOrderService.processOrderSearchEntry(job, entry);
  }

  /**
   * Handles activation of an organization backend/connector from ICA-issued proof.
   *
   * TODO(ica-activation):
   * Replace this placeholder with the real flow:
   * 1. Validate the controller-submitted vp_token / ICA proof.
   * 2. Verify organization + representative credentials issued by ICA.
   * 3. Verify that the submitted backend/conector DID document matches the ICA-issued organization DID.
   * 4. Activate/provision the tenant backend in the selected host network.
   *
   * TODO(ica-deactivation-v1):
   * Add the symmetric host/portal `/_deactivate` flow for ICA-backed lifecycle changes.
   * GW local `disable` means suspension only. Authoritative VC suspension/revocation
   * must come from ICA/ledger `credentialStatus`, and the corresponding update must
   * not purge historical tenant/controller/license evidence.
   */
  private async processOrganizationActivation(job: JobRequest, environment?: string): Promise<IDecodedDidcommPayload> {
    return processOrganizationActivationExternal({
      job,
      environment,
      issuerDid: composeHostDidWebId(this.config.apiBaseUrl, this.config.hostExternalDomain),
      config: this.config,
      hostRuntime: this.hostRuntime,
      logger: this.logger,
      vaultRepository: this.vaultRepository,
      kmsService: this.kmsService,
      activationTrustAdapter: this.activationTrustAdapter,
      handleError: this.handleError.bind(this),
      extractActivationMaterial: this.extractActivationMaterial.bind(this),
      applyDemoRepresentativeBindingFallback: this.applyDemoRepresentativeBindingFallback.bind(this),
      warnOnLegacyActivationCredentialFields: this.warnOnLegacyActivationCredentialFields.bind(this),
      backfillOrganizationActivationRouteDefaults: this.backfillOrganizationActivationRouteDefaults.bind(this),
      applyLegalOrganizationIdentityCompatibility: this.applyLegalOrganizationIdentityCompatibility.bind(this),
      logActivationIdentityDiagnostics: this.logActivationIdentityDiagnostics.bind(this),
      normalizeTenantPublicUrl: this.normalizeTenantPublicUrl.bind(this),
      createOrganizationUrnSafely: this.createOrganizationUrnSafely.bind(this),
      withHostedOrganizationOfferClaims: this.withHostedOrganizationOfferClaims.bind(this),
      mapHostRegistrySectorToNetworkName: this.mapHostRegistrySectorToNetworkName.bind(this),
      extractResources: this.extractResources.bind(this),
      handleServiceAttachment: this._handleServiceAttachment.bind(this),
      finalizeTenantConfig: this.finalizeTenantConfig.bind(this),
      getCurrentUrnNetwork: this.getCurrentUrnNetwork.bind(this),
      buildControllerEntityConfig: this.buildControllerEntityConfig.bind(this),
      extractRegistrationKeys: this.extractRegistrationKeys.bind(this),
      storeControllerEntityConfig: this.storeControllerEntityConfig.bind(this),
      reregisterExistingLegacyRepresentativeController: this.reregisterExistingLegacyRepresentativeController.bind(this),
      registerDidDocumentWithIca: this.registerDidDocumentWithIca.bind(this),
      isLedgerRegistrationEnabled: this.isLedgerRegistrationEnabled.bind(this),
      extractServiceEvidence: this.extractServiceEvidence.bind(this),
    });
  }

  private async processOrganizationLifecycle(job: JobRequest): Promise<IDecodedDidcommPayload> {
    return this.lifecycleService.processOrganizationLifecycle(job);
  }

  /**
   * Shared commercial Offer projection for host legal-organization onboarding.
   *
   * Non-negotiable rule:
   * - `_transaction` and legacy `_activate` must derive Offer claims through
   *   this same helper so the canonical
   *   `meta.claims['org.schema.Offer.identifier']` contract cannot drift
   * - the employee-seat source is `Organization.numberOfEmployees`
   * - generation semantics must preserve the pre-existing onboarding behavior
   *   of each flow as encoded by `generateLicenseOffer(...)`
   */
  private withHostedOrganizationOfferClaims(
    claims: ClaimsRecord,
    requestedSector: Sector,
  ): ClaimsRecord {
    const hostDid = composeHostDidWebId(this.config.apiBaseUrl, this.config.hostExternalDomain);
    const requestedEmployeeCount = Number(
      claims[ClaimsOrganizationSchemaorg.numberOfEmployees],
    );
    const employeeCount = Number.isInteger(requestedEmployeeCount) && requestedEmployeeCount > 0
      ? Math.max(2, requestedEmployeeCount)
      : 2;
    const offerClaims = generateLicenseOffer(
      employeeCount,
      hostDid,
      this.config.host.jurisdiction || '',
      requestedSector,
      this.config.allowedPaymentMethods,
    );
    return {
      ...claims,
      ...offerClaims,
    };
  }

  /**
   * Handles Phase 1, Step 1: Provisional Registration.
   */
  private async processOrganizationRegistration(job: JobRequest, environment?: string, isBootstrap: boolean = false): Promise<IDecodedDidcommPayload> {
    const jobEntries = job.content?.body?.data || [];
    const responseEntries: (BundleEntry | ErrorEntry)[] = [];
    for (const entry of jobEntries) {
      try {
        const resultEntry = await this.processRegistrationEntry(
          entry,
          environment,
          job.content?.meta,
          String(job.content?.iss || '').trim() || undefined,
        );
        responseEntries.push(resultEntry);
      } catch (error) {
        if (isBootstrap) { throw error; }
        const errorEntry = this.handleError(error, entry.type, entry.meta);
        responseEntries.push(errorEntry);
      }
    }

    const responseBundle: BundleJsonApi = {
      data: responseEntries,
      resourceType: ResourceTypesFhirR4.Bundle,
      type: getBundleResponseTypeForAction(job.action),
      total: responseEntries.length,
    };

    const issuerDid = composeHostDidWebId(this.config.apiBaseUrl, this.config.hostExternalDomain);

    return {
      jti: uuidv4(),
      type: 'hosting-response',
      thid: job.content?.thid as string,
      iss: issuerDid,
      aud: job.content?.iss as string,
      exp: Math.floor(Date.now() / 1000) + 300,
      body: responseBundle,
    };
  }

  /**
   * Handles Phase 1, Step 2: Finalizing Registration via Order.
   */
  private async processOrder(job: JobRequest, environment?: string): Promise<IDecodedDidcommPayload> {
    const jobEntries = job?.content?.body?.data || [];
    const responseEntries: (BundleEntry | ErrorEntry)[] = [];

    for (const entry of jobEntries) {
      try {
        const resultEntry = await this.processOrderEntry(entry, environment);
        responseEntries.push(resultEntry);
      } catch (error) {
        const errorEntry = this.handleError(error, entry.type, entry.meta);
        responseEntries.push(errorEntry);
      }
    }

    const responseBundle: BundleJsonApi = {
      data: responseEntries,
      resourceType: ResourceTypesFhirR4.Bundle,
      type: getBundleResponseTypeForAction(job.action),
      total: responseEntries.length,
    };

    const issuerDid = composeHostDidWebId(this.config.apiBaseUrl, this.config.hostExternalDomain);

    return {
      jti: uuidv4(),
      type: 'hosting-response',
      thid: job.content?.thid as string,
      iss: issuerDid,
      aud: job.content?.iss as string,
      exp: Math.floor(Date.now() / 1000) + 300,
      body: responseBundle,
    };
  }
  
  /**
   * Processes an Order entry to finalize a tenant's registration.
   *
   * Minimum gateway-enforced input claims:
   * - `HOST_ORDER_REQUIRED_INPUT_CLAIMS`
   */
  private async processOrderEntry(entry: BundleEntry, environment?: string): Promise<BundleEntry | ErrorEntry> {
    return processHostOrderEntry({
      entry,
      environment,
      vaultRepository: this.vaultRepository,
      kmsService: this.kmsService,
      logger: this.logger,
      config: this.config,
      hostRuntime: this.hostRuntime,
      offerOrderService: this.offerOrderService,
      extractResources: this.extractResources.bind(this),
      extractContainedService: this.extractContainedService.bind(this),
      finalizeTenantConfig: this.finalizeTenantConfig.bind(this),
      isLedgerRegistrationEnabled: this.isLedgerRegistrationEnabled.bind(this),
      extractServiceEvidence: this.extractServiceEvidence.bind(this),
      buildControllerEntityConfig: this.buildControllerEntityConfig.bind(this),
      storeControllerEntityConfig: this.storeControllerEntityConfig.bind(this),
      getCurrentUrnNetwork: this.getCurrentUrnNetwork.bind(this),
    });
  }

  /**
   * Processes a new organization registration entry, creating a provisional record.
   */
  private async processRegistrationEntry(
    entry: BundleEntry,
    environment?: string,
    jobMeta?: DidCommDecodedMetadata,
    registrationControllerDid?: string,
  ): Promise<BundleEntry | ErrorEntry> {
    return processRegistrationEntryExternal({
      entry,
      environment,
      jobMeta,
      registrationControllerDid,
      sectorsAllowed: this.config.sectorsAllowed,
      vaultRepository: this.vaultRepository,
      applyLegalOrganizationIdentityCompatibility: this.applyLegalOrganizationIdentityCompatibility.bind(this),
      extractResources: this.extractResources.bind(this),
      handleServiceAttachment: this._handleServiceAttachment.bind(this),
      persistHostConfig: this.persistHostConfig.bind(this),
      createPendingTenantRegistrationFromClaims: this.createPendingTenantRegistrationFromClaims.bind(this),
      handleError: this.handleError.bind(this),
    });
  }

  private handleError(error: any, entryType: string = 'unknown', meta?: any): ErrorEntry {
    if (error instanceof ManagerError) {
      return {
        type: entryType,
        ...canonicalizeBundleEntryMetadata(meta),
        response: {
          status: error.status,
          outcome: createOperationOutcome(IssueLevel.Error, error.code, error.message),
        },
      };
    } else {
      this.logger.error('Unexpected error during registration processing:', error);
      return {
        type: entryType,
        ...canonicalizeBundleEntryMetadata(meta),
        response: {
          status: String(HttpStatusCodes.InternalServerError),
          outcome: createOperationOutcome(IssueLevel.Error, IssueType.Exception, 'An unexpected internal server error occurred.'),
        },
      };
    }
  }

  private async persistHostConfig(
    org: IncludedResource,
    allClaims: ClaimsRecord,
    contained: Array<IncludedResource | undefined>,
  ) {
    return persistHostConfigExternal({
      org,
      allClaims,
      contained,
      config: this.config,
      hostRuntime: this.hostRuntime,
      vaultRepository: this.vaultRepository,
      kmsService: this.kmsService,
      logger: this.logger,
      isLedgerRegistrationEnabled: this.isLedgerRegistrationEnabled.bind(this),
      extractContainedService: this.extractContainedService.bind(this),
      extractServiceEvidence: this.extractServiceEvidence.bind(this),
    });
  }

  public async ensureAuthorityTenant(params: {
    alternateName: string;
    role: 'ica' | 'ca';
    externalDomain?: string;
  }): Promise<void> {
    await ensureAuthorityTenantExternal({
      ...params,
      config: this.config,
      hostRuntime: this.hostRuntime,
      vaultRepository: this.vaultRepository,
      kmsService: this.kmsService,
      getCurrentUrnNetwork: this.getCurrentUrnNetwork.bind(this),
    });
  }

  /**
   * Finalizes a tenant's configuration, saves it, and grants initial 'test' network access.
   */
  private async persistTenantConfig(
    org: IncludedResource,
    altName: string,
    allClaims: ClaimsRecord,
    contained: Array<IncludedResource | undefined>,
    sector: Sector,
  ) {
    return persistTenantConfigExternal({
      org,
      altName,
      allClaims,
      contained,
      sector,
      vaultRepository: this.vaultRepository,
      kmsService: this.kmsService,
      hostRuntime: this.hostRuntime,
      finalizeTenantConfig: this.finalizeTenantConfig.bind(this),
    });
  }

  /**
   * Generates the final tenant configuration, including DIDs and VCs.
   */
  private async finalizeTenantConfig(
    org: IncludedResource,
    altName: string,
    allClaims: ClaimsRecord,
    sector: Sector,
    vaultId: string,
    options?: {
      primaryDid?: string;
      publicTenantUrl?: string;
      operationalTenantUrl?: string;
      governanceVc?: VerifiableCredentialV2;
      networkName?: NetworkName;
      controllerDid?: string;
      controllerDidDocument?: DidDocument;
    },
  ): Promise<OrganizationConfig> {
    return finalizeTenantConfigExternal({
      org,
      altName,
      allClaims,
      sector,
      vaultId,
      options,
      config: this.config,
      kmsService: this.kmsService,
      buildTenantAlsoKnownAs: this.buildTenantAlsoKnownAs.bind(this),
      getCurrentUrnNetwork: this.getCurrentUrnNetwork.bind(this),
      getOperationalServiceBaseUrl: this.getOperationalServiceBaseUrl.bind(this),
      isDemoSecurityMode: this.isDemoSecurityMode.bind(this),
      logger: this.logger,
      serviceAdditionalTypeClaim: SERVICE_ADDITIONAL_TYPE_CLAIM,
    });
  }

  private async _handleServiceAttachment(service?: IncludedResource): Promise<IncludedResource | undefined> {
    return handleServiceAttachment({
      service,
      logger: this.logger,
      storageAdapter: this.storageAdapter,
    });
  }

  private async requestIcaEnrollment(params: { organizationClaims: ClaimsRecord; evidence?: PdfSignatureEvidence[]; tenantVaultId: string }) {
    return requestIcaEnrollmentExternal({
      ...params,
      config: this.config,
      logger: this.logger,
      vaultRepository: this.vaultRepository,
      kmsService: this.kmsService,
    });
  }

  private async pollIcaResult(url: string): Promise<any | undefined> {
    return pollIcaResultExternal({ url });
  }

  private async storeIcaMessage(tenantVaultId: string, resultResource: any): Promise<void> {
    return storeIcaMessageExternal({
      tenantVaultId,
      resultResource,
      kmsService: this.kmsService,
      vaultRepository: this.vaultRepository,
    });
  }

  private isLedgerRegistrationEnabled(): boolean {
    return shouldUseFabricLedger({
      ...process.env,
      NETWORK_MODE: this.config.networkMode,
      LEDGER_ENABLED: typeof this.config.ledger?.enabled === 'boolean'
        ? String(this.config.ledger.enabled)
        : process.env.LEDGER_ENABLED,
    });
  }

  private extractContainedService(
    contained?: Array<IncludedResource | undefined> | undefined,
  ): IncludedResource | undefined {
    return extractContainedServiceResource(contained);
  }

  private extractServiceEvidence(service?: IncludedResource): PdfSignatureEvidence[] | undefined {
    return extractServiceEvidenceList(service);
  }

  private extractResources(claims: ClaimsRecord, environment?: string) {
    return extractResourcesFromClaims(claims, environment);
  }
}

function parseOrganizationAuthorizationSigners(raw: string | undefined): Array<{
  issuer: string;
  actorDid: string;
  role: string;
  jwkThumbprints: string[];
  status?: 'active' | 'revoked';
}> {
  if (!raw?.trim()) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) throw new Error('not_an_array');
    return parsed.map((entry: any) => {
      const status: 'active' | 'revoked' = entry?.status === 'revoked' ? 'revoked' : 'active';
      const normalized = {
        issuer: String(entry?.issuer || '').trim(),
        actorDid: String(entry?.actorDid || '').trim(),
        role: String(entry?.role || '').trim(),
        jwkThumbprints: Array.isArray(entry?.jwkThumbprints)
          ? entry.jwkThumbprints.map((value: unknown) => String(value).trim()).filter(Boolean)
          : [],
        status,
      };
      if (!normalized.issuer || !normalized.actorDid || !normalized.role
        || normalized.jwkThumbprints.length === 0) {
        throw new Error('missing_required_signer_field');
      }
      return normalized;
    });
  } catch (error) {
    throw new ManagerError(
      `HOST_ORGANIZATION_AUTHORIZATION_SIGNERS is invalid: ${(error as Error).message}`,
      IssueType.Invalid,
    );
  }
}
