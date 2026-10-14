import type { IStorageAdapter } from './IStorageAdapter';
import type { ConfidentialBlobPayload, IConfidentialBlobStore, PutConfidentialBlobResult } from './IConfidentialBlobStore';

/**
 * Adapts the general-purpose storage adapter contract to the stricter
 * confidential-blob contract used by vault repositories.
 */
export class StorageAdapterConfidentialBlobStore implements IConfidentialBlobStore {
  readonly provider: string;

  constructor(
    private readonly storageAdapter: IStorageAdapter,
    provider: string,
  ) {
    this.provider = provider;
  }

  async put(dataBytes: Uint8Array, contentType: string): Promise<PutConfidentialBlobResult> {
    const uploadResult = await this.storageAdapter.upload(dataBytes, contentType);
    return {
      blobRef: uploadResult.encodedMultiHash,
      locator: uploadResult.publicUrl,
      contentType,
    };
  }

  async get(blobRef: string): Promise<ConfidentialBlobPayload> {
    if (!this.storageAdapter.download) {
      throw new Error(`Storage adapter '${this.provider}' does not support confidential blob reads.`);
    }
    return this.storageAdapter.download(blobRef);
  }

  async delete(blobRef: string): Promise<void> {
    if (!this.storageAdapter.delete) {
      throw new Error(`Storage adapter '${this.provider}' does not support confidential blob deletes.`);
    }
    await this.storageAdapter.delete(blobRef);
  }
}
