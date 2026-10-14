import { createHash } from 'node:crypto';
import type { IAsyncResponseStore, StoredJob } from './async-response-store.mem';

type FirestoreDocument = {
  get(): Promise<{ exists: boolean; data(): Record<string, any> | undefined }>;
  set(value: Record<string, unknown>): Promise<unknown>;
  delete(): Promise<unknown>;
};

type FirestoreLike = {
  collection(name: string): { doc(id: string): FirestoreDocument };
};

export interface AsyncResponseStoreFirestoreOptions {
  collectionName?: string;
  ttlSeconds?: number;
  now?: () => Date;
}

/**
 * Durable polling-state store shared by every GW replica.
 *
 * Firestore TTL can remove expired records asynchronously using `expiresAt`;
 * reads also reject expired records immediately so TTL cleanup latency never
 * exposes stale responses.
 */
export class AsyncResponseStoreFirestore implements IAsyncResponseStore {
  private readonly collectionName: string;
  private readonly ttlSeconds: number;
  private readonly now: () => Date;

  constructor(
    private readonly firestore: FirestoreLike,
    options: AsyncResponseStoreFirestoreOptions = {},
  ) {
    this.collectionName = options.collectionName || 'gw_async_responses';
    this.ttlSeconds = Math.max(60, Math.floor(options.ttlSeconds || 86400));
    this.now = options.now || (() => new Date());
  }

  private document(thid: string): FirestoreDocument {
    const id = createHash('sha256').update(thid, 'utf8').digest('base64url');
    return this.firestore.collection(this.collectionName).doc(id);
  }

  async get(thid: string): Promise<StoredJob | undefined> {
    const document = this.document(thid);
    const snapshot = await document.get();
    if (!snapshot.exists) return undefined;

    const persisted = snapshot.data();
    const expiresAtValue = persisted?.expiresAt;
    const expiresAt = expiresAtValue instanceof Date
      ? expiresAtValue
      : typeof expiresAtValue?.toDate === 'function'
        ? expiresAtValue.toDate()
        : undefined;
    if (!expiresAt || expiresAt.getTime() <= this.now().getTime()) {
      await document.delete();
      return undefined;
    }
    return persisted?.job as StoredJob | undefined;
  }

  async set(thid: string, value: StoredJob): Promise<void> {
    const now = this.now();
    await this.document(thid).set({
      job: value,
      updatedAt: now,
      expiresAt: new Date(now.getTime() + this.ttlSeconds * 1000),
    });
  }

  async delete(thid: string): Promise<void> {
    await this.document(thid).delete();
  }
}
