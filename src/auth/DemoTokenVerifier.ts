// src/auth/DemoTokenVerifier.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

import { ITokenVerifier, VerificationResult } from "./ITokenVerifier";

/**
 * A demo implementation of ITokenVerifier.
 * In a development or demo environment, this verifier bypasses actual cryptographic
 * signature verification. It only decodes the token to extract its payload.
 *
 * WARNING: DO NOT USE IN PRODUCTION.
 */
export class DemoTokenVerifier implements ITokenVerifier {
  /**
   * "Verifies" a token by decoding it. In this demo implementation, it always
   * returns a successful result unless the token is malformed.
   * @param token The token string to "verify".
   * @returns A promise that resolves to a VerificationResult.
   */
  public async verify(token: string): Promise<VerificationResult> {
    try {
      // Split the JWT into its three parts.
      const parts = token.split('.');
      if (parts.length !== 3) {
        return { valid: false, error: 'Token is not a valid JWT format.' };
      }
      
      // Decode the payload part (the second part).
      const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString('utf8'));

      // In demo mode, we assume the token is valid if we can decode it.
      return { valid: true, payload: payload };

    } catch (error: any) {
      console.error(`[DemoTokenVerifier] Failed to decode token: ${error.message}`);
      return { valid: false, error: `Failed to decode token: ${error.message}` };
    }
  }
}
