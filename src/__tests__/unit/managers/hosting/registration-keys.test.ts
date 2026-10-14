import { normalizeBindingAliasList } from '../../../../managers/hosting/registration-keys';

describe('normalizeBindingAliasList', () => {
  it('preserves DID and URN aliases while normalizing public domains as HTTPS URLs', () => {
    const organizationDid =
      'did:web:portal.example:health-care:organization:taxid:VATES-B42215152';
    const organizationUrn = 'urn:gdc:organization:VATES-B42215152';

    expect(normalizeBindingAliasList([
      organizationDid,
      organizationUrn,
      'uhc-gw.unid.online',
      'http://unid.online',
    ])).toEqual([
      organizationDid,
      organizationUrn,
      'https://uhc-gw.unid.online',
      'https://unid.online',
    ]);
  });
});
