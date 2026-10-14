import { describe, expect, it } from '@jest/globals';
import { allowsLegacyRepresentativeBootstrap } from '../../../managers/hosting/legacy-representative-bootstrap-policy';

const legacyCredential = {
  id: 'urn:example:credential:original',
  issuer: 'did:web:ica-original.example.test',
  type: ['VerifiableCredential', 'LegalRepresentativeCredential'],
};

describe('allowsLegacyRepresentativeBootstrap', () => {
  it('accepts every trusted legacy representative when deployment compatibility is enabled', () => {
    expect(allowsLegacyRepresentativeBootstrap({
      representativeCredential: legacyCredential,
      enabled: true,
    })).toBe(true);
    expect(allowsLegacyRepresentativeBootstrap({
      representativeCredential: {
        ...legacyCredential,
        id: 'urn:example:credential:renewed',
        issuer: 'did:web:another-trusted-ica.example.test',
      },
      enabled: 'true',
    })).toBe(true);
  });

  it('rejects disabled compatibility or another credential type', () => {
    expect(allowsLegacyRepresentativeBootstrap({
      representativeCredential: legacyCredential,
      enabled: false,
    })).toBe(false);
    expect(allowsLegacyRepresentativeBootstrap({
      representativeCredential: { ...legacyCredential, type: ['VerifiableCredential'] },
      enabled: true,
    })).toBe(false);
  });

  it('fails closed for malformed deployment configuration', () => {
    expect(() => allowsLegacyRepresentativeBootstrap({
      representativeCredential: legacyCredential,
      enabled: 'sometimes',
    })).toThrow('must be a boolean value');
  });
});
