// src/__tests__/data/identity.data.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

import { encodeMultibase58btc } from "gdc-common-utils-ts/utils/multibase58";
import { uuidToBytes } from "../../utils/uuid";
import {
  EXAMPLE_ACCOUNT_OWNER_ID,
  EXAMPLE_HOSTED_INDIVIDUAL_CONTROLLER_DID,
  EXAMPLE_HOSTED_INDIVIDUAL_DID,
  EXAMPLE_INDIVIDUAL_CONTROLLER_ROLE_TYPE,
  EXAMPLE_INDIVIDUAL_CONTROLLER_ROLE_VALUE,
} from 'gdc-common-utils-ts/examples/shared';

// A standard UUID for deterministic testing.
export const INDIVIDUAL_UUID = 'a87e5b15-aea4-4475-9c7c-40aa88354b6f';
export const RELATED_PERSON_UUID = 'b98f6c24-bfb5-4584-9d8d-51bb99465c7e';

// The shortened, URL-friendly multibase representation of the UUID.
export const INDIVIDUAL_MULTIBASE_ID = encodeMultibase58btc(uuidToBytes(INDIVIDUAL_UUID));
export const RELATED_PERSON_MULTIBASE_ID = encodeMultibase58btc(uuidToBytes(RELATED_PERSON_UUID));

export const testExamplesDidWeb = {
  professional: 'did:web:api.acme.org:employee:receptionist1@api.acme.org:ISCO-08|4226',
  individual: `did:web:api.acme.org:individual:multibase:${INDIVIDUAL_MULTIBASE_ID}`,
  customer: `did:web:api.acme.org:individual:multibase:z(customer-uuid-base58)`
};

export const testExamplesIndividualUrn = {
  nnes: 'urn:network:global:identifier:NNES:12345678Z',
  fullName: 'urn:network:global:name:ICAO9-303:SURNAME<<GIVENNAME',
  fullNameAndDob: 'urn:network:global:name:Doc9303:SURNAME<<GIVENNAME:dob:ISO:1980-12-30',
  mobile: 'urn:network:global:mobile:E164:+34600123456',
  relationship: `urn:network:global:name:ICAO9303:SURNAME<<GIVENNAME:identifier:NNES:12345678Z:relatedperson:multibase:${RELATED_PERSON_MULTIBASE_ID}:relationship:HL7:PRN`,
};

/** Reusable verified individual-controller tuple used by DCR manager contracts. */
export const testIndividualControllerDcrIdentity = Object.freeze({
  subjectDid: EXAMPLE_HOSTED_INDIVIDUAL_DID,
  authenticatedSubject: EXAMPLE_ACCOUNT_OWNER_ID,
  role: `${EXAMPLE_INDIVIDUAL_CONTROLLER_ROLE_TYPE}|${EXAMPLE_INDIVIDUAL_CONTROLLER_ROLE_VALUE}`,
  scope: 'dcr:register',
  actorDid: EXAMPLE_HOSTED_INDIVIDUAL_CONTROLLER_DID,
} as const);
