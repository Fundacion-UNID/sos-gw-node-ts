// src/auth/ITokenVerifier.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

/**
 * Represents the result of a token verification operation.
 */
export interface VerificationResult {
  valid: boolean;
  payload?: any;
  error?: string;
}

/**
 * Defines the contract for a service that can verify a token,
 * such as an OIDC id_token from an external provider.
 */
export interface ITokenVerifier {
  /**
   * Verifies the authenticity, integrity, and validity of a token.
   * @param token The token string to verify.
   * @returns A promise that resolves to a VerificationResult.
   */
  verify(token: string): Promise<VerificationResult>;
}
