// src/api-examples/communication.examples.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.
import { GatewayResponseEntryTypes } from 'gdc-common-utils-ts/constants/gateway-response';
import { HttpRequestMethods } from 'gdc-common-utils-ts/constants/http';
import { ResourceTypesFhirR4 } from 'gdc-common-utils-ts/constants/fhir-resource-types';

import { CommunicationCategoryCodes, HealthcareBasicSections } from 'gdc-common-utils-ts/constants/index';
import { Format } from 'gdc-common-utils-ts/constants/Schemas';

const IPS_BUNDLE_LIGHT_EXAMPLE = {
  resourceType: ResourceTypesFhirR4.Bundle,
  type: 'document',
  entry: [
    {
      resource: {
        resourceType: ResourceTypesFhirR4.Composition,
        status: 'final',
        type: {
          coding: [{
            system: HealthcareBasicSections.PatientSummaryDocument.system,
            code: HealthcareBasicSections.PatientSummaryDocument.code,
          }],
        },
      },
    },
  ],
} as const;

export const COMMUNICATION_INGESTION_ENTRY_EXAMPLE = {
  type: GatewayResponseEntryTypes.CommunicationIngestionRequest,
  resource: {
    resourceType: ResourceTypesFhirR4.Communication,
    status: 'completed',
    subject: { reference: 'Patient/did:web:api.acme.org:individual:123' },
    category: [{
      coding: [{
        system: CommunicationCategoryCodes.Notification.system,
        code: CommunicationCategoryCodes.Notification.code,
      }],
    }],
    payload: [
      {
        contentAttachment: {
          contentType: 'application/fhir+json',
          title: 'IPS document bundle',
          data: Buffer.from(JSON.stringify(IPS_BUNDLE_LIGHT_EXAMPLE), 'utf8').toString('base64'),
        },
      },
    ],
    note: [{ text: 'IPS ingestion request' }],
    meta: {
      claims: {
        // Flat API claims are version-neutral. The native Communication above
        // remains the concrete FHIR representation accepted by this adapter.
        '@context': Format.FHIR_API,
        'Communication.category': CommunicationCategoryCodes.Notification.claim,
        'Communication.subject': 'did:web:api.acme.org:individual:123',
        'Communication.sent': '2026-05-16T00:00:00.000Z',
        'Communication.note-text': 'IPS ingestion request',
        'Communication.content-attachment-type': 'application/fhir+json',
      },
    },
  },
} as const;

export const COMMUNICATION_INGESTION_MESSAGE_EXAMPLE = {
  jti: 'unique-communication-message-ips-001',
  thid: 'thread-communication-ips-001',
  iss: 'did:web:ehr-system.example.com',
  aud: 'did:web:gateway.acme.org',
  type: 'application/fhir+json; fhirVersion=4.0',
  body: {
    resourceType: ResourceTypesFhirR4.Bundle,
    type: 'batch',
    entry: [
      {
        request: {
          method: HttpRequestMethods.Post,
          url: 'individual/org.hl7.fhir.r4/Communication',
        },
        ...COMMUNICATION_INGESTION_ENTRY_EXAMPLE,
      },
    ],
  },
} as const;
