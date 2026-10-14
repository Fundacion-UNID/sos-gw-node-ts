// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.
// File: src/database/repositories/vault/vault.repository.ts

import { ConsentRule } from "gdc-common-utils-ts/models/consent-rule";
import { RecordBase, VaultConfig } from "gdc-common-utils-ts/models/resource-document";

export type VaultQueryOptions = {
    hydrate?: boolean;
};

/**
 * Defines the contract for a Vault Repository, an abstraction layer over the physical
 * storage mechanism for tenant data.
 *
 * @architecture CRITICAL
 * This interface adheres to a strict separation of logical and physical identifiers.
 * - **LOGICAL 'host' IDENTIFIER**: Implementations of this interface MUST translate the logical
 *   `collectionName` string 'host' into the actual physical collection name of the host's vault.
 *   This is the ONLY translation the repository is responsible for.
 * - **PHYSICAL `collectionName`**: For any `collectionName` other than 'host', the repository
 *   MUST treat it as a direct, physical identifier passed down from a manager.
 * - **LOGICAL `vaultId`**: The `vaultExists` method operates on a logical `vaultId` (e.g., 'host',
 *   'health-care_acme') as it checks against the central tenant registry.
 *
 * Business logic managers MUST remain agnostic to physical storage details and interact
 * with the repository using these conventions.
 */
export abstract class IVaultRepository {
    /** Creates a new physical vault/collection. Operates on a physical collectionName. */
    abstract createNewVault(vaultConfig: VaultConfig): Promise<boolean>;
    /** Checks if a tenant's logical registration record exists. Operates on a logical vaultId. */
    abstract vaultExists(vaultId: string): Promise<boolean>;
    /** Retrieves the configuration for a specific vault. */
    abstract getVaultConfig(vaultId: string): Promise<VaultConfig | undefined>;
    /** Creates a new section within a vault. */
    abstract createNewSection(collectionName: string, sectionId: string): Promise<boolean>;
    /** Updates or creates a section with the provided records. */
    abstract updateSection(collectionName: string, sectionId: string, containers?: any[]): Promise<boolean>;
    /** Retrieves all section IDs from a vault. */
    abstract getAllSections(collectionName: string): Promise<string[]>;
    /** Checks if a section exists within a vault. */
    abstract sectionExists(collectionName: string, sectionId: string): Promise<boolean>;
    /** Retrieves a list of record identifiers from a section. */
    abstract getContainersListInSection(collectionName: string, sectionId: string): Promise<string[]>;
    /** Retrieves lightweight records from a section without hydrating confidential blob payloads. */
    abstract listContainersInSection<T extends RecordBase>(collectionName: string, sectionId: string, excludeRecordTypes?: string[]): Promise<T[]>;
    /** Retrieves full records from a section. */
    abstract getContainersInSection<T extends RecordBase>(collectionName: string, sectionId: string, excludeRecordTypes?: string[]): Promise<T[]>;
    /** Writes one or more records. */
    abstract put<T extends RecordBase>(collectionName: string, containers: T[], sectionId?: string): Promise<boolean>;
    /** Reads a single record by its ID (latest version). */
    abstract get<T extends RecordBase>(collectionName: string, containerId: string, sectionId?: string): Promise<T | undefined>;
    /** Retrieves all versions of a record by its ID. */
    abstract getHistory(collectionName: string, containerId: string): Promise<any[]>;
    /** Queries for records based on a structured query object. */
    abstract query(collectionName: string, query: any, options?: VaultQueryOptions): Promise<any[]>;
    /** Marks a record as deleted. */
    abstract delete(collectionName: string, containerId: string, sectionId?: string): Promise<boolean>;
    /** Permanently removes records marked as deleted. */
    abstract purge(collectionName: string): Promise<boolean>;
}
