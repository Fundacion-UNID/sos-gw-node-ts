// src/__tests__/data/network-enrollment.data.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

import { MldsaPublicJwk } from 'gdc-common-utils-ts/interfaces/Cryptography.types';
import { ClaimsActionSchemaorg } from 'gdc-common-utils-ts/constants/schemaorg';
import { DidDocument } from '../../gdc-backend-utils-node/models/did';
import { IDecodedDidcommPayload } from 'gdc-common-utils-ts/models/confidential-message';
import { testTenant1Data, testClaimsTenant1Registration } from './end-to-end.data';
import { testHostDidWeb, testTenant1DidWebExternal, testTenant1DidWebHosted } from './organization.data';

// ACTORS
export const testEmployeeUrnControllerT = 'did:web:controller-t.example.com';
/**
 * A rich, semantic URN identifying the target network, including jurisdiction and sector.
 * This is the level of detail required for the Host to correctly proxy the request.
 * Format: urn:<namespace>:<network-id>:cds-<jurisdiction>:<version>:<sector>
 */
export const testInitialNetworkUrn = 'urn:antifraud:test-network:cds-us:v1:health-care';

export const testTenantC_DidDocument: DidDocument = {
  '@context': 'https://www.w3.org/ns/did/v1',
  id: testTenant1DidWebHosted, // DID of Tenant C
  alsoKnownAs: [testTenant1DidWebExternal],
  verificationMethod: [ /* ... */ ],
  assertionMethod: [
    // This entry is the key to the authorization logic. It grants Controller T
    // permission to make assertions on behalf of Tenant C.
    {
      id: `${testEmployeeUrnControllerT}#key-1`,
      type: 'JsonWebKey2020',
      controller: testEmployeeUrnControllerT,
      publicKeyJwk:  {
        kty: 'AKP',
        alg: 'ML-DSA-44',
        pub: 'placeholder-public-key-for-controller-t', // Using 'pub' for ML-DSA signature key
      } as MldsaPublicJwk,
    },
  ],
  authentication: [ /* ... */ ],
};

// FLAT CLAIMS FOR THE ACTION
export const testNetworkEnrollmentClaims = {
  // The Agent is Tenant C. We prefix all its claims with 'org.schema.Action.agent.'
  ...Object.entries(testClaimsTenant1Registration).reduce((acc, [key, value]) => {
    acc[`org.schema.Action.agent.${key.replace('org.schema.Organization.', '')}`] = value;
    return acc;
  }, {} as any),
  [ClaimsActionSchemaorg.agentIdentifier]: testTenant1Data.identifier, // URN of Tenant C

  // The Participant is Controller T
  [ClaimsActionSchemaorg.participantIdentifier]: testEmployeeUrnControllerT,

  // The Provider is the Network
  [ClaimsActionSchemaorg.providerIdentifier]: testInitialNetworkUrn,
  [ClaimsActionSchemaorg.providerName]: 'Antifraud Test Network',

  // The Start Time of the action
  [ClaimsActionSchemaorg.startTime]: new Date().toISOString(),
};

// JOB REQUEST PAYLOAD
export const testNetworkEnrollmentRequestBody = {
  data: [{
    type: 'Network-enrollment-request-v1.0',
    resource: {
      meta: {
        claims: testNetworkEnrollmentClaims,
      },
    },
  }],
};

export const testInitialNetworkJobInput: IDecodedDidcommPayload = {
  jti: 'jti-network-enrollment',
  aud: testHostDidWeb, 
  iss: testEmployeeUrnControllerT, 
  thid: 'test-thid-network-enrollment',
  type: 'api+json',
  body: testNetworkEnrollmentRequestBody,
};
