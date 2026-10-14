// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.
// File: src/database/repositories/vault/vault.mem.repository.ts

import { IVaultRepository } from './vault.repository';
import { RecordBase, VaultConfig } from 'gdc-common-utils-ts/models/resource-document';
import { InMemoryVault } from '../../../gdc-backend-utils-node/models/repository';
import { getEnvSectionId } from '../../../utils/section-env';

/**
 * An in-memory implementation of the Vault Repository.
 *
 * @architecture
 * This implementation mimics the behavior of a production repository (e.g., Firestore)
 * by dynamically learning which physical collection belongs to the host. It remains
 * agnostic to the naming convention of the collection itself.
 */
export class VaultMemRepository implements IVaultRepository {
  // Maps a physical collectionName -> InMemoryVault
  private dataVaults = new Map<string, InMemoryVault>();
  private hostCollectionName: string | null = null;

  /**
   * Clears all state to ensure clean test runs.
   */
  public clear(): void {
    this.dataVaults.clear();
    this.hostCollectionName = null;
  }

  // === Core IVaultRepository Methods ===

  /**
   * Creates a new, empty physical vault (collection).
   */
  public async createNewVault(vaultConfig: VaultConfig): Promise<boolean> {
    const collectionName = vaultConfig.id;
    if (this.dataVaults.has(collectionName)) {
      return false; // Vault already exists
    }
    this.dataVaults.set(collectionName, {
      config: vaultConfig,
      sections: new Map(),
    });
    return true;
  }

  /**
   * Checks for the existence of a tenant's registration document within the host's collection.
   * This implementation now correctly uses the host collection name it learns dynamically
   * when the host's own configuration document is saved via `put`.
   */
  public async vaultExists(vaultId: string): Promise<boolean> {
    // The host's own registration is a special case.
    if (vaultId === 'host') {
      return !!this.hostCollectionName && this.dataVaults.has(this.hostCollectionName);
    }
    
    if (!this.hostCollectionName) {
      // If the host isn't registered yet, no tenants can be.
      return false;
    }
    const hostVault = this.dataVaults.get(this.hostCollectionName);
    const tenantsSection = hostVault?.sections.get(getEnvSectionId('tenants'));
    return tenantsSection?.has(vaultId) ?? false;
  }

  /**
   * Places documents into a specific section of a physical vault.
   * It dynamically learns the host's physical collection name when the host's
   * own configuration document (`id: 'host'`) is saved.
   */
  public async put<T extends RecordBase>(
    collectionName: string,
    documents: T[],
    sectionId: string = 'default',
  ): Promise<boolean> {
    // Auto-learn the host collection name when any document with id 'host' is saved.
    // This is robust enough to handle the bootstrap process correctly.
    if (!this.hostCollectionName && documents.some(doc => doc.id === 'host')) {
      this.hostCollectionName = collectionName;
    }

    if (!this.dataVaults.has(collectionName)) {
      await this.createNewVault({ id: collectionName });
    }
    const vault = this.dataVaults.get(collectionName)!;
    const sectionMap = vault.sections.get(sectionId) || new Map<string, RecordBase>();

    for (const doc of documents) {
      if (!doc.id) {
        throw new Error('Document being put into a vault must have an id.');
      }
      sectionMap.set(doc.id, doc);
    }
    vault.sections.set(sectionId, sectionMap);
    return true;
  }

  /**
   * Retrieves a single document from a specific section of a physical vault.
   */
  public async get<T extends RecordBase>(
    collectionName: string,
    docId: string,
    sectionId: string = 'default',
  ): Promise<T | undefined> {
    const section = this.dataVaults.get(collectionName)?.sections.get(sectionId);
    return section?.get(docId) as T | undefined;
  }

  /**
   * Retrieves all documents from a specific section of a physical vault.
   */
  public async getContainersInSection<T extends RecordBase>(
    collectionName: string,
    sectionId: string,
  ): Promise<T[]> {
    return this.listContainersInSection(collectionName, sectionId);
  }

  public async listContainersInSection<T extends RecordBase>(
    collectionName: string,
    sectionId: string,
  ): Promise<T[]> {
    const vault = this.dataVaults.get(collectionName);
    const section = vault?.sections.get(sectionId);
    return section ? (Array.from(section.values()) as T[]) : [];
  }
  
  public async query<T extends RecordBase>(
    collectionName: string,
    query: { sectionId: string; where: { name: string; value: string }[] },
    _options?: { hydrate?: boolean },
    ): Promise<T[]> {
      const section = this.dataVaults.get(collectionName)?.sections.get(query.sectionId);
      if (!section) { return []; }
      const allDocs = Array.from(section.values()) as any[];
      return allDocs.filter((doc) => {
        if (!doc.indexed?.attributes) { return false; }
        return query.where.every((condition) => 
          (doc.indexed.attributes as any[]).some(attr => attr.name === condition.name && attr.value === condition.value)
        );
      }) as T[];
    }
    
  // ===================================================================================
  // Stubs and other less critical methods
  // ===================================================================================
    
  public async getVaultConfig(collectionName: string): Promise<VaultConfig | undefined> {
    return this.dataVaults.get(collectionName)?.config;
  }

  public async createNewSection(collectionName: string, sectionId: string): Promise<boolean> {
    const vault = this.dataVaults.get(collectionName);
    if (!vault || vault.sections.has(sectionId)) { return false; }
    vault.sections.set(sectionId, new Map());
    return true;
  }

  public async getAllSections(collectionName: string): Promise<string[]> {
    const vault = this.dataVaults.get(collectionName);
    return vault ? Array.from(vault.sections.keys()) : [];
  }

  public async sectionExists(collectionName: string, sectionId: string): Promise<boolean> {
    return this.dataVaults.get(collectionName)?.sections.has(sectionId) ?? false;
  }

  public async updateSection(collectionName: string, sectionId: string, containers: RecordBase[] = []): Promise<boolean> {
    const vault = this.dataVaults.get(collectionName);
    if (!vault) return false;
    const newSection = new Map<string, RecordBase>();
    containers.forEach((doc) => newSection.set(doc.id, doc));
    vault.sections.set(sectionId, newSection);
    return true;
  }
  
  public async getContainersListInSection(collectionName: string, sectionId: string): Promise<string[]> {
    const section = this.dataVaults.get(collectionName)?.sections.get(sectionId);
    return section ? Array.from(section.keys()) : [];
  }

  public async getHistory(collectionName: string, containerId: string): Promise<any[]> { return []; }
  public async delete(collectionName: string, containerId: string, sectionId: string = 'default'): Promise<boolean> {
    const vault = this.dataVaults.get(collectionName);
    const section = vault?.sections.get(sectionId);
    if (!vault || !section) return false;
    return section.delete(containerId);
  }
  public async purge(collectionName: string): Promise<boolean> { return this.dataVaults.delete(collectionName); }
}
