// src/utils/did-document.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

import { DidService, ServiceEndpointSelector } from 'gdc-common-utils-ts/models/did';
import { generateServiceId } from 'gdc-common-utils-ts/utils/did';

/**
 * Creates the standard, public-facing "well-known" service endpoints for a DID Document.
 * These are essential for standard DID resolution and discovery.
 */
function createWellKnownDidServices(did: string, baseUrl: string): DidService[] {
  // The final base URL for well-known services should not have a trailing slash.
  const finalBaseUrl = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
  return [
    {
      id: `${did}#did-document`,
      type: 'LinkedDomains',
      serviceEndpoint: `${finalBaseUrl}/.well-known/did.json`,
    },
    {
      id: `${did}#jwks`,
      type: 'JsonWebKeyService2020',
      serviceEndpoint: `${finalBaseUrl}/jwks.json`,
    },
  ];
}

function stripTrailingSlash(url: string): string {
  return url.endsWith('/') ? url.slice(0, -1) : url;
}

function ensureHostedContextBaseUrl(baseUrl: string, contextualPath: string): string {
  const normalizedBaseUrl = stripTrailingSlash(baseUrl);
  const normalizedContextualPath = contextualPath.replace(/^\/+/, '');
  if (!normalizedContextualPath) {
    return normalizedBaseUrl;
  }
  const contextualSuffix = `/${normalizedContextualPath}`;
  return normalizedBaseUrl.toLowerCase().endsWith(contextualSuffix.toLowerCase())
    ? normalizedBaseUrl
    : `${normalizedBaseUrl}${contextualSuffix}`;
}

function buildTenantContextPath(tenantContext: { alternateName: string; jurisdiction: string; version: string; sector: string; }): string {
  return `${tenantContext.alternateName}/cds-${tenantContext.jurisdiction}/${tenantContext.version}/${tenantContext.sector}`;
}

/**
 * Assembles the final `service` array for a public DID Document by "multiplexing"
 * the internal service configuration into multiple, discrete public endpoints.
 *
 * This function takes logical service definitions from `didConfig.service` and expands them
 * into an array of specific, invokable service endpoints for the public DID Document,
 * correctly constructing the URL based on whether the tenant is hosted or has its own domain.
 *
 * @param {string} did The canonical DID of the entity.
 * @param {string} baseUrl The authoritative base URL (e.g., `https://gateway.com` or `https://api.acme.com`).
 * @param {DidService[]} businessServicesConfig The array of logical business services from `didConfig.service`.
 * @param {boolean} isHosted A flag indicating if the tenant's endpoints are hosted on the gateway.
 * @param {object} tenantContext Contains path components (`alternateName`, `jurisdiction`, etc.) for hosted tenants.
 * @returns {DidService[]} A complete and merged array of `DidService` objects for the public `didDocument`.
 */
export function populateDidDocumentServices(
  did: string,
  publicBaseUrl: string,
  businessServicesConfig: DidService[],
  isHosted: boolean,
  tenantContext: { alternateName: string; jurisdiction: string; version: string; sector: string; },
  operationalBaseUrl?: string,
): DidService[] {
  const normalizedPublicBaseUrl = stripTrailingSlash(publicBaseUrl);
  const normalizedOperationalBaseUrl = stripTrailingSlash(operationalBaseUrl || publicBaseUrl);
  const contextualPath = isHosted ? buildTenantContextPath(tenantContext) : '';

  // For hosted tenants, the well-known endpoints are at the root of their full contextual path.
  // For own-domain tenants, they are at the root of their domain.
  const wellKnownBaseUrl = isHosted
    ? ensureHostedContextBaseUrl(normalizedPublicBaseUrl, contextualPath)
    : normalizedPublicBaseUrl;

  // 1. Create the standard, W3C-compliant well-known services.
  const wellKnownServices = createWellKnownDidServices(did, wellKnownBaseUrl);

  // 2. Multiplex the internal business service templates into discrete, public service endpoints.
  const populatedBusinessServices: DidService[] = businessServicesConfig.flatMap(configService => {
    const selector = (configService as any).selector as Pick<ServiceEndpointSelector, 'section' | 'format'> | undefined;

    // Backward-compat fallback for legacy configs that encoded section/format in `id`.
    let section = selector?.section;
    let format = selector?.format;
    if (!section || !format) {
      if (configService.id.startsWith('#')) {
        const parts = configService.id.slice(1).split(':');
        section = parts[0];
        format = parts[1];
      } else {
        const parts = configService.id.split(':'); // legacy: v1:sector:section:format[:resourceType]
        section = parts[2];
        format = parts[3];
      }
    }

    // Explicit service entries (no selector/actions multiplexing):
    // keep the provided type and resolve endpoint as absolute URL or path relative to tenant base URL.
    if (!section || !format) {
      const rawEndpoint = String(configService.serviceEndpoint || '').trim();
      if (!rawEndpoint) return [];
      let resolvedEndpoint = rawEndpoint;
      if (!/^https?:\/\//i.test(rawEndpoint)) {
        const relativePath = rawEndpoint.startsWith('/') ? rawEndpoint : `/${rawEndpoint}`;
        resolvedEndpoint = `${wellKnownBaseUrl}${relativePath}`;
      }
      const serviceId = String(configService.id || '').startsWith('#') ? `${did}${configService.id}` : String(configService.id || `${did}#service`);
      return [{
        id: serviceId,
        type: configService.type,
        serviceEndpoint: resolvedEndpoint,
      }];
    }

    const resourceTypes = (configService.serviceEndpoint as string).split(',').map((s) => s.trim()).filter(Boolean);
    const actions = (configService.actions || []).map((a: string) => a.trim()).filter(Boolean);
    
    // This is the core multiplexing logic.
    return resourceTypes.flatMap(resourceType => {
      return actions.map((action: string) => {
        const functionalPath = `${section}/${format}/${resourceType}/${action}`;

        let serviceEndpointUrl: string;
        if (isHosted) {
          // A hosted tenant's public DID may resolve on one domain while the callable API lives on another.
          serviceEndpointUrl = `${ensureHostedContextBaseUrl(normalizedOperationalBaseUrl, contextualPath)}/${functionalPath}`;
        } else {
          // An own-domain tenant's URL is simple and functional.
          serviceEndpointUrl = `${normalizedOperationalBaseUrl}/${functionalPath}`;
        }

        // Return the final, public service object.
        return {
          id: `${did}${generateServiceId({ section, format, resourceType, action })}`,
          type: configService.type,
          serviceEndpoint: serviceEndpointUrl,
        };
      });
    });
  });

  // 3. Combine the well-known services with all the new, populated business services.
  return [...wellKnownServices, ...populatedBusinessServices];
}
