// File: src/__tests__/unit/utils/claims.test.ts

import {
  buildFhirClaimKeys,
  getClaimValue,
  getFirstClaimValueByKeys,
  normalizeContextualizedClaims,
  processResponseModesClaim,
  stripKnownFhirClaimContextPrefix,
} from '../../../utils/claims';

describe('processResponseModesClaim', () => {
  const propertyId = 'net.openid.connect.discovery.response_modes_supported';

  // Test Case 1: Claim is not provided (undefined)
  test('should return the default mode when the claim is undefined', () => {
    const expected = `${propertyId}|form_post.jwt`;
    expect(processResponseModesClaim(undefined)).toBe(expected);
  });

  // Test Case 2: Claim is an empty string
  test('should return the default mode when the claim value is empty', () => {
    const claim = `${propertyId}|`;
    const expected = `${propertyId}|form_post.jwt`;
    expect(processResponseModesClaim(claim)).toBe(expected);
  });

  // Test Case 3: Claim provides a single, valid legacy mode
  test('should add the default mode and order it first', () => {
    const claim = `${propertyId}|fhir+json`;
    const expected = `${propertyId}|form_post.jwt,fhir+json`;
    expect(processResponseModesClaim(claim)).toBe(expected);
  });

  // Test Case 4: Claim provides multiple supported modes in the wrong order
  test('should reorder the modes to ensure form_post.jwt is first', () => {
    const claim = `${propertyId}|json,form_post.jwt,fhir+json`;
    const expected = `${propertyId}|form_post.jwt,json,fhir+json`;
    expect(processResponseModesClaim(claim)).toBe(expected);
  });

  // Test Case 5: Claim includes unsupported modes
  test('should strip unsupported modes from the final claim', () => {
    const claim = `${propertyId}|xml,json,invalid,fhir+json`;
    const expected = `${propertyId}|form_post.jwt,json,fhir+json`;
    expect(processResponseModesClaim(claim)).toBe(expected);
  });

  // Test Case 6: Claim already includes the default mode
  test('should not add a duplicate default mode', () => {
    const claim = `${propertyId}|form_post.jwt,json`;
    const expected = `${propertyId}|form_post.jwt,json`;
    expect(processResponseModesClaim(claim)).toBe(expected);
  });

  // Test Case 7: Malformed claim with no pipe separator
  test('should return the default mode for a malformed claim', () => {
    const claim = 'a-malformed-claim-string';
    const expected = `${propertyId}|form_post.jwt`;
    expect(processResponseModesClaim(claim)).toBe(expected);
  });

  // Test Case 8: Claim includes duplicate valid modes
  test('should remove duplicate valid modes', () => {
    const claim = `${propertyId}|json,fhir+json,json,form_post.jwt`;
    const expected = `${propertyId}|form_post.jwt,json,fhir+json`;
    expect(processResponseModesClaim(claim)).toBe(expected);
  });

  // Test Case 9: Claim includes extra whitespace
  test('should handle leading/trailing whitespace around modes', () => {
    const claim = ` ${propertyId} |  json ,  fhir+json  `;
    const expected = `${propertyId}|form_post.jwt,json,fhir+json`;
    expect(processResponseModesClaim(claim)).toBe(expected);
  });

});

describe('normalizeContextualizedClaims', () => {
  const originalIdentityStorageMode = process.env.CLAIMS_IDENTITY_STORAGE_MODE;

  afterEach(() => {
    if (originalIdentityStorageMode === undefined) {
      delete process.env.CLAIMS_IDENTITY_STORAGE_MODE;
      return;
    }
    process.env.CLAIMS_IDENTITY_STORAGE_MODE = originalIdentityStorageMode;
  });

  test('should prefix contextual claims and preserve fully-qualified keys and context fields', () => {
    const claims = normalizeContextualizedClaims({
      '@context': 'org.schema',
      '@type': 'Offer',
      'Offer.identifier': 'urn:uuid:offer-1',
      'org.schema.Offer.status': 'active',
      'Offer.name': 'Care plan',
    });

    expect(claims).toEqual({
      '@context': 'org.schema',
      '@type': 'Offer',
      'org.schema.Offer.identifier': 'urn:uuid:offer-1',
      'org.schema.Offer.name': 'Care plan',
      'org.schema.Offer.status': 'active',
    });
  });

  test('should keep existing claim lookup working for contextualized keys', () => {
    const claims = normalizeContextualizedClaims({
      '@context': 'org.hl7.fhir.api',
      '@type': 'Consent',
      'Consent.action': 'LOINC|48765-2',
      'org.hl7.fhir.api.Consent.actor-role': 'ISCO-08|2211',
    });

    expect(getClaimValue(claims, 'Consent.action')).toBe('LOINC|48765-2');
    expect(getClaimValue(claims, 'Consent.actor-role')).toBe('ISCO-08|2211');
  });

  test('should strip the org.schema prefix when identity storage mode is canonical', () => {
    process.env.CLAIMS_IDENTITY_STORAGE_MODE = 'canonical';

    const claims = normalizeContextualizedClaims({
      '@context': 'org.schema',
      '@type': 'template',
      'org.schema.Organization.identifier.value': 'A12345678',
      'Service.category': 'health-care',
    });

    expect(claims).toEqual({
      '@context': 'org.schema',
      '@type': 'template',
      'Organization.identifier.value': 'A12345678',
      'Service.category': 'health-care',
    });
    expect(getClaimValue(claims, 'org.schema.Organization.identifier.value')).toBe('A12345678');
    expect(getClaimValue(claims, 'org.schema.Service.category')).toBe('health-care');
  });
});

describe('FHIR claim key helpers', () => {
  test('builds canonical plus contextualized FHIR claim keys centrally', () => {
    expect(buildFhirClaimKeys('Composition.type')).toEqual([
      'Composition.type',
      'org.hl7.fhir.api.Composition.type',
      'org.hl7.fhir.r4.Composition.type',
    ]);
  });

  test('strips supported FHIR context prefixes from claim keys', () => {
    expect(stripKnownFhirClaimContextPrefix('org.hl7.fhir.r4.Composition.section')).toBe('Composition.section');
    expect(stripKnownFhirClaimContextPrefix('org.hl7.fhir.api.Composition.section')).toBe('Composition.section');
  });

  test('reads the first available value across canonical and contextual aliases', () => {
    const claims = {
      'org.hl7.fhir.r4.DocumentReference.identifier': 'urn:uuid:doc-1',
    };
    expect(getFirstClaimValueByKeys(claims, buildFhirClaimKeys('DocumentReference.identifier'))).toBe('urn:uuid:doc-1');
  });
});
