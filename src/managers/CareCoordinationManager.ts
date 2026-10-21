import { createHash, randomUUID } from 'node:crypto';
import { HttpStatusCodes } from 'gdc-common-utils-ts/constants/http';
import type { JobRequest } from 'gdc-common-utils-ts/models/confidential-job';
import type { IDecodedDidcommPayload } from 'gdc-common-utils-ts/models/confidential-message';
import type { ConfidentialStorageDoc } from 'gdc-common-utils-ts/models/confidential-storage';
import { IssueLevel, IssueType, type IssueTypeCode } from 'gdc-common-utils-ts/models/issue';
import { ManagerError } from 'gdc-common-utils-ts/utils/manager-error';
import { claimsToContentCid } from 'gdc-common-utils-ts/utils/fhir-cid';
import {
  CommunicationRequestClaim,
  DocumentReferenceClaim,
  EncounterClaim,
  HealthcareServiceClaim,
  ServiceRequestClaim,
  TaskClaim,
} from 'fhir-data-utils-ts/claims';
import { assertPublicNotificationDatasetName, PublicAlertOperationalClaim } from 'sos-data-utils-ts/public-notifications';
import type { IVaultRepository } from '../database/repositories/vault/vault.repository';
import type { IKmsService } from '../gdc-backend-utils-node/models/IKmsService';
import { EntityLifecycleStatus } from '../gdc-backend-utils-node/models/enums';
import {
  buildClaimsOnlyResource,
  claimsOnlyContent,
  flatClaimsEqual,
  flatClaimsToIndexedAttributes,
  normalizeGovernedFlatClaims,
  readClaimsOnlyContent,
  requireClaimsOnlyResourceShape,
  type FlatClaims,
} from '../utils/fhir-flat-claims';
import { createOperationOutcome } from '../utils/outcome';
import { getTenantVaultId } from '../utils/tenant';
import type { IJobProcessor } from './registry';

export type CareCoordinationResourceType = 'Encounter' | 'ServiceRequest' | 'Task' | 'CommunicationRequest' | 'DocumentReference' | 'HealthcareService';

type TenantRegistry = Readonly<{
  tenantExists(vaultId: string): Promise<boolean>;
  getCollectionName(vaultId: string): Promise<string | undefined>;
  getTenantJurisdiction(vaultId: string): Promise<string | undefined>;
}>;

export type CareCoordinationManagerDependencies = Readonly<{
  resourceType: CareCoordinationResourceType;
  repository: IVaultRepository;
  kms: IKmsService;
  tenantManager: TenantRegistry;
}>;

const format = 'org.hl7.fhir.r5';
const routeSection = 'organization';
const config = Object.freeze({
  Encounter: {
    section: 'care-encounters', claims: new Set(Object.values(EncounterClaim)),
    required: [EncounterClaim.Identifier, EncounterClaim.Status, EncounterClaim.Subject, EncounterClaim.ServiceProvider, EncounterClaim.PeriodStart, EncounterClaim.Location],
    identifier: EncounterClaim.Identifier,
  },
  ServiceRequest: {
    section: 'care-service-requests', claims: new Set(Object.values(ServiceRequestClaim)),
    required: [ServiceRequestClaim.Identifier, ServiceRequestClaim.Status, ServiceRequestClaim.Intent, ServiceRequestClaim.Code, ServiceRequestClaim.Subject, ServiceRequestClaim.Requester, ServiceRequestClaim.Performer, ServiceRequestClaim.AuthoredOn],
    identifier: ServiceRequestClaim.Identifier,
  },
  Task: {
    section: 'care-triage-tasks', claims: new Set(Object.values(TaskClaim)),
    required: [TaskClaim.Identifier, TaskClaim.Status, TaskClaim.Intent, TaskClaim.Code, TaskClaim.For, TaskClaim.Requester, TaskClaim.Owner, TaskClaim.Focus, TaskClaim.AuthoredOn],
    identifier: TaskClaim.Identifier,
  },
  CommunicationRequest: {
    section: 'care-communication-requests', claims: new Set([...Object.values(CommunicationRequestClaim), PublicAlertOperationalClaim.DatasetName]),
    required: [CommunicationRequestClaim.Identifier, CommunicationRequestClaim.Status, CommunicationRequestClaim.Category, CommunicationRequestClaim.Subject, CommunicationRequestClaim.Requester, CommunicationRequestClaim.AuthoredOn],
    identifier: CommunicationRequestClaim.Identifier,
  },
  DocumentReference: {
    section: 'organization-document-references', claims: new Set(Object.values(DocumentReferenceClaim)),
    indexed: new Set(Object.values(DocumentReferenceClaim).filter(claim => claim !== DocumentReferenceClaim.ContentData)),
    required: [DocumentReferenceClaim.Identifier, DocumentReferenceClaim.Subject, DocumentReferenceClaim.Author, DocumentReferenceClaim.ContentType, DocumentReferenceClaim.ContentData, DocumentReferenceClaim.ContentHash],
    identifier: DocumentReferenceClaim.Identifier,
  },
  HealthcareService: {
    section: 'healthcare-services', claims: new Set(Object.values(HealthcareServiceClaim)),
    required: [HealthcareServiceClaim.Identifier, HealthcareServiceClaim.Active, HealthcareServiceClaim.Organization, HealthcareServiceClaim.Name],
    identifier: HealthcareServiceClaim.Identifier,
  },
} satisfies Record<CareCoordinationResourceType, {
  section: string;
  claims: ReadonlySet<string>;
  required: readonly string[];
  identifier: string;
  indexed?: ReadonlySet<string>;
}>);

/**
 * Persists care-continuity and public-notification work resources as canonical
 * flat claims. Native FHIR is rejected at this operational boundary; only protected
 * standard SearchParameter claims are indexed and native R4/R5 resources may
 * be materialized later by an explicit projection adapter.
 */
export class CareCoordinationManager implements IJobProcessor {
  constructor(private readonly deps: CareCoordinationManagerDependencies) {}

  async process(job: JobRequest): Promise<IDecodedDidcommPayload> {
    const storage = await this.storage(job);
    if (job.action === '_search') return this.search(job, storage);
    if (job.action !== '_batch') {
      throw new ManagerError(`Unsupported ${this.deps.resourceType} action.`, IssueType.NotSupported);
    }
    const data = [];
    for (const entry of entries(job)) {
      try { data.push(await this.write(job, entry, storage)); }
      catch (error) { data.push(errorEntry(this.deps.resourceType, error)); }
    }
    return response(job, 'batch-response', data);
  }

  private async storage(job: JobRequest) {
    if (!job.content?.thid || !job.tenantId || !job.sector || !job.jurisdiction) {
      throw new ManagerError(`${this.deps.resourceType} route is incomplete.`, IssueType.Required);
    }
    if (job.section !== routeSection || job.format !== format) {
      throw new ManagerError(`${this.deps.resourceType} requires the organization FHIR R5 route.`, IssueType.NotSupported);
    }
    const vaultId = getTenantVaultId(String(job.sector), String(job.tenantId));
    if (!(await this.deps.tenantManager.tenantExists(vaultId))) {
      throw new ManagerError('Care coordination tenant was not found.', IssueType.NotFound);
    }
    const jurisdiction = String(await this.deps.tenantManager.getTenantJurisdiction(vaultId) || '');
    if (!jurisdiction || jurisdiction.toUpperCase() !== String(job.jurisdiction).toUpperCase()) {
      throw new ManagerError('Care coordination tenant jurisdiction mismatch.', IssueType.Forbidden);
    }
    const collectionName = await this.deps.tenantManager.getCollectionName(vaultId);
    if (!collectionName) throw new ManagerError('Care coordination tenant collection was not found.', IssueType.NotFound);
    return { vaultId, collectionName };
  }

  private async write(job: JobRequest, entry: any, storage: Readonly<{ vaultId: string; collectionName: string }>) {
    const method = String(entry?.request?.method || '').toUpperCase();
    if (method !== 'POST' && method !== 'PUT') {
      throw new ManagerError(`Unsupported ${this.deps.resourceType} method.`, IssueType.NotSupported);
    }
    const normalized = this.normalize(entry?.resource);
    if (this.deps.resourceType === 'CommunicationRequest') validatePublicDatasetRoute(job, normalized.claims);
    if (entry?.request?.url && entry.request.url !== `${this.deps.resourceType}/${normalized.id}`) {
      throw new ManagerError(`${this.deps.resourceType} request URL does not match its resource.`, IssueType.Invalid);
    }
    const resourceConfig = config[this.deps.resourceType];
    const versionClaim = `${this.deps.resourceType}.meta.versionId`;
    const contentClaims = { ...normalized.claims };
    delete contentClaims[versionClaim];
    const versionId = claimsToContentCid(contentClaims).cid;
    const versionedClaims: FlatClaims = { ...contentClaims, [versionClaim]: [versionId] };
    const current = await this.deps.repository.get<ConfidentialStorageDoc>(storage.collectionName, normalized.id, resourceConfig.section);
    const currentClaims = current
      ? readClaimsOnlyContent(await this.deps.kms.unprotectConfidentialData<unknown>(current, storage.vaultId))
      : undefined;
    if (current && !currentClaims) {
      throw new ManagerError(`Historical ${this.deps.resourceType} requires an explicit recoverable migration.`, IssueType.Invalid);
    }
    if (current && method === 'POST') {
      if (!flatClaimsEqual(currentClaims!, versionedClaims)) {
        throw new ManagerError(`${this.deps.resourceType} already exists with different claims.`, IssueType.Conflict);
      }
      return successEntry(this.deps.resourceType, normalized.id, currentClaims!, HttpStatusCodes.Ok, false, versionId);
    }
    if (method === 'PUT') {
      if (!currentClaims) {
        return errorEntry(this.deps.resourceType, new Error(`${this.deps.resourceType} was not found.`), '404', IssueType.NotFound);
      }
      const expectedVersion = weakEtagVersion(entry?.request?.ifMatch);
      if (!expectedVersion) {
        return errorEntry(this.deps.resourceType, new Error(`${this.deps.resourceType} PUT requires a weak ETag in request.ifMatch.`));
      }
      if (currentClaims[versionClaim]?.[0] !== expectedVersion) {
        return errorEntry(this.deps.resourceType, new Error(`${this.deps.resourceType} version does not match request.ifMatch.`), '412', IssueType.Conflict);
      }
    }
    const indexableClaims = 'indexed' in resourceConfig ? resourceConfig.indexed : resourceConfig.claims;
    const attributes = flatClaimsToIndexedAttributes(versionedClaims, indexableClaims, resourceConfig.identifier);
    const protectedAttributes = await this.deps.kms.protectAttributesNameAndValue(attributes as any, storage.vaultId);
    const document: ConfidentialStorageDoc = {
      id: normalized.id,
      status: EntityLifecycleStatus.Active,
      sequence: Number(current?.sequence ?? -1) + 1,
      content: claimsOnlyContent(versionedClaims),
      indexed: { attributes: protectedAttributes },
      audit: { updated: new Date().toISOString() } as any,
    };
    const encrypted = await this.deps.kms.protectConfidentialData(document, storage.vaultId);
    if (!(await this.deps.repository.put(storage.collectionName, [encrypted], resourceConfig.section))) {
      throw new ManagerError(`${this.deps.resourceType} could not be persisted.`, IssueType.NoStore);
    }
    return successEntry(
      this.deps.resourceType,
      normalized.id,
      versionedClaims,
      method === 'POST' ? HttpStatusCodes.Created : HttpStatusCodes.Ok,
      false,
      versionId,
    );
  }

  private async search(job: JobRequest, storage: Readonly<{ vaultId: string; collectionName: string }>) {
    const searchEntry = entries(job)[0];
    const normalized = this.normalize(searchEntry?.resource, false);
    const resourceConfig = config[this.deps.resourceType];
    const requested = flatClaimsToIndexedAttributes(normalized.claims, resourceConfig.claims);
    const protectedFilters = await this.deps.kms.protectAttributesNameAndValue(requested as any, storage.vaultId);
    const records = await this.deps.repository.listContainersInSection<ConfidentialStorageDoc>(storage.collectionName, resourceConfig.section);
    const matching = records.filter(record => protectedFilters.every(filter => record.indexed?.attributes?.some(attribute =>
      attribute.name === filter.name && attribute.value === filter.value)));
    const data = [];
    for (const record of matching) {
      const claims = readClaimsOnlyContent(await this.deps.kms.unprotectConfidentialData<unknown>(record, storage.vaultId));
      if (!claims) throw new ManagerError(`Historical ${this.deps.resourceType} requires an explicit recoverable migration.`, IssueType.Invalid);
      data.push(successEntry(this.deps.resourceType, record.id, claims, HttpStatusCodes.Ok, true));
    }
    return response(job, 'searchset', data);
  }

  private normalize(resource: unknown, requireRequiredClaims = true): { id: string; claims: FlatClaims } {
    requireClaimsOnlyResourceShape(resource, this.deps.resourceType, this.deps.resourceType);
    const id = boundedId(resource.id, this.deps.resourceType);
    const resourceConfig = config[this.deps.resourceType];
    // The client may echo the version returned by search, but versioning is
    // server-owned metadata rather than an authorable FHIR SearchParameter.
    const rawClaims = { ...resource.meta.claims };
    delete rawClaims[`${this.deps.resourceType}.meta.versionId`];
    delete rawClaims[`org.hl7.fhir.r5.${this.deps.resourceType}.meta.versionId`];
    const claims = normalizeGovernedFlatClaims(
      rawClaims,
      resourceConfig.claims,
      this.deps.resourceType,
    );
    if (requireRequiredClaims) {
      for (const name of resourceConfig.required) {
        if (!claims[name]?.length) throw new ManagerError(`${name} is required.`, IssueType.Required);
      }
    }
    if (requireRequiredClaims && this.deps.resourceType === 'DocumentReference') validateDocumentReferenceContent(claims);
    return { id, claims };
  }
}

function validatePublicDatasetRoute(job: JobRequest, claims: FlatClaims): void {
  const datasetName = claims[PublicAlertOperationalClaim.DatasetName]?.[0];
  if (!datasetName) return;
  assertPublicNotificationDatasetName(datasetName);
  const sector = String(job.sector || '');
  const expectedPrefix = `${String(job.jurisdiction || '').toLowerCase()}_${sector}${sector === 'public-health' ? '_' : '_public_'}`;
  if (!datasetName.startsWith(expectedPrefix)) throw new ManagerError('Public dataset route does not match the tenant sector and jurisdiction.', IssueType.Forbidden);
  if (claims[CommunicationRequestClaim.Status]?.[0] !== 'active' || claims[CommunicationRequestClaim.Intent]?.[0] !== 'order') {
    throw new ManagerError('Direct public publication requires an active order.', IssueType.Invalid);
  }
  if (claims[CommunicationRequestClaim.InformationProvider]?.[0] !== `Organization/${String(job.tenantId)}`) {
    throw new ManagerError('Public information provider must match the publishing tenant.', IssueType.Forbidden);
  }
  if (!claims[CommunicationRequestClaim.Requester]?.[0]?.startsWith('PractitionerRole/')) {
    throw new ManagerError('Public publication requester must be a PractitionerRole.', IssueType.Invalid);
  }
  if (!claims[CommunicationRequestClaim.Recipient]?.[0]?.startsWith('Endpoint/')) {
    throw new ManagerError('Public publication recipient must be a topic Endpoint.', IssueType.Invalid);
  }
  const authoredOn = Date.parse(claims[CommunicationRequestClaim.AuthoredOn]?.[0] || '');
  const validUntil = Date.parse(claims[CommunicationRequestClaim.OccurrencePeriodEnd]?.[0] || '');
  if (!Number.isFinite(authoredOn) || !Number.isFinite(validUntil) || validUntil <= authoredOn) {
    throw new ManagerError('Public publication validity period is invalid.', IssueType.Invalid);
  }
  if (!claims[CommunicationRequestClaim.PayloadReference]?.[0]?.startsWith('DocumentReference/')) {
    throw new ManagerError('Public publication Markdown DocumentReference is required.', IssueType.Required);
  }
}

function validateDocumentReferenceContent(claims: FlatClaims): void {
  const content = claims[DocumentReferenceClaim.ContentData]?.[0] || '';
  const bytes = Buffer.from(content, 'base64');
  if (!bytes.length || bytes.length > 10 * 1024 * 1024 || bytes.toString('base64') !== content) {
    throw new ManagerError('DocumentReference content data is invalid.', IssueType.Invalid);
  }
  const digest = claims[DocumentReferenceClaim.ContentHash]?.[0] || '';
  if (!/^[a-f0-9]{64}$/u.test(digest) || createHash('sha256').update(bytes).digest('hex') !== digest) {
    throw new ManagerError('DocumentReference content hash is invalid.', IssueType.Invalid);
  }
}

function boundedId(value: unknown, label: string): string {
  const id = String(value || '').trim();
  if (!/^[A-Za-z0-9.-]{1,64}$/.test(id)) throw new ManagerError(`${label} id is invalid.`, IssueType.Invalid);
  return id;
}

function entries(job: JobRequest): any[] {
  const body = job.content?.body as any;
  return Array.isArray(body?.data) ? body.data : [];
}

function successEntry(
  resourceType: string,
  id: string,
  claims: FlatClaims,
  status: number,
  search = false,
  versionId?: string,
) {
  return {
    type: search ? `${resourceType}-search-response-v5.0.0` : `${resourceType}-v5.0.0`,
    response: { status: String(status), ...(versionId ? { etag: `W/"${versionId}"` } : {}) },
    resource: buildClaimsOnlyResource(resourceType, id, claims),
  };
}

function response(job: JobRequest, type: string, data: unknown[]): IDecodedDidcommPayload {
  return {
    jti: randomUUID(), thid: String(job.content?.thid), type: `org.hl7.fhir.r5.${type}`,
    iss: job.content?.aud as string, aud: job.content?.iss as string,
    body: { resourceType: 'Bundle', type, total: data.length, data },
  };
}

function errorEntry(resourceType: string, error: unknown, status?: string, code?: IssueTypeCode) {
  return {
    type: `${resourceType}-v5.0.0`,
    response: {
      status: status || (error instanceof ManagerError ? error.status : String(HttpStatusCodes.BadRequest)),
      outcome: createOperationOutcome(
        IssueLevel.Error,
        code || (error instanceof ManagerError ? error.code : IssueType.Invalid),
        error instanceof Error ? error.message : String(error),
      ),
    },
  };
}

function weakEtagVersion(value: unknown): string | undefined {
  const match = /^W\/"([^"\r\n]+)"$/.exec(String(value || '').trim());
  return match?.[1];
}
