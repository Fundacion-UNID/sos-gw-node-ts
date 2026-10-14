// src/utils/did.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

import { PublicJwk } from 'gdc-common-utils-ts/interfaces/Cryptography.types';
import { DidDocument, VerificationMethod } from 'gdc-common-utils-ts/models/did';
import { JwkSet } from 'gdc-common-utils-ts/models/jwk';

/**
 * Encodes a hostname according to did:web spec (percent-encodes port colons).
 * @param apiUrl The full base URL of the API.
 * @returns The percent-encoded hostname.
 */
function getEncodedHost(apiUrl: string): string {
  try {
    const parsedUrl = new URL(apiUrl);
    return parsedUrl.host.replace(':', '%3A');
  } catch (e) {
    console.error(`[getEncodedHost] Invalid apiUrl provided: ${apiUrl}`);
    return 'localhost'; // Fallback
  }
}

/**
 * Composes the canonical did:web for the host service.
 * It prioritizes a public-facing domain if available.
 *
 * @param apiBaseUrl The internal base URL of the API (e.g., "http://localhost:3000").
 * @param hostExternalDomain (Optional) The public-facing domain (e.g., "host.example.com").
 * @returns The host's did:web string.
 */
export function composeHostDidWebId(apiBaseUrl: string, hostExternalDomain?: string): string {
  const authoritativeUrl = hostExternalDomain ? `https://${hostExternalDomain}` : apiBaseUrl;
  const encodedHost = getEncodedHost(authoritativeUrl);
  return `did:web:${encodedHost}`;
}

/**
 * Creates the deterministic "hosted" did:web for a tenant.
 * It correctly constructs the path portion of the DID, including the 'cds-' prefix,
 * to align with the server's URL routing structure.
 *
 * @param hostDidWeb The DID of the host (e.g., 'did:web:host.com').
 * @param tenantAlternateName The alternate name of the tenant (e.g., 'acme').
 * @param context An object containing jurisdiction, version, and sector.
 * @returns The tenant's full, correctly formatted hosted did:web.
 *          Example: 'did:web:host.com:acme:cds-us:v1:health-care'
 */
export function createHostedDidWeb(
  hostDidWeb: string,
  tenantAlternateName: string,
  context: { jurisdiction: string; version: string; sector: string }
): string {
  const hostPart = hostDidWeb.replace(/^did:web:/, '');
  // The path in a did:web uses colons as separators.
  const didPath = `cds-${context.jurisdiction}:${context.version}:${context.sector}`;
  return `did:web:${hostPart}:${tenantAlternateName}:${didPath}`;
}

export function getPrimaryDidWeb(
  didDocument: DidDocument,
  hostDidWeb: string,
  context: { jurisdiction: string; version: string; sector: string }
): string | undefined {
  if (!didDocument) return undefined;

  if (didDocument.id === hostDidWeb) {
    return hostDidWeb;
  }

  const alternateName = (didDocument as any).alternateName;
  if (!alternateName) return undefined;

  const hostedDidWeb = createHostedDidWeb(hostDidWeb, alternateName, context);

  const externalDid = didDocument.alsoKnownAs?.find(
    (alias: string) => alias.startsWith('did:web:') && alias !== hostedDidWeb,
  );
  if (externalDid) {
    return externalDid;
  }
  
  return hostedDidWeb;
}

export function findSigningMethod(didDocument: DidDocument, alg?: string): string | undefined {
  if (!didDocument || !didDocument.verificationMethod) {
    return undefined;
  }
  const assertionMethodIds = new Set((didDocument.assertionMethod || [])
    .map((method) => typeof method === 'string' ? method : method.id)
    .filter(Boolean));
  const signingMethods = assertionMethodIds.size > 0
    ? didDocument.verificationMethod.filter((method) => assertionMethodIds.has(method.id))
    : didDocument.verificationMethod;
  if (!alg) {
    return signingMethods[0]?.id;
  }
  const vm = signingMethods.find((method) => (method.publicKeyJwk as any)?.alg === alg);
  return vm?.id;
}

/**
 * Canonicalizes historical KMS-generated DID documents in memory. Earlier
 * records exposed private `purpose` labels and placed every signature key in
 * `assertionMethod`; the standard DID relationships carry that meaning now.
 * The legacy ES key remains in both relationships because it authenticates
 * compact JWTs and asserts legacy verifiable credentials.
 */
export function normalizeDidDocumentKeyRelationships(didDocument: DidDocument): DidDocument {
  const authentication = new Set((didDocument.authentication || [])
    .map((method) => typeof method === 'string' ? method : method.id)
    .filter(Boolean));
  const assertionMethod = new Set((didDocument.assertionMethod || [])
    .map((method) => typeof method === 'string' ? method : method.id)
    .filter(Boolean));
  const verificationMethod = (didDocument.verificationMethod || []).map((method) => {
    const jwk = method.publicKeyJwk as any;
    const purpose = jwk?.purpose;
    if (isLegacyEsSignatureKey(jwk)) {
      authentication.add(method.id);
      assertionMethod.add(method.id);
    } else if (purpose === 'comm_sig') {
      assertionMethod.delete(method.id);
      authentication.add(method.id);
    } else if (purpose === 'vc_sign') {
      authentication.delete(method.id);
      assertionMethod.add(method.id);
    }
    const { purpose: _internalPurpose, ...publicKeyJwk } = jwk || {};
    return { ...method, publicKeyJwk } as VerificationMethod;
  });

  return {
    ...didDocument,
    verificationMethod,
    authentication: Array.from(authentication),
    assertionMethod: Array.from(assertionMethod),
  };
}

export function populateDidDocumentFromJwks(skeletonDidDoc: DidDocument, jwks: JwkSet): DidDocument {
    const newDidDoc: DidDocument = {
        ...skeletonDidDoc,
        // Explicitly type the arrays to satisfy the DidDocument interface
        verificationMethod: [] as VerificationMethod[],
        authentication: [] as (string | VerificationMethod)[],
        assertionMethod: [] as (string | VerificationMethod)[],
        keyAgreement: [] as (string | VerificationMethod)[],
    };

    const didWebs = new Set<string>();
    if (skeletonDidDoc.id.startsWith('did:web:')) {
        didWebs.add(skeletonDidDoc.id);
    }
    skeletonDidDoc.alsoKnownAs?.forEach((alias: string) => {
        if (alias.startsWith('did:web:')) {
            didWebs.add(alias);
        }
    });

    if (!jwks || !jwks.keys) {
        return newDidDoc;
    }

    for (const key of jwks.keys) {
        const internalPurpose = (key as any).purpose;
        const { purpose: _internalPurpose, ...publicKeyJwk } = key as any;
        for (const did of Array.from(didWebs)) {
            const keyIdFragment = key.kid || `key-${(newDidDoc.verificationMethod?.length || 0) + 1}`;
            const verificationMethodId = `${did}#${keyIdFragment}`;

            const vm: VerificationMethod = {
                id: verificationMethodId,
                controller: did,
                type: 'JsonWebKey2020',
                publicKeyJwk: publicKeyJwk as PublicJwk,
            };

            // Determine key usage from 'alg' (for signing) or 'crv' (for encryption)
            // as a fallback if 'use' or 'key_ops' are not present.
            const isSignatureKey = key.use === 'sig' 
                || (key.key_ops && key.key_ops.includes('sign'))
                || ('alg' in key && (key.alg?.startsWith('ML-DSA') || key.alg?.startsWith('ES')));

            const isEncryptionKey = key.use === 'enc' 
                || (key.key_ops && key.key_ops.includes('encrypt'))
                || ('crv' in key && key.crv?.startsWith('ML-KEM'));

            let isAddedToVerificationMethods = false;

            if (isSignatureKey) {
                newDidDoc.verificationMethod!.push(vm);
                // KMS purpose labels are private routing metadata, not registered
                // JWK members or DID verification relationships. Publish the
                // communication signer through authentication, credential
                // signers through assertionMethod, and the legacy ES JWT/VC
                // compatibility signer through both relationships.
                if (isLegacyEsSignatureKey(key)) {
                    newDidDoc.authentication!.push(verificationMethodId);
                    newDidDoc.assertionMethod!.push(verificationMethodId);
                } else if (internalPurpose === 'comm_sig') {
                    newDidDoc.authentication!.push(verificationMethodId);
                } else {
                    newDidDoc.assertionMethod!.push(verificationMethodId);
                }
                isAddedToVerificationMethods = true;
            }
            if (isEncryptionKey) {
                // A key might be for both signing and encryption. Avoid adding it twice to the main list.
                if (!isAddedToVerificationMethods) {
                    newDidDoc.verificationMethod!.push(vm);
                }
                // As per W3C DID Core spec, keyAgreement should contain a reference
                // to the verification method, not the full embedded key.
                newDidDoc.keyAgreement!.push(verificationMethodId);
            }
        }
    }
    return newDidDoc;
}

function isLegacyEsSignatureKey(key: { alg?: unknown } | undefined): boolean {
  return key?.alg === 'ES384';
}

/**
 * Removes KMS-only routing metadata before a JWK Set crosses the public API.
 * Standard JOSE `use` remains authoritative (`sig` or `enc`); DID verification
 * relationships express whether a signature key authenticates or asserts.
 */
export function toPublicJwkSet(jwks: JwkSet): JwkSet {
  return {
    keys: (jwks?.keys || []).map((key) => {
      const { purpose: _internalPurpose, ...publicKey } = key as any;
      return publicKey as JwkSet['keys'][number];
    }),
  };
}

export function applyLegacyX509Metadata(
  didDocument: DidDocument,
  legacyAlg: string | undefined,
  x5u: string | undefined,
  x5c?: string[]
): DidDocument {
  if (!legacyAlg || !didDocument.verificationMethod) {
    return didDocument;
  }
  for (const method of didDocument.verificationMethod) {
    const jwk = method.publicKeyJwk as any;
    if (jwk?.alg === legacyAlg) {
      if (x5u) jwk.x5u = x5u;
      if (x5c && x5c.length > 0) jwk.x5c = x5c;
    }
  }
  return didDocument;
}

/**
 * @deprecated
 * This legacy helper generated service IDs in the form `version:sector:section:format[:resourceType]`.
 *
 * Service identifiers are now standardized to DID Document fragments of the form:
 * `#<section>:<format>:<resourceType>:<action>` (see `src/crypto-ts/utils/did.ts`).
 */
export const createDidServiceIdBase = () => {
  throw new Error(
    'createDidServiceIdBase is deprecated. Use generateServiceId(selector) with the `#section:format:resourceType:action` convention.'
  );
};



/**
 * Converts a did:web identifier into a full HTTPS or HTTP base URL.
 * It correctly decodes percent-encoded ports for local development.
 * @param did The did:web string (e.g., 'did:web:example.com' or 'did:web:localhost%3A3000').
 * @returns The full base URL (e.g., 'https://example.com' or 'http://localhost:3000').
 */
export function getBaseUrlFromDidWeb(did: string): string {
  const domainPart = did.replace(/^did:web:/, '').split(':')[0];
  const decodedDomain = decodeURIComponent(domainPart);
  
  const protocol = decodedDomain.startsWith('localhost') ? 'http' : 'https';
  
  return `${protocol}://${decodedDomain}`;
}
