// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

import { decodeJwt } from 'jose';
import { GenericOidcConfig, GenericOidcTokenVerifier } from './GenericOidcTokenVerifier';
import { ITokenVerifier, VerificationResult } from './ITokenVerifier';

export type TrustedOidcProvider = GenericOidcConfig & {
  verifier?: ITokenVerifier;
};

/**
 * Routes an id_token to one explicitly trusted OIDC provider in this GW.
 *
 * The decoded `iss` claim is only a routing hint. Trust is established by the
 * selected provider verifier, which validates the signature and the exact
 * configured `issuer` and `audience` before returning a valid result.
 */
export class TrustedOidcTokenVerifier implements ITokenVerifier {
  private readonly verifiersByIssuer: ReadonlyMap<string, ITokenVerifier>;

  constructor(providers: readonly TrustedOidcProvider[]) {
    this.verifiersByIssuer = new Map(
      providers.map((provider) => [
        provider.issuer,
        provider.verifier || new GenericOidcTokenVerifier(provider),
      ]),
    );
  }

  public async verify(token: string): Promise<VerificationResult> {
    let issuer = '';
    try {
      issuer = String(decodeJwt(token).iss || '').trim();
    } catch {
      return { valid: false, error: 'Invalid id_token structure.' };
    }

    const verifier = this.verifiersByIssuer.get(issuer);
    if (!verifier) return { valid: false, error: 'Untrusted id_token issuer.' };
    return verifier.verify(token);
  }
}

