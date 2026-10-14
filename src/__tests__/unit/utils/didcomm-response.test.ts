// Flow contract: every search response profile reuses shared resources and
// governed entry types; canonical output uses Bundle entries while the absent
// environment setting preserves deprecated legacy output during migration.
import {
  EXAMPLE_EMPLOYEE_SEARCH_RESPONSE_BODY,
  OrganizationEmployeeSearchResponseEntryTypes,
} from 'gdc-common-utils-ts';
import {
  SearchResponseProfileEnvironment,
  SearchResponseProfiles,
  buildSearchResponseEntries,
  resolveSearchResponseProfile,
} from '../../../utils/didcomm-response';

const matches = EXAMPLE_EMPLOYEE_SEARCH_RESPONSE_BODY.data.map(entry => entry.resource);

describe('DIDComm search response profiles', () => {
  it('defaults to deprecated legacy output when the deployment variable is absent', () => {
    expect(resolveSearchResponseProfile({})).toBe(SearchResponseProfiles.LegacyResourceData);
    expect(buildSearchResponseEntries(
      OrganizationEmployeeSearchResponseEntryTypes.Employee,
      matches,
      resolveSearchResponseProfile({}),
    )).toEqual([expect.objectContaining({
      resource: { total: matches.length, data: matches },
    })]);
  });

  it('returns each match as the primary resource when the deployment opts in', () => {
    const profile = resolveSearchResponseProfile({
      [SearchResponseProfileEnvironment.Variable]: SearchResponseProfiles.PrimaryResource,
    });
    const entries = buildSearchResponseEntries(
      OrganizationEmployeeSearchResponseEntryTypes.Employee,
      matches,
      profile,
    );

    expect(entries.map(entry => entry.resource)).toEqual(matches);
    expect(entries.every(entry => entry.resource?.data === undefined)).toBe(true);
  });
});
