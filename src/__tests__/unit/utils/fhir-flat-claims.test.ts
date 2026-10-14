// Flow contract: reuse shared test fixtures and canonical types; do not introduce duplicated literals.
// Every persistence manager delegates claim-key syntax to the shared FHIR API validator before allowlist validation.
import { describe, expect, it } from '@jest/globals';
import { normalizeGovernedFlatClaims } from '../../../utils/fhir-flat-claims';

describe('governed flat-claims persistence gate', () => {
  it('rejects a manager allowlist entry that is not a canonical FHIR API claim key', () => {
    expect(() => normalizeGovernedFlatClaims(
      { malformed_claim_name: ['value'] },
      new Set(['malformed_claim_name']),
      'test resource',
    )).toThrow('Invalid FHIR API claim key');
  });
});
