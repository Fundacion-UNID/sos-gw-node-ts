// Copyright 2026 Antifraud Services Inc. under the Apache License, Version 2.0.

export type FirebaseProjectEnvironment = {
  /** Primary Firebase Admin project: GW data plane and default Auth issuer. */
  FIREBASE_PROJECT_ID?: string;
  /** Extra Firebase project IDs whose signed user ID tokens this GW may verify. */
  FIREBASE_ADDITIONAL_AUTH_PROJECT_IDS?: string;
};

/** Returns the primary Firebase project and explicitly allowlisted Auth issuers. */
export function allowedFirebaseProjectIds(
  env: FirebaseProjectEnvironment = process.env as FirebaseProjectEnvironment,
): string[] {
  return Array.from(new Set([
    String(env.FIREBASE_PROJECT_ID || '').trim(),
    ...String(env.FIREBASE_ADDITIONAL_AUTH_PROJECT_IDS || '').split(',').map((value) => value.trim()),
  ].filter(isFirebaseProjectId)));
}

function isFirebaseProjectId(value: string): boolean {
  return /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(value);
}

/** Reads an unverified audience only so an allowlisted verifier can be selected. */
export function firebaseTokenAudience(token: string): string | undefined {
  try {
    const [, encodedPayload] = token.split('.');
    if (!encodedPayload) return undefined;
    const payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8')) as { aud?: unknown };
    return typeof payload.aud === 'string' && payload.aud.trim() ? payload.aud.trim() : undefined;
  } catch {
    return undefined;
  }
}
