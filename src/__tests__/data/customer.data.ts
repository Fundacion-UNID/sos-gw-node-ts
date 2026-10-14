// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.
// File: src/__tests__/data/customer.data.ts

import { ClaimsPersonSchemaorg } from 'gdc-common-utils-ts/constants/schemaorg';
import { testTenant1DidWebExternal, testTenant1IdentifierUrn } from './organization.data';

// ===================================================================================
// DATA DEFINITIONS
// ===================================================================================

// --- Tenant 1 - Customer 1 Details ---
export const testCustomer1Uuid = '8e0d846a-2492-4b9c-8a4e-5e065fb6ba76';
// This is the base58btc encoding of the 16 bytes of the UUID above.
export const testCustomer1MultibaseUuid = 'zJYPtJu5ToJ4NyQttkq1mmo';

export const testCustomer1Data = {
    uuidIdentifier: `urn:uuid:${testCustomer1Uuid}`,
    base58Identitier: testCustomer1MultibaseUuid, // Keep for backward compatibility if needed
    email: `customer1@example.com`,
    phone: "+34600123456",
    givenName: "Joseph",
    familyName: "Doe",
    additionalName: "Mother's Maiden Name",
    alternateName: "Joe", // short name
    name: "JOSEPH DOE MOTHERS MAIDEN NAME", // ICAO transliteration
    sectorCategory: "health-care",
    birthDate: "1990-01-15", // "dob"
    officialIdType: "NNES", // 2-letter ISO country instead of HL7 3-letters (NNESP)
    officialIdValue: "12345678X",
    digestValue: "a1B2c3D4e5F6a1B2c3D4e5F6a1B2c3D4e5F6a1B2c3D4e5F6"
};

// The URN is the authoritative identifier provided in the claims.
export const testCustomer1Urn = `${testTenant1IdentifierUrn}:individual:multibase:${testCustomer1MultibaseUuid}`;
export const testCustomer1DidWeb = `${testTenant1DidWebExternal}:individual:multibase:${testCustomer1MultibaseUuid}`;

// ===================================================================================
// PRE-BUILT CLAIM SETS
// ===================================================================================

export const testClaimsCustomer1 = {
    // IMPORTANT: The 'identifier' claim passed into the manager is the semantic URN.
    // The manager then uses `determineResourceId` to get the UUID part for internal use.
    [ClaimsPersonSchemaorg.identifier]: `urn:uuid:${testCustomer1Uuid}`,
    [ClaimsPersonSchemaorg.email]: testCustomer1Data.email,
    [ClaimsPersonSchemaorg.givenName]: testCustomer1Data.givenName,
    [ClaimsPersonSchemaorg.familyName]: testCustomer1Data.familyName,
};

export const testDiscoveryCustomer1 = {
    // IMPORTANT: The 'identifier' claim passed into the manager is the semantic URN.
    // The manager then uses `determineResourceId` to get the UUID part for internal use.
    [ClaimsPersonSchemaorg.identifier]: `urn:uuid:${testCustomer1Uuid}`,
    [ClaimsPersonSchemaorg.email]: testCustomer1Data.email,
    [ClaimsPersonSchemaorg.givenName]: testCustomer1Data.givenName,
    [ClaimsPersonSchemaorg.familyName]: testCustomer1Data.familyName,
};