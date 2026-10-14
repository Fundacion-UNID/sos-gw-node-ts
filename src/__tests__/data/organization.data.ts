// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.
// Always create JSDoc, do not use strings inline in keys nor values, use types instead, and reuse the data test examples.
// File: src/__tests__/data/organization.data.ts

import { OrganizationConfig } from "../../gdc-backend-utils-node/models/entity";
import { URN_NAMESPACE, URN_NETWORK, URN_VERSION } from "./urn.data";
import { ClaimsOrganizationSchemaorg, ClaimsPersonSchemaorg, ClaimsServiceSchemaorg } from "gdc-common-utils-ts/constants/schemaorg";
import { serializeServiceCapabilityTokens, ServiceCapability } from "gdc-common-utils-ts/constants/service-capabilities";
import { Sector } from "gdc-common-utils-ts/models/urlPath";
import { EntityLifecycleStatus, EntityType } from "../../gdc-backend-utils-node/models/enums";
import { testTenant1Vc } from "./credential.data";
import { testHostDidWeb, testRootOrgDidWeb, testHostDomain, testTenant1IdentifierUrn } from "./organization.constants";

/**
 * This file contains foundational data objects for test organizations.
 * It defines the atomic constants that are imported by other test files,
 * including `example-payloads.ts`, to ensure a single source of truth.
 */

// ===================================================================================
// RAW CLAIM SETS
// ===================================================================================

/**
 * The canonical set of claims for registering a new tenant.
 * This is the source of truth for values used in ORGANIZATION_REGISTRATION_REQUEST.
 */
export const testDefaultTenantServiceTypeClaim = serializeServiceCapabilityTokens([
  ServiceCapability.IndexProvider,
  ServiceCapability.DigitalTwinReader,
]) as string;

export const testDefaultHostServiceTypeClaim = serializeServiceCapabilityTokens([
  ServiceCapability.OrganizationRegistryProvider,
]) as string;

export const testClaimsRegisterTenantExpanded = {
  [ClaimsOrganizationSchemaorg.addressCountry]: "ES",
  [ClaimsOrganizationSchemaorg.alternateName]: "acme-id",
  [ClaimsOrganizationSchemaorg.identifierType]: "TAX",
  [ClaimsOrganizationSchemaorg.identifierValue]: "acme-id",
  [ClaimsOrganizationSchemaorg.legalName]: "Acme Organization SL",
  [ClaimsOrganizationSchemaorg.name]: "Acme Org",
  [ClaimsOrganizationSchemaorg.numberOfEmployees]: 2,
  [ClaimsOrganizationSchemaorg.url]: "api.acme.org",
  [ClaimsPersonSchemaorg.email]: "admin1@acme.org",
  [ClaimsPersonSchemaorg.hasOccupation]: "ISCO-08|1120",
  [ClaimsServiceSchemaorg.category]: "health-care",
  [ClaimsServiceSchemaorg.identifier]: "did:web:api-provider.example.com",
  [ClaimsServiceSchemaorg.serviceType]: testDefaultTenantServiceTypeClaim,
};

// ===================================================================================
// HOST ORGANIZATION DATA
// ===================================================================================
const testHostUuid = "d1d2d3d4-e5f6-7890-1234-567890abcdef";
export const testHostAlternateName = "host";
export const testHostAddressCountry = "ES";
export const testHostIdType = "TAX";
export const testHostIdValue = "A12345678";
export const testHostLegalName = "Hosting Organization";
export { testHostDomain, testHostDidWeb };
const testServiceManufacturerDidWebIdentifier = `urn:web:<manufacturer>`;
const testServiceManufacturerCategory = "system";
const testServiceManufacturerTerms = "https://github.com/<manufacturer>/<software>/terms";
const testServiceManufacturerPurposeType = testDefaultHostServiceTypeClaim;
export { testRootOrgDidWeb }; // https://testca.unid.es/.well-known/did.json

export const testConfigDataHost: OrganizationConfig = {
  id: testHostUuid,
  meta: { lastUpdated: '' },
  status: EntityLifecycleStatus.Active,
  type: EntityType.Organization,
  claims: {
    [ClaimsOrganizationSchemaorg.alternateName]: testHostAlternateName,
    [ClaimsOrganizationSchemaorg.legalName]: testHostLegalName,
    [ClaimsOrganizationSchemaorg.identifierType]: testHostIdType,
    [ClaimsOrganizationSchemaorg.identifierValue]: testHostIdValue,
    [ClaimsOrganizationSchemaorg.identifier]: testHostDidWeb,
    [ClaimsOrganizationSchemaorg.addressCountry]: testHostAddressCountry,
  },
  didConfig: { service:[] },
  didDocument: { '@context': ``, id: `` },
  provider: {
    service: {
      identifier: testServiceManufacturerDidWebIdentifier,
      sectorCategory: testServiceManufacturerCategory,
      serviceType: testServiceManufacturerPurposeType,
      termsOfService: testServiceManufacturerTerms,
    },
  },
  networkStatus: [], // Host does not participate in networks.
};

// ===================================================================================
// TENANT 1 ORGANIZATION DATA (DERIVED FROM `testClaimsRegisterTenantExpanded`)
// ===================================================================================
const testTenant1Uuid = "c1c2c3d4-e5f6-7890-1234-567890abcdef";
export const testTenant1LegalName = testClaimsRegisterTenantExpanded[ClaimsOrganizationSchemaorg.legalName];
export const testTenant1AddressCountry = testClaimsRegisterTenantExpanded[ClaimsOrganizationSchemaorg.addressCountry];
export const testTenant1IdType = testClaimsRegisterTenantExpanded[ClaimsOrganizationSchemaorg.identifierType];
export const testTenant1IdValue = testClaimsRegisterTenantExpanded[ClaimsOrganizationSchemaorg.identifierValue];
/**
 * Canonical tenant id used across legal-organization tests.
 *
 * For legal organizations in the current contract, tests should anchor on the
 * tax-id / identifier value (`acme-id` here), not on a separate marketing alias.
 */
export const testTenant1TenantId = testClaimsRegisterTenantExpanded[ClaimsOrganizationSchemaorg.identifierValue];
/**
 * Legacy compatibility alias. Prefer `testTenant1TenantId` in new tests.
 */
export const testTenant1AlternateName = testTenant1TenantId;
export const testTenant1Domain = testClaimsRegisterTenantExpanded[ClaimsOrganizationSchemaorg.url];
export const testTenant1ServiceProviderCategory = testClaimsRegisterTenantExpanded[ClaimsServiceSchemaorg.category] as Sector;
export const testTenant1Admin1Email = testClaimsRegisterTenantExpanded[ClaimsPersonSchemaorg.email] as string;

// --- EXPORTED FOR DEPENDENCIES ---
export const testTenant1UrlExternal = `https://${testTenant1Domain}/`;
export const testTenant1DidWebExternal = `did:web:${testTenant1Domain}`;
export const testTenant1DidWebHosted = `did:web:${testHostDomain}:${testTenant1AlternateName}:${testTenant1AddressCountry}:v1:${testTenant1ServiceProviderCategory}`;
export const testTenant1VaultId = `${testTenant1ServiceProviderCategory}_${testTenant1AlternateName}`;

export { testTenant1IdentifierUrn };

export const testConfigTenant1: OrganizationConfig = {
  id: testTenant1Uuid,
  meta: { lastUpdated: '' },
  status: EntityLifecycleStatus.Active,
  type: EntityType.Organization,
  claims: {
    [ClaimsOrganizationSchemaorg.legalName]: testTenant1LegalName,
    [ClaimsOrganizationSchemaorg.identifierType]: testTenant1IdType,
    [ClaimsOrganizationSchemaorg.identifierValue]: testTenant1IdValue,
    [ClaimsOrganizationSchemaorg.identifier]: testTenant1IdentifierUrn,
    [ClaimsOrganizationSchemaorg.alternateName]: testTenant1AlternateName,
    [ClaimsOrganizationSchemaorg.addressCountry]: testTenant1AddressCountry,
  },
  didConfig: { service:[] },
  didDocument: { '@context': ``, id: `` },  
  provider: {
    service: {
      category: testTenant1ServiceProviderCategory,
      serviceType: testDefaultTenantServiceTypeClaim,
    },
  },
  networkStatus: [], // This is populated by the manager during the registration flow.
  verifiablePresentation: [testTenant1Vc]
};
