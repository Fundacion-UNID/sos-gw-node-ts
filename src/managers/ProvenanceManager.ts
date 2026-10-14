import { randomUUID } from 'node:crypto';
import { HttpStatusCodes } from 'gdc-common-utils-ts/constants/http';
import type { JobRequest } from 'gdc-common-utils-ts/models/confidential-job';
import type { IDecodedDidcommPayload } from 'gdc-common-utils-ts/models/confidential-message';
import type { ConfidentialStorageDoc } from 'gdc-common-utils-ts/models/confidential-storage';
import { IssueLevel, IssueType } from 'gdc-common-utils-ts/models/issue';
import { ManagerError } from 'gdc-common-utils-ts/utils/manager-error';
import {
  normalizeProvenanceR5FlatClaimsResource,
  type ProvenanceR5FlatClaimsResource,
} from 'vet-data-utils-ts/provenance';
import type { IVaultRepository } from '../database/repositories/vault/vault.repository';
import type { IKmsService } from '../gdc-backend-utils-node/models/IKmsService';
import { EntityLifecycleStatus } from '../gdc-backend-utils-node/models/enums';
import { getAuthenticatedJobActorDid } from '../utils/authenticated-job-actor';
import { createOperationOutcome } from '../utils/outcome';
import { getTenantVaultId } from '../utils/tenant';
import type { IJobProcessor } from './registry';

type TenantRegistry = Readonly<{
  tenantExists(vaultId: string): Promise<boolean>;
  getCollectionName(vaultId: string): Promise<string | undefined>;
  getTenantJurisdiction(vaultId: string): Promise<string | undefined>;
  getTenant(vaultId: string): Promise<any | undefined>;
}>;

export type ProvenanceManagerDependencies = Readonly<{
  repository: IVaultRepository;
  kms: IKmsService;
  tenantManager: TenantRegistry;
}>;

const STORAGE_SECTION = 'provenances';

/** Controller-only encrypted manager for claims-first FHIR R5 Provenance. */
export class ProvenanceManager implements IJobProcessor {
  constructor(private readonly deps: ProvenanceManagerDependencies) {}

  async process(job: JobRequest): Promise<IDecodedDidcommPayload> {
    await this.validateRoute(job);
    if (job.action === '_search') return this.search(job);
    if (job.action !== '_batch') throw new ManagerError('Unsupported Provenance action.', IssueType.NotSupported);
    const data = [];
    for (const entry of entries(job)) {
      try { data.push(await this.write(job, entry)); }
      catch (error) { data.push(errorEntry(error)); }
    }
    return response(job, 'batch-response', data);
  }

  private async validateRoute(job: JobRequest): Promise<void> {
    if (!job.content?.thid || !job.tenantId || !job.sector || !job.jurisdiction) throw new ManagerError('Provenance route is incomplete.', IssueType.Required);
    if (job.section !== 'organization' || job.format !== 'org.hl7.fhir.r5') throw new ManagerError('Provenance requires an organization FHIR R5 route.', IssueType.NotSupported);
    const vaultId = getTenantVaultId(String(job.sector), String(job.tenantId));
    if (!(await this.deps.tenantManager.tenantExists(vaultId))) throw new ManagerError('Provenance tenant was not found.', IssueType.NotFound);
    if ((await this.deps.tenantManager.getTenantJurisdiction(vaultId))?.toUpperCase() !== String(job.jurisdiction).toUpperCase()) throw new ManagerError('Provenance tenant jurisdiction mismatch.', IssueType.Forbidden);
    if (!(await this.deps.tenantManager.getCollectionName(vaultId))) throw new ManagerError('Provenance tenant collection was not found.', IssueType.NotFound);
    const tenant = await this.deps.tenantManager.getTenant(vaultId);
    const controllers = Array.isArray(tenant?.didDocument?.controller) ? tenant.didDocument.controller : [tenant?.didDocument?.controller].filter(Boolean);
    if (!controllers.includes(getAuthenticatedJobActorDid(job))) throw new ManagerError('Only the organization controller may manage Provenance.', IssueType.Forbidden);
  }

  private async write(job: JobRequest, entry: any) {
    const method = String(entry?.request?.method || '').toUpperCase();
    if (method !== 'POST' && method !== 'PUT') throw new ManagerError('Unsupported Provenance method.', IssueType.NotSupported);
    const resource = normalizeProvenanceR5FlatClaimsResource(entry?.resource);
    for (const claim of ['Provenance.target', 'Provenance.recorded', 'Provenance.agent']) {
      if (!claimValues(resource.meta.claims[claim]).length) throw new ManagerError(`${claim} is required.`, IssueType.Required);
    }
    const { vaultId, collectionName } = await storage(this.deps, job);
    const attributes = Object.entries(resource.meta.claims).flatMap(([name, value]) => claimValues(value).map(item => ({ name, value: item })));
    const indexed = await this.deps.kms.protectAttributesNameAndValue(attributes as any, vaultId);
    const document: ConfidentialStorageDoc = {
      id: resource.id,
      status: EntityLifecycleStatus.Active,
      sequence: 1,
      content: { resource },
      indexed: { attributes: indexed },
      audit: { updated: new Date().toISOString() } as any,
    };
    const encrypted = await this.deps.kms.protectConfidentialData(document, vaultId);
    if (!(await this.deps.repository.put(collectionName, [encrypted], STORAGE_SECTION))) throw new ManagerError('Provenance could not be persisted.', IssueType.NoStore);
    return { type: 'Provenance', response: { status: String(method === 'POST' ? HttpStatusCodes.Created : HttpStatusCodes.Ok) }, resource };
  }

  private async search(job: JobRequest): Promise<IDecodedDidcommPayload> {
    const rawClaims = entries(job)[0]?.resource?.meta?.claims ?? {};
    const query = normalizeProvenanceR5FlatClaimsResource({ resourceType: 'Provenance', id: 'search', meta: { claims: rawClaims } });
    const { vaultId, collectionName } = await storage(this.deps, job);
    const requested = Object.entries(query.meta.claims).flatMap(([name, value]) => claimValues(value).map(item => ({ name, value: item })));
    const filters = await this.deps.kms.protectAttributesNameAndValue(requested as any, vaultId);
    const records = await this.deps.repository.listContainersInSection<ConfidentialStorageDoc>(collectionName, STORAGE_SECTION);
    const data = [];
    for (const record of records.filter(item => filters.every(filter => item.indexed?.attributes?.some(attribute => attribute.name === filter.name && attribute.value === filter.value)))) {
      const content = await this.deps.kms.unprotectConfidentialData<any>(record, vaultId);
      let resource: ProvenanceR5FlatClaimsResource;
      try { resource = normalizeProvenanceR5FlatClaimsResource(content?.resource); }
      catch { throw new ManagerError('Historical Provenance requires an explicit recoverable migration.', IssueType.Invalid); }
      data.push({ type: 'Provenance-search-response-v1.0', response: { status: String(HttpStatusCodes.Ok) }, resource });
    }
    return response(job, 'searchset', data);
  }
}

const claimValues = (value: unknown): string[] => (Array.isArray(value) ? value : value === undefined ? [] : [value]).map(String);
const entries = (job: JobRequest): any[] => { const body = job.content?.body as any; return Array.isArray(body?.data) ? body.data : Array.isArray(body?.entry) ? body.entry : []; };
async function storage(deps: ProvenanceManagerDependencies, job: JobRequest) { const vaultId = getTenantVaultId(String(job.sector), String(job.tenantId)); const collectionName = await deps.tenantManager.getCollectionName(vaultId); if (!collectionName) throw new ManagerError('Provenance tenant collection was not found.', IssueType.NotFound); return { vaultId, collectionName }; }
function response(job: JobRequest, type: string, data: unknown[]): IDecodedDidcommPayload { return { jti: randomUUID(), thid: String(job.content?.thid), type: `org.hl7.fhir.r5.${type}`, iss: job.content?.aud as string, aud: job.content?.iss as string, body: { resourceType: 'Bundle', type, total: data.length, data } }; }
function errorEntry(error: unknown) { return { type: 'Provenance', response: { status: String(HttpStatusCodes.BadRequest), outcome: createOperationOutcome(IssueLevel.Error, error instanceof ManagerError ? error.code : IssueType.Invalid, error instanceof Error ? error.message : String(error)) } }; }
