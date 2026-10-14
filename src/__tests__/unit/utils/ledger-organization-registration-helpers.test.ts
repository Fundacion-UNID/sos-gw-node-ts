import { ClaimsOrganizationSchemaorg } from 'gdc-common-utils-ts/constants/schemaorg';

import {
  buildLedgerOrganizationId,
  resolveLedgerOrganizationId,
} from '../../../utils/ledger-organization-registration-helpers';

describe('ledger organization registration helpers', () => {
  it('builds the canonical ledger organization id as urn:org:*', () => {
    expect(buildLedgerOrganizationId('TAX', 'VATES-B12345678'))
      .toBe('urn:org:tax:VATES-B12345678');
  });

  it('resolves the canonical ledger organization id from claims', () => {
    expect(resolveLedgerOrganizationId({
      [ClaimsOrganizationSchemaorg.identifierType]: 'TAX',
      [ClaimsOrganizationSchemaorg.identifierValue]: 'acme-id',
    } as any)).toBe('urn:org:tax:acme-id');
  });

  it('normalizes legacy fallback ids to the canonical ledger URN', () => {
    expect(resolveLedgerOrganizationId(undefined, 'TAX|legacy-acme'))
      .toBe('urn:org:tax:legacy-acme');
  });
});
