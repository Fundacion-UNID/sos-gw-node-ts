import { createHash, randomUUID } from 'node:crypto';
import { HttpStatusCodes } from 'gdc-common-utils-ts/constants/http';
import type { JobRequest } from 'gdc-common-utils-ts/models/confidential-job';
import type { IDecodedDidcommPayload } from 'gdc-common-utils-ts/models/confidential-message';
import type { ConfidentialStorageDoc } from 'gdc-common-utils-ts/models/confidential-storage';
import { IssueLevel, IssueType } from 'gdc-common-utils-ts/models/issue';
import { ManagerError } from 'gdc-common-utils-ts/utils/manager-error';
import {
  ResearchStudyFlatClaimCatalog,
  ResearchStudyR5PartyRoleCodes,
  ResearchStudyR5PartyRoleSystem,
  normalizeResearchStudyR5FlatClaimsResource,
} from 'vet-data-utils-ts';
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

const RESOURCE_TYPE = 'ResearchStudy';
const ENTRY_TYPE = 'ResearchStudy-v5.0.0';
const SEARCH_ENTRY_TYPE = 'ResearchStudy-search-response-v5.0.0';
const PARTY_SEARCH_ENTRY_TYPE = 'ResearchStudy-associated-party-search-response-v5.0.0';
const STUDY_SECTION = 'research-studies';
const PARTY_SECTION_PREFIX = 'research-study-associated-parties';
const ROUTE_SECTION = 'organization';
const FHIR_R5_FORMAT = 'org.hl7.fhir.r5';
const STUDY_STATUSES = new Set(['draft', 'active', 'retired', 'unknown']);
const STANDARD_CLAIMS = new Set<string>(ResearchStudyFlatClaimCatalog.standardSearch);
const PARTY_CLAIMS = new Set<string>(ResearchStudyFlatClaimCatalog.associatedParty);
const SEARCH_CLAIMS = new Set<string>([...STANDARD_CLAIMS, ...PARTY_CLAIMS]);
const PARTY_ROLE_CODES = new Set<string>(ResearchStudyR5PartyRoleCodes);

type StudyEntry = {
  type?: string;
  request?: { method?: string; url?: string };
  resource?: { resourceType?: string; id?: string; meta?: { claims?: Record<string, unknown> }; [key: string]: unknown };
};

interface StudyTenantRegistry {
  tenantExists(vaultId: string): Promise<boolean>;
  getCollectionName(vaultId: string): Promise<string | undefined>;
  getTenantJurisdiction(vaultId: string): Promise<string | undefined>;
  getDidDocument(vaultId: string): Promise<{ controller?: unknown } | undefined>;
}

export interface ResearchStudyManagerDeps {
  vaultRepository: IVaultRepository;
  kmsService: IKmsService;
  tenantManager: StudyTenantRegistry;
}

/**
 * Persists ResearchStudy as canonical flat claims, never as native FHIR JSON.
 * The base record contains only official R5 SearchParameter claims. Each
 * associated party PATCH is a separately encrypted six-claim projection in a
 * study-scoped internal section, preserving correlation without presenting it
 * as a SearchParameter or pseudo-FHIR resource. PUT replaces the validated
 * base claims; DELETE explicitly targets either one supplied party projection
 * or the base study and its projections. Authorization remains a separate
 * active Consent decision. Search emits one base entry and one independent
 * claims-only entry per matching party, correlated by the same ResearchStudy
 * id so consumers never infer correlation from parallel arrays.
 *
 * @see https://hl7.org/fhir/R5/researchstudy.html
 * @see https://hl7.org/fhir/R5/researchstudy-search.html
 * @see https://hl7.org/fhir/valueset-research-study-party-role.html
 */
export class ResearchStudyManager implements IJobProcessor {
  constructor(private readonly deps: ResearchStudyManagerDeps) {}

  async process(job: JobRequest): Promise<IDecodedDidcommPayload> {
    this.validateRoute(job);
    const { vaultId, collectionName } = await this.resolveTenantStorage(job);
    if (job.action === '_search') return this.search(job, vaultId, collectionName);
    if (job.action !== '_batch') {
      throw new ManagerError(`Unsupported ResearchStudy action '${String(job.action || '')}'.`, IssueType.NotSupported);
    }
    await this.requireController(job, vaultId);
    const entries = readEntries(job);
    if (entries.length === 0) throw new ManagerError('ResearchStudy _batch requires at least one entry.', IssueType.Required);
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
      throw new ManagerError('ResearchStudy requires tenantId, sector and jurisdiction.', IssueType.Required);
    }
    if (String(job.section || '').trim().toLowerCase() !== ROUTE_SECTION) {
      throw new ManagerError(`ResearchStudy requires the '${ROUTE_SECTION}' section.`, IssueType.NotSupported);
    }
    if (String(job.format || '').trim().toLowerCase() !== FHIR_R5_FORMAT) {
      throw new ManagerError(`ResearchStudy requires '${FHIR_R5_FORMAT}'.`, IssueType.NotSupported);
    }
  }

  private async resolveTenantStorage(job: JobRequest) {
    const vaultId = getTenantVaultId(String(job.sector), String(job.tenantId));
    if (!(await this.deps.tenantManager.tenantExists(vaultId))) {
      throw new ManagerError('ResearchStudy tenant was not found for the requested sector.', IssueType.NotFound);
    }
    const expected = String(await this.deps.tenantManager.getTenantJurisdiction(vaultId) || '').trim();
    if (!expected || expected.toUpperCase() !== String(job.jurisdiction).trim().toUpperCase()) {
      throw new ManagerError('ResearchStudy route jurisdiction does not match the tenant jurisdiction.', IssueType.Forbidden);
    }
    const collectionName = String(await this.deps.tenantManager.getCollectionName(vaultId) || '').trim();
    if (!collectionName) throw new ManagerError('ResearchStudy tenant storage is unavailable.', IssueType.NotFound);
    return { vaultId, collectionName };
  }

  private async requireController(job: JobRequest, vaultId: string): Promise<void> {
    const issuer = String(job.content?.iss || '').trim();
    const did = await this.deps.tenantManager.getDidDocument(vaultId);
    if (!issuer || !normalizeControllerIds(did?.controller).includes(issuer)) {
      throw new ManagerError('ResearchStudy writes require a current tenant controller.', IssueType.Forbidden);
    }
  }

  private async writeEntry(entry: StudyEntry, vaultId: string, collectionName: string) {
    const method = String(entry.request?.method || '').trim().toUpperCase();
    if (method === 'POST') return this.create(entry, vaultId, collectionName);
    if (method === 'PUT') return this.update(entry, vaultId, collectionName);
    if (method === 'PATCH') return this.patchParty(entry, vaultId, collectionName);
    if (method === 'DELETE') return this.delete(entry, vaultId, collectionName);
    throw new ManagerError(`Unsupported ResearchStudy method '${method || '<missing>'}'.`, IssueType.NotSupported);
  }

  private async update(entry: StudyEntry, vaultId: string, collectionName: string) {
    const normalized = normalizeStudyEntry(entry);
    requireMatchingRequestId(entry, normalized.id);
    const current = await this.requireClaimsFirstStudy(normalized.id, vaultId, collectionName);
    await this.persist(
      normalized.id,
      normalized.claims,
      vaultId,
      collectionName,
      STUDY_SECTION,
      Number(current.sequence ?? 0) + 1,
      STANDARD_CLAIMS,
    );
    return successEntry(normalized.id, normalized.claims, HttpStatusCodes.Ok);
  }

  private async create(entry: StudyEntry, vaultId: string, collectionName: string) {
    const normalized = normalizeStudyEntry(entry);
    const existing = await this.deps.vaultRepository.get<ConfidentialStorageDoc>(collectionName, normalized.id, STUDY_SECTION);
    if (existing) {
      const content = await this.deps.kmsService.unprotectConfidentialData<unknown>(existing, vaultId);
      const existingClaims = readClaimsOnlyContent(content);
      if (!existingClaims) {
        throw new ManagerError('Historical native ResearchStudy requires an explicit recoverable migration.', IssueType.Invalid);
      }
      if (flatClaimsEqual(existingClaims, normalized.claims)) {
        return successEntry(normalized.id, normalized.claims, HttpStatusCodes.Ok);
      }
      throw new ManagerError(`ResearchStudy already exists with different claims: ${normalized.id}.`, IssueType.Conflict);
    }
    await this.persist(normalized.id, normalized.claims, vaultId, collectionName, STUDY_SECTION, 0, STANDARD_CLAIMS);
    return successEntry(normalized.id, normalized.claims, HttpStatusCodes.Created);
  }

  private async patchParty(entry: StudyEntry, vaultId: string, collectionName: string) {
    const normalized = normalizePartyEntry(entry);
    const requestId = String(entry.request?.url || '').replace(/^ResearchStudy\//, '').trim();
    if (requestId !== normalized.id) throw new ManagerError('ResearchStudy PATCH id does not match request.url.', IssueType.Conflict);
    await this.requireClaimsFirstStudy(normalized.id, vaultId, collectionName);
    const partyReference = normalized.claims['ResearchStudy.party'][0];
    const section = buildResearchStudyPartySectionId(normalized.id);
    const projectionId = buildResearchStudyPartyProjectionId(normalized.id, partyReference);
    const current = await this.deps.vaultRepository.get<ConfidentialStorageDoc>(collectionName, projectionId, section);
    await this.persist(
      projectionId,
      normalized.claims,
      vaultId,
      collectionName,
      section,
      Number(current?.sequence ?? -1) + 1,
      PARTY_CLAIMS,
    );
    return successEntry(normalized.id, normalized.claims, HttpStatusCodes.Ok);
  }

  private async delete(entry: StudyEntry, vaultId: string, collectionName: string) {
    if (entry.resource?.meta?.claims) {
      const normalized = normalizePartyEntry(entry);
      requireMatchingRequestId(entry, normalized.id);
      await this.requireClaimsFirstStudy(normalized.id, vaultId, collectionName);
      const partyReference = normalized.claims['ResearchStudy.party'][0];
      const section = buildResearchStudyPartySectionId(normalized.id);
      const projectionId = buildResearchStudyPartyProjectionId(normalized.id, partyReference);
      if (!(await this.deps.vaultRepository.get(collectionName, projectionId, section))) {
        throw new ManagerError(`ResearchStudy associated party not found: ${partyReference}.`, IssueType.NotFound);
      }
      if (!(await this.deps.vaultRepository.delete(collectionName, projectionId, section))) {
        throw new ManagerError(`ResearchStudy associated party could not be deleted: ${partyReference}.`, IssueType.NoStore);
      }
      return { type: ENTRY_TYPE, response: { status: String(HttpStatusCodes.NoContent) } };
    }
    const id = boundedStudyId(entry.resource?.id);
    requireMatchingRequestId(entry, id);
    await this.requireClaimsFirstStudy(id, vaultId, collectionName);
    if (!(await this.deps.vaultRepository.delete(collectionName, id, STUDY_SECTION))) {
      throw new ManagerError(`ResearchStudy could not be deleted: ${id}.`, IssueType.NoStore);
    }
    const section = buildResearchStudyPartySectionId(id);
    const parties = await this.deps.vaultRepository.listContainersInSection<ConfidentialStorageDoc>(collectionName, section);
    for (const party of parties) await this.deps.vaultRepository.delete(collectionName, party.id, section);
    return { type: ENTRY_TYPE, response: { status: String(HttpStatusCodes.NoContent) } };
  }

  private async requireClaimsFirstStudy(id: string, vaultId: string, collectionName: string) {
    const study = await this.deps.vaultRepository.get<ConfidentialStorageDoc>(collectionName, id, STUDY_SECTION);
    if (!study) throw new ManagerError(`ResearchStudy not found: ${id}.`, IssueType.NotFound);
    if (!readClaimsOnlyContent(await this.deps.kmsService.unprotectConfidentialData<unknown>(study, vaultId))) {
      throw new ManagerError('Historical native ResearchStudy requires an explicit recoverable migration.', IssueType.Invalid);
    }
    return study;
  }

  private async persist(
    id: string,
    claims: FlatClaims,
    vaultId: string,
    collectionName: string,
    section: string,
    sequence: number,
    indexedNames: ReadonlySet<string>,
  ) {
    const protectedAttributes = await this.deps.kmsService.protectAttributesNameAndValue(
      flatClaimsToIndexedAttributes(claims, indexedNames, 'ResearchStudy.identifier') as any,
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
      throw new ManagerError('ResearchStudy data could not be persisted.', IssueType.NoStore);
    }
  }

  private async search(job: JobRequest, vaultId: string, collectionName: string) {
    const filters = readSearchFilters(job);
    const protectedValues = await this.deps.kmsService.protectAttributesNameAndValue(
      [...filters].flatMap(([name, values]) => values.map((value) => ({ name, value }))) as any,
      vaultId,
    );
    const protectedFilters = groupProtectedFilters(filters, protectedValues);
    const baseFilters = new Map([...protectedFilters].filter(([name]) => STANDARD_CLAIMS.has(name)));
    const partyFilters = new Map([...protectedFilters].filter(([name]) => PARTY_CLAIMS.has(name)));
    const records = await this.deps.vaultRepository.listContainersInSection<ConfidentialStorageDoc>(collectionName, STUDY_SECTION);
    const data: Record<string, unknown>[] = [];
    for (const record of records) {
      if (!matchesProtectedAttributes(record, baseFilters)) continue;
      const partyRecords = await this.deps.vaultRepository.listContainersInSection<ConfidentialStorageDoc>(
        collectionName,
        buildResearchStudyPartySectionId(record.id),
      );
      const matchingPartyRecords = partyFilters.size === 0
        ? partyRecords
        : partyRecords.filter((party) => matchesProtectedAttributes(party, partyFilters));
      if (partyFilters.size > 0 && matchingPartyRecords.length === 0) continue;
      const content = await this.deps.kmsService.unprotectConfidentialData<unknown>(record, vaultId);
      const claims = readClaimsOnlyContent(content);
      if (!claims) {
        throw new ManagerError('Historical native ResearchStudy requires an explicit recoverable migration.', IssueType.Invalid);
      }
      data.push({
        type: SEARCH_ENTRY_TYPE,
        response: { status: String(HttpStatusCodes.Ok) },
        resource: buildClaimsOnlyResource(RESOURCE_TYPE, record.id, claims),
      });
      for (const partyRecord of matchingPartyRecords) {
        const partyClaims = readClaimsOnlyContent(
          await this.deps.kmsService.unprotectConfidentialData<unknown>(partyRecord, vaultId),
        );
        if (!partyClaims) {
          throw new ManagerError('Historical native ResearchStudy associated party requires an explicit recoverable migration.', IssueType.Invalid);
        }
        data.push({
          type: PARTY_SEARCH_ENTRY_TYPE,
          response: { status: String(HttpStatusCodes.Ok) },
          resource: buildClaimsOnlyResource(RESOURCE_TYPE, record.id, partyClaims),
        });
      }
    }
    return response(job, 'searchset', data);
  }
}

export function buildResearchStudyPartySectionId(studyId: string): string {
  return `${PARTY_SECTION_PREFIX}-${boundedStudyId(studyId)}`;
}

export function buildResearchStudyPartyProjectionId(studyId: string, partyReference: string): string {
  return createHash('sha256').update(`${boundedStudyId(studyId)}\0${partyReference.trim()}`).digest('base64url');
}

function normalizeStudyEntry(entry: StudyEntry): { id: string; claims: FlatClaims } {
  requireClaimsOnlyResourceShape(entry.resource, RESOURCE_TYPE, 'ResearchStudy');
  const normalized = normalizeResearchStudyR5FlatClaimsResource(entry.resource);
  const id = boundedStudyId(normalized.id);
  const claims = normalizeGovernedFlatClaims(normalized.meta.claims, STANDARD_CLAIMS, 'ResearchStudy');
  const statuses = claims['ResearchStudy.status'];
  if (statuses?.length !== 1 || !STUDY_STATUSES.has(statuses[0])) {
    throw new ManagerError('ResearchStudy.status is required and must be valid for FHIR R5.', IssueType.Value);
  }
  return { id, claims };
}

function normalizePartyEntry(entry: StudyEntry): { id: string; claims: FlatClaims } {
  requireClaimsOnlyResourceShape(entry.resource, RESOURCE_TYPE, 'ResearchStudy associatedParty');
  const normalized = normalizeResearchStudyR5FlatClaimsResource(entry.resource);
  const id = boundedStudyId(normalized.id);
  const claims = normalizeGovernedFlatClaims(normalized.meta.claims, PARTY_CLAIMS, 'ResearchStudy associatedParty');
  const party = claims['ResearchStudy.party'];
  const role = claims['ResearchStudy.party-role'];
  if (party?.length !== 1 || !/^PractitionerRole\/[A-Za-z0-9\-.]{1,64}$/.test(party[0])) {
    throw new ManagerError('ResearchStudy associated party must reference exactly one PractitionerRole/<id>.', IssueType.Invalid);
  }
  if (role?.length !== 1) {
    throw new ManagerError('ResearchStudy associated party requires exactly one role.', IssueType.Required);
  }
  const [system, code, extra] = role[0].split('|');
  if (extra !== undefined || system !== ResearchStudyR5PartyRoleSystem || !PARTY_ROLE_CODES.has(code)) {
    throw new ManagerError('ResearchStudy associated party role is not a valid R5 party-role token.', IssueType.Invalid);
  }
  if ((claims['ResearchStudy.party-name'] || []).length > 1) {
    throw new ManagerError('ResearchStudy associated party name must be singular.', IssueType.Invalid);
  }
  return { id, claims };
}

function readEntries(job: JobRequest): StudyEntry[] {
  const body = job.content?.body as any;
  return Array.isArray(body?.data) ? body.data : Array.isArray(body?.entry) ? body.entry : [];
}

function requireMatchingRequestId(entry: StudyEntry, id: string): void {
  if (String(entry.request?.url || '').replace(/^ResearchStudy\//, '').trim() !== id) {
    throw new ManagerError('ResearchStudy id does not match request.url.', IssueType.Conflict);
  }
}

function readSearchFilters(job: JobRequest): Map<string, readonly string[]> {
  const raw = readEntries(job)[0]?.resource?.meta?.claims || {};
  return new Map(Object.entries(normalizeGovernedFlatClaims(raw, SEARCH_CLAIMS, 'ResearchStudy search')));
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

function boundedStudyId(value: unknown): string {
  const id = String(value || '').trim();
  if (!/^[A-Za-z0-9\-.]{1,64}$/.test(id)) throw new ManagerError('ResearchStudy.id is missing or invalid.', IssueType.Value);
  return id;
}

function normalizeControllerIds(value: unknown): string[] {
  return (Array.isArray(value) ? value : value ? [value] : [])
    .map((item) => typeof item === 'string' ? item.trim() : String((item as any)?.id || '').trim())
    .filter(Boolean);
}

function successEntry(id: string, claims: FlatClaims, status: number) {
  return { type: ENTRY_TYPE, response: { status: String(status) }, resource: buildClaimsOnlyResource(RESOURCE_TYPE, id, claims) };
}

function errorEntry(entry: StudyEntry, error: unknown) {
  const reason = error instanceof ManagerError
    ? error : new ManagerError(error instanceof Error ? error.message : String(error), IssueType.Invalid);
  return {
    type: entry.type || ENTRY_TYPE,
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
