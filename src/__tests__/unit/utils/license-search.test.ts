// Copyright 2026 Antifraud Services Inc. under the Apache License, Version 2.0.

import { describe, expect, it } from '@jest/globals';
import {
  ClaimsOfferSchemaorg,
  ClaimsPersonSchemaorg,
  DeviceAppTypes,
  DeviceUserClasses,
  EXAMPLE_LICENSE_ACTIVE_RECORD,
  EXAMPLE_LICENSE_AVAILABLE_RECORD,
  EXAMPLE_LICENSE_OFFER_ID,
  EXAMPLE_LICENSE_SEAT_UUID_ACTIVE,
  EXAMPLE_LICENSE_SUBJECT_ID_ACTIVE,
  LicenseCategories,
  LicenseClaimContext,
  LicenseStatuses,
} from 'gdc-common-utils-ts';
import {
  buildLicenseSearchClaims,
  extractLicenseSearchFilters,
  mapLicenseCategory,
  matchesLicenseFilters,
} from '../../../utils/license-search';

describe('license-search utils', () => {
  it('extracts claims-first filters used by current shared search editors', () => {
    const filters = extractLicenseSearchFilters({
      meta: {
        status: EXAMPLE_LICENSE_AVAILABLE_RECORD.status,
        claims: {
          [ClaimsOfferSchemaorg.serialNumber]: EXAMPLE_LICENSE_ACTIVE_RECORD.id,
          [ClaimsPersonSchemaorg.email]: EXAMPLE_LICENSE_ACTIVE_RECORD.claims[ClaimsPersonSchemaorg.email],
        },
      },
    } as any);

    expect(filters[ClaimsOfferSchemaorg.serialNumber]).toEqual([EXAMPLE_LICENSE_ACTIVE_RECORD.id]);
    expect(filters[ClaimsPersonSchemaorg.email]).toEqual([EXAMPLE_LICENSE_ACTIVE_RECORD.claims[ClaimsPersonSchemaorg.email]]);
    expect(filters.status).toEqual([EXAMPLE_LICENSE_AVAILABLE_RECORD.status]);
  });

  it('projects stored device licenses into schema.org-flavored search claims', () => {
    const claims = buildLicenseSearchClaims({
      id: EXAMPLE_LICENSE_SEAT_UUID_ACTIVE,
      userClass: DeviceUserClasses.Employee,
      type: DeviceAppTypes.Mobile,
      orderId: EXAMPLE_LICENSE_OFFER_ID,
      issuedToEmail: EXAMPLE_LICENSE_ACTIVE_RECORD.claims[ClaimsPersonSchemaorg.email],
      issuedToRole: EXAMPLE_LICENSE_ACTIVE_RECORD.claims[ClaimsPersonSchemaorg.hasOccupationalRoleValue],
    } as any);

    expect(claims['@context']).toBe(LicenseClaimContext.SchemaOrg);
    expect(claims[ClaimsOfferSchemaorg.serialNumber]).toBe(EXAMPLE_LICENSE_SEAT_UUID_ACTIVE);
    expect(claims[ClaimsOfferSchemaorg.identifier]).toBe(EXAMPLE_LICENSE_OFFER_ID);
    expect(claims[ClaimsPersonSchemaorg.email]).toBe(EXAMPLE_LICENSE_ACTIVE_RECORD.claims[ClaimsPersonSchemaorg.email]);
  });

  it('matches exact license filters against the current storage model', () => {
    const matches = matchesLicenseFilters(
      {
        id: EXAMPLE_LICENSE_SEAT_UUID_ACTIVE,
        status: LicenseStatuses.Available,
        userClass: DeviceUserClasses.Employee,
        type: DeviceAppTypes.Mobile,
        orderId: EXAMPLE_LICENSE_OFFER_ID,
        subjectId: EXAMPLE_LICENSE_SUBJECT_ID_ACTIVE,
      } as any,
      {
        [ClaimsOfferSchemaorg.serialNumber]: [EXAMPLE_LICENSE_SEAT_UUID_ACTIVE],
        status: [LicenseStatuses.Available],
      },
    );

    expect(matches).toBe(true);
    expect(mapLicenseCategory(DeviceUserClasses.Employee)).toBe(LicenseCategories.Professional);
  });
});
