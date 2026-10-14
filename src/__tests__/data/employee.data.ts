// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.
// File: src/__tests__/data/employee.data.ts
import { JobRequest, JobStatus } from 'gdc-common-utils-ts/models/confidential-job';
import { ClaimsRecord } from 'gdc-common-utils-ts/models/resource-document';
import { ClaimsPersonSchemaorg } from 'gdc-common-utils-ts/constants/schemaorg';
import { testTenant1DidWebExternal, testTenant1Domain, testTenant1IdentifierUrn } from './organization.data';

/**
*  IMPORTANT!
*  The `hasOccupation` property can be a comma-separated list when more than one role is active at the same time for the same email address.
*/

// ===================================================================================
// DATA DEFINITIONS
// ===================================================================================

// --- Host Admin 1 Details (controller) ---
export const testHostAdmin1 = {
    mockedUuid: "host-admin1-id",
    uuid: "a1b2c3d4-e5f6-7890-1234-567890abcdef",
    identifier: "urn:uuid:a1b2c3d4-e5f6-7890-1234-567890abcdef",
    email: "admin1@host.example.com",
    hasOccupation: "ISCO-08|1120",
};

// --- Tenant 1 - Admin 1 Details (controller) ---
export const testTenant1Admin1 = {
    mockedUuid: "acme-admin1-id",
    uuid: "b1b2c3d4-e5f6-7890-1234-567890abcdef",
    identifier: "urn:uuid:b1b2c3d4-e5f6-7890-1234-567890abcdef",
    email: "admin1@acme.example.com",
    hasOccupation: "ISCO-08|1120",
};

// --- Tenant 1 - Receptionist 1 Details ---
export const testTenant1Receptionist1Email = `receptionist1@${testTenant1Domain}`;
export const testTenant1Receptionist1HasOccupation = "ISCO-08|4226";

/** e.g.: "urn:antifraud:test-network:US:v1:health-care:entity:EI:98-7654321:employee:receptionist1@api.acme.org:role:ISCO-08|4226" */
export const testTenant1Receptionist1Urn = `${testTenant1IdentifierUrn}:employee:${testTenant1Receptionist1Email}:role:${testTenant1Receptionist1HasOccupation}`
export const testTenant1Receptionist1DidExternal = `${testTenant1DidWebExternal}:employee:${testTenant1Receptionist1Email}:role:${testTenant1Receptionist1HasOccupation}`

// --- Tenant 1 - Firefighter 1 Details ---
export const testTenant1Firefighter1 = {
    mockedUuid: "acme-firefighter1-id",
    uuid: "21b2c3d4-e5f6-7890-1234-567890abcdef",
    identifier: "urn:uuid:21b2c3d4-e5f6-7890-1234-567890abcdef",
    email: "firefighter1@acme.example.com",
    hasOccupation: "ISCO-08|5411",
};

// --- Tenant 1 - Nurse 1 Details ---
export const testTenant1Nurse1 = {
    mockedUuid: "acme-nurse1-id",
    uuid: "31b2c3d4-e5f6-7890-1234-567890abcdef",
    identifier: "urn:uuid:31b2c3d4-e5f6-7890-1234-567890abcdef",
    email: "nurse1@acme.example.com",
    hasOccupation: "ISCO-08|2221", // Nursing Professionals
};

// ===================================================================================
// PRE-BUILT CLAIM SETS
// ===================================================================================

export const testClaimsHostAdmin1 = {
    [ClaimsPersonSchemaorg.identifier]: testHostAdmin1.identifier,
    [ClaimsPersonSchemaorg.hasOccupation]: testHostAdmin1.hasOccupation,
    [ClaimsPersonSchemaorg.email]: testHostAdmin1.email,
};

export const testClaimsEmployeeAdminTenant1 = {
    [ClaimsPersonSchemaorg.identifier]: testTenant1Admin1.identifier,
    [ClaimsPersonSchemaorg.hasOccupation]: testTenant1Admin1.hasOccupation,
    [ClaimsPersonSchemaorg.email]: testTenant1Admin1.email,
};

export const testClaimsTenant1Receptionist1 = {
    [ClaimsPersonSchemaorg.identifier]: testTenant1Receptionist1Urn,
    [ClaimsPersonSchemaorg.hasOccupation]: testTenant1Receptionist1HasOccupation,
    [ClaimsPersonSchemaorg.email]: testTenant1Receptionist1Email,
};

export const testClaimsTenant1Firefighter1 = {
    [ClaimsPersonSchemaorg.identifier]: testTenant1Firefighter1.identifier,
    [ClaimsPersonSchemaorg.hasOccupation]: testTenant1Firefighter1.hasOccupation,
    [ClaimsPersonSchemaorg.email]: testTenant1Firefighter1.email,
};

export const testClaimsTenant1Nurse1 = {
    [ClaimsPersonSchemaorg.identifier]: testTenant1Nurse1.identifier,
    [ClaimsPersonSchemaorg.hasOccupation]: testTenant1Nurse1.hasOccupation,
    [ClaimsPersonSchemaorg.email]: testTenant1Nurse1.email,
};


export const testBaseJobForEmployeeClaims = (claims: ClaimsRecord, tenantId: string, sector: string): JobRequest => ({
  id: 'test-job-id',
  status: JobStatus.DRAFT,
  sequence: 0,
  createdAtTimestamp: Date.now(),
  tenantId: tenantId,
  sector: sector,
  jurisdiction: 'us',
  section: 'entity',
  format: 'org.schema',
  resourceType: 'Employee',
  action: '_batch',
  content: {
    iss: 'did:web:app.example.com',
    aud: 'did:web:api.example.com',
    thid: 'test-thid-456',
    jti: 'test-jti-789',
    type: 'json',
    body: {
      data: [
        {
          resource: { resourceType: 'Employee', meta: { claims } },
          request: { method: 'POST' },
          type: 'Employee-form-v1.0',
        },
      ],
    },
    meta: { // JWS/JWE info from the cryptographic envelope
      jws: { protected: { alg: 'ML-DSA-44', kid: 'test-kid', jwk: { kid: 'test-kid', kty: 'AKP', alg: 'ML-DSA-44', pub: '...' } } },
      jwe: { header: { enc: 'A256GCM', skid: 'test-skid', jwk: { kid: 'test-skid', kty: 'OKP', crv: 'ML-KEM-768', x: '...' } } },
    },
  },
  httpMethod: 'POST',
  requestUrl: '/default',
});
