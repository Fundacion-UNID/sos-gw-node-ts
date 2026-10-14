// Flow contract: reuse shared test fixtures and canonical types; do not introduce duplicated literals.
// src/__tests__/unit/utils/did.test.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

import { DidDocument } from '../../../gdc-backend-utils-node/models/did';
import { JwkSet } from '../../../gdc-backend-utils-node/models/jwk';
import { createHostedDidWeb, getPrimaryDidWeb, findSigningMethod, populateDidDocumentFromJwks, getBaseUrlFromDidWeb, normalizeDidDocumentKeyRelationships, toPublicJwkSet } from '../../../utils/did-backend';

// --- Test Data ---
const HOST_DID = 'did:web:host.com';
const TENANT_ALT_NAME = 'acme';
const TENANT_CONTEXT = { jurisdiction: 'es', version: 'v1', sector: 'health-care' };
const HOSTED_DID = 'did:web:host.com:acme:cds-es:v1:health-care'; // Full hosted DID
const EXTERNAL_DID = 'did:web:acme.org';

const tenantDidDocWithExternal: DidDocument & { alternateName: string } = {
  '@context': ``,
  id: 'urn:antifraud:test:us:v1:health:entity:ei:123',
  alternateName: TENANT_ALT_NAME,
  alsoKnownAs: [HOSTED_DID, EXTERNAL_DID],
};

const tenantDidDocHostedOnly: DidDocument & { alternateName: string } = {
  '@context': ``,
  id: 'urn:antifraud:test:us:v1:health:entity:ei:123',
  alternateName: TENANT_ALT_NAME,
  alsoKnownAs: [HOSTED_DID],
};

const hostDidDoc: DidDocument = {
  '@context': ``,
  id: HOST_DID,
};

const testJwks: JwkSet = {
  keys: [
    { kid: 'comm-ml', use: 'sig', alg: 'ML-DSA-44', kty: 'AKP', pub: '...', purpose: 'comm_sig' } as any,
    { kid: 'vc-ml', use: 'sig', alg: 'ML-DSA-44', kty: 'AKP', pub: '...', purpose: 'vc_sign' } as any,
    { kid: 'vc-es384', use: 'sig', alg: 'ES384', kty: 'EC', crv: 'P-384', x: 'x', y: 'y' },
    { kid: 'enc-ml', use: 'enc', alg: 'ML-KEM-768', kty: 'OKP', crv: 'ML-KEM-768', x: '...' },
  ],
};

// --- Tests ---

describe('DID Utility Functions (Deterministic)', () => {
  describe('createHostedDidWeb', () => {
    it('should correctly construct a full hosted DID with context path', () => {
      const result = createHostedDidWeb(HOST_DID, TENANT_ALT_NAME, TENANT_CONTEXT);
      expect(result).toBe(HOSTED_DID);
    });
  });

  describe('getPrimaryDidWeb', () => {
    it('should return the external did:web when it exists', () => {
      const result = getPrimaryDidWeb(tenantDidDocWithExternal, HOST_DID, TENANT_CONTEXT);
      expect(result).toBe(EXTERNAL_DID);
    });

    it('should return the constructed hosted did:web when no external one exists', () => {
      const result = getPrimaryDidWeb(tenantDidDocHostedOnly, HOST_DID, TENANT_CONTEXT);
      expect(result).toBe(HOSTED_DID);
    });
  });

  describe('findSigningMethod', () => {
    const populatedDoc = populateDidDocumentFromJwks(tenantDidDocWithExternal, testJwks);

    it('should return the id of the first verification method if no algorithm is specified', () => {
      const result = findSigningMethod(populatedDoc);
      expect(result).toBe(`${HOSTED_DID}#vc-ml`);
    });

    it('should find the id for a specific algorithm', () => {
      const result = findSigningMethod(populatedDoc, 'ML-DSA-44');
      expect(result).toBe(`${HOSTED_DID}#vc-ml`);
    });
  });

  describe('populateDidDocumentFromJwks', () => {
    it('should add full verification methods and reference them by ID in assertion/agreement', () => {
      const skeletonDoc: DidDocument = {
        '@context': 'https://www.w3.org/ns/did/v1',
        id: 'did:web:example.com',
        alsoKnownAs: [],
      };
      
      const result = populateDidDocumentFromJwks(skeletonDoc, testJwks);

      // 1. Check that verificationMethod contains the full key objects
      expect(result.verificationMethod).toHaveLength(4);
      expect(result.verificationMethod?.[0]).toHaveProperty('publicKeyJwk');
      expect(result.verificationMethod?.[0].id).toBe('did:web:example.com#comm-ml');
      expect((result.verificationMethod?.[0].publicKeyJwk as any).purpose).toBeUndefined();

      expect(result.verificationMethod?.[3]).toHaveProperty('publicKeyJwk');
      expect(result.verificationMethod?.[3].id).toBe('did:web:example.com#enc-ml');

      // 2. Check that the standard DID relationships, rather than private JWK
      // purpose labels, distinguish communication and credential signers.
      expect(result.authentication).toEqual([
        'did:web:example.com#comm-ml',
        'did:web:example.com#vc-es384',
      ]);
      expect(result.assertionMethod).toEqual([
        'did:web:example.com#vc-ml',
        'did:web:example.com#vc-es384',
      ]);
      // Verify it's a string, not an object
      expect(typeof result.assertionMethod?.[0]).toBe('string'); 

      expect(result.keyAgreement).toHaveLength(1);
      expect(result.keyAgreement?.[0]).toBe('did:web:example.com#enc-ml');
      // Verify it's a string, not an object
      expect(typeof result.keyAgreement?.[0]).toBe('string');
    });

    it('does not treat a non-legacy ES256K assertion key as the legacy ES384 authentication key', () => {
      const skeletonDoc: DidDocument = {
        '@context': 'https://www.w3.org/ns/did/v1',
        id: 'did:web:example.com',
        alsoKnownAs: [],
      };
      const es256kKeyId = `${skeletonDoc.id}#vc-es256k`;

      const result = populateDidDocumentFromJwks(skeletonDoc, {
        keys: [{ kid: 'vc-es256k', use: 'sig', alg: 'ES256K', kty: 'EC', crv: 'secp256k1', x: 'x', y: 'y' }],
      } as JwkSet);

      expect(result.authentication).not.toContain(es256kKeyId);
      expect(result.assertionMethod).toContain(es256kKeyId);
    });
  });

  describe('toPublicJwkSet', () => {
    it('removes internal purpose labels while retaining standard JOSE use', () => {
      const result = toPublicJwkSet(testJwks);

      expect(result.keys[0]).toMatchObject({ kid: 'comm-ml', use: 'sig' });
      expect((result.keys[0] as any).purpose).toBeUndefined();
      expect((result.keys[1] as any).purpose).toBeUndefined();
      expect((testJwks.keys[0] as any).purpose).toBe('comm_sig');
    });
  });

  describe('normalizeDidDocumentKeyRelationships', () => {
    it('migrates historical purpose labels to DID relationships without exposing them', () => {
      const legacy = {
        '@context': 'https://www.w3.org/ns/did/v1',
        id: 'did:web:example.com',
        verificationMethod: [
          { id: 'did:web:example.com#comm', controller: 'did:web:example.com', type: 'JsonWebKey2020', publicKeyJwk: { kid: 'comm', use: 'sig', purpose: 'comm_sig' } },
          { id: 'did:web:example.com#vc', controller: 'did:web:example.com', type: 'JsonWebKey2020', publicKeyJwk: { kid: 'vc', use: 'sig', purpose: 'vc_sign' } },
          { id: 'did:web:example.com#es384', controller: 'did:web:example.com', type: 'JsonWebKey2020', publicKeyJwk: { kid: 'es384', use: 'sig', alg: 'ES384' } },
        ],
        assertionMethod: [
          'did:web:example.com#comm',
          'did:web:example.com#vc',
          'did:web:example.com#es384',
        ],
      } as any;

      const result = normalizeDidDocumentKeyRelationships(legacy);

      expect(result.authentication).toEqual([
        'did:web:example.com#comm',
        'did:web:example.com#es384',
      ]);
      expect(result.assertionMethod).toEqual([
        'did:web:example.com#vc',
        'did:web:example.com#es384',
      ]);
      expect(result.verificationMethod?.every((method) => (method.publicKeyJwk as any).purpose === undefined)).toBe(true);
    });
  });

  describe('getBaseUrlFromDidWeb', () => {
    it('should return an HTTPS url for a standard domain', () => {
      const result = getBaseUrlFromDidWeb('did:web:example.com');
      expect(result).toBe('https://example.com');
    });

    it('should return an HTTP url for localhost', () => {
      const result = getBaseUrlFromDidWeb('did:web:localhost');
      expect(result).toBe('http://localhost');
    });

    it('should correctly decode a percent-encoded port for localhost', () => {
      const result = getBaseUrlFromDidWeb('did:web:localhost%3A3000');
      expect(result).toBe('http://localhost:3000');
    });

    it('should ignore path components of the did:web', () => {
      const result = getBaseUrlFromDidWeb('did:web:example.com:some:other:path');
      expect(result).toBe('https://example.com');
    });
  });
});
