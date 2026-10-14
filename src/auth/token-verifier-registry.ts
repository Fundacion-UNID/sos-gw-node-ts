// src/auth/token-verifier-registry.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

import { ITokenVerifier } from './ITokenVerifier';
import { DemoTokenVerifier } from './DemoTokenVerifier';
import { FirebaseTokenVerifier } from './FirebaseTokenVerifier';
import { GoogleTokenVerifier } from './GoogleTokenVerifier';
import { AppleTokenVerifier } from './AppleTokenVerifier';
import { GenericOidcTokenVerifier } from './GenericOidcTokenVerifier';
import { TrustedOidcProvider, TrustedOidcTokenVerifier } from './TrustedOidcTokenVerifier';

export type TokenVerifierAdapterFactory = () => ITokenVerifier;

const adapterRegistry = new Map<string, TokenVerifierAdapterFactory>();

function requireEnv(name: string): string {
  const value = String(process.env[name] || '').trim();
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

function parseTrustedOidcProviders(): TrustedOidcProvider[] {
  const name = 'OIDC_TRUSTED_PROVIDERS_JSON';
  let parsed: unknown;
  try {
    parsed = JSON.parse(requireEnv(name));
  } catch (error: any) {
    if (String(error?.message || '').startsWith('Missing required env var:')) throw error;
    throw new Error(`${name} must be a valid JSON array.`);
  }
  if (!Array.isArray(parsed) || !parsed.length) throw new Error(`${name} must contain at least one provider.`);
  const seenIssuers = new Set<string>();
  return parsed.map((raw, index) => {
    const provider = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
    const required = (canonical: 'iss' | 'aud', alias: 'issuer' | 'audience'): string => {
      const canonicalValue = typeof provider[canonical] === 'string' ? provider[canonical].trim() : '';
      const aliasValue = typeof provider[alias] === 'string' ? provider[alias].trim() : '';
      if (canonicalValue && aliasValue && canonicalValue !== aliasValue) {
        throw new Error(`${name}[${index}].${canonical} conflicts with ${alias}.`);
      }
      const value = canonicalValue || aliasValue;
      if (!value) throw new Error(`${name}[${index}].${canonical} is required.`);
      return value;
    };
    const issuer = required('iss', 'issuer');
    const audience = required('aud', 'audience');
    if (seenIssuers.has(issuer)) throw new Error(`${name} contains duplicate issuer '${issuer}'.`);
    seenIssuers.add(issuer);
    const jwksUri = typeof provider.jwksUri === 'string' ? provider.jwksUri.trim() : '';
    return { issuer, audience, ...(jwksUri ? { jwksUri } : {}) };
  });
}

export function registerTokenVerifierAdapter(name: string, factory: TokenVerifierAdapterFactory): void {
  adapterRegistry.set(String(name).trim().toLowerCase(), factory);
}

export function listTokenVerifierAdapters(): string[] {
  return Array.from(adapterRegistry.keys()).sort();
}

export function clearTokenVerifierAdapters(): void {
  adapterRegistry.clear();
}

export function resolveTokenVerifierFromEnv(isTestEnv: boolean): ITokenVerifier {
  const configured = String(process.env.AUTH_TOKEN_VERIFIER || '').trim().toLowerCase();
  if (isTestEnv && !configured) {
    return new DemoTokenVerifier();
  }

  const key = configured || 'firebase';
  const adapter = adapterRegistry.get(key);
  if (adapter) {
    return adapter();
  }

  if (key === 'demo') return new DemoTokenVerifier();
  if (key === 'firebase') return new FirebaseTokenVerifier();
  if (key === 'google') return new GoogleTokenVerifier(requireEnv('GOOGLE_CLIENT_ID'));
  if (key === 'apple') return new AppleTokenVerifier();
  if (key === 'oidc') {
    const jwksUri = String(process.env.OIDC_JWKS_URI || '').trim();
    return new GenericOidcTokenVerifier({
      issuer: requireEnv('OIDC_ISSUER'),
      audience: requireEnv('OIDC_AUDIENCE'),
      ...(jwksUri ? { jwksUri } : {}),
    });
  }
  if (key === 'trusted-oidc') return new TrustedOidcTokenVerifier(parseTrustedOidcProviders());

  throw new Error(
    `Unsupported AUTH_TOKEN_VERIFIER='${key}'. Allowed built-ins: demo,firebase,google,apple,oidc,trusted-oidc.`
  );
}
