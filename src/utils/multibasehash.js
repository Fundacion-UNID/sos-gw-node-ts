// utils/multibasehash.js
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

import { sha384 } from '@noble/hashes/sha2';
import { utf8ToBytes } from '@noble/hashes/utils';
import baseX from 'base-x';

const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const base58btc = baseX(BASE58_ALPHABET);

/**
 * Encodes input into multibase(base58btc(multihash(sha384)))
 * - Multihash prefix: 0x15 0x30
 *   - 0x15: code for SHA-384
 *   - 0x30: length of SHA-384 = 48 bytes
 * - Multibase prefix: 'z'
 * @param {string | Uint8Array} input - UTF-8 string or bytes
 * @returns {string} multibase58btc encoded string
 */
export function encodeMultibaseSha384(input) {
  const bytes = typeof input === 'string' ? utf8ToBytes(input) : input;
  const hashBytes = sha384(bytes);

  const multihashBytes = new Uint8Array(2 + hashBytes.length);
  multihashBytes[0] = 0x15; // SHA-384 code
  multihashBytes[1] = 0x30; // length = 48
  multihashBytes.set(hashBytes, 2);

  return 'z' + base58btc.encode(multihashBytes);
}
