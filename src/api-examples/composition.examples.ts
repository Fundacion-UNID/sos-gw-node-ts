// src/api-examples/composition.examples.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

export const COMPOSITION_BATCH_ENTRY_EXAMPLE = {
  type: 'Composition',
  resource: {
    resourceType: 'Composition',
    meta: { claims: {
      '@context': 'org.hl7.fhir.api',
      'Composition.subject': 'did:web:connector.example.com:animal:chip:z123',
      'Composition.section': 'LOINC|26436-6',
      'Composition.author': 'did:web:clinic.example.com:employee:loader',
      'Composition.date': '2026-03-03T10:00:00Z',
      'Composition.entry': 'urn:uuid:docref-a,urn:uuid:docref-b',
      'Composition.type': 'LOINC|60591-5',
    } },
  },
} as const;

export const COMPOSITION_SEARCH_BUNDLE_EXAMPLE = {
  resourceType: 'Bundle',
  type: 'batch',
  entry: [
    {
      request: {
        method: 'GET',
        url: 'Composition?subject=did:web:connector.example.com:animal:chip:z123',
      },
    },
  ],
} as const;

export const COMPOSITION_SEARCH_PARAMETERS_EXAMPLE = {
  resourceType: 'Parameters',
  parameter: [
    {
      name: 'subject',
      valueString: 'did:web:connector.example.com:animal:chip:z123',
    },
  ],
} as const;

export const DIGITAL_TWIN_COMPOSITION_SEARCH_MESSAGE_EXAMPLE = {
  jti: 'digitaltwin-composition-search-001',
  thid: 'digitaltwin-composition-search-001',
  iss: 'did:web:research-client.example.org',
  aud: 'did:web:gateway.acme.org',
  type: 'application/fhir+json; fhirVersion=4.0',
  body: {
    resourceType: 'Parameters',
    parameter: [
      {
        name: 'Composition.section',
        valueString: 'LOINC|10160-0',
      },
      {
        name: 'MedicationStatement.code-display',
        valueString: 'anti-inflammatory',
      },
      {
        name: 'MedicationStatement.effective',
        valueString: 'ge2026-01-01',
      },
    ],
  },
} as const;
