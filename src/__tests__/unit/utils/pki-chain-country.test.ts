import { resolveCertificateCountryCode } from '../../../utils/pki-chain';

describe('resolveCertificateCountryCode', () => {
  it('keeps a CA-BC business jurisdiction separate from the CA certificate country', () => {
    expect(resolveCertificateCountryCode('CA-BC', 'CA')).toBe('CA');
  });

  it('rejects a subdivision when no certificate-country override is configured', () => {
    expect(() => resolveCertificateCountryCode('CA-BC')).toThrow(/ISO 3166-1/);
  });
});
