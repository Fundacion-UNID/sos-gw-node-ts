// src/database/storage/mem.storage.adapter.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

import { DownloadResult, IStorageAdapter, UploadResult } from './IStorageAdapter';
import { sha3_384 } from '@noble/hashes/sha3.js';
import { encodeMultibase58btc } from 'gdc-common-utils-ts/utils/multibase58';

const SHA3_384_MULTIHASH_PREFIX = new Uint8Array([0x15, 0x30]); // 0x15: sha3-384, 0x30: 48-byte length

/**
 * An in-memory implementation of the IStorageAdapter for testing and local development.
 * It mimics the behavior of a real storage provider without any external dependencies.
 */
export class StorageMemAdapter implements IStorageAdapter {
  private storage = new Map<string, { dataBytes: Uint8Array; contentType: string }>();

  /**
   * "Uploads" a file to the in-memory map. The key will be the
   * multibase58btc encoded SHA3-384 multihash of the file's content.
   *
   * @param dataBytes The binary content of the file.
   * @param contentType The MIME type of the file.
   * @returns A promise that resolves to an UploadResult with a fake local URL.
   */
  async upload(dataBytes: Uint8Array, contentType: string): Promise<UploadResult> {
    // 1. Calculate the SHA3-384 digest of the content.
    const digest = sha3_384(dataBytes);

    // 2. Construct the full multihash by prepending the prefix.
    const multihashBytes = new Uint8Array(SHA3_384_MULTIHASH_PREFIX.length + digest.length);
    multihashBytes.set(SHA3_384_MULTIHASH_PREFIX);
    multihashBytes.set(digest, SHA3_384_MULTIHASH_PREFIX.length);

    // 3. Encode the multihash to get the final identifier.
    const encodedMultiHash = encodeMultibase58btc(multihashBytes);

    // 4. Store the data in the map.
    this.storage.set(encodedMultiHash, { dataBytes, contentType });

    // 5. Return the result with a simulated public URL.
    return Promise.resolve({
      publicUrl: `http://localhost:3000/local-storage/${encodedMultiHash}`,
      encodedMultiHash: encodedMultiHash,
    });
  }

  async download(encodedMultiHash: string): Promise<DownloadResult> {
    const storedObject = this.storage.get(encodedMultiHash);
    if (!storedObject) {
      throw new Error(`StorageMemAdapter could not find object '${encodedMultiHash}'.`);
    }

    return {
      dataBytes: storedObject.dataBytes,
      contentType: storedObject.contentType,
    };
  }

  async delete(encodedMultiHash: string): Promise<void> {
    this.storage.delete(encodedMultiHash);
  }
}
