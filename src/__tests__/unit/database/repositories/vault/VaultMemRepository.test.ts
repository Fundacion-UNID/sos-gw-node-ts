// src/__tests__/unit/database/repositories/vault/VaultMemRepository.test.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

import { VaultMemRepository } from '../../../../../database/repositories/vault/vault.mem.repository';
import { RecordBase } from 'gdc-common-utils-ts/models/resource-document';
import { getEnvSectionId } from '../../../../../utils/section-env';

describe('VaultMemRepository', () => {
  let repository: VaultMemRepository;

  beforeEach(() => {
    // We instantiate the actual class we want to test.
    repository = new VaultMemRepository();
  });

  it('should create a new vault and confirm it exists', async () => {
    // Act
    const result = await repository.createNewVault({ id: 'test-vault' });
    const vaultConfig = await repository.getVaultConfig('test-vault');
    const registeredAsTenant = await repository.vaultExists('test-vault');

    // Assert
    expect(result).toBe(true);
    expect(vaultConfig).toBeDefined();
    // `vaultExists` checks tenant registration inside the host's `tenants` section, not physical vault creation.
    expect(registeredAsTenant).toBe(false);
  });

  it('should return false if creating a vault that already exists', async () => {
    // Arrange
    await repository.createNewVault({ id: 'test-vault' });

    // Act
    const result = await repository.createNewVault({ id: 'test-vault' });

    // Assert
    expect(result).toBe(false);
  });

  describe('put and get operations', () => {
    type TestDoc = RecordBase & { data: string };
    const testDoc: TestDoc = { id: 'doc-1', data: 'some-value' };
    const vaultId = 'my-vault';

    beforeEach(async () => {
      await repository.createNewVault({ id: vaultId });
    });

    it('should put a document into the default section and get it back', async () => {
      // Act
      await repository.put(vaultId, [testDoc]);
      const retrievedDoc = await repository.get(vaultId, 'doc-1');

      // Assert
      expect(retrievedDoc).toBeDefined();
      expect(retrievedDoc).toEqual(testDoc);
    });

    it('should correctly add a document to a specific section and allow it to be retrieved', async () => {
      // Arrange
      const sectionId = getEnvSectionId('tenants');

      // Act: This is the exact operation that fails in the integration test.
      await repository.put(vaultId, [testDoc], sectionId);
      const tenants = await repository.getContainersInSection(vaultId, sectionId);

      // Assert: This will fail with the buggy implementation.
      expect(tenants).toHaveLength(1);
      expect(tenants[0]).toEqual(testDoc);
    });

    it('should update an existing document when put is called again with the same id', async () => {
      // Arrange
      const updatedDoc: TestDoc = { id: 'doc-1', data: 'new-value' };
      await repository.put(vaultId, [testDoc]); // Put initial version

      // Act
      await repository.put(vaultId, [updatedDoc]);
      const retrievedDoc = await repository.get(vaultId, 'doc-1');

      // Assert
      expect(retrievedDoc).toEqual(updatedDoc);
    });

    it('getContainersInSection should return an empty array for a non-existent section', async () => {
        // Act
        const results = await repository.getContainersInSection(vaultId, 'non-existent-section');

        // Assert
        expect(results).toEqual([]);
    });

    it('should add multiple documents to the same section across multiple calls', async () => {
      // Arrange
      const docA: TestDoc = { id: 'doc-a', data: 'value-a' };
      const docB: TestDoc = { id: 'doc-b', data: 'value-b' };
      const sectionId = 'multiple-puts';
      
      // Act
      await repository.put(vaultId, [docA], sectionId);
      await repository.put(vaultId, [docB], sectionId); // This call was overwriting the section
      
      // Assert
      const retrievedDocs = await repository.getContainersInSection(vaultId, sectionId);
      expect(retrievedDocs).toHaveLength(2);
      expect(retrievedDocs).toContainEqual(docA);
      expect(retrievedDocs).toContainEqual(docB);
    });
  });
});
