import { CommunicationClaim } from 'gdc-common-utils-ts/models/interoperable-claims/communication-claims';
import { CompositionClaim } from 'gdc-common-utils-ts/models/interoperable-claims/composition-claims';
import type { JobRequest } from 'gdc-common-utils-ts/models/confidential-job';
import type { ClinicalCreatorBinding } from 'gdc-common-utils-ts/utils/fhir-ips-creator-identity';
import type { IVaultRepository } from '../../database/repositories/vault/vault.repository';
import { getClinicalCreatorBindingsSectionId } from '../../utils/clinical-creator-binding';

export type UhcRepresentedClinicalProvenance = Readonly<{
  authorIdentifier: string;
  assignmentIdentifier: string;
}>;

const MAX_VISITED_VALUES = 10_000;
const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;

/**
 * Reads the author/attester pair already carried by the attached flat claims.
 * It never accepts a separate browser hint: the same signed Communication
 * payload that will be persisted selects the represented assignment.
 */
export function readUhcRepresentedClinicalProvenance(
  job: JobRequest,
): UhcRepresentedClinicalProvenance | undefined {
  const pending: unknown[] = [job.content?.body];
  const visited = new Set<object>();
  let visitedCount = 0;

  while (pending.length > 0 && visitedCount < MAX_VISITED_VALUES) {
    const value = pending.shift();
    if (!value || typeof value !== 'object' || visited.has(value as object)) continue;
    visited.add(value as object);
    visitedCount += 1;

    if (Array.isArray(value)) {
      pending.push(...value);
      continue;
    }

    const record = value as Record<string, unknown>;
    const claims = isRecord(record.claims)
      ? record.claims
      : isRecord(record.meta) && isRecord(record.meta.claims)
        ? record.meta.claims
        : undefined;
    const provenance = claims ? readClaimsProvenance(claims) : undefined;
    if (provenance) return provenance;

    const attachmentData = claims?.[CommunicationClaim.ContentAttachmentData];
    const decoded = decodeJsonAttachment(attachmentData);
    if (decoded) pending.push(decoded);
    pending.push(...Object.values(record));
  }
  return undefined;
}

/**
 * Restricts clinical creator lookup to one GW-issued represented assignment.
 * The registered actor alias is added only to this in-memory view; it is never
 * copied into the stored target binding, where it could collide across cards.
 */
export async function buildUhcRepresentedClinicalRepository(input: Readonly<{
  repository: IVaultRepository;
  tenantVaultId: string;
  registeredActorDid: string;
  provenance: UhcRepresentedClinicalProvenance;
}>): Promise<IVaultRepository> {
  const sectionId = getClinicalCreatorBindingsSectionId();
  const records = await input.repository.listContainersInSection<any>(input.tenantVaultId, sectionId);
  const bindings = records.filter(isClinicalCreatorBinding);
  const sources = bindings.filter((binding) => binding.actorDids?.includes(input.registeredActorDid));
  if (sources.length !== 1) return input.repository;
  const target = bindings.find((binding) =>
    binding.authorIdentifier === input.provenance.assignmentIdentifier
    && (
      binding.ownerIdentifier === input.provenance.authorIdentifier
      || binding.authorIdentifier === input.provenance.authorIdentifier
    )
    && binding.actorIdentifier === sources[0].actorIdentifier);
  if (!target || target.authorIdentifier === sources[0].authorIdentifier) return input.repository;

  const projectedTarget = {
    ...target,
    actorDids: uniqueText([...(target.actorDids || []), input.registeredActorDid]),
  };
  return new Proxy(input.repository, {
    get(repository, property, receiver) {
      if (property === 'listContainersInSection' || property === 'getContainersInSection') {
        return async (collectionName: string, requestedSectionId: string, excluded?: string[]) =>
          collectionName === input.tenantVaultId && requestedSectionId === sectionId
            ? [projectedTarget]
            : repository[property](collectionName, requestedSectionId, excluded);
      }
      if (property === 'put') {
        return async (collectionName: string, containers: any[], requestedSectionId?: string) =>
          collectionName === input.tenantVaultId && requestedSectionId === sectionId
            ? true
            : repository.put(collectionName, containers, requestedSectionId);
      }
      const value = Reflect.get(repository, property, receiver);
      return typeof value === 'function' ? value.bind(repository) : value;
    },
  }) as IVaultRepository;
}

function readClaimsProvenance(
  claims: Readonly<Record<string, unknown>>,
): UhcRepresentedClinicalProvenance | undefined {
  const authorIdentifier = firstCsvValue(claims[CompositionClaim.Author]);
  const assignmentIdentifier = firstCsvValue(claims[CompositionClaim.Attester]);
  return authorIdentifier && assignmentIdentifier
    ? { authorIdentifier, assignmentIdentifier }
    : undefined;
}

function decodeJsonAttachment(value: unknown): unknown {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  try {
    const decoded = Buffer.from(value, 'base64');
    if (decoded.byteLength === 0 || decoded.byteLength > MAX_ATTACHMENT_BYTES) return undefined;
    return JSON.parse(decoded.toString('utf8'));
  } catch {
    return undefined;
  }
}

function firstCsvValue(value: unknown): string | undefined {
  return String(value || '').split(',').map((item) => item.trim()).find(Boolean);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function isClinicalCreatorBinding(value: unknown): value is ClinicalCreatorBinding {
  if (!isRecord(value)) return false;
  return typeof value.kind === 'string'
    && typeof value.actorIdentifier === 'string'
    && typeof value.authorIdentifier === 'string'
    && typeof value.ownerIdentifier === 'string'
    && typeof value.role === 'string';
}

function uniqueText(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => String(value || '').trim()).filter(Boolean))];
}
