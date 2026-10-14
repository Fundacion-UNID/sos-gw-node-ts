// Copyright 2025 Connecting Solution & Applications Ltd under the Apache License, Version 2.0.

import * as express from 'express';
import type { IPhoneAdapter } from '../adapters/phone/IPhoneAdapter.js';
import type { TaskService } from 'tasks-core-node-ts';
import { getVoiceBundle, getVoiceReminderCountIntro, getVoiceSystemText, resolveVoiceLocale } from '../locales/voice/index.js';
import type { VoiceTaskType, VoiceTimingState } from '../locales/voice/types.js';
import { UhcTaskOrchestrator } from '../services/UhcTaskOrchestrator.js';
import type { NotificationManager } from '../services/notifications/NotificationManager.js';
import {
  UhcReminderActions,
  UhcReminderActorKinds,
  UhcReminderChannels,
  UhcReminderEntityKinds,
  decodeUhcReminderPermissionBundle,
  evaluateUhcReminderRuntimeAccess,
} from 'uhc-sdk-core-ts/reminder-permissions';

type ReminderLogEvent = {
  at: string;
  type:
    | 'task-created'
    | 'task-updated'
    | 'voice-call-started'
    | 'voice-dtmf-received'
    | 'voice-no-input'
    | 'voice-status';
  taskId: string;
  details: Record<string, unknown>;
};

const reminderLogs: ReminderLogEvent[] = [];
const FORWARDED_HEADER_SEPARATOR = ',';

function pushLog(event: ReminderLogEvent): void {
  reminderLogs.push(event);
  if (reminderLogs.length > 2000) {
    reminderLogs.splice(0, reminderLogs.length - 2000);
  }
}

function xmlEscape(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function getRequestBaseUrl(req: express.Request, fallback: string): string {
  const forwardedProto = req.headers['x-forwarded-proto'];
  const forwardedHost = req.headers['x-forwarded-host'];
  const forwardedProtocol = (Array.isArray(forwardedProto) ? forwardedProto[0] : forwardedProto)
    ?.split(FORWARDED_HEADER_SEPARATOR)[0]
    ?.trim();
  const socketEncrypted = (req.socket as { encrypted?: boolean } | undefined)?.encrypted;
  const protocol = forwardedProtocol || (socketEncrypted ? 'https' : 'http');
  const host = (Array.isArray(forwardedHost) ? forwardedHost[0] : forwardedHost) || req.get('host');
  return host ? `${protocol}://${host}` : fallback;
}

function buildMountedUrl(req: express.Request, fallbackBaseUrl: string, relativePath: string): string {
  const base = getRequestBaseUrl(req, fallbackBaseUrl).replace(/\/$/, '');
  const mountPath = String(req.baseUrl || '').replace(/\/$/, '');
  const path = relativePath.startsWith('/') ? relativePath : `/${relativePath}`;
  return `${base}${mountPath}${path}`;
}

function sanitizeVoiceName(value: string | undefined): string {
  const voice = String(value || '').trim();
  if (!voice) return 'alice';
  // Defensive: keep XML-safe plain token values only.
  if (!/^[A-Za-z0-9._-]+$/.test(voice)) return 'alice';
  return voice;
}

function resolveTaskType(value: string | undefined, focus: string | undefined): VoiceTaskType {
  const normalized = String(value || '').trim().toLowerCase();
  const normalizedFocus = String(focus || '').trim().toLowerCase();
  if (normalized === 'appointment' || normalizedFocus.startsWith('appointment/')) return 'appointment';
  if (normalized === 'medication' || normalizedFocus.startsWith('medicationstatement/')) return 'medication';
  return 'generic';
}

function parseIsoDate(value: string | undefined): Date | undefined {
  if (!value) return undefined;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return undefined;
  return parsed;
}

function resolveTimingState(eventTime: Date | undefined): VoiceTimingState {
  if (!eventTime) return 'due_or_past';
  return eventTime.getTime() > Date.now() ? 'future' : 'due_or_past';
}

function toSpokenTimeLabel(value: Date | undefined, locale: 'es-ES' | 'en-US'): string | undefined {
  if (!value) return undefined;
  return new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' }).format(value);
}

function parseCsvValues(raw: string | undefined): string[] {
  return String(raw || '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
}

function normalizeResourceReferenceLabel(reference: string | undefined): string | undefined {
  const ref = String(reference || '').trim();
  if (!ref) return undefined;
  const slash = ref.lastIndexOf('/');
  const tail = slash >= 0 ? ref.slice(slash + 1) : ref;
  return tail || ref;
}

function resolveBasedOnContext(taskMetadata: Record<string, unknown>): {
  references: string[];
  displays: string[];
  index: number;
  currentReference?: string;
  currentDisplay?: string;
} {
  const references = parseCsvValues(String(
    taskMetadata['based-on']
      || taskMetadata['Task.based-on']
      || taskMetadata['focus']
      || '',
  ));
  const displays = parseCsvValues(String(taskMetadata['based-on-display'] || taskMetadata['Task.based-on-display'] || ''));
  const rawIndex = parseInt(String(taskMetadata['based-on-index'] || '0'), 10);
  const boundedIndex = Number.isFinite(rawIndex) ? Math.max(0, rawIndex) : 0;
  const index = references.length > 0 ? Math.min(boundedIndex, references.length - 1) : 0;
  const currentReference = references[index];
  const currentDisplay = displays[index] || normalizeResourceReferenceLabel(currentReference);
  return {
    references,
    displays,
    index,
    currentReference,
    currentDisplay,
  };
}

function resolveSubjectAlias(taskMetadata: Record<string, unknown>): string {
  const alternateName = String(
    taskMetadata['org.schema.Organization.alternateName']
      || taskMetadata['Organization.alternateName']
      || '',
  ).trim();
  if (alternateName) return alternateName;
  return String(
    taskMetadata['org.schema.Organization.name']
      || taskMetadata['Organization.name']
      || '',
  ).trim();
}

function normalizePartOfReference(value: string | undefined): string | undefined {
  const raw = String(value || '').trim();
  if (!raw) return undefined;
  return raw.startsWith('Task/') ? raw.slice('Task/'.length) : raw;
}

function parseTakenTimeDigits(raw: string): { hour: number; minute: number; needsMeridiem: boolean } | undefined {
  const digits = String(raw || '').trim().replace(/\D/g, '');
  if (!(digits.length === 3 || digits.length === 4)) return undefined;
  const normalized = digits.length === 3 ? `0${digits}` : digits;
  const hour = parseInt(normalized.slice(0, 2), 10);
  const minute = parseInt(normalized.slice(2, 4), 10);
  if (!Number.isFinite(hour) || !Number.isFinite(minute) || minute < 0 || minute > 59) return undefined;
  if (hour >= 0 && hour <= 23) {
    const needsMeridiem = hour >= 1 && hour <= 12;
    return { hour, minute, needsMeridiem };
  }
  return undefined;
}

function formatSummaryTimestamp(value: string | undefined): string {
  const iso = String(value || '').trim();
  if (!iso) return '-';
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return iso;
  return dt.toISOString();
}

type ReminderCallSummary = {
  overall: 'completed' | 'partial-max-retries-reached' | 'in-progress';
  markdown: string;
};

function buildCallSummary(taskId: string, tasks: any[], logs: ReminderLogEvent[]): ReminderCallSummary {
  const rootTask = tasks.find((task) => task.id === taskId);
  if (!rootTask) {
    return {
      overall: 'in-progress',
      markdown: `# Call Summary\n\nTask not found: \`${taskId}\`\n`,
    };
  }

  const childTasks = tasks
    .filter((task) => normalizePartOfReference(task.metadata?.['part-of']) === taskId)
    .sort((left, right) => String(left.createdAt || left.id).localeCompare(String(right.createdAt || right.id)));
  const scopedTasks = childTasks.length > 0 ? childTasks : [rootTask];
  const scopedTaskIds = new Set(scopedTasks.map((task) => task.id));
  const scopedLogs = logs.filter((entry) => scopedTaskIds.has(entry.taskId));

  const latestTaskUpdatedById = new Map<string, ReminderLogEvent>();
  const latestVoiceStatusById = new Map<string, ReminderLogEvent>();
  for (const entry of scopedLogs) {
    if (entry.type === 'task-updated') latestTaskUpdatedById.set(entry.taskId, entry);
    if (entry.type === 'voice-status') latestVoiceStatusById.set(entry.taskId, entry);
  }

  const statuses = scopedTasks.map((task) => String(task.status || '').trim());
  const allResolved = statuses.every((status) => isResolvedStatus(status));
  const unresolvedAtMax = scopedTasks.some((task) => {
    if (isResolvedStatus(task.status)) return false;
    const attempts = parseInt(String(task.metadata?.['voice-attempt-count'] || '0'), 10) || 0;
    const maxAttempts = parseInt(String(task.metadata?.['voice-max-attempts'] || task.metadata?.['max-attempts'] || '0'), 10) || 0;
    return maxAttempts > 0 && attempts >= maxAttempts;
  });

  const overall = allResolved
    ? 'completed'
    : (unresolvedAtMax ? 'partial-max-retries-reached' : 'in-progress');

  const lines: string[] = [];
  lines.push('# Call Summary');
  lines.push('');
  lines.push(`- Root task: \`${rootTask.id}\``);
  lines.push(`- Overall result: \`${overall}\``);
  lines.push(`- Created at: \`${formatSummaryTimestamp(rootTask.createdAt)}\``);
  lines.push(`- Last updated: \`${formatSummaryTimestamp(rootTask.updatedAt)}\``);
  lines.push('');
  lines.push('## Items');
  lines.push('');

  for (const task of scopedTasks) {
    const attempts = parseInt(String(task.metadata?.['voice-attempt-count'] || '0'), 10) || 0;
    const maxAttempts = parseInt(String(task.metadata?.['voice-max-attempts'] || task.metadata?.['max-attempts'] || '0'), 10) || 0;
    const latestUpdate = latestTaskUpdatedById.get(task.id);
    const latestVoice = latestVoiceStatusById.get(task.id);
    const outcomeHint = isResolvedStatus(task.status)
      ? 'resolved'
      : ((maxAttempts > 0 && attempts >= maxAttempts) ? 'max-retries-reached' : 'pending');
    const latestReason = String(latestUpdate?.details?.reason || '').trim() || '-';
    const latestCallStatus = String(latestVoice?.details?.callStatus || task.metadata?.['voice-last-call-status'] || '-').trim() || '-';
    const lastDtmf = String(task.metadata?.['voice-last-dtmf-digits'] || '-').trim() || '-';

    lines.push(`### ${task.id}`);
    lines.push(`- Status: \`${String(task.status || '-')}\``);
    lines.push(`- Outcome: \`${outcomeHint}\``);
    lines.push(`- Attempts: \`${attempts}/${maxAttempts || 0}\``);
    lines.push(`- Scheduled for: \`${formatSummaryTimestamp(task.scheduledFor)}\``);
    lines.push(`- Closed at: \`${formatSummaryTimestamp(task.closedAt)}\``);
    lines.push(`- Closure reason: \`${String(task.closureReason || '-')}\``);
    lines.push(`- Last call status: \`${latestCallStatus}\``);
    lines.push(`- Last DTMF: \`${lastDtmf}\``);
    lines.push(`- Last transition reason: \`${latestReason}\``);
    lines.push('');
  }

  lines.push('## Timeline');
  lines.push('');
  if (scopedLogs.length === 0) {
    lines.push('- No logs found for scoped tasks.');
  } else {
    for (const entry of scopedLogs.sort((a, b) => String(a.at).localeCompare(String(b.at)))) {
      lines.push(`- ${formatSummaryTimestamp(entry.at)} | \`${entry.taskId}\` | \`${entry.type}\` | \`${JSON.stringify(entry.details)}\``);
    }
  }

  lines.push('');
  return {
    overall,
    markdown: `${lines.join('\n')}\n`,
  };
}

function buildMarkdownCallSummary(taskId: string, tasks: any[], logs: ReminderLogEvent[]): string {
  return buildCallSummary(taskId, tasks, logs).markdown;
}

function markdownToSimpleHtml(markdown: string): string {
  const escaped = String(markdown || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  return [
    '<!doctype html>',
    '<html>',
    '<head><meta charset="utf-8"><title>Reminder Summary</title></head>',
    '<body style="font-family: Arial, sans-serif; line-height: 1.4;">',
    '<h2>Reminder Summary</h2>',
    `<pre style="white-space: pre-wrap;">${escaped}</pre>`,
    '</body>',
    '</html>',
  ].join('');
}

function resolveControllerEmail(
  rootMetadata: Record<string, unknown> | undefined,
  currentMetadata: Record<string, unknown> | undefined,
): string | undefined {
  const candidates = [
    process.env.TEST_INDIVIDUAL_CONTROLLER_EMAIL,
    process.env.CALL_CONTROLLER_EMAIL,
    rootMetadata?.['controller-email'],
    rootMetadata?.['Task.controller-email'],
    rootMetadata?.['owner-email'],
    rootMetadata?.['Task.owner-email'],
    currentMetadata?.['controller-email'],
    currentMetadata?.['Task.controller-email'],
    currentMetadata?.['owner-email'],
    currentMetadata?.['Task.owner-email'],
  ];
  for (const raw of candidates) {
    const value = String(raw || '').trim();
    if (!value) continue;
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return value;
  }
  return undefined;
}

function isResolvedStatus(status: string | undefined): boolean {
  return status === 'completed' || status === 'cancelled' || status === 'acknowledged';
}

function isTerminalCallStatus(callStatus: string | undefined): boolean {
  const normalized = String(callStatus || '').trim().toLowerCase();
  return normalized === 'completed'
    || normalized === 'busy'
    || normalized === 'failed'
    || normalized === 'no-answer'
    || normalized === 'canceled';
}

function parsePositiveInt(value: unknown): number | undefined {
  const parsed = parseInt(String(value ?? '').trim(), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
  return parsed;
}

function resolvePolicyValue(
  child: Record<string, unknown> | undefined,
  parent: Record<string, unknown> | undefined,
  keys: string[],
): number | undefined {
  for (const key of keys) {
    const parentValue = parsePositiveInt(parent?.[key]);
    if (parentValue !== undefined) return parentValue;
  }
  for (const key of keys) {
    const childValue = parsePositiveInt(child?.[key]);
    if (childValue !== undefined) return childValue;
  }
  return undefined;
}

function isReadyForCurrentCall(scheduledFor: string | undefined, nowMs: number): boolean {
  // If no scheduledFor is set, task is ready now (it wasn't rescheduled to a future time).
  // If scheduledFor is set, only ready if the time has passed (scheduled time <= now).
  if (!scheduledFor) return true;  // No explicit schedule = ready now
  const at = parseIsoDate(scheduledFor);
  if (!at) return true;  // Invalid date = treat as ready now
  return at.getTime() <= nowMs;  // Only ready if time has passed
}

async function closeParentIfAllChildrenResolved(
  taskService: TaskService,
  parentId: string,
  subjectId: string,
  pushReminderLogFn: (event: ReminderLogEvent) => void,
): Promise<void> {
  const siblingPool = await taskService.listTasks({ subjectId });
  const siblings = siblingPool.filter((candidate) => normalizePartOfReference(candidate.metadata?.['part-of']) === parentId);
  const unresolved = siblings.filter((candidate) => !isResolvedStatus(candidate.status));
  if (unresolved.length > 0) return;

  const parentTask = await taskService.getTask(parentId);
  if (!parentTask || isResolvedStatus(parentTask.status)) return;
  await taskService.closeTask({
    taskId: parentId,
    status: 'completed',
    reason: 'All subtasks resolved',
  });
  pushReminderLogFn({
    at: new Date().toISOString(),
    type: 'task-updated',
    taskId: parentId,
    details: { status: 'completed', reason: 'all-subtasks-resolved' },
  });
}

async function collectGroupedRootIds(
  taskService: TaskService,
  taskOrchestrator: UhcTaskOrchestrator,
  rootTask: any,
  groupWindowMinutes: number,
): Promise<string[]> {
  const subjectTasks = await taskService.listTasks({ subjectId: rootTask.subjectId });
  const roots = subjectTasks
    .filter((task) => taskOrchestrator.isRootTask(task))
    .filter((task) => !isResolvedStatus(task.status));
  if (roots.length <= 1) return [rootTask.id];

  const baseAt = parseIsoDate(String(rootTask.scheduledFor || rootTask.createdAt || ''));
  if (!baseAt) return [rootTask.id];
  const nowMs = Date.now();
  const baseIsDueOrPast = baseAt.getTime() <= nowMs;
  const windowMs = Math.max(0, groupWindowMinutes) * 60_000;

  const grouped = roots
    .filter((candidate) => {
      const candidateAt = parseIsoDate(String(candidate.scheduledFor || candidate.createdAt || ''));
      if (!candidateAt) return false;
      if (baseIsDueOrPast) {
        // Keep debug/manual call behavior aligned with daemon:
        // when the call starts from a due/overdue root, aggregate all unresolved
        // roots for the subject to avoid fragmented consecutive calls.
        return true;
      }
      return Math.abs(candidateAt.getTime() - baseAt.getTime()) <= windowMs;
    })
    .sort((left, right) => String(left.scheduledFor || left.createdAt || left.id).localeCompare(String(right.scheduledFor || right.createdAt || right.id)))
    .map((task) => task.id);

  if (!grouped.includes(rootTask.id)) grouped.unshift(rootTask.id);
  return grouped;
}

function resolveRootRetryPolicy(
  rootMetadata: Record<string, unknown> | undefined,
  fallbackMetadata: Record<string, unknown> | undefined,
  fallbackMaxAttempts: number,
  fallbackRetryMinutes: number,
): { rootMaxAttempts: number; retryIntervalMinutes: number } {
  const rootMaxAttempts = resolvePolicyValue(
    rootMetadata,
    fallbackMetadata,
    ['max-attempts', 'restriction-repetitions', 'repetitions'],
  ) || fallbackMaxAttempts;
  const retryIntervalMinutes = resolvePolicyValue(
    rootMetadata,
    fallbackMetadata,
    ['timing-repeat-offset', 'retry-interval-minutes', 'restriction-gap-min'],
  ) || fallbackRetryMinutes;
  return {
    rootMaxAttempts: Math.max(1, rootMaxAttempts),
    retryIntervalMinutes: Math.max(1, retryIntervalMinutes),
  };
}

function buildCallIntroduction(
  locale: 'es-ES' | 'en-US',
  subjectAlias: string,
  pendingCount: number,
): string {
  const countIntro = getVoiceReminderCountIntro(locale, pendingCount);
  if (locale === 'es-ES') {
    const greeting = subjectAlias ? `Hola ${subjectAlias}.` : 'Hola.';
    return `${greeting} Soy el asistente personal de recordatorios. ${countIntro}`.replace(/\s+/g, ' ').trim();
  }
  const greeting = subjectAlias ? `Hello ${subjectAlias}.` : 'Hello.';
  return `${greeting} I am your personal reminders assistant. ${countIntro}`.replace(/\s+/g, ' ').trim();
}

function stripLeadingGreetingFromPrompt(locale: 'es-ES' | 'en-US', text: string): string {
  const trimmed = String(text || '').trim();
  if (!trimmed) return '';
  if (locale === 'es-ES') {
    return trimmed
      .replace(/^hola\b[\s\S]*?asistente personal de recordatorios\.\s*/i, '')
      .trim();
  }
  return trimmed
    .replace(/^hello\b[\s\S]*?personal reminders assistant\.\s*/i, '')
    .trim();
}

export interface UhcTaskReminderRouterOptions {
  taskService: TaskService;
  taskOrchestrator?: UhcTaskOrchestrator;
  notificationManager?: NotificationManager;
  phoneAdapter: IPhoneAdapter;
  apiBaseUrl: string;
  voiceEnabled: boolean;
  debugApiEnabled: boolean;
  consoleLogsEnabled?: boolean;
  defaultTtsVoice?: string;
  maxAttempts: number;
  retryIntervalMinutes: number;
  groupWindowMinutes: number;
  autoRescheduleOnNoResponse: boolean;
}

export function createUhcTaskReminderRouter(options: UhcTaskReminderRouterOptions): express.Router {
  const router = express.Router();
  const logToConsole = options.consoleLogsEnabled === true;
  const taskOrchestrator = options.taskOrchestrator || new UhcTaskOrchestrator({ taskService: options.taskService });

  const pushReminderLog = (event: ReminderLogEvent): void => {
    pushLog(event);
    if (logToConsole) {
      console.log(`[UHC Reminder] ${event.type} taskId=${event.taskId} details=${JSON.stringify(event.details)}`);
    }
  };

  const buildNextPromptAfterResolved = async (
    req: express.Request,
    currentTask: any,
    locale: 'es-ES' | 'en-US',
    voice: string,
  ): Promise<{ nextPromptUrl?: string; nextReminderLabel?: string; allResolved: boolean }> => {
    const parentId = normalizePartOfReference(currentTask?.metadata?.['part-of']);
    let nextPromptUrl: string | undefined;
    let nextReminderLabel: string | undefined;
    let allResolved = false;

    if (parentId && currentTask) {
      const siblingPool = await options.taskService.listTasks({ subjectId: currentTask.subjectId });
      const siblings = siblingPool
        .filter((candidate) => normalizePartOfReference(candidate.metadata?.['part-of']) === parentId && candidate.id !== currentTask.id)
        .sort((left, right) => {
          const leftAt = left.scheduledFor || left.createdAt;
          const rightAt = right.scheduledFor || right.createdAt;
          return leftAt.localeCompare(rightAt);
        });
      const unresolved = siblings.filter((candidate) => !isResolvedStatus(candidate.status));
      const unresolvedReadyNow = unresolved.filter((candidate) => isReadyForCurrentCall(candidate.scheduledFor, Date.now()));
      if (unresolvedReadyNow.length === 0) {
        allResolved = unresolved.length === 0;
        if (unresolved.length === 0) {
          await closeParentIfAllChildrenResolved(
            options.taskService,
            parentId,
            currentTask.subjectId,
            pushReminderLog,
          );
        }
      } else {
        const nextSibling = unresolvedReadyNow[0];
        const nextScheduledFor = new Date().toISOString();
        await options.taskService.scheduleTask({
          taskId: nextSibling.id,
          scheduledFor: nextScheduledFor,
        });
        const refreshedNextSibling = await options.taskService.getTask(nextSibling.id) || nextSibling;
        const nextBasedOnContext = resolveBasedOnContext(refreshedNextSibling.metadata || {});
        const nextMedicationName = nextBasedOnContext.currentDisplay || refreshedNextSibling.title || refreshedNextSibling.description || 'your medication';
        nextReminderLabel = nextMedicationName;
        const nextTaskFocusOrBasedOn = String(
          nextBasedOnContext.currentReference
          || refreshedNextSibling.metadata?.focus
          || refreshedNextSibling.metadata?.['Task.based-on']
          || refreshedNextSibling.metadata?.['based-on']
          || '',
        );
        const nextTaskType = resolveTaskType(String(refreshedNextSibling.metadata?.type || ''), nextTaskFocusOrBasedOn);
        const nextEventAt = parseIsoDate(String(
          refreshedNextSibling.metadata?.['event-at']
          || refreshedNextSibling.metadata?.['due-at']
          || refreshedNextSibling.scheduledFor
          || nextScheduledFor
          || '',
        ));
        const nextTimingState = resolveTimingState(nextEventAt);
        const nextScheduledAtLabel = toSpokenTimeLabel(nextEventAt, locale);
        const nextScheduledAtIso = nextEventAt?.toISOString();
        const nextMaxAttempts = Math.max(
          1,
          resolvePolicyValue(
            nextSibling.metadata,
            (await options.taskService.getTask(parentId))?.metadata,
            ['voice-max-attempts', 'max-attempts', 'restriction-repetitions', 'repetitions'],
          ) || options.maxAttempts,
        );
        nextPromptUrl = `${buildMountedUrl(req, options.apiBaseUrl, '/voice/prompt')}?taskId=${encodeURIComponent(refreshedNextSibling.id)}`
          + `&language=${encodeURIComponent(locale)}`
          + `&attempt=1`
          + `&maxAttempts=${nextMaxAttempts}`
          + `&medicationName=${encodeURIComponent(nextMedicationName)}`
          + `&taskType=${encodeURIComponent(nextTaskType)}`
          + `&timingState=${encodeURIComponent(nextTimingState)}`
          + `&subjectAlias=${encodeURIComponent(resolveSubjectAlias(refreshedNextSibling.metadata || {}))}`
          + `&assistantName=${encodeURIComponent(String(req.query.assistantName || 'Unid'))}`
          + `&scheduledAtLabel=${encodeURIComponent(nextScheduledAtLabel || '')}`
          + `&scheduledAtIso=${encodeURIComponent(nextScheduledAtIso || '')}`
          + `&voice=${encodeURIComponent(voice)}`;
      }
    } else {
      allResolved = true;
    }

    if (!nextPromptUrl && currentTask) {
      const currentRootId = parentId || currentTask.id;
      const groupedRootIds = parseCsvValues(String(
        currentTask.metadata?.['voice-call-group-root-ids']
        || currentTask.metadata?.['voice-call-group-ids']
        || '',
      ));
      const currentGroupIndex = groupedRootIds.indexOf(currentRootId);
      if (groupedRootIds.length > 1 && currentGroupIndex >= 0) {
        for (let i = currentGroupIndex + 1; i < groupedRootIds.length; i += 1) {
          const candidateRootId = groupedRootIds[i];
          const candidateRoot = await options.taskService.getTask(candidateRootId);
          if (!candidateRoot || isResolvedStatus(candidateRoot.status)) continue;
          const selection = await taskOrchestrator.selectNextCallTask(candidateRoot);
          if (!('callTask' in selection) && selection.reason !== 'not-due') continue;

          // If this root is already inside the active grouped call chain, continue in-call
          // even when orchestrator marks it as not-due (for example, after prior no-input reschedules).
          const nextCallTask = ('callTask' in selection)
            ? selection.callTask
            : candidateRoot;
          const nextScheduledFor = new Date().toISOString();
          await options.taskService.scheduleTask({ taskId: nextCallTask.id, scheduledFor: nextScheduledFor });
          const refreshedNext = await options.taskService.getTask(nextCallTask.id) || nextCallTask;
          const nextBasedOnContext = resolveBasedOnContext(refreshedNext.metadata || {});
          const nextMedicationName = nextBasedOnContext.currentDisplay || refreshedNext.title || refreshedNext.description || 'your medication';
          nextReminderLabel = nextMedicationName;
          const nextTaskFocusOrBasedOn = String(
            nextBasedOnContext.currentReference
            || refreshedNext.metadata?.focus
            || refreshedNext.metadata?.['Task.based-on']
            || refreshedNext.metadata?.['based-on']
            || '',
          );
          const nextTaskType = resolveTaskType(String(refreshedNext.metadata?.type || ''), nextTaskFocusOrBasedOn);
          const nextEventAt = parseIsoDate(String(
            refreshedNext.metadata?.['event-at']
            || refreshedNext.metadata?.['due-at']
            || refreshedNext.scheduledFor
            || nextScheduledFor
            || '',
          ));
          const nextTimingState = resolveTimingState(nextEventAt);
          const nextScheduledAtLabel = toSpokenTimeLabel(nextEventAt, locale);
          const nextScheduledAtIso = nextEventAt?.toISOString();
          const nextMaxAttempts = Math.max(
            1,
            resolvePolicyValue(
              refreshedNext.metadata,
              candidateRoot.metadata,
              ['voice-max-attempts', 'max-attempts', 'restriction-repetitions', 'repetitions'],
            ) || options.maxAttempts,
          );
          nextPromptUrl = `${buildMountedUrl(req, options.apiBaseUrl, '/voice/prompt')}?taskId=${encodeURIComponent(refreshedNext.id)}`
            + `&language=${encodeURIComponent(locale)}`
            + `&attempt=1`
            + `&maxAttempts=${nextMaxAttempts}`
            + `&medicationName=${encodeURIComponent(nextMedicationName)}`
            + `&taskType=${encodeURIComponent(nextTaskType)}`
            + `&timingState=${encodeURIComponent(nextTimingState)}`
            + `&subjectAlias=${encodeURIComponent(resolveSubjectAlias(refreshedNext.metadata || {}))}`
            + `&assistantName=${encodeURIComponent(String(req.query.assistantName || 'Unid'))}`
            + `&scheduledAtLabel=${encodeURIComponent(nextScheduledAtLabel || '')}`
            + `&scheduledAtIso=${encodeURIComponent(nextScheduledAtIso || '')}`
            + `&voice=${encodeURIComponent(voice)}`;
          refreshedNext.metadata['voice-call-group-root-ids'] = groupedRootIds.join(',');
          refreshedNext.metadata['voice-call-group-current-root-id'] = candidateRootId;
          refreshedNext.updatedAt = new Date().toISOString();
          await options.taskService.getRepository().save(refreshedNext as any);
          allResolved = false;
          break;
        }
      }
    }

    return { nextPromptUrl, nextReminderLabel, allResolved };
  };

  const trySendSummaryEmail = async (
    rootTaskId: string,
    fallbackMetadata?: Record<string, unknown>,
  ): Promise<void> => {
    if (!options.notificationManager) return;
    const rootTask = await options.taskService.getTask(rootTaskId);
    if (!rootTask) return;

    const rootMetadata = rootTask.metadata || {};
    if (String(rootMetadata['voice-summary-email-sent-at'] || '').trim()) return;

    const tasks = await options.taskService.listTasks({ subjectId: rootTask.subjectId });
    const scopedLogs = reminderLogs.filter((entry) => {
      if (entry.taskId === rootTaskId) return true;
      const task = tasks.find((candidate) => candidate.id === entry.taskId);
      return normalizePartOfReference(task?.metadata?.['part-of']) === rootTaskId;
    });
    const summary = buildCallSummary(rootTaskId, tasks, scopedLogs);
    if (summary.overall === 'in-progress') return;

    const controllerEmail = resolveControllerEmail(rootMetadata, fallbackMetadata);
    if (!controllerEmail) {
      pushReminderLog({
        at: new Date().toISOString(),
        type: 'task-updated',
        taskId: rootTaskId,
        details: { status: rootTask.status, reason: 'summary-email-skipped-missing-controller-email' },
      });
      return;
    }

    const subject = `Reminder summary (${summary.overall}) - ${rootTaskId}`;
    await options.notificationManager.sendEmail({
      to: controllerEmail,
      subject,
      text: summary.markdown,
      html: markdownToSimpleHtml(summary.markdown),
      metadata: {
        taskId: rootTaskId,
        overall: summary.overall,
      },
    });

    rootMetadata['voice-summary-email-sent-at'] = new Date().toISOString();
    rootMetadata['voice-summary-email-to'] = controllerEmail;
    rootMetadata['voice-summary-overall'] = summary.overall;
    rootTask.metadata = rootMetadata;
    rootTask.updatedAt = new Date().toISOString();
    await options.taskService.getRepository().save(rootTask as any);
    pushReminderLog({
      at: new Date().toISOString(),
      type: 'task-updated',
      taskId: rootTaskId,
      details: { status: rootTask.status, reason: 'summary-email-sent', to: controllerEmail, overall: summary.overall },
    });
  };

  const promptHandler = (req: express.Request, res: express.Response) => {
    const taskId = String(req.query.taskId || '').trim();
    const attempt = Math.max(1, parseInt(String(req.query.attempt || '1'), 10) || 1);
    const maxAttempts = Math.max(1, parseInt(String(req.query.maxAttempts || '3'), 10) || 3);
    const medicationName = String(req.query.medicationName || 'your medication').trim() || 'your medication';
    const locale = resolveVoiceLocale(String(req.query.language || ''));
    const voiceBundle = getVoiceBundle(locale);
    const taskType = resolveTaskType(String(req.query.taskType || ''), undefined);
    const timingState = String(req.query.timingState || 'due_or_past') === 'future' ? 'future' : 'due_or_past';
    const subjectAlias = String(req.query.subjectAlias || '').trim();
    const assistantName = String(req.query.assistantName || 'Unid').trim() || 'Unid';
    const scheduledAtLabel = String(req.query.scheduledAtLabel || '').trim() || undefined;
    const scheduledAtIso = String(req.query.scheduledAtIso || '').trim() || undefined;
    const voice = sanitizeVoiceName(String(req.query.voice || 'alice'));
    const prompt = String(req.query.prompt || '').trim()
      || voiceBundle.retryPrompt(attempt, {
        subjectAlias,
        medicationName,
        assistantName,
        taskType,
        timingState,
        scheduledAtLabel,
        scheduledAtIso,
      });
    const actionUrl = `${buildMountedUrl(req, options.apiBaseUrl, '/voice/dtmf')}?taskId=${encodeURIComponent(taskId)}`
      + `&language=${encodeURIComponent(locale)}`
      + `&voice=${encodeURIComponent(voice)}`
      + `&taskType=${encodeURIComponent(taskType)}`
      + `&timingState=${encodeURIComponent(timingState)}`;
    const nextAttempt = attempt + 1;
    const retryUrl = `${buildMountedUrl(req, options.apiBaseUrl, '/voice/prompt')}?taskId=${encodeURIComponent(taskId)}`
      + `&language=${encodeURIComponent(locale)}`
      + `&attempt=${nextAttempt}`
      + `&maxAttempts=${maxAttempts}`
      + `&medicationName=${encodeURIComponent(medicationName)}`
      + `&taskType=${encodeURIComponent(taskType)}`
      + `&timingState=${encodeURIComponent(timingState)}`
      + `&subjectAlias=${encodeURIComponent(subjectAlias)}`
      + `&assistantName=${encodeURIComponent(assistantName)}`
      + `&scheduledAtLabel=${encodeURIComponent(scheduledAtLabel || '')}`
      + `&scheduledAtIso=${encodeURIComponent(scheduledAtIso || '')}`
      + `&voice=${encodeURIComponent(voice)}`;

    if (attempt > 1) {
      pushReminderLog({
        at: new Date().toISOString(),
        type: 'voice-no-input',
        taskId,
        details: { attempt: attempt - 1, maxAttempts, language: locale },
      });
    }

    let twiml = `<?xml version="1.0" encoding="UTF-8"?><Response><Gather input="dtmf" numDigits="1" timeout="5" action="${xmlEscape(actionUrl)}" method="POST"><Say voice="${xmlEscape(voice)}" language="${xmlEscape(locale)}">${xmlEscape(prompt)}</Say></Gather>`;
    if (attempt < maxAttempts) {
      twiml += `<Redirect method="POST">${xmlEscape(retryUrl)}</Redirect>`;
    } else {
      twiml += `<Say voice="${xmlEscape(voice)}" language="${xmlEscape(locale)}">${xmlEscape(getVoiceSystemText(locale, 'no-input'))}</Say><Hangup/>`;
    }
    twiml += '</Response>';
    res.set('Content-Type', 'text/xml');
    return res.status(200).send(twiml);
  };

  const statusHandler = async (req: express.Request, res: express.Response) => {
    const taskId = String(req.query.taskId || '').trim();
    const callStatus = String(req.body?.CallStatus || '').trim().toLowerCase();
    const callSid = String(req.body?.CallSid || '').trim() || undefined;
    const callTo = String(req.body?.To || '').trim() || undefined;
    pushReminderLog({
      at: new Date().toISOString(),
      type: 'voice-status',
      taskId,
      details: {
        callSid: callSid || undefined,
        callStatus: req.body?.CallStatus || undefined,
        to: callTo || undefined,
      },
    });

    if (taskId) {
      try {
        const task = await options.taskService.getTask(taskId);
        if (task) {
          task.metadata['voice-call-status'] = callStatus || task.metadata['voice-call-status'] || '';
          task.metadata['voice-last-call-status'] = callStatus || task.metadata['voice-last-call-status'] || '';
          task.metadata['voice-last-callback-at'] = new Date().toISOString();
          if (callSid) task.metadata['voice-call-sid'] = callSid;
          if (callTo) task.metadata['voice-call-to'] = callTo;
          task.metadata['voice-call-open'] = isTerminalCallStatus(callStatus) ? 'false' : 'true';
          task.updatedAt = new Date().toISOString();
          await options.taskService.getRepository().save(task);
        }
      } catch (err: any) {
        pushReminderLog({
          at: new Date().toISOString(),
          type: 'task-updated',
          taskId,
          details: { status: 'error', reason: 'voice-status-update-failed', error: err?.message || 'unknown' },
        });
      }
    }

    if (taskId && options.autoRescheduleOnNoResponse && callStatus === 'completed') {
      try {
        const task = await options.taskService.getTask(taskId);
        if (task && !isResolvedStatus(task.status)) {
          const lastDtmfCallSid = String(task.metadata['voice-last-dtmf-call-sid'] || '').trim();
          const currentCallSid = callSid || '';
          if (lastDtmfCallSid && currentCallSid && lastDtmfCallSid === currentCallSid) {
            pushReminderLog({
              at: new Date().toISOString(),
              type: 'task-updated',
              taskId,
              details: { status: task.status, reason: 'skip-auto-reschedule-dtmf-received', callSid: currentCallSid },
            });
            return res.status(204).end();
          }
          const metadata = task.metadata || {};
          const parentId = normalizePartOfReference(metadata['part-of']);
          const parentTask = parentId ? await options.taskService.getTask(parentId) : undefined;
          const rootTask = parentTask || task;
          const rootMetadata = rootTask.metadata || {};
          const rootAttemptsCounter = Math.max(0, parseInt(String(rootMetadata['voice-call-attempt-count'] || '0'), 10) || 0);
          const taskAttemptsCounter = Math.max(0, parseInt(String(metadata['voice-attempt-count'] || '0'), 10) || 0);
          const rootAttempts = Math.max(rootAttemptsCounter, taskAttemptsCounter);
          const { rootMaxAttempts, retryIntervalMinutes } = resolveRootRetryPolicy(
            rootMetadata,
            metadata,
            options.maxAttempts,
            options.retryIntervalMinutes,
          );

          if (rootAttempts < rootMaxAttempts) {
            const nextAt = new Date(Date.now() + retryIntervalMinutes * 60_000).toISOString();
            await options.taskService.scheduleTask({ taskId, scheduledFor: nextAt });

            const scheduledTask = await options.taskService.getTask(taskId);
            if (scheduledTask) {
              scheduledTask.metadata['voice-last-call-status'] = callStatus;
              scheduledTask.updatedAt = new Date().toISOString();
              scheduledTask.scheduledFor = nextAt;  // ← CRITICAL FIX: Preserve scheduledFor
              scheduledTask.status = 'scheduled';   // ← Ensure status is explicitly set
              await options.taskService.getRepository().save(scheduledTask);
            }

            pushReminderLog({
              at: new Date().toISOString(),
              type: 'task-updated',
              taskId,
              details: {
                status: 'scheduled',
                reason: 'auto-reschedule-no-response',
                scheduledFor: nextAt,
                rootAttempts,
                rootMaxAttempts,
                retryIntervalMinutes,
              },
            });
          } else {
            // Max retries reached without DTMF/no-response.
            // Finalize this subtask as cancelled so daemon will not keep re-calling forever.
            await options.taskService.closeTask({
              taskId,
              status: 'cancelled',
              reason: 'Max retries reached without response',
            });
            const finalized = await options.taskService.getTask(taskId);
            if (finalized) {
              finalized.metadata['voice-last-call-status'] = callStatus;
              finalized.metadata['voice-outcome'] = 'max-retries-no-response';
              finalized.metadata['voice-incidence-notified'] = 'true';
              finalized.metadata['voice-incidence-at'] = new Date().toISOString();
              finalized.updatedAt = new Date().toISOString();
              await options.taskService.getRepository().save(finalized);
              if (parentId) {
                await closeParentIfAllChildrenResolved(
                  options.taskService,
                  parentId,
                  finalized.subjectId,
                  pushReminderLog,
                );
              }
            }
            pushReminderLog({
              at: new Date().toISOString(),
              type: 'task-updated',
              taskId,
              details: {
                status: 'cancelled',
                reason: 'max-retries-reached-no-response',
                rootAttempts,
                rootMaxAttempts,
                retryIntervalMinutes,
              },
            });
          }
        }
      } catch (err: any) {
        pushReminderLog({
          at: new Date().toISOString(),
          type: 'task-updated',
          taskId,
          details: { status: 'error', reason: 'auto-reschedule-failed', error: err?.message || 'unknown' },
        });
      }
    }

    if (taskId) {
      try {
        const current = await options.taskService.getTask(taskId);
        const rootTaskId = normalizePartOfReference(current?.metadata?.['part-of']) || current?.id;
        if (rootTaskId) {
          await trySendSummaryEmail(rootTaskId, current?.metadata);
        }
      } catch (err: any) {
        pushReminderLog({
          at: new Date().toISOString(),
          type: 'task-updated',
          taskId,
          details: { status: 'error', reason: 'summary-email-check-failed', error: err?.message || 'unknown' },
        });
      }
    }

    return res.status(204).end();
  };

  // Debug-only controller endpoint: update task status manually.
  if (options.debugApiEnabled) {
    const updateTaskStatusHandler = async (req: express.Request, res: express.Response) => {
    const taskId = String(req.params.taskId || '').trim();
    const status = String(req.body?.status || '').trim();
    const reason = String(req.body?.reason || '').trim() || undefined;

    if (!taskId || !status) {
      return res.status(400).json({ error: 'invalid_request', message: 'taskId and status are required.' });
    }

    try {
      let updated;
      if (status === 'acknowledged') {
        updated = await options.taskService.acknowledgeTask(taskId);
      } else if (status === 'completed' || status === 'cancelled') {
        updated = await options.taskService.closeTask({ taskId, status: status as 'completed' | 'cancelled', reason });
      } else if (status === 'scheduled') {
        const scheduledFor = String(req.body?.scheduledFor || '').trim();
        if (!scheduledFor) {
          return res.status(400).json({ error: 'invalid_scheduled_for', message: 'scheduledFor is required when status=scheduled.' });
        }
        updated = await options.taskService.scheduleTask({ taskId, scheduledFor });
      } else {
        return res.status(400).json({ error: 'unsupported_status', message: `Unsupported status update '${status}'.` });
      }

      pushReminderLog({
        at: new Date().toISOString(),
        type: 'task-updated',
        taskId,
        details: { status: updated.status, reason },
      });

      return res.status(200).json({ taskId, status: updated.status, updatedAt: updated.updatedAt });
    } catch (err: any) {
      return res.status(400).json({ error: 'task_update_failed', message: err?.message || 'Could not update task.' });
    }
    };

    router.patch('/task/:taskId/status', express.json(), updateTaskStatusHandler);
    router.post('/:taskId/_status', express.json(), updateTaskStatusHandler);
  }

  // Debug-only controller endpoint: start a single-call voice reminder with DTMF.
  if (options.debugApiEnabled) {
    const startCallHandler = async (req: express.Request, res: express.Response) => {
    if (!options.voiceEnabled) {
      return res.status(412).json({ error: 'voice_disabled', message: 'CALL_VOICE_ENABLED is false.' });
    }

    const taskId = String(req.body?.taskId || '').trim();
    const to = String(req.body?.to || '').trim();

    if (!taskId || !to) {
      return res.status(400).json({ error: 'invalid_request', message: 'taskId and to are required.' });
    }

    try {
      const rootTask = await options.taskService.getTask(taskId);
      if (!rootTask) {
        return res.status(404).json({ error: 'not_found', message: `Task '${taskId}' was not found.` });
      }

      const selection = await taskOrchestrator.selectNextCallTask(rootTask);
      if (!('callTask' in selection)) {
        if (selection.reason === 'resolved') {
          return res.status(409).json({ error: 'no_pending_subtasks', message: `Task '${taskId}' has no pending subtasks.` });
        }
        if (selection.reason === 'active-call-open') {
          return res.status(409).json({ error: 'active_call_open', message: `Task '${taskId}' already has an active voice call.` });
        }
        return res.status(409).json({ error: 'not_due', message: `Task '${taskId}' is not due for call yet.` });
      }
      const task = selection.callTask;
      const permissionBundle = decodeUhcReminderPermissionBundle(task.metadata || {});
      const permissionEvaluation = evaluateUhcReminderRuntimeAccess({
        permissionBundle,
        actorKind: UhcReminderActorKinds.Assistant,
        actorId: 'voice-assistant',
        action: UhcReminderActions.Execute,
        entity: UhcReminderEntityKinds.DispatchWindow,
        channel: UhcReminderChannels.Phone,
      });
      if (!permissionEvaluation.allowed) {
        return res.status(403).json({
          error: 'permission_denied',
          message: `Voice assistant cannot execute reminder dispatch (${permissionEvaluation.reason}).`,
        });
      }
      const pendingReminderCount = selection.pendingReminderCount;
      const rootMetadata = rootTask.metadata || {};

      const taskLike = task as unknown as { scheduledFor?: string; metadata?: Record<string, unknown> };
      const taskMetadata = (taskLike.metadata || {});
      const basedOnContext = resolveBasedOnContext(taskMetadata);
      const locale = resolveVoiceLocale(String(
        req.body?.language
          || taskMetadata['language']
          || '',
      ));
      const voiceBundle = getVoiceBundle(locale);
      const assistantName = String(
        req.body?.assistantName
          || 'Unid',
      ).trim() || 'Unid';
      const voice = sanitizeVoiceName(String(
        req.body?.voice
          || taskMetadata.voice
          || taskMetadata['tts-voice']
          || options.defaultTtsVoice
          || 'alice',
      ));
      const subjectAlias = String(req.body?.subjectAlias || resolveSubjectAlias(taskMetadata)).trim();
      const medicationName = String(
        req.body?.medicationName
        || req.body?.medicationAlias
        || basedOnContext.currentDisplay
        || task.title
        || task.description
        || 'your medication',
      )
        .trim() || 'your medication';
      const taskFocusOrBasedOn = String(
        basedOnContext.currentReference
          || taskMetadata['focus']
          || taskMetadata['Task.based-on']
          || taskMetadata['based-on']
          || '',
      );
      const taskType = resolveTaskType(
        String(req.body?.taskType || taskMetadata['type'] || ''),
        taskFocusOrBasedOn,
      );
      const scheduledFor = parseIsoDate(String(
        req.body?.scheduledFor
          || taskMetadata['scheduled-for']
          || taskMetadata['due-at']
          || taskMetadata['event-at']
          || taskLike.scheduledFor
          || '',
      ));
      const timingState = resolveTimingState(scheduledFor);
      const scheduledAtLabel = toSpokenTimeLabel(scheduledFor, locale);
      const scheduledAtIso = scheduledFor?.toISOString();
      const groupedRootIds = await collectGroupedRootIds(
        options.taskService,
        taskOrchestrator,
        rootTask,
        options.groupWindowMinutes,
      );
      const introReminderCount = Math.max(pendingReminderCount, groupedRootIds.length || 0);
      const introText = buildCallIntroduction(locale, subjectAlias, introReminderCount);
      const prompt = String(req.body?.prompt || '').trim()
        || `${introText} ${stripLeadingGreetingFromPrompt(
          locale,
          voiceBundle.defaultPrompt({
            subjectAlias,
            medicationName,
            assistantName,
            taskType,
            timingState,
            scheduledAtLabel,
            scheduledAtIso,
          }),
        )}`.replace(/\s+/g, ' ').trim();
      const maxAttempts = Math.max(
        1, parseInt(String(req.body?.maxAttempts || options.maxAttempts), 10) || options.maxAttempts,
      );
      const callTaskId = task.id;
      const promptUrl = `${buildMountedUrl(req, options.apiBaseUrl, '/voice/prompt')}?taskId=${encodeURIComponent(callTaskId)}`
        + `&prompt=${encodeURIComponent(prompt)}`
        + `&language=${encodeURIComponent(locale)}`
        + `&attempt=1`
        + `&maxAttempts=${maxAttempts}`
        + `&medicationName=${encodeURIComponent(medicationName)}`
        + `&taskType=${encodeURIComponent(taskType)}`
        + `&timingState=${encodeURIComponent(timingState)}`
        + `&subjectAlias=${encodeURIComponent(subjectAlias)}`
        + `&assistantName=${encodeURIComponent(assistantName)}`
        + `&scheduledAtLabel=${encodeURIComponent(scheduledAtLabel || '')}`
        + `&scheduledAtIso=${encodeURIComponent(scheduledAtIso || '')}`
        + `&voice=${encodeURIComponent(voice)}`;
      const statusCallbackUrl = `${buildMountedUrl(req, options.apiBaseUrl, '/voice/status')}?taskId=${encodeURIComponent(callTaskId)}`;

      const result = await options.phoneAdapter.startVoiceReminderCall({
        to,
        twimlUrl: promptUrl,
        statusCallbackUrl,
        correlationId: callTaskId,
      });

      const currentAttempts = Math.max(0, parseInt(String(taskMetadata['voice-attempt-count'] || '0'), 10) || 0);
      taskMetadata['voice-attempt-count'] = String(currentAttempts + 1);
      taskMetadata['voice-max-attempts'] = String(options.maxAttempts);
      taskMetadata['voice-call-open'] = 'true';
      taskMetadata['voice-call-group-root-ids'] = groupedRootIds.join(',');
      taskMetadata['voice-call-group-current-root-id'] = rootTask.id;
      taskMetadata['voice-call-group-window-minutes'] = String(Math.max(0, options.groupWindowMinutes));
      const mutableTask = task as any;
      mutableTask.metadata = taskMetadata;
      mutableTask.updatedAt = new Date().toISOString();
      await options.taskService.getRepository().save(mutableTask);

      const rootCallAttempts = Math.max(0, parseInt(String(rootMetadata['voice-call-attempt-count'] || '0'), 10) || 0) + 1;
      rootMetadata['voice-call-attempt-count'] = String(rootCallAttempts);
      const rootPolicy = resolveRootRetryPolicy(rootMetadata, taskMetadata, options.maxAttempts, options.retryIntervalMinutes);
      rootMetadata['voice-call-max-attempts'] = String(rootPolicy.rootMaxAttempts);
      rootMetadata['voice-call-last-started-at'] = new Date().toISOString();
      rootTask.metadata = rootMetadata;
      rootTask.updatedAt = new Date().toISOString();
      await options.taskService.getRepository().save(rootTask as any);

      pushReminderLog({
        at: new Date().toISOString(),
        type: 'voice-call-started',
        taskId: callTaskId,
        details: {
          to,
          callSid: result.sid,
          status: result.status,
          rootTaskId: rootTask.id,
          language: locale,
          assistantName,
          voice,
          maxAttempts,
          rootCallAttempts,
          rootCallMaxAttempts: rootPolicy.rootMaxAttempts,
          pendingReminderCount,
          groupedRootIds,
          promptPreview: prompt,
          taskType,
          timingState,
          scheduledAtLabel,
        },
      });

      return res.status(200).json({
        taskId: callTaskId,
        rootTaskId: rootTask.id,
        callSid: result.sid,
        status: result.status,
        to: result.to,
      });
    } catch (err: any) {
      return res.status(502).json({ error: 'voice_call_failed', message: err?.message || 'Could not start voice call.' });
    }
    };

    router.post('/call/start', express.json(), startCallHandler);
    router.post('/_call-start', express.json(), startCallHandler);
  }

  // TwiML prompt endpoint used by Twilio voice callback.
  router.post('/voice/prompt', express.urlencoded({ extended: false }), promptHandler);
  router.get('/voice/prompt', promptHandler);

  router.post('/voice/medication-time', express.urlencoded({ extended: false }), async (req: express.Request, res: express.Response) => {
    const taskId = String(req.query.taskId || '').trim();
    const locale = resolveVoiceLocale(String(req.query.language || ''));
    const voice = sanitizeVoiceName(String(req.query.voice || 'alice'));
    const digits = String(req.body?.Digits || '').trim();
    if (!taskId) {
      res.set('Content-Type', 'text/xml');
      return res.status(200).send(`<?xml version="1.0" encoding="UTF-8"?><Response><Say voice="${xmlEscape(voice)}" language="${xmlEscape(locale)}">${xmlEscape(getVoiceSystemText(locale, 'missing-task-id'))}</Say></Response>`);
    }
    const parsed = parseTakenTimeDigits(digits);
    if (!parsed) {
      res.set('Content-Type', 'text/xml');
      const msg = `${getVoiceSystemText(locale, 'medication-taken-other-time-invalid')} ${getVoiceSystemText(locale, 'medication-taken-other-time-ask-hhmm')}`.replace(/\s+/g, ' ').trim();
      const retryUrl = `${buildMountedUrl(req, options.apiBaseUrl, '/voice/medication-time')}?taskId=${encodeURIComponent(taskId)}&language=${encodeURIComponent(locale)}&voice=${encodeURIComponent(voice)}`;
      return res.status(200).send(`<?xml version="1.0" encoding="UTF-8"?><Response><Gather input="dtmf" numDigits="4" timeout="6" action="${xmlEscape(retryUrl)}" method="POST"><Say voice="${xmlEscape(voice)}" language="${xmlEscape(locale)}">${xmlEscape(msg)}</Say></Gather><Say voice="${xmlEscape(voice)}" language="${xmlEscape(locale)}">${xmlEscape(getVoiceSystemText(locale, 'goodbye'))}</Say></Response>`);
    }

    const task = await options.taskService.getTask(taskId);
    if (!task) {
      res.set('Content-Type', 'text/xml');
      return res.status(200).send(`<?xml version="1.0" encoding="UTF-8"?><Response><Say voice="${xmlEscape(voice)}" language="${xmlEscape(locale)}">${xmlEscape(getVoiceSystemText(locale, 'missing-task-id'))}</Say></Response>`);
    }
    task.metadata['medication-taken-time-hhmm'] = `${String(parsed.hour).padStart(2, '0')}:${String(parsed.minute).padStart(2, '0')}`;
    task.metadata['medication-taken-time-source'] = 'dtmf';
    task.updatedAt = new Date().toISOString();
    await options.taskService.getRepository().save(task as any);

    if (parsed.needsMeridiem) {
      const meridiemUrl = `${buildMountedUrl(req, options.apiBaseUrl, '/voice/medication-time-meridiem')}?taskId=${encodeURIComponent(taskId)}&language=${encodeURIComponent(locale)}&voice=${encodeURIComponent(voice)}`;
      res.set('Content-Type', 'text/xml');
      return res.status(200).send(`<?xml version="1.0" encoding="UTF-8"?><Response><Gather input="dtmf" numDigits="1" timeout="6" action="${xmlEscape(meridiemUrl)}" method="POST"><Say voice="${xmlEscape(voice)}" language="${xmlEscape(locale)}">${xmlEscape(getVoiceSystemText(locale, 'medication-taken-other-time-ask-meridiem'))}</Say></Gather><Say voice="${xmlEscape(voice)}" language="${xmlEscape(locale)}">${xmlEscape(getVoiceSystemText(locale, 'goodbye'))}</Say></Response>`);
    }

    await options.taskService.closeTask({ taskId, status: 'completed', reason: 'DTMF 2: taken-other-time' });
    const refreshedCurrent = await options.taskService.getTask(taskId);
    const transition = refreshedCurrent
      ? await buildNextPromptAfterResolved(req, refreshedCurrent, locale, voice)
      : { allResolved: true as const };
    const say = getVoiceSystemText(locale, 'medication-taken-other-time-recorded');
    res.set('Content-Type', 'text/xml');
    if (transition.nextPromptUrl) {
      const nextLine = transition.nextReminderLabel
        ? `${getVoiceSystemText(locale, 'next-reminder')}: ${transition.nextReminderLabel}.`
        : `${getVoiceSystemText(locale, 'next-reminder')}.`;
      const chainedSay = `${say} ${nextLine}`.replace(/\s+/g, ' ').trim();
      return res.status(200).send(
        `<?xml version="1.0" encoding="UTF-8"?><Response><Say voice="${xmlEscape(voice)}" language="${xmlEscape(locale)}">${xmlEscape(chainedSay)}</Say><Redirect method="POST">${xmlEscape(transition.nextPromptUrl)}</Redirect></Response>`,
      );
    }
    const finalSay = `${say} ${getVoiceSystemText(locale, 'goodbye')}`.replace(/\s+/g, ' ').trim();
    return res.status(200).send(`<?xml version="1.0" encoding="UTF-8"?><Response><Say voice="${xmlEscape(voice)}" language="${xmlEscape(locale)}">${xmlEscape(finalSay)}</Say></Response>`);
  });

  router.post('/voice/medication-time-meridiem', express.urlencoded({ extended: false }), async (req: express.Request, res: express.Response) => {
    const taskId = String(req.query.taskId || '').trim();
    const locale = resolveVoiceLocale(String(req.query.language || ''));
    const voice = sanitizeVoiceName(String(req.query.voice || 'alice'));
    const digits = String(req.body?.Digits || '').trim();
    if (!taskId) {
      res.set('Content-Type', 'text/xml');
      return res.status(200).send(`<?xml version="1.0" encoding="UTF-8"?><Response><Say voice="${xmlEscape(voice)}" language="${xmlEscape(locale)}">${xmlEscape(getVoiceSystemText(locale, 'missing-task-id'))}</Say></Response>`);
    }
    if (!(digits === '1' || digits === '2')) {
      const meridiemUrl = `${buildMountedUrl(req, options.apiBaseUrl, '/voice/medication-time-meridiem')}?taskId=${encodeURIComponent(taskId)}&language=${encodeURIComponent(locale)}&voice=${encodeURIComponent(voice)}`;
      res.set('Content-Type', 'text/xml');
      return res.status(200).send(`<?xml version="1.0" encoding="UTF-8"?><Response><Gather input="dtmf" numDigits="1" timeout="6" action="${xmlEscape(meridiemUrl)}" method="POST"><Say voice="${xmlEscape(voice)}" language="${xmlEscape(locale)}">${xmlEscape(getVoiceSystemText(locale, 'medication-taken-other-time-ask-meridiem'))}</Say></Gather><Say voice="${xmlEscape(voice)}" language="${xmlEscape(locale)}">${xmlEscape(getVoiceSystemText(locale, 'goodbye'))}</Say></Response>`);
    }
    const task = await options.taskService.getTask(taskId);
    if (!task) {
      res.set('Content-Type', 'text/xml');
      return res.status(200).send(`<?xml version="1.0" encoding="UTF-8"?><Response><Say voice="${xmlEscape(voice)}" language="${xmlEscape(locale)}">${xmlEscape(getVoiceSystemText(locale, 'missing-task-id'))}</Say></Response>`);
    }
    const raw = String(task.metadata['medication-taken-time-hhmm'] || '').trim();
    const [hh, mm] = raw.split(':').map((part) => parseInt(part, 10));
    if (!Number.isFinite(hh) || !Number.isFinite(mm)) {
      res.set('Content-Type', 'text/xml');
      return res.status(200).send(`<?xml version="1.0" encoding="UTF-8"?><Response><Say voice="${xmlEscape(voice)}" language="${xmlEscape(locale)}">${xmlEscape(getVoiceSystemText(locale, 'medication-taken-other-time-invalid'))}</Say></Response>`);
    }
    let hour24 = hh;
    if (digits === '1') {
      hour24 = hh === 12 ? 0 : hh;
    } else if (digits === '2') {
      hour24 = hh === 12 ? 12 : hh + 12;
    }
    const now = new Date();
    const takenAt = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hour24, mm, 0, 0);
    task.metadata['medication-taken-at'] = takenAt.toISOString();
    task.metadata['medication-taken-meridiem'] = digits === '1' ? 'am' : 'pm';
    task.updatedAt = new Date().toISOString();
    await options.taskService.getRepository().save(task as any);
    await options.taskService.closeTask({ taskId, status: 'completed', reason: 'DTMF 2: taken-other-time' });
    const refreshedCurrent = await options.taskService.getTask(taskId);
    const transition = refreshedCurrent
      ? await buildNextPromptAfterResolved(req, refreshedCurrent, locale, voice)
      : { allResolved: true as const };
    const say = getVoiceSystemText(locale, 'medication-taken-other-time-recorded');
    res.set('Content-Type', 'text/xml');
    if (transition.nextPromptUrl) {
      const nextLine = transition.nextReminderLabel
        ? `${getVoiceSystemText(locale, 'next-reminder')}: ${transition.nextReminderLabel}.`
        : `${getVoiceSystemText(locale, 'next-reminder')}.`;
      const chainedSay = `${say} ${nextLine}`.replace(/\s+/g, ' ').trim();
      return res.status(200).send(
        `<?xml version="1.0" encoding="UTF-8"?><Response><Say voice="${xmlEscape(voice)}" language="${xmlEscape(locale)}">${xmlEscape(chainedSay)}</Say><Redirect method="POST">${xmlEscape(transition.nextPromptUrl)}</Redirect></Response>`,
      );
    }
    const finalSay = `${say} ${getVoiceSystemText(locale, 'goodbye')}`.replace(/\s+/g, ' ').trim();
    return res.status(200).send(`<?xml version="1.0" encoding="UTF-8"?><Response><Say voice="${xmlEscape(voice)}" language="${xmlEscape(locale)}">${xmlEscape(finalSay)}</Say></Response>`);
  });

  // DTMF response endpoint.
  router.post('/voice/dtmf', express.urlencoded({ extended: false }), async (req: express.Request, res: express.Response) => {
    const taskId = String(req.query.taskId || '').trim();
    const digits = String((req.body?.Digits ?? '')).trim();
    const locale = resolveVoiceLocale(String(req.query.language || ''));
    const queryTaskTypeRaw = String(req.query.taskType || '').trim();
    const queryTimingStateRaw = String(req.query.timingState || '').trim();
    const voice = sanitizeVoiceName(String(req.query.voice || 'alice'));

    if (!taskId) {
      res.set('Content-Type', 'text/xml');
      return res.status(200).send(`<?xml version="1.0" encoding="UTF-8"?><Response><Say voice="${xmlEscape(voice)}" language="${xmlEscape(locale)}">${xmlEscape(getVoiceSystemText(locale, 'missing-task-id'))}</Say></Response>`);
    }

    let nextStatus: 'acknowledged' | 'completed' | 'cancelled' | 'scheduled' | 'unknown' = 'unknown';
    let nextStatusReason: string | undefined;
    try {
      const currentTask = await options.taskService.getTask(taskId);
      const taskMetadata = currentTask?.metadata || {};
      const taskFocusOrBasedOn = String(
        taskMetadata.focus
        || taskMetadata['Task.based-on']
        || taskMetadata['based-on']
        || '',
      );
      const taskType = queryTaskTypeRaw
        ? resolveTaskType(queryTaskTypeRaw, undefined)
        : resolveTaskType(String(taskMetadata.type || ''), taskFocusOrBasedOn);
      const timingState = queryTimingStateRaw
        ? (queryTimingStateRaw === 'future' ? 'future' : 'due_or_past')
        : resolveTimingState(
          parseIsoDate(String(
            currentTask?.scheduledFor
            || taskMetadata['scheduled-for']
            || taskMetadata['due-at']
            || taskMetadata['event-at']
            || '',
          )),
        );
      const parentId = normalizePartOfReference(currentTask?.metadata?.['part-of']);
      const parentTask = parentId ? await options.taskService.getTask(parentId) : undefined;
      const retryIntervalMinutes = resolvePolicyValue(
        currentTask?.metadata,
        parentTask?.metadata,
        ['timing-repeat-offset', 'retry-interval-minutes', 'restriction-gap-min'],
      ) || options.retryIntervalMinutes;

      // Behavioral contract (medication, due_or_past):
      // - DTMF 1 => taken (optionally asks taken-time capture when enabled)
      // - DTMF 2 => scheduled (retry later), never generic acknowledged
      // - DTMF 3 => cancelled + medication issue notification (no "cancelled" phrase)
      // Any missing taskType/timingState query params MUST be inferred from task metadata/schedule.
      if (digits === '1') {
        if (taskType === 'medication' && timingState === 'due_or_past') {
          const pastTimeCaptureEnabled = String(process.env.CALL_REMINDER_PAST_TIME_CAPTURE_ENABLED || '').trim().toLowerCase() === 'true';
          if (pastTimeCaptureEnabled) {
            nextStatus = 'unknown';
            nextStatusReason = 'dtmf-1-medication-time-capture';
            const timeCaptureUrl = `${buildMountedUrl(req, options.apiBaseUrl, '/voice/medication-time')}?taskId=${encodeURIComponent(taskId)}&language=${encodeURIComponent(locale)}&voice=${encodeURIComponent(voice)}`;
            res.set('Content-Type', 'text/xml');
            return res.status(200).send(
              `<?xml version="1.0" encoding="UTF-8"?><Response><Gather input="dtmf" numDigits="4" timeout="6" action="${xmlEscape(timeCaptureUrl)}" method="POST"><Say voice="${xmlEscape(voice)}" language="${xmlEscape(locale)}">${xmlEscape(getVoiceSystemText(locale, 'medication-taken-other-time-ask-hhmm'))}</Say></Gather><Say voice="${xmlEscape(voice)}" language="${xmlEscape(locale)}">${xmlEscape(getVoiceSystemText(locale, 'goodbye'))}</Say></Response>`,
            );
          }
          await options.taskService.closeTask({ taskId, status: 'completed', reason: 'DTMF 1: taken' });
          nextStatus = 'completed';
          nextStatusReason = 'dtmf-1';
        } else if (taskType === 'appointment' && timingState === 'due_or_past') {
          await options.taskService.closeTask({ taskId, status: 'completed', reason: 'DTMF 1: attended' });
          nextStatus = 'completed';
          nextStatusReason = 'dtmf-1';
        } else {
          await options.taskService.acknowledgeTask(taskId);
          nextStatus = 'acknowledged';
          nextStatusReason = 'dtmf-1';
        }
      } else if (digits === '2') {
        if (taskType === 'medication') {
          let nextAt = new Date(Date.now() + retryIntervalMinutes * 60_000).toISOString();
          if (timingState === 'future' && currentTask?.scheduledFor) {
            nextAt = currentTask.scheduledFor;
          }
          await options.taskService.scheduleTask({ taskId, scheduledFor: nextAt });
          const scheduledTask = await options.taskService.getTask(taskId);
          if (scheduledTask) {
            if (!scheduledTask.metadata['event-at']) {
              const preservedEventAt = String(
                currentTask?.metadata?.['event-at']
                || currentTask?.metadata?.['due-at']
                || currentTask?.scheduledFor
                || '',
              ).trim();
              if (preservedEventAt) {
                scheduledTask.metadata['event-at'] = preservedEventAt;
              }
            }
            scheduledTask.metadata['voice-last-call-status'] = 'completed';
            scheduledTask.updatedAt = new Date().toISOString();
            scheduledTask.scheduledFor = nextAt;  // ← CRITICAL FIX: Ensure scheduledFor is preserved when saving
            scheduledTask.status = 'scheduled';   // ← Explicitly set status to scheduled
            await options.taskService.getRepository().save(scheduledTask);
          }
          nextStatus = 'scheduled';
          nextStatusReason = 'dtmf-2-retry';
        } else if (taskType === 'appointment') {
          await options.taskService.closeTask({ taskId, status: 'cancelled', reason: 'DTMF 2: cannot attend' });
          nextStatus = 'cancelled';
          nextStatusReason = 'dtmf-2';
        } else {
          await options.taskService.acknowledgeTask(taskId);
          nextStatus = 'acknowledged';
          nextStatusReason = 'dtmf-2';
        }
      } else if (digits === '3') {
        await options.taskService.closeTask({ taskId, status: 'cancelled', reason: 'DTMF 3: not possible' });
        nextStatus = 'cancelled';
        nextStatusReason = 'dtmf-3';
      }

      pushReminderLog({
        at: new Date().toISOString(),
        type: 'voice-dtmf-received',
        taskId,
        details: { digits, nextStatus, taskType, timingState, callSid: req.body?.CallSid || undefined },
      });
      if (nextStatus !== 'unknown') {
        const dtmfStampedTask = await options.taskService.getTask(taskId);
        if (dtmfStampedTask) {
          dtmfStampedTask.metadata['voice-last-dtmf-at'] = new Date().toISOString();
          dtmfStampedTask.metadata['voice-last-dtmf-call-sid'] = String(req.body?.CallSid || '').trim();
          dtmfStampedTask.metadata['voice-last-dtmf-digits'] = digits;
          dtmfStampedTask.updatedAt = new Date().toISOString();
          await options.taskService.getRepository().save(dtmfStampedTask);
        }
        pushReminderLog({
          at: new Date().toISOString(),
          type: 'task-updated',
          taskId,
          details: {
            status: nextStatus,
            reason: nextStatusReason || 'dtmf',
            taskType,
            timingState,
          },
        });
      }

      let nextPromptUrl: string | undefined;
      let nextReminderLabel: string | undefined;
      let allResolved = false;
      if ((nextStatus === 'acknowledged' || nextStatus === 'completed' || nextStatus === 'cancelled' || nextStatus === 'scheduled') && parentId && currentTask) {
        const siblingPool = await options.taskService.listTasks({ subjectId: currentTask.subjectId });
        const siblings = siblingPool
          .filter((candidate) => normalizePartOfReference(candidate.metadata?.['part-of']) === parentId && candidate.id !== taskId)
          .sort((left, right) => {
            const leftAt = left.scheduledFor || left.createdAt;
            const rightAt = right.scheduledFor || right.createdAt;
            return leftAt.localeCompare(rightAt);
          });
        const unresolved = siblings.filter((candidate) => !isResolvedStatus(candidate.status));
        // When processing DTMF in the same call, only proceed to next sibling if it's ready-now.
        // Tasks with future scheduledFor (from previous DTMF reschedules) should NOT redirect in the same call.
        // Note: current task (taskId) is explicitly excluded from siblings pool above, so we only get the next ones.
        const unresolvedReadyNow = unresolved.filter((candidate) => isReadyForCurrentCall(candidate.scheduledFor, Date.now()));
        const currentResolved = nextStatus === 'completed' || nextStatus === 'cancelled' || nextStatus === 'acknowledged';
        if (unresolvedReadyNow.length === 0) {
          allResolved = currentResolved && unresolved.length === 0;
          if (currentResolved && unresolved.length === 0) {
            await closeParentIfAllChildrenResolved(
              options.taskService,
              parentId,
              currentTask.subjectId,
              pushReminderLog,
            );
          }
        } else {
          const nextSibling = unresolvedReadyNow[0];
          const nextScheduledFor = new Date().toISOString();
          await options.taskService.scheduleTask({
            taskId: nextSibling.id,
            scheduledFor: nextScheduledFor,
          });
          // CRITICAL: Refresh nextSibling from DB to get updated scheduledFor
          const refreshedNextSibling = await options.taskService.getTask(nextSibling.id) || nextSibling;
          const nextBasedOnContext = resolveBasedOnContext(refreshedNextSibling.metadata || {});
          const nextMedicationName = nextBasedOnContext.currentDisplay || refreshedNextSibling.title || refreshedNextSibling.description || 'your medication';
          nextReminderLabel = nextMedicationName;
          const nextTaskFocusOrBasedOn = String(
            nextBasedOnContext.currentReference
            || refreshedNextSibling.metadata?.focus
            || refreshedNextSibling.metadata?.['Task.based-on']
            || refreshedNextSibling.metadata?.['based-on']
            || '',
          );
          const nextTaskType = resolveTaskType(String(refreshedNextSibling.metadata?.type || ''), nextTaskFocusOrBasedOn);
          const nextEventAt = parseIsoDate(String(
            refreshedNextSibling.metadata?.['event-at']
            || refreshedNextSibling.metadata?.['due-at']
            || refreshedNextSibling.scheduledFor
            || nextScheduledFor
            || '',
          ));
          const nextTimingState = resolveTimingState(nextEventAt);
          const nextScheduledAtLabel = toSpokenTimeLabel(nextEventAt, locale);
          const nextScheduledAtIso = nextEventAt?.toISOString();
          const nextMaxAttempts = Math.max(
            1,
            resolvePolicyValue(
              nextSibling.metadata,
              (await options.taskService.getTask(parentId))?.metadata,
              ['voice-max-attempts', 'max-attempts', 'restriction-repetitions', 'repetitions'],
            ) || options.maxAttempts,
          );

          nextPromptUrl = `${buildMountedUrl(req, options.apiBaseUrl, '/voice/prompt')}?taskId=${encodeURIComponent(refreshedNextSibling.id)}`
            + `&language=${encodeURIComponent(locale)}`
            + `&attempt=1`
            + `&maxAttempts=${nextMaxAttempts}`
            + `&medicationName=${encodeURIComponent(nextMedicationName)}`
            + `&taskType=${encodeURIComponent(nextTaskType)}`
            + `&timingState=${encodeURIComponent(nextTimingState)}`
            + `&subjectAlias=${encodeURIComponent(resolveSubjectAlias(refreshedNextSibling.metadata || {}))}`
            + `&assistantName=${encodeURIComponent(String(req.query.assistantName || 'Unid'))}`
            + `&scheduledAtLabel=${encodeURIComponent(nextScheduledAtLabel || '')}`
            + `&scheduledAtIso=${encodeURIComponent(nextScheduledAtIso || '')}`
            + `&voice=${encodeURIComponent(voice)}`;

          pushReminderLog({
            at: new Date().toISOString(),
            type: 'task-updated',
            taskId: refreshedNextSibling.id,
            details: { status: 'scheduled', reason: 'next-subtask-after-dtmf', partOf: parentId },
          });
        }
      }
      if (!parentId && nextStatus === 'completed') {
        allResolved = true;
      }
      const currentRootFlowFinished = (() => {
        if (parentId) return allResolved;
        return nextStatus === 'acknowledged' || nextStatus === 'completed' || nextStatus === 'cancelled';
      })();
      if (!nextPromptUrl && currentRootFlowFinished && currentTask) {
        const currentRootId = parentId || currentTask.id;
        const groupedRootIds = parseCsvValues(String(
          currentTask.metadata?.['voice-call-group-root-ids']
          || currentTask.metadata?.['voice-call-group-ids']
          || '',
        ));
        const currentGroupIndex = groupedRootIds.indexOf(currentRootId);
        if (groupedRootIds.length > 1 && currentGroupIndex >= 0) {
          for (let i = currentGroupIndex + 1; i < groupedRootIds.length; i += 1) {
            const candidateRootId = groupedRootIds[i];
            const candidateRoot = await options.taskService.getTask(candidateRootId);
            if (!candidateRoot || isResolvedStatus(candidateRoot.status)) continue;
            const selection = await taskOrchestrator.selectNextCallTask(candidateRoot);
            if (!('callTask' in selection) && selection.reason !== 'not-due') continue;

            // If this root is already inside the active grouped call chain, continue in-call
            // even when orchestrator marks it as not-due (for example, after prior no-input reschedules).
            const nextCallTask = ('callTask' in selection)
              ? selection.callTask
              : candidateRoot;
            const nextScheduledFor = new Date().toISOString();
            await options.taskService.scheduleTask({ taskId: nextCallTask.id, scheduledFor: nextScheduledFor });
            const refreshedNext = await options.taskService.getTask(nextCallTask.id) || nextCallTask;
            const nextBasedOnContext = resolveBasedOnContext(refreshedNext.metadata || {});
            const nextMedicationName = nextBasedOnContext.currentDisplay || refreshedNext.title || refreshedNext.description || 'your medication';
            nextReminderLabel = nextMedicationName;
            const nextTaskFocusOrBasedOn = String(
              nextBasedOnContext.currentReference
              || refreshedNext.metadata?.focus
              || refreshedNext.metadata?.['Task.based-on']
              || refreshedNext.metadata?.['based-on']
              || '',
            );
            const nextTaskType = resolveTaskType(String(refreshedNext.metadata?.type || ''), nextTaskFocusOrBasedOn);
            const nextEventAt = parseIsoDate(String(
              refreshedNext.metadata?.['event-at']
              || refreshedNext.metadata?.['due-at']
              || refreshedNext.scheduledFor
              || nextScheduledFor
              || '',
            ));
            const nextTimingState = resolveTimingState(nextEventAt);
            const nextScheduledAtLabel = toSpokenTimeLabel(nextEventAt, locale);
            const nextScheduledAtIso = nextEventAt?.toISOString();
            const nextMaxAttempts = Math.max(
              1,
              resolvePolicyValue(
                refreshedNext.metadata,
                candidateRoot.metadata,
                ['voice-max-attempts', 'max-attempts', 'restriction-repetitions', 'repetitions'],
              ) || options.maxAttempts,
            );
            nextPromptUrl = `${buildMountedUrl(req, options.apiBaseUrl, '/voice/prompt')}?taskId=${encodeURIComponent(refreshedNext.id)}`
              + `&language=${encodeURIComponent(locale)}`
              + `&attempt=1`
              + `&maxAttempts=${nextMaxAttempts}`
              + `&medicationName=${encodeURIComponent(nextMedicationName)}`
              + `&taskType=${encodeURIComponent(nextTaskType)}`
              + `&timingState=${encodeURIComponent(nextTimingState)}`
              + `&subjectAlias=${encodeURIComponent(resolveSubjectAlias(refreshedNext.metadata || {}))}`
              + `&assistantName=${encodeURIComponent(String(req.query.assistantName || 'Unid'))}`
              + `&scheduledAtLabel=${encodeURIComponent(nextScheduledAtLabel || '')}`
              + `&scheduledAtIso=${encodeURIComponent(nextScheduledAtIso || '')}`
              + `&voice=${encodeURIComponent(voice)}`;
            refreshedNext.metadata['voice-call-group-root-ids'] = groupedRootIds.join(',');
            refreshedNext.metadata['voice-call-group-current-root-id'] = candidateRootId;
            refreshedNext.updatedAt = new Date().toISOString();
            await options.taskService.getRepository().save(refreshedNext as any);
            allResolved = false;
            pushReminderLog({
              at: new Date().toISOString(),
              type: 'task-updated',
              taskId: refreshedNext.id,
              details: { status: 'scheduled', reason: 'next-root-after-dtmf', rootTaskId: candidateRootId },
            });
            break;
          }
        }
      }

      if (currentTask) {
        try {
          const rootTaskId = normalizePartOfReference(currentTask.metadata?.['part-of']) || currentTask.id;
          await trySendSummaryEmail(rootTaskId, currentTask.metadata || {});
        } catch (err: any) {
          pushReminderLog({
            at: new Date().toISOString(),
            type: 'task-updated',
            taskId,
            details: { status: 'error', reason: 'summary-email-check-failed', error: err?.message || 'unknown' },
          });
        }
      }

      let say = 'Invalid option.';
      if (nextStatus === 'acknowledged') say = getVoiceSystemText(locale, 'acknowledged');
      if (nextStatus === 'completed') say = getVoiceSystemText(locale, allResolved ? 'completed-all' : 'completed');
      if (nextStatus === 'cancelled') {
        if (taskType === 'medication') {
          say = getVoiceSystemText(locale, 'medication-issue-notified');
        } else {
          say = getVoiceSystemText(locale, 'cancelled');
        }
      }
      if (nextStatus === 'scheduled') say = getVoiceSystemText(locale, 'rescheduled');
      if (nextStatus === 'unknown') say = getVoiceSystemText(locale, 'invalid-option');
      res.set('Content-Type', 'text/xml');
      if (nextPromptUrl) {
        const transition = nextReminderLabel
          ? `${getVoiceSystemText(locale, 'next-reminder')}: ${nextReminderLabel}.`
          : `${getVoiceSystemText(locale, 'next-reminder')}.`;
        const chainedSay = `${say} ${transition}`.replace(/\s+/g, ' ').trim();
        return res.status(200).send(
          `<?xml version="1.0" encoding="UTF-8"?><Response><Say voice="${xmlEscape(voice)}" language="${xmlEscape(locale)}">${xmlEscape(chainedSay)}</Say><Redirect method="POST">${xmlEscape(nextPromptUrl)}</Redirect></Response>`,
        );
      }
      const goodbye = getVoiceSystemText(locale, 'goodbye');
      if (nextStatus === 'cancelled' && taskType === 'medication' && !allResolved) {
        const finalSay = say;
        return res.status(200).send(`<?xml version="1.0" encoding="UTF-8"?><Response><Say voice="${xmlEscape(voice)}" language="${xmlEscape(locale)}">${xmlEscape(finalSay)}</Say></Response>`);
      }
      const finalSay = `${say} ${goodbye}`.replace(/\s+/g, ' ').trim();
      return res.status(200).send(`<?xml version="1.0" encoding="UTF-8"?><Response><Say voice="${xmlEscape(voice)}" language="${xmlEscape(locale)}">${xmlEscape(finalSay)}</Say></Response>`);
    } catch (err: any) {
      pushReminderLog({
        at: new Date().toISOString(),
        type: 'voice-dtmf-received',
        taskId,
        details: { digits, nextStatus: 'error', error: err?.message || 'unknown' },
      });
      res.set('Content-Type', 'text/xml');
      return res.status(200).send(`<?xml version="1.0" encoding="UTF-8"?><Response><Say voice="${xmlEscape(voice)}" language="${xmlEscape(locale)}">${xmlEscape(getVoiceSystemText(locale, 'update-error'))}</Say></Response>`);
    }
  });

  // Voice status callback endpoint (initiated/ringing/answered/completed)
  router.post('/voice/status', express.urlencoded({ extended: false }), statusHandler);
  router.get('/voice/status', statusHandler);

  // Debug-only controller endpoint: read task/call logs.
  if (options.debugApiEnabled) {
    const getLogsHandler = async (req: express.Request, res: express.Response) => {
    const taskId = String(req.query.taskId || '').trim();
    const subject = String(req.query.subject || '').trim();
    const resultFormat = String(req.query.format || '').trim().toLowerCase();

    const logs = reminderLogs.filter((entry) => {
      if (taskId && entry.taskId !== taskId) return false;
      return true;
    });

    let tasks = [] as any[];
    try {
      tasks = await options.taskService.listTasks(subject ? { subjectId: subject } : undefined);
    } catch {
      tasks = [];
    }

    const responseBody: Record<string, unknown> = {
      totalLogs: logs.length,
      logs,
      tasks,
    };

    if (taskId) {
      responseBody.summaryMarkdown = buildMarkdownCallSummary(taskId, tasks, logs as ReminderLogEvent[]);
    }

    if (resultFormat === 'markdown' && taskId) {
      res.set('Content-Type', 'text/markdown; charset=utf-8');
      return res.status(200).send(String(responseBody.summaryMarkdown || ''));
    }

    return res.status(200).json(responseBody);
    };

    router.get('/logs', getLogsHandler);
    router.get('/_logs', getLogsHandler);
  }

  return router;
}
