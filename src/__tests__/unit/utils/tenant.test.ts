// File: src/__tests__/unit/utils/tenant.test.ts

import { ClaimsOrganizationSchemaorg, ClaimsServiceSchemaorg } from 'gdc-common-utils-ts/constants/schemaorg';
import { generateTenantCollectionNameFromClaims, isValidTenantAlternateName } from '../../../utils/tenant';

const originalStorageEnv = {
  STORAGE_LAYOUT: process.env.STORAGE_LAYOUT,
  DEPLOYMENT_ENV: process.env.DEPLOYMENT_ENV,
  NETWORK_MODE: process.env.NETWORK_MODE,
  HOST_STORAGE_SCOPE: process.env.HOST_STORAGE_SCOPE,
};

afterEach(() => {
  for (const [key, value] of Object.entries(originalStorageEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

const exampleClaims = {
  [ClaimsOrganizationSchemaorg.addressCountry]: 'ES',
  [ClaimsOrganizationSchemaorg.identifierType]: 'TAX',
  [ClaimsOrganizationSchemaorg.identifierValue]: 'B87.617.981',
  [ClaimsServiceSchemaorg.category]: 'system',
};

describe('generateTenantCollectionNameFromClaims', () => {
  test('keeps the historical collection name when no persistence namespace is configured', () => {
    process.env.STORAGE_LAYOUT = 'legacy-v1';

    expect(generateTenantCollectionNameFromClaims(exampleClaims)).toBe('ES_TAX_B87617981_system');
  });

  test('isolates scoped-v2 collections by deployment, ledger mode and anonymous host', () => {
    process.env.STORAGE_LAYOUT = 'scoped-v2';
    process.env.DEPLOYMENT_ENV = 'staging';
    process.env.NETWORK_MODE = 'test-network';
    process.env.HOST_STORAGE_SCOPE = 'host-a';

    expect(generateTenantCollectionNameFromClaims(exampleClaims)).toBe(
      'staging_test-network_host-a__ES_TAX_B87617981_system',
    );
  });
});

describe('isValidTenantAlternateName', () => {

  // Test Case 1: A valid alternateName
  test('should return true for a valid, non-conflicting alternateName', () => {
    expect(isValidTenantAlternateName('my-tenant')).toBe(true);
  });

  // Test Case 2: The exact word "host" (lowercase)
  test('should return false for the exact word "host"', () => {
    expect(isValidTenantAlternateName('host')).toBe(false);
  });

  // Test Case 3: The word "host" in a different case
  test('should return false for "Host" regardless of case', () => {
    expect(isValidTenantAlternateName('Host')).toBe(false);
    expect(isValidTenantAlternateName('HOST')).toBe(false);
  });

  // Test Case 4: A name starting with "host"
  test('should return false for names starting with "host"', () => {
    expect(isValidTenantAlternateName('hostname')).toBe(false);
    expect(isValidTenantAlternateName('host-tenant')).toBe(false);
  });

  // Test Case 5: A name ending with "host"
  test('should return false for names ending with "host"', () => {
    expect(isValidTenantAlternateName('myhost')).toBe(false);
    expect(isValidTenantAlternateName('tenant-host')).toBe(false);
  });

  // Test Case 6: An empty string
  test('should return false for an empty string', () => {
    expect(isValidTenantAlternateName('')).toBe(false);
  });

  // Test Case 7: A valid name that contains "host" but doesn't start or end with it
  test('should return true for a name containing "host" in the middle', () => {
    // This test assumes the logic is only concerned with prefixes and suffixes.
    // Depending on the desired strictness, this test might need to change.
    // For now, it reflects the current implementation.
    expect(isValidTenantAlternateName('my-host-app')).toBe(true);
  });
});
