import { createHash } from 'node:crypto';
import type { LedgerSafeMetaTag } from '../services/ai/metaTagSanitizer';
import { getResearchTerminologyCodeClaim } from '../services/research-terminology-resolver';
import { getClaimValue } from './claims';
import { getJurisdictionGroup } from './jurisdiction';

export const RESEARCH_ASSET_RESOURCE_TYPE = 'ResearchAsset' as const;
export const VERSION_ASSET_RESOURCE_TYPE = 'VersionAsset' as const;

export type ResearchAssetVersionMapping = Readonly<{
  resourceType: string;
  researchAssetId: string;
  versionAssetId: string;
  /** Private correlation input; adapters must never serialize it to Fabric. */
  sourceVersionId: string;
  parent: string;
  research: true;
  tags: LedgerSafeMetaTag[];
}>;

function stableOpaqueUuid(seed: string): string {
  const bytes = createHash('sha256').update(seed, 'utf8').digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function parseCanonicalToken(value: unknown): { system: string; code: string } | undefined {
  const token = String(value || '').trim();
  const separator = token.indexOf('|');
  if (separator < 1) return undefined;
  const system = token.slice(0, separator).trim();
  const code = token.slice(separator + 1).trim();
  if (!system || !code || !URL.canParse(system)) return undefined;
  return { system, code };
}

/** Builds a private-to-ledger handoff without publishing source identifiers. */
export function buildResearchAssetVersionMapping(input: Readonly<{
  resourceType: string;
  sourceResourceId: string;
  sourceVersionId: string;
  twinSubjectId: string;
  claims: Record<string, unknown>;
}>): ResearchAssetVersionMapping {
  const resourceType = String(input.resourceType || '').trim();
  const sourceResourceId = String(input.sourceResourceId || '').trim();
  const sourceVersionId = String(input.sourceVersionId || '').trim();
  const twinSubjectId = String(input.twinSubjectId || '').trim();
  const codeClaim = getResearchTerminologyCodeClaim(resourceType);
  const token = codeClaim ? parseCanonicalToken(getClaimValue(input.claims, codeClaim)) : undefined;
  if (!token || !codeClaim) {
    throw new Error(`${resourceType} requires one canonical system|code before research registration.`);
  }
  if (!sourceResourceId || !sourceVersionId || !twinSubjectId) {
    throw new Error('Research registration requires private resource, version and twin identifiers.');
  }
  const researchAssetId = stableOpaqueUuid(`${twinSubjectId}|${resourceType}|${sourceResourceId}`);
  const versionAssetId = stableOpaqueUuid(`${researchAssetId}|${sourceVersionId}`);
  return {
    resourceType,
    researchAssetId,
    versionAssetId,
    sourceVersionId,
    parent: researchAssetId,
    research: true,
    tags: [{ id: codeClaim, system: token.system, code: token.code }],
  };
}

/** Manager-owned routing for the SOS human and animal research planes. */
export function resolveResearchDataChannel(sector?: string, jurisdiction?: string): string {
  const normalizedSector = String(sector || '').trim().toLowerCase();
  const normalizedJurisdiction = String(jurisdiction || '').trim();
  if (!normalizedSector || !normalizedJurisdiction) {
    throw new Error('Trusted sector and jurisdiction context is required for research ledger routing.');
  }
  const networkMode = String(process.env.NETWORK_MODE || '').trim().toLowerCase();
  if (networkMode === 'local-network') return `${normalizedSector}-local-research`;
  const country = normalizedJurisdiction.split('-')[0].toUpperCase();
  const jurisdictionGroup = ['CA', 'US', 'MX'].includes(country)
    ? 'na'
    : getJurisdictionGroup(country);
  return `${normalizedSector}-${jurisdictionGroup}-research`;
}
