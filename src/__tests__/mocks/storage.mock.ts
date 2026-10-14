// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.
// File: src/__tests__/mocks/storage.mock.ts

import { IStorageAdapter } from '../../database/storage/IStorageAdapter';

/**
 * A singleton mock of the IStorageAdapter for use across all unit and integration tests.
 * It is pre-configured to simulate a successful file upload by default.
 * Individual tests can override this behavior if they need to test failure scenarios.
 */
export const mockStorageAdapter: jest.Mocked<IStorageAdapter> = {
  upload: jest.fn(),
  download: jest.fn(),
};

// Default successful upload behavior
mockStorageAdapter.upload.mockResolvedValue({
  publicUrl: 'https://storage.example.com/terms.pdf',
  encodedMultiHash: 'zQm...',
});
mockStorageAdapter.download.mockResolvedValue({
  dataBytes: new TextEncoder().encode('{"ciphertext":"mock"}'),
  contentType: 'application/jose+json',
});
