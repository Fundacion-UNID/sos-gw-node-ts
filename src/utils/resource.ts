// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.
// File: src/utils/resource.ts

import { v4 as uuidv4, validate as uuidValidate } from 'uuid';

/**
 * Determines a resource's ID based on an identifier claim and environment.
 * @param identifierClaim The full identifier string (e.g., 'urn:uuid:...')
 * @param environment The deployment environment (e.g., 'demo').
 * @returns The determined resource ID (either the extracted UUID, a new UUID, or the original identifier).
 */
export function determineResourceId(identifierClaim: string | undefined, environment?: string): string {
  // 1. If an identifier claim is provided, try to process it.
  if (identifierClaim) {
    const uuidPart = identifierClaim.split('urn:uuid:')[1]?.split(',')[0];

    // 2. If a valid UUID is found within the claim, always use it.
    if (uuidPart && uuidValidate(uuidPart)) {
      return uuidPart;
    }

    // 3a. If NOT a valid UUID, but we are in 'demo' mode, use the original claim value.
    if (environment === 'demo') {
      return identifierClaim;
    }
  }

  // 4. If no identifier was provided at all, OR if the provided one was
  // invalid in a non-demo environment, generate a new UUID.
  return uuidv4();
}
