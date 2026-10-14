// src/utils/tenant.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

import { ClaimsOrganizationSchemaorg, ClaimsServiceSchemaorg } from 'gdc-common-utils-ts/constants/schemaorg';
import { ClaimsRecord } from 'gdc-common-utils-ts/models/resource-document';
import { Sector } from 'gdc-common-utils-ts/models/urlPath';
import { scopePhysicalCollectionName } from '../config/storage-layout';

/**
 * Resolves the legal jurisdiction that owns an organization's official ID.
 * ISO 3166-2 evidence is authoritative for regional identifiers; otherwise
 * the ISO 3166-1 country remains the route jurisdiction.
 */
export function resolveOrganizationRouteJurisdiction(claims: ClaimsRecord): string {
  const country = String(claims[ClaimsOrganizationSchemaorg.addressCountry] || '').trim().toUpperCase();
  const region = String(claims[ClaimsOrganizationSchemaorg.addressRegion] || '').trim().toUpperCase();
  if (/^[A-Z]{2}-[A-Z0-9]{1,3}$/.test(region) && region.startsWith(`${country}-`)) return region;
  return country;
}

/**
 * Generates the deterministic, physical collection name for a tenant's vault in Firestore.
 * This name is derived from the tenant's core, immutable claims. This function is the single
 * source of truth for collection naming and is used by the `TenantsCacheManager` to populate
 * its cache.
 *
 * `legacy-v1` preserves `[countryCode]_[idType]_[idValue]_[sector]` exactly.
 * `scoped-v2` prefixes that physical collection with the explicit deployment,
 * ledger-mode and host storage scope.
 *
 * @param claims The claims object from the tenant's `EntityConfig`. Must contain the required schema.org properties.
 * @returns The physical collection name for the tenant's vault.
 * @throws An error if any of the required claims are missing.
 */
export function generateTenantCollectionNameFromClaims(claims: ClaimsRecord): string {
  const countryCode = resolveOrganizationRouteJurisdiction(claims);
  const idType = claims[ClaimsOrganizationSchemaorg.identifierType];
  const idValue = claims[ClaimsOrganizationSchemaorg.identifierValue];
  const sector = claims[ClaimsServiceSchemaorg.category];

  if (!countryCode || !idType || !idValue || !sector) {
    throw new Error(
      `Cannot generate collection name: one or more required claims are missing. ` +
      `countryCode: ${countryCode}, idType: ${idType}, idValue: ${idValue}, sector: ${sector}`
    );
  }

  // Normalize and clean the values to ensure they are valid for Firestore collection names.
  const cleanCountry = String(countryCode).toUpperCase().trim();
  const cleanIdType = String(idType).toUpperCase().trim();
  const cleanIdValue = String(idValue).replace(/[^a-zA-Z0-9]/g, '').trim(); // Remove special chars
  const cleanSector = String(sector).toLowerCase().trim();
  
  return scopePhysicalCollectionName(`${cleanCountry}_${cleanIdType}_${cleanIdValue}_${cleanSector}`);
}

  /**


/**
 * Constructs the unique vault identifier for a tenant from its sector and alternate name.
 *
 * @param sector {string} The BUSINESS sector of the tenant (e.g., 'health-care', 'animal-health').
 *   - WARNING: This must NEVER be a network sector ('test', 'test-network', 'network').
 *   - TODO: If you ever change this logic, audit all usages for sector confusion.
 * @param alternateName {string} The unique alternate name of the tenant (e.g., 'acme-health-us').
 * @returns {string} A composite string in the format `sector_alternateName`.
 */
export function getTenantVaultId(sector: string, alternateName: string): string {
  if (!sector || !alternateName) {
    throw new Error('Both sector and alternateName are required to create a tenant vault ID.');
  }
  // Only BUSINESS sector is valid here!
  // TODO: If sector is a network sector, throw or log a warning.
  return `${sector}_${alternateName}`;
}


/**
 * Validates a tenant's alternateName to ensure it doesn't conflict with reserved patterns.
 * @param alternateName The alternateName to validate.
 * @returns True if the alternateName is valid, false otherwise.
 */
export function isValidTenantAlternateName(alternateName: string): boolean {
  if (!alternateName) {
    return false;
  }
  // Underscore is a reserved character for the vaultId separator.
  if (alternateName.includes('_')) {
    return false;
  }
  const lowerName = alternateName.toLowerCase();
  if (lowerName === "host" || lowerName.startsWith("host") || lowerName.endsWith("host")) {
    return false;
  }
  return true;
}

/**
 * Extracts the canonical identifier URN from a claims object.
 * @param claims The claims object from an entity configuration.
 * @returns The URN string, or undefined if not found.
 */
export function getIdentifierUrnFromClaims(claims: any): string | undefined {
  if (!claims) {
    return undefined;
  }
  return claims[ClaimsOrganizationSchemaorg.identifier] as string;
}


/**

/**
 * Parses a DID (`did:web`) of a hosted entity (Employee, Individual) to extract 
 * the components needed to form the parent tenant's vault ID.
 *
 * Example: `did:web:provider.com:acme:cds-es:v1:health-care:employee:admin` -> `health-care_acme`
 *
 * IMPORTANT: The sector extracted here is always the BUSINESS sector.
 *
 * @param iss The issuer DID string.
 * @returns The composite vault ID string.
 * @throws An error if the DID format is not a supported hosted DID format.
 */
export function getTenantVaultIdFromIss(iss: string): string {
  const parts = iss.split(':');
  // Minimum parts for a hosted DID: did:web:domain:tenant:cds-xx:v1:sector...
  if (parts.length < 7 || parts[0] !== 'did' || parts[1] !== 'web') {
    throw new Error(`Invalid or unsupported DID format for issuer: ${iss}`);
  }
  const tenantId = parts[3];
  const sector = parts[6]; // BUSINESS sector only
  if (!sector || !tenantId) {
    throw new Error(`Could not extract sector and tenantId from DID: ${iss}`);
  }
  return getTenantVaultId(sector, tenantId);
}
