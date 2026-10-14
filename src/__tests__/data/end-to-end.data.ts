// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.
// File: src/__test__/data/end-to-end.data.ts

import { ClaimsRecord } from 'gdc-common-utils-ts/models/resource-document';
import { ClaimsOrganizationSchemaorg, ClaimsServiceSchemaorg } from 'gdc-common-utils-ts/constants/schemaorg';
import {
  testHostAdmin1,
  testTenant1Admin1,
  testTenant1Firefighter1,
  testTenant1Nurse1,
  testClaimsHostAdmin1,
  testClaimsEmployeeAdminTenant1,
} from './employee.data';
import {
  testConfigDataHost,
  testConfigTenant1,
  testTenant1AddressCountry,
  testTenant1Admin1Email,
  testTenant1AlternateName,
  testTenant1Domain,
  testTenant1IdType,
  testTenant1IdValue,
  testTenant1LegalName,
  testTenant1ServiceProviderCategory,
  testTenant1IdentifierUrn,
} from './organization.data';

// ===================================================================================
// GROUPED & EXPORTED TEST DATA OBJECTS
// ===================================================================================

export const testHostData = {
  ...testConfigDataHost,
  member: {
    admin1: testHostAdmin1,
  },
};

export const testTenant1Data = {
  ...testConfigTenant1,
  identifier: testTenant1IdentifierUrn,
  member: {
    admin1: testTenant1Admin1,
    // receptionist1: testTenant1Receptionist1,
    firefighter1: testTenant1Firefighter1,
    nurse1: testTenant1Nurse1,
  },
};

// ===================================================================================
// PRE-BUILT CLAIM SETS FOR TESTS
// ===================================================================================

/**
 * Valid claims for the 'host' organization's initial setup.
 */
export const testClaimsHostInitialization: ClaimsRecord = {
  ...(testConfigDataHost.claims as ClaimsRecord),
  ...testClaimsHostAdmin1,
  [ClaimsServiceSchemaorg.category]: 'system',
  [ClaimsServiceSchemaorg.identifier]: (testConfigDataHost.provider as any).service.identifier,
  [ClaimsServiceSchemaorg.serviceType]: (testConfigDataHost.provider as any).service.serviceType,
  [ClaimsServiceSchemaorg.termsOfService]: (testConfigDataHost.provider as any).service.termsOfService,
};

/**
 * A complete and valid set of claims for registering a new tenant ('acme').
 * This is the canonical, flat claims object that the HostingManager expects to receive.
 * It is built from granular constants to ensure correctness.
 */
export const testClaimsTenant1Registration: ClaimsRecord = {
  // --- Organization Claims ---
  [ClaimsOrganizationSchemaorg.legalName]: testTenant1LegalName,
  [ClaimsOrganizationSchemaorg.addressCountry]: testTenant1AddressCountry,
  [ClaimsOrganizationSchemaorg.identifier]: testTenant1IdentifierUrn,
  [ClaimsOrganizationSchemaorg.identifierType]: testTenant1IdType,
  [ClaimsOrganizationSchemaorg.identifierValue]: testTenant1IdValue,
  [ClaimsOrganizationSchemaorg.url]: testTenant1Domain,
  [ClaimsOrganizationSchemaorg.alternateName]: testTenant1AlternateName,
  [ClaimsOrganizationSchemaorg.numberOfEmployees]: 2, // Add employee count for offer generation

  // --- Person (Admin) Claims ---
  ...testClaimsEmployeeAdminTenant1,

  // --- Service Claims ---
  [ClaimsServiceSchemaorg.category]: testTenant1ServiceProviderCategory,
  [ClaimsServiceSchemaorg.identifier]: (testConfigTenant1.provider as any).service.identifier,
  [ClaimsServiceSchemaorg.termsOfService]: (testConfigTenant1.provider as any).service.termsOfService,
  [ClaimsServiceSchemaorg.serviceType]: (testConfigTenant1.provider as any).service.serviceType,
};

/**
 *  A full, well-formed input payload for a tenant registration, matching the structure expected by the API.
 *  Note the legal representative is not registered so it is using as issuer the email address:
 *  - a `bearer` token will be provider;
 *  - the `evidence` of the email in the `bearer`can be included in the verifiable credential for the legal representative.
 */
export const testPayloadCreateTenant1 = {
  thid: `thid-${testConfigTenant1.id}`,
  iss: `urn:email:${testTenant1Admin1Email}`,
  aud: 'did:web:host.example.com',
  type: 'api+json',
  body: {
    data: [
      {
        type: 'Organization-registration-form-v1.0',
        resource: {
          meta: {
            claims: testClaimsTenant1Registration,
          },
        },
      },
    ],
  },
};

/**
 * Claims for a tenant with an invalid alternateName ('host' is not allowed as prefix or suffix for tenants)
 */
export const testClaimsTenant1AlternateNameInvalidPrefix = {
  ...testClaimsTenant1Registration,
  [ClaimsOrganizationSchemaorg.alternateName]: 'hosting-tenant-1',
};
