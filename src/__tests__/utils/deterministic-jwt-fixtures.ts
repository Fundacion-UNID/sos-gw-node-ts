// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

import { createHash } from 'crypto';
import {
  addVCs,
  buildJwtCompact,
  createVP,
  prepareJwtBytesForSignature,
  prepareJwtForSignature,
  type VpCredentialInput,
  type VpTokenPayload,
} from 'gdc-common-utils-ts';
import {
  deriveDeterministicEcJwkPair,
  type DeterministicEcJwkAlgorithm as DeterministicJwtAlgorithm,
  type DeterministicEcJwkPair,
} from 'gdc-common-utils-ts/utils/deterministic-jwk';
import type { ITokenVerifier, VerificationResult } from '../../auth/ITokenVerifier';
import { importJWK, jwtVerify, SignJWT, type JWK, type JWTPayload, type KeyLike } from 'jose';

export { deriveDeterministicEcJwkPair };

/**
 * Signed compact JWT plus the exact `header.payload` input bytes that external
 * KMS/HSM signers would need to sign in production.
 */
export type DeterministicSignedJwtFixture<TPayload extends Record<string, unknown>> = {
  compactToken: string;
  header: Record<string, unknown>;
  payload: TPayload;
  signingInput: string;
  signingBytes: Uint8Array;
  encodedHeader: string;
  encodedPayload: string;
  publicJwk: JWK;
  privateJwk: JWK;
};

function sha256Base64Url(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('base64url');
}

async function importSigningKey(privateJwk: JWK, alg: DeterministicJwtAlgorithm): Promise<KeyLike> {
  return importJWK(privateJwk, alg) as Promise<KeyLike>;
}

/**
 * Builds and signs one compact JWT while also exposing the external-signing
 * `header.payload` bytes used by KMS-backed BFF flows.
 */
export async function buildDeterministicSignedJwt<TPayload extends Record<string, unknown>>(input: {
  seed: string;
  purpose: string;
  payload: TPayload;
  alg?: DeterministicJwtAlgorithm;
  header?: Record<string, unknown>;
  includePublicJwkInHeader?: boolean;
}): Promise<DeterministicSignedJwtFixture<TPayload>> {
  const pair = deriveDeterministicEcJwkPair({
    seed: input.seed,
    purpose: input.purpose,
    alg: input.alg,
  });
  const header = {
    typ: 'JWT',
    alg: pair.alg,
    kid: pair.publicJwk.kid,
    ...(input.includePublicJwkInHeader ? { jwk: pair.publicJwk } : {}),
    ...(input.header || {}),
  };

  const prepared = prepareJwtForSignature(header, input.payload);
  const signingBytes = prepareJwtBytesForSignature(header, input.payload);
  const signer = await importSigningKey(pair.privateJwk as unknown as JWK, pair.alg);
  const compactToken = await new SignJWT(input.payload as JWTPayload)
    .setProtectedHeader(header)
    .sign(signer);
  const [encodedHeader, encodedPayload, signature] = compactToken.split('.');

  if (prepared.encodedHeader !== encodedHeader || prepared.encodedPayload !== encodedPayload) {
    throw new Error('Deterministic JWT preparation diverged from the final signed compact token.');
  }
  if (buildJwtCompact(encodedHeader, encodedPayload, signature) !== compactToken) {
    throw new Error('Compact JWT reassembly mismatch after signing.');
  }

  return {
    compactToken,
    header,
    payload: input.payload,
    signingInput: prepared.signingInput,
    signingBytes,
    encodedHeader,
    encodedPayload,
    publicJwk: pair.publicJwk as unknown as JWK,
    privateJwk: pair.privateJwk as unknown as JWK,
  };
}

/**
 * Minimal local verifier used by GW tests to emulate one trusted BFF issuer.
 *
 * @remarks
 * Production GW may trust Google, Firebase, Entra ID, or another real OIDC
 * issuer. Tests use this verifier so `AppAuthorizationManager` can validate a
 * signed `id_token` end-to-end without reaching a remote JWKS endpoint.
 */
export class DeterministicJwtTokenVerifier implements ITokenVerifier {
  private readonly issuer: string;
  private readonly audience: string;
  private readonly publicJwk: JWK;
  private readonly alg: DeterministicJwtAlgorithm;

  constructor(input: {
    issuer: string;
    audience: string;
    publicJwk: JWK;
    alg?: DeterministicJwtAlgorithm;
  }) {
    this.issuer = input.issuer;
    this.audience = input.audience;
    this.publicJwk = input.publicJwk;
    this.alg = input.alg ?? (String(input.publicJwk.alg || 'ES384') as DeterministicJwtAlgorithm);
  }

  public async verify(token: string): Promise<VerificationResult> {
    try {
      const key = await importJWK(this.publicJwk, this.alg);
      const { payload } = await jwtVerify(token, key, {
        issuer: this.issuer,
        audience: this.audience,
      });
      return { valid: true, payload };
    } catch (error: any) {
      const message = error instanceof Error ? error.message : String(error);
      return { valid: false, error: message };
    }
  }
}

/**
 * Builds a signed OIDC-style `id_token` fixture for one virtual BFF issuer.
 */
export async function buildDeterministicIdTokenFixture(input: {
  seed: string;
  issuer: string;
  audience: string;
  subject: string;
  email: string;
  alg?: DeterministicJwtAlgorithm;
  extraClaims?: Record<string, unknown>;
}): Promise<DeterministicSignedJwtFixture<Record<string, unknown>>> {
  const now = 2_208_988_800;
  return buildDeterministicSignedJwt({
    seed: input.seed,
    purpose: 'demo-bff-id-token',
    alg: input.alg ?? 'ES384',
    payload: {
      iss: input.issuer,
      aud: input.audience,
      sub: input.subject,
      email: input.email,
      email_verified: true,
      iat: now,
      exp: now + 600,
      ...input.extraClaims,
    },
  });
}

/**
 * Builds a signed VP token fixture for one deterministic controller key.
 *
 * The embedded JWK lets `DefaultActivationTrustAdapter` verify the compact JWS
 * locally in strict mode without any remote DID resolution.
 */
export async function buildDeterministicVpTokenFixture(input: {
  seed: string;
  issuerDid: string;
  audience?: string;
  subjectDid?: string;
  credentials: VpCredentialInput[];
  alg?: DeterministicJwtAlgorithm;
  includePublicJwkInHeader?: boolean;
  extraPayload?: Partial<VpTokenPayload>;
}): Promise<DeterministicSignedJwtFixture<Record<string, unknown>>> {
  const now = 2_208_988_800;
  const vpPayload = createVP({
    iss: input.issuerDid,
    sub: input.subjectDid ?? input.issuerDid,
    aud: input.audience,
    jti: `vp-${sha256Base64Url(`${input.seed}:vp:jti`).slice(0, 16)}`,
    nonce: `nonce-${sha256Base64Url(`${input.seed}:vp:nonce`).slice(0, 12)}`,
    iat: now,
    exp: now + 600,
    ...(input.extraPayload || {}),
  });
  addVCs(vpPayload, input.credentials);

  return buildDeterministicSignedJwt({
    seed: input.seed,
    purpose: 'demo-controller-vp-token',
    alg: input.alg ?? 'ES384',
    includePublicJwkInHeader: input.includePublicJwkInHeader ?? true,
    payload: vpPayload as Record<string, unknown>,
  });
}
