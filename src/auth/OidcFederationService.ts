// src/auth/OidcFederationService.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

import { createRemoteJWKSet, jwtVerify, JWTPayload } from 'jose';

export type FederationProvider = 'eidas';

export type OidcFederationConfig = {
  issuer: string;
  audience: string;
  jwksUri: string;
};

export type FederationResult = {
  firebaseCustomToken: string;
  subject: string;
  email?: string;
  provider: FederationProvider;
};

function getEnvOrThrow(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

function getFederationConfig(provider: FederationProvider): OidcFederationConfig {
  switch (provider) {
    case 'eidas':
      return {
        issuer: getEnvOrThrow('EIDAS_ISSUER'),
        audience: getEnvOrThrow('EIDAS_CLIENT_ID'),
        jwksUri: getEnvOrThrow('EIDAS_JWKS_URI'),
      };
  }
}

async function verifyOidcIdToken(idToken: string, cfg: OidcFederationConfig): Promise<JWTPayload> {
  const jwks = createRemoteJWKSet(new URL(cfg.jwksUri));
  const { payload } = await jwtVerify(idToken, jwks, {
    issuer: cfg.issuer,
    audience: cfg.audience,
  });
  return payload;
}

/**
 * Verifies a federated OIDC id_token (e.g. eIDAS) and returns a Firebase custom token.
 *
 * In `NODE_ENV=test`, verification is bypassed and a deterministic token is returned.
 */
export async function federateOidcIdTokenToFirebaseCustomToken(params: {
  provider: FederationProvider;
  idToken: string;
}): Promise<FederationResult> {
  if (process.env.NODE_ENV === 'test') {
    const subject = 'eidas:test-subject';
    return {
      provider: params.provider,
      subject,
      firebaseCustomToken: `test-firebase-custom-token:${subject}`,
    };
  }

  const cfg = getFederationConfig(params.provider);
  const payload = await verifyOidcIdToken(params.idToken, cfg);

  const subject = String(payload.sub || '');
  if (!subject) {
    throw new Error('Federated id_token missing "sub".');
  }

  const email = typeof payload.email === 'string' ? payload.email : undefined;

  // IMPORTANT: choose a stable UID mapping. Here we namespace by provider.
  const uid = `${params.provider}:${subject}`;
  const customClaims: Record<string, unknown> = {
    federated_provider: params.provider,
    federated_sub: subject,
    ...(email ? { email } : {}),
  };

  const { getAuth } = await import('firebase-admin/auth');
  const firebaseCustomToken = await getAuth().createCustomToken(uid, customClaims);

  return { provider: params.provider, subject, email, firebaseCustomToken };
}
