// src/managers/IndividualDictionaryManager.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

import type { IVaultRepository } from '../database/repositories/vault/vault.repository';
import { getIndividualDictionarySectionId } from '../utils/individual-sections';
import type { IndividualDictionaryEntry } from '../services/ai/individualDictionary';

export class IndividualDictionaryManager {
  constructor(private readonly vaultRepository: IVaultRepository) {}

  async upsert(params: {
    tenantVaultId: string;
    subjectDid: string;
    entry: IndividualDictionaryEntry;
  }): Promise<void> {
    const sectionId = getIndividualDictionarySectionId(params.subjectDid);
    await this.vaultRepository.put(params.tenantVaultId, [params.entry as any], sectionId);
  }

  async list(params: { tenantVaultId: string; subjectDid: string }): Promise<IndividualDictionaryEntry[]> {
    const sectionId = getIndividualDictionarySectionId(params.subjectDid);
    return this.vaultRepository.getContainersInSection<IndividualDictionaryEntry>(
      params.tenantVaultId,
      sectionId
    );
  }

  async get(params: {
    tenantVaultId: string;
    subjectDid: string;
    entryId: string;
  }): Promise<IndividualDictionaryEntry | undefined> {
    const sectionId = getIndividualDictionarySectionId(params.subjectDid);
    return this.vaultRepository.get<IndividualDictionaryEntry>(params.tenantVaultId, params.entryId, sectionId);
  }
}

