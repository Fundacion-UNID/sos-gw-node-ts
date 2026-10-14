// src/models/schema-definitions.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

/**
 * Defines the canonical, officially-cased claim names for known schemas.
 * This acts as a dictionary for the normalization utility to ensure that
 * regardless of the input case, the stored claim keys are always correct.
 * 
 * The keys of this object are the lowercase context names (e.g., 'org.schema.person').
 * The values are arrays of the officially-cased claim names.
 */
export const schemaDefinitions: Record<string, string[]> = {
  'org.schema.person': [
    'additionalName',
    'alternateName',
    'birthDate',
    'familyName',
    'gender',
    'givenName',
    'identifier',
    'name',
    'telephone',
    'email',
    'worksFor',
    'additionalType',
  ],
  'org.schema.organization': [
    'duns',
    'email',
    'identifier',
    'legalName',
    'telephone',
    'url',
  ],
  'org.schema.occupation': [
    'occupationalCategory',
    'startDate',
    'endDate',
  ],
  // Other schemas like 'org.hl7.fhir.practitioner' would be defined here in lowercase
};

/**
 * A reverse map for quick, case-insensitive lookup of a claim's canonical casing.
 * Maps 'lowercaseclaim' -> 'canonicalCaseClaim'.
 * e.g., 'givenname' -> 'givenName'
 */
const claimCaseMap: Record<string, string> = {};
for (const schema in schemaDefinitions) {
  for (const claim of schemaDefinitions[schema]) {
    claimCaseMap[claim.toLowerCase()] = claim;
  }
}

/**
 * Finds the canonical (correctly-cased) name for a given claim within a specific schema.
 * The matching is case-insensitive.
 * @param schemaKey The lowercase schema key (e.g., 'org.schema.person').
 * @param claimKey The raw claim key from the input (e.g., 'GivenName').
 * @returns The canonical claim name (e.g., 'givenName') or undefined if not found.
 */
export function findCanonicalClaimCase(schemaKey: string, claimKey: string): string | undefined {
  const schema = schemaDefinitions[schemaKey];
  if (!schema) {
    return undefined;
  }
  const lowerClaimKey = claimKey.toLowerCase();
  const canonicalClaim = claimCaseMap[lowerClaimKey];
  
  // Ensure the found claim actually belongs to the specified schema
  if (canonicalClaim && schema.includes(canonicalClaim)) {
    return canonicalClaim;
  }
  
  return undefined;
}
