import { randomUUID } from 'node:crypto';
import { HttpStatusCodes } from 'gdc-common-utils-ts/constants/http';
import type { JobRequest } from 'gdc-common-utils-ts/models/confidential-job';
import type { IDecodedDidcommPayload } from 'gdc-common-utils-ts/models/confidential-message';
import type { ConfidentialStorageDoc } from 'gdc-common-utils-ts/models/confidential-storage';
import { IssueLevel, IssueType } from 'gdc-common-utils-ts/models/issue';
import { ManagerError } from 'gdc-common-utils-ts/utils/manager-error';
import {
  SchedulingFlatClaimCatalog,
  normalizeSchedulingFlatClaimsResource,
  type SchedulingResourceType,
} from 'vet-data-utils-ts/scheduling';
import type { NotificationManager } from '../services/notifications/NotificationManager';
import type { IVaultRepository } from '../database/repositories/vault/vault.repository';
import type { IKmsService } from '../gdc-backend-utils-node/models/IKmsService';
import { EntityLifecycleStatus } from '../gdc-backend-utils-node/models/enums';
import { createOperationOutcome } from '../utils/outcome';
import { getSubjectScopedSectionId } from '../utils/individual-sections';
import { getTenantVaultId } from '../utils/tenant';
import type { IJobProcessor } from './registry';
import { SUBJECT_SECTION_INDIVIDUAL } from '../constants/domain';

type TenantRegistry = Readonly<{
  tenantExists(vaultId: string): Promise<boolean>;
  getCollectionName(vaultId: string): Promise<string | undefined>;
  getTenantJurisdiction(vaultId: string): Promise<string | undefined>;
}>;

export type SchedulingManagerDependencies = Readonly<{
  resourceType: SchedulingResourceType;
  repository: IVaultRepository;
  kms: IKmsService;
  tenantManager: TenantRegistry;
  notificationManager?: NotificationManager;
}>;

const sectionByResource: Record<SchedulingManagerDependencies['resourceType'], string> = {
  Location: 'locations',
  Schedule: 'schedules',
  Slot: 'slots',
  AppointmentResponse: 'appointment-responses',
  Appointment: 'appointments',
};

const requiredClaims: Record<SchedulingManagerDependencies['resourceType'], readonly string[]> = {
  Location: ['Location.status', 'Location.name', 'Location.organization'],
  Schedule: ['Schedule.active', 'Schedule.actor'],
  Slot: ['Slot.status', 'Slot.schedule', 'Slot.start'],
  AppointmentResponse: ['AppointmentResponse.appointment', 'AppointmentResponse.actor', 'AppointmentResponse.part-status', 'AppointmentResponse._lastUpdated'],
  Appointment: ['Appointment.status', 'Appointment.actor'],
};

/** Claims-first encrypted manager used by the organization scheduling resources owned only by GW VET. */
export class SchedulingManager implements IJobProcessor {
  constructor(private readonly deps: SchedulingManagerDependencies) {}

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
    const allowedSections = ['Appointment', 'AppointmentResponse'].includes(this.deps.resourceType) ? ['organization', 'individual'] : ['organization'];
    if (!allowedSections.includes(String(job.section)) || job.format !== 'org.hl7.fhir.api') throw new ManagerError(`${this.deps.resourceType} requires an allowed FHIR API scheduling route.`, IssueType.NotSupported);
    const vaultId = getTenantVaultId(String(job.sector), String(job.tenantId));
    if (!(await this.deps.tenantManager.tenantExists(vaultId))) throw new ManagerError('Scheduling tenant was not found.', IssueType.NotFound);
    const jurisdiction = await this.deps.tenantManager.getTenantJurisdiction(vaultId);
    if (!jurisdiction || jurisdiction.toUpperCase() !== String(job.jurisdiction).toUpperCase()) throw new ManagerError('Scheduling tenant jurisdiction mismatch.', IssueType.Forbidden);
    if (!(await this.deps.tenantManager.getCollectionName(vaultId))) throw new ManagerError('Scheduling tenant collection was not found.', IssueType.NotFound);
  }

  private async write(job: JobRequest, entry: any) {
    const method = String(entry?.request?.method || '').toUpperCase();
    if (method !== 'POST' && method !== 'PUT') throw new ManagerError(`Unsupported ${this.deps.resourceType} method.`, IssueType.NotSupported);
    const normalized = normalizeSchedulingInput(entry?.resource);
    if (normalized.resourceType !== this.deps.resourceType) throw new ManagerError(`${this.deps.resourceType} resourceType is invalid.`, IssueType.Invalid);
    for (const name of requiredClaims[this.deps.resourceType]) if (!normalized.meta.claims[name]?.length) throw new ManagerError(`${name} is required.`, IssueType.Required);
    const { vaultId, collectionName } = await storage(this.deps, job);
    const attributes = Object.entries(normalized.meta.claims).flatMap(([name, values]) => values.map(value => ({ name, value, unique: name.endsWith('.identifier') })));
    const indexed = await this.deps.kms.protectAttributesNameAndValue(attributes as any, vaultId);
    const document: ConfidentialStorageDoc = {
      id: normalized.id, status: EntityLifecycleStatus.Active, sequence: 1,
      content: { claims: normalized.meta.claims }, indexed: { attributes: indexed }, audit: { updated: new Date().toISOString() } as any,
    };
    const encrypted = await this.deps.kms.protectConfidentialData(document, vaultId);
    const sectionId = resolveSchedulingSection(job, this.deps.resourceType, normalized.meta.claims);
    if (!(await this.deps.repository.put(collectionName, [encrypted], sectionId))) throw new ManagerError(`${this.deps.resourceType} could not be persisted.`, IssueType.NoStore);
    const notification = await this.sendAppointmentResponseEmail(normalized);
    return { type: this.deps.resourceType, response: { status: String(method === 'POST' ? HttpStatusCodes.Created : HttpStatusCodes.Ok) }, resource: normalized, ...(notification ? { notification } : {}) };
  }

  private async sendAppointmentResponseEmail(resource: ReturnType<typeof normalizeSchedulingFlatClaimsResource>) {
    if (resource.resourceType !== 'AppointmentResponse') return undefined;
    const claims = resource.meta.claims;
    const contained = Array.isArray(resource.contained) ? resource.contained as any[] : [];
    const communication = contained.find(item => item?.resourceType === 'Communication');
    const endpoint = contained.find(item => item?.resourceType === 'Endpoint' && String(item?.address || '').startsWith('mailto:'));
    if (!communication && !endpoint) return undefined;
    if (!communication || !endpoint || !this.deps.notificationManager) throw new ManagerError('AppointmentResponse recipient email delivery is not configured.', IssueType.Invalid);
    const recipient = String(communication.meta?.claims?.['Communication.recipient'] || '').trim();
    const recipientEmail = String(endpoint.address).slice('mailto:'.length);
    if (!recipient || !recipientEmail) throw new ManagerError('AppointmentResponse recipient email delivery is not configured.', IssueType.Invalid);
    const result = await this.deps.notificationManager.sendEmail({
      to: recipientEmail, subject: 'Appointment response', text: String(communication.meta.claims['Communication.text']),
      metadata: { appointmentResponse: `AppointmentResponse/${resource.id}`, appointment: claims['AppointmentResponse.appointment'][0], recipient, language: 'en' },
    });
    return { communication, email: result };
  }

  /**
   * Applies protected exact-match filters first. Standard date prefixes are
   * then evaluated inclusively against decrypted candidate claims because an
   * encrypted equality index cannot represent FHIR `ge`/`le` ordering.
   */
  private async search(job: JobRequest): Promise<IDecodedDidcommPayload> {
    const rawClaims = entries(job)[0]?.resource?.meta?.claims ?? {};
    const normalized = normalizeSchedulingInput({ resourceType: this.deps.resourceType, id: 'search', meta: { claims: rawClaims } });
    const { vaultId, collectionName } = await storage(this.deps, job);
    const dateClaim = dateSearchClaimByResource[this.deps.resourceType];
    const dateRange = dateClaim ? parseInclusiveDateRange(normalized.meta.claims[dateClaim] ?? [], dateClaim) : undefined;
    const requested = Object.entries(normalized.meta.claims).flatMap(([name, values]) =>
      name === dateClaim && dateRange
        ? []
        : values.map(value => ({ name, value })));
    const protectedFilters = await this.deps.kms.protectAttributesNameAndValue(requested as any, vaultId);
    const sectionId = resolveSchedulingSection(job, this.deps.resourceType, normalized.meta.claims);
    const records = await this.deps.repository.listContainersInSection<ConfidentialStorageDoc>(collectionName, sectionId);
    const matching = records.filter(record => protectedFilters.every(filter => record.indexed?.attributes?.some(attribute => attribute.name === filter.name && attribute.value === filter.value)));
    const data = [];
    for (const record of matching) {
      const content = await this.deps.kms.unprotectConfidentialData<unknown>(record, vaultId);
      const resource = readSchedulingResourceContent(content, this.deps.resourceType, record.id);
      if (!resource) throw new ManagerError(`Historical ${this.deps.resourceType} requires an explicit recoverable migration.`, IssueType.Invalid);
      if (dateRange && dateClaim && !dateRangeMatches(resource.meta.claims[dateClaim], dateRange)) continue;
      data.push({ type: `${this.deps.resourceType}-search-response-v1.0`, response: { status: String(HttpStatusCodes.Ok) }, resource });
    }
    return response(job, 'searchset', data);
  }
}

function normalizeSchedulingInput(input: unknown) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return normalizeSchedulingFlatClaimsResource(input);
  }
  const resource = input as Record<string, any>;
  const claims = resource.meta?.claims;
  if (!claims || typeof claims !== 'object' || Array.isArray(claims)) {
    return normalizeSchedulingFlatClaimsResource(input);
  }
  const { '@context': _context, ...flatClaims } = claims as Record<string, unknown>;
  return normalizeSchedulingFlatClaimsResource({
    ...resource,
    meta: { ...resource.meta, claims: flatClaims },
  });
}

function resolveSchedulingSection(
  job: JobRequest,
  resourceType: SchedulingResourceType,
  claims: Readonly<Record<string, readonly string[]>>,
): string {
  if (resourceType !== 'Appointment' || String(job.section) !== 'individual') {
    return sectionByResource[resourceType];
  }
  const subject = String(
    claims['Appointment.subject']?.[0]
      || claims['Appointment.patient']?.[0]
      || '',
  ).trim();
  if (!subject) {
    throw new ManagerError(
      'Appointment.subject is required for individual scheduling.',
      IssueType.Required,
    );
  }
  return getSubjectScopedSectionId(subject, SUBJECT_SECTION_INDIVIDUAL, 'appointments');
}

type InclusiveDateRange = Readonly<{ from: number; to: number }>;

const dateSearchClaimByResource: Readonly<Partial<Record<SchedulingResourceType, string>>> = Object.freeze({
  Slot: 'Slot.start',
  Appointment: 'Appointment.date',
  AppointmentResponse: 'AppointmentResponse._lastUpdated',
});

function parseInclusiveDateRange(values: readonly string[], claimName: string): InclusiveDateRange | undefined {
  if (!values.some(value => /^(?:ge|le)/.test(value))) return undefined;
  const fromRaw = values.find(value => value.startsWith('ge'))?.slice(2);
  const toRaw = values.find(value => value.startsWith('le'))?.slice(2);
  const from = Date.parse(String(fromRaw || '')); const to = Date.parse(String(toRaw || ''));
  if (!Number.isFinite(from) || !Number.isFinite(to) || from > to || values.length !== 2) {
    throw new ManagerError(`${claimName} requires one inclusive ge and one inclusive le value.`, IssueType.Invalid);
  }
  return { from, to };
}

/** Rehydrates canonical claims and reads the former nested shape only for an explicit recoverable migration. */
function readSchedulingResourceContent(content: unknown, resourceType: SchedulingResourceType, id: string) {
  if (!content || typeof content !== 'object' || Array.isArray(content)) return undefined;
  const value = content as Record<string, unknown>;
  if (value.resource) {
    try { return normalizeSchedulingFlatClaimsResource(value.resource); } catch { return undefined; }
  }
  if (value.claims && typeof value.claims === 'object' && !Array.isArray(value.claims)) {
    try { return normalizeSchedulingFlatClaimsResource({ resourceType, id, meta: { claims: value.claims } }); } catch { return undefined; }
  }
  return undefined;
}

function dateRangeMatches(raw: unknown, range: InclusiveDateRange): boolean {
  const value = Array.isArray(raw) ? raw[0] : raw;
  const timestamp = Date.parse(String(value || ''));
  return Number.isFinite(timestamp) && timestamp >= range.from && timestamp <= range.to;
}

const entries = (job: JobRequest): any[] => {
  const body = job.content?.body as any;
  return Array.isArray(body?.data) ? body.data : Array.isArray(body?.entry) ? body.entry : [];
};

async function storage(deps: SchedulingManagerDependencies, job: JobRequest) {
  const vaultId = getTenantVaultId(String(job.sector), String(job.tenantId));
  const collectionName = await deps.tenantManager.getCollectionName(vaultId);
  if (!collectionName) throw new ManagerError('Scheduling tenant collection was not found.', IssueType.NotFound);
  return { vaultId, collectionName };
}

function response(job: JobRequest, type: string, data: unknown[]): IDecodedDidcommPayload {
  return { jti: randomUUID(), thid: String(job.content?.thid), type: `org.hl7.fhir.api.${type}`, iss: job.content?.aud as string, aud: job.content?.iss as string, body: { resourceType: 'Bundle', type, total: data.length, data } };
}

function errorEntry(resourceType: string, error: unknown) {
  return { type: resourceType, response: { status: String(HttpStatusCodes.BadRequest), outcome: createOperationOutcome(IssueLevel.Error, error instanceof ManagerError ? error.code : IssueType.Invalid, error instanceof Error ? error.message : String(error)) } };
}
