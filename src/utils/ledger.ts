// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.
// File: src/utils/ledger.ts

import {
  EU_ORGANIZATION_IDENTITY_CHANNEL,
  GLOBAL_HUMAN_IDENTITY_CHANNEL,
} from '../blockchain/fabric/v3/ledger-channel-name';
import { getJurisdictionGroup } from './jurisdiction';

/** Canonical manager-owned contract for one-transaction clinical evidence batches. */
export const ClinicalEvidenceChaincode = 'artifact-sc';
/** Canonical manager-owned contract for independently governed consent rules. */
export const ConsentAccessChaincode = 'consentaccess-sc';
/** Canonical manager-owned contracts for the organization identity graph. */
export const EmployeeIdentityChaincode = 'employee-sc';
export const CryptographicKeyIdentityChaincode = 'cryptographickey-sc';
export const SubjectKeyBindingIdentityChaincode = 'subjectkeybinding-sc';
export const SubjectIdentifierIdentityChaincode = 'subjectidentifier-sc';

/**
 * Resolves the governed clinical channel from trusted job context.
 *
 * The authenticated job supplies sector and jurisdiction. Callers never select
 * a channel or smart-contract name through payload data or environment aliases.
 */
export function resolveClinicalDataChannel(sector?: string, jurisdiction?: string): string {
  const normalizedSector = String(sector || '').trim();
  const normalizedJurisdiction = String(jurisdiction || '').trim();
  if (!normalizedSector || !normalizedJurisdiction) {
    throw new Error('Trusted sector and jurisdiction context is required for clinical ledger routing.');
  }
  const networkMode = String(process.env.NETWORK_MODE || '').trim().toLowerCase();
  if (networkMode === 'local-network') return `${normalizedSector}-local`;
  return `${normalizedSector}-${getJurisdictionGroup(normalizedJurisdiction)}`;
}

/** Resolves the configured clinical/data ledger channel without inventing one from route labels. */
export function resolveDataChannel(): string {
  const channel = String(process.env.LEDGER_DATA_CHANNEL_DEFAULT || '').trim();
  if (!channel) throw new Error('LEDGER_DATA_CHANNEL_DEFAULT is required for ledger data writes.');
  return channel;
}

export function resolveIdentityChannel(jurisdiction?: string): string {
  const explicitDefault = String(process.env.LEDGER_IDENTITY_CHANNEL_DEFAULT || '').trim();
  if (explicitDefault) return explicitDefault;

  const networkMode = String(process.env.NETWORK_MODE || '').trim().toLowerCase();
  if (networkMode === 'local-network') return 'identity-local';

  // Jurisdiction intentionally does not scope human identity. A person may
  // hold credentials from several jurisdictions.
  void jurisdiction;
  return GLOBAL_HUMAN_IDENTITY_CHANNEL;
}

/**
 * Resolves the legal-entity identity plane.
 *
 * Organizations, their employees/controllers, locations, keys, identity
 * evidence and identity events share the organization's regional channel.
 * Natural-person identities remain on `identity-global`.
 */
export function resolveOrganizationIdentityChannel(jurisdiction?: string): string {
  const explicitDefault = String(
    process.env.LEDGER_ORGANIZATION_IDENTITY_CHANNEL_DEFAULT || '',
  ).trim();
  if (explicitDefault) return explicitDefault;

  const networkMode = String(process.env.NETWORK_MODE || '').trim().toLowerCase();
  if (networkMode === 'local-network') return 'identity-local';

  if (getJurisdictionGroup(String(jurisdiction || '').trim()) === 'eu') {
    return EU_ORGANIZATION_IDENTITY_CHANNEL;
  }

  throw new Error(
    'Organization identity channel is not configured for this jurisdiction. '
    + 'Set LEDGER_ORGANIZATION_IDENTITY_CHANNEL_DEFAULT.',
  );
}

/**
 * Resolves an organization-scoped employee record or a global person.
 *
 * `employee` includes the employment/controller relationship and its
 * operational keys. A natural-person or Root governance controller identity
 * remains a `person` in `identity-global` and is referenced from the regional
 * relationship instead of being duplicated there.
 */
export function resolveSubjectIdentityChannel(
  subjectType: 'employee' | 'person',
  jurisdiction?: string,
): string {
  return subjectType === 'employee'
    ? resolveOrganizationIdentityChannel(jurisdiction)
    : resolveIdentityChannel(jurisdiction);
}
