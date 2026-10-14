// src/__tests__/unit/database/storage/mem.storage.adapter.test.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

import { StorageMemAdapter } from '../../../../database/storage/mem.storage.adapter';
import { sha3_384 } from '@noble/hashes/sha3.js';
import { encodeMultibase58btc } from 'gdc-common-utils-ts/utils/multibase58';

describe('StorageMemAdapter', () => {
  let adapter: StorageMemAdapter;
  const testPdfBytes = new Uint8Array(Buffer.from('dummy pdf content'));
  const testContentType = 'application/pdf';

  beforeEach(() => {
    adapter = new StorageMemAdapter();
  });

  it('should correctly calculate the multihash and "upload" the file', async () => {
    const result = await adapter.upload(testPdfBytes, testContentType);

    // 1. Calculate the expected hash to verify the adapter's logic.
    const digest = sha3_384(testPdfBytes);
    const prefix = new Uint8Array([0x15, 0x30]); // sha3-384
    const multihashBytes = new Uint8Array(prefix.length + digest.length);
    multihashBytes.set(prefix);
    multihashBytes.set(digest, prefix.length);
    const expectedHash = encodeMultibase58btc(multihashBytes);

    // 2. Assert the result from the adapter is correct.
    expect(result.encodedMultiHash).toBe(expectedHash);
    expect(result.publicUrl).toContain(expectedHash);

    // 3. (Internal check) Assert the file is actually in the memory store.
    const storedFile = (adapter as any).storage.get(expectedHash);
    expect(storedFile).toBeDefined();
    expect(storedFile.dataBytes).toEqual(testPdfBytes);
    expect(storedFile.contentType).toBe(testContentType);
  });

  it('should handle different content types', async () => {
    const pngBytes = new Uint8Array(Buffer.from('dummy png content'));
    const pngContentType = 'image/png';

    const result = await adapter.upload(pngBytes, pngContentType);

    expect(result.encodedMultiHash).toBeDefined();
    expect(result.publicUrl).toBeDefined();
    
    const storedFile = (adapter as any).storage.get(result.encodedMultiHash);
    expect(storedFile).toBeDefined();
    expect(storedFile.contentType).toBe(pngContentType);
  });

  it('should download a previously stored object by its multihash', async () => {
    const uploadResult = await adapter.upload(testPdfBytes, testContentType);

    const downloadResult = await adapter.download(uploadResult.encodedMultiHash);

    expect(downloadResult.dataBytes).toEqual(testPdfBytes);
    expect(downloadResult.contentType).toBe(testContentType);
  });
});
