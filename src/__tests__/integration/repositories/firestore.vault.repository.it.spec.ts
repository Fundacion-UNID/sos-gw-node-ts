// Flow contract: Firestore stores canonical protected documents inline until a configured size boundary requires blob externalization.
import { getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { RulesTestEnvironment, initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { buildExampleConfidentialStorageDoc, buildExampleConfidentialJwe } from 'gdc-common-utils-ts';
import { FirestoreVaultRepository } from '../../../database/repositories/firestore/firestore.vault.repository';
import { getEnvSectionId } from '../../../utils/section-env';
import type { IConfidentialBlobStore } from '../../../database/storage/IConfidentialBlobStore';
import {
  CONFIDENTIAL_JWE_INLINE_MAX_BYTES_ENV,
  FIRESTORE_CONFIDENTIAL_DOC_INLINE_MAX_BYTES_ENV,
} from '../../../database/repositories/vault/confidential-storage-persistence';

const SMALL_INLINE_THRESHOLD_BYTES = '64';
const SMALL_FIRESTORE_DOC_THRESHOLD_BYTES = '256';
const LARGE_CIPHERTEXT = 'x'.repeat(512);
const LARGE_INDEXED_VALUE = 'z'.repeat(512);

class InMemoryConfidentialBlobStore implements IConfidentialBlobStore {
  readonly provider = 'mem';
  private readonly blobs = new Map<string, Uint8Array>();

  async put(dataBytes: Uint8Array, contentType: string) {
    const blobRef = `blob-${this.blobs.size + 1}`;
    this.blobs.set(blobRef, dataBytes);
    return { blobRef, locator: `mem://${blobRef}`, contentType };
  }

  async get(blobRef: string) {
    const dataBytes = this.blobs.get(blobRef);
    if (!dataBytes) {
      throw new Error(`Missing test blob '${blobRef}'.`);
    }
    return { dataBytes, contentType: 'application/jose+json' };
  }
}

describe('FirestoreVaultRepository (Integration)', () => {
  let repository: FirestoreVaultRepository;
  let testEnv: RulesTestEnvironment;
  let blobStore: InMemoryConfidentialBlobStore;
  const vaultId = 'my-confidential-vault';
  const hostCollectionName = 'host';
  const testConfidentialDoc = buildExampleConfidentialStorageDoc();

  beforeAll(async () => {
    // Set the emulator host, which the FirestoreVaultRepository constructor will pick up.
    process.env.FIRESTORE_EMULATOR_HOST = 'localhost:8080';
    testEnv = await initializeTestEnvironment({
      projectId: 'firestore-vault-test-2',
    });
    if (!getApps().length) {
      initializeApp({ projectId: 'firestore-vault-test-2' });
    }
  });

  beforeEach(async () => {
    delete process.env[CONFIDENTIAL_JWE_INLINE_MAX_BYTES_ENV];
    delete process.env[FIRESTORE_CONFIDENTIAL_DOC_INLINE_MAX_BYTES_ENV];
    await testEnv.clearFirestore();
    blobStore = new InMemoryConfidentialBlobStore();
    repository = new FirestoreVaultRepository(getFirestore(), hostCollectionName, blobStore);
    await repository.createNewVault({ id: vaultId } as any);
  });

  afterAll(async () => {
    await testEnv.cleanup();
    // Unset the emulator host to avoid affecting other tests
    delete process.env.FIRESTORE_EMULATOR_HOST;
  });

  describe('put and get operations', () => {
    it('should put a ConfidentialStorageDoc into a specific section and get it back by id', async () => {
      const sectionId = getEnvSectionId('employees');

      await repository.put(vaultId, [testConfidentialDoc], sectionId);
      const retrievedDoc = await repository.get(vaultId, testConfidentialDoc.id, sectionId);

      expect(retrievedDoc).toBeDefined();
      expect(retrievedDoc).toEqual(testConfidentialDoc);

      const persistedSnapshot = await getFirestore()
        .collection(vaultId)
        .doc(sectionId)
        .collection('documents')
        .doc(testConfidentialDoc.id)
        .get();
      const persistedPayload = persistedSnapshot.data();
      expect(persistedPayload?.jwe).toBeDefined();
      expect(persistedPayload?.blob).toBeUndefined();
    });

    it('should update an existing document when put is called again with the same id', async () => {
        const updatedDoc = buildExampleConfidentialStorageDoc({
          sequence: 1,
          jwe: {
            ...buildExampleConfidentialJwe(),
            ciphertext: 'updated-ciphertext',
          },
        });
        await repository.put(vaultId, [testConfidentialDoc]);

        await repository.put(vaultId, [updatedDoc]);
        const retrievedDoc = await repository.get(vaultId, testConfidentialDoc.id);

        expect(retrievedDoc).toEqual(updatedDoc);
    });

    it('should externalize oversized JWE payloads when the global inline threshold is lowered', async () => {
      process.env[CONFIDENTIAL_JWE_INLINE_MAX_BYTES_ENV] = SMALL_INLINE_THRESHOLD_BYTES;
      const sectionId = getEnvSectionId('employees');
      const largeDoc = buildExampleConfidentialStorageDoc({
        jwe: {
          ...buildExampleConfidentialJwe(),
          ciphertext: LARGE_CIPHERTEXT,
        },
      });

      await repository.put(vaultId, [largeDoc], sectionId);

      const persistedSnapshot = await getFirestore()
        .collection(vaultId)
        .doc(sectionId)
        .collection('documents')
        .doc(largeDoc.id)
        .get();
      const persistedPayload = persistedSnapshot.data();
      expect(persistedPayload?.jwe).toBeUndefined();
      expect(persistedPayload?.blob).toMatchObject({
        provider: 'mem',
        contentType: 'application/jose+json',
      });
    });

    it('should externalize when the Firestore document guardrail is exceeded even if the JWE is small', async () => {
      process.env[FIRESTORE_CONFIDENTIAL_DOC_INLINE_MAX_BYTES_ENV] = SMALL_FIRESTORE_DOC_THRESHOLD_BYTES;
      const sectionId = getEnvSectionId('employees');
      const largeIndexedDoc = buildExampleConfidentialStorageDoc({
        indexed: {
          attributes: [
            { name: 'hmac_for_large_field', value: LARGE_INDEXED_VALUE },
          ],
        },
      });

      await repository.put(vaultId, [largeIndexedDoc], sectionId);

      const persistedSnapshot = await getFirestore()
        .collection(vaultId)
        .doc(sectionId)
        .collection('documents')
        .doc(largeIndexedDoc.id)
        .get();
      const persistedPayload = persistedSnapshot.data();
      expect(persistedPayload?.jwe).toBeUndefined();
      expect(persistedPayload?.blob).toMatchObject({
        provider: 'mem',
        contentType: 'application/jose+json',
      });
    });
  });

  describe('query operations', () => {
    it('should find a document by a unique indexed attribute using the query method', async () => {
      const sectionId = getEnvSectionId('employees');
      await repository.put(vaultId, [testConfidentialDoc], sectionId);
      const queryObj = {
        section: sectionId,
        equals: {
          'indexed.attributes': {
            name: 'hmac_for_email',
            value: 'hmac_for_test@example.com',
            unique: true,
          },
        },
      };

      const results = await repository.query(vaultId, queryObj);

      expect(results).toHaveLength(1);
      expect(results[0]).toEqual(testConfidentialDoc);
    });

    it('should return an empty array if no document matches the query', async () => {
      const sectionId = getEnvSectionId('employees');
      await repository.put(vaultId, [testConfidentialDoc], sectionId);
      const queryObj = {
        section: sectionId,
        equals: {
          'indexed.attributes': {
            name: 'hmac_for_email',
            value: 'wrong_value',
          },
        },
      };
      
      const results = await repository.query(vaultId, queryObj);

      expect(results).toHaveLength(0);
    });

    it('should find multiple documents by a non-unique indexed attribute using the query method', async () => {
      const sectionId = getEnvSectionId('employees');
      const anotherAdminDoc = buildExampleConfidentialStorageDoc({
        id: 'doc-2',
        indexed: {
          attributes: [
            { name: 'hmac_for_role', value: 'hmac_for_admin' }, // Same role
            { name: 'hmac_for_email', value: 'hmac_for_another@example.com', unique: true }
          ],
        },
      });
      await repository.put(vaultId, [testConfidentialDoc, anotherAdminDoc], sectionId);

      const queryObj = {
        section: sectionId,
        equals: {
          'indexed.attributes': {
            name: 'hmac_for_role',
            value: 'hmac_for_admin',
          },
        },
      };

      const results = await repository.query(vaultId, queryObj);

      expect(results).toHaveLength(2);
      expect(results).toEqual(expect.arrayContaining([testConfidentialDoc, anotherAdminDoc]));
    });
  });
});
