import { ResourceTypesFhirR4 } from 'gdc-common-utils-ts/constants/fhir-resource-types';
import { createHash } from 'crypto';
import type { BundleEntry, BundleJsonApi } from 'gdc-common-utils-ts/models/bundle';
import { HealthcareAllRolesByClaim } from 'gdc-common-utils-ts/constants/healthcare';
import { ClaimConsent, ConsentDecisions, ConsentStatuses } from 'gdc-common-utils-ts/models/consent-rule';
import { getClaimValue } from './claims';
import { buildRawCidV1FromUtf8String, SHA3_384_MULTIHASH_PROFILE } from './multiformat-profile';

export type ConsentRuleBlockchainEntry = Readonly<{
  id: string;
  type: string;
  resource: Readonly<{
    resourceType: typeof ResourceTypesFhirR4.Consent;
    meta: Readonly<{
      claims: Record<string, unknown>;
    }>;
  }>;
}>;

export type ConsentRuleBlockchainPrimaryDocument = Readonly<{
  data: readonly ConsentRuleBlockchainEntry[];
}>;

export type ConsentRuleBlockchainStatus = 'active' | 'revoked';

const DEFAULT_RULE_ENTRY_TYPE = 'ConsentAccessRule';
const DEFAULT_FHIR_CLAIMS_CONTEXT = 'org.hl7.fhir.api';
const DEFAULT_CONSENT_RESOURCE_TYPE = 'Consent';
const HASH_PREFIX = 'sha3-384:';
const CONTENT_ADDRESSED_REFERENCE_PATTERN = /^z[1-9A-HJ-NP-Za-km-z]+$/;
const DOCUMENT_REFERENCE_IDENTIFIER_CLAIM = 'DocumentReference.identifier';
const CONSENT_EVENT_BASEDON_CLAIM = 'Consent.event-basedon';
const CONSENT_SOURCE_REFERENCE_CLAIM = 'Consent.source-reference';

/**
 * Builds the JSON:API-like primary document that GW CORE sends to `consentaccess-sc`.
 *
 * The result always preserves the `data[]` container and assigns one atomic
 * blockchain rule entry id to every output entry under `data[i].id`.
 *
 * Contract:
 * - the clear-text logical rule key never crosses the chaincode boundary
 * - `data[i].id` is the CIDv1 representation of the canonical logical rule key
 */
export function buildConsentRulePrimaryDocument(entries: readonly BundleEntry[]): ConsentRuleBlockchainPrimaryDocument {
  const data: ConsentRuleBlockchainEntry[] = [];
  const bundleEvidenceReferenceIndex = buildBundleEvidenceReferenceIndex(entries);

  for (const entry of entries) {
    data.push(...deriveRuleEntriesFromConsentEntry(entry, bundleEvidenceReferenceIndex));
  }

  return Object.freeze({
    data: Object.freeze(data),
  });
}

/**
 * Mirrors the shared common-utils lifecycle rule so GW CORE can derive the
 * blockchain status without waiting for a package release.
 */
export function deriveConsentRuleBlockchainStatus(
  claims: Record<string, unknown>,
  options: Readonly<{ now?: string | Date }> = {},
): ConsentRuleBlockchainStatus {
  const lifecycleStatus = String(getClaimValue(claims, ClaimConsent.status) || '').trim();
  if (lifecycleStatus && lifecycleStatus !== ConsentStatuses.Active) return 'revoked';
  const periodEnd = String(getClaimValue(claims, ClaimConsent.periodEnd) || '').trim();
  if (!periodEnd) return 'active';

  const periodEndMs = Date.parse(periodEnd);
  if (Number.isNaN(periodEndMs)) return 'active';

  const nowMs = options.now instanceof Date
    ? options.now.getTime()
    : options.now
      ? new Date(options.now).getTime()
      : Date.now();

  return periodEndMs <= nowMs ? 'revoked' : 'active';
}

function deriveRuleEntriesFromConsentEntry(
  entry: BundleEntry,
  bundleEvidenceReferenceIndex: Readonly<Record<string, string>>,
): ConsentRuleBlockchainEntry[] {
  const resourceType = String(entry.resource?.resourceType || '').trim();
  if (resourceType && resourceType !== DEFAULT_CONSENT_RESOURCE_TYPE) {
    return [];
  }

  const claims = (entry.resource?.meta?.claims || {}) as Record<string, unknown>;
  const actorIdentifiers = splitCsv(getClaimValue(claims, ClaimConsent.actorIdentifier));
  const purposes = splitCsv(getClaimValue(claims, ClaimConsent.purpose));
  if (actorIdentifiers.length === 0 || purposes.length === 0) {
    return [];
  }

  const roles = splitCsv(getClaimValue(claims, ClaimConsent.actorRole));
  const normalizedRoles = roles.length > 0 ? roles : [''];
  const subject = String(getClaimValue(claims, ClaimConsent.subject) || '').trim() || undefined;
  const decision = normalizeDecision(getClaimValue(claims, ClaimConsent.decision));
  const sourceConsentIdentifier = String(getClaimValue(claims, ClaimConsent.identifier) || '').trim() || undefined;
  const evidence = ((entry.resource?.meta || {}) as { evidence?: Record<string, unknown> | Record<string, unknown>[] }).evidence;
  const eventBasedOn = sanitizeConsentReferenceForBlockchain(
    getClaimValue(claims, CONSENT_EVENT_BASEDON_CLAIM) || sourceConsentIdentifier,
  );
  const sourceReference = resolveSourceReferenceFromEvidence(evidence)
    || resolveSourceReferenceFromBundleIndex(claims, bundleEvidenceReferenceIndex)
    || sanitizeConsentReferenceForBlockchain(getClaimValue(claims, CONSENT_SOURCE_REFERENCE_CLAIM));
  const sanitizedClaims = buildSanitizedRuleClaims(claims, eventBasedOn, sourceReference);

  const out: ConsentRuleBlockchainEntry[] = [];
  for (const actorIdentifier of actorIdentifiers) {
    for (const purpose of purposes) {
      for (const role of normalizedRoles) {
        const logicalRuleId = buildConsentAtomicRuleId({
          sourceConsentIdentifier,
          subject,
          decision,
          actorIdentifier,
          purpose,
          role: role || undefined,
        });
        out.push(Object.freeze({
          id: buildConsentAtomicRuleCidV1(logicalRuleId),
          type: DEFAULT_RULE_ENTRY_TYPE,
          resource: Object.freeze({
            resourceType: DEFAULT_CONSENT_RESOURCE_TYPE,
            meta: Object.freeze({
              claims: sanitizedClaims,
            }),
          }),
        }));
      }
    }
  }

  return out;
}

function buildSanitizedRuleClaims(
  claims: Record<string, unknown>,
  eventBasedOn: string | undefined,
  sourceReference: string | undefined,
): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {
    '@context': getClaimValue(claims, '@context') || claims['@context'] || DEFAULT_FHIR_CLAIMS_CONTEXT,
  };

  const actions = splitCsv(getClaimValue(claims, ClaimConsent.action));
  if (actions.length > 0) {
    sanitized[ClaimConsent.action] = actions.join(',');
  }

  const roles = splitCsv(getClaimValue(claims, ClaimConsent.actorRole));
  if (roles.length > 0) {
    sanitized[ClaimConsent.actorRole] = roles.join(',');
  }

  if (eventBasedOn) {
    sanitized[CONSENT_EVENT_BASEDON_CLAIM] = eventBasedOn;
  }

  if (sourceReference) {
    sanitized[CONSENT_SOURCE_REFERENCE_CLAIM] = sourceReference;
  }

  return sanitized;
}

function buildBundleEvidenceReferenceIndex(entries: readonly BundleEntry[]): Readonly<Record<string, string>> {
  const index = new Map<string, string>();

  for (const entry of entries) {
    const meta = (entry.resource?.meta || {}) as { claims?: Record<string, unknown>; evidence?: Record<string, unknown> | Record<string, unknown>[] };
    const evidenceReference = resolveSourceReferenceFromEvidence(meta.evidence);
    if (!evidenceReference) continue;

    const claims = meta.claims || {};
    const keys = [
      String(entry.fullUrl || '').trim(),
      String(entry.id || '').trim(),
      String(getClaimValue(claims, DOCUMENT_REFERENCE_IDENTIFIER_CLAIM) || '').trim(),
    ].filter(Boolean);

    for (const key of keys) index.set(key, evidenceReference);
  }

  return Object.freeze(Object.fromEntries(index.entries()));
}

function resolveSourceReferenceFromBundleIndex(
  claims: Record<string, unknown>,
  bundleEvidenceReferenceIndex: Readonly<Record<string, string>>,
): string | undefined {
  const candidates = [
    ...splitCsv(getClaimValue(claims, CONSENT_SOURCE_REFERENCE_CLAIM)),
    ...splitCsv(getClaimValue(claims, ClaimConsent.containedDocuments)),
    ...splitCsv(getClaimValue(claims, ClaimConsent.attachmentContentIds)),
  ];

  for (const candidate of candidates) {
    const resolved = bundleEvidenceReferenceIndex[candidate];
    if (resolved) return resolved;
  }
  return undefined;
}

function resolveSourceReferenceFromEvidence(
  evidence: Record<string, unknown> | Record<string, unknown>[] | undefined,
): string | undefined {
  const evidenceItems = Array.isArray(evidence) ? evidence : evidence ? [evidence] : [];
  for (const evidenceItem of evidenceItems) {
    const evidenceId = sanitizeConsentReferenceForBlockchain(evidenceItem?.id);
    if (evidenceId) return evidenceId;
  }
  return undefined;
}

function sanitizeConsentReferenceForBlockchain(value: unknown): string | undefined {
  const normalized = String(value || '').trim();
  if (!normalized) return undefined;
  if (CONTENT_ADDRESSED_REFERENCE_PATTERN.test(normalized)) return normalized;
  return `${HASH_PREFIX}${createHash('sha3-384').update(normalized, 'utf8').digest('hex')}`;
}

function buildConsentAtomicRuleId(input: Readonly<{
  sourceConsentIdentifier?: string;
  subject?: string;
  decision?: string;
  actorIdentifier: string;
  purpose: string;
  role?: string;
}>): string {
  return [
    normalizeRuleKeyPart(input.sourceConsentIdentifier),
    normalizeRuleKeyPart(input.subject),
    normalizeDecision(input.decision).toLowerCase(),
    normalizeRuleKeyPart(input.actorIdentifier),
    normalizeRuleKeyPart(input.purpose),
    normalizeConsentRoleForRuleKey(input.role),
  ].join('||');
}

function buildConsentAtomicRuleCidV1(ruleId: string): string {
  return buildRawCidV1FromUtf8String(ruleId, SHA3_384_MULTIHASH_PROFILE);
}

function normalizeDecision(value: unknown): string {
  return String(value || '').trim() === ConsentDecisions.Deny
    ? ConsentDecisions.Deny
    : ConsentDecisions.Permit;
}

function normalizeRuleKeyPart(value: unknown): string {
  return String(value || '').trim().toLowerCase();
}

function normalizeConsentRoleForRuleKey(value: unknown): string {
  const claim = String(value || '').trim();
  if (!claim) return '';

  const knownRole = HealthcareAllRolesByClaim[claim];
  if (knownRole?.i18nKey) {
    return knownRole.i18nKey.toLowerCase();
  }

  const rawSeparatorIndex = claim.indexOf('|');
  if (rawSeparatorIndex <= 0) {
    return claim.toLowerCase();
  }

  const system = claim.slice(0, rawSeparatorIndex).trim().toLowerCase();
  const code = claim.slice(rawSeparatorIndex + 1).trim().toLowerCase();
  if (!code) return claim.toLowerCase();

  if (system === 'isco-08') {
    return `org.ilo.isco-08.${code}`;
  }
  if (system === 'v3-rolecode') {
    return `org.hl7.terminology.codesystem.v3-rolecode.${code}`;
  }
  if (system === 'v3-personalrelationshiproletype') {
    return `org.hl7.v3.personalrelationship.${code}`;
  }

  return claim.toLowerCase();
}


function splitCsv(value: unknown): string[] {
  return Array.from(new Set(
    String(value || '')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean),
  ));
}

export type _BundleJsonApiRulesDocument = BundleJsonApi<ConsentRuleBlockchainEntry>;
