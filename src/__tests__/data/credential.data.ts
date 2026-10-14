// src/__tests__/data/credential.data.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

import { VerifiableCredentialV2 } from "../../gdc-backend-utils-node/models/verifiable-credential";
import {
  testTenant1IdentifierUrn,
  testHostDidWeb,
  testRootOrgDidWeb
} from "./organization.constants";

// ===================================================================================
// MOCK VERIFIABLE CREDENTIALS
// ===================================================================================

const testCredentialVersionHashedId = 'z(multibase(multihash(SHA3-256(<URN>:timestamp:epoch:<value>))))';
const MOCK_KEY_ID = 'base64-JWKey-thumbprint';
const MOCK_DETACHED_JWS = 'base64protectedHeader..base64signature';

const testIssuanceIsoDateByRootOrg = `2025-09-29T00:00:00Z`;
const testExpirationIsoDateByRootOrg = `2025-09-28T23:59:59Z`;
const testCredentialCreatorForHost = testRootOrgDidWeb

const testIssuanceIsoDateByHost = '2025-30-09T12:34:56Z'
const testExpirationIsoDateByHost = '2026-30-09T12:34:56.000Z'
const testCredentialCreatorForTenant1 = testHostDidWeb

export const testHostVcJwtPayload = {
  vc: {
    '@context': ['https://www.w3.org/2018/credentials/v1'],
    credentialSubject: {
      identifier: testHostDidWeb,
    },    
    id: testCredentialVersionHashedId,
    issuer: testCredentialCreatorForHost,
    type: ['VerifiableCredential', 'Organization'],
  },
  // Issuance and expiration dates
  nbf: 0, // "Non-valid before" epoch timestamp (number) from the "validFrom" (but no ISO date string)
  exp: 0, // "Expiration" epoch timestamp (number) from the "validUntil" (but no ISO date string)
}

/**
 * A mock Verifiable Credential for an Organization (Tenant).
 * This represents the credential issued by the Host to a Tenant.
 */
export const testHostVc: VerifiableCredentialV2 = {
  '@context': ['https://www.w3.org/2018/credentials/v1'],
  credentialSubject: {
    identifier: testHostDidWeb,
  },
  id: testCredentialVersionHashedId,
  issuer: testCredentialCreatorForHost,
  type: ['VerifiableCredential', 'Organization'],
  // Issuance and expiration dates
  validFrom: testIssuanceIsoDateByRootOrg,
  validUntil: testExpirationIsoDateByRootOrg,
  // proofs are removed when generating the signature
  proof: [{
    type: 'JsonWebSignature2020',
    proofPurpose: 'assertionMethod',
    verificationMethod: `${testCredentialCreatorForHost}#${MOCK_KEY_ID}`,
    created: testIssuanceIsoDateByRootOrg,
    jws: MOCK_DETACHED_JWS,
  }],
};

/**
 * A mock Verifiable Credential for an Organization (Tenant).
 * This represents the credential issued by the Host to a Tenant.
 */
export const testTenant1Vc: VerifiableCredentialV2 = {
  '@context': ['https://www.w3.org/2018/credentials/v1'],
  credentialSubject: {
    identifier: testTenant1IdentifierUrn, // The stable URN of the tenant
  },
  id: testCredentialVersionHashedId,
  issuer: testCredentialCreatorForTenant1,
  type: ['VerifiableCredential', 'Organization'],
  validFrom: testIssuanceIsoDateByHost,
  validUntil: testExpirationIsoDateByHost,
  proof: [{
    type: 'JsonWebSignature2020',
    proofPurpose: 'assertionMethod',
    verificationMethod: `${testCredentialCreatorForTenant1}#${MOCK_KEY_ID}`,
    created: testIssuanceIsoDateByHost,
    jws: MOCK_DETACHED_JWS,
  }],
};
