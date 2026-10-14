// Flow contract: GCS storage operations use an injected client in unit tests
// while production obtains credentials through GKE Workload Identity.
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

import { jest } from '@jest/globals';
import type { Storage } from '@google-cloud/storage';
import { sha3_384 } from '@noble/hashes/sha3.js';
import { encodeMultibase58btc } from 'gdc-common-utils-ts/utils/multibase58';
import { GcsStorageAdapter } from '../../../../database/storage/gcs.storage.adapter';

describe('GcsStorageAdapter', () => {
  const testBucketName = 'test-bucket';
  const testPdfBytes = new Uint8Array(Buffer.from('dummy pdf content'));
  const testContentType = 'application/pdf';

  type AsyncVoidFn = (...args: any[]) => Promise<void>;
  let mockFileSave: jest.MockedFunction<AsyncVoidFn>;
  let mockMakePublic: jest.MockedFunction<AsyncVoidFn>;
  let mockFileDownload: jest.Mock;
  let mockGetMetadata: jest.Mock;
  let mockFile: jest.Mock;
  let mockBucket: jest.Mock;

  beforeEach(() => {
    // Clear mock history from any previous test runs
    jest.clearAllMocks();

    // Recreate mocks for each test to ensure complete isolation
    mockFileSave = jest.fn() as unknown as jest.MockedFunction<AsyncVoidFn>;
    mockFileSave.mockResolvedValue(undefined);
    mockMakePublic = jest.fn() as unknown as jest.MockedFunction<AsyncVoidFn>;
    mockMakePublic.mockResolvedValue(undefined);
    const fileDownloadMock: any = jest.fn();
    fileDownloadMock.mockResolvedValue([Buffer.from(testPdfBytes)]);
    mockFileDownload = fileDownloadMock as jest.Mock;
    const getMetadataMock: any = jest.fn();
    getMetadataMock.mockResolvedValue([{ contentType: testContentType }]);
    mockGetMetadata = getMetadataMock as jest.Mock;
    mockFile = jest.fn().mockReturnValue({
      save: mockFileSave,
      makePublic: mockMakePublic,
      download: mockFileDownload,
      getMetadata: mockGetMetadata,
      publicUrl: () => `https://storage.googleapis.com/${testBucketName}/mock-hash`,
    });
    mockBucket = jest.fn().mockReturnValue({
      file: mockFile,
    });
  });

  function createMockStorage(): Storage {
    return { bucket: mockBucket } as unknown as Storage;
  }

  it('should throw an error if bucket name is not provided', () => {
    expect(() => new GcsStorageAdapter('')).toThrow('GCS bucket name must be provided.');
  });

  it('should correctly calculate multihash and call GCS methods on upload', async () => {
    const adapter = new GcsStorageAdapter(testBucketName, createMockStorage());
    const result = await adapter.upload(testPdfBytes, testContentType);

    // 1. Calculate the expected hash to verify the logic
    const digest = sha3_384(testPdfBytes);
    const prefix = new Uint8Array([0x15, 0x30]); // sha3-384
    const multihashBytes = new Uint8Array(prefix.length + digest.length);
    multihashBytes.set(prefix);
    multihashBytes.set(digest, prefix.length);
    const expectedHash = encodeMultibase58btc(multihashBytes);

    // 2. Verify the adapter returned the correct hash
    expect(result.encodedMultiHash).toBe(expectedHash);
    expect(result.publicUrl).toBe(`https://storage.googleapis.com/${testBucketName}/mock-hash`);

    // 3. Verify the GCS client was called correctly
    expect(mockBucket).toHaveBeenCalledWith(testBucketName);
    expect(mockFile).toHaveBeenCalledWith(expectedHash);
    expect(mockFileSave).toHaveBeenCalledWith(Buffer.from(testPdfBytes), {
      contentType: testContentType,
      resumable: false,
    });
  });

  it('should re-throw a specific error if GCS upload fails', async () => {
    // Arrange: Make the save method fail for this specific test
    const gcsError = new Error('GCS connection timed out');
    mockFileSave.mockRejectedValue(gcsError);

    const adapter = new GcsStorageAdapter(testBucketName, createMockStorage());

    // Act & Assert
    await expect(adapter.upload(testPdfBytes, testContentType))
      .rejects
      .toThrow(`GCS upload failed: ${gcsError.message}`);
    
    // Ensure makePublic was not called in the failure case
    expect(mockMakePublic).not.toHaveBeenCalled();

    // Clean up the mock for subsequent tests
    mockFileSave.mockResolvedValue(undefined);
  });

  it('should download a stored object by multihash', async () => {
    const adapter = new GcsStorageAdapter(testBucketName, createMockStorage());

    const result = await adapter.download('zQmDownloadTarget');

    expect(mockBucket).toHaveBeenCalledWith(testBucketName);
    expect(mockFile).toHaveBeenCalledWith('zQmDownloadTarget');
    expect(result.dataBytes).toEqual(testPdfBytes);
    expect(result.contentType).toBe(testContentType);
  });
});
