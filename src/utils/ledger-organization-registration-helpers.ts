import { createHash } from 'crypto';
import { ClaimsOrganizationSchemaorg } from 'gdc-common-utils-ts/constants/schemaorg';
import { PublicJwk } from 'gdc-common-utils-ts/interfaces/Cryptography.types';
import { ClaimsRecord } from 'gdc-common-utils-ts/models/resource-document';
import { toJwkThumbprintSha256Urn } from 'gdc-common-utils-ts/utils/jwk-thumbprint';
import {
  buildOrganizationAuthorizationUrn,
  normalizeOrganizationAuthorizationUrn,
} from 'gdc-common-utils-ts/utils/organization-authorization-urn';

export function tryGetJwkThumbprint(jwk?: PublicJwk): string | undefined {
  if (!jwk) return undefined;
  try {
    return toJwkThumbprintSha256Urn(jwk);
  } catch {
    return undefined;
  }
}

export function inferLedgerJwkUse(jwk: PublicJwk): 'sig' | 'enc' {
  const explicitUse = String((jwk as any)?.use || '').trim().toLowerCase();
  if (explicitUse === 'enc') return 'enc';
  const alg = String((jwk as any)?.alg || '').trim().toUpperCase();
  if (alg.startsWith('ECDH') || alg.startsWith('ML-KEM')) return 'enc';
  return 'sig';
}

export function hashLedgerString(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

export function buildLedgerOrganizationId(identifierType: string, identifierValue: string): string {
  return buildOrganizationAuthorizationUrn({
    identifierType,
    identifierValue,
  });
}

/**
 * Resolves the organization ledger identifier from the canonical legal-id
 * claims used across GW onboarding.
 *
 * Format:
 * - `urn:org:<identifier.additionalType-lowercase>:<identifier.value>`
 *
 * Examples for the current EU-focused code/tests:
 * - `urn:org:tax:VATES-<local-id>`
 * - `urn:org:tax:<local-tax-id>`
 *
 * Jurisdiction remains a separate concern carried by claims/VC fields such as
 * `Organization.address.addressCountry` and, when a jurisdiction needs it,
 * `Organization.address.addressRegion`.
 */
export function resolveLedgerOrganizationId(claims?: ClaimsRecord, fallbackOrgId?: string): string {
  const identifierType = String(claims?.[ClaimsOrganizationSchemaorg.identifierType] || '').trim();
  const identifierValue = String(claims?.[ClaimsOrganizationSchemaorg.identifierValue] || '').trim();
  if (identifierType && identifierValue) {
    return buildLedgerOrganizationId(identifierType, identifierValue);
  }
  if (fallbackOrgId) return normalizeOrganizationAuthorizationUrn(fallbackOrgId);
  throw new Error('Organization ledger identifier requires identifier.additionalType and identifier.value');
}
