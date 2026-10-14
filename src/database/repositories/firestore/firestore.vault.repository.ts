import type { CollectionReference, DocumentReference, Firestore } from 'firebase-admin/firestore';
import { IVaultRepository, type VaultQueryOptions } from '../../../database/repositories/vault/vault.repository';
import { RecordBase, VaultConfig } from 'gdc-common-utils-ts/models/resource-document';
import { stripUndefinedDeep } from 'gdc-common-utils-ts';
import { getEnvSectionId } from '../../../utils/section-env';
import type { IConfidentialBlobStore } from '../../storage/IConfidentialBlobStore';
import {
  externalizeConfidentialStorageDocForPersistence,
  hydrateConfidentialStorageDocFromPersistence,
  resolveFirestoreInlineDocumentMaxBytes,
} from '../vault/confidential-storage-persistence';
import { appendStorageTrace, isStorageTraceEnabled } from '../../../utils/storage-trace';

const DEFAULT_SECTION = 'default';

function nowMs(): number {
  return Date.now();
}

function countBlobBackedDocs(records: unknown[]): number {
  return records.filter((record) => !!(record && typeof record === 'object' && (record as { blob?: unknown }).blob)).length;
}

/**
 * An implementation of the IVaultRepository for Google Cloud Firestore.
 *
 * @architecture
 * `TenantsCacheManager`. However, it makes a single exception for the `vaultExists`
 * method, which is the designated entry point for this translation. `vaultExists`
 * checks for a tenant's registration document inside the host's physical collection.
 * All other methods (`get`, `put`, etc.) are "dumb" and operate directly on the
 * physical `collectionName` passed to them.
 *
 * The methods `createNewVault` and `vaultExists` are special cases to satisfy the
 * shared `IVaultRepository` interface.
 *
 * Firestore-specific note:
 * - this repository can proactively externalize oversized confidential payloads
 *   before the persisted document approaches Firestore's 1 MiB limit
 * - however, single-field index exemptions for large inline fields such as
 *   `jwe` must still be configured at the Firestore database level; they cannot
 *   be enforced by repository write code
 */
export class FirestoreVaultRepository extends IVaultRepository {
  private readonly db: Firestore;
  private readonly hostCollectionName: string;
  private readonly blobStore?: IConfidentialBlobStore;

  constructor(db: Firestore, hostCollectionName: string, blobStore?: IConfidentialBlobStore) {
    super();
    this.db = db;
    this.hostCollectionName = hostCollectionName;
    this.blobStore = blobStore;
  }

  private sectionDocRef(collectionName: string, sectionId: string): DocumentReference {
    return this.db.collection(collectionName).doc(sectionId);
  }

  private documentsCollectionRef(collectionName: string, sectionId: string): CollectionReference {
    return this.sectionDocRef(collectionName, sectionId).collection('documents');
  }

  private trace(operation: string, details: Record<string, unknown>): void {
    if (!isStorageTraceEnabled()) return;
    const normalized = Object.entries(details)
      .map(([key, value]) => `${key}=${typeof value === 'string' ? value : JSON.stringify(value)}`)
      .join(' ');
    console.log(`[StorageTrace][Firestore] op=${operation} ${normalized}`);
    appendStorageTrace('firestore', operation, details);
  }

  private async maybeHydrateRecords<T extends RecordBase>(records: T[], hydrate: boolean): Promise<T[]> {
    if (!hydrate) {
      return records;
    }
    return Promise.all(records.map((record) => hydrateConfidentialStorageDocFromPersistence(record, this.blobStore)));
  }

  private async ensureSectionExists(collectionName: string, sectionId: string): Promise<void> {
    const startedAt = nowMs();
    // Create/update the parent section doc so that:
    // - sections are discoverable via listDocuments()
    // - sectionExists() is meaningful
    await this.sectionDocRef(collectionName, sectionId).set(
      { id: sectionId, updatedAt: new Date().toISOString() },
      { merge: true },
    );
    this.trace('ensureSectionExists', {
      collectionName,
      sectionId,
      durationMs: nowMs() - startedAt,
    });
  }

  /**
   * In the Firestore implementation, this is a no-op that returns true.
   * The actual creation of a tenant's registration record is handled by a `put`
   * operation orchestrated by the `HostingManager`. This method exists solely to
   * satisfy the interface contract established for the in-memory repository.
   */
  async createNewVault(vaultConfig: VaultConfig): Promise<boolean> {
    console.log(`[FirestoreVaultRepository] createNewVault for '${vaultConfig.id}' called (no-op).`);
    return Promise.resolve(true);
  }

  /**
   * Checks for the existence of a tenant's registration document within the host's vault.
   * This is the Firestore-specific implementation of checking for a logical vault's existence.
   * @param vaultId The logical vaultId of the tenant (e.g., 'health-care_acme').
   */
  async vaultExists(vaultId: string): Promise<boolean> {
    const startedAt = nowMs();
    const sectionId = getEnvSectionId('tenants');
    const docRef = this.documentsCollectionRef(this.hostCollectionName, sectionId).doc(vaultId);
    const firestoreStartedAt = nowMs();
    const docSnap = await docRef.get();
    this.trace('vaultExists', {
      collectionName: this.hostCollectionName,
      sectionId,
      docId: vaultId,
      found: docSnap.exists,
      firestoreDurationMs: nowMs() - firestoreStartedAt,
      hydrationDurationMs: 0,
      durationMs: nowMs() - startedAt,
    });
    return docSnap.exists;
  }

  async put<T extends RecordBase>(collectionName: string, documents: T[], sectionId: string = DEFAULT_SECTION): Promise<boolean> {
    const startedAt = nowMs();
    try {
      await this.ensureSectionExists(collectionName, sectionId);
      const batch = this.db.batch();
      // Firestore path: {collectionName}/{sectionId}/documents/{documentId}
      const sectionCollectionRef = this.documentsCollectionRef(collectionName, sectionId);
      let externalizeDurationMs = 0;
      let blobBackedWrites = 0;
      for (const document of documents) {
        const externalizeStartedAt = nowMs();
        const persistedDocument = await externalizeConfidentialStorageDocForPersistence(
          document,
          this.blobStore,
          { inlineDocumentMaxBytes: resolveFirestoreInlineDocumentMaxBytes() },
        );
        externalizeDurationMs += nowMs() - externalizeStartedAt;
        if (persistedDocument && typeof persistedDocument === 'object' && (persistedDocument as { blob?: unknown }).blob) {
          blobBackedWrites += 1;
        }
        const docRef = sectionCollectionRef.doc(document.id);
        batch.set(docRef, stripUndefinedDeep({ ...persistedDocument }));
      }
      const commitStartedAt = nowMs();
      await batch.commit();
      this.trace('put', {
        collectionName,
        sectionId,
        documents: documents.length,
        blobBackedWrites,
        externalizeDurationMs,
        commitDurationMs: nowMs() - commitStartedAt,
        durationMs: nowMs() - startedAt,
      });
      return true;
    } catch (error) {
      console.error(`[FirestoreVaultRepository] 'put' operation failed for collection '${collectionName}':`, error);
      return false;
    }
  }

  async get<T extends RecordBase>(collectionName: string, docId: string, sectionId: string = DEFAULT_SECTION): Promise<T | undefined> {
    const startedAt = nowMs();
    const docRef = this.documentsCollectionRef(collectionName, sectionId).doc(docId);
    this.trace('get:start', { collectionName, sectionId, docId, path: docRef.path });
    const firestoreStartedAt = nowMs();
    const docSnap = await docRef.get();
    const firestoreDurationMs = nowMs() - firestoreStartedAt;
    if (!docSnap.exists) {
      this.trace('get', {
        collectionName,
        sectionId,
        docId,
        found: false,
        firestoreDurationMs,
        hydrationDurationMs: 0,
        blobBacked: false,
        durationMs: nowMs() - startedAt,
      });
      return undefined;
    }
    const persisted = docSnap.data() as T;
    const hydrationStartedAt = nowMs();
    const hydrated = await hydrateConfidentialStorageDocFromPersistence(persisted, this.blobStore);
    this.trace('get', {
      collectionName,
      sectionId,
      docId,
      found: true,
      firestoreDurationMs,
      hydrationDurationMs: nowMs() - hydrationStartedAt,
      blobBacked: !!(persisted && typeof persisted === 'object' && (persisted as { blob?: unknown }).blob),
      durationMs: nowMs() - startedAt,
    });
    return hydrated;
  }

  async getContainersInSection<T extends RecordBase>(collectionName: string, sectionId: string): Promise<T[]> {
    const startedAt = nowMs();
    const sectionCollectionRef = this.documentsCollectionRef(collectionName, sectionId);
    const firestoreStartedAt = nowMs();
    const querySnapshot = await sectionCollectionRef.get();
    const persistedDocs = querySnapshot.docs.map((doc) => doc.data() as T);
    const hydrationStartedAt = nowMs();
    const hydratedDocs = await this.maybeHydrateRecords(persistedDocs, true);
    this.trace('getContainersInSection', {
      collectionName,
      sectionId,
      documentsScanned: persistedDocs.length,
      blobBackedDocs: countBlobBackedDocs(persistedDocs),
      firestoreDurationMs: nowMs() - firestoreStartedAt,
      hydrationDurationMs: nowMs() - hydrationStartedAt,
      durationMs: nowMs() - startedAt,
    });
    return hydratedDocs;
  }

  async listContainersInSection<T extends RecordBase>(collectionName: string, sectionId: string): Promise<T[]> {
    const startedAt = nowMs();
    const sectionCollectionRef = this.documentsCollectionRef(collectionName, sectionId);
    const firestoreStartedAt = nowMs();
    const querySnapshot = await sectionCollectionRef.get();
    const persistedDocs = querySnapshot.docs.map((doc) => doc.data() as T);
    this.trace('listContainersInSection', {
      collectionName,
      sectionId,
      documentsScanned: persistedDocs.length,
      blobBackedDocs: countBlobBackedDocs(persistedDocs),
      firestoreDurationMs: nowMs() - firestoreStartedAt,
      hydrationDurationMs: 0,
      durationMs: nowMs() - startedAt,
    });
    return persistedDocs;
  }

  async query<T extends RecordBase>(collectionName: string, q: any, options?: VaultQueryOptions): Promise<T[]> {
    const startedAt = nowMs();
    const sectionId = q.sectionId || q.section || DEFAULT_SECTION;
    const hydrate = options?.hydrate !== false;
    const firestoreStartedAt = nowMs();
    const snapshot = await this.documentsCollectionRef(collectionName, sectionId).get();
    const firestoreDurationMs = nowMs() - firestoreStartedAt;
    const docs = snapshot.docs.map((doc) => doc.data() as any);

    if (Array.isArray(q.where) && q.where.length > 0) {
      const matched = docs.filter((doc) => {
        const attributes = Array.isArray(doc?.indexed?.attributes) ? doc.indexed.attributes : [];
        return q.where.every((condition: { name: string; value: string }) =>
          attributes.some((attr: { name?: string; value?: string }) =>
            attr?.name === condition.name && attr?.value === condition.value
          )
        );
      });
      const hydrationStartedAt = nowMs();
      const hydrated = await this.maybeHydrateRecords(matched as T[], hydrate);
      this.trace('query', {
        collectionName,
        sectionId,
        queryType: 'where',
        hydrate,
        scannedDocs: docs.length,
        matchedDocs: matched.length,
        blobBackedMatchedDocs: countBlobBackedDocs(matched),
        firestoreDurationMs,
        hydrationDurationMs: nowMs() - hydrationStartedAt,
        durationMs: nowMs() - startedAt,
      });
      return hydrated;
    }

    if (q.equals && q.equals['indexed.attributes']) {
      const attributeToFind = q.equals['indexed.attributes'];
      const matched = docs.filter((doc) => {
        const attributes = Array.isArray(doc?.indexed?.attributes) ? doc.indexed.attributes : [];
        return attributes.some((attr: unknown) => JSON.stringify(attr) === JSON.stringify(attributeToFind));
      });
      const hydrationStartedAt = nowMs();
      const hydrated = await this.maybeHydrateRecords(matched as T[], hydrate);
      this.trace('query', {
        collectionName,
        sectionId,
        queryType: 'equals[indexed.attributes]',
        hydrate,
        scannedDocs: docs.length,
        matchedDocs: matched.length,
        blobBackedMatchedDocs: countBlobBackedDocs(matched),
        firestoreDurationMs,
        hydrationDurationMs: nowMs() - hydrationStartedAt,
        durationMs: nowMs() - startedAt,
      });
      return hydrated;
    }

    throw new Error(`Query type not supported by FirestoreVaultRepository: ${JSON.stringify(q)}`);
  }

  async getVaultConfig(vaultId: string): Promise<VaultConfig | undefined> {
    // Firestore BYOD variant can store vault configs in a well-known section inside the vault itself.
    // For now, return undefined unless explicitly stored by managers.
    return undefined;
  }

  async createNewSection(collectionName: string, sectionId: string): Promise<boolean> {
    try {
      await this.ensureSectionExists(collectionName, sectionId);
      return true;
    } catch (error) {
      console.error(`[FirestoreVaultRepository] createNewSection failed for '${collectionName}/${sectionId}':`, error);
      return false;
    }
  }

  async updateSection(collectionName: string, sectionId: string, containers: any[] = []): Promise<boolean> {
    // Note: this does not delete containers that are no longer present. It only upserts.
    try {
      await this.put(collectionName, containers, sectionId);
      return true;
    } catch (error) {
      console.error(`[FirestoreVaultRepository] updateSection failed for '${collectionName}/${sectionId}':`, error);
      return false;
    }
  }

  async getAllSections(collectionName: string): Promise<string[]> {
    const startedAt = nowMs();
    const docs = await this.db.collection(collectionName).listDocuments();
    this.trace('getAllSections', {
      collectionName,
      sections: docs.length,
      durationMs: nowMs() - startedAt,
    });
    return docs.map((d) => d.id);
  }

  async sectionExists(collectionName: string, sectionId: string): Promise<boolean> {
    const startedAt = nowMs();
    const snap = await this.sectionDocRef(collectionName, sectionId).get();
    this.trace('sectionExists', {
      collectionName,
      sectionId,
      exists: snap.exists,
      durationMs: nowMs() - startedAt,
    });
    return snap.exists;
  }

  async getContainersListInSection(collectionName: string, sectionId: string): Promise<string[]> {
    const startedAt = nowMs();
    const docs = await this.documentsCollectionRef(collectionName, sectionId).listDocuments();
    this.trace('getContainersListInSection', {
      collectionName,
      sectionId,
      documents: docs.length,
      durationMs: nowMs() - startedAt,
    });
    return docs.map((d) => d.id);
  }

  async getHistory(collectionName: string, containerId: string): Promise<any[]> {
    // Firestore does not provide version history by default (unless we implement it explicitly).
    return [];
  }

  async delete(collectionName: string, containerId: string, sectionId: string = DEFAULT_SECTION): Promise<boolean> {
    const startedAt = nowMs();
    try {
      await this.documentsCollectionRef(collectionName, sectionId).doc(containerId).delete();
      this.trace('delete', {
        collectionName,
        sectionId,
        containerId,
        durationMs: nowMs() - startedAt,
      });
      return true;
    } catch (error) {
      console.error(`[FirestoreVaultRepository] delete failed for '${collectionName}/${sectionId}/${containerId}':`, error);
      return false;
    }
  }

  async purge(collectionName: string): Promise<boolean> {
    const startedAt = nowMs();
    try {
      const sectionRefs = await this.db.collection(collectionName).listDocuments();
      let deletedDocuments = 0;
      for (const sectionRef of sectionRefs) {
        const documentRefs = await sectionRef.collection('documents').listDocuments();
        deletedDocuments += documentRefs.length;
        await Promise.all(documentRefs.map((documentRef) => documentRef.delete()));
        await sectionRef.delete().catch(() => undefined);
      }
      this.trace('purge', {
        collectionName,
        sections: sectionRefs.length,
        deletedDocuments,
        durationMs: nowMs() - startedAt,
      });
      return true;
    } catch (error) {
      console.error(`[FirestoreVaultRepository] purge failed for '${collectionName}':`, error);
      return false;
    }
  }
}
