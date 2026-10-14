import { randomUUID } from 'node:crypto';
import { HttpStatusCodes } from 'gdc-common-utils-ts/constants/http';
import type { JobRequest } from 'gdc-common-utils-ts/models/confidential-job';
import type { IDecodedDidcommPayload } from 'gdc-common-utils-ts/models/confidential-message';
import type { ConfidentialStorageDoc } from 'gdc-common-utils-ts/models/confidential-storage';
import { IssueLevel, IssueType } from 'gdc-common-utils-ts/models/issue';
import { ManagerError } from 'gdc-common-utils-ts/utils/manager-error';
import {
  ClaimsHealthDcatCatalog,
  ClaimsHealthDcatCatalogRecord,
  ClaimsHealthDcatDataset,
  ClaimsHealthDcatDistribution,
  ClaimsHealthDcatDataService,
  normalizeHealthDcatResource,
  type HealthDcatResource,
} from 'vet-data-utils-ts/health-dcat';
import type { IVaultRepository } from '../database/repositories/vault/vault.repository';
import type { IKmsService } from '../gdc-backend-utils-node/models/IKmsService';
import { EntityLifecycleStatus } from '../gdc-backend-utils-node/models/enums';
import { getAuthenticatedJobActorDid } from '../utils/authenticated-job-actor';
import { createOperationOutcome } from '../utils/outcome';
import { getTenantVaultId } from '../utils/tenant';
import type { IJobProcessor } from './registry';

type HealthDcatResourceType = HealthDcatResource['resourceType'];
type TenantRegistry = Readonly<{
  tenantExists(vaultId: string): Promise<boolean>;
  getCollectionName(vaultId: string): Promise<string | undefined>;
  getTenantJurisdiction(vaultId: string): Promise<string | undefined>;
  getTenant(vaultId: string): Promise<any | undefined>;
}>;

export type HealthDcatManagerDependencies = Readonly<{
  resourceType: HealthDcatResourceType;
  repository: IVaultRepository;
  kms: IKmsService;
  tenantManager: TenantRegistry;
}>;

const sectionByResource: Readonly<Record<HealthDcatResourceType, string>> = {
  Catalog: 'health-dcat-catalogs', Dataset: 'health-dcat-datasets', CatalogRecord: 'health-dcat-records',
  Distribution: 'health-dcat-distributions', DataService: 'health-dcat-services',
};

const requiredClaims: Readonly<Record<HealthDcatResourceType, readonly string[]>> = {
  Catalog: [ClaimsHealthDcatCatalog.identifier, ClaimsHealthDcatCatalog.title, ClaimsHealthDcatCatalog.description,
    ClaimsHealthDcatCatalog.publisher, ClaimsHealthDcatCatalog.applicableLegislation],
  Dataset: [ClaimsHealthDcatDataset.identifier, ClaimsHealthDcatDataset.title, ClaimsHealthDcatDataset.description,
    ClaimsHealthDcatDataset.publisher, ClaimsHealthDcatDataset.custodian, ClaimsHealthDcatDataset.accessRights,
    ClaimsHealthDcatDataset.healthCategory, ClaimsHealthDcatDataset.healthDataAccessBody, ClaimsHealthDcatDataset.structuredData],
  CatalogRecord: [ClaimsHealthDcatCatalogRecord.identifier, ClaimsHealthDcatCatalogRecord.primaryTopic,
    ClaimsHealthDcatCatalogRecord.status, ClaimsHealthDcatCatalogRecord.modified],
  Distribution: [ClaimsHealthDcatDistribution.identifier, ClaimsHealthDcatDistribution.title,
    ClaimsHealthDcatDistribution.accessUrl, ClaimsHealthDcatDistribution.format, ClaimsHealthDcatDistribution.accessRights],
  DataService: [ClaimsHealthDcatDataService.identifier, ClaimsHealthDcatDataService.title,
    ClaimsHealthDcatDataService.publisher, ClaimsHealthDcatDataService.endpointUrl,
    ClaimsHealthDcatDataService.servesDataset, ClaimsHealthDcatDataService.accessRights],
};

/** Controller-only claims-first encrypted manager for product-local HealthDCAT metadata. */
export class HealthDcatManager implements IJobProcessor {
  constructor(private readonly deps: HealthDcatManagerDependencies) {}

  async process(job: JobRequest): Promise<IDecodedDidcommPayload> {
    await this.validateRoute(job);
    if (job.action === '_search') return this.search(job);
    if (job.action !== '_batch') throw new ManagerError(`Unsupported ${this.deps.resourceType} action.`, IssueType.NotSupported);
    const data = [];
    for (const entry of entries(job)) {
      try { data.push(await this.write(job, entry)); }
      catch (error) { data.push(errorEntry(this.deps.resourceType, error)); }
    }
    return response(job, 'batch-response', data);
  }

  private async validateRoute(job: JobRequest): Promise<void> {
    if (!job.content?.thid || !job.tenantId || !job.sector || !job.jurisdiction) throw new ManagerError(`${this.deps.resourceType} route is incomplete.`, IssueType.Required);
    if (job.section !== 'organization' || job.format !== 'org.w3.dcat') throw new ManagerError(`${this.deps.resourceType} requires an organization DCAT route.`, IssueType.NotSupported);
    const vaultId = getTenantVaultId(String(job.sector), String(job.tenantId));
    if (!(await this.deps.tenantManager.tenantExists(vaultId))) throw new ManagerError('HealthDCAT tenant was not found.', IssueType.NotFound);
    if ((await this.deps.tenantManager.getTenantJurisdiction(vaultId))?.toUpperCase() !== String(job.jurisdiction).toUpperCase()) throw new ManagerError('HealthDCAT tenant jurisdiction mismatch.', IssueType.Forbidden);
    if (!(await this.deps.tenantManager.getCollectionName(vaultId))) throw new ManagerError('HealthDCAT tenant collection was not found.', IssueType.NotFound);
    const tenant = await this.deps.tenantManager.getTenant(vaultId);
    const controllers = Array.isArray(tenant?.didDocument?.controller) ? tenant.didDocument.controller : [tenant?.didDocument?.controller].filter(Boolean);
    if (!controllers.includes(getAuthenticatedJobActorDid(job))) throw new ManagerError('Only the organization controller may manage HealthDCAT publication.', IssueType.Forbidden);
  }

  private async write(job: JobRequest, entry: any) {
    const method = String(entry?.request?.method || '').toUpperCase();
    if (method !== 'POST' && method !== 'PUT') throw new ManagerError(`Unsupported ${this.deps.resourceType} method.`, IssueType.NotSupported);
    const resource = normalizeHealthDcatResource(entry?.resource);
    if (resource.resourceType !== this.deps.resourceType) throw new ManagerError(`${this.deps.resourceType} resourceType is invalid.`, IssueType.Invalid);
    for (const name of requiredClaims[this.deps.resourceType]) if (!claimValues(resource.meta.claims[name]).length) throw new ManagerError(`${name} is required.`, IssueType.Required);
    const { vaultId, collectionName } = await storage(this.deps, job);
    const attributes = Object.entries(resource.meta.claims).flatMap(([name, value]) => claimValues(value).map(item => ({ name, value: item, unique: name === 'dct.identifier' })));
    const indexed = await this.deps.kms.protectAttributesNameAndValue(attributes as any, vaultId);
    const document: ConfidentialStorageDoc = { id: resource.id, status: EntityLifecycleStatus.Active, sequence: 1,
      content: { resource }, indexed: { attributes: indexed }, audit: { updated: new Date().toISOString() } as any };
    const encrypted = await this.deps.kms.protectConfidentialData(document, vaultId);
    if (!(await this.deps.repository.put(collectionName, [encrypted], sectionByResource[this.deps.resourceType]))) throw new ManagerError(`${this.deps.resourceType} could not be persisted.`, IssueType.NoStore);
    return { type: this.deps.resourceType, response: { status: String(method === 'POST' ? HttpStatusCodes.Created : HttpStatusCodes.Ok) }, resource };
  }

  private async search(job: JobRequest): Promise<IDecodedDidcommPayload> {
    const rawClaims = entries(job)[0]?.resource?.meta?.claims ?? {};
    const query = normalizeHealthDcatResource({ resourceType: this.deps.resourceType, id: 'search', meta: { claims: rawClaims } });
    const { vaultId, collectionName } = await storage(this.deps, job);
    const requested = Object.entries(query.meta.claims).flatMap(([name, value]) => claimValues(value).map(item => ({ name, value: item })));
    const filters = await this.deps.kms.protectAttributesNameAndValue(requested as any, vaultId);
    const records = await this.deps.repository.listContainersInSection<ConfidentialStorageDoc>(collectionName, sectionByResource[this.deps.resourceType]);
    const data = [];
    for (const record of records.filter(item => filters.every(filter => item.indexed?.attributes?.some(attribute => attribute.name === filter.name && attribute.value === filter.value)))) {
      const content = await this.deps.kms.unprotectConfidentialData<any>(record, vaultId);
      let resource: HealthDcatResource;
      try { resource = normalizeHealthDcatResource(content?.resource); } catch { throw new ManagerError(`Historical ${this.deps.resourceType} requires an explicit recoverable migration.`, IssueType.Invalid); }
      if (resource.resourceType !== this.deps.resourceType) throw new ManagerError(`${this.deps.resourceType} search result is invalid.`, IssueType.Invalid);
      data.push({ type: `${this.deps.resourceType}-search-response-v1.0`, response: { status: String(HttpStatusCodes.Ok) }, resource });
    }
    return response(job, 'searchset', data);
  }
}

const claimValues = (value: unknown): string[] => (Array.isArray(value) ? value : value === undefined ? [] : [value]).map(String);
const entries = (job: JobRequest): any[] => { const body = job.content?.body as any; return Array.isArray(body?.data) ? body.data : Array.isArray(body?.entry) ? body.entry : []; };
async function storage(deps: HealthDcatManagerDependencies, job: JobRequest) { const vaultId = getTenantVaultId(String(job.sector), String(job.tenantId)); const collectionName = await deps.tenantManager.getCollectionName(vaultId); if (!collectionName) throw new ManagerError('HealthDCAT tenant collection was not found.', IssueType.NotFound); return { vaultId, collectionName }; }
function response(job: JobRequest, type: string, data: unknown[]): IDecodedDidcommPayload { return { jti: randomUUID(), thid: String(job.content?.thid), type: `org.w3.dcat.${type}`, iss: job.content?.aud as string, aud: job.content?.iss as string, body: { resourceType: 'Bundle', type, total: data.length, data } }; }
function errorEntry(resourceType: string, error: unknown) { return { type: resourceType, response: { status: String(HttpStatusCodes.BadRequest), outcome: createOperationOutcome(IssueLevel.Error, error instanceof ManagerError ? error.code : IssueType.Invalid, error instanceof Error ? error.message : String(error)) } }; }
