// src/auth/GenericOidcTokenVerifier.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

import { createLocalJWKSet, JSONWebKeySet, jwtVerify } from 'jose';
import { ITokenVerifier, VerificationResult } from './ITokenVerifier';

export type GenericOidcConfig = {
  issuer: string;
  audience: string;
  /** Optional override. By default it is read from the issuer's OIDC discovery document. */
  jwksUri?: string;
};

export class GenericOidcTokenVerifier implements ITokenVerifier {
  private readonly issuer: string;
  private readonly audience: string;
  private readonly configuredJwksUri?: string;
  private jwksUriPromise?: Promise<string>;
  private jwksPromise?: Promise<ReturnType<typeof createLocalJWKSet>>;
  private jwksLoadedAt = 0;

  constructor(config: GenericOidcConfig) {
    this.issuer = config.issuer;
    this.audience = config.audience;
    this.configuredJwksUri = config.jwksUri;
  }

  private discoveryUrl(): URL {
    const issuerUrl = /^https?:\/\//i.test(this.issuer)
      ? new URL(this.issuer)
      : new URL(`https://${this.issuer}`);
    issuerUrl.pathname = `${issuerUrl.pathname.replace(/\/$/, '')}/.well-known/openid-configuration`;
    issuerUrl.search = '';
    issuerUrl.hash = '';
    return issuerUrl;
  }

  private async resolveJwksUri(): Promise<string> {
    if (this.configuredJwksUri) return this.configuredJwksUri;
    if (!this.jwksUriPromise) {
      this.jwksUriPromise = (async () => {
        const response = await fetch(this.discoveryUrl());
        if (!response.ok) throw new Error(`OIDC discovery failed (${response.status}).`);
        const discovery = await response.json() as { issuer?: unknown; jwks_uri?: unknown };
        if (discovery.issuer !== this.issuer) {
          throw new Error('OIDC discovery issuer does not match the configured issuer.');
        }
        const jwksUri = typeof discovery.jwks_uri === 'string' ? discovery.jwks_uri.trim() : '';
        if (!jwksUri) throw new Error('OIDC discovery document is missing jwks_uri.');
        return new URL(jwksUri).toString();
      })().catch((error) => {
        this.jwksUriPromise = undefined;
        throw error;
      });
    }
    return this.jwksUriPromise;
  }

  private async resolveJwks(): Promise<ReturnType<typeof createLocalJWKSet>> {
    const now = Date.now();
    if (!this.jwksPromise || now - this.jwksLoadedAt >= 300_000) {
      this.jwksLoadedAt = now;
      this.jwksPromise = (async () => {
        const response = await fetch(await this.resolveJwksUri());
        if (!response.ok) throw new Error(`OIDC JWKS download failed (${response.status}).`);
        const jwks = await response.json() as JSONWebKeySet;
        if (!jwks || !Array.isArray(jwks.keys)) throw new Error('OIDC jwks_uri response is not a JSON Web Key Set.');
        return createLocalJWKSet(jwks);
      })().catch((error) => {
        this.jwksPromise = undefined;
        this.jwksLoadedAt = 0;
        throw error;
      });
    }
    return this.jwksPromise;
  }

  public async verify(token: string): Promise<VerificationResult> {
    try {
      const jwks = await this.resolveJwks();
      const { payload } = await jwtVerify(token, jwks, {
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

