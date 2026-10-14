// Flow contract: validated ICA legal identity is reused during legacy activation without requiring duplicate caller claims.
import { describe, expect, it } from '@jest/globals';
import { ClaimsOrganizationSchemaorg } from 'gdc-common-utils-ts/constants/schemaorg';
import { applyLegalOrganizationIdentityCompatibility } from '../../../managers/hosting/activation-helpers';

const LEGAL_NAME = 'Example Veterinary Organization';
const OFFICIAL_LEGAL_ID = 'CA-EXAMPLE-001';
const ADDRESS_COUNTRY = 'CA';

describe('legacy activation legal identity compatibility', () => {
  it('derives the Gaia-X legal identity from the validated ICA OrganizationCredential', () => {
    const normalizedClaims = applyLegalOrganizationIdentityCompatibility({}, {
      credentialSubject: {
        legalName: LEGAL_NAME,
        taxID: OFFICIAL_LEGAL_ID,
        address: [{ addressCountry: ADDRESS_COUNTRY }],
      },
    });

    expect(normalizedClaims).toEqual(expect.objectContaining({
      [ClaimsOrganizationSchemaorg.legalName]: LEGAL_NAME,
      [ClaimsOrganizationSchemaorg.identifierValue]: OFFICIAL_LEGAL_ID,
      [ClaimsOrganizationSchemaorg.addressCountry]: ADDRESS_COUNTRY,
    }));
  });
});
