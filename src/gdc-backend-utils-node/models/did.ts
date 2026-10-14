// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.
// File: gdc-backend-utils-node/models/did.ts

// Back-end code historically imported DID models from `gdc-backend-utils-node/models/did`.
// The canonical definitions live in the shared SDK package under `crypto-ts/models/did`.
export type {
  DidDocument,
  DidService,
  ServiceEndpointSelector,
  SecureServiceEndpointSelector,
  VerificationMethod,
} from 'gdc-common-utils-ts/models/did';

