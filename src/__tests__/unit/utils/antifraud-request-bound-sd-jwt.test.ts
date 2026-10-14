// Flow contract: docs/LOCAL_FIRST_RELEASE_CONTRACT.md
import { describe, expect, it } from '@jest/globals';
import {
  buildAntifraudAttributeNameUrn,
  buildAntifraudRequestBoundCommitments,
  reconstructAntifraudDisclosure,
} from '../../../utils/antifraud-request-bound-sd-jwt';

/**
 * Teaching goal:
 *
 * Prove that the Antifraud profile keeps the final SD-JWT salt out of the
 * issuer response. The requester reconstructs it from its DIDComm `thid`, one
 * per-claim seed, the canonical attribute-name URN, and the original value it
 * already possesses.
 */
describe('Antifraud request-bound SD-JWT commitments', () => {
  const thid = '6ba7b810-9dad-41d1-80b4-00c04fd430c8';
  const jurisdiction = 'CA-BC';
  const context = 'org.schema';
  const attributeName = 'Animal.identifier.value';
  const attributeValue = '981020000123456';
  const claimSaltSeed = 'AAECAwQFBgcICQoLDA0ODw';

  it('builds the existing CDS identity attribute-name URN without including an attribute value', () => {
    // Step 1. The context remains separate from the ResourceType-first attribute name.
    const urn = buildAntifraudAttributeNameUrn({
      jurisdiction,
      subjectKind: 'animal',
      context,
      attributeName,
    });

    // Step 2. No additional product namespace or attribute value is introduced.
    expect(urn).toBe('urn:cds-CA-BC:v1:identity:animal:org.schema:Animal.identifier.value');
    expect(urn).not.toContain(attributeValue);
  });

  it('returns only per-claim seeds while the requester reconstructs matching RFC 9901 disclosures', () => {
    // Step 1. The issuer derives final salts and signs only their disclosure digests.
    const issued = buildAntifraudRequestBoundCommitments({
      thid,
      jurisdiction,
      subjectKind: 'animal',
      context,
      claims: [{ attributeName, attributeValue }],
      claimSaltSeedFactory: () => claimSaltSeed,
    });

    // Step 2. The transferable result contains the seed and digest, never the
    // final salt or original identity value.
    expect(issued.sdJwtPayload).toEqual({
      _sd_alg: 'sha-384',
      _sd: [expect.any(String)],
      'urn:cds-CA-BC:v1:identity:animal:org.schema:Animal.identifier.value': claimSaltSeed,
    });
    expect(JSON.stringify(issued)).not.toContain(attributeValue);

    // Step 3. The requester uses its thid and locally held value to reconstruct
    // the standard [salt, claim-name, claim-value] disclosure.
    const reconstructed = reconstructAntifraudDisclosure({
      thid,
      jurisdiction,
      subjectKind: 'animal',
      context,
      attributeName,
      attributeValue,
      claimSaltSeed,
    });

    expect(reconstructed.contents).toEqual([
      expect.any(String),
      attributeName,
      attributeValue,
    ]);
    expect(issued.sdJwtPayload._sd).toContain(reconstructed.digest);
  });

  it('does not match with another thid, attribute name, or attribute value', () => {
    const issued = buildAntifraudRequestBoundCommitments({
      thid,
      jurisdiction,
      subjectKind: 'animal',
      context,
      claims: [{ attributeName, attributeValue }],
      claimSaltSeedFactory: () => claimSaltSeed,
    });
    const digest = issued.sdJwtPayload._sd[0];

    const variants = [
      { thid: '67e55044-10b1-426f-9247-bb680e5fe0c8' },
      { attributeName: 'Animal.birthDate' },
      { attributeValue: '981020000999999' },
    ];
    for (const variant of variants) {
      expect(reconstructAntifraudDisclosure({
        thid,
        jurisdiction,
        subjectKind: 'animal',
        context,
        attributeName,
        attributeValue,
        claimSaltSeed,
        ...variant,
      }).digest).not.toBe(digest);
    }
  });

  it('rejects reused seeds because every SD-JWT claim must have independent salt material', () => {
    expect(() => buildAntifraudRequestBoundCommitments({
      thid,
      jurisdiction,
      subjectKind: 'animal',
      context,
      claims: [
        { attributeName, attributeValue },
        { attributeName: 'Animal.birthDate', attributeValue: '2020-02-02' },
      ],
      claimSaltSeedFactory: () => claimSaltSeed,
    })).toThrow(/unique claim salt seed/i);
  });

  it('rejects predictable UUID versions as request secrets', () => {
    expect(() => reconstructAntifraudDisclosure({
      thid: '6ba7b810-9dad-11d1-80b4-00c04fd430c8',
      jurisdiction,
      subjectKind: 'animal',
      context,
      attributeName,
      attributeValue,
      claimSaltSeed,
    })).toThrow(/UUID v4/);
  });
});
