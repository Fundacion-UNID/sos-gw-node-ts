// src/routes/discovery.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.
// Always create JSDoc, do not use strings inline in keys nor values, use types instead, and reuse the data test examples.

import * as express from 'express';
import type { IDiscoveryTenantRegistry } from '../managers/IDiscoveryTenantRegistry';
import { DiscoveryService } from '../services/DiscoveryService';
import { getTenantVaultId } from '../utils/tenant';
import { pingHandler } from './handlers/discovery/ping.handler';
import { signVerifiableCredential } from '../utils/vc-signer';
import { findSigningMethod, toPublicJwkSet } from '../utils/did-backend';
import { buildStatusListCredential, buildStatusListEntry, createStatusListEncodedList } from '../utils/status-list';
import { DataspaceWellKnownPaths } from 'gdc-common-utils-ts/constants/dataspace-protocol';
import { ClaimsOrganizationSchemaorg, ClaimsServiceSchemaorg } from 'gdc-common-utils-ts/constants/schemaorg';
import { isEuCountryCode, normalizeCountryCode } from 'gdc-common-utils-ts/constants/eu-countries';
import {
  parseServiceCapabilityTokens,
} from 'gdc-common-utils-ts/constants/service-capabilities';
import {
  getServiceOfferingRole,
  isContinuityProviderCapability,
  type ContinuityServiceCapabilityValue,
  type ServiceOfferingRole,
} from 'sos-data-utils-ts/continuity-service-capabilities';
import {
  buildDspaceVersionMetadata,
  buildGwCatalogArtifactPath,
  buildGwCatalogCollectionPath,
  buildGwCatalogDatasetPath,
  buildGwCatalogRequestPath,
  buildGwDataspaceBasePath,
  buildGwDspaceVersionWellKnownPath,
} from 'gdc-common-utils-ts/utils/dataspace-protocol';
import { getBaseUrlFromDidWeb } from '../utils/did-backend';
import { isFhirSector, isResearchSector } from '../utils/sector';
import { hasProviderServiceCapabilityClaim } from '../utils/services';
import { getTenantServiceCapabilityClaim } from '../utils/service-capability-claims';
import { buildGaiaXServiceOfferingCredentialDraft } from 'gdc-common-utils-ts/convert/schemaorg-to-gaia-x';

import { IKmsService } from '../gdc-backend-utils-node/models/IKmsService';
import { ILogger } from '../loggers/ILogger';
import type { IVaultRepository } from '../database/repositories/vault/vault.repository';
import { TenantStatusService } from '../services/TenantStatusService';
import { CommunicationRequestClaim, DocumentReferenceClaim } from 'fhir-data-utils-ts/claims';
import { PublicAlertOperationalClaim } from 'sos-data-utils-ts/public-notifications';
import { readClaimsOnlyContent, type FlatClaims } from '../utils/fhir-flat-claims';
const STATUS_LIST_BITS = 16384;
const STATUS_LIST_PURPOSE = 'revocation' as const;
const STATUS_LIST_INDEX = 0;

/**
 * Restores the canonical casing of a VAT-based tenant route identifier.
 *
 * Older DID normalizers lowercased every non-final `did:web` path segment, so
 * a canonical tenant such as `VATES-G02793479` could arrive as
 * `vates-g02793479`. Discovery accepts that legacy spelling without changing
 * opaque non-VAT tenant identifiers or the DID document it publishes.
 */
function canonicalizeHostedTenantRouteId(tenantId: string): string {
  const normalized = String(tenantId || '').trim();
  return /^vat[a-z]{2}[-a-z0-9._]+$/i.test(normalized)
    ? normalized.toUpperCase()
    : normalized;
}

/**
 * Creates the router for synchronous, public discovery endpoints.
 * @param tenantsCacheManager Discovery-scoped tenant registry dependency.
 * @param discoveryService The service to generate discovery documents.
 * @param kmsService The service to retrieve cryptographic keys.
 * @param logger The logging service.
 * @returns An Express router.
 */
export function createDiscoveryRouter(
  tenantsCacheManager: IDiscoveryTenantRegistry,
  discoveryService: DiscoveryService,
  kmsService: IKmsService,
  logger: ILogger,
  vaultRepository: IVaultRepository,
): express.Router {
  const router = express.Router();
  const tenantStatusService = new TenantStatusService(tenantsCacheManager, vaultRepository, kmsService);
  const toDatasetId = (publisherDid: string): string => encodeURIComponent(publisherDid);

  type ProviderDataset = {
    datasetId: string;
    publisherDid: string;
    title: string;
    baseUrl: string;
    didDocumentUrl: string;
    operationalUrl: string;
    alternateName?: string;
    sector?: string;
    jurisdiction?: string;
    serviceTypeClaim?: string;
    termsOfService?: string;
    termsOfServiceHash?: string;
  };

  type ServiceOfferingKind = Exclude<ServiceOfferingRole, 'digital-twin'> | 'research';

  type ProviderServiceOffering = {
    id: string;
    kind: ServiceOfferingKind;
    publisherDid: string;
    title: string;
    endpointUrl: string;
    sector?: string;
    jurisdiction?: string;
    serviceTypes: ContinuityServiceCapabilityValue[];
  };

  type NormalizedHostingOperatorDiscoveryMatch = {
    operatorDid: string;
    title?: string;
    discoveryUrl?: string;
    catalogUrl?: string;
    matchedCapabilities: string[];
    record: {
      subjectId: string;
      serviceTypes: string[];
      categories: string[];
      areaServed: string[];
      addressCountry?: string;
      coverageScope?: string;
    };
  };

  type NormalizedPublishedProviderDiscoveryMatch = {
    providerDid: string;
    title?: string;
    hostingOperatorDid: string;
    hostingOperatorTitle?: string;
    discoveryUrl?: string;
    catalogUrl?: string;
    record: {
      providerDid: string;
      serviceType: string;
      category: string;
      areaServed?: string;
      endpointUrl?: string;
      discoveryUrl?: string;
      catalogUrl?: string;
    };
    hostingOperator: NormalizedHostingOperatorDiscoveryMatch['record'];
  };

  const parseCategory = (value: unknown): string => {
    if (typeof value !== 'string') return '';
    const first = value.split(',')[0]?.trim() || '';
    return first;
  };

  const parseJurisdiction = (value: unknown): string => {
    if (typeof value !== 'string') return '';
    return value.trim().toUpperCase();
  };

  const parseAreaServedClaim = (value: unknown): string[] => {
    if (Array.isArray(value)) {
      return Array.from(new Set(value
        .flatMap((entry) => parseAreaServedClaim(entry))
        .map((entry) => entry.trim())
        .filter(Boolean)));
    }
    if (typeof value !== 'string') return [];
    return Array.from(new Set(value.split(',').map((entry) => entry.trim()).filter(Boolean)));
  };

  const inferCoverageScope = (countryCode: string | undefined): string | undefined => {
    const normalized = normalizeCountryCode(countryCode);
    if (!normalized) return undefined;
    return isEuCountryCode(normalized) ? 'EU' : normalized;
  };

  /**
   * Builds the absolute public origin of the current request.
   */
  const buildPublicOrigin = (req: express.Request): string => `${req.protocol}://${req.get('host')}`;

  /**
   * Returns whether the resolved participant is currently allowed to publish
   * discovery/catalog metadata.
   *
   * Lifecycle rule:
   * - DIDs and key material may remain resolvable for auditability
   * - dataspace publication endpoints (`dspace-version`, DCAT, provider listings)
   *   must disappear when the participant authorization is not operational
   */
  const isDiscoveryPublicationOperational = async (vaultId: string): Promise<boolean> =>
    tenantsCacheManager.isTenantOperational(vaultId);

  /**
   * Builds an absolute public URL from a GW CORE path contract.
   */
  const buildAbsoluteUrl = (publicOrigin: string, path: string): string =>
    new URL(path, publicOrigin).toString();

  /**
   * Appends a path suffix to a tenant operational base URL while preserving the
   * tenant-scoped DSP prefix already encoded in that base URL.
   */
  const appendTenantPath = (baseUrl: string, suffix: string): string =>
    `${String(baseUrl).replace(/\/$/, '')}${suffix.startsWith('/') ? suffix : `/${suffix}`}`;

  const getTenantServiceClaim = (tenantConfig: any, claimName: string): string | undefined => {
    const topLevelClaim = tenantConfig?.claims?.[claimName];
    if (typeof topLevelClaim === 'string' && topLevelClaim.trim()) {
      return topLevelClaim;
    }
    const providerClaim = tenantConfig?.provider?.service?.[claimName];
    if (typeof providerClaim === 'string' && providerClaim.trim()) {
      return providerClaim;
    }
    return undefined;
  };

  const toProviderDataset = (tenantConfig: any): ProviderDataset | null => {
    const publisherDid = tenantConfig?.didDocument?.id as string | undefined;
    if (!publisherDid) return null;
    const didDocumentUrl =
      tenantConfig?.didDocument?.service?.find((service: any) => service.id === `${publisherDid}#did-document`)?.serviceEndpoint as string | undefined;
    const title =
      (tenantConfig?.claims?.[ClaimsOrganizationSchemaorg.legalName] as string | undefined) ||
      (tenantConfig?.claims?.[ClaimsOrganizationSchemaorg.name] as string | undefined) ||
      (tenantConfig?.claims?.[ClaimsOrganizationSchemaorg.alternateName] as string | undefined) ||
      publisherDid;
    const baseUrl = didDocumentUrl
      ? didDocumentUrl.replace(/\/\.well-known\/did\.json$/, '')
      : getBaseUrlFromDidWeb(publisherDid);
    const operationalUrl =
      getTenantServiceClaim(tenantConfig, ClaimsServiceSchemaorg.url) ||
      baseUrl;
    const alternateName = (tenantConfig?.claims?.[ClaimsOrganizationSchemaorg.alternateName] as string | undefined)?.trim();
    const sector = parseCategory(getTenantServiceClaim(tenantConfig, ClaimsServiceSchemaorg.category));
    const jurisdiction = parseJurisdiction(tenantConfig?.claims?.[ClaimsOrganizationSchemaorg.addressCountry]);
    const serviceTypeClaim = getTenantServiceCapabilityClaim(tenantConfig);
    return {
      datasetId: toDatasetId(publisherDid),
      publisherDid,
      title,
      baseUrl,
      didDocumentUrl: didDocumentUrl || `${baseUrl}/.well-known/did.json`,
      operationalUrl,
      alternateName,
      sector,
      jurisdiction,
      serviceTypeClaim,
      termsOfService: getTenantServiceClaim(tenantConfig, ClaimsServiceSchemaorg.termsOfService),
      termsOfServiceHash: getTenantServiceClaim(tenantConfig, `${ClaimsServiceSchemaorg.termsOfService}#hash`),
    };
  };

  const buildTenantContextPath = (dataset: ProviderDataset): string | undefined => {
    if (!dataset.alternateName || !dataset.sector || !dataset.jurisdiction) {
      return undefined;
    }
    return `/${dataset.alternateName}/cds-${dataset.jurisdiction.toLowerCase()}/v1/${dataset.sector}`;
  };

  const buildServiceOfferingUrl = (
    publicOrigin: string,
    dataset: ProviderDataset,
    kind: ServiceOfferingKind,
  ): string => {
    const contextualPath = buildTenantContextPath(dataset);
    if (contextualPath) {
      return `${publicOrigin}${contextualPath}/.well-known/service-offering-${kind}.json`;
    }
    return `${dataset.baseUrl}/.well-known/service-offering-${kind}.json`;
  };

  const buildServiceOfferingTypeLabel = (kind: ServiceOfferingKind): string =>
    kind === 'index'
      ? 'Index'
      : kind === 'personal-backup'
        ? 'Personal Backup'
        : 'Research Digital Twin';

  const resolveDefaultOfferingKinds = (dataset: ProviderDataset): ServiceOfferingKind[] => {
    const kinds: ServiceOfferingKind[] = ['index'];
    if (dataset.sector && isResearchSector(dataset.sector as any)) {
      kinds.push('research');
    }
    return kinds;
  };

  const buildServiceOfferings = (
    dataset: ProviderDataset,
    publicOrigin: string,
  ): ProviderServiceOffering[] => {
    const explicitCapabilityClaim = String(dataset.serviceTypeClaim || '').trim();
    const explicitTokens = parseServiceCapabilityTokens(explicitCapabilityClaim)
      .filter((token) => isContinuityProviderCapability(token));
    const kinds: ServiceOfferingKind[] = explicitTokens.length > 0
      ? Array.from(new Set(explicitTokens.map((token) => {
          const role = getServiceOfferingRole(token);
          return role === 'digital-twin' ? 'research' : role;
        }).filter((kind): kind is ServiceOfferingKind => Boolean(kind))))
      : resolveDefaultOfferingKinds(dataset);

    return kinds.map((kind) => {
      const offeringRole: ServiceOfferingRole = kind === 'research' ? 'digital-twin' : kind;
      const serviceTypes = explicitTokens.filter(
        (token) => getServiceOfferingRole(token) === offeringRole,
      );
      return {
        id: buildServiceOfferingUrl(publicOrigin, dataset, kind),
        kind,
        publisherDid: dataset.publisherDid,
        title: `${dataset.title} ${buildServiceOfferingTypeLabel(kind)} Service Offering`,
        endpointUrl: dataset.operationalUrl,
        sector: dataset.sector,
        jurisdiction: dataset.jurisdiction,
        serviceTypes,
      };
    }).filter((offering) => offering.serviceTypes.length > 0);
  };

  const toServiceOfferingNode = (offering: ProviderServiceOffering) => ({
    '@id': offering.id,
    '@type': 'dcat:DataService',
    'dcterms:title': offering.title,
    'dcterms:publisher': { '@id': offering.publisherDid },
    'dcat:endpointURL': offering.endpointUrl,
    'dcat:theme': offering.sector || undefined,
    'dcterms:spatial': offering.jurisdiction || undefined,
    'dcat:keyword': offering.serviceTypes.length ? offering.serviceTypes : undefined,
  });

  const buildCatalog = (catalogBaseUrl: string, publicOrigin: string, datasets: ProviderDataset[]) => ({
    '@context': {
      dcat: 'https://www.w3.org/ns/dcat#',
      dcterms: 'http://purl.org/dc/terms/',
      odrl: 'http://www.w3.org/ns/odrl/2/',
    },
    '@id': `${catalogBaseUrl}`,
    '@type': 'dcat:Catalog',
    'dcat:service': datasets.flatMap((dataset) => buildServiceOfferings(dataset, publicOrigin).map(toServiceOfferingNode)),
    'dcat:dataset': datasets.map((dataset) => ({
      '@id': `${catalogBaseUrl}/datasets/${dataset.datasetId}`,
      '@type': 'dcat:Dataset',
      'dcterms:title': dataset.title,
      'dcterms:identifier': dataset.datasetId,
      'dcterms:publisher': { '@id': dataset.publisherDid },
      'dcat:theme': dataset.sector || undefined,
      'dcterms:spatial': dataset.jurisdiction || undefined,
      'dcat:service': buildServiceOfferings(dataset, publicOrigin).map((offering) => ({ '@id': offering.id })),
      'dcat:distribution': [
        {
          '@type': 'dcat:Distribution',
          'dcat:accessURL': dataset.didDocumentUrl,
        },
      ],
      'odrl:hasPolicy': {
        '@type': 'odrl:Set',
      },
    })),
  });

  const filterDatasets = (datasets: ProviderDataset[], filters: any): ProviderDataset[] => {
    if (!filters || typeof filters !== 'object') return datasets;
    const sectorFilter = typeof filters.sector === 'string' ? filters.sector.toLowerCase() : '';
    const jurisdictionFilter = typeof filters.jurisdiction === 'string' ? filters.jurisdiction.toUpperCase() : '';
    return datasets.filter((dataset) => {
      if (sectorFilter && (dataset.sector || '').toLowerCase() !== sectorFilter) return false;
      if (jurisdictionFilter && (dataset.jurisdiction || '').toUpperCase() !== jurisdictionFilter) return false;
      return true;
    });
  };

  const filterProviderDatasets = (datasets: ProviderDataset[]): ProviderDataset[] =>
    datasets.filter((dataset) => hasProviderServiceCapabilityClaim(dataset.serviceTypeClaim));

  const matchesDiscoveryFilter = (
    category: string | undefined,
    jurisdiction: string | undefined,
    areaServed: readonly string[],
    input: { sector?: string; jurisdiction?: string; coverageScope?: string },
  ): boolean => {
    const normalizedSector = String(input.sector || '').trim().toLowerCase();
    const normalizedJurisdiction = parseJurisdiction(input.jurisdiction);
    const normalizedCoverageScope = String(input.coverageScope || '').trim().toUpperCase();
    if (normalizedSector && String(category || '').trim().toLowerCase() !== normalizedSector) return false;
    if (normalizedJurisdiction && !areaServed.map((entry) => entry.toUpperCase()).includes(normalizedJurisdiction)) return false;
    if (normalizedCoverageScope && !areaServed.map((entry) => entry.toUpperCase()).includes(normalizedCoverageScope)) return false;
    return true;
  };

  const buildHostDiscoveryMatch = async (
    hostDid: string,
    publicOrigin: string,
    tenants: any[],
    requiredCapabilities: readonly string[],
    routeContext?: Readonly<{ hostCoverageScope?: string; hostNetwork?: string; version?: string }>,
  ): Promise<NormalizedHostingOperatorDiscoveryMatch> => {
    const hostTenant = await tenantsCacheManager.getTenant('host');
    const hostClaims = hostTenant?.claims || {};
    const hostCountry = parseJurisdiction(hostClaims[ClaimsOrganizationSchemaorg.addressCountry]);
    const hostCoverageScope = inferCoverageScope(hostCountry);
    const aggregatedServiceTypes = Array.from(new Set(
      tenants.flatMap((tenant) => parseServiceCapabilityTokens(String(getTenantServiceCapabilityClaim(tenant) || '')))
        .filter((token) => isContinuityProviderCapability(token)),
    ));
    const aggregatedCategories = Array.from(new Set(
      tenants
        .map((tenant) => parseCategory(getTenantServiceClaim(tenant, ClaimsServiceSchemaorg.category)))
        .filter(Boolean),
    ));
    const aggregatedAreaServed = Array.from(new Set([
      ...parseAreaServedClaim(hostClaims[ClaimsServiceSchemaorg.areaServed]),
      ...(hostCountry ? [hostCountry] : []),
      ...(hostCoverageScope ? [hostCoverageScope] : []),
    ]));

    return {
      operatorDid: hostDid,
      title:
        (hostClaims[ClaimsOrganizationSchemaorg.legalName] as string | undefined)?.trim() ||
        (hostClaims[ClaimsOrganizationSchemaorg.name] as string | undefined)?.trim() ||
        hostDid,
      discoveryUrl: (routeContext?.hostCoverageScope || hostCoverageScope) && routeContext?.hostNetwork
        ? buildAbsoluteUrl(publicOrigin, buildGwDspaceVersionWellKnownPath({
          participantId: 'host',
          jurisdiction: routeContext?.hostCoverageScope || hostCoverageScope,
          version: routeContext.version || 'v1',
          hostNetwork: routeContext.hostNetwork,
        }))
        : undefined,
      catalogUrl: (routeContext?.hostCoverageScope || hostCoverageScope) && routeContext?.hostNetwork
        ? buildAbsoluteUrl(publicOrigin, buildGwCatalogArtifactPath({
          participantId: 'host',
          jurisdiction: routeContext?.hostCoverageScope || hostCoverageScope,
          version: routeContext.version || 'v1',
          hostNetwork: routeContext.hostNetwork,
        }))
        : undefined,
      matchedCapabilities: [...requiredCapabilities],
      record: {
        subjectId: hostDid,
        serviceTypes: aggregatedServiceTypes,
        categories: aggregatedCategories,
        areaServed: aggregatedAreaServed,
        addressCountry: hostCountry || undefined,
        coverageScope: hostCoverageScope,
      },
    };
  };

  const buildNormalizedPublishedProviderMatches = (
    datasets: ProviderDataset[],
    hostMatch: NormalizedHostingOperatorDiscoveryMatch,
    publicOrigin: string,
    input: { sector?: string; providerCapability?: string; jurisdiction?: string; coverageScope?: string },
  ): NormalizedPublishedProviderDiscoveryMatch[] =>
    datasets.flatMap((dataset) => {
      const offerings = buildServiceOfferings(dataset, publicOrigin);
      return offerings.flatMap((offering) =>
        offering.serviceTypes
          .filter((serviceType) => isContinuityProviderCapability(serviceType))
          .filter((serviceType) => {
            const requestedCapability = String(input.providerCapability || '').trim();
            if (requestedCapability && serviceType !== requestedCapability) return false;
            const coverageEntries = Array.from(new Set([
              ...(dataset.jurisdiction ? [dataset.jurisdiction] : []),
              ...(inferCoverageScope(dataset.jurisdiction) ? [inferCoverageScope(dataset.jurisdiction)!] : []),
            ]));
            return matchesDiscoveryFilter(dataset.sector, dataset.jurisdiction, coverageEntries, input);
          })
          .map((serviceType) => ({
            providerDid: dataset.publisherDid,
            title: dataset.title,
            hostingOperatorDid: hostMatch.operatorDid,
            hostingOperatorTitle: hostMatch.title,
            discoveryUrl: appendTenantPath(dataset.baseUrl, DataspaceWellKnownPaths.VersionMetadata),
            catalogUrl: appendTenantPath(dataset.baseUrl, buildGwCatalogArtifactPath()),
            record: {
              providerDid: dataset.publisherDid,
              serviceType,
              category: dataset.sector || '',
              areaServed: dataset.jurisdiction || inferCoverageScope(dataset.jurisdiction),
              endpointUrl: offering.endpointUrl,
              discoveryUrl: appendTenantPath(dataset.baseUrl, DataspaceWellKnownPaths.VersionMetadata),
              catalogUrl: appendTenantPath(dataset.baseUrl, buildGwCatalogArtifactPath()),
            },
            hostingOperator: hostMatch.record,
          })),
      );
    });

  const buildServiceOfferingArtifact = (
    dataset: ProviderDataset,
    kind: ServiceOfferingKind,
    publicOrigin: string,
  ) => {
    const offering = buildServiceOfferings(dataset, publicOrigin).find((candidate) => candidate.kind === kind);
    if (!offering) return undefined;
    // A Gaia-X terms hash attests the referenced document bytes. Hashing the
    // URL text would be a different statement, so omit the VC until the real
    // content hash produced by service attachment ingestion is available.
    if (!dataset.termsOfService || !dataset.termsOfServiceHash) return undefined;
    const claims = {
      [ClaimsServiceSchemaorg.name]: offering.title,
      [ClaimsServiceSchemaorg.url]: offering.endpointUrl,
      [ClaimsServiceSchemaorg.serviceType]: offering.serviceTypes.join(','),
      [ClaimsServiceSchemaorg.category]: offering.sector,
    };
    return buildGaiaXServiceOfferingCredentialDraft({
      claims,
      credentialId: `${offering.id}.vc`,
      subjectId: offering.id,
      issuerId: offering.publisherDid,
      providedByCredentialId: `${dataset.baseUrl}/.well-known/legal-participant.vc.json`,
      termsAndConditionsUrl: dataset.termsOfService,
      termsAndConditionsHash: dataset.termsOfServiceHash,
      validFrom: new Date().toISOString(),
    });
  };

  /** Signs a Gaia-X VC draft as the VC-JWT enveloped credential required by ICAM 25.11. */
  const signGaiaXEnvelopedCredential = async (credential: Record<string, unknown>, vaultId: string) => {
    const jwks = await kmsService.getPublicJwks(vaultId);
    const signer = jwks.keys.find((key: any) => key.use === 'sig' && key.purpose === 'vc_sign')
      || jwks.keys.find((key: any) => key.use === 'sig');
    if (!signer?.kid) throw new Error(`No VC signing key found for '${vaultId}'.`);
    const jwt = await kmsService.createCompactJws(credential, signer.kid, vaultId, 'vc_sign', {
      typ: 'vc+ld+json+jwt',
      cty: 'vc+ld+json',
    });
    return {
      ...credential,
      proof: {
        type: 'EnvelopedVerifiableCredential',
        id: `data:application/vc+jwt,${jwt}`,
      },
    };
  };

  /**
   * @openapi
   * /host/ping:
   *   get:
   *     tags: [Discovery]
   *     summary: Ping (host root)
   *     description: Root-level liveness check for the host runtime.
   *     responses:
   *       '200': { description: OK }
   *       '503': { description: Service Unavailable }
   *
   * /host/cds-{hostCoverageScope}/{version}/{hostNetwork}/.well-known/ping:
   *   get:
   *     tags: [Discovery]
   *     summary: Ping (host)
   *     description: Canonical health check for the host runtime scoped by coverage scope, version, and host network.
   *     responses:
   *       '200': { description: OK }
   *       '503': { description: Service Unavailable }
   *
   * /{tenantId}/cds-{jurisdiction}/{version}/{sector}/.well-known/ping:
   *   get:
   *     tags: [Discovery]
   *     summary: Ping (tenant)
   *     description: Health check for a tenant resolved by its CDS path.
   *     parameters:
   *       - $ref: '#/components/parameters/TenantId'
   *       - $ref: '#/components/parameters/Jurisdiction'
   *       - $ref: '#/components/parameters/Version'
   *       - $ref: '#/components/parameters/Sector'
   *     responses:
   *       '200': { description: OK }
   *       '404': { description: Not Found }
   *
   * /host/cds-{hostCoverageScope}/{version}/{hostNetwork}/.well-known/did.json:
   *   get:
   *     tags: [Discovery]
   *     summary: DID document (host)
   *     parameters:
   *       - $ref: '#/components/parameters/HostCoverageScope'
   *       - $ref: '#/components/parameters/Version'
   *       - $ref: '#/components/parameters/HostRegistrySector'
   *     responses:
   *       '200': { description: OK }
   *
   * /{tenantId}/cds-{jurisdiction}/{version}/{sector}/.well-known/did.json:
   *   get:
   *     tags: [Discovery]
   *     summary: DID document (tenant, compatibility alias)
   *     parameters:
   *       - $ref: '#/components/parameters/TenantId'
   *       - $ref: '#/components/parameters/Jurisdiction'
   *       - $ref: '#/components/parameters/Version'
   *       - $ref: '#/components/parameters/Sector'
   *     responses:
   *       '200': { description: OK }
   *       '404': { description: Not Found }
   *
   * /{tenantId}/cds-{jurisdiction}/{version}/{sector}/did.json:
   *   get:
   *     tags: [Discovery]
   *     summary: Resolve the standards-defined path-based did:web document
   *     description: Canonical resolution URL for a tenant whose did:web identifier contains path segments. Returns the same document as the retained .well-known compatibility alias.
   *     parameters:
   *       - $ref: '#/components/parameters/TenantId'
   *       - $ref: '#/components/parameters/Jurisdiction'
   *       - $ref: '#/components/parameters/Version'
   *       - $ref: '#/components/parameters/Sector'
   *     responses:
   *       '200': { description: OK }
   *       '404': { description: Not Found }
   *
   * /host/cds-{hostCoverageScope}/{version}/{hostNetwork}/.well-known/jwks.json:
   *   get:
   *     tags: [Discovery]
   *     summary: JWKS (host)
   *     parameters:
   *       - $ref: '#/components/parameters/HostCoverageScope'
   *       - $ref: '#/components/parameters/Version'
   *       - $ref: '#/components/parameters/HostRegistrySector'
   *     responses:
   *       '200': { description: OK }
   *
   * /{tenantId}/cds-{jurisdiction}/{version}/{sector}/.well-known/jwks.json:
   *   get:
   *     tags: [Discovery]
   *     summary: JWKS (tenant)
   *     parameters:
   *       - $ref: '#/components/parameters/TenantId'
   *       - $ref: '#/components/parameters/Jurisdiction'
   *       - $ref: '#/components/parameters/Version'
   *       - $ref: '#/components/parameters/Sector'
   *     responses:
   *       '200': { description: OK }
   *       '404': { description: Not Found }
   *
   * /host/cds-{hostCoverageScope}/{version}/{hostNetwork}/.well-known/openid-configuration:
   *   get:
   *     tags: [Discovery]
   *     summary: OpenID configuration (host)
   *     parameters:
   *       - $ref: '#/components/parameters/HostCoverageScope'
   *       - $ref: '#/components/parameters/Version'
   *       - $ref: '#/components/parameters/HostRegistrySector'
   *     responses:
   *       '200': { description: OK }
   *
   * /{tenantId}/cds-{jurisdiction}/{version}/{sector}/.well-known/openid-configuration:
   *   get:
   *     tags: [Discovery]
   *     summary: OpenID configuration (tenant)
   *     parameters:
   *       - $ref: '#/components/parameters/TenantId'
   *       - $ref: '#/components/parameters/Jurisdiction'
   *       - $ref: '#/components/parameters/Version'
   *       - $ref: '#/components/parameters/Sector'
   *     responses:
   *       '200': { description: OK }
   *       '404': { description: Not Found }
   *
   * /host/cds-{hostCoverageScope}/{version}/{hostNetwork}/.well-known/smart-configuration:
   *   get:
   *     tags: [Discovery]
   *     summary: SMART configuration (host)
   *     parameters:
   *       - $ref: '#/components/parameters/HostCoverageScope'
   *       - $ref: '#/components/parameters/Version'
   *       - $ref: '#/components/parameters/HostRegistrySector'
   *     responses:
   *       '200': { description: OK }
   *
   * /{tenantId}/cds-{jurisdiction}/{version}/{sector}/.well-known/smart-configuration:
   *   get:
   *     tags: [Discovery]
   *     summary: SMART configuration (tenant)
   *     parameters:
   *       - $ref: '#/components/parameters/TenantId'
   *       - $ref: '#/components/parameters/Jurisdiction'
   *       - $ref: '#/components/parameters/Version'
   *       - $ref: '#/components/parameters/Sector'
   *     responses:
   *       '200': { description: OK }
   *       '404': { description: Not Found }
   *
   * /host/cds-{hostCoverageScope}/{version}/{hostNetwork}/.well-known/legal-participant.vc.json:
   *   get:
   *     tags: [Discovery]
   *     summary: Gaia-X Legal Participant VC (host)
   *     parameters:
   *       - $ref: '#/components/parameters/HostCoverageScope'
   *       - $ref: '#/components/parameters/Version'
   *       - $ref: '#/components/parameters/HostRegistrySector'
   *     responses:
   *       '200': { description: OK }
   *
   * /{tenantId}/cds-{jurisdiction}/{version}/{sector}/.well-known/legal-participant.vc.json:
   *   get:
   *     tags: [Discovery]
   *     summary: Gaia-X Legal Participant VC (tenant)
   *     parameters:
   *       - $ref: '#/components/parameters/TenantId'
   *       - $ref: '#/components/parameters/Jurisdiction'
   *       - $ref: '#/components/parameters/Version'
   *       - $ref: '#/components/parameters/Sector'
   *     responses:
   *       '200': { description: OK }
   *       '404': { description: Not Found }
   *
   * /{tenantId}/cds-{jurisdiction}/{version}/{sector}/.well-known/service-offering-index.json:
   *   get:
   *     tags: [Discovery]
   *     summary: DSP index service offering (tenant)
   *     parameters:
   *       - $ref: '#/components/parameters/TenantId'
   *       - $ref: '#/components/parameters/Jurisdiction'
   *       - $ref: '#/components/parameters/Version'
   *       - $ref: '#/components/parameters/Sector'
   *     responses:
   *       '200': { description: OK }
   *       '404': { description: Not Found }
   *
   * /{tenantId}/cds-{jurisdiction}/{version}/{sector}/.well-known/service-offering-personal-backup.json:
   *   get:
   *     tags: [Discovery]
   *     summary: DSP personal backup service offering (tenant)
   *     parameters:
   *       - $ref: '#/components/parameters/TenantId'
   *       - $ref: '#/components/parameters/Jurisdiction'
   *       - $ref: '#/components/parameters/Version'
   *       - $ref: '#/components/parameters/Sector'
   *     responses:
   *       '200': { description: OK }
   *       '404': { description: Not Found }
   *
   * /{tenantId}/cds-{jurisdiction}/{version}/{sector}/.well-known/service-offering-research.json:
   *   get:
   *     tags: [Discovery]
   *     summary: DSP research service offering (tenant)
   *     parameters:
   *       - $ref: '#/components/parameters/TenantId'
   *       - $ref: '#/components/parameters/Jurisdiction'
   *       - $ref: '#/components/parameters/Version'
   *       - $ref: '#/components/parameters/Sector'
   *     responses:
   *       '200': { description: OK }
   *       '404': { description: Not Found }
   *
   * /{tenantId}/cds-{jurisdiction}/{version}/{sector}/{section}/{format}/metadata:
   *   get:
   *     tags: [Discovery]
   *     summary: FHIR CapabilityStatement (tenant)
   *     description: Returns the capability statement for the exact tenant FHIR server base.
   *     parameters:
   *       - $ref: '#/components/parameters/TenantId'
   *       - $ref: '#/components/parameters/Jurisdiction'
   *       - $ref: '#/components/parameters/Version'
   *       - $ref: '#/components/parameters/Sector'
   *       - in: path
   *         name: section
   *         required: true
   *         schema: { type: string, enum: [individual, digitaltwin, entity] }
   *       - in: path
   *         name: format
   *         required: true
   *         schema: { type: string, enum: [org.hl7.fhir.r4, org.hl7.fhir.r5] }
   *     responses:
   *       '200': { description: OK }
   *       '404': { description: Not Found }
   *
   * /{tenantId}/cds-{jurisdiction}/{version}/{sector}/{section}/{format}/.well-known/smart-configuration:
   *   get:
   *     tags: [Discovery]
   *     summary: SMART configuration for one tenant FHIR server base
   *     parameters:
   *       - $ref: '#/components/parameters/TenantId'
   *       - $ref: '#/components/parameters/Jurisdiction'
   *       - $ref: '#/components/parameters/Version'
   *       - $ref: '#/components/parameters/Sector'
   *       - in: path
   *         name: section
   *         required: true
   *         schema: { type: string, enum: [individual, digitaltwin, entity] }
   *       - in: path
   *         name: format
   *         required: true
   *         schema: { type: string, enum: [org.hl7.fhir.r4, org.hl7.fhir.r5] }
   *     responses:
   *       '200': { description: OK }
   *       '404': { description: Not Found }
   */

  // Middleware to resolve the tenant vaultId based on path parameters and verify existence.
  const resolveTenant = async (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const { tenantId, jurisdiction, version, sector } = req.params;

    // The 'host' is a special case that doesn't use the structured CDS path.
    if (req.path.startsWith('/host')) {
      res.locals.vaultId = 'host';
      // Quick check to ensure host is loaded before proceeding.
      if (!(await tenantsCacheManager.getDidDocument('host'))) {
        return res.status(503).type('text').send('Service Unavailable: Host configuration not loaded.');
      }
      return next();
    }

    // For all standard tenants, all parts of the CDS path are required.
    if (!tenantId || !jurisdiction || !version || !sector) {
      return res.status(400).type('text').send('Bad Request: A valid CDS path is required.');
    }

    const canonicalTenantId = canonicalizeHostedTenantRouteId(tenantId);
    const vaultId = getTenantVaultId(sector, canonicalTenantId);
    
    // Use the public getDidDocument method to check for the tenant's existence.
    // This avoids exposing the entire internal EntityConfig in the middleware.
    const didDocument = await tenantsCacheManager.getDidDocument(vaultId);

    if (!didDocument) {
      console.warn(`[DiscoveryRouter] Tenant not found for vaultId '${vaultId}' constructed from path.`);
      return res.status(404).type('text').send('Not Found');
    }
    
    res.locals.vaultId = vaultId; // Pass the resolved vaultId to the next handler.
    next();
  };
  
  // --- Route Definitions ---
  // Define separate, unambiguous route structures for host and tenants.
  const hostPingPrefix = '/host';
  const hostScopedWellKnownPrefix = '/host/cds-:hostCoverageScope/:version/:hostNetwork/.well-known';
  // This new route aligns with the hosted DID web specification for tenants.
  const tenantDidPrefix = '/:tenantId/cds-:jurisdiction/:version/:sector';
  const tenantWellKnownPrefix = '/:tenantId/cds-:jurisdiction/:version/:sector/.well-known';
  const tenantControllerDidPrefix = '/:tenantId/cds-:jurisdiction/:version/:sector/employee/:memberId/:role';

  /**
   * Resolves the host's root did:web identifier at its standards-defined URL.
   * CDS-scoped discovery remains available below `/host/cds-*`, but a DID such
   * as `did:web:gateway.example` must resolve at `/.well-known/did.json`.
   *
   * @openapi
   * /.well-known/did.json:
   *   get:
   *     tags: [Discovery]
   *     summary: Resolve the root host DID document
   *     responses:
   *       200:
   *         description: Public host DID document
   *       503:
   *         description: Host configuration is not loaded
   */
  router.get('/.well-known/did.json', async (_req, res) => {
    const didDocument = await tenantsCacheManager.getDidDocument('host');
    if (!didDocument) return res.status(503).type('text').send('Service Unavailable');
    return res.json(didDocument);
  });

  /**
   * @openapi
   * /jwks.json:
   *   get:
   *     tags: [Discovery]
   *     summary: Resolve the root host public JWK Set
   *     responses:
   *       200:
   *         description: Public host keys advertised by the root host DID
   *       500:
   *         description: Host keys could not be loaded
   */
  router.get('/jwks.json', async (_req, res) => {
    try {
      return res.json(toPublicJwkSet(await kmsService.getPublicJwks('host')));
    } catch (error) {
      logger.error('Failed to get root host JWKS', error as Error, { vaultId: 'host' });
      return res.status(500).type('text').send('Internal Server Error: Could not retrieve key set.');
    }
  });

  router.get(
    [`${hostPingPrefix}/ping`, `${hostScopedWellKnownPrefix}/ping`, `${tenantWellKnownPrefix}/ping`],
    resolveTenant,
    pingHandler(),
  );

  router.get(
    [
      `${hostScopedWellKnownPrefix}/did.json`,
      `${tenantDidPrefix}/did.json`,
      `${tenantWellKnownPrefix}/did.json`,
    ],
    resolveTenant,
    async (_req, res) => {
    // The final handler's responsibility is to fetch the specific document it needs.
    const didDocument = await tenantsCacheManager.getDidDocument(res.locals.vaultId);
    // The existence check was already done in resolveTenant, so we can be confident it exists.
    res.json(didDocument);
    },
  );

  /**
   * @openapi
   * /{tenantId}/cds-{jurisdiction}/{version}/{sector}/.well-known/tenant-status.json:
   *   get:
   *     tags: [Discovery]
   *     summary: Read the safe organization tenant and controller lifecycle status
   *     responses:
   *       200:
   *         description: Tenant lifecycle, controller DIDs, public kids and DCR state
   *       404:
   *         description: Tenant is not registered
   */
  router.get(`${tenantWellKnownPrefix}/tenant-status.json`, resolveTenant, async (_req, res) => {
    const status = await tenantStatusService.build(res.locals.vaultId);
    if (!status) return res.status(404).type('text').send('Not Found');
    res.set('Cache-Control', 'no-store');
    return res.json(status);
  });

  /**
   * Resolves a separately governed controller did:web document referenced by
   * the tenant DID. Multiple controllers are read from their protected
   * employee records; only their public DID document crosses this boundary.
   */
  /**
   * @openapi
   * /{tenantId}/cds-{jurisdiction}/{version}/{sector}/employee/{memberId}/{role}/did.json:
   *   get:
   *     tags: [Discovery]
   *     summary: Resolve the governed organization controller DID document
   *     responses:
   *       200:
   *         description: Public controller DID document
   *       404:
   *         description: Controller DID is not registered for this tenant
   */
  router.get(`${tenantControllerDidPrefix}/did.json`, resolveTenant, async (req, res) => {
    const controllerDidDocument = await tenantStatusService.resolveControllerDidDocument(
      res.locals.vaultId,
      req.params.memberId,
      req.params.role,
    );
    if (!controllerDidDocument) {
      return res.status(404).type('text').send('Not Found');
    }
    return res.json(controllerDidDocument);
  });

  router.get([`${hostScopedWellKnownPrefix}/jwks.json`, `${tenantWellKnownPrefix}/jwks.json`], resolveTenant, async (req, res) => {
    try {
      const vaultId = res.locals.vaultId;
      const jwks = toPublicJwkSet(await kmsService.getPublicJwks(vaultId));
      const entityConfig = await tenantsCacheManager.getTenant(vaultId);
      const legacySignAlg = (entityConfig?.legacyX509DerBase64 || entityConfig?.legacyX509ChainBase64?.length)
        ? (entityConfig?.legacySignAlg || process.env.LEGACY_SIGN_ALG)
        : undefined;
      const legacyX5c = entityConfig?.legacyX509ChainBase64;
      const legacyDerBase64 = entityConfig?.legacyX509DerBase64;
      if (legacySignAlg && legacyDerBase64 && jwks?.keys?.length) {
        const wellKnownBase = vaultId === 'host'
          ? `/host/cds-${req.params.hostCoverageScope}/${req.params.version}/${req.params.hostNetwork}/.well-known`
          : `/${req.params.tenantId}/cds-${req.params.jurisdiction}/${req.params.version}/${req.params.sector}/.well-known`;
        const legacyX5u = `${req.protocol}://${req.get('host')}${wellKnownBase}/x509.der`;
        const combinedChain = legacyDerBase64
          ? [legacyDerBase64, ...(legacyX5c || [])]
          : (legacyX5c || []);
        const uniqueChain = combinedChain.filter((value: string, index: number, self: string[]) => self.indexOf(value) === index);
        for (const key of jwks.keys) {
          if ((key as any).alg === legacySignAlg) {
            (key as any).x5u = legacyX5u;
            if (uniqueChain.length) {
              (key as any).x5c = uniqueChain;
            }
          }
        }
      }
      res.json(jwks);
    } catch (error) {
      // If keys are not found for the entity, it's a server-side issue.
      logger.error('Failed to get JWKS', error as Error, { vaultId: res.locals.vaultId });
      res.status(500).type('text').send('Internal Server Error: Could not retrieve key set.');
    }
  });

  router.get([`${hostScopedWellKnownPrefix}/x509.der`, `${tenantWellKnownPrefix}/x509.der`], resolveTenant, async (req, res) => {
    const vaultId = res.locals.vaultId;
    const entityConfig = await tenantsCacheManager.getTenant(vaultId);
    const derBase64 = entityConfig?.legacyX509DerBase64;
    const chainBase64 = entityConfig?.legacyX509ChainBase64 || [];
    const combined = derBase64 ? [derBase64, ...chainBase64] : chainBase64;
    const uniqueChain = combined.filter((value: string, index: number, self: string[]) => self.indexOf(value) === index);
    if (!uniqueChain.length) {
      return res.status(404).type('text').send('Not Found');
    }
    const derBuffers = uniqueChain.map((entry: string) => Buffer.from(entry, 'base64'));
    const derBytes = Buffer.concat(derBuffers);
    res.type('application/pkix-cert').send(derBytes);
  });

  // Legacy/dev-friendly: return the tenant's stored legal-participant VC and self-description (if present).
  // Some clients rely on vc.json; serve it as a deprecated alias.
  router.get([`${hostScopedWellKnownPrefix}/vc.json`, `${tenantWellKnownPrefix}/vc.json`], resolveTenant, async (req, res) => {
    const entityConfig = await tenantsCacheManager.getTenant(res.locals.vaultId);
    const vc = entityConfig?.governanceVc;
    if (!vc) return res.status(404).type('text').send('Not Found');
    res.json(vc);
  });

  router.get(
    [`${hostScopedWellKnownPrefix}/self-description.json`, `${tenantWellKnownPrefix}/self-description.json`],
    resolveTenant,
    async (req, res) => {
      const entityConfig = await tenantsCacheManager.getTenant(res.locals.vaultId);
      const selfDescription = entityConfig?.selfDescriptionVc;
      if (!selfDescription) return res.status(404).type('text').send('Not Found');
      res.json(selfDescription);
    },
  );

  router.get([`${hostScopedWellKnownPrefix}/status-list.json`, `${tenantWellKnownPrefix}/status-list.json`], resolveTenant, async (req, res) => {
    try {
      const vaultId = res.locals.vaultId;
      const entityConfig = await tenantsCacheManager.getTenant(vaultId);
      const didDoc = entityConfig?.didDocument;
      if (!entityConfig || !didDoc) {
        return res.status(404).type('text').send('Not Found');
      }

      const legacySignAlg = (entityConfig?.legacyX509DerBase64 || entityConfig?.legacyX509ChainBase64?.length)
        ? (entityConfig?.legacySignAlg || process.env.LEGACY_SIGN_ALG)
        : undefined;
      const verificationMethodId = findSigningMethod(didDoc, legacySignAlg) || (didDoc.assertionMethod?.[0] as string);
      const assertionMethodIds = new Set((didDoc.assertionMethod || [])
        .map((method: any) => typeof method === 'string' ? method : method.id)
        .filter(Boolean));
      const pqcSignMethod = didDoc.verificationMethod?.find((method: any) =>
        assertionMethodIds.has(method.id) && (method.publicKeyJwk as any)?.alg?.startsWith('ML-DSA'))?.id as string | undefined;
      const pqcSignAlg = pqcSignMethod
        ? (didDoc.verificationMethod?.find((method: any) => method.id === pqcSignMethod)?.publicKeyJwk as any)?.alg
        : undefined;
      if (!verificationMethodId && !pqcSignMethod) {
        throw new Error('No assertionMethod found in DID document to sign the status list.');
      }

      const wellKnownBase = vaultId === 'host'
        ? `/host/cds-${req.params.hostCoverageScope}/${req.params.version}/${req.params.hostNetwork}/.well-known`
        : `/${req.params.tenantId}/cds-${req.params.jurisdiction}/${req.params.version}/${req.params.sector}/.well-known`;
      const listUrl = `${req.protocol}://${req.get('host')}${wellKnownBase}/status-list.json`;
      const encodedList = createStatusListEncodedList(STATUS_LIST_BITS);

      const unsignedStatusListVc = buildStatusListCredential({
        issuerDid: didDoc.id,
        listUrl,
        statusPurpose: STATUS_LIST_PURPOSE,
        encodedList,
      });

      let signedStatusListVc = unsignedStatusListVc;
      if (verificationMethodId) {
        signedStatusListVc = await signVerifiableCredential(
          signedStatusListVc,
          verificationMethodId,
          kmsService,
          vaultId,
          { signerAlg: legacySignAlg },
        );
      }
      if (pqcSignMethod && pqcSignMethod !== verificationMethodId) {
        signedStatusListVc = await signVerifiableCredential(
          signedStatusListVc,
          pqcSignMethod,
          kmsService,
          vaultId,
          { signerAlg: pqcSignAlg },
        );
      }

      res.json(signedStatusListVc);
    } catch (error: any) {
      console.error(`[DiscoveryRouter] Failed to generate Status List VC for vaultId '${res.locals.vaultId}':`, error);
      res.status(500).type('text').send('Internal Server Error: ' + error.message);
    }
  });

  router.get([`${hostScopedWellKnownPrefix}/legal-participant.vc.json`, `${tenantWellKnownPrefix}/legal-participant.vc.json`], resolveTenant, async (req, res) => {
    const entityConfig = await tenantsCacheManager.getTenant(res.locals.vaultId);
    const vc = entityConfig?.governanceVc;
    if (!vc) return res.status(404).type('text').send('Not Found');
    res.json(await signGaiaXEnvelopedCredential(vc, res.locals.vaultId));
  });

  router.get(`${tenantWellKnownPrefix}/service-offering-index.json`, resolveTenant, async (req, res) => {
    const tenantConfig = await tenantsCacheManager.getTenant(res.locals.vaultId);
    const dataset = tenantConfig ? toProviderDataset(tenantConfig) : null;
    const artifact = dataset ? buildServiceOfferingArtifact(dataset, 'index', `${req.protocol}://${req.get('host')}`) : undefined;
    if (!artifact) return res.status(404).type('text').send('Not Found');
    res.json(await signGaiaXEnvelopedCredential(artifact, res.locals.vaultId));
  });

  router.get(`${tenantWellKnownPrefix}/service-offering-research.json`, resolveTenant, async (req, res) => {
    const tenantConfig = await tenantsCacheManager.getTenant(res.locals.vaultId);
    const dataset = tenantConfig ? toProviderDataset(tenantConfig) : null;
    const artifact = dataset ? buildServiceOfferingArtifact(dataset, 'research', `${req.protocol}://${req.get('host')}`) : undefined;
    if (!artifact) return res.status(404).type('text').send('Not Found');
    res.json(await signGaiaXEnvelopedCredential(artifact, res.locals.vaultId));
  });

  router.get(`${tenantWellKnownPrefix}/service-offering-personal-backup.json`, resolveTenant, async (req, res) => {
    const tenantConfig = await tenantsCacheManager.getTenant(res.locals.vaultId);
    const dataset = tenantConfig ? toProviderDataset(tenantConfig) : null;
    const artifact = dataset ? buildServiceOfferingArtifact(dataset, 'personal-backup', `${req.protocol}://${req.get('host')}`) : undefined;
    if (!artifact) return res.status(404).type('text').send('Not Found');
    res.json(await signGaiaXEnvelopedCredential(artifact, res.locals.vaultId));
  });

  router.get([`${hostScopedWellKnownPrefix}/openid-configuration`, `${tenantWellKnownPrefix}/openid-configuration`], resolveTenant, (req, res) => {
    const config = discoveryService.getOpenIdConfiguration(res.locals.vaultId);
    if (config) {
      res.json(config);
    } else {
      res.status(404).type('text').send('Not Found');
    }
  });

  router.get([`${hostScopedWellKnownPrefix}/openid-credential-issuer`, `${tenantWellKnownPrefix}/openid-credential-issuer`], resolveTenant, async (req, res) => {
    const config = await discoveryService.getOpenIdCredentialIssuerMetadata(res.locals.vaultId);
    if (config) {
      res.json(config);
    } else {
      res.status(404).type('text').send('Not Found');
    }
  });

  /**
   * @openapi
   * /host/cds-{hostCoverageScope}/{version}/{hostNetwork}/.well-known/dspace-version:
   *   get:
   *     tags: [Data Catalog Discovery]
   *     summary: Host DSP version-discovery entrypoint
   *     parameters:
   *       - $ref: '#/components/parameters/HostCoverageScope'
   *       - $ref: '#/components/parameters/Version'
   *       - $ref: '#/components/parameters/HostRegistrySector'
   *     responses:
   *       '200': { description: DSP version metadata returned }
   *       '503': { description: Host not available }
   *
   * /{tenantId}/cds-{jurisdiction}/{version}/{sector}/.well-known/dspace-version:
   *   get:
   *     tags: [Data Catalog Discovery]
   *     summary: Hosted tenant DSP version-discovery entrypoint
   *     parameters:
   *       - $ref: '#/components/parameters/TenantId'
   *       - $ref: '#/components/parameters/Jurisdiction'
   *       - $ref: '#/components/parameters/Version'
   *       - $ref: '#/components/parameters/Sector'
   *     responses:
   *       '200': { description: DSP version metadata returned }
   *       '404': { description: Tenant not found }
   *
   * /host/cds-{hostCoverageScope}/{version}/{hostNetwork}/dsp/catalog/request:
   *   post:
   *     tags: [Data Catalog Discovery]
   *     summary: Operator DSP catalog request
   *     description: Returns a `dcat:Catalog` with provider datasets discoverable by client apps.
   *     parameters:
   *       - $ref: '#/components/parameters/HostCoverageScope'
   *       - $ref: '#/components/parameters/Version'
   *       - $ref: '#/components/parameters/HostRegistrySector'
   *     requestBody:
   *       required: false
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               filters:
   *                 type: object
   *                 properties:
   *                   sector: { type: string }
   *                   jurisdiction: { type: string }
   *     responses:
   *       '200': { description: DSP catalog response }
   *       '503': { description: Host not available }
   *
   * /host/cds-{hostCoverageScope}/{version}/{hostNetwork}/dsp/catalog/dcat.json:
   *   get:
   *     tags: [Data Catalog Discovery]
   *     summary: Operator DSP catalog artifact
   *     parameters:
   *       - $ref: '#/components/parameters/HostCoverageScope'
   *       - $ref: '#/components/parameters/Version'
   *       - $ref: '#/components/parameters/HostRegistrySector'
   *     responses:
   *       '200': { description: DCAT catalog artifact }
   *       '503': { description: Host not available }
   *
   * /host/cds-{hostCoverageScope}/{version}/{hostNetwork}/dsp/catalog/datasets/{id}:
   *   get:
   *     tags: [Data Catalog Discovery]
   *     summary: Read one provider dataset from operator catalog
   *     parameters:
   *       - $ref: '#/components/parameters/HostCoverageScope'
   *       - $ref: '#/components/parameters/Version'
   *       - $ref: '#/components/parameters/HostRegistrySector'
   *       - in: path
   *         name: id
   *         required: true
   *         schema: { type: string }
   *     responses:
   *       '200': { description: Dataset found }
   *       '404': { description: Dataset not found }
   *
   * /{tenantId}/cds-{jurisdiction}/{version}/{sector}/dsp/catalog/request:
   *   post:
   *     tags: [Data Catalog Discovery]
   *     summary: Hosted provider catalog request (tenant scoped)
   *     parameters:
   *       - $ref: '#/components/parameters/TenantId'
   *       - $ref: '#/components/parameters/Jurisdiction'
   *       - $ref: '#/components/parameters/Version'
   *       - $ref: '#/components/parameters/Sector'
   *     responses:
   *       '200': { description: DSP catalog response }
   *       '404': { description: Tenant not found }
   *
   * /{tenantId}/cds-{jurisdiction}/{version}/{sector}/dsp/catalog/dcat.json:
   *   get:
   *     tags: [Data Catalog Discovery]
   *     summary: Hosted provider DSP catalog artifact
   *     parameters:
   *       - $ref: '#/components/parameters/TenantId'
   *       - $ref: '#/components/parameters/Jurisdiction'
   *       - $ref: '#/components/parameters/Version'
   *       - $ref: '#/components/parameters/Sector'
   *     responses:
   *       '200': { description: DCAT catalog artifact }
   *       '404': { description: Tenant not found }
   *
   * /{tenantId}/cds-{jurisdiction}/{version}/{sector}/dsp/catalog/datasets/{id}:
   *   get:
   *     tags: [Data Catalog Discovery]
   *     summary: Read one provider dataset from hosted tenant catalog
   *     parameters:
   *       - $ref: '#/components/parameters/TenantId'
   *       - $ref: '#/components/parameters/Jurisdiction'
   *       - $ref: '#/components/parameters/Version'
   *       - $ref: '#/components/parameters/Sector'
   *       - in: path
   *         name: id
   *         required: true
   *         schema: { type: string }
   *     responses:
   *       '200': { description: Dataset found }
   *       '404': { description: Not found }
   */
  // --- DSP catalog endpoints (synchronous/public discovery) ---
  router.post(buildGwCatalogRequestPath({
    participantId: 'host',
    jurisdiction: ':hostCoverageScope',
    version: ':version',
    hostNetwork: ':hostNetwork',
  }), async (req, res) => {
    if (!(await isDiscoveryPublicationOperational('host'))) {
      return res.status(503).type('text').send('Service Unavailable');
    }
    const hostDid = await tenantsCacheManager.getDidDocument('host');
    if (!hostDid?.id) return res.status(503).type('text').send('Service Unavailable');

    const allTenants = await tenantsCacheManager.listAutodiscoverableTenants();
    const datasets = filterProviderDatasets(allTenants
      .map(toProviderDataset)
      .filter((d): d is ProviderDataset => !!d));

    const filtered = filterDatasets(datasets, req.body?.filters);
    const publicOrigin = buildPublicOrigin(req);
    const catalogBaseUrl = buildAbsoluteUrl(publicOrigin, buildGwCatalogCollectionPath({
      participantId: 'host',
      jurisdiction: req.params.hostCoverageScope,
      version: req.params.version,
      hostNetwork: req.params.hostNetwork,
    }));
    res.json(buildCatalog(catalogBaseUrl, publicOrigin, filtered));
  });

  router.get(buildGwDspaceVersionWellKnownPath({
    participantId: 'host',
    jurisdiction: ':hostCoverageScope',
    version: ':version',
    hostNetwork: ':hostNetwork',
  }), async (req, res) => {
    if (!(await isDiscoveryPublicationOperational('host'))) {
      return res.status(503).type('text').send('Service Unavailable');
    }
    const hostDid = await tenantsCacheManager.getDidDocument('host');
    if (!hostDid?.id) return res.status(503).type('text').send('Service Unavailable');

    res.json(buildDspaceVersionMetadata(buildGwDataspaceBasePath({
      participantId: 'host',
      jurisdiction: req.params.hostCoverageScope,
      version: req.params.version,
      hostNetwork: req.params.hostNetwork,
    })));
  });

  /**
   * @openapi
   * /api/dataspace-discovery/providers:
   *   post:
   *     tags:
   *       - Discovery
   *     summary: Resolve published service providers for backend/BFF consumption
   *     requestBody:
   *       required: false
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *     responses:
   *       '200': { description: Normalized autodiscovery DTOs returned }
   *       '503': { description: Host DID document is unavailable }
   */
  router.post('/api/dataspace-discovery/providers', async (req, res) => {
    if (!(await isDiscoveryPublicationOperational('host'))) {
      return res.status(503).type('text').send('Service Unavailable');
    }
    const hostDid = await tenantsCacheManager.getDidDocument('host');
    if (!hostDid?.id) return res.status(503).type('text').send('Service Unavailable');

    const publicOrigin = `${req.protocol}://${req.get('host')}`;
    const autodiscoverableTenants = await tenantsCacheManager.listAutodiscoverableTenants();
    const datasets = filterProviderDatasets(autodiscoverableTenants
      .map(toProviderDataset)
      .filter((d): d is ProviderDataset => !!d));

    const providerCapability = String(req.body?.providerCapability || '').trim();
    const hostMatch = await buildHostDiscoveryMatch(
      hostDid.id,
      publicOrigin,
      autodiscoverableTenants,
      providerCapability ? [providerCapability] : [],
      {
        hostCoverageScope: req.body?.hostCoverageScope || req.body?.coverageScope,
        hostNetwork: req.body?.hostNetwork || req.body?.hostNetworkOrBusinessSector,
        version: req.body?.version || 'v1',
      },
    );
    const providers = buildNormalizedPublishedProviderMatches(
      datasets,
      hostMatch,
      publicOrigin,
      {
        sector: req.body?.sector,
        providerCapability,
        jurisdiction: req.body?.jurisdiction,
        coverageScope: req.body?.coverageScope,
      },
    );

    res.json({
      providers,
      hostingOperators: [hostMatch],
    });
  });

  /**
   * Public, read-only projection of active dataset notifications. The caller
   * supplies topic names only; subscriber identities and delivery preferences
   * remain in the consuming BFF and never enter SOS Gateway persistence.
   */
  router.post('/api/public-notifications/search', async (req, res) => {
    if (!(await isDiscoveryPublicationOperational('host'))) {
      return res.status(503).type('text').send('Service Unavailable');
    }
    const hostDid = await tenantsCacheManager.getDidDocument('host');
    if (!hostDid?.id) return res.status(503).type('text').send('Service Unavailable');
    const datasetNames = Array.from(new Set((Array.isArray(req.body?.datasetNames) ? req.body.datasetNames : [])
      .map((value: unknown) => String(value || '').trim().toLowerCase())
      .filter((value: string) => /^[a-z0-9-]+(?:_[a-z0-9-]+)+$/.test(value)))) as string[];
    if (!datasetNames.length || datasetNames.length > 50) {
      return res.status(400).json({ error: 'datasetNames must contain between 1 and 50 valid public topics.' });
    }
    const requested = new Set(datasetNames);
    const notifications: any[] = [];
    for (const tenant of await tenantsCacheManager.listAutodiscoverableTenants()) {
      const tenantId = String(tenant?.claims?.[ClaimsOrganizationSchemaorg.alternateName] || '').trim();
      const sector = parseCategory(getTenantServiceClaim(tenant, ClaimsServiceSchemaorg.category));
      if (!tenantId || !sector) continue;
      const vaultId = getTenantVaultId(sector, tenantId);
      const collectionName = String(tenant?.collectionName || await tenantsCacheManager.getCollectionName(vaultId) || '');
      if (!collectionName) continue;
      const tenantJurisdiction = String(await tenantsCacheManager.getTenantJurisdiction(vaultId) || '').toUpperCase();
      const records = await vaultRepository.listContainersInSection<import('gdc-common-utils-ts/models/confidential-storage').ConfidentialStorageDoc>(collectionName, 'care-communication-requests');
      const documentRecords = await vaultRepository.listContainersInSection<import('gdc-common-utils-ts/models/confidential-storage').ConfidentialStorageDoc>(collectionName, 'organization-document-references');
      const documents = new Map<string, FlatClaims>();
      for (const record of documentRecords) {
        try {
          const content = await kmsService.unprotectConfidentialData<any>(record, vaultId);
          const claims = readClaimsOnlyContent(content);
          if (claims) documents.set(record.id, claims);
        } catch { continue; }
      }
      for (const record of records) {
        try {
          const content = await kmsService.unprotectConfidentialData<any>(record, vaultId);
          const claims = readClaimsOnlyContent(content);
          if (!claims) continue;
          const one = (name: string) => {
            const value = claims[name];
            const values = (Array.isArray(value) ? value : [value]).map(String).map(item => item.trim()).filter(Boolean);
            return values.length === 1 ? values[0] : '';
          };
          const many = (name: string) => (Array.isArray(claims[name]) ? claims[name] as unknown[] : claims[name] === undefined ? [] : [claims[name]]).map(String);
          const datasetName = one(PublicAlertOperationalClaim.DatasetName).toLowerCase();
          const validUntil = one(CommunicationRequestClaim.OccurrencePeriodEnd);
          if (!requested.has(datasetName) || one(CommunicationRequestClaim.Status) !== 'active' || Date.parse(validUntil) <= Date.now()) continue;
          const payloadReference = one(CommunicationRequestClaim.PayloadReference);
          const payloadClaims = documents.get(payloadReference.replace(/^DocumentReference\//u, ''));
          const rawPayloadContentType = payloadClaims?.[DocumentReferenceClaim.ContentType];
          const payloadContentType = String(Array.isArray(rawPayloadContentType) ? rawPayloadContentType[0] || '' : rawPayloadContentType || '').trim();
          const payloadData = Array.isArray(payloadClaims?.[DocumentReferenceClaim.ContentData])
            ? String(payloadClaims?.[DocumentReferenceClaim.ContentData]?.[0] || '')
            : String(payloadClaims?.[DocumentReferenceClaim.ContentData] || '');
          if (payloadContentType !== 'text/markdown' || !payloadData) continue;
          notifications.push({
            notificationId: record.id, datasetName,
            issuerReference: one(CommunicationRequestClaim.InformationProvider),
            issuerName: String(tenant?.claims?.[ClaimsOrganizationSchemaorg.name] || tenantId),
            subject: one(CommunicationRequestClaim.Note),
            bodyMarkdown: Buffer.from(payloadData, 'base64').toString('utf8'),
            attachmentReferences: many(CommunicationRequestClaim.About),
            locations: [tenantJurisdiction].filter(Boolean),
            publishedAt: one(CommunicationRequestClaim.AuthoredOn), validUntil,
          });
        } catch {
          continue;
        }
      }
    }
    notifications.sort((left, right) => String(right.publishedAt).localeCompare(String(left.publishedAt)));
    return res.json({ notifications });
  });

  router.get(buildGwCatalogArtifactPath({
    participantId: 'host',
    jurisdiction: ':hostCoverageScope',
    version: ':version',
    hostNetwork: ':hostNetwork',
  }), async (req, res) => {
    if (!(await isDiscoveryPublicationOperational('host'))) {
      return res.status(503).type('text').send('Service Unavailable');
    }
    const hostDid = await tenantsCacheManager.getDidDocument('host');
    if (!hostDid?.id) return res.status(503).type('text').send('Service Unavailable');

    const allTenants = await tenantsCacheManager.listAutodiscoverableTenants();
    const datasets = filterProviderDatasets(allTenants
      .map(toProviderDataset)
      .filter((d): d is ProviderDataset => !!d));
    const publicOrigin = buildPublicOrigin(req);
    const catalogBaseUrl = buildAbsoluteUrl(publicOrigin, buildGwCatalogCollectionPath({
      participantId: 'host',
      jurisdiction: req.params.hostCoverageScope,
      version: req.params.version,
      hostNetwork: req.params.hostNetwork,
    }));
    res.json(buildCatalog(catalogBaseUrl, publicOrigin, datasets));
  });

  router.get(buildGwCatalogDatasetPath({
    participantId: 'host',
    jurisdiction: ':hostCoverageScope',
    version: ':version',
    hostNetwork: ':hostNetwork',
  }, ':id'), async (req, res) => {
    if (!(await isDiscoveryPublicationOperational('host'))) {
      return res.status(503).type('text').send('Service Unavailable');
    }
    const hostDid = await tenantsCacheManager.getDidDocument('host');
    if (!hostDid?.id) return res.status(503).type('text').send('Service Unavailable');

    const allTenants = await tenantsCacheManager.listAutodiscoverableTenants();
    const datasets = filterProviderDatasets(allTenants
      .map(toProviderDataset)
      .filter((d): d is ProviderDataset => !!d));
    const dataset = datasets.find((d) => d.datasetId === req.params.id);
    if (!dataset) return res.status(404).type('text').send('Not Found');

    const publicOrigin = buildPublicOrigin(req);
    const catalogBaseUrl = buildAbsoluteUrl(publicOrigin, buildGwCatalogCollectionPath({
      participantId: 'host',
      jurisdiction: req.params.hostCoverageScope,
      version: req.params.version,
      hostNetwork: req.params.hostNetwork,
    }));
    const [single] = buildCatalog(catalogBaseUrl, publicOrigin, [dataset])['dcat:dataset'];
    res.json(single);
  });

  router.get(buildGwDspaceVersionWellKnownPath({
    tenantId: ':tenantId',
    jurisdiction: ':jurisdiction',
    version: ':version',
    sector: ':sector',
  }), resolveTenant, async (req, res) => {
    if (!(await isDiscoveryPublicationOperational(res.locals.vaultId))) {
      return res.status(404).type('text').send('Not Found');
    }

    res.json(buildDspaceVersionMetadata(buildGwDataspaceBasePath({
      tenantId: req.params.tenantId,
      jurisdiction: req.params.jurisdiction,
      version: req.params.version,
      sector: req.params.sector,
    })));
  });

  router.post(buildGwCatalogRequestPath({
    tenantId: ':tenantId',
    jurisdiction: ':jurisdiction',
    version: ':version',
    sector: ':sector',
  }), resolveTenant, async (req, res) => {
    if (!(await isDiscoveryPublicationOperational(res.locals.vaultId))) {
      return res.status(404).type('text').send('Not Found');
    }
    const tenantConfig = await tenantsCacheManager.getTenant(res.locals.vaultId);
    const dataset = toProviderDataset(tenantConfig);
    if (!dataset) return res.status(404).type('text').send('Not Found');
    const filtered = filterDatasets([dataset], req.body?.filters);

    const publicOrigin = buildPublicOrigin(req);
    const catalogBaseUrl = buildAbsoluteUrl(publicOrigin, buildGwCatalogCollectionPath({
      tenantId: req.params.tenantId,
      jurisdiction: req.params.jurisdiction,
      version: req.params.version,
      sector: req.params.sector,
    }));
    res.json(buildCatalog(catalogBaseUrl, publicOrigin, filtered));
  });

  router.get(buildGwCatalogArtifactPath({
    tenantId: ':tenantId',
    jurisdiction: ':jurisdiction',
    version: ':version',
    sector: ':sector',
  }), resolveTenant, async (req, res) => {
    if (!(await isDiscoveryPublicationOperational(res.locals.vaultId))) {
      return res.status(404).type('text').send('Not Found');
    }
    const tenantConfig = await tenantsCacheManager.getTenant(res.locals.vaultId);
    const dataset = toProviderDataset(tenantConfig);
    if (!dataset) return res.status(404).type('text').send('Not Found');

    const publicOrigin = buildPublicOrigin(req);
    const catalogBaseUrl = buildAbsoluteUrl(publicOrigin, buildGwCatalogCollectionPath({
      tenantId: req.params.tenantId,
      jurisdiction: req.params.jurisdiction,
      version: req.params.version,
      sector: req.params.sector,
    }));
    res.json(buildCatalog(catalogBaseUrl, publicOrigin, [dataset]));
  });

  router.get(buildGwCatalogDatasetPath({
    tenantId: ':tenantId',
    jurisdiction: ':jurisdiction',
    version: ':version',
    sector: ':sector',
  }, ':id'), resolveTenant, async (req, res) => {
    if (!(await isDiscoveryPublicationOperational(res.locals.vaultId))) {
      return res.status(404).type('text').send('Not Found');
    }
    const tenantConfig = await tenantsCacheManager.getTenant(res.locals.vaultId);
    const dataset = toProviderDataset(tenantConfig);
    if (!dataset || dataset.datasetId !== req.params.id) return res.status(404).type('text').send('Not Found');

    const publicOrigin = buildPublicOrigin(req);
    const catalogBaseUrl = buildAbsoluteUrl(publicOrigin, buildGwCatalogCollectionPath({
      tenantId: req.params.tenantId,
      jurisdiction: req.params.jurisdiction,
      version: req.params.version,
      sector: req.params.sector,
    }));
    const [single] = buildCatalog(catalogBaseUrl, publicOrigin, [dataset])['dcat:dataset'];
    res.json(single);
  });

  // --- FHIR-Specific Endpoints ---
  const checkFhirSector = async (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const sector = await tenantsCacheManager.getTenantSector(res.locals.vaultId);
    if (isFhirSector(sector)) {
      return next();
    }
    res.status(404).type('text').send('Not Found');
  };

  router.get([`${hostScopedWellKnownPrefix}/smart-configuration`, `${tenantWellKnownPrefix}/smart-configuration`], resolveTenant, checkFhirSector, async (req, res) => {
    const config = await discoveryService.getSmartConfiguration(res.locals.vaultId);
    if (config) {
      res.json(config);
    } else {
      res.status(404).type('text').send('Not Found');
    }
  });
  
  const tenantFhirBasePath = '/:tenantId/cds-:jurisdiction/:version/:sector/:section/:format';

  /** Publishes discovery for the exact tenant, sector, section and FHIR format base. */
  router.get(`${tenantFhirBasePath}/metadata`, resolveTenant, checkFhirSector, async (req, res) => {
    const statement = await discoveryService.getCapabilityStatement(res.locals.vaultId, {
      section: req.params.section,
      format: req.params.format,
    });
    if (statement) {
      res.json(statement);
    } else {
      res.status(404).type('text').send('Not Found');
    }
  });

  router.get(`${tenantFhirBasePath}/.well-known/smart-configuration`, resolveTenant, checkFhirSector, async (req, res) => {
    const config = await discoveryService.getSmartConfiguration(res.locals.vaultId, {
      section: req.params.section,
      format: req.params.format,
    });
    if (config) {
      res.json(config);
    } else {
      res.status(404).type('text').send('Not Found');
    }
  });
  return router;
}
