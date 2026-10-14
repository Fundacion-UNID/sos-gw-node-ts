// src/utils/vc-id.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

import { sha3_256 } from '@noble/hashes/sha3.js';
import baseX from 'base-x';

const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const base58btc = baseX(BASE58_ALPHABET);

/**
 * Implements the deterministic "Versioned Credential ID" pattern.
 *
 * This function generates a versioned, content-addressable ID for a Verifiable Credential
 * based on the subject's identifier and the issuance timestamp. The formula is:
 * `z(multibase(multihash(SHA3-256(<URN>:timestamp:epoch:<value>))))`
 *
 * @param subjectIdentifier The URN identifier of the credential subject (e.g., `credentialSubject.identifier`).
 * @param validFrom The ISO 8601 date string from which the credential is valid (e.g., `vc.validFrom`).
 * @returns A URN-formatted string containing the Multibase-encoded Multihash.
 */
export const generateVcId = (subjectIdentifier: string, validFrom: string): string => {
  // 1. Convert the ISO date to a Unix epoch timestamp (in seconds).
  const epochTimestamp = Math.floor(new Date(validFrom).getTime() / 1000);

  // 2. Construct the deterministic input string.
  const deterministicString = `${subjectIdentifier}:timestamp:epoch:${epochTimestamp}`;
  const bytes = new TextEncoder().encode(deterministicString);

  // 3. Compute the SHA3-256 hash of the deterministic string.
  const hashDigest = sha3_256(bytes);

  // 4. Create a multihash-compliant digest by prepending the hash algorithm code and length.
  // SHA3-256: code=0x14, length=32 bytes (0x20)
  const multihashBytes = new Uint8Array(2 + hashDigest.length);
  multihashBytes[0] = 0x14; // SHA3-256 code
  multihashBytes[1] = 0x20; // 32 bytes length
  multihashBytes.set(hashDigest, 2);

  // 5. Encode the full multihash digest into a base58btc string (prefix 'z').
  const multibaseEncodedString = 'z' + base58btc.encode(multihashBytes);

  // 6. Format the final vc.id as a URN.
  return `urn:multibase:${multibaseEncodedString}`;
};