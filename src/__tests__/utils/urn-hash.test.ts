// src/__tests__/utils/urn-hash.test.ts
import { generateUrnHash } from '../../utils/urn-hash';
import { testExamplesIndividualUrn } from '../data/identity.data';

describe('generateUrnHash', () => {
  // Teaching goal:
  // - show that the hash is about the canonical URN string, not the public
  //   business identifier stored elsewhere in the payload
  // - this helper is used for stable technical locators, routing keys, or
  //   traceability references, not as a substitute for `resource.identifier`
  it('should generate deterministic, multibase-encoded hashes for all example URNs', () => {
    // console.log('--- URN Multibase Hash Generation ---');

    for (const [key, urn] of Object.entries(testExamplesIndividualUrn)) {
      const hash = generateUrnHash(urn);

      // Log the input and output for documentation and verification
      // console.log(`URN (${key}): ${urn}`);
      // console.log(`Canonicalized: ${canonicalizeForTest(urn)}`);
      // console.log(`Multibase Hash: ${hash}\n`);

      // Basic assertion to ensure the function is working
      expect(hash).toBeDefined();
      expect(hash.startsWith('z')).toBe(true);
    }

    // console.log('------------------------------------');
  });

  it('should produce the same hash for URNs that only differ in schema-part casing', () => {
    // Step 1.
    // Build two URNs that differ only in casing for the schema prefixes.
    const urnWithUppercaseSchema = 'URN:NETWORK:global:IDENTIFIER:NNES:12345678Z';

    // Step 2.
    // Use the shared canonical example as the reference input.
    const referenceUrn = testExamplesIndividualUrn.nnes;

    // Step 3.
    // The canonical locator string should hash the same regardless of schema casing.
    const expectedHash = generateUrnHash(referenceUrn);
    const actualHash = generateUrnHash(urnWithUppercaseSchema);

    expect(actualHash).toEqual(expectedHash);
  });

  it('should produce a different hash if a value-part casing differs', () => {
    // Step 1.
    // Change the value part casing, which should alter the canonicalized input.
    const urnWithUppercaseValue = 'urn:network:GLOBAL:identifier:NNES:12345678Z';

    // Step 2.
    // Reuse the shared canonical example so the only difference is the value part.
    const referenceUrn = testExamplesIndividualUrn.nnes;

    // Step 3.
    // Value-part changes must produce a different locator hash.
    const expectedHash = generateUrnHash(referenceUrn);
    const actualHash = generateUrnHash(urnWithUppercaseValue);

    expect(actualHash).not.toEqual(expectedHash);
  });
});

function canonicalizeForTest(urn: string): string {
  const parts = urn.split(':');
  const canonicalParts = parts.map((part, index) => {
    if ((index + 1) % 3 === 0) {
      return part;
    }
    return part.toLowerCase();
  });
  return canonicalParts.join(':');
}
