// src/__tests__/mocks/noble-post-quantum.mock.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

import { jest } from '@jest/globals';

/**
 * @file This module provides a mock for the '@noble/post-quantum/ml-kem' library,
 * specifically for the ml_kem784 algorithm implementation. It allows for precise
 * control over the behavior of KEM (Key Encapsulation Mechanism) functions during
 * testing, ensuring that cryptographic operations can be reliably simulated without
 * invoking the actual complex cryptographic code.
 *
 * This approach is consistent with the project's testing strategy of isolating
 * services and mocking their dependencies, as seen with other mocks like kms.mock.ts.
 */

// Per the library's implementation, this is the return type for the encapsulate function.
type EncapsulateReturn = { cipherText: Uint8Array; sharedSecret: Uint8Array };

/**
 * Mock implementation of the 'ml_kem768' object from the noble library.
 */
export const ml_kem768 = {
  /**
   * Mock of the 'encapsulate' function.
   * This is a Jest mock function that can be configured in tests to return specific
   * values, allowing simulation of the key encapsulation process.
   */
  encapsulate: jest.fn<(publicKey: Uint8Array) => Promise<EncapsulateReturn>>(),

  /**
   * Mock of the 'decapsulate' function.
   * Not yet used in current tests, but included for completeness.
   */
  decapsulate: jest.fn(),

  /**
   * Mock of the 'keypair' function.
   * Not yet used in current tests, but included for completeness.
   */
  keypair: jest.fn(),
};
