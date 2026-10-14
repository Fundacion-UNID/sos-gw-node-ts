import { v4 as uuidv4 } from 'uuid';
import type { IDecodedDidcommPayload } from 'gdc-common-utils-ts/models/confidential-message';
import type { JobRequest } from 'gdc-common-utils-ts/models/confidential-job';
import type { BundleEntry, BundleEntryRequest, BundleJsonApi, ErrorEntry } from 'gdc-common-utils-ts/models/bundle';
import type { ClaimsRecord } from 'gdc-common-utils-ts/models/resource-document';
import { IssueLevel, IssueType } from 'gdc-common-utils-ts/models/issue';
import { TaskClaimsFhirApi } from 'gdc-common-utils-ts/models/interoperable-claims/task-claims';
import { determineResourceId } from '../utils/resource';
import { getBundleResponseTypeForAction } from '../utils/bundle';
import { createOperationOutcome } from '../utils/outcome';
import { getTenantVaultId } from '../utils/tenant';
import type { IJobProcessor } from './registry';
import type { CreateTaskInput, TaskRecord, TaskService } from 'tasks-core-node-ts';
import type { ITenantsManager } from './ITenantsManager';
import { GatewayResponseEntryTypes } from '../shared/gateway-response-types';
import { canonicalizeBundleEntryMetadata } from '../utils/canonical-entry-metadata';
import { buildSearchResponseEntries } from '../utils/didcomm-response';
import { TaskClaim } from 'sos-data-utils-ts/task-artifact-schema';

const LEGACY_CONTEXT = 'org.schema';
const FHIR_CONTEXT = 'org.hl7.fhir.api';

const CLAIM_KEYS = {
  id: ['id', TaskClaimsFhirApi.Id],
  status: ['status', TaskClaimsFhirApi.Status],
  subject: ['subject', 'subject-reference', TaskClaim.For, TaskClaimsFhirApi.Subject],
  owner: ['owner', 'owner-reference', TaskClaimsFhirApi.Owner],
  focus: ['focus', 'focus-reference', TaskClaimsFhirApi.Focus],
  partOf: ['part-of', TaskClaimsFhirApi.PartOf],
  basedOn: ['based-on', TaskClaimsFhirApi.BasedOn],
  language: ['language', TaskClaimsFhirApi.Language],
  basedOnDisplay: ['based-on-display', TaskClaimsFhirApi.BasedOnDisplay],
  retryIntervalMinutes: ['timing-repeat-offset', 'retry-interval-minutes', TaskClaimsFhirApi.RetryIntervalMinutes, 'restriction-gap-min'],
  maxAttempts: ['max-attempts', TaskClaimsFhirApi.MaxAttempts, 'restriction-repetitions'],
  scheduledAt: ['execution-period-start', 'restriction-period-start', TaskClaimsFhirApi.ScheduledAt],
  executionPeriodEnd: ['execution-period-end'],
  repetitions: ['repetitions'],
  daysOfWeek: ['days-of-week'],
  repeatCount: ['repeat-count'],
  repeatDurationValue: ['repeat-duration-value'],
  repeatDurationUnit: ['repeat-duration-unit'],
  triggerType: ['trigger-type', TaskClaimsFhirApi.TriggerType],
  attempt: ['attempt', TaskClaimsFhirApi.Attempt],
  windowStart: ['window-start', TaskClaimsFhirApi.WindowStart],
  windowEnd: ['window-end', TaskClaimsFhirApi.WindowEnd],
  channel: ['channel', 'Task.channel'],
  autoCloseAt: ['auto-close-at', TaskClaimsFhirApi.AutoCloseAt],
  escalationRecipient: ['escalation-recipient', TaskClaimsFhirApi.EscalationRecipient],
  modified: ['modified'],
  priority: ['priority'],
  confirmed: ['confirmed', TaskClaimsFhirApi.Confirmed],
} as const;

const DURATION_UNITS = new Set(['ms', 's', 'min', 'h', 'd', 'wk', 'mo', 'a']);
const PASSTHROUGH_METADATA_PREFIXES = ['uhc-reminder-permission', 'org.schema.Organization.', 'Organization.'] as const;
const PASSTHROUGH_METADATA_KEYS = new Set([
  'subject-phone',
  'owner-phone',
  'voice-to',
  'controller-email',
  'Task.controller-email',
]);
const DIRECT_FHIR_TASK_STATUSES = new Set(['requested', 'active', 'cancelled', 'entered-in-error']);

function claimString(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  const normalized = String(value).trim();
  return normalized || undefined;
}

function claimBoolean(value: unknown): boolean | undefined {
  if (value === undefined || value === null) return undefined;
  const normalized = String(value).trim().toLowerCase();
  if (normalized === 'true' || normalized === '1' || normalized === 'yes') return true;
  if (normalized === 'false' || normalized === '0' || normalized === 'no') return false;
  return undefined;
}

function claimFirst(claims: ClaimsRecord, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const value = claimString(claims[key]);
    if (value) return value;
  }
  return undefined;
}

function claimCsvFirst(claims: ClaimsRecord, keys: readonly string[]): string | undefined {
  const value = claimFirst(claims, keys);
  if (!value) return undefined;
  return value.split(',').map((part) => part.trim()).filter(Boolean)[0];
}

function normalizeDurationUnit(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const normalized = value.trim();
  if (!normalized) return undefined;
  if (!DURATION_UNITS.has(normalized)) {
    throw new Error(`Invalid repeat-duration-unit '${normalized}'. Expected one of: ${Array.from(DURATION_UNITS).join(', ')}`);
  }
  return normalized;
}

function copySupplementalMetadataClaims(
  metadata: Record<string, string>,
  claims: ClaimsRecord,
): void {
  // Preserve UHC/UNID operational claims that do not map to the generic task
  // schema but must survive `_batch` ingestion for reminder routing, actor/channel
  // permission gating, and contact resolution at runtime.
  for (const [key, rawValue] of Object.entries(claims || {})) {
    const value = claimString(rawValue);
    if (!value) continue;
    if (PASSTHROUGH_METADATA_KEYS.has(key)) {
      metadata[key] = value;
      continue;
    }
    if (PASSTHROUGH_METADATA_PREFIXES.some((prefix) => key.startsWith(prefix))) {
      metadata[key] = value;
    }
  }
}

function buildTaskClaims(task: TaskRecord): ClaimsRecord {
  const claims: ClaimsRecord = {
    '@context': FHIR_CONTEXT,
    [TaskClaimsFhirApi.Id]: task.id,
    [TaskClaimsFhirApi.Status]: task.status,
    [TaskClaimsFhirApi.Subject]: task.subjectId,
    [TaskClaimsFhirApi.Channel]: task.channels.join(','),
    [TaskClaimsFhirApi.AuthoredOn]: task.createdAt,
  } as ClaimsRecord;

  if (task.metadata.owner) {
    claims[TaskClaimsFhirApi.Owner] = task.metadata.owner;
  }
  if (task.metadata.focus) {
    claims[TaskClaimsFhirApi.Focus] = task.metadata.focus;
  }
  if (task.metadata['part-of']) {
    claims[TaskClaimsFhirApi.PartOf] = task.metadata['part-of'];
  }
  if (task.metadata['based-on']) {
    claims[TaskClaimsFhirApi.BasedOn] = task.metadata['based-on'];
  }
  if (task.metadata.language) {
    claims[TaskClaimsFhirApi.Language] = task.metadata.language;
  }
  if (task.metadata['based-on-display']) {
    claims[TaskClaimsFhirApi.BasedOnDisplay] = task.metadata['based-on-display'];
  }
  if (task.metadata['retry-interval-minutes']) {
    claims[TaskClaimsFhirApi.RetryIntervalMinutes] = task.metadata['retry-interval-minutes'];
  }
  if (task.metadata['max-attempts']) {
    claims[TaskClaimsFhirApi.MaxAttempts] = task.metadata['max-attempts'];
  }
  if (task.scheduledFor) {
    claims[TaskClaimsFhirApi.ScheduledAt] = task.scheduledFor;
  }
  if (task.metadata['execution-period-end']) claims[TaskClaimsFhirApi.ExecutionPeriodEnd] = task.metadata['execution-period-end'];
  if (task.metadata['restriction-period-start']) claims[TaskClaimsFhirApi.RestrictionPeriodStart] = task.metadata['restriction-period-start'];
  if (task.metadata['restriction-period-end']) claims[TaskClaimsFhirApi.RestrictionPeriodEnd] = task.metadata['restriction-period-end'];
  if (task.metadata.repetitions) claims[TaskClaimsFhirApi.Repetitions] = task.metadata.repetitions;
  if (task.metadata['days-of-week']) claims[TaskClaimsFhirApi.DaysOfWeek] = task.metadata['days-of-week'];
  if (task.metadata['repeat-count']) claims[TaskClaimsFhirApi.RepeatCount] = task.metadata['repeat-count'];
  if (task.metadata['repeat-duration-value']) claims[TaskClaimsFhirApi.RepeatDurationValue] = task.metadata['repeat-duration-value'];
  if (task.metadata['repeat-duration-unit']) claims[TaskClaimsFhirApi.RepeatDurationUnit] = task.metadata['repeat-duration-unit'];
  if (task.metadata.priority) claims[TaskClaimsFhirApi.Priority] = task.metadata.priority;
  if (task.metadata.modified) claims[TaskClaimsFhirApi.Modified] = task.metadata.modified;
  if (task.metadata['trigger-type']) {
    claims[TaskClaimsFhirApi.TriggerType] = task.metadata['trigger-type'];
  }
  if (task.metadata.attempt) {
    claims[TaskClaimsFhirApi.Attempt] = task.metadata.attempt;
  }
  if (task.metadata['window-start']) {
    claims[TaskClaimsFhirApi.WindowStart] = task.metadata['window-start'];
  }
  if (task.metadata['window-end']) {
    claims[TaskClaimsFhirApi.WindowEnd] = task.metadata['window-end'];
  }
  if (task.metadata.confirmed) {
    claims[TaskClaimsFhirApi.Confirmed] = task.metadata.confirmed;
  }
  if (task.acknowledgedAt) claims[TaskClaimsFhirApi.ConfirmedAt] = task.acknowledgedAt;
  if (task.metadata['auto-close-at']) {
    claims[TaskClaimsFhirApi.AutoCloseAt] = task.metadata['auto-close-at'];
  }
  if (task.metadata['escalation-recipient']) {
    claims[TaskClaimsFhirApi.EscalationRecipient] = task.metadata['escalation-recipient'];
  }
  for (const [key, rawValue] of Object.entries(task.metadata)) {
    const value = claimString(rawValue);
    if (!value) continue;
    if (PASSTHROUGH_METADATA_KEYS.has(key)
      || PASSTHROUGH_METADATA_PREFIXES.some((prefix) => key.startsWith(prefix))) {
      claims[key] = value;
    }
  }
  return claims;
}

function buildTaskResource(task: TaskRecord): Record<string, unknown> {
  return {
    resourceType: 'Task',
    id: task.id,
    status: task.status,
    description: task.description ?? task.title,
    authoredOn: task.createdAt,
    meta: { claims: buildTaskClaims(task) },
  };
}

export class TaskManager implements IJobProcessor {
  private readonly taskService: TaskService;
  private readonly tenantsCacheManager: ITenantsManager;

  constructor(options: { taskService: TaskService; tenantsCacheManager: ITenantsManager }) {
    this.taskService = options.taskService;
    this.tenantsCacheManager = options.tenantsCacheManager;
  }

  async process(job: JobRequest): Promise<IDecodedDidcommPayload> {
    if (!job.content) throw new Error('Job content is missing');
    const entries = job.content.body?.data ?? [];
    const responseEntries: (BundleEntry | ErrorEntry)[] = [];
    const vaultId = job.tenantId === 'host' ? 'host' : getTenantVaultId(job.sector as string, job.tenantId as string);
    const issuer = await this.tenantsCacheManager.getTenantIdentifierUrn(vaultId)
      || await this.tenantsCacheManager.getTenantDid(vaultId);
    if (!issuer) throw new Error(`Tenant with ID '${job.tenantId}' not found.`);

    const context = {
      tenantId: String(job.tenantId || '').trim(),
      jurisdiction: String(job.jurisdiction || '').trim().toUpperCase(),
      sector: String(job.sector || '').trim(),
      format: String(job.format || '').trim(),
    };

    if (job.action === '_search') {
      const claims = ((entries[0] as any)?.resource?.meta?.claims || {}) as ClaimsRecord;
      const subjectId = claimFirst(claims, CLAIM_KEYS.subject);
      if (!subjectId) throw new Error('Task.subject is required for search.');
      const status = claimFirst(claims, CLAIM_KEYS.status) as any;
      const tasks = await this.taskService.listTasks({ subjectId, ...(status ? { status } : {}) });
      const rows = tasks.map((task) => ({
        id: task.id,
        meta: { claims: buildTaskClaims(task) },
        resource: buildTaskResource(task),
      }));
      const data = buildSearchResponseEntries(GatewayResponseEntryTypes.BundleSearch, rows);
      return {
        jti: uuidv4(),
        thid: job.content.thid as string,
        iss: issuer,
        aud: job.content.aud as string,
        exp: Math.floor(Date.now() / 1000) + 300,
        type: 'search-response',
        body: {
          resourceType: 'Bundle',
          type: 'searchset',
          total: data.length,
          data,
        },
      };
    }

    for (const rawEntry of entries) {
      const entry = rawEntry as BundleEntryRequest;
      try {
        const task = await this.processEntry(entry, context);
        responseEntries.push({
          id: task.id,
          type: 'Task',
          response: { status: '200' },
          resource: { ...buildTaskResource(task), meta: { claims: buildTaskClaims(task) } } as any,
        });
      } catch (error: any) {
        responseEntries.push({
          id: determineResourceId(
            claimFirst((entry.resource?.meta?.claims as any) || {}, CLAIM_KEYS.id) || uuidv4(),
            process.env.NODE_ENV,
          ),
          type: 'OperationOutcome',
          ...canonicalizeBundleEntryMetadata(entry.meta as Record<string, unknown> | undefined),
          response: {
            status: '500',
            outcome: createOperationOutcome(IssueLevel.Error, IssueType.Exception, error.message || 'Unknown task processing error.'),
          },
        } as ErrorEntry);
      }
    }

    const responseBundle: BundleJsonApi = {
      resourceType: 'Bundle',
      total: responseEntries.length,
      type: getBundleResponseTypeForAction(job.action),
      data: responseEntries as any,
    };

    return {
      jti: uuidv4(),
      thid: job.content.thid as string,
      iss: issuer,
      aud: job.content.aud as string,
      exp: Math.floor(Date.now() / 1000) + 300,
      type: 'batch-response',
      body: responseBundle,
    };
  }

  private async processEntry(
    entry: BundleEntryRequest,
    context: { tenantId: string; jurisdiction: string; sector: string; format: string },
  ): Promise<TaskRecord> {
    const claims = entry.resource?.meta?.claims as ClaimsRecord | undefined;
    if (!entry.request || !claims) {
      throw new Error('Task entry requires request and resource.meta.claims.');
    }
    const resource = ((entry as any).resource || {}) as Record<string, unknown>;
    const method = String(entry.request.method || 'POST').toUpperCase();
    const taskId = claimFirst(claims, CLAIM_KEYS.id) || claimString(resource.id);

    if (method === 'POST') {
      const created = await this.taskService.createTask(this.toCreateTaskInput(claims, resource, context));
      const scheduledAt = claimCsvFirst(claims, CLAIM_KEYS.scheduledAt);
      if (scheduledAt) {
        return this.taskService.scheduleTask({ taskId: created.id, scheduledFor: scheduledAt });
      }
      return created;
    }

    if (!taskId) {
      throw new Error('Task.id is required for non-POST operations.');
    }

    if (method === 'PATCH' || method === 'PUT') {
      // Update the human-facing fields first so web and voice do not maintain
      // separate task descriptions. Lifecycle transitions below remain the
      // authority for acknowledged/completed/cancelled states.
      const current = await this.taskService.getTask(taskId);
      if (!current) throw new Error(`Task ${taskId} was not found.`);
      const incoming = this.toCreateTaskInput(claims, resource, context);
      if (incoming.subjectId && incoming.subjectId !== current.subjectId) {
        throw new Error('Task.subject cannot be changed during an update.');
      }
      const updated = await this.taskService.getRepository().save({
        ...current,
        title: incoming.title || current.title,
        description: incoming.description || current.description,
        channels: incoming.channels?.length ? incoming.channels : current.channels,
        dueAt: incoming.dueAt || current.dueAt,
        metadata: { ...current.metadata, ...(incoming.metadata || {}) },
        updatedAt: new Date().toISOString(),
      });
      const requestedStatus = claimFirst(claims, CLAIM_KEYS.status);
      const confirmed = claimBoolean(claimFirst(claims, CLAIM_KEYS.confirmed));
      if (confirmed === true || requestedStatus === 'acknowledged') {
        const acknowledged = await this.taskService.acknowledgeTask(taskId);
        const finalStatus = requestedStatus;
        if (finalStatus === 'completed' || finalStatus === 'cancelled') {
          return this.taskService.closeTask({
            taskId,
            status: finalStatus,
            reason: claimString((resource as any).note) || 'Confirmed by asynchronous task flow',
          });
        }
        return acknowledged;
      }

      // The portal uses the standard FHIR Task lifecycle independently from
      // acknowledgement-driven reminder execution. Preserve these states on
      // the same auditable record so deactivate/reactivate/delete readback is
      // deterministic instead of silently retaining the previous status.
      if (requestedStatus && DIRECT_FHIR_TASK_STATUSES.has(requestedStatus)
        && requestedStatus !== updated.status) {
        return this.taskService.getRepository().save({
          ...updated,
          status: requestedStatus as any,
          ...(requestedStatus === 'cancelled' || requestedStatus === 'entered-in-error'
            ? { closedAt: new Date().toISOString() }
            : { closedAt: undefined, closureReason: undefined }),
          updatedAt: new Date().toISOString(),
        });
      }

      const scheduledAt = claimCsvFirst(claims, CLAIM_KEYS.scheduledAt);
      if (scheduledAt) {
        return this.taskService.scheduleTask({ taskId, scheduledFor: scheduledAt });
      }
      return updated;
    }

    if (method === 'DELETE') {
      return this.taskService.closeTask({ taskId, status: 'cancelled', reason: 'Deleted by request' });
    }

    throw new Error(`Unsupported Task request method '${method}'.`);
  }

  private toCreateTaskInput(
    claims: ClaimsRecord,
    resource: Record<string, unknown>,
    context: { tenantId: string; jurisdiction: string; sector: string; format: string },
  ): CreateTaskInput {
    const metadata: Record<string, string> = {};
    const owner = claimFirst(claims, CLAIM_KEYS.owner);
    const focus = claimFirst(claims, CLAIM_KEYS.focus);
    const partOf = claimFirst(claims, CLAIM_KEYS.partOf);
    const basedOn = claimFirst(claims, CLAIM_KEYS.basedOn);
    const language = claimFirst(claims, CLAIM_KEYS.language);
    const basedOnDisplay = claimFirst(claims, CLAIM_KEYS.basedOnDisplay);
    const retryIntervalMinutes = claimFirst(claims, CLAIM_KEYS.retryIntervalMinutes);
    const maxAttempts = claimFirst(claims, CLAIM_KEYS.maxAttempts);
    const scheduledAt = claimCsvFirst(claims, CLAIM_KEYS.scheduledAt);
    const triggerType = claimFirst(claims, CLAIM_KEYS.triggerType);
    const attempt = claimFirst(claims, CLAIM_KEYS.attempt);
    const windowStart = claimFirst(claims, CLAIM_KEYS.windowStart);
    const windowEnd = claimFirst(claims, CLAIM_KEYS.windowEnd);
    const autoCloseAt = claimFirst(claims, CLAIM_KEYS.autoCloseAt);
    const escalationRecipient = claimFirst(claims, CLAIM_KEYS.escalationRecipient);
    const confirmed = claimFirst(claims, CLAIM_KEYS.confirmed);
    const repetitionListStart = claimFirst(claims, ['restriction-period-start']);
    const repetitionListEnd = claimFirst(claims, ['restriction-period-end']);
    const executionPeriodEnd = claimFirst(claims, ['execution-period-end']);
    const repetitions = claimFirst(claims, CLAIM_KEYS.repetitions);
    const daysOfWeek = claimFirst(claims, CLAIM_KEYS.daysOfWeek);
    const repeatCount = claimFirst(claims, CLAIM_KEYS.repeatCount);
    const repeatDurationValue = claimFirst(claims, CLAIM_KEYS.repeatDurationValue);
    const repeatDurationUnit = normalizeDurationUnit(claimFirst(claims, CLAIM_KEYS.repeatDurationUnit));
    const modified = claimFirst(claims, CLAIM_KEYS.modified);
    const priority = claimFirst(claims, CLAIM_KEYS.priority);

    const timingTiming = claims.timingTiming as any;
    const fallbackRepeatCount = claimString(timingTiming?.repeat?.count);
    const fallbackRepeatDurationValue = claimString(timingTiming?.repeat?.duration);
    const fallbackRepeatDurationUnit = normalizeDurationUnit(claimString(timingTiming?.repeat?.durationUnit));

    if (owner) metadata.owner = owner;
    if (focus) metadata.focus = focus;
    if (partOf) metadata['part-of'] = partOf;
    if (basedOn) metadata['based-on'] = basedOn;
    if (!focus && basedOn) {
      const first = basedOn.split(',').map((part) => part.trim()).filter(Boolean)[0];
      if (first) metadata.focus = first;
    }
    if (language) metadata.language = language;
    if (basedOnDisplay) metadata['based-on-display'] = basedOnDisplay;
    if (scheduledAt) metadata['event-at'] = scheduledAt;
    if (retryIntervalMinutes) metadata['retry-interval-minutes'] = retryIntervalMinutes;
    if (maxAttempts) metadata['max-attempts'] = maxAttempts;
    if (triggerType) metadata['trigger-type'] = triggerType;
    if (attempt) metadata.attempt = attempt;
    if (windowStart) metadata['window-start'] = windowStart;
    if (windowEnd) metadata['window-end'] = windowEnd;
    if (autoCloseAt) metadata['auto-close-at'] = autoCloseAt;
    if (escalationRecipient) metadata['escalation-recipient'] = escalationRecipient;
    if (confirmed) metadata.confirmed = confirmed;
    if (repetitionListStart) metadata['restriction-period-start'] = repetitionListStart;
    if (repetitionListEnd) metadata['restriction-period-end'] = repetitionListEnd;
    if (executionPeriodEnd) metadata['execution-period-end'] = executionPeriodEnd;
    if (repetitions) metadata.repetitions = repetitions;
    if (daysOfWeek) metadata['days-of-week'] = daysOfWeek;
    if (repeatCount || fallbackRepeatCount) metadata['repeat-count'] = repeatCount || fallbackRepeatCount || '';
    if (repeatDurationValue || fallbackRepeatDurationValue) metadata['repeat-duration-value'] = repeatDurationValue || fallbackRepeatDurationValue || '';
    if (repeatDurationUnit || fallbackRepeatDurationUnit) metadata['repeat-duration-unit'] = repeatDurationUnit || fallbackRepeatDurationUnit || '';
    if (modified) metadata.modified = modified;
    if (priority) metadata.priority = priority;
    if (context.tenantId) metadata['tenant-id'] = context.tenantId;
    if (context.jurisdiction) metadata.jurisdiction = context.jurisdiction;
    if (context.sector) metadata.sector = context.sector;
    if (context.format) metadata.format = context.format;
    copySupplementalMetadataClaims(metadata, claims);

    return {
      id: claimFirst(claims, CLAIM_KEYS.id) || claimString(resource.id),
      subjectId: claimFirst(claims, CLAIM_KEYS.subject) || claimString((resource as any).for?.reference) || '',
      title: claimString((resource as any).title) || claimString((resource as any).description) || 'Care task',
      description: claimString((resource as any).description),
      channels: claimFirst(claims, CLAIM_KEYS.channel)?.split(',').map((value) => value.trim()).filter(Boolean),
      dueAt: claimFirst(claims, CLAIM_KEYS.autoCloseAt),
      metadata,
      status: (claimFirst(claims, CLAIM_KEYS.status) as any) || 'active',
    };
  }
}
