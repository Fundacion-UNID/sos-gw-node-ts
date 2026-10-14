// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.
// File: gdc-backend-utils-node/adapters/node/crypto.ts

import crypto from 'node:crypto';
import { ICryptoHelper } from 'gdc-common-utils-ts/interfaces/ICryptoHelper';

/**
 * Implements the SDK's ICryptoHelper interface using Node.js built-in crypto.
 * This is the backend counterpart of the Expo adapter.
 */
export class AdapterCryptoSdkNode implements ICryptoHelper {
  randomUUID(): string {
    return crypto.randomUUID();
  }

  async getRandomBytes(byteCount: number): Promise<Uint8Array> {
    return crypto.randomBytes(byteCount);
  }

  async digestString(data: string, algorithm: string): Promise<string> {
    const normalized = String(algorithm).trim().toUpperCase().replace(/_/g, '-');
    const nodeAlg = (() => {
      switch (normalized) {
        case 'SHA256':
        case 'SHA-256':
          return 'sha256';
        case 'SHA384':
        case 'SHA-384':
          return 'sha384';
        case 'SHA512':
        case 'SHA-512':
          return 'sha512';
        case 'SHA3-384':
        case 'SHA3_384':
        case 'SHA3-384-BITS':
          return 'sha3-384';
        default:
          throw new Error(`Unsupported digest algorithm: ${algorithm}`);
      }
    })();

    return crypto.createHash(nodeAlg).update(data, 'utf8').digest('hex');
  }
}

