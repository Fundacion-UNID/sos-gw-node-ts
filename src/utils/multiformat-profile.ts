import { sha3_256, sha3_384 } from '@noble/hashes/sha3.js';
import { utf8ToBytes } from '@noble/hashes/utils.js';
import { encodeMultibase58btc } from 'gdc-common-utils-ts/utils/multibase58';

/**
 * Local copy of the multiformat profile used by GW CORE at runtime.
 *
 * Why it exists here as well:
 * - `gwtemplate-node-ts` currently depends on a published `gdc-common-utils-ts`
 *   package version
 * - the local workspace changes are not yet available through that package
 * - keeping the same names and contract here avoids changing business logic
 *   again when the shared package is republished
 */

export type MultihashProfile = Readonly<{
  algorithm: 'sha3-256' | 'sha3-384';
  code: number;
  digestLengthBytes: number;
  digest: (value: Uint8Array) => Uint8Array;
}>;

export const MULTIFORMAT_CID_V1_CODE = 0x01;
export const MULTICODEC_RAW_CODE = 0x55;

export const SHA3_256_MULTIHASH_PROFILE: MultihashProfile = Object.freeze({
  algorithm: 'sha3-256',
  code: 0x14,
  digestLengthBytes: 32,
  digest: sha3_256,
});

export const SHA3_384_MULTIHASH_PROFILE: MultihashProfile = Object.freeze({
  algorithm: 'sha3-384',
  code: 0x15,
  digestLengthBytes: 48,
  digest: sha3_384,
});

/**
 * Builds a `CIDv1` over a canonical UTF-8 string using the provided
 * multihash profile.
 */
export function buildRawCidV1FromUtf8String(
  value: string,
  profile: MultihashProfile,
): string {
  const digest = profile.digest(utf8ToBytes(String(value || '')));
  const multihash = concatBytes(
    Uint8Array.from([profile.code, profile.digestLengthBytes]),
    digest,
  );
  const cidBytes = concatBytes(
    encodeVarint(MULTIFORMAT_CID_V1_CODE),
    encodeVarint(MULTICODEC_RAW_CODE),
    multihash,
  );
  return encodeMultibase58btc(cidBytes);
}

function encodeVarint(value: number): Uint8Array {
  if (!Number.isInteger(value) || value < 0) throw new Error(`Invalid varint value: ${value}`);
  const out: number[] = [];
  let n = value >>> 0;
  while (n >= 0x80) {
    out.push((n & 0x7f) | 0x80);
    n >>>= 7;
  }
  out.push(n);
  return Uint8Array.from(out);
}

function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((acc, part) => acc + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}
