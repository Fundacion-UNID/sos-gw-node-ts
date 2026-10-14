// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.
// File: src/__tests__/data/observation.data.ts

import type { ConfidentialStorageDoc, MetaTagCoding } from 'gdc-common-utils-ts/models/confidential-storage';
import { ObservationCategoryCodes } from 'gdc-common-utils-ts/constants/observation-category';
import {
  EXAMPLE_OBSERVATION_ANXIETY_CODING,
  EXAMPLE_OBSERVATION_BODY_WEIGHT_CODING,
  EXAMPLE_OBSERVATION_EVENT_TIMING_NIGHT_CODING,
} from 'gdc-common-utils-ts/examples/shared';

// import { ClaimsObservationContext } from 'gdc-sdk-client-ts/src/uhc-fhir-utils-ts/models/params/Observation.params.model.js';
// Keep these keys local to avoid pulling gdc-sdk-client-ts into Docker builds for tests.
const ClaimsObservationContext = {
  Context: '@context',
  Type: '@type',
  Subject: 'Observation.subject',
  Identifier: 'Observation.identifier',
  Category: 'Observation.category',
  Code: 'Observation.code',
  CodeUserSelected: 'Observation.code-userselected',
  Issued: 'Observation.issued',
  DatePeriod: 'Observation.date-period',
  DateWhen: 'Observation.date-when',
  ValueQuantity: 'Observation.value-quantity',
  ValueString: 'Observation.value-string',
} as const;

/**
 * Test fixtures for the Observation flat-claims contract + how it is persisted in Confidential Storage.
 *
 * Important: At-rest protection applies to the entire `content` object (whatever you store there),
 * which in this platform is typically a "data entry" envelope:
 * `body.data[i] = { type, resource: { meta: { claims } }, ... }`.
 *
 * `research` (document-level metadata) is NOT a frontend responsibility:
 * - The client submits `meta.claims` (and optionally a `resource`) in the request payload.
 * - The backend encrypts the full `content` into `jwe` and HMAC-protects `indexed.attributes`.
 * - The backend MAY add `doc.research` after storing for routing/analytics without decrypting.
 * - The backend MAY add `doc.tag[]` after storing for routing/analytics without decrypting.
 * - If the API returns a bundle/receipt containing entries, it MAY mirror stored `doc.tag[]`
 *   into each `body.data[i].meta.tag` so clients can display/rout without decrypting.
 */

export const TEST_OBSERVATION_IDENTIFIER_URN =
  'urn:uuid:11b2c3d4-e5f6-7890-1234-567890abcdef' as const;

export const TEST_OBSERVATION_SUBJECT_DID =
  'did:web:api.acme.org:individual:unified-health-identifier' as const;

/**
 * What the client submits as claims.
 * Keys are contextualized (because request `@context = "org.hl7.fhir.api"`).
 * No `Observation.meta-tag` is required from the frontend.
 */
export const TEST_OBSERVATION_CLAIMS_FROM_CLIENT = {
  [ClaimsObservationContext.Context]: 'org.hl7.fhir.api',
  [ClaimsObservationContext.Type]: 'Observation:SelfReported',

  [ClaimsObservationContext.Subject]: TEST_OBSERVATION_SUBJECT_DID,
  [ClaimsObservationContext.Identifier]: TEST_OBSERVATION_IDENTIFIER_URN,

  [ClaimsObservationContext.Category]:
    'http://terminology.hl7.org/CodeSystem/observation-category|vital-signs',
  [ClaimsObservationContext.Code]: 'LOINC|29463-7',
  [ClaimsObservationContext.CodeUserSelected]: true,

  [ClaimsObservationContext.Issued]: '2025-11-27T10:00:00Z',
  [ClaimsObservationContext.DatePeriod]: '2025-01-01/2025-12-31',

  [ClaimsObservationContext.ValueQuantity]:
    'ge60|http://unitsofmeasure.org|kg,le90||kg',
} as const;

/**
 * Literal JSON view (same content) to make the wire payload easy to read in docs/tests.
 * This is derived from `TEST_OBSERVATION_CLAIMS_FROM_CLIENT` but written explicitly for clarity.
 */
export const TEST_OBSERVATION_CLAIMS_FROM_CLIENT_LITERAL = {
  '@context': 'org.hl7.fhir.api',
  '@type': 'Observation:SelfReported',
  'Observation.subject': TEST_OBSERVATION_SUBJECT_DID,
  'Observation.identifier': TEST_OBSERVATION_IDENTIFIER_URN,
  'Observation.category': 'http://terminology.hl7.org/CodeSystem/observation-category|vital-signs',
  'Observation.code': 'LOINC|29463-7',
  'Observation.code-userselected': true,
  'Observation.issued': '2025-11-27T10:00:00Z',
  'Observation.date-period': '2025-01-01/2025-12-31',
  'Observation.value-quantity': 'ge60|http://unitsofmeasure.org|kg,le90||kg',
} as const;

/**
 * What the gateway receives as one entry in `body.data[]` (the batch job payload).
 * This whole object is what ends up inside `ConfidentialStorageDoc.content` before encryption.
 */
export const TEST_OBSERVATION_DATA_ENTRY_FROM_CLIENT = {
  type: 'Observation-form-v1.0',
  resource: {
    resourceType: 'Observation',
    id: TEST_OBSERVATION_IDENTIFIER_URN.replace('urn:uuid:', ''),
    meta: { claims: { ...TEST_OBSERVATION_CLAIMS_FROM_CLIENT } },
  },
} as const;

/**
 * What the backend may derive and store for non-PII routing/analytics (kept outside encrypted content).
 * These tags are intentionally short and not meant to contain free text or direct identifiers.
 */
export const TEST_OBSERVATION_RESEARCH_TAG: MetaTagCoding[] = [
  EXAMPLE_OBSERVATION_BODY_WEIGHT_CODING,
  ObservationCategoryCodes.VitalSigns,
];

/**
 * Confidential Storage document constructed for persistence before protection (encryption/HMAC).
 * - `content` still exists (plaintext in-memory) and will be encrypted into `jwe`.
 * - `indexed.attributes` values are plaintext at this stage (will be HMAC-protected later).
 * - `research` is not required; backend may add it after storing.
 */
export const TEST_CONFIDENTIAL_OBSERVATION_DOC_TO_PROTECT: ConfidentialStorageDoc = {
  id: TEST_OBSERVATION_IDENTIFIER_URN,
  status: 'active',
  sequence: 0,
  content: { ...TEST_OBSERVATION_DATA_ENTRY_FROM_CLIENT },
  indexed: {
    attributes: [
      { name: 'identifier', value: TEST_OBSERVATION_IDENTIFIER_URN, unique: true, type: 'uri' },
      { name: 'subject', value: TEST_OBSERVATION_SUBJECT_DID, type: 'uri' },
      { name: 'code', value: 'LOINC|29463-7', type: 'token' },
    ],
  },
  audit: { created: '2025-11-27T10:00:00Z' },
  contentType: 'org.hl7.fhir.api.Observation',
};

/**
 * Representative persisted form after the backend:
 * - HMAC-protects `indexed.attributes.*` for blind queries
 * - Encrypts `content` into `jwe` and removes `content`
 * - Optionally sets `research`
 */
export const TEST_CONFIDENTIAL_OBSERVATION_DOC_STORED: ConfidentialStorageDoc = {
  id: TEST_OBSERVATION_IDENTIFIER_URN,
  status: 'active',
  sequence: 0,
  indexed: {
    attributes: [
      { name: 'hmac(name:identifier)', value: 'hmac(value:urn:uuid:...)', unique: true, type: 'uri' },
      { name: 'hmac(name:subject)', value: 'hmac(value:did:web:...)', type: 'uri' },
      { name: 'hmac(name:code)', value: 'hmac(value:LOINC|29463-7)', type: 'token' },
    ],
    hmac: { id: 'did:example:kms#hmac-key-1', type: 'Sha256HmacKey2019' },
  },
  jwe: {
    protected: 'eyJ...<protected-header>...',
    iv: '...',
    ciphertext: '...',
    tag: '...',
  },
  audit: { created: '2025-11-27T10:00:00Z' },
  contentType: 'org.hl7.fhir.api.Observation',
  tag: TEST_OBSERVATION_RESEARCH_TAG,
  research: {
    jurisdiction: 'cds-es',
    yearOfBirth: '1989',
    gender: 'female',
    sexAtBirth: 'female',
  },
};

/**
 * Optional API-level mirroring: a bundle entry MAY expose `meta.tag` without revealing content.
 * This mirrors the persisted `doc.tag[]` for UI routing, while keeping the full content encrypted at-rest.
 */
export const TEST_OBSERVATION_BATCH_RESPONSE_ENTRY = {
  type: 'Observation:Stored',
  meta: {
    tag: TEST_OBSERVATION_RESEARCH_TAG,
  },
  resource: { meta: { claims: { ...TEST_OBSERVATION_CLAIMS_FROM_CLIENT } } },
} as const;

// -----------------------------------------------------------------------------
// Anxiety at night (string value) — second example
// -----------------------------------------------------------------------------

export const TEST_ANXIETY_OBSERVATION_IDENTIFIER_URN =
  'urn:uuid:aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' as const;

export const TEST_ANXIETY_OBSERVATION_SUBJECT_DID =
  'did:web:api.acme.org:individual:unified-health-identifier' as const;

export const TEST_ANXIETY_OBSERVATION_CLAIMS_FROM_CLIENT = {
  [ClaimsObservationContext.Context]: 'org.hl7.fhir.api',
  [ClaimsObservationContext.Type]: 'Observation:SelfReported',

  [ClaimsObservationContext.Subject]: TEST_ANXIETY_OBSERVATION_SUBJECT_DID,
  [ClaimsObservationContext.Identifier]: TEST_ANXIETY_OBSERVATION_IDENTIFIER_URN,

  [ClaimsObservationContext.Category]:
    'http://terminology.hl7.org/CodeSystem/observation-category|social-history',
  [ClaimsObservationContext.Code]: 'SNOMED|48694002',
  [ClaimsObservationContext.CodeUserSelected]: true,

  [ClaimsObservationContext.Issued]: '2025-11-27T10:00:00Z',
  [ClaimsObservationContext.DateWhen]: 'NIGHT',

  // Free text is sensitive; it is stored inside encrypted `content` (-> `jwe`).
  [ClaimsObservationContext.ValueString]: 'Feels anxious at night.',
} as const;

export const TEST_ANXIETY_OBSERVATION_CLAIMS_FROM_CLIENT_LITERAL = {
  '@context': 'org.hl7.fhir.api',
  '@type': 'Observation',
  'Observation.subject': TEST_ANXIETY_OBSERVATION_SUBJECT_DID,
  'Observation.identifier': TEST_ANXIETY_OBSERVATION_IDENTIFIER_URN,
  'Observation.category': 'http://terminology.hl7.org/CodeSystem/observation-category|social-history',
  'Observation.code': 'SNOMED|48694002',
  'Observation.code-userselected': true,
  'Observation.issued': '2025-11-27T10:00:00Z',
  'Observation.date-when': 'NIGHT',
  'Observation.value-string': 'Feels anxious at night.',
} as const;

export const TEST_ANXIETY_OBSERVATION_DATA_ENTRY_FROM_CLIENT = {
  type: 'Observation-form-v1.0',
  resource: {
    resourceType: 'Observation',
    id: TEST_ANXIETY_OBSERVATION_IDENTIFIER_URN.replace('urn:uuid:', ''),
    meta: { claims: { ...TEST_ANXIETY_OBSERVATION_CLAIMS_FROM_CLIENT } },
  },
} as const;

export const TEST_ANXIETY_OBSERVATION_RESEARCH_TAG: MetaTagCoding[] = [
  EXAMPLE_OBSERVATION_ANXIETY_CODING,
  EXAMPLE_OBSERVATION_EVENT_TIMING_NIGHT_CODING,
];

export const TEST_CONFIDENTIAL_ANXIETY_OBSERVATION_DOC_TO_PROTECT: ConfidentialStorageDoc = {
  id: TEST_ANXIETY_OBSERVATION_IDENTIFIER_URN,
  status: 'active',
  sequence: 0,
  content: { ...TEST_ANXIETY_OBSERVATION_DATA_ENTRY_FROM_CLIENT },
  indexed: {
    attributes: [
      { name: 'identifier', value: TEST_ANXIETY_OBSERVATION_IDENTIFIER_URN, unique: true, type: 'uri' },
      { name: 'subject', value: TEST_ANXIETY_OBSERVATION_SUBJECT_DID, type: 'uri' },
      { name: 'code', value: 'SNOMED|48694002', type: 'token' },
    ],
  },
  audit: { created: '2025-11-27T10:00:00Z' },
  contentType: 'org.hl7.fhir.api.Observation',
};

export const TEST_CONFIDENTIAL_ANXIETY_OBSERVATION_DOC_STORED: ConfidentialStorageDoc = {
  id: TEST_ANXIETY_OBSERVATION_IDENTIFIER_URN,
  status: 'active',
  sequence: 0,
  indexed: {
    attributes: [
      { name: 'hmac(name:identifier)', value: 'hmac(value:urn:uuid:...)', unique: true, type: 'uri' },
      { name: 'hmac(name:subject)', value: 'hmac(value:did:web:...)', type: 'uri' },
      { name: 'hmac(name:code)', value: 'hmac(value:SNOMED|48694002)', type: 'token' },
    ],
    hmac: { id: 'did:example:kms#hmac-key-1', type: 'Sha256HmacKey2019' },
  },
  jwe: {
    protected: 'eyJ...<protected-header>...',
    iv: '...',
    ciphertext: '...',
    tag: '...',
  },
  audit: { created: '2025-11-27T10:00:00Z' },
  contentType: 'org.hl7.fhir.api.Observation',
  tag: TEST_ANXIETY_OBSERVATION_RESEARCH_TAG,
  research: {
    jurisdiction: 'cds-es',
    yearOfBirth: '1989',
    gender: 'female',
    sexAtBirth: 'female',
  },
};

export const TEST_ANXIETY_OBSERVATION_BATCH_RESPONSE_ENTRY = {
  type: 'Observation:Stored',
  meta: {
    tag: TEST_ANXIETY_OBSERVATION_RESEARCH_TAG,
  },
  resource: { meta: { claims: { ...TEST_ANXIETY_OBSERVATION_CLAIMS_FROM_CLIENT } } },
} as const;

// -----------------------------------------------------------------------------
// Batch example with both Observations
// -----------------------------------------------------------------------------

export const TEST_OBSERVATION_BATCH_DATA_ENTRIES = [
  TEST_OBSERVATION_DATA_ENTRY_FROM_CLIENT,
  TEST_ANXIETY_OBSERVATION_DATA_ENTRY_FROM_CLIENT,
] as const;

export const TEST_OBSERVATION_BATCH_REQUEST_BODY = {
  data: [...TEST_OBSERVATION_BATCH_DATA_ENTRIES],
} as const;

export const TEST_OBSERVATION_BATCH_RESPONSE_BODY = {
  data: [TEST_OBSERVATION_BATCH_RESPONSE_ENTRY, TEST_ANXIETY_OBSERVATION_BATCH_RESPONSE_ENTRY],
} as const;
