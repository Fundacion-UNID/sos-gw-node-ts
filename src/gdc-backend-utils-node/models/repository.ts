// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.
// File: src/models/repository.ts

import { RecordBase, VaultConfig } from "./resource-document";

/**
 * Represents the internal structure of a vault in the in-memory repository.
 * This is an implementation detail of the VaultMemRepository.
 */
export interface InMemoryVault {
  config: VaultConfig;
  sections: Map<string, Map<string, RecordBase>>;
}
