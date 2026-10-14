// src/database/storage/gcs.storage.adapter.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

import { Storage } from '@google-cloud/storage';
import { DownloadResult, IStorageAdapter, UploadResult } from './IStorageAdapter';
import { sha3_384 } from '@noble/hashes/sha3.js';
import { encodeMultibase58btc } from 'gdc-common-utils-ts/utils/multibase58';
import { appendStorageTrace, isStorageTraceEnabled } from '../../utils/storage-trace';

const SHA3_384_MULTIHASH_PREFIX = new Uint8Array([0x15, 0x30]); // 0x15: sha3-384, 0x30: 48-byte length

function nowMs(): number {
  return Date.now();
}

/**
 * An implementation of the IStorageAdapter for Google Cloud Storage.
 * It handles file uploads by using the file's content-addressed
 * multihash as its unique identifier in the GCS bucket.
 */
export class GcsStorageAdapter implements IStorageAdapter {
  private storage: Storage;
  private bucketName: string;

  /**
   * @param bucketName The name of the GCS bucket to use for storage.
   * @param gcsClient (Optional) An instance of the GCS Storage client. If not provided,
   * it will be instantiated automatically, relying on Application Default Credentials.
   */
  constructor(bucketName: string, gcsClient?: Storage) {
    if (!bucketName) {
      throw new Error('GCS bucket name must be provided.');
    }
    this.storage = gcsClient || new Storage();
    this.bucketName = bucketName;
  }

  private trace(operation: string, details: Record<string, unknown>): void {
    if (!isStorageTraceEnabled()) return;
    const normalized = Object.entries(details)
      .map(([key, value]) => `${key}=${typeof value === 'string' ? value : JSON.stringify(value)}`)
      .join(' ');
    console.log(`[StorageTrace][GCS] op=${operation} ${normalized}`);
    appendStorageTrace('gcs', operation, details);
  }

  /**
   * Uploads a file to GCS. The object name in the bucket will be the
   * multibase58btc encoded SHA3-384 multihash of the file's content.
   *
   * @param dataBytes The binary content of the file.
   * @param contentType The MIME type of the file.
   * @returns A promise that resolves to an UploadResult.
   */
  async upload(dataBytes: Uint8Array, contentType: string): Promise<UploadResult> {
    const startedAt = nowMs();
    try {
      // 1. Calculate the SHA3-384 digest of the content.
      const digest = sha3_384(dataBytes);

      // 2. Construct the full multihash by prepending the prefix.
      const multihashBytes = new Uint8Array(SHA3_384_MULTIHASH_PREFIX.length + digest.length);
      multihashBytes.set(SHA3_384_MULTIHASH_PREFIX);
      multihashBytes.set(digest, SHA3_384_MULTIHASH_PREFIX.length);

      // 3. Encode the multihash using the project's utility to get the final identifier.
      const encodedMultiHash = encodeMultibase58btc(multihashBytes);

      // 4. Get a reference to the GCS file object.
      const file = this.storage.bucket(this.bucketName).file(encodedMultiHash);

      // 6. Upload the data. The GCS client library expects a Buffer.
      await file.save(Buffer.from(dataBytes), {
        contentType: contentType,
        resumable: false, // Use simple upload for smaller files.
      });

      this.trace('upload', {
        bucketName: this.bucketName,
        blobRef: encodedMultiHash,
        bytes: dataBytes.byteLength,
        contentType,
        durationMs: nowMs() - startedAt,
      });
      // 7. Return the result. The public URL is generated automatically.
      return {
        publicUrl: file.publicUrl(),
        encodedMultiHash: encodedMultiHash,
      };
    } catch (error) {
      console.error(`[GcsStorageAdapter] Failed to upload to bucket '${this.bucketName}'.`, error);
      // Re-throw a more specific error for the manager layer to handle.
      throw new Error(`GCS upload failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async download(encodedMultiHash: string): Promise<DownloadResult> {
    const startedAt = nowMs();
    try {
      const file = this.storage.bucket(this.bucketName).file(encodedMultiHash);
      const [dataBytes] = await file.download();
      const [metadata] = await file.getMetadata();
      this.trace('download', {
        bucketName: this.bucketName,
        blobRef: encodedMultiHash,
        bytes: dataBytes.byteLength,
        contentType: metadata.contentType,
        durationMs: nowMs() - startedAt,
      });
      return {
        dataBytes: new Uint8Array(dataBytes),
        contentType: metadata.contentType,
      };
    } catch (error) {
      console.error(`[GcsStorageAdapter] Failed to download '${encodedMultiHash}' from bucket '${this.bucketName}'.`, error);
      throw new Error(`GCS download failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async delete(encodedMultiHash: string): Promise<void> {
    const startedAt = nowMs();
    try {
      await this.storage.bucket(this.bucketName).file(encodedMultiHash).delete({ ignoreNotFound: true });
      this.trace('delete', {
        bucketName: this.bucketName,
        blobRef: encodedMultiHash,
        durationMs: nowMs() - startedAt,
      });
    } catch (error) {
      console.error(`[GcsStorageAdapter] Failed to delete '${encodedMultiHash}' from bucket '${this.bucketName}'.`, error);
      throw new Error(`GCS delete failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
