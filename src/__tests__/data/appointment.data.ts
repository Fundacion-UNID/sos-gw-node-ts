// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.
// File: src/__tests__/data/appointment.data.ts
// Description: Contains test data fixtures related to FHIR Appointments and Communications.
import { FhirDataTypes } from 'gdc-common-utils-ts/constants/fhir-resource-types';

import { AppointmentClaimsFhirApi, AppointmentStatus } from '../../gdc-backend-utils-node/models/fhir/Appointment.claims';
import { testExamplesDidWeb } from './identity.data';
import { testTenant1DidWebExternal } from './organization.data';

export const testClaimsAppointmentResponseAccepted = {
    [AppointmentClaimsFhirApi.Status]: AppointmentStatus.Booked,
    [AppointmentClaimsFhirApi.Identifier]: "<appointment-response-uuid-v4>",
}

export const testClaimsAppointmentResponseCancelled = {
    [AppointmentClaimsFhirApi.Status]: AppointmentStatus.Cancelled,
    [AppointmentClaimsFhirApi.Identifier]: "<appointment-response-uuid-v4>",
}

export const testCalendarICS = `
BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Acme//did:web:api.acme.org//ES
BEGIN:VEVENT
UID:<uuid-v4>
DTSTAMP:20251016T120000Z
DTSTART:20251017T150000Z
DTEND:20251017T160000Z
SUMMARY:Resumen de cita.
DESCRIPTION:Encuentro virtual.
LOCATION:Online
END:VEVENT
END:VCALENDAR`

export const testCalendarICSBase64 =
`QkVHSU46VkNBTEVOREFSCgpWRVJTSU9OOjIuMApQUk9ESUQ6LS8vQWNtZS8vZGlkOndlYjphcGkuYWNtZS5vcmcvL0VTCkJFR0lOOlZFVkVOVA
pVSUQ6PHV1aWQtdjQ+CkRUU1RBTVA6MjAyNTEwMTZUMTIwMDAwWgpEVFNUQVJUOjIwMjUxMDE3VDE1MDAwMFoKRF
RFTkQ6MjAyNTEwMTdUMTYwMDAwWgpTVU1NQVJZOlJlc3VtZW4gZGUgY2l0YS4KREVTQ1JJUFRJT046RW5jdWVudHJvIHZpcnR1YWwuCkxPQ0FUSU9OOk9ubGluZQpFTkQ6VkVWRU5UCkVORDpWQ0FMRU5EQVI=`;

export const testAppointmentSourceUrl = `https://url-to-appointment-source.com/<uuid-v4>`;
export const testAppointmentSentDateTime = "2025-10-15T14:30:00Z"
export const testAppointmentSentEpochTime = 1729002600
export const testAppointmentRequestText =  "This is your new appointment. Best regards.";
export const testCommunicationAppointmentFhirR4 = {
    "resourceType": "Communication",
    "status": "completed",
    "category": [
        {
            "coding": [
                {
                    "system": "http://terminology.hl7.org/CodeSystem/communication-category",
                    "code": "reminder"
                }
            ]
        }
    ],
    "recipient": [ { "reference": testExamplesDidWeb.individual } ],
    "sender": { "reference": testTenant1DidWebExternal },
    "sent": "2024-10-15T14:30:00Z",
    "note": [{ "text": testAppointmentRequestText }],
    "payload": [
        {
            "contentReference": {
                "reference": testAppointmentSourceUrl,
            }
        },      
        {
            "contentAttachment": {
                "contentType": "text/calendar",
                "data": testCalendarICSBase64,
                "title": "appointment-details.ics", // filename
            }
        }
    ]
};

export const testCommMsgExtAppointmentRequest = {
  "thid": "urn:uuid:c26e2a2a-6531-4a1f-a185-8a014a6316f7",
  "to": [testExamplesDidWeb.individual], // it can be the patient or others
  "from": testTenant1DidWebExternal,
  "sub": testExamplesDidWeb.customer,
  "nbf": 1729002600,
  "category": "http://terminology.hl7.org/CodeSystem/communication-category|reminder",
  // "note": [{ "text": "This is your new appointment. Best regards." }],
  "body": {
    "data": [
      { type: FhirDataTypes.Annotation, id: "<text-uuid-v4>", text: testAppointmentRequestText},
      {
        "type": "Reference",
        "id": "<uuid-v4>",
        "resource": {
          "reference": testAppointmentSourceUrl,
          "type": "Appointment"
        }
      },
      {
        "type": "Attachment",
        "id": "<attachment-uuid>",
        "resource": {
          "contentType": "text/calendar",
          "data": testCalendarICSBase64,
          "title": "appointment-details.ics", // filename
        }
      },
    ]
  }
}

export const testAppointmentAcceptedText = "Thank you!";
export const testCommMsgExtAppointmentAcceptedResponse = {
  "thid": "urn:uuid:c26e2a2a-6531-4a1f-a185-8a014a6316f7",
  "from": testExamplesDidWeb.individual,
  "to": [testTenant1DidWebExternal],
  "sub": testExamplesDidWeb.customer,
  "nbf": testAppointmentSentEpochTime,
  // "note": [{ "text": testAppointmentAcceptedText }],
  "body": {
    "data": [
      { type: FhirDataTypes.Annotation, id: "<text-uuid-v4>", text: testAppointmentAcceptedText},
      {
        "type": "org.hl7.fhir.api.AppointmentResponse",
        "id": "<appointment-accepted-response-uuid>",
        "resource": {
          "meta": {"claims": testClaimsAppointmentResponseAccepted},
        },
      },
    ]
  }
}

export const testAppointmentCancelledText = "Sorry, next week is still possible?";
export const testCommMsgExtAppointmentCancelledResponse = {
  "thid": "urn:uuid:c26e2a2a-6531-4a1f-a185-8a014a6316f7",
  "from": testExamplesDidWeb.individual,
  "to": [testTenant1DidWebExternal],
  "sub": testExamplesDidWeb.customer,
  "nbf": 1729002600,
  // "note": [{ "text": testAppointmentCancelledText }],
  "body": {
    "data": [
      { type: FhirDataTypes.Annotation, id: "<text-uuid-v4>", text: testAppointmentAcceptedText},
      {
        "type": "org.hl7.fhir.api.AppointmentResponse",
        "id": "<appointment-cancelled-response-uuid>",
        "resource": {
          "meta": {"claims": testClaimsAppointmentResponseCancelled},
        },
      },
    ]
  }
}
