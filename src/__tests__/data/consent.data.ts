// src/__tests__/consent.data.ts
// Always create JSDoc, do not use strings inline in keys nor values, use types instead, and reuse the data test examples.

import { testUserEmail, testUserFullNameICAO } from "./common.data";
import { HealthcareConsentPurposes } from "gdc-common-utils-ts/constants/healthcare";

/*
    "givenName": "Given Name(s)", // local given name(s) and middle name (s) with special characters
    "familyName": "Surname1", // first surname in the local language (including special characters).
    "additionalName": "Surname2", // second surname in Spanish spoken countries or mother's maiden name in the US and other countries
*/

export const testConsentSchemaJsonLD = {
    "@context": "https://schema.org",
    "@type": "AuthorizeAction",
    "agent": {
      "@type": "Person",
      "email": testUserEmail,
      "name": testUserFullNameICAO
    },
    "recipient": {
      "@type": "Organization",
      "url": "https://somesector.example.com/notifications/"
    },
    "instrument": "https://example.org/consent/form.pdf",
    "purpose": "https://terminology.hl7.org/CodeSystem/v3-ActReason|METAMGT"
}


export const testConsentRegisterOrganizationSchemaJsonLD = {
  "@context": "https://schema.org",
  "@type": "AuthorizeAction",
  "agent": {
    "@type": "Person", // the representative
    "email": "user1@example.com",
    "telephone": "+10000000000", // or  
    "hasOccupation": "<ROLE_CODE>", // ISCO08 employee role    
    "name": "urn:antifraud:global:identity:<SHA384(identity)>:multihash:claim[5]" // SHA-384 of the full name ICAO 9303 trasliteration
  },
  "provider": { // hosting service requested
    "@type": "Organization",
    "url": "https://github.com/soschain/terms/en.pdf" // terms of service
  },  
  "recipient": { // tenant organization requesting registration
    "@type": "Organization",
    "url": "example.com", // web domain
    "legalName": "ORGANIZATION LEGAL NAME",
    "identifier": "TAX:<country>:" // no previously registered on the federated network
  },
  "instrument": "https://example.org/consent/form.pdf",
  // Legacy JSON-LD example kept outside the canonical FHIR Consent flow.
  // Do not use `SRVC` here; the shared healthcare purpose vocabulary already
  // models the current consent contract with explicit purpose codes.
  "purpose": `https://terminology.hl7.org/CodeSystem/v3-ActReason|${HealthcareConsentPurposes.Operations}`
}
