import {
  PublicHealthStatisticsContributionPaths,
  preparePublicHealthStatisticsContribution,
  type PublicHealthStatisticsContribution,
  type PublicHealthStatisticsContributionPath,
} from 'sos-data-utils-ts/public-health-statistics-policy';
import { getResearchTerminologyCodeClaim } from '../services/research-terminology-resolver';
import { getClaimValue } from './claims';
import { isFinalizedDigitalTwinResearchRecord } from './digital-twin-research-projection';
import { randomUUID } from 'node:crypto';

export type PublicHealthStatisticLedgerMapping = Readonly<{
  statisticId: string;
  contribution: PublicHealthStatisticsContribution;
}>;

/**
 * Applies shared public-statistics policy and assigns a fresh random ledger
 * id. Nothing in the id or projection is derived from a source record, hash,
 * subject or Digital Twin alias.
 */
export function buildPublicHealthStatisticLedgerMapping(input: Readonly<{
  path: PublicHealthStatisticsContributionPath;
  evidence: unknown;
  authority: Readonly<Record<string, unknown>>;
}>): PublicHealthStatisticLedgerMapping {
  const contribution = preparePublicHealthStatisticsContribution(input);
  return Object.freeze({
    statisticId: randomUUID(),
    contribution,
  });
}

function parseCanonicalCoding(value: unknown): { system: string; code: string } {
  const token = String(value || '').trim();
  const separator = token.indexOf('|');
  const system = token.slice(0, separator).trim();
  const code = token.slice(separator + 1).trim();
  if (separator < 1 || !system || !code || !URL.canParse(system)) {
    throw new TypeError('public_health_statistics_canonical_coding_required');
  }
  return { system, code };
}

function resolveSubjectKind(
  sector: string,
  trustedSubjectKind?: 'human' | 'animal',
): 'human' | 'animal' {
  const normalized = String(sector || '').trim().toLowerCase();
  if (normalized.startsWith('animal-')) return 'animal';
  if (normalized.startsWith('health-')) return 'human';
  if (normalized === 'onehealth-research' && trustedSubjectKind) return trustedSubjectKind;
  throw new TypeError('public_health_statistics_subject_kind_required');
}

function resolveOccurredOn(resourceType: string, claims: Record<string, unknown>): string {
  const preferredSuffixes = [
    'effective-datetime', 'effective', 'issued', 'recorded-date', 'recorded-on',
    'occurrence-datetime', 'onset-datetime', 'performed-datetime', 'date', 'datetime',
    'period-start',
  ];
  for (const suffix of preferredSuffixes) {
    const value = getClaimValue(claims, `${resourceType}.${suffix}`);
    const normalized = String(value || '').trim();
    if (/^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(normalized)) return normalized.slice(0, 10);
  }
  throw new TypeError('public_health_statistics_occurred_on_required');
}

/**
 * Converts already-authorized, private canonical claims into the minimal
 * public-statistics handoff. Subject kind and channel context are derived from
 * the trusted gateway profile; no subject or organization identifier crosses
 * this boundary.
 */
export function buildPublicHealthStatisticLedgerMappingFromClinicalClaims(input: Readonly<{
  path: PublicHealthStatisticsContributionPath;
  resourceType: string;
  sector: string;
  trustedSubjectKind?: 'human' | 'animal';
  jurisdiction: string;
  section: string;
  claims: Record<string, unknown>;
  authority: Readonly<Record<string, unknown>>;
}>): PublicHealthStatisticLedgerMapping {
  const resourceType = String(input.resourceType || '').trim();
  const codeClaim = getResearchTerminologyCodeClaim(resourceType);
  if (!codeClaim) throw new TypeError('public_health_statistics_supported_clinical_code_required');
  const coding = parseCanonicalCoding(getClaimValue(input.claims, codeClaim));
  if (!isFinalizedDigitalTwinResearchRecord(resourceType, input.claims)) {
    throw new TypeError('public_health_statistics_final_clinical_evidence_required');
  }
  return buildPublicHealthStatisticLedgerMapping({
    path: input.path,
    authority: input.authority,
    evidence: {
      subjectKind: resolveSubjectKind(input.sector, input.trustedSubjectKind),
      section: String(input.section || '').trim(),
      codingSystem: coding.system,
      code: coding.code,
      jurisdiction: String(input.jurisdiction || '').trim(),
      occurredOn: resolveOccurredOn(resourceType, input.claims),
    },
  });
}

/** Builds one coded individual report without accepting routing or identity fields from the client. */
export function buildPublicHealthStatisticLedgerMappingFromSelfReport(input: Readonly<{
  sector: string;
  trustedSubjectKind?: 'human' | 'animal';
  jurisdiction: string;
  evidence: Readonly<{
    section: string;
    codingSystem: string;
    code: string;
    occurredOn: string;
    speciesTaxonomyId?: string;
    ageBand?: string;
    sex?: string;
  }>;
  authority: Readonly<Record<string, unknown>>;
}>): PublicHealthStatisticLedgerMapping {
  return buildPublicHealthStatisticLedgerMapping({
    path: PublicHealthStatisticsContributionPaths.IndividualSelfReport,
    authority: input.authority,
    evidence: {
      ...input.evidence,
      subjectKind: resolveSubjectKind(input.sector, input.trustedSubjectKind),
      jurisdiction: String(input.jurisdiction || '').trim(),
    },
  });
}
