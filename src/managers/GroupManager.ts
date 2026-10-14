// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

import { createHash, randomUUID } from 'node:crypto';
import { HttpStatusCodes } from 'gdc-common-utils-ts/constants/http';
import type { JobRequest } from 'gdc-common-utils-ts/models/confidential-job';
import type { IDecodedDidcommPayload } from 'gdc-common-utils-ts/models/confidential-message';
import type { ConfidentialStorageDoc } from 'gdc-common-utils-ts/models/confidential-storage';
import { IssueLevel, IssueType } from 'gdc-common-utils-ts/models/issue';
import { ManagerError } from 'gdc-common-utils-ts/utils/manager-error';
import { GroupFlatClaimCatalog, normalizeGroupR5FlatClaimsResource } from 'vet-data-utils-ts';
import type { IVaultRepository } from '../database/repositories/vault/vault.repository';
import type { IKmsService } from '../gdc-backend-utils-node/models/IKmsService';
import { EntityLifecycleStatus } from '../gdc-backend-utils-node/models/enums';
import {
  buildClaimsOnlyResource,
  claimsOnlyContent,
  flatClaimsToIndexedAttributes,
  flatClaimsEqual,
  normalizeGovernedFlatClaims,
  readClaimsOnlyContent,
  requireClaimsOnlyResourceShape,
  type FlatClaims,
} from '../utils/fhir-flat-claims';
import { createOperationOutcome } from '../utils/outcome';
import { getTenantVaultId } from '../utils/tenant';
import type { IJobProcessor } from './registry';

const GROUP_RESOURCE_TYPE = 'Group';
const GROUP_ENTRY_TYPE = 'Group-v5.0.0';
const GROUP_SEARCH_ENTRY_TYPE = 'Group-search-response-v5.0.0';
const GROUP_SECTION = 'research-groups';
const GROUP_MEMBER_SECTION_PREFIX = 'research-group-members';
const GROUP_ROUTE_SECTION = 'organization';
const FHIR_R5_FORMAT = 'org.hl7.fhir.r5';
const GROUP_R5_SEARCH_CLAIMS = new Set<string>(GroupFlatClaimCatalog.standardSearch);

type GroupEntry = {
  type?: string;
  request?: { method?: string; url?: string };
  resource?: { resourceType?: string; id?: string; meta?: { claims?: Record<string, unknown> }; [key: string]: unknown };
};

interface GroupTenantRegistry {
  tenantExists(vaultId: string): Promise<boolean>;
  getCollectionName(vaultId: string): Promise<string | undefined>;
  getTenantJurisdiction(vaultId: string): Promise<string | undefined>;
  getDidDocument(vaultId: string): Promise<{ controller?: unknown } | undefined>;
}

export interface GroupManagerDeps {
  vaultRepository: IVaultRepository;
  kmsService: IKmsService;
  tenantManager: GroupTenantRegistry;
}

/**
 * Maintains claims-first FHIR R5 Group descriptions for professional research
 * teams and frozen person/animal campaign cohorts.
 *
 * Only `resource.meta.claims` crosses or is retained by this boundary. Native
 * FHIR JSON is rejected and historical nested records require an explicit,
 * recoverable migration; a future versioned export may materialize FHIR from
 * these canonical claims. Group
 * membership remains descriptive and every write requires the tenant DID
 * controller. Each member is stored as a separate deterministic projection:
 * research-team members are PractitionerRole references and person/animal
 * cohort members are Patient references. Membership is never authorization.
 * DELETE with member claims removes only that deterministic projection.
 *
 * @see https://hl7.org/fhir/R5/group.html
 * @see https://hl7.org/fhir/R5/group-search.html
 */
export class GroupManager implements IJobProcessor {
  constructor(private readonly deps: GroupManagerDeps) {}

  async process(job: JobRequest): Promise<IDecodedDidcommPayload> {
    this.validateRoute(job);
    const { vaultId, collectionName } = await this.resolveTenantStorage(job);
    if (job.action === '_search') return this.search(job, vaultId, collectionName);
    if (job.action !== '_batch') {
      throw new ManagerError(`Unsupported Group action '${String(job.action || '')}'.`, IssueType.NotSupported);
    }
    await this.requireController(job, vaultId);
    const entries = readEntries(job);
    if (entries.length === 0) throw new ManagerError('Group _batch requires at least one entry.', IssueType.Required);
    const data: Record<string, unknown>[] = [];
    for (const entry of entries) {
      try { data.push(await this.writeEntry(entry, vaultId, collectionName)); }
      catch (error) { data.push(errorEntry(entry, error)); }
    }
    return response(job, 'batch-response', data);
  }

  private validateRoute(job: JobRequest): void {
    if (!job.content?.thid) throw new ManagerError('Missing thid.', IssueType.Required);
    if (!job.tenantId || !job.sector || !job.jurisdiction) {
      throw new ManagerError('Group requires tenantId, sector and jurisdiction.', IssueType.Required);
    }
    if (String(job.section || '').trim().toLowerCase() !== GROUP_ROUTE_SECTION) {
      throw new ManagerError(`Group requires the '${GROUP_ROUTE_SECTION}' section.`, IssueType.NotSupported);
    }
    if (String(job.format || '').trim().toLowerCase() !== FHIR_R5_FORMAT) {
      throw new ManagerError(`Group requires '${FHIR_R5_FORMAT}'.`, IssueType.NotSupported);
    }
  }

  private async resolveTenantStorage(job: JobRequest) {
    const vaultId = getTenantVaultId(String(job.sector), String(job.tenantId));
    if (!(await this.deps.tenantManager.tenantExists(vaultId))) {
      throw new ManagerError('Group tenant was not found for the requested sector.', IssueType.NotFound);
    }
    const expected = String(await this.deps.tenantManager.getTenantJurisdiction(vaultId) || '').trim();
    if (!expected || expected.toUpperCase() !== String(job.jurisdiction).trim().toUpperCase()) {
      throw new ManagerError('Group route jurisdiction does not match the tenant jurisdiction.', IssueType.Forbidden);
    }
    const collectionName = String(await this.deps.tenantManager.getCollectionName(vaultId) || '').trim();
    if (!collectionName) throw new ManagerError('Group tenant storage is unavailable.', IssueType.NotFound);
    return { vaultId, collectionName };
  }

  private async requireController(job: JobRequest, vaultId: string): Promise<void> {
    const issuer = String(job.content?.iss || '').trim();
    const did = await this.deps.tenantManager.getDidDocument(vaultId);
    if (!issuer || !normalizeControllerIds(did?.controller).includes(issuer)) {
      throw new ManagerError('Group writes require a current tenant controller.', IssueType.Forbidden);
    }
  }

  private async writeEntry(entry: GroupEntry, vaultId: string, collectionName: string) {
    const method = String(entry.request?.method || '').trim().toUpperCase();
    if (method === 'DELETE') return this.delete(entry, vaultId, collectionName);
    if (method === 'PATCH') return this.patchMember(entry, vaultId, collectionName);
    if (method !== 'POST' && method !== 'PUT') {
      throw new ManagerError(`Unsupported Group method '${method || '<missing>'}'.`, IssueType.NotSupported);
    }
    const normalized = normalizeGroupClaimsEntry(entry);
    if (method === 'POST') {
      const existing = await this.deps.vaultRepository.get<ConfidentialStorageDoc>(collectionName, normalized.id, GROUP_SECTION);
      if (existing) {
        const content = await this.deps.kmsService.unprotectConfidentialData<unknown>(existing, vaultId);
        const existingClaims = readClaimsOnlyContent(content);
        if (!existingClaims) {
          throw new ManagerError('Historical native Group requires an explicit recoverable migration.', IssueType.Invalid);
        }
        if (flatClaimsEqual(existingClaims, normalized.claims)) {
          return successEntry(normalized.id, normalized.claims, HttpStatusCodes.Ok);
        }
        throw new ManagerError(`Group already exists with different claims: ${normalized.id}.`, IssueType.Conflict);
      }
      await this.persist(normalized.id, normalized.claims, vaultId, collectionName, 0);
      return successEntry(normalized.id, normalized.claims, HttpStatusCodes.Created);
    }
    requireMatchingRequestId(entry, normalized.id);
    const current = await this.deps.vaultRepository.get<ConfidentialStorageDoc>(collectionName, normalized.id, GROUP_SECTION);
    if (!current) throw new ManagerError(`Group not found: ${normalized.id}.`, IssueType.NotFound);
    await this.persist(normalized.id, normalized.claims, vaultId, collectionName, Number(current.sequence || 0) + 1);
    return successEntry(normalized.id, normalized.claims, HttpStatusCodes.Ok);
  }

  private async patchMember(entry: GroupEntry, vaultId: string, collectionName: string) {
    const normalized = normalizeGroupMemberEntry(entry);
    requireMatchingRequestId(entry, normalized.id);
    const base = await this.deps.vaultRepository.get<ConfidentialStorageDoc>(collectionName, normalized.id, GROUP_SECTION);
    if (!base) throw new ManagerError(`Group not found: ${normalized.id}.`, IssueType.NotFound);
    const baseContent = await this.deps.kmsService.unprotectConfidentialData<unknown>(base, vaultId);
    const baseClaims = readClaimsOnlyContent(baseContent);
    if (!baseClaims) {
      throw new ManagerError('Historical native Group requires an explicit recoverable migration.', IssueType.Invalid);
    }
    requireMatchingMemberType(baseClaims, normalized.claims);
    const memberReference = normalized.claims['Group.member'][0];
    const section = buildGroupMemberSectionId(normalized.id);
    const projectionId = buildGroupMemberProjectionId(normalized.id, memberReference);
    const current = await this.deps.vaultRepository.get<ConfidentialStorageDoc>(collectionName, projectionId, section);
    await this.persist(projectionId, normalized.claims, vaultId, collectionName, Number(current?.sequence ?? -1) + 1, section);
    return successEntry(normalized.id, normalized.claims, HttpStatusCodes.Ok);
  }

  private async delete(entry: GroupEntry, vaultId: string, collectionName: string) {
    if (entry.resource?.meta?.claims) {
      const normalized = normalizeGroupMemberEntry(entry);
      requireMatchingRequestId(entry, normalized.id);
      const base = await this.deps.vaultRepository.get<ConfidentialStorageDoc>(collectionName, normalized.id, GROUP_SECTION);
      if (!base) throw new ManagerError(`Group not found: ${normalized.id}.`, IssueType.NotFound);
      const baseClaims = readClaimsOnlyContent(await this.deps.kmsService.unprotectConfidentialData<unknown>(base, vaultId));
      if (!baseClaims) {
        throw new ManagerError('Historical native Group requires an explicit recoverable migration.', IssueType.Invalid);
      }
      requireMatchingMemberType(baseClaims, normalized.claims);
      const memberReference = normalized.claims['Group.member'][0];
      const section = buildGroupMemberSectionId(normalized.id);
      const projectionId = buildGroupMemberProjectionId(normalized.id, memberReference);
      if (!(await this.deps.vaultRepository.get(collectionName, projectionId, section))) {
        throw new ManagerError(`Group member not found: ${memberReference}.`, IssueType.NotFound);
      }
      if (!(await this.deps.vaultRepository.delete(collectionName, projectionId, section))) {
        throw new ManagerError(`Group member could not be deleted: ${memberReference}.`, IssueType.NoStore);
      }
      return { type: GROUP_ENTRY_TYPE, response: { status: String(HttpStatusCodes.NoContent) } };
    }
    const id = boundedGroupId(entry.resource?.id);
    requireMatchingRequestId(entry, id);
    if (!(await this.deps.vaultRepository.get(collectionName, id, GROUP_SECTION))) {
      throw new ManagerError(`Group not found: ${id}.`, IssueType.NotFound);
    }
    if (!(await this.deps.vaultRepository.delete(collectionName, id, GROUP_SECTION))) {
      throw new ManagerError(`Group could not be deleted: ${id}.`, IssueType.NoStore);
    }
    const memberSection = buildGroupMemberSectionId(id);
    const memberRecords = await this.deps.vaultRepository.listContainersInSection<ConfidentialStorageDoc>(collectionName, memberSection);
    for (const member of memberRecords) await this.deps.vaultRepository.delete(collectionName, member.id, memberSection);
    return { type: GROUP_ENTRY_TYPE, response: { status: String(HttpStatusCodes.NoContent) } };
  }

  private async persist(
    id: string,
    claims: FlatClaims,
    vaultId: string,
    collectionName: string,
    sequence: number,
    section = GROUP_SECTION,
  ) {
    const protectedAttributes = await this.deps.kmsService.protectAttributesNameAndValue(
      flatClaimsToIndexedAttributes(claims, GROUP_R5_SEARCH_CLAIMS, 'Group.identifier') as any,
      vaultId,
    );
    const document: ConfidentialStorageDoc = {
      id, status: EntityLifecycleStatus.Active, sequence,
      content: claimsOnlyContent(claims),
      indexed: { attributes: protectedAttributes },
      audit: { updated: new Date().toISOString() } as any,
    };
    const encrypted = await this.deps.kmsService.protectConfidentialData(document, vaultId);
    if (!(await this.deps.vaultRepository.put(collectionName, [encrypted], section))) {
      throw new ManagerError('Group could not be persisted.', IssueType.NoStore);
    }
  }

  private async search(job: JobRequest, vaultId: string, collectionName: string) {
    const filters = readSearchFilters(job);
    const protectedValues = await this.deps.kmsService.protectAttributesNameAndValue(
      [...filters].flatMap(([name, values]) => values.map((value) => ({ name, value }))) as any,
      vaultId,
    );
    const protectedFilters = groupProtectedFilters(filters, protectedValues);
    const memberFilters = protectedFilters.get('Group.member');
    const baseFilters = new Map(protectedFilters);
    baseFilters.delete('Group.member');
    const records = await this.deps.vaultRepository.listContainersInSection<ConfidentialStorageDoc>(collectionName, GROUP_SECTION);
    const data: Record<string, unknown>[] = [];
    for (const record of records) {
      if (!matchesProtectedAttributes(record, baseFilters)) continue;
      const content = await this.deps.kmsService.unprotectConfidentialData<unknown>(record, vaultId);
      const claims = readClaimsOnlyContent(content);
      if (!claims) {
        throw new ManagerError('Historical native Group requires an explicit recoverable migration.', IssueType.Invalid);
      }
      const memberRecords = await this.deps.vaultRepository.listContainersInSection<ConfidentialStorageDoc>(
        collectionName,
        buildGroupMemberSectionId(record.id),
      );
      if (memberFilters
        && !memberRecords.some((member) => matchesProtectedAttributes(member, new Map([['Group.member', memberFilters]])))) {
        continue;
      }
      const memberClaims = await this.loadMemberClaims(record.id, vaultId, collectionName, memberRecords);
      const combinedClaims: FlatClaims = memberClaims.length > 0
        ? { ...claims, 'Group.member': memberClaims.flatMap((candidate) => candidate['Group.member'] || []) }
        : claims;
      data.push({
        type: GROUP_SEARCH_ENTRY_TYPE,
        response: { status: String(HttpStatusCodes.Ok) },
        resource: buildClaimsOnlyResource(GROUP_RESOURCE_TYPE, record.id, combinedClaims),
      });
    }
    return response(job, 'searchset', data);
  }

  private async loadMemberClaims(
    id: string,
    vaultId: string,
    collectionName: string,
    loadedRecords?: readonly ConfidentialStorageDoc[],
  ): Promise<FlatClaims[]> {
    const section = buildGroupMemberSectionId(id);
    const records = loadedRecords
      || await this.deps.vaultRepository.listContainersInSection<ConfidentialStorageDoc>(collectionName, section);
    const result: FlatClaims[] = [];
    for (const record of records) {
      const claims = readClaimsOnlyContent(await this.deps.kmsService.unprotectConfidentialData<unknown>(record, vaultId));
      if (!claims) {
        throw new ManagerError('Historical native Group member requires an explicit recoverable migration.', IssueType.Invalid);
      }
      result.push(claims);
    }
    return result;
  }
}

export function buildGroupMemberSectionId(groupId: string): string {
  return `${GROUP_MEMBER_SECTION_PREFIX}-${boundedGroupId(groupId)}`;
}

export function buildGroupMemberProjectionId(groupId: string, memberReference: string): string {
  return createHash('sha256').update(`${boundedGroupId(groupId)}\0${memberReference.trim()}`).digest('base64url');
}

function normalizeGroupClaimsEntry(entry: GroupEntry): { id: string; claims: FlatClaims } {
  requireClaimsOnlyResourceShape(entry.resource, GROUP_RESOURCE_TYPE, 'Group');
  const normalized = normalizeGroupR5FlatClaimsResource(entry.resource);
  const id = boundedGroupId(normalized.id);
  const claims = normalizeGovernedFlatClaims(normalized.meta.claims, GROUP_R5_SEARCH_CLAIMS, 'Group');
  if (claims['Group.member']) {
    throw new ManagerError('Group.member requires one separate PATCH projection per PractitionerRole.', IssueType.Invalid);
  }
  requireSupportedGroupType(claims);
  requireSingleCode(claims, 'Group.membership', 'enumerated');
  const identifiers = claims['Group.identifier'] || [];
  if (identifiers.some((identifier) => !/^[^|]+\|[^|]+$/.test(identifier))) {
    throw new ManagerError('Group.identifier must use canonical system|value tokens.', IssueType.Invalid);
  }
  return { id, claims };
}

function normalizeGroupMemberEntry(entry: GroupEntry): { id: string; claims: FlatClaims } {
  requireClaimsOnlyResourceShape(entry.resource, GROUP_RESOURCE_TYPE, 'Group member');
  const normalized = normalizeGroupR5FlatClaimsResource(entry.resource);
  const claims = normalizeGovernedFlatClaims(normalized.meta.claims, GROUP_R5_SEARCH_CLAIMS, 'Group member');
  const allowed = new Set(['Group.type', 'Group.membership', 'Group.member']);
  if (Object.keys(claims).some((name) => !allowed.has(name))) {
    throw new ManagerError('Group member PATCH must contain only type, membership and one member.', IssueType.Invalid);
  }
  const groupType = requireSupportedGroupType(claims);
  requireSingleCode(claims, 'Group.membership', 'enumerated');
  const members = claims['Group.member'];
  if (members?.length !== 1 || !memberReferencePattern(groupType).test(members[0])) {
    throw new ManagerError(`Group member PATCH requires exactly one ${memberReferenceLabel(groupType)}.`, IssueType.Invalid);
  }
  return { id: boundedGroupId(normalized.id), claims };
}

function requireSingleCode(claims: FlatClaims, name: string, expected: string): void {
  if (claims[name]?.length !== 1 || claims[name][0] !== expected) {
    throw new ManagerError(`${name} must be '${expected}' for a professional research team.`, IssueType.Invalid);
  }
}

function requireSupportedGroupType(claims: FlatClaims): 'practitioner' | 'animal' | 'person' {
  const value = claims['Group.type'];
  if (value?.length !== 1 || !['practitioner', 'animal', 'person'].includes(value[0])) {
    throw new ManagerError("Group.type must be 'practitioner', 'animal' or 'person'.", IssueType.Invalid);
  }
  return value[0] as 'practitioner' | 'animal' | 'person';
}

function requireMatchingMemberType(baseClaims: FlatClaims, memberClaims: FlatClaims): void {
  const baseType = requireSupportedGroupType(baseClaims);
  const memberType = requireSupportedGroupType(memberClaims);
  if (baseType !== memberType) {
    throw new ManagerError('Group member type must match the stored Group type.', IssueType.Invalid);
  }
}

function memberReferencePattern(groupType: 'practitioner' | 'animal' | 'person'): RegExp {
  if (groupType === 'practitioner') return /^PractitionerRole\/[A-Za-z0-9\-.]{1,64}$/;
  if (groupType === 'animal') return /^Animal\/[A-Za-z0-9\-.]{1,64}$/;
  return /^Patient\/[A-Za-z0-9\-.]{1,64}$/;
}

function memberReferenceLabel(groupType: 'practitioner' | 'animal' | 'person'): string {
  if (groupType === 'practitioner') return 'PractitionerRole/<id>';
  return groupType === 'animal' ? 'Animal/<id>' : 'Patient/<id>';
}

function readEntries(job: JobRequest): GroupEntry[] {
  const body = job.content?.body as any;
  return Array.isArray(body?.data) ? body.data : Array.isArray(body?.entry) ? body.entry : [];
}

function readSearchFilters(job: JobRequest): Map<string, readonly string[]> {
  const raw = readEntries(job)[0]?.resource?.meta?.claims || {};
  const claims = normalizeGovernedFlatClaims(raw, GROUP_R5_SEARCH_CLAIMS, 'Group search');
  return new Map(Object.entries(claims));
}

function requireMatchingRequestId(entry: GroupEntry, id: string): void {
  if (String(entry.request?.url || '').replace(/^Group\//, '').trim() !== id) {
    throw new ManagerError('Group id does not match request.url.', IssueType.Conflict);
  }
}

function groupProtectedFilters(
  source: Map<string, readonly string[]>,
  protectedValues: readonly { name: string; value: string }[],
): Map<string, readonly { name: string; value: string }[]> {
  let offset = 0;
  return new Map([...source].map(([name, values]) => {
    const group = protectedValues.slice(offset, offset + values.length);
    offset += values.length;
    return [name, group];
  }));
}

function matchesProtectedAttributes(
  record: ConfidentialStorageDoc,
  filters: Map<string, readonly { name: string; value: string }[]>,
): boolean {
  const attributes = Array.isArray(record.indexed?.attributes) ? record.indexed.attributes : [];
  return [...filters.values()].every((alternatives) => alternatives.some((expected) =>
    attributes.some((stored) => stored.name === expected.name && stored.value === expected.value)));
}

function boundedGroupId(value: unknown): string {
  const id = String(value || '').trim();
  if (!/^[A-Za-z0-9\-.]{1,64}$/.test(id)) throw new ManagerError('Group.id is missing or invalid.', IssueType.Value);
  return id;
}

function normalizeControllerIds(value: unknown): string[] {
  return (Array.isArray(value) ? value : value ? [value] : [])
    .map((item) => typeof item === 'string' ? item.trim() : String((item as any)?.id || '').trim())
    .filter(Boolean);
}

function successEntry(id: string, claims: FlatClaims, status: number) {
  return { type: GROUP_ENTRY_TYPE, response: { status: String(status) }, resource: buildClaimsOnlyResource(GROUP_RESOURCE_TYPE, id, claims) };
}

function errorEntry(entry: GroupEntry, error: unknown) {
  const reason = error instanceof ManagerError
    ? error : new ManagerError(error instanceof Error ? error.message : String(error), IssueType.Invalid);
  return {
    type: entry.type || GROUP_ENTRY_TYPE,
    response: { status: reason.status, outcome: createOperationOutcome(IssueLevel.Error, reason.code, reason.message) },
    resource: { resourceType: 'OperationOutcome' },
  };
}

function response(job: JobRequest, type: 'batch-response' | 'searchset', data: Record<string, unknown>[]): IDecodedDidcommPayload {
  return {
    jti: randomUUID(), thid: String(job.content?.thid), type: 'transaction-response',
    iss: String(job.content?.aud || ''), aud: String(job.content?.iss || ''),
    body: { resourceType: 'Bundle', type, total: data.length, data },
  };
}
