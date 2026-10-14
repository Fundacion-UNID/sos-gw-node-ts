// src/__tests__/data/organization.constants.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

import { URN_NAMESPACE, URN_NETWORK, URN_VERSION } from './urn.data';

export const testHostDomain = 'host.example.com';
export const testHostDidWeb = `did:web:${testHostDomain}`;

export const testRootOrgDidWeb = 'did:web:testca.unid.es';

// Keep this stable across tests to avoid circular imports between organization.data.ts and credential.data.ts.
export const testTenant1IdentifierUrn =
  `urn:${URN_NAMESPACE}:${URN_NETWORK}:ES:${URN_VERSION}:health-care:entity:TAX:acme-id`;
