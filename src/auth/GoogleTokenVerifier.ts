// src/auth/GoogleTokenVerifier.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

import { OAuth2Client } from 'google-auth-library';
import { ITokenVerifier, VerificationResult } from './ITokenVerifier';
const client = new OAuth2Client();

export async function verifyGoogleIdToken(idToken: string, clientId: string) {
  const ticket = await client.verifyIdToken({ idToken, audience: clientId });
  const payload = ticket.getPayload();

  return {
    uid: payload?.sub!,
    email: payload?.email || '',
  };
}

export class GoogleTokenVerifier implements ITokenVerifier {
  private readonly clientId: string;

  constructor(clientId: string) {
    this.clientId = clientId;
  }

  public async verify(token: string): Promise<VerificationResult> {
    try {
      const result = await verifyGoogleIdToken(token, this.clientId);
      return { valid: true, payload: result };
    } catch (error: any) {
      const message = error instanceof Error ? error.message : String(error);
      return { valid: false, error: message };
    }
  }
}
