import { buildIcaVerifyUrl, withoutDuplicatePrimaryJwk } from '../../../managers/hosting/ica-did-registration';

const build = (networkMode?: string) => buildIcaVerifyUrl({
  jurisdiction: 'ES',
  sector: 'onehealth-research',
  resourceType: 'contract',
  config: {
    networkMode,
    ica: {
      mode: 'external',
      externalUrl: 'https://ica.globaldatacare.es',
      jurisdiction: 'ES',
    },
  },
  isDemoSecurityMode: () => false,
  isDevelopmentOrDemoDiagnosticsEnabled: () => false,
});

describe('ICA verification network-kind routing', () => {
  it.each(['local-network', 'test-network', 'network'])(
    'uses the canonical %s path section',
    (networkMode) => {
      expect(build(networkMode)).toBe(
        `https://ica.globaldatacare.es/ica/cds-ES/v1/onehealth-research/${networkMode}/pdf/contract/_verify`,
      );
    },
  );

  it.each([undefined, 'test'])('keeps terms as the test compatibility alias', (networkMode) => {
    expect(build(networkMode)).toBe(
      'https://ica.globaldatacare.es/ica/cds-ES/v1/onehealth-research/terms/pdf/contract/_verify',
    );
  });
});

describe('ICA DID registration key projection', () => {
  it('removes the primary key from additional controller JWKS', () => {
    const primary = { kty: 'EC', crv: 'P-384', x: 'primary-x', y: 'primary-y', kid: 'primary-key' };
    const additional = { kty: 'EC', crv: 'P-384', x: 'additional-x', y: 'additional-y', kid: 'additional-key' };

    expect(withoutDuplicatePrimaryJwk({ keys: [{ ...primary }, additional] }, primary)).toEqual({
      keys: [additional],
    });
    expect(withoutDuplicatePrimaryJwk({ keys: [{ ...primary }] }, primary)).toBeUndefined();
  });
});
