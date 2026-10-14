import {
  buildExampleConfidentialStorageDoc,
  CONFIDENTIAL_JWE_BLOB_CONTENT_TYPE,
} from 'gdc-common-utils-ts';
import { jest } from '@jest/globals';
import type { IConfidentialBlobStore } from '../../../database/storage/IConfidentialBlobStore';
import {
  estimatePersistedRecordSizeBytes,
  externalizeConfidentialStorageDocForPersistence,
} from '../../../database/repositories/vault/confidential-storage-persistence';

const SMALL_INLINE_JWE_MAX_BYTES = 256;
const LARGE_INLINE_JWE_MAX_BYTES = 4096;
const SMALL_CIPHERTEXT_LENGTH = 16;
const LARGE_CIPHERTEXT_LENGTH = 2048;
const LARGE_INDEXED_VALUE_LENGTH = 512;
const SMALL_CIPHERTEXT_CHAR = 'a';
const LARGE_CIPHERTEXT_CHAR = 'b';
const LARGE_INDEXED_VALUE_CHAR = 'z';
const INDEXED_ATTRIBUTE_NAME = 'hmac_for_large_field';
const BLOB_PROVIDER = 'mem';
const BLOB_REF_PREFIX = 'blob-';
const BLOB_LOCATOR_PREFIX = 'mem://';
const SHA256_HEX_LENGTH = 64;

class InMemoryConfidentialBlobStore implements IConfidentialBlobStore {
  readonly provider = BLOB_PROVIDER;
  private readonly blobs = new Map<string, Uint8Array>();

  async putImpl(dataBytes: Uint8Array, contentType: string) {
    const blobRef = `${BLOB_REF_PREFIX}${this.blobs.size + 1}`;
    this.blobs.set(blobRef, dataBytes);
    return { blobRef, locator: `${BLOB_LOCATOR_PREFIX}${blobRef}`, contentType };
  }

  put = jest.fn(this.putImpl.bind(this));

  async get(blobRef: string) {
    const dataBytes = this.blobs.get(blobRef);
    if (!dataBytes) {
      throw new Error(`Missing test blob '${blobRef}'.`);
    }
    return { dataBytes, contentType: CONFIDENTIAL_JWE_BLOB_CONTENT_TYPE };
  }
}

function buildConfidentialDoc(options?: {
  ciphertextLength?: number;
  largeIndexedValueLength?: number;
}) {
  const ciphertextLength = options?.ciphertextLength ?? SMALL_CIPHERTEXT_LENGTH;
  const largeIndexedValueLength = options?.largeIndexedValueLength ?? 0;
  return buildExampleConfidentialStorageDoc({
    jwe: {
      protected: 'header',
      recipients: [],
      iv: 'iv',
      ciphertext: SMALL_CIPHERTEXT_CHAR.repeat(ciphertextLength),
      tag: 'tag',
    },
    indexed: largeIndexedValueLength > 0
      ? {
          attributes: [
            {
              name: INDEXED_ATTRIBUTE_NAME,
              value: LARGE_INDEXED_VALUE_CHAR.repeat(largeIndexedValueLength),
            },
          ],
        }
      : undefined,
  });
}

describe('confidential-storage-persistence', () => {
  it('keeps small JWE payloads inline when they are below both thresholds', async () => {
    // Teaching goal:
    // - prove that persistence policy is about the encrypted payload shape
    // - keep the document id and lifecycle locator out of the size/externalize
    //   decision so the storage contract stays independent from the public id
    const blobStore = new InMemoryConfidentialBlobStore();
    const document = buildConfidentialDoc();
    const persisted = await externalizeConfidentialStorageDocForPersistence(
      document,
      blobStore,
      {
        inlineJweMaxBytes: SMALL_INLINE_JWE_MAX_BYTES,
        inlineDocumentMaxBytes: LARGE_INLINE_JWE_MAX_BYTES,
      },
    );

    expect(persisted).toEqual(document);
    expect((persisted as { content?: unknown }).content).toBeUndefined();
    expect((persisted as { jwe?: unknown }).jwe).toBeDefined();
    expect((persisted as { blob?: unknown }).blob).toBeUndefined();
    expect(blobStore.put).not.toHaveBeenCalled();
  });

  it('externalizes JWE payloads above the global inline threshold and records blob metadata', async () => {
    // Step 1.
    // Make the encrypted payload large enough to require blob externalization.
    const blobStore = new InMemoryConfidentialBlobStore();
    const document = buildConfidentialDoc({ ciphertextLength: LARGE_CIPHERTEXT_LENGTH });
    const persisted = await externalizeConfidentialStorageDocForPersistence(
      document,
      blobStore,
      { inlineJweMaxBytes: SMALL_INLINE_JWE_MAX_BYTES },
    );

    const persistedBlob = (persisted as {
      content?: unknown;
      jwe?: unknown;
      blob?: { blobRef?: string; provider?: string; contentType?: string; sizeBytes?: number; sha256?: string };
    }).blob;

    expect((persisted as { content?: unknown }).content).toBeUndefined();
    expect((persisted as { jwe?: unknown }).jwe).toBeUndefined();
    expect(persistedBlob).toMatchObject({
      provider: BLOB_PROVIDER,
      contentType: CONFIDENTIAL_JWE_BLOB_CONTENT_TYPE,
    });
    expect(persistedBlob?.blobRef).toContain(BLOB_REF_PREFIX);
    expect(persistedBlob?.sizeBytes).toBeGreaterThan(SMALL_INLINE_JWE_MAX_BYTES);
    expect(persistedBlob?.sha256).toHaveLength(SHA256_HEX_LENGTH);
    expect(blobStore.put).toHaveBeenCalledTimes(1);
  });

  it('externalizes when the persisted document size exceeds the Firestore-style guardrail', async () => {
    // Step 1.
    // Keep the JWE small but grow the indexed metadata so the record itself
    // crosses the persistence guardrail.
    const blobStore = new InMemoryConfidentialBlobStore();
    const document = buildConfidentialDoc({
      ciphertextLength: SMALL_CIPHERTEXT_LENGTH,
      largeIndexedValueLength: LARGE_INDEXED_VALUE_LENGTH,
    });
    const inlineDocumentSizeBytes = estimatePersistedRecordSizeBytes(document);
    const inlineDocumentMaxBytes = inlineDocumentSizeBytes - 1;

    const persisted = await externalizeConfidentialStorageDocForPersistence(
      document,
      blobStore,
      {
        inlineJweMaxBytes: LARGE_INLINE_JWE_MAX_BYTES,
        inlineDocumentMaxBytes,
      },
    );

    expect((persisted as { content?: unknown }).content).toBeUndefined();
    expect((persisted as { jwe?: unknown }).jwe).toBeUndefined();
    expect((persisted as { blob?: unknown }).blob).toBeDefined();
    expect(blobStore.put).toHaveBeenCalledTimes(1);
  });
});
