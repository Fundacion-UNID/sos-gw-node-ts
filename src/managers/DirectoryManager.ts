import { randomUUID } from 'node:crypto';
import { HttpStatusCodes } from 'gdc-common-utils-ts/constants/http';
import type { JobRequest } from 'gdc-common-utils-ts/models/confidential-job';
import type { IDecodedDidcommPayload } from 'gdc-common-utils-ts/models/confidential-message';
import type { ConfidentialStorageDoc } from 'gdc-common-utils-ts/models/confidential-storage';
import { IssueLevel, IssueType } from 'gdc-common-utils-ts/models/issue';
import { ManagerError } from 'gdc-common-utils-ts/utils/manager-error';
import {
  ClaimsDirectoryOrganizationSchemaorg,
  ClaimsDirectoryServiceSchemaorg,
  ClaimsPlaceSchemaorg,
  ClaimsProductSchemaorg,
  normalizeDirectoryFlatClaimsResource,
  type DirectoryResourceType,
} from 'vet-data-utils-ts/place-service-directory';
import type { IVaultRepository } from '../database/repositories/vault/vault.repository';
import type { IKmsService } from '../gdc-backend-utils-node/models/IKmsService';
import { EntityLifecycleStatus } from '../gdc-backend-utils-node/models/enums';
import { createOperationOutcome } from '../utils/outcome';
import { getTenantVaultId } from '../utils/tenant';
import { getAuthenticatedJobActorDid } from '../utils/authenticated-job-actor';
import type { IJobProcessor } from './registry';

type TenantRegistry = Readonly<{
  tenantExists(vaultId: string): Promise<boolean>;
  getCollectionName(vaultId: string): Promise<string | undefined>;
  getTenantJurisdiction(vaultId: string): Promise<string | undefined>;
  getTenant(vaultId: string): Promise<any | undefined>;
}>;

export type DirectoryManagerDependencies = Readonly<{
  resourceType: DirectoryResourceType;
  repository: IVaultRepository;
  kms: IKmsService;
  tenantManager: TenantRegistry;
}>;

const sectionByResource: Readonly<Record<DirectoryResourceType, string>> = {
  Organization: 'organizations', Place: 'places', Service: 'services', Product: 'products',
};
const requiredClaims: Readonly<Record<DirectoryResourceType, readonly string[]>> = {
  Organization: [ClaimsDirectoryOrganizationSchemaorg.identifier, ClaimsDirectoryOrganizationSchemaorg.parentOrganizationIdentifier,
    ClaimsDirectoryOrganizationSchemaorg.name, ClaimsDirectoryOrganizationSchemaorg.sameAs,
    ClaimsDirectoryOrganizationSchemaorg.locationIdentifier],
  Place: [ClaimsPlaceSchemaorg.identifier, ClaimsPlaceSchemaorg.ownerIdentifier, ClaimsPlaceSchemaorg.name,
    ClaimsPlaceSchemaorg.addressCountry, ClaimsPlaceSchemaorg.postalCode, ClaimsPlaceSchemaorg.latitude, ClaimsPlaceSchemaorg.longitude],
  Service: [ClaimsDirectoryServiceSchemaorg.identifier, ClaimsDirectoryServiceSchemaorg.providerIdentifier,
    ClaimsDirectoryServiceSchemaorg.placeIdentifier, ClaimsDirectoryServiceSchemaorg.name, ClaimsDirectoryServiceSchemaorg.serviceType],
  Product: [ClaimsProductSchemaorg.identifier, ClaimsProductSchemaorg.providerIdentifier,
    ClaimsProductSchemaorg.name, ClaimsProductSchemaorg.additionalType],
};

/** Controller-owned encrypted manager for product-local schema.org Organization, Place, Service, and Product records. */
export class DirectoryManager implements IJobProcessor {
  constructor(private readonly deps: DirectoryManagerDependencies) {}

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
    if (job.section !== 'organization' || job.format !== 'org.schema') throw new ManagerError(`${this.deps.resourceType} requires an organization schema.org directory route.`, IssueType.NotSupported);
    const vaultId = getTenantVaultId(String(job.sector), String(job.tenantId));
    if (!(await this.deps.tenantManager.tenantExists(vaultId))) throw new ManagerError('Directory tenant was not found.', IssueType.NotFound);
    const jurisdiction = await this.deps.tenantManager.getTenantJurisdiction(vaultId);
    if (!jurisdiction || jurisdiction.toUpperCase() !== String(job.jurisdiction).toUpperCase()) throw new ManagerError('Directory tenant jurisdiction mismatch.', IssueType.Forbidden);
    if (!(await this.deps.tenantManager.getCollectionName(vaultId))) throw new ManagerError('Directory tenant collection was not found.', IssueType.NotFound);
    const tenant = await this.deps.tenantManager.getTenant(vaultId);
    const controllers = Array.isArray(tenant?.didDocument?.controller) ? tenant.didDocument.controller : [tenant?.didDocument?.controller].filter(Boolean);
    if (!controllers.includes(getAuthenticatedJobActorDid(job))) throw new ManagerError('Only the organization controller may manage its public catalog.', IssueType.Forbidden);
  }

  private async write(job: JobRequest, entry: any) {
    const method = String(entry?.request?.method || '').toUpperCase();
    if (method !== 'POST' && method !== 'PUT') throw new ManagerError(`Unsupported ${this.deps.resourceType} method.`, IssueType.NotSupported);
    const normalized = normalizeDirectoryFlatClaimsResource(entry?.resource);
    if (normalized.resourceType !== this.deps.resourceType) throw new ManagerError(`${this.deps.resourceType} resourceType is invalid.`, IssueType.Invalid);
    for (const name of requiredClaims[this.deps.resourceType]) if (!normalized.meta.claims[name]?.length) throw new ManagerError(`${name} is required.`, IssueType.Required);
    const { vaultId, collectionName } = await storage(this.deps, job);
    const attributes = Object.entries(normalized.meta.claims).flatMap(([name, values]) => values.map(value => ({ name, value, unique: name.endsWith('.identifier') })));
    const indexed = await this.deps.kms.protectAttributesNameAndValue(attributes as any, vaultId);
    const document: ConfidentialStorageDoc = {
      id: normalized.id, status: EntityLifecycleStatus.Active, sequence: 1,
      content: { resource: normalized }, indexed: { attributes: indexed }, audit: { updated: new Date().toISOString() } as any,
    };
    const encrypted = await this.deps.kms.protectConfidentialData(document, vaultId);
    if (!(await this.deps.repository.put(collectionName, [encrypted], sectionByResource[this.deps.resourceType]))) throw new ManagerError(`${this.deps.resourceType} could not be persisted.`, IssueType.NoStore);
    return { type: this.deps.resourceType, response: { status: String(method === 'POST' ? HttpStatusCodes.Created : HttpStatusCodes.Ok) }, resource: normalized };
  }

  private async search(job: JobRequest): Promise<IDecodedDidcommPayload> {
    const rawClaims = entries(job)[0]?.resource?.meta?.claims ?? {};
    const normalized = normalizeDirectoryFlatClaimsResource({ resourceType: this.deps.resourceType, id: 'search', meta: { claims: rawClaims } });
    const { vaultId, collectionName } = await storage(this.deps, job);
    const requested = Object.entries(normalized.meta.claims).flatMap(([name, values]) => values.map(value => ({ name, value })));
    const protectedFilters = await this.deps.kms.protectAttributesNameAndValue(requested as any, vaultId);
    const records = await this.deps.repository.listContainersInSection<ConfidentialStorageDoc>(collectionName, sectionByResource[this.deps.resourceType]);
    const matching = records.filter(record => protectedFilters.every(filter => record.indexed?.attributes?.some(attribute => attribute.name === filter.name && attribute.value === filter.value)));
    const data = [];
    for (const record of matching) {
      const content = await this.deps.kms.unprotectConfidentialData<unknown>(record, vaultId);
      const resource = readDirectoryResourceContent(content);
      if (!resource || resource.resourceType !== this.deps.resourceType) throw new ManagerError(`Historical ${this.deps.resourceType} requires an explicit recoverable migration.`, IssueType.Invalid);
      data.push({ type: `${this.deps.resourceType}-search-response-v1.0`, response: { status: String(HttpStatusCodes.Ok) }, resource });
    }
    return response(job, 'searchset', data);
  }
}

function readDirectoryResourceContent(content: unknown) {
  if (!content || typeof content !== 'object' || Array.isArray(content)) return undefined;
  const value = content as Record<string, unknown>;
  try { return value.resource ? normalizeDirectoryFlatClaimsResource(value.resource) : undefined; }
  catch { return undefined; }
}

const entries = (job: JobRequest): any[] => {
  const body = job.content?.body as any;
  return Array.isArray(body?.data) ? body.data : Array.isArray(body?.entry) ? body.entry : [];
};

async function storage(deps: DirectoryManagerDependencies, job: JobRequest) {
  const vaultId = getTenantVaultId(String(job.sector), String(job.tenantId));
  const collectionName = await deps.tenantManager.getCollectionName(vaultId);
  if (!collectionName) throw new ManagerError('Directory tenant collection was not found.', IssueType.NotFound);
  return { vaultId, collectionName };
}

function response(job: JobRequest, type: string, data: unknown[]): IDecodedDidcommPayload {
  return { jti: randomUUID(), thid: String(job.content?.thid), type: `org.schema.${type}`, iss: job.content?.aud as string, aud: job.content?.iss as string, body: { resourceType: 'Bundle', type, total: data.length, data } };
}

function errorEntry(resourceType: string, error: unknown) {
  return { type: resourceType, response: { status: String(HttpStatusCodes.BadRequest), outcome: createOperationOutcome(IssueLevel.Error, error instanceof ManagerError ? error.code : IssueType.Invalid, error instanceof Error ? error.message : String(error)) } };
}
