// src/__tests__/unit/utils/firestore.utils.test.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

import {
  initializeTestEnvironment,
  RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { generateCollectionName } from '../../../utils/firestore';
import { Sector } from 'gdc-common-utils-ts/models/urlPath';
import { ClaimsOrganizationSchemaorg, ClaimsPersonSchemaorg, ClaimsServiceSchemaorg } from 'gdc-common-utils-ts/constants/schemaorg';

let testEnv: RulesTestEnvironment;

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'test-firestore-adapter',
    firestore: {
      host: 'localhost',
      port: 8080,
    },
  });
});

afterAll(async () => {
  await testEnv.cleanup();
});

describe('firestore.utils', () => {
  describe('generateCollectionName', () => {
    /**
     * @description
     * Firestore Collection Naming Strategy Documentation.
     *
     * The collection name is deterministically generated to ensure data isolation
     * for each tenant in a multi-tenant architecture.
     *
     * The pattern is:
     * `[countryCode]_[idType]_[idValue]_[sector]_[section]`
     *
     * - `countryCode`: (e.g., 'ES', 'PT') - From `address.countryAddress` claim.
     * - `idType`: (e.g., 'TAX', 'VAT') - From `identifier.additionalType` claim.
     * - `idValue`: (e.g., 'B00112233') - From `identifier.value` claim.
     * - `sector`: (e.g., 'health-care', 'host') - The business sector for the tenant.
     * - `section`: (e.g., 'registry', 'employees', 'customers') - The data partition
     *   within the tenant's vault.
     *
     * @example
     * // For a tenant in the health-care sector in Spain with TAX ID B00112233,
     * // the collection for its customers would be:
     * // 'ES_TAX_B00112233_health-care_customers'
     *
     * // The host's own registry would be:
     * // 'ES_TAX_A00112233_host_registry'
     */
    it('should generate a deterministic collection name from claims and section', () => {
      // Arrange
      const claims = {
        [ClaimsOrganizationSchemaorg.addressCountry]: 'ES',
        [ClaimsOrganizationSchemaorg.identifierType]: 'TAX',
        [ClaimsOrganizationSchemaorg.identifierValue]: 'B00112233',
        [ClaimsServiceSchemaorg.category]: Sector.HEALTH_CARE,
      };
      const section = 'customers';

      const expectedCollectionName = 'ES_TAX_B00112233_health-care_customers';

      // Act
      const collectionName = generateCollectionName(claims, section);

      // Assert
      expect(collectionName).toBe(expectedCollectionName);
    });

    it('should handle the "host" sector correctly', () => {
        // Arrange
        const claims = {
        [ClaimsOrganizationSchemaorg.addressCountry]: 'ES',
        [ClaimsOrganizationSchemaorg.identifierType]: 'TAX',
        [ClaimsOrganizationSchemaorg.identifierValue]: 'A00112233',
        [ClaimsServiceSchemaorg.category]: 'host',
        };
        const section = 'registry';
  
        const expectedCollectionName = 'ES_TAX_A00112233_host_registry';
  
        // Act
        const collectionName = generateCollectionName(claims, section);
  
        // Assert
        expect(collectionName).toBe(expectedCollectionName);
      });
  });
});
