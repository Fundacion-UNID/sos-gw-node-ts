import { describe, expect, it } from '@jest/globals';
import {
  buildDeterministicIdTokenFixture,
  buildDeterministicVpTokenFixture,
  deriveDeterministicEcJwkPair,
  DeterministicJwtTokenVerifier,
} from '../../utils/deterministic-jwt-fixtures';

describe('deterministic JWT fixtures', () => {
  it('derives the same EC JWK pair from the same seed and purpose', () => {
    const first = deriveDeterministicEcJwkPair({
      seed: 'gwtemplate-demo-seed-001',
      purpose: 'virtual-bff',
      alg: 'ES384',
    });
    const second = deriveDeterministicEcJwkPair({
      seed: 'gwtemplate-demo-seed-001',
      purpose: 'virtual-bff',
      alg: 'ES384',
    });

    // Auditors can rerun this locally and obtain the same public key material
    // without importing any external secrets.
    expect(second.publicJwk).toEqual(first.publicJwk);
    expect(second.privateJwk).toEqual(first.privateJwk);
  });

  it('builds a signed id_token plus the exact header.payload signing input for a virtual BFF issuer', async () => {
    const fixture = await buildDeterministicIdTokenFixture({
      seed: 'gwtemplate-demo-seed-oidc-001',
      issuer: 'did:web:bff.demo.example',
      audience: 'gw-demo-audience',
      subject: 'controller-sub-001',
      email: 'controller@example.org',
      extraClaims: {
        tenant_id: 'acme-id',
      },
    });
    const verifier = new DeterministicJwtTokenVerifier({
      issuer: 'did:web:bff.demo.example',
      audience: 'gw-demo-audience',
      publicJwk: fixture.publicJwk,
      alg: 'ES384',
    });

    const result = await verifier.verify(fixture.compactToken);
    expect(result.valid).toBe(true);
    expect(result.payload).toMatchObject({
      email: 'controller@example.org',
      tenant_id: 'acme-id',
      sub: 'controller-sub-001',
    });
    expect(fixture.signingInput).toBe(`${fixture.encodedHeader}.${fixture.encodedPayload}`);
    expect(Buffer.from(fixture.signingBytes).toString('utf8')).toBe(fixture.signingInput);
  });

  it('builds a signed vp_token with embedded public JWK for local strict-mode verification', async () => {
    const fixture = await buildDeterministicVpTokenFixture({
      seed: 'gwtemplate-demo-seed-vp-001',
      issuerDid: 'did:web:controller.demo.example',
      audience: 'did:web:host.demo.example',
      credentials: [
        {
          '@context': ['https://www.w3.org/2018/credentials/v1'],
          type: ['VerifiableCredential', 'OrganizationCredential'],
          credentialSubject: {
            id: 'did:web:provider.demo.example',
            taxID: 'VATES-B00112233',
          },
        },
      ],
    });

    const verifier = new DeterministicJwtTokenVerifier({
      issuer: 'did:web:controller.demo.example',
      audience: 'did:web:host.demo.example',
      publicJwk: fixture.publicJwk,
      alg: 'ES384',
    });
    const verified = await verifier.verify(fixture.compactToken);

    // The previous verifier already checked the signature. These assertions
    // focus on the VP-specific claims and on the embedded public JWK contract.
    expect(verified.valid).toBe(true);
    expect(fixture.header.jwk).toMatchObject({
      kty: 'EC',
      crv: 'P-384',
    });
    expect((fixture.payload as any).vp.verifiableCredential).toHaveLength(1);
    expect(fixture.signingInput).toBe(`${fixture.encodedHeader}.${fixture.encodedPayload}`);
    expect((verified.payload as any)?.vp?.verifiableCredential).toHaveLength(1);
  });
});
