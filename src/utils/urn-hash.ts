// src/utils/urn-hash.ts
import { sha3_256 } from '@noble/hashes/sha3.js';
import baseX from 'base-x';

const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const base58btc = baseX(BASE58_ALPHABET);

/**
 * Canonicalizes a URN string based on a specific business rule for hashing.
 * The rule is to split the URN by colons and lowercase the first two parts
 * of every three-part segment, while preserving the case of the third part (the value).
 *
 * Example: `urn:network:global:name:Doc9303:SURNAME` -> `urn:network:global:name:icao-9303:SURNAME`
 *
 * @param urn The raw URN string.
 * @returns The canonicalized URN string.
 */
const canonicalizeUrnForHashing = (urn: string): string => {
  const parts = urn.split(':');
  const canonicalParts = parts.map((part, index) => {
    // The 3rd element in each triplet (index 2, 5, 8, etc.) preserves its case.
    if ((index + 1) % 3 === 0) {
      return part;
    }
    // All other parts (schema identifiers) are lowercased.
    return part.toLowerCase();
  });
  return canonicalParts.join(':');
};

/**
 * Generates a deterministic Multibase (base58btc) encoded Multihash from a URN string.
 * This is used to create a privacy-preserving, verifiable identifier from private data
 * that can be registered on a blockchain.
 *
 * The formula is: `z(multibase(multihash(SHA3-256(canonicalize(<URN>)))))`
 *
 * @param urn The URN string to hash.
 * @returns The 'z'-prefixed base58btc encoded multihash string.
 */
export const generateUrnHash = (urn: string): string => {
  // 1. Canonicalize the URN string to ensure deterministic input.
  const canonicalUrn = canonicalizeUrnForHashing(urn);

  // 2. Convert the canonical URN string to bytes.
  const bytes = new TextEncoder().encode(canonicalUrn);

  // 3. Compute the SHA3-256 hash of the URN bytes.
  const hashDigest = sha3_256(bytes);

  // 4. Create a multihash-compliant digest by prepending the hash algorithm code and length.
  // SHA3-256: code=0x14, length=32 bytes (0x20)
  const multihashBytes = new Uint8Array(2 + hashDigest.length);
  multihashBytes[0] = 0x14; // SHA3-256 code
  multihashBytes[1] = 0x20; // 32 bytes length
  multihashBytes.set(hashDigest, 2);

  // 5. Encode the full multihash digest into a base58btc string (prefix 'z').
  const multibaseEncodedString = 'z' + base58btc.encode(multihashBytes);

  return multibaseEncodedString;
};
