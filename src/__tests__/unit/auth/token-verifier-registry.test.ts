// src/__tests__/unit/auth/token-verifier-registry.test.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

import {
  clearTokenVerifierAdapters,
  listTokenVerifierAdapters,
  registerTokenVerifierAdapter,
  resolveTokenVerifierFromEnv,
} from '../../../auth/token-verifier-registry';
import { DemoTokenVerifier } from '../../../auth/DemoTokenVerifier';
import { FirebaseTokenVerifier } from '../../../auth/FirebaseTokenVerifier';
import { GenericOidcTokenVerifier } from '../../../auth/GenericOidcTokenVerifier';
import { TrustedOidcTokenVerifier } from '../../../auth/TrustedOidcTokenVerifier';
import { ITokenVerifier } from '../../../auth/ITokenVerifier';

class CustomVerifier implements ITokenVerifier {
  public async verify(): Promise<any> {
    return { valid: true, payload: { sub: 'custom' } };
  }
}

describe('token-verifier-registry', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    clearTokenVerifierAdapters();
    process.env = { ...originalEnv };
    delete process.env.AUTH_TOKEN_VERIFIER;
    delete process.env.OIDC_ISSUER;
    delete process.env.OIDC_AUDIENCE;
    delete process.env.OIDC_JWKS_URI;
    delete process.env.OIDC_TRUSTED_PROVIDERS_JSON;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('defaults to DemoTokenVerifier in test env when AUTH_TOKEN_VERIFIER is not set', () => {
    const verifier = resolveTokenVerifierFromEnv(true);
    expect(verifier).toBeInstanceOf(DemoTokenVerifier);
  });

  it('defaults to FirebaseTokenVerifier when not test env and AUTH_TOKEN_VERIFIER is not set', () => {
    const verifier = resolveTokenVerifierFromEnv(false);
    expect(verifier).toBeInstanceOf(FirebaseTokenVerifier);
  });

  it('resolves custom adapter by name', () => {
    registerTokenVerifierAdapter('my-idp', () => new CustomVerifier());
    process.env.AUTH_TOKEN_VERIFIER = 'my-idp';
    const verifier = resolveTokenVerifierFromEnv(false);
    expect(verifier).toBeInstanceOf(CustomVerifier);
    expect(listTokenVerifierAdapters()).toEqual(['my-idp']);
  });

  it('throws for unsupported verifier key', () => {
    process.env.AUTH_TOKEN_VERIFIER = 'unsupported-idp';
    expect(() => resolveTokenVerifierFromEnv(false)).toThrow("Unsupported AUTH_TOKEN_VERIFIER='unsupported-idp'");
  });

  it('builds trusted OIDC from canonical iss and aud claim names', () => {
    process.env.AUTH_TOKEN_VERIFIER = 'trusted-oidc';
    process.env.OIDC_TRUSTED_PROVIDERS_JSON = JSON.stringify([
      { iss: 'globaldatacare.es', aud: 'globaldatacare.es' },
      { iss: 'https://securetoken.google.com/vetchain-connect-prof-staging', aud: 'vetchain-connect-prof-staging' },
    ]);

    expect(resolveTokenVerifierFromEnv(false)).toBeInstanceOf(TrustedOidcTokenVerifier);
  });

  it('accepts issuer and audience only as non-conflicting compatibility aliases', () => {
    process.env.AUTH_TOKEN_VERIFIER = 'trusted-oidc';
    process.env.OIDC_TRUSTED_PROVIDERS_JSON = JSON.stringify([
      { issuer: 'globaldatacare.es', audience: 'globaldatacare.es' },
    ]);
    expect(resolveTokenVerifierFromEnv(false)).toBeInstanceOf(TrustedOidcTokenVerifier);

    process.env.OIDC_TRUSTED_PROVIDERS_JSON = JSON.stringify([
      { iss: 'globaldatacare.es', issuer: 'https://attacker.example', aud: 'globaldatacare.es' },
    ]);
    expect(() => resolveTokenVerifierFromEnv(false)).toThrow('.iss conflicts with issuer');
  });

  it('builds single-provider OIDC without duplicating discoverable jwks_uri', () => {
    process.env.AUTH_TOKEN_VERIFIER = 'oidc';
    process.env.OIDC_ISSUER = 'globaldatacare.es';
    process.env.OIDC_AUDIENCE = 'globaldatacare.es';

    expect(resolveTokenVerifierFromEnv(false)).toBeInstanceOf(GenericOidcTokenVerifier);
  });
});
