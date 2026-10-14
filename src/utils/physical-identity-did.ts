// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

import type { DidDocument, DidService, VerificationMethod } from 'gdc-common-utils-ts/models/did';

export type PhysicalIdentityDocumentKind = 'uhc-card' | 'petd';

export type PhysicalIdentityService = Readonly<{
  /** Fragment local to the physical support DID, without a leading '#'. */
  fragment: string;
  type: string;
  serviceEndpoint: string;
}>;

export type PhysicalIdentityDidDocument = Omit<DidDocument, '@context'> & Readonly<{
  '@context': [string, Record<string, unknown>];
  id: string;
  /** DID of the person or animal represented by the physical support. */
  subject: string;
  /** DID of the actor authorized to update/control this support DID. */
  controller: string;
  /** Internal DID Web of the concrete service instance hosting the subject index. */
  alsoKnownAs: [string];
  physicalDocumentType: PhysicalIdentityDocumentKind;
  verificationMethod: VerificationMethod[];
  assertionMethod: string[];
  authentication: string[];
  keyAgreement: string[];
  service: DidService[];
}>;

export type BuildPhysicalIdentityDidDocumentInput = Readonly<{
  supportDid: string;
  supportKind: PhysicalIdentityDocumentKind;
  subjectDid: string;
  controllerDid: string;
  indexServiceDid: string;
  verificationMethods: VerificationMethod[];
  services: PhysicalIdentityService[];
}>;

const PRIVATE_JWK_PROPERTIES = ['d', 'p', 'q', 'dp', 'dq', 'qi', 'oth', 'k'] as const;
const KEY_AGREEMENT_CURVES = new Set(['X25519', 'X448', 'ML-KEM-512', 'ML-KEM-768', 'ML-KEM-1024']);
const PHYSICAL_IDENTITY_JSON_LD_CONTEXT = {
  subject: { '@id': 'urn:gdc:did:physical-identity:subject', '@type': '@id' },
  physicalDocumentType: 'urn:gdc:did:physical-identity:document-type',
} as const;

function requireDidWeb(value: string, field: string): void {
  if (!value.startsWith('did:web:') || value.length <= 'did:web:'.length) {
    throw new Error(`${field} must be a non-empty did:web identifier.`);
  }
  // Parsing the corresponding URL also rejects malformed percent encoding and
  // host/path values that cannot be published by the DID Web method.
  getDidWebDocumentUrl(value);
}

/**
 * Converts a DID Web identifier into the HTTPS URL mandated by did:web.
 *
 * Examples:
 * - `did:web:unid.example` -> `https://unid.example/.well-known/did.json`
 * - `did:web:unid.example:card:123` -> `https://unid.example/card/123/did.json`
 */
export function getDidWebDocumentUrl(did: string): string {
  if (!did.startsWith('did:web:')) {
    throw new Error('DID must use the did:web method.');
  }
  const methodSpecificId = did.slice('did:web:'.length);
  const encodedSegments = methodSpecificId.split(':');
  if (encodedSegments.some((segment) => !segment)) {
    throw new Error('DID Web contains an empty host or path segment.');
  }

  let segments: string[];
  try {
    segments = encodedSegments.map((segment) => decodeURIComponent(segment));
  } catch {
    throw new Error('DID Web contains invalid percent encoding.');
  }
  if (segments.some((segment) => segment === '.' || segment === '..' || segment.includes('/'))) {
    throw new Error('DID Web contains an unsafe path segment.');
  }

  const [authority, ...path] = segments;
  let origin: URL;
  try {
    origin = new URL(`https://${authority}`);
  } catch {
    throw new Error('DID Web contains an invalid authority.');
  }
  if (!origin.hostname || origin.username || origin.password || origin.pathname !== '/') {
    throw new Error('DID Web contains an invalid authority.');
  }
  return path.length === 0
    ? `${origin.origin}/.well-known/did.json`
    : `${origin.origin}/${path.map(encodeURIComponent).join('/')}/did.json`;
}

/**
 * Builds the public DID Document resolved after scanning a UHC card or PETD.
 *
 * The builder deliberately keeps five namespaces distinct: physical support,
 * represented subject, controller, index-hosting service and callable HTTPS
 * endpoints. It only accepts public key material and does not accept arbitrary
 * health/demographic fields, keeping sensitive data out of the public document.
 */
export function buildPhysicalIdentityDidDocument(
  input: BuildPhysicalIdentityDidDocumentInput,
): PhysicalIdentityDidDocument {
  requireDidWeb(input.supportDid, 'supportDid');
  requireDidWeb(input.subjectDid, 'subjectDid');
  requireDidWeb(input.controllerDid, 'controllerDid');
  requireDidWeb(input.indexServiceDid, 'indexServiceDid');

  const identities = [input.supportDid, input.subjectDid, input.controllerDid, input.indexServiceDid];
  if (new Set(identities).size !== identities.length) {
    throw new Error('Support, subject, controller and index service DIDs must be different.');
  }
  if (input.verificationMethods.length === 0) {
    throw new Error('At least one public controller verification method is required.');
  }
  if (input.services.length === 0) {
    throw new Error('At least one authorized service endpoint is required.');
  }

  const methodIds = new Set<string>();
  for (const method of input.verificationMethods) {
    if (method.controller !== input.controllerDid) {
      throw new Error('Every verification method must be controlled by controllerDid.');
    }
    if (!method.id.startsWith(`${input.controllerDid}#`) || methodIds.has(method.id)) {
      throw new Error('Controller verification method ids must be unique controller DID fragments.');
    }
    methodIds.add(method.id);
    if (PRIVATE_JWK_PROPERTIES.some((property) => property in (method.publicKeyJwk || {}))) {
      throw new Error('A physical identity DID Document must never contain private JWK material.');
    }
  }

  const serviceIds = new Set<string>();
  const services: DidService[] = input.services.map((service) => {
    const fragment = service.fragment.trim().replace(/^#/, '');
    if (!fragment || fragment.includes('#') || fragment.includes('/')) {
      throw new Error('Service fragments must be non-empty local DID fragments.');
    }
    const id = `${input.supportDid}#${fragment}`;
    if (serviceIds.has(id)) {
      throw new Error('Service fragments must be unique.');
    }
    serviceIds.add(id);
    let endpoint: URL;
    try {
      endpoint = new URL(service.serviceEndpoint);
    } catch {
      throw new Error('Physical identity service endpoints must be valid HTTPS URLs.');
    }
    if (endpoint.protocol !== 'https:') {
      throw new Error('Physical identity service endpoints must use HTTPS.');
    }
    return { id, type: service.type, serviceEndpoint: endpoint.toString() };
  });

  const keyAgreement = input.verificationMethods
    .filter((method) => KEY_AGREEMENT_CURVES.has(String((method.publicKeyJwk as any)?.crv || '')))
    .map((method) => method.id);
  const assertionMethod = input.verificationMethods
    .filter((method) => !keyAgreement.includes(method.id))
    .map((method) => method.id);

  return {
    // DID Core JSON-LD consumers may discard extension terms that have no
    // context definition. Keep the profile terms explicitly mapped instead of
    // relying on permissive plain-JSON processing.
    '@context': ['https://www.w3.org/ns/did/v1', PHYSICAL_IDENTITY_JSON_LD_CONTEXT],
    id: input.supportDid,
    controller: input.controllerDid,
    subject: input.subjectDid,
    alsoKnownAs: [input.indexServiceDid],
    physicalDocumentType: input.supportKind,
    verificationMethod: input.verificationMethods.map((method) => ({ ...method, publicKeyJwk: { ...method.publicKeyJwk } })),
    assertionMethod,
    authentication: assertionMethod,
    keyAgreement,
    service: services,
  };
}
