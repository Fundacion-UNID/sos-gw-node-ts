// src/managers/TenantsCacheManager.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

import { IKmsService } from '../gdc-backend-utils-node/models/IKmsService';
import { ITenantsManager } from './ITenantsManager';
import { IPrivilegedTenantRegistry } from './IPrivilegedTenantRegistry';
import { IDiscoveryTenantRegistry } from './IDiscoveryTenantRegistry';
import { IHostingTenantRegistry } from './IHostingTenantRegistry';
import { IApiTenantRegistry } from './IApiTenantRegistry';
import { ILedgerTenantRegistry } from './ILedgerTenantRegistry';
import { IVaultRepository } from '../database/repositories/vault/vault.repository';
import { ConfidentialStorageDoc } from 'gdc-common-utils-ts/models/confidential-storage';
import {
  getIdentifierUrnFromClaims,
  generateTenantCollectionNameFromClaims,
  resolveOrganizationRouteJurisdiction,
} from '../utils/tenant';
import { DidDocument, DidService, VerificationMethod } from '../gdc-backend-utils-node/models/did';
import { ClaimsOrganizationSchemaorg, ClaimsServiceSchemaorg } from 'gdc-common-utils-ts/constants/schemaorg';
import { Sector } from 'gdc-common-utils-ts/models/urlPath';
import { getBaseUrlFromDidWeb, normalizeDidDocumentKeyRelationships } from '../utils/did-backend';
import { parseTenantUrn } from '../utils/urn';
import { getEnvSectionId } from '../utils/section-env';
import { getTenantAuthorizationStatus, isTenantAuthorizationOperational, TenantAuthorizationLifecycleStatus } from '../utils/tenant-lifecycle';
import { hasProviderServiceCapabilityClaim } from '../utils/services';
import { getTenantServiceCapabilityClaim } from '../utils/service-capability-claims';
import { initializeTenantServicesConfig } from '../utils/services';
import { resolveLedgerOrganizationId } from '../utils/ledger-organization-registration-helpers';
import { normalizePublicAliasList } from 'gdc-common-utils-ts/utils/same-as';

const SERVICE_OPERATIONAL_URL_CLAIM = 'org.schema.Service.url';

function getDidDocumentServiceEndpointBaseUrl(didDocument: DidDocument | undefined, suffix: string): string | undefined {
  const endpoint = didDocument?.service?.find((service) => service.id === `${didDocument.id}${suffix}`)?.serviceEndpoint as string | undefined;
  if (!endpoint || typeof endpoint !== 'string') {
    return undefined;
  }
  const parsed = new URL(endpoint);
  const normalizedPath = suffix === '#did-document'
    ? parsed.pathname.replace(/\/\.well-known\/did\.json$/, '')
    : parsed.pathname.replace(/\/jwks\.json$/, '');
  return `${parsed.protocol}//${parsed.host}${normalizedPath}`.replace(/\/$/, '');
}

function getTenantServiceClaim(tenantConfig: any, claimName: string): string | undefined {
  const topLevelClaim = tenantConfig?.claims?.[claimName];
  if (typeof topLevelClaim === 'string' && topLevelClaim.trim()) {
    return topLevelClaim;
  }
  const providerClaim = tenantConfig?.provider?.service?.[claimName];
  if (typeof providerClaim === 'string' && providerClaim.trim()) {
    return providerClaim;
  }
  return undefined;
}

type TenantRuntimeView = {
  collectionName?: string;
  didDocument?: DidDocument;
  didServiceConfig?: DidService[];
  tenantIdentifierUrn?: string;
  organizationIdentifierUrn?: string;
  legacySignAlg?: string;
  tenantAuthorizationStatus?: TenantAuthorizationLifecycleStatus;
  isTenantOperational: boolean;
  jurisdiction?: string;
  alternateName?: string;
  domainUrl?: string;
  operationalUrl?: string;
  sector?: Sector;
  serviceCapabilityClaim?: string;
};

/**
 * In-memory runtime cache for tenant registry metadata.
 *
 * Design intent:
 * - cache only a sanitized runtime projection for general reads
 * - keep ordinary runtime flows off the tenant registry after first load
 * - avoid exposing full tenant registration/configuration objects except
 *   through explicit privileged methods
 *
 * Source-of-truth rule:
 * - this cache is never the primary source of truth
 * - privileged write flows must persist to storage first
 * - only after a successful write may callers refresh or update cached runtime
 *   metadata
 *
 * Security rule:
 * - the runtime cache should contain only derived, non-secret tenant metadata
 * - future secrets such as DB credentials, seeds, or key regeneration material
 *   must not be added to `TenantRuntimeView`
 */
export class TenantsCacheManager implements ITenantsManager, IPrivilegedTenantRegistry, IDiscoveryTenantRegistry, IHostingTenantRegistry, IApiTenantRegistry, ILedgerTenantRegistry {
  private vaultRepository: IVaultRepository;
  private kmsServiceResolver: () => IKmsService;
  private hostCollectionName: string; // The physical collection name for the host
  private tenantRuntimeCacheByVaultId = new Map<string, TenantRuntimeView>();
  private get kmsService(): IKmsService {
    return this.kmsServiceResolver();
  }

  private withHydratedDidServiceConfig(tenantConfig: any): any {
    const alternateName = String(
      tenantConfig?.claims?.[ClaimsOrganizationSchemaorg.alternateName]
      || tenantConfig?.claims?.alternateName
      || '',
    ).trim().toLowerCase();
    if (alternateName === 'host') {
      return tenantConfig;
    }

    const sector =
      tenantConfig?.provider?.service?.sectorCategory
      || tenantConfig?.claims?.[ClaimsServiceSchemaorg.category]
      || undefined;
    const existingServices = Array.isArray(tenantConfig?.didConfig?.service)
      ? tenantConfig.didConfig.service
      : [];

    if (!sector) {
      return tenantConfig;
    }

    const defaultServices = initializeTenantServicesConfig(String(sector) as Sector);
    const mergedServices = [...existingServices];
    const seen = new Set(
      existingServices.map((service: any) =>
        JSON.stringify({
          selector: service?.selector || null,
          type: service?.type || null,
          serviceEndpoint: service?.serviceEndpoint || '',
          actions: service?.actions || [],
        }),
      ),
    );

    for (const service of defaultServices) {
      const key = JSON.stringify({
        selector: service?.selector || null,
        type: service?.type || null,
        serviceEndpoint: service?.serviceEndpoint || '',
        actions: service?.actions || [],
      });
      if (!seen.has(key)) {
        mergedServices.push(service);
        seen.add(key);
      }
    }

    return {
      ...tenantConfig,
      didConfig: {
        ...(tenantConfig?.didConfig || {}),
        service: mergedServices,
      },
    };
  }

  constructor(
    vaultRepository: IVaultRepository, 
    kmsServiceResolver: () => IKmsService,
    hostCollectionName: string,
  ) {
    this.vaultRepository = vaultRepository;
    this.kmsServiceResolver = kmsServiceResolver;
    this.hostCollectionName = hostCollectionName;
  }

  /**
   * Proactively loads the `host` runtime view into cache at startup.
   *
   * This is an optimization only. If omitted, host metadata will still load
   * lazily on first access.
   */
  public async loadHost(): Promise<void> {
    await this._ensureTenantIsInCache('host');
  }


  /**
   * Loads and decrypts the full tenant registration from the host registry.
   *
   * @security
   * This method is intentionally broader than ordinary runtime lookups. It is
   * used only to derive a safe runtime view or to satisfy explicit privileged
   * control-plane reads.
   *
   * @architecture
   * The repository reads the physical host registry collection. This manager is
   * still responsible for knowing where that registry lives.
   */
  private async loadFullTenantConfig(vaultId: string): Promise<any | undefined> {
    const secureTenantRecord = await this.vaultRepository.get<ConfidentialStorageDoc>(this.hostCollectionName, vaultId, getEnvSectionId('tenants'));
    if (!secureTenantRecord) {
      return undefined;
    }

    try {
      const tenantConfig = await this.kmsService.unprotectConfidentialData<any>(secureTenantRecord, 'host');
      if (!tenantConfig?.claims) {
        console.error(`[TenantsCacheManager] Decrypted record for vaultId '${vaultId}' is invalid or missing claims.`);
        return undefined;
      }

      tenantConfig.collectionName = vaultId === 'host'
        ? this.hostCollectionName
        : generateTenantCollectionNameFromClaims(tenantConfig.claims);
      if (tenantConfig.didDocument) {
        tenantConfig.didDocument = normalizeDidDocumentKeyRelationships(tenantConfig.didDocument);
      }
      return this.withHydratedDidServiceConfig(tenantConfig);
    } catch (error) {
      console.error(`[TenantsCacheManager] Failed to decrypt tenant record for vaultId '${vaultId}'.`, error);
      return undefined;
    }
  }

  private toRuntimeView(tenantConfig: any): TenantRuntimeView {
    const tenantIdentifierUrn = getIdentifierUrnFromClaims(tenantConfig?.claims);
    let organizationIdentifierUrn: string | undefined;
    try {
      organizationIdentifierUrn = resolveLedgerOrganizationId(tenantConfig?.claims);
    } catch {
      organizationIdentifierUrn = undefined;
    }
    return {
      collectionName: tenantConfig?.collectionName,
      didDocument: tenantConfig?.didDocument,
      didServiceConfig: tenantConfig?.didConfig?.service,
      tenantIdentifierUrn,
      organizationIdentifierUrn,
      legacySignAlg: tenantConfig?.legacySignAlg as string | undefined,
      tenantAuthorizationStatus: tenantConfig ? getTenantAuthorizationStatus(tenantConfig) : undefined,
      isTenantOperational: tenantConfig ? isTenantAuthorizationOperational(tenantConfig) : false,
      jurisdiction: tenantConfig?.claims
        ? resolveOrganizationRouteJurisdiction(tenantConfig.claims)
        : undefined,
      alternateName: tenantConfig?.claims?.[ClaimsOrganizationSchemaorg.alternateName] as string | undefined,
      domainUrl: getTenantServiceClaim(tenantConfig, ClaimsOrganizationSchemaorg.url),
      operationalUrl: getTenantServiceClaim(tenantConfig, SERVICE_OPERATIONAL_URL_CLAIM),
      sector: parseTenantUrn(tenantIdentifierUrn || '')?.sector as Sector | undefined,
      serviceCapabilityClaim: getTenantServiceCapabilityClaim(tenantConfig),
    };
  }

  /**
   * Returns a cached runtime view when present, otherwise loads it once from
   * storage and stores the sanitized projection in memory.
   *
   * Ordinary runtime callers should reach tenant metadata through this path.
   */
  private async _ensureTenantIsInCache(vaultId: string): Promise<TenantRuntimeView | undefined> {
    // 1. Check the cache first.
    const runtimeView = this.tenantRuntimeCacheByVaultId.get(vaultId);
    if (runtimeView) {
      return runtimeView;
    }

    const tenantConfig = await this.loadFullTenantConfig(vaultId);
    if (!tenantConfig) {
      return undefined;
    }

    const nextRuntimeView = this.toRuntimeView(tenantConfig);
    this.tenantRuntimeCacheByVaultId.set(vaultId, nextRuntimeView);
    return nextRuntimeView;
  }

  /**
   * Reads the full tenant registration/configuration object.
   *
   * @warning
   * This is a privileged control-plane read. It should not be used by ordinary
   * runtime flows that only need derived metadata.
   *
   * Cache behavior:
   * - reads the current storage-backed registration
   * - refreshes the sanitized runtime view after a successful read
   */
  public async getTenant(vaultId: string): Promise<any | undefined> {
    const tenantConfig = await this.loadFullTenantConfig(vaultId);
    if (!tenantConfig) {
      return undefined;
    }
    this.tenantRuntimeCacheByVaultId.set(vaultId, this.toRuntimeView(tenantConfig));
    return tenantConfig;
  }

  public async tenantExists(vaultId: string): Promise<boolean> {
    return (await this._ensureTenantIsInCache(vaultId)) !== undefined;
  }

  /**
   * Invalidates a tenant runtime entry and reloads it from storage.
   *
   * Use this after a successful write to the tenant registration, never as a
   * substitute for persisting the write itself.
   */
  public async refreshTenant(vaultId: string): Promise<any | undefined> {
    this.tenantRuntimeCacheByVaultId.delete(vaultId);
    return await this.getTenant(vaultId);
  }

  /**
   * Resolves the canonical tenant vault id from an organization identifier value
   * (e.g. VAT/TAX id stored in `Organization.identifier.value`).
   */
  public async findTenantVaultIdByIdentifierValue(identifierValue: string): Promise<string | undefined> {
    const matches = await this.findTenantVaultIdsByIdentifierValue(identifierValue);
    return matches[0];
  }

  /**
   * Resolves exact hosted tenant registrations for one legal identifier. The
   * legal identifier locates the organization; `tenantDid` selects the public
   * sector/provider binding and prevents cross-sector lifecycle mutations.
   */
  public async findTenantVaultIdsByIdentifierValue(
    identifierValue: string,
    constraints: Readonly<{
      identifierType?: string;
      tenantDid?: string;
    }> = {},
  ): Promise<string[]> {
    const target = String(identifierValue || '').trim();
    if (!target || target.toLowerCase() === 'host') return [];

    const hostConfig = await this.getTenant('host');
    const hostIdentifierValue = String(hostConfig?.claims?.[ClaimsOrganizationSchemaorg.identifierValue] || '').trim();
    if (hostIdentifierValue && hostIdentifierValue === target) {
      return ['host'];
    }

    const results = await this.vaultRepository.query(
      this.hostCollectionName,
      { sectionId: getEnvSectionId('tenants'), where: [{ name: ClaimsOrganizationSchemaorg.identifierValue, value: target }] },
      { hydrate: false },
    );
    const expectedIdentifierType = String(constraints.identifierType || '').trim().toLowerCase();
    const expectedTenantDid = String(constraints.tenantDid || '').trim();
    const matches: string[] = [];

    for (const result of results) {
      const vaultId = String(result?.id || '').trim();
      if (!vaultId) continue;
      const tenantConfig = await this.getTenant(vaultId);
      const claims = tenantConfig?.claims || {};
      if (expectedIdentifierType
        && String(claims[ClaimsOrganizationSchemaorg.identifierType] || '').trim().toLowerCase() !== expectedIdentifierType) {
        continue;
      }
      if (expectedTenantDid) {
        const tenantDids = normalizePublicAliasList([
          String(tenantConfig?.didDocument?.id || ''),
          ...(Array.isArray(tenantConfig?.didDocument?.alsoKnownAs)
            ? tenantConfig.didDocument.alsoKnownAs.map(String)
            : []),
          ...normalizePublicAliasList(claims[ClaimsOrganizationSchemaorg.sameAs] as string | string[] | undefined),
        ]);
        if (!tenantDids.includes(expectedTenantDid)) continue;
      }
      matches.push(vaultId);
    }

    return [...new Set(matches)];
  }

  /**
   * Returns all tenant configurations currently registered in the host tenant registry.
   * This is intended for operator-level discovery/catalog publication flows.
   */
  public async listRegisteredTenants(): Promise<any[]> {
    const tenantsSection = getEnvSectionId('tenants');
    const records = await this.vaultRepository.getContainersInSection<ConfidentialStorageDoc>(this.hostCollectionName, tenantsSection);
    const tenants: any[] = [];

    for (const record of records) {
      try {
        const config = await this.kmsService.unprotectConfidentialData<any>(record, 'host');
        if (!config?.claims || !config?.didDocument?.id) continue;
        config.didDocument = normalizeDidDocumentKeyRelationships(config.didDocument);
        const collectionName = generateTenantCollectionNameFromClaims(config.claims);
        config.collectionName = collectionName;
        const vaultId = record.id;
        const hydrated = this.withHydratedDidServiceConfig(config);
        this.tenantRuntimeCacheByVaultId.set(vaultId, this.toRuntimeView(hydrated));
        tenants.push(hydrated);
      } catch {
        // Skip malformed/unreadable tenant records in discovery output.
      }
    }
    return tenants;
  }

  /**
   * Returns only tenants that are both operational and provider-capable.
   * This is the discovery surface used by host autodiscovery catalogs.
   */
  public async listAutodiscoverableTenants(): Promise<any[]> {
    const tenants = await this.listRegisteredTenants();
    return tenants.filter((tenant) => {
      const serviceCapabilityClaim = getTenantServiceCapabilityClaim(tenant);
      return isTenantAuthorizationOperational(tenant) && hasProviderServiceCapabilityClaim(serviceCapabilityClaim);
    });
  }

  /**
   * Retrieves the physical collection name for a given logical vaultId.
   * This is the primary method for business managers to resolve the storage location for a tenant.
   * @param vaultId The unique vault identifier for the tenant (e.g., 'host', 'health-care_acme').
   * @returns The tenant's physical collection name (e.g., 'host', 'ES_TAX_B12345..._health-care'), or `undefined` if not found.
   */
  public async getCollectionName(vaultId: string): Promise<string | undefined> {
    const tenantConfig = await this._ensureTenantIsInCache(vaultId);
    return tenantConfig?.collectionName;
  }

  public async getTenantAuthorizationStatus(vaultId: string): Promise<TenantAuthorizationLifecycleStatus | undefined> {
    const tenantRuntime = await this._ensureTenantIsInCache(vaultId);
    if (!tenantRuntime) {
      return undefined;
    }
    return tenantRuntime.tenantAuthorizationStatus;
  }

  public async isTenantOperational(vaultId: string): Promise<boolean> {
    const tenantRuntime = await this._ensureTenantIsInCache(vaultId);
    if (!tenantRuntime) {
      return false;
    }
    return tenantRuntime.isTenantOperational;
  }

  /**
   * Finds a tenant in the cache by their full DID identifier.
   * @param did The `did:web:...` identifier of the tenant.
   * @returns The tenant's configuration object, or `undefined` if no tenant matches the DID.
   */
  // TODO: Refactor findTenantByDid for the new async, on-demand caching architecture.
  // This synchronous implementation is no longer reliable as it only searches tenants already in the cache.
  public findTenantByDid(did: string): any | undefined {
    // for (const tenantConfig of this.tenantCacheByVaultId.values()) {
    //   if (tenantConfig.didDocument?.id === did) {
    //     return tenantConfig;
    //   }
    // }
    return undefined;
  }

  /**
   * Finds a tenant in the cache where the tenant's DID is a prefix of the provided DID.
   * This is used to resolve an employee or individual's DID back to their parent tenant
   * when the DID is from an external domain.
   * @param did The `did:web:...` identifier of the entity (e.g., an employee).
   * @returns The tenant's configuration object, or `undefined` if no tenant matches.
   */
  // TODO: Refactor findTenantByDidPrefix for the new async, on-demand caching architecture.
  // This synchronous implementation is no longer reliable as it only searches tenants already in the cache.
  public findTenantByDidPrefix(did: string): any | undefined {
    // // Find the tenant whose DID is the longest matching prefix of the given DID.
    // let bestMatch: any | undefined;
    // let longestPrefix = 0;

    // for (const tenantConfig of this.tenantCacheByVaultId.values()) {
    //   const tenantDid = tenantConfig.didDocument?.id;
    //   if (tenantDid && did.startsWith(tenantDid)) {
    //     if (tenantDid.length > longestPrefix) {
    //       longestPrefix = tenantDid.length;
    //       bestMatch = tenantConfig;
    //     }
    //   }
    // }
    // return bestMatch;
    return undefined;
  }

  /**
   * Adds a new verification method (e.g., a public key) to a tenant's cached DID document.
   * This is used when an employee is registered to make their keys discoverable via the tenant's DID.
   * @param vaultId The vault ID of the tenant to modify.
   * @param verificationMethod The verification method object to add.
   */
  public addVerificationMethodToTenant(vaultId: string, verificationMethod: VerificationMethod): void {
    const tenantRuntime = this.tenantRuntimeCacheByVaultId.get(vaultId);
    if (tenantRuntime?.didDocument) {
      if (!tenantRuntime.didDocument.verificationMethod) {
        tenantRuntime.didDocument.verificationMethod = [];
      }
      tenantRuntime.didDocument.verificationMethod.push(verificationMethod);
      this.tenantRuntimeCacheByVaultId.set(vaultId, tenantRuntime);
    } else {
      console.warn(`[TenantsCacheManager] Could not add verification method: Tenant with vaultId '${vaultId}' not found in cache.`);
    }
  }

  /**
   * Retrieves the canonical URN for a tenant from its cached claims.
   * @param vaultId The unique vault identifier for the tenant.
   * @returns The URN string, or `undefined` if not found.
   */
  public async getTenantIdentifierUrn(vaultId: string): Promise<string | undefined> {
    const tenantConfig = await this._ensureTenantIsInCache(vaultId);
    return tenantConfig?.tenantIdentifierUrn;
  }

  public async getOrganizationIdentifierUrn(vaultId: string): Promise<string | undefined> {
    const tenantConfig = await this._ensureTenantIsInCache(vaultId);
    return tenantConfig?.organizationIdentifierUrn;
  }

  public async getDidDocument(vaultId: string): Promise<DidDocument | undefined> {
    const tenantConfig = await this._ensureTenantIsInCache(vaultId);
    return tenantConfig?.didDocument;
  }

  public async getDidServiceConfig(vaultId: string): Promise<DidService[] | undefined> {
    const tenantConfig = await this._ensureTenantIsInCache(vaultId);
    return tenantConfig?.didServiceConfig;
  }

  /**
   * Retrieves the published legacy signing algorithm from cached runtime
   * metadata when present.
   */
  public async getLegacySignAlg(vaultId: string): Promise<string | undefined> {
    const tenantRuntime = await this._ensureTenantIsInCache(vaultId);
    return tenantRuntime?.legacySignAlg;
  }

  /**
   * Retrieves the cached DID identifier (`did:web:...`) for a given tenant.
   * @param vaultId The unique vault identifier for the tenant.
   * @returns The DID string, or `undefined` if the tenant is not found in the cache.
   */
  public async getTenantDid(vaultId: string): Promise<string | undefined> {
    const tenantConfig = await this._ensureTenantIsInCache(vaultId);
    return tenantConfig?.didDocument?.id;
  }

  /**
   * Retrieves the cached claims for a given entity configuration.
   * Note: In this manager, it specifically resolves tenant entities.
   * @param vaultId The unique vault identifier for the tenant.
   * @returns The claims object, or `undefined` if not found.
   */
  public async getEntityClaims(vaultId: string): Promise<any | undefined> {
    const tenantConfig = await this.getTenant(vaultId);
    return tenantConfig?.claims;
  }

  /**
   * Retrieves the cached sector for a given tenant by parsing its canonical URN.
   * @param vaultId The unique vault identifier for the tenant.
   * @returns The sector, or `undefined` if the tenant is not found or the URN is malformed.
   */
  public async getTenantSector(vaultId: string): Promise<Sector | undefined> {
    const urn = await this.getTenantIdentifierUrn(vaultId);
    if (!urn) return undefined;
    
    const parsedUrn = parseTenantUrn(urn);
    return parsedUrn?.sector as Sector;
  }

  /**
   * Retrieves the cached jurisdiction for a given tenant from its claims.
   * @param vaultId The unique vault identifier for the tenant.
   * @returns The jurisdiction string (e.g., 'es'), or `undefined` if not found.
   */
  public async getTenantJurisdiction(vaultId: string): Promise<string | undefined> {
    const tenantConfig = await this._ensureTenantIsInCache(vaultId);
    return tenantConfig?.jurisdiction;
  }

  /**
   * Retrieves the canonical service URL for a tenant.
   * It prioritizes the tenant's specified external domain (`url` claim) if it exists.
   * If not, it constructs and returns the fallback hosted URL on the gateway.
   * @param vaultId The unique vault identifier for the tenant.
   * @returns The tenant's service URL, or undefined if the tenant is not found.
   */
  public async getTenantDomainUrl(vaultId: string): Promise<string | undefined> {
    if (vaultId === 'host') {
      const hostDidDoc = await this.getDidDocument('host');
      return getDidDocumentServiceEndpointBaseUrl(hostDidDoc, '#did-document')
        || (hostDidDoc ? getBaseUrlFromDidWeb(hostDidDoc.id) : undefined);
    }

    const tenantConfig = await this._ensureTenantIsInCache(vaultId);
    if (!tenantConfig) {
      return undefined;
    }
    
    const externalUrl = tenantConfig.domainUrl;
    if (externalUrl) {
      return externalUrl.startsWith('http') ? externalUrl : `https://${externalUrl}`;
    }
    return await this.constructHostedUrl(tenantConfig);
  }

  /**
   * Retrieves the operational base URL for a tenant.
   * This URL is intended for direct API invocation (`didDocument.service[].serviceEndpoint`).
   */
  public async getTenantOperationalUrl(vaultId: string): Promise<string | undefined> {
    if (vaultId === 'host') {
      const hostDidDoc = await this.getDidDocument('host');
      return getDidDocumentServiceEndpointBaseUrl(hostDidDoc, '#did-document')
        || (hostDidDoc ? getBaseUrlFromDidWeb(hostDidDoc.id) : undefined);
    }

    const tenantConfig = await this._ensureTenantIsInCache(vaultId);
    if (!tenantConfig) {
      return undefined;
    }

    const operationalUrl = tenantConfig.operationalUrl;
    if (typeof operationalUrl === 'string' && operationalUrl.trim()) {
      return operationalUrl.startsWith('http') ? operationalUrl : `https://${operationalUrl}`;
    }

    return await this.constructHostedUrl(tenantConfig);
  }

  /**
   * Constructs the full hosted URL for a tenant based on its configuration.
   * @param config The full tenant configuration object from the cache.
   */
  private async constructHostedUrl(config: TenantRuntimeView): Promise<string | undefined> {
    const hostDidDoc = await this.getDidDocument('host');
    if (!hostDidDoc) {
      console.error('[TenantsCacheManager] Cannot construct hosted URL: Host DID document not found in cache.');
      return undefined;
    }

    const baseUrl = getBaseUrlFromDidWeb(hostDidDoc.id);
    const hostPublicBaseUrl = getDidDocumentServiceEndpointBaseUrl(hostDidDoc, '#did-document') || baseUrl;

    const alternateName = config.alternateName;
    const parsedUrn = config.tenantIdentifierUrn ? parseTenantUrn(config.tenantIdentifierUrn) : null;

    if (!alternateName || !parsedUrn?.jurisdiction || !parsedUrn?.version || !parsedUrn?.sector) {
      console.warn('[TenantsCacheManager] Cannot construct hosted URL: missing alternateName or could not parse URN.');
      return undefined;
    }
    
    return `${hostPublicBaseUrl}/${alternateName}/cds-${parsedUrn.jurisdiction.toLowerCase()}/${parsedUrn.version}/${parsedUrn.sector}`;
  }
}
