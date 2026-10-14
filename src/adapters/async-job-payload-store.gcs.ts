import { randomUUID } from 'node:crypto';
import { Storage } from '@google-cloud/storage';

export interface IAsyncJobPayloadStore {
  put(value: unknown): Promise<string>;
  get(reference: string): Promise<unknown>;
  delete(reference: string): Promise<void>;
}

/** Stores complete job envelopes outside Pub/Sub's message-size boundary. */
export class AsyncJobPayloadStoreGcs implements IAsyncJobPayloadStore {
  private readonly storage: Storage;
  private readonly prefix: string;

  constructor(
    private readonly bucketName: string,
    prefix = 'async-jobs',
    storage?: Storage,
  ) {
    if (!bucketName.trim()) throw new Error('GCP_PUBSUB_JOB_BUCKET must not be empty.');
    this.storage = storage || new Storage();
    this.prefix = prefix.replace(/^\/+|\/+$/g, '') || 'async-jobs';
  }

  async put(value: unknown): Promise<string> {
    const reference = `${this.prefix}/${randomUUID()}.json`;
    await this.storage.bucket(this.bucketName).file(reference).save(
      Buffer.from(JSON.stringify(value), 'utf8'),
      {
        contentType: 'application/json',
        resumable: false,
        metadata: { cacheControl: 'no-store' },
      },
    );
    return reference;
  }

  async get(reference: string): Promise<unknown> {
    this.assertOwnedReference(reference);
    const [bytes] = await this.storage.bucket(this.bucketName).file(reference).download();
    return JSON.parse(bytes.toString('utf8'));
  }

  async delete(reference: string): Promise<void> {
    this.assertOwnedReference(reference);
    await this.storage.bucket(this.bucketName).file(reference).delete({ ignoreNotFound: true });
  }

  private assertOwnedReference(reference: string): void {
    if (!reference.startsWith(`${this.prefix}/`) || reference.includes('..')) {
      throw new Error('Invalid async job payload reference.');
    }
  }
}
