// Flow contract: derive jwks_uri through standard OpenID discovery, then verify signature plus exact iss and aud before accepting an id_token.
// src/__tests__/unit/auth/GenericOidcTokenVerifier.test.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { GenericOidcTokenVerifier } from '../../../auth/GenericOidcTokenVerifier';

describe('GenericOidcTokenVerifier OpenID discovery', () => {
  const originalFetch = global.fetch;
  afterEach(() => { global.fetch = originalFetch; });

  it('discovers jwks_uri from a bare-domain issuer and validates its exact audience', async () => {
    const { privateKey, publicKey } = await generateKeyPair('ES384');
    const publicJwk = await exportJWK(publicKey);
    const token = await new SignJWT({ sub: 'employee-001' })
      .setProtectedHeader({ alg: 'ES384', kid: 'gdc-login-1' })
      .setIssuer('globaldatacare.es')
      .setAudience('globaldatacare.es')
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(privateKey);
    global.fetch = jest.fn(async (input: string | URL | Request) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url === 'https://globaldatacare.es/.well-known/openid-configuration') {
        return new Response(JSON.stringify({
          issuer: 'globaldatacare.es',
          jwks_uri: 'https://globaldatacare.es/.well-known/jwks.json',
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      if (url === 'https://globaldatacare.es/.well-known/jwks.json') {
        return new Response(JSON.stringify({ keys: [{ ...publicJwk, kid: 'gdc-login-1', alg: 'ES384' }] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response('not found', { status: 404 });
    }) as typeof fetch;

    const result = await new GenericOidcTokenVerifier({
      issuer: 'globaldatacare.es',
      audience: 'globaldatacare.es',
    }).verify(token);

    expect(result).toEqual(expect.objectContaining({ valid: true }));
    expect(result.payload?.sub).toBe('employee-001');
  });
});

