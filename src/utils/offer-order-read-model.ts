// Copyright 2026 Antifraud Services Inc. under the Apache License, Version 2.0.

import type { BundleEntry } from 'gdc-common-utils-ts/models/bundle';
import type { ConfidentialStorageDoc } from 'gdc-common-utils-ts/models/confidential-storage';
import { normalizeContextualizedClaims } from './claims';

/**
 * Normalizes one offer/order search entry into flat comparable claims.
 *
 * Shared SDK helpers and GW consume claims only from
 * `entry.resource.meta.claims`.
 */
export function extractOfferOrderSearchClaims(entry: BundleEntry): Record<string, unknown> {
  const rawClaims = entry?.resource?.meta?.claims;
  return rawClaims ? normalizeContextualizedClaims(rawClaims) : {};
}

/**
 * Applies the current exact-match offer/order search semantics used by hosted
 * and family offer/order read-models.
 *
 * Notes:
 * - keys starting with `@` are ignored because they describe vocab/context
 *   rather than business filters.
 * - empty expected values are ignored.
 * - pagination, date ranges, free-text ranking, and partial matching should be
 *   designed first in shared `common-utils`/BFF contracts before being baked
 *   into GW.
 */
export function matchOfferOrderSearchClaims(
  claims: Record<string, unknown>,
  filters: Record<string, unknown>,
): boolean {
  return Object.entries(filters).every(([key, value]) => {
    const expected = String(value ?? '').trim();
    if (!expected || key.startsWith('@')) return true;
    return String(claims[key] ?? '').trim() === expected;
  });
}

/**
 * Projects one stored offer/order artifact into the compact row shape consumed
 * by current portal-oriented read-model readers.
 */
export function buildOfferOrderSearchRow(
  doc: ConfidentialStorageDoc,
  claims: Record<string, unknown>,
  fallbackIdClaim: string,
  resource?: Record<string, unknown>,
): Record<string, unknown> {
  return {
    id: String(doc.id || claims[fallbackIdClaim] || '').trim() || undefined,
    meta: {
      status: doc.status,
      claims,
    },
    ...(resource ? { resource } : {}),
  };
}

export function readProjectedOfferOrderClaims(doc: ConfidentialStorageDoc): Record<string, unknown> {
  const rawClaims =
    (doc as any)?.meta?.claims
    || (doc as any)?.resource?.meta?.claims
    || (doc as any)?.content?.claims;
  return rawClaims ? normalizeContextualizedClaims(rawClaims) : {};
}

export function buildOfferOrderIndexedAttributes(
  claims: Record<string, unknown>,
): Array<{ name: string; value: string; unique?: boolean }> {
  const attributes: Array<{ name: string; value: string; unique?: boolean }> = [];
  const seen = new Set<string>();

  for (const [name, rawValue] of Object.entries(claims || {})) {
    if (!name || name.startsWith('@')) continue;
    if (rawValue === undefined || rawValue === null) continue;
    if (typeof rawValue === 'object') continue;

    const value = String(rawValue).trim();
    if (!value) continue;

    const dedupeKey = `${name}\u0000${value}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    attributes.push({ name, value });
  }

  return attributes;
}
