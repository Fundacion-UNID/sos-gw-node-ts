/**
 * Flow contract: organization storage, URNs and hosted routes use the
 * jurisdiction that issued the official identifier. An ISO 3166-2 region
 * therefore overrides the postal country, while national identifiers keep the
 * ISO 3166-1 country. Both values remain present as distinct legal evidence.
 */
import { ClaimsOrganizationSchemaorg } from 'gdc-common-utils-ts/constants/schemaorg';
import { resolveOrganizationRouteJurisdiction } from '../../../utils/tenant';

describe('organization route jurisdiction', () => {
  it('uses the ISO subdivision when regional official-id evidence is present', () => {
    expect(resolveOrganizationRouteJurisdiction({
      [ClaimsOrganizationSchemaorg.addressCountry]: 'CA',
      [ClaimsOrganizationSchemaorg.addressRegion]: 'CA-BC',
    })).toBe('CA-BC');
  });

  it('uses the country when no ISO subdivision evidence is present', () => {
    expect(resolveOrganizationRouteJurisdiction({
      [ClaimsOrganizationSchemaorg.addressCountry]: 'CA',
      [ClaimsOrganizationSchemaorg.addressRegion]: 'British Columbia',
    })).toBe('CA');
  });
});
