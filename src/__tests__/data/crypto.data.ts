
import { Content } from 'gdc-common-utils-ts/utils/content';

// This file contains constants and fixtures for cryptographic tests,
// ensuring reproducibility and avoiding "magic values".

// --- Mock Random Data ---
// Using deterministic "random" data for reproducible cryptographic tests.

export const RandomAlice32BytesBase64Url = 'MDEyMzQ1Njc4OT0_PT89PzAxMjM0NTY3ODk9Pz0_PT8';
export const RandomBob32BytesBase64Url = 'TvuJxmBx7TkhFZ7maMdcIQx-PDpDJwofFFdQsdyci0M';

export const testMocked12RandomBytesASCII = '012345=?=?=?';
export const testMocked16RandomBytesASCII = '0123456789=?=?=?';
export const testMocked24RandomBytesASCII = testMocked12RandomBytesASCII + testMocked12RandomBytesASCII;
export const testMocked32RandomBytesASCII = testMocked16RandomBytesASCII + testMocked16RandomBytesASCII;
// A 64-byte constant, required for ML-KEM seeding
export const testMocked64RandomBytesASCII = testMocked32RandomBytesASCII + testMocked32RandomBytesASCII;


// Uint8Array representations of the ASCII strings above
export const testMockRandom12Bytes: Uint8Array = Content.stringToBytesUTF8(testMocked12RandomBytesASCII);
export const testMockRandom16Bytes: Uint8Array = Content.stringToBytesUTF8(testMocked16RandomBytesASCII);
export const testMockRandom24Bytes: Uint8Array = Content.stringToBytesUTF8(testMocked24RandomBytesASCII);
export const testMockRandom32Bytes: Uint8Array = Content.stringToBytesUTF8(testMocked32RandomBytesASCII);
export const testMockRandom64Bytes: Uint8Array = Content.stringToBytesUTF8(testMocked64RandomBytesASCII);

export const testMockRandom16BytesBase64UrlNoPadding = "MDEyMzQ1Njc4OT0_PT89Pw";
