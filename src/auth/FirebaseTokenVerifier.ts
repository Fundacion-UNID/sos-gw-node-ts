// src/auth/FirebaseTokenVerifier.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

import { ITokenVerifier, VerificationResult } from './ITokenVerifier';
import {
  allowedFirebaseProjectIds,
  firebaseTokenAudience,
  type FirebaseProjectEnvironment,
} from './firebase-token-policy';

export { allowedFirebaseProjectIds, firebaseTokenAudience } from './firebase-token-policy';

export type FirebaseIdTokenVerifier = {
  verifyIdToken(token: string): Promise<unknown>;
};

export type FirebaseAuthProvider = {
  forProject(projectId: string, primaryProjectId: string): Promise<FirebaseIdTokenVerifier>;
};

/**
 * Verifies Firebase ID tokens (issuer: https://securetoken.google.com/<projectId>).
 *
 * `FIREBASE_PROJECT_ID` owns the default Admin/data plane. The optional
 * `FIREBASE_ADDITIONAL_AUTH_PROJECT_IDS` allowlist adds token issuers only.
 * The unverified `aud` selects one allowlisted Admin verifier; that verifier
 * still validates signature, issuer, audience, expiry and token structure.
 */
export class FirebaseTokenVerifier implements ITokenVerifier {
  private loadedProvider?: Promise<FirebaseAuthProvider>;

  public constructor(
    private readonly provider?: FirebaseAuthProvider,
    private readonly env: FirebaseProjectEnvironment = process.env as FirebaseProjectEnvironment,
  ) {}

  public async verify(token: string): Promise<VerificationResult> {
    try {
      const audience = firebaseTokenAudience(token);
      const allowedProjects = allowedFirebaseProjectIds(this.env);
      if (!audience || !allowedProjects.includes(audience)) {
        throw new Error(`Firebase ID token audience '${audience || 'missing'}' is not trusted.`);
      }
      const primaryProjectId = String(this.env.FIREBASE_PROJECT_ID || '').trim();
      const auth = await (await this.authProvider()).forProject(audience, primaryProjectId);
      const decoded = await auth.verifyIdToken(token);
      return { valid: true, payload: decoded };
    } catch (error: any) {
      const message = error instanceof Error ? error.message : String(error);
      return { valid: false, error: message };
    }
  }

  private authProvider(): Promise<FirebaseAuthProvider> {
    if (this.provider) return Promise.resolve(this.provider);
    this.loadedProvider ??= import('./FirebaseAdminAuthProvider.js')
      .then(({ FirebaseAdminAuthProvider }) => new FirebaseAdminAuthProvider());
    return this.loadedProvider;
  }
}
