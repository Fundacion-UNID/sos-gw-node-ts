import { IssueType } from 'gdc-common-utils-ts/models/issue';
import { ManagerError } from 'gdc-common-utils-ts/utils/manager-error';
import { normalizeFhirApiClaimKey } from 'gdc-common-utils-ts/utils/fhir-api-claim-helpers';
import { normalizeContextualizedClaims } from './claims';

export type FlatClaimValues = readonly string[];
export type FlatClaims = Readonly<Record<string, FlatClaimValues>>;

/**
 * Validates the claims-first FHIR transport contract without materializing a
 * native FHIR resource. Every governed claim is an array so repeated values
 * retain their wire meaning and indexing stays deterministic.
 */
export function normalizeGovernedFlatClaims(
  raw: unknown,
  allowedNames: ReadonlySet<string>,
  label: string,
): FlatClaims {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new ManagerError(`${label} requires resource.meta.claims.`, IssueType.Required);
  }
  const rawRecord = raw as Record<string, unknown>;
  const context = typeof rawRecord['@context'] === 'string' ? rawRecord['@context'].trim() : '';
  const normalizedInput = normalizeContextualizedClaims(rawRecord);
  const claims: Record<string, readonly string[]> = {};
  for (const [rawName, rawValues] of Object.entries(normalizedInput)) {
    if (rawName === '@context') continue;
    const contextualName = context && rawName.startsWith(`${context}.`)
      ? rawName.slice(context.length + 1)
      : rawName;
    let name: string;
    try {
      name = normalizeFhirApiClaimKey(contextualName);
    } catch (error) {
      const message = error instanceof Error ? error.message : `Invalid FHIR API claim key: ${contextualName}`;
      throw new ManagerError(message, IssueType.Invalid);
    }
    if (!allowedNames.has(name)) {
      throw new ManagerError(`Unsupported ${label} claim '${rawName}'.`, IssueType.Invalid);
    }
    const candidates = typeof rawValues === 'string' ? [rawValues] : rawValues;
    if (!Array.isArray(candidates)) {
      throw new ManagerError(`${label} claim '${name}' must be a string or string array.`, IssueType.Invalid);
    }
    const values = candidates.map((value) => {
      if (typeof value !== 'string' || !value.trim()) {
        throw new ManagerError(`${label} claim '${name}' contains an invalid value.`, IssueType.Invalid);
      }
      return value.trim();
    });
    if (values.length === 0) {
      throw new ManagerError(`${label} claim '${name}' cannot be empty.`, IssueType.Invalid);
    }
    claims[name] = [...new Set(values)];
  }
  return Object.freeze(claims);
}

/** Rejects any native FHIR fields at this claims-first boundary. */
export function requireClaimsOnlyResourceShape(
  resource: unknown,
  expectedResourceType: string,
  label: string,
): asserts resource is { resourceType: string; id: string; meta: { claims: Record<string, unknown> } } {
  if (!resource || typeof resource !== 'object' || Array.isArray(resource)) {
    throw new ManagerError(`${label} entry requires a claims-first resource.`, IssueType.Required);
  }
  const value = resource as Record<string, unknown>;
  if (value.resourceType !== expectedResourceType) {
    throw new ManagerError(`${label} resourceType is invalid.`, IssueType.Invalid);
  }
  const unexpected = Object.keys(value).find((name) => !['resourceType', 'id', 'meta'].includes(name));
  if (unexpected) {
    throw new ManagerError(`${label} cannot carry native FHIR field '${unexpected}'.`, IssueType.Invalid);
  }
  const meta = value.meta;
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) {
    throw new ManagerError(`${label} requires resource.meta.claims.`, IssueType.Required);
  }
  const unexpectedMeta = Object.keys(meta).find((name) => name !== 'claims');
  if (unexpectedMeta) {
    throw new ManagerError(`${label} meta cannot carry '${unexpectedMeta}'.`, IssueType.Invalid);
  }
}

export function buildClaimsOnlyResource(resourceType: string, id: string, claims: FlatClaims) {
  return { resourceType, id, meta: { claims } };
}

export function claimsOnlyContent(claims: FlatClaims): { claims: FlatClaims } {
  return { claims };
}

export function readClaimsOnlyContent(content: unknown): FlatClaims | undefined {
  if (!content || typeof content !== 'object' || Array.isArray(content)) return undefined;
  const value = content as Record<string, unknown>;
  if (Object.keys(value).length !== 1 || !value.claims || typeof value.claims !== 'object' || Array.isArray(value.claims)) {
    return undefined;
  }
  const entries = Object.entries(value.claims as Record<string, unknown>);
  if (entries.some(([, values]) => !Array.isArray(values) || values.some((item) => typeof item !== 'string'))) {
    return undefined;
  }
  return value.claims as FlatClaims;
}

export function flatClaimsToIndexedAttributes(
  claims: FlatClaims,
  indexedNames: ReadonlySet<string>,
  uniqueName?: string,
) {
  return Object.entries(claims).flatMap(([name, values]) => indexedNames.has(name)
    ? values.map((value) => ({ name, value, unique: name === uniqueName }))
    : []);
}

/** Compares normalized flat claims as unordered claim and repeated-value sets. */
export function flatClaimsEqual(left: FlatClaims, right: FlatClaims): boolean {
  const names = [...new Set([...Object.keys(left), ...Object.keys(right)])].sort();
  return names.every((name) => {
    const leftValues = [...(left[name] || [])].sort();
    const rightValues = [...(right[name] || [])].sort();
    return leftValues.length === rightValues.length
      && leftValues.every((value, index) => value === rightValues[index]);
  });
}
