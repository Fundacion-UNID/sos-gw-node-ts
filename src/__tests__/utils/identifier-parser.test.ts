// src/__tests__/utils/identifier-parser.test.ts

import { parseIdentifierType } from "../../utils/identifier-parser";

describe('parseIdentifierType', () => {
  it('should correctly parse a type with a country code and a subdivision', () => {
    // Step 1.
    // Parse the identifier-type token only; this test is not about the public
    // business identifier or the content CID.
    const result = parseIdentifierType('JHNES-CL');
    expect(result).toEqual({
      type: 'JHN',
      countryCode: 'ES',
      subdivision: 'CL',
    });
  });

  it('should correctly parse a type with only a country code (convention)', () => {
    // Step 1.
    // The parser should keep the technical type split stable for locator and
    // routing helpers.
    const result = parseIdentifierType('NNES');
    expect(result).toEqual({
      type: 'NN',
      countryCode: 'ES',
      subdivision: undefined,
    });
  });

  it('should correctly parse a type with a 3-letter code and country', () => {
    // Step 1.
    // Preserve the same canonical parsing contract for a different token shape.
    const result = parseIdentifierType('PPNFR');
    expect(result).toEqual({
      type: 'PPN',
      countryCode: 'FR',
      subdivision: undefined,
    });
  });

  it('should correctly parse a type with a 2-letter code, country, and subdivision', () => {
    // Step 1.
    // Routing helpers may need the subdivision as part of the technical locator.
    const result = parseIdentifierType('DLCA-BC');
    expect(result).toEqual({
      type: 'DL',
      countryCode: 'CA',
      subdivision: 'BC',
    });
  });

  it('should return the original type if it does not match a known pattern', () => {
    // Step 1.
    // Invalid or unsupported values should pass through unchanged rather than
    // being coerced into a misleading technical id.
    const result = parseIdentifierType('UNKNOWN');
    expect(result).toEqual({
      type: 'UNKNOWN',
      countryCode: undefined,
      subdivision: undefined,
    });
  });

  it('should handle types with no country code gracefully', () => {
    // Step 1.
    // Keep the parser permissive when the caller only has a raw type token.
    const result = parseIdentifierType('TAX');
    expect(result).toEqual({
      type: 'TAX',
      countryCode: undefined,
      subdivision: undefined,
    });
  });
    
  it('should handle an empty string', () => {
    // Step 1.
    // Empty input should remain empty instead of inventing a fake locator.
    const result = parseIdentifierType('');
    expect(result).toEqual({
      type: '',
      countryCode: undefined,
      subdivision: undefined,
    });
  });
});
