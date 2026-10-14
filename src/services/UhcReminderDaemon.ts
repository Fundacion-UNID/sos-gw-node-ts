// Copyright 2025 Connecting Solution & Applications Ltd under the Apache License, Version 2.0.

import type { TaskRecord, TaskService } from 'tasks-core-node-ts';
import type { IPhoneAdapter } from '../adapters/phone/IPhoneAdapter.js';
import { UhcTaskOrchestrator } from './UhcTaskOrchestrator.js';
import { getVoiceBundle, getVoiceReminderCountIntro } from '../locales/voice/index.js';
import {
  UhcReminderActions,
  UhcReminderActorKinds,
  UhcReminderChannels,
  UhcReminderEntityKinds,
  decodeUhcReminderPermissionBundle,
  evaluateUhcReminderRuntimeAccess,
} from 'uhc-sdk-core-ts';

function toDate(value: string | undefined): Date | undefined {
  if (!value) return undefined;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return undefined;
  return parsed;
}

function resolveRoutingContext(task: TaskRecord): {
  tenantId: string;
  jurisdiction: string;
  sector: string;
  format: string;
} {
  const metadata = task.metadata || {};
  const tenantId = String(metadata['tenant-id'] || metadata['tenant'] || 'host').trim() || 'host';
  const jurisdiction = String(metadata.jurisdiction || 'ES').trim().toUpperCase() || 'ES';
  const sector = String(metadata.sector || 'test').trim() || 'test';
  const format = String(metadata.format || metadata['resource-format'] || 'org.hl7.fhir.api').trim() || 'org.hl7.fhir.api';
  return { tenantId, jurisdiction, sector, format };
}

export type ReminderRouteContext = {
  tenantId: string;
  jurisdiction: string;
  sector: string;
  format: string;
};

export type VoiceTargetResolution = {
  to?: string;
  source: 'subject-vault' | 'task-metadata' | 'none';
  reason?: string;
};

export type VoiceTargetResolver = (
  task: TaskRecord,
  route: ReminderRouteContext,
) => Promise<VoiceTargetResolution>;

function resolveTaskType(task: TaskRecord): 'medication' | 'appointment' | 'generic' {
  const metadata = task.metadata || {};
  const typeRaw = String(metadata.type || '').trim().toLowerCase();
  const focusRaw = String(metadata.focus || metadata['Task.based-on'] || metadata['based-on'] || '').trim().toLowerCase();
  if (typeRaw === 'appointment' || focusRaw.startsWith('appointment/')) return 'appointment';
  if (typeRaw === 'medication' || focusRaw.startsWith('medicationstatement/')) return 'medication';
  return 'generic';
}

function resolveTimingState(task: TaskRecord): 'future' | 'due_or_past' {
  const eventAt = String(task.metadata['event-at'] || task.metadata['due-at'] || task.scheduledFor || '').trim() || undefined;
  const due = toDate(eventAt);
  if (!due) return 'due_or_past';
  return due.getTime() > Date.now() ? 'future' : 'due_or_past';
}

function resolveLocale(task: TaskRecord, fallback: string): 'es-ES' | 'en-US' {
  const metadata = task.metadata || {};
  const raw = String(metadata.language || fallback || 'en').trim().toLowerCase();
  return raw.startsWith('es') ? 'es-ES' : 'en-US';
}

function resolveMedicationName(task: TaskRecord): string {
  const metadata = task.metadata || {};
  const displays = String(metadata['based-on-display'] || '').split(',').map((part) => part.trim()).filter(Boolean);
  if (displays.length > 0) return displays[0];
  const basedOn = String(metadata['based-on'] || metadata['Task.based-on'] || metadata.focus || '').trim();
  const first = basedOn.split(',').map((part) => part.trim()).filter(Boolean)[0];
  if (first) {
    const slash = first.lastIndexOf('/');
    return slash >= 0 ? first.slice(slash + 1) : first;
  }
  return task.title || task.description || 'your medication';
}

function resolveSubjectAlias(metadata: Record<string, unknown>): string {
  const alternateName = String(
    metadata['org.schema.Organization.alternateName']
      || metadata['Organization.alternateName']
      || '',
  ).trim();
  if (alternateName) return alternateName;
  return String(
    metadata['org.schema.Organization.name']
      || metadata['Organization.name']
      || '',
  ).trim();
}

function toSpokenTimeLabel(value: string | undefined, locale: 'es-ES' | 'en-US'): string | undefined {
  const parsed = toDate(value);
  if (!parsed) return undefined;
  return new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' }).format(parsed);
}

function parsePositiveInt(value: unknown): number | undefined {
  const parsed = parseInt(String(value ?? '').trim(), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
  return parsed;
}

function resolveRootMaxAttempts(root: TaskRecord, fallback: number): number {
  const md = root.metadata || {};
  return parsePositiveInt(md['max-attempts'])
    || parsePositiveInt(md['restriction-repetitions'])
    || parsePositiveInt(md.repetitions)
    || Math.max(1, fallback);
}

function buildReminderCountIntro(locale: 'es-ES' | 'en-US', pendingCount: number): string {
  return getVoiceReminderCountIntro(locale, pendingCount);
}

function buildCallIntroduction(
  locale: 'es-ES' | 'en-US',
  subjectAlias: string,
  pendingCount: number,
): string {
  const countIntro = buildReminderCountIntro(locale, pendingCount);
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

export interface UhcReminderDaemonOptions {
  taskService: TaskService;
  phoneAdapter: IPhoneAdapter;
  taskOrchestrator?: UhcTaskOrchestrator;
  voiceTargetResolver?: VoiceTargetResolver;
  apiBaseUrl: string;
  pollSeconds: number;
  enabled: boolean;
  voiceEnabled: boolean;
  maxAttempts: number;
  groupWindowMinutes: number;
  defaultLocale: string;
  defaultTtsVoice?: string;
}

/**
 * Server-side reminder daemon for production/staging.
 *
 * Scans scheduled tasks and starts voice calls automatically when `scheduledFor` is due.
 * Requires one of these metadata fields to route the call:
 * - `voice-to`
 * - `subject-phone`
 * - `owner-phone`
 */
export class UhcReminderDaemon {
  private readonly options: UhcReminderDaemonOptions;
  private readonly taskOrchestrator: UhcTaskOrchestrator;
  private timer: NodeJS.Timeout | undefined;
  private running = false;

  constructor(options: UhcReminderDaemonOptions) {
    this.options = options;
    this.taskOrchestrator = options.taskOrchestrator || new UhcTaskOrchestrator({ taskService: options.taskService });
  }

  private hasOpenVoiceCall(tasks: TaskRecord[]): boolean {
    return tasks.some((task) => String(task.metadata?.['voice-call-open'] || '').trim().toLowerCase() === 'true');
  }

  private async collectGroupedRootIds(rootTask: TaskRecord): Promise<string[]> {
    const subjectTasks = await this.options.taskService.listTasks({ subjectId: rootTask.subjectId });
    const roots = subjectTasks
      .filter((task) => this.taskOrchestrator.isRootTask(task))
      .filter((task) => task.status !== 'completed' && task.status !== 'cancelled' && task.status !== 'acknowledged');
    if (roots.length <= 1) return [rootTask.id];

    const baseAt = toDate(rootTask.scheduledFor || rootTask.createdAt);
    if (!baseAt) return [rootTask.id];
    const nowMs = Date.now();
    const baseIsDueOrPast = baseAt.getTime() <= nowMs;
    const windowMs = Math.max(0, this.options.groupWindowMinutes || 0) * 60_000;
    const grouped = roots
      .filter((candidate) => {
        const at = toDate(candidate.scheduledFor || candidate.createdAt);
        if (!at) return false;
        if (baseIsDueOrPast) {
          // When starting from a due/overdue reminder, include all unresolved roots
          // for this subject in the same call chain to avoid fragmented consecutive calls.
          return true;
        }
        return Math.abs(at.getTime() - baseAt.getTime()) <= windowMs;
      })
      .sort((left, right) => String(left.scheduledFor || left.createdAt || left.id).localeCompare(String(right.scheduledFor || right.createdAt || right.id)))
      .map((task) => task.id);
    if (!grouped.includes(rootTask.id)) grouped.unshift(rootTask.id);
    return grouped;
  }

  private async resolveVoiceTarget(task: TaskRecord, route: ReminderRouteContext): Promise<VoiceTargetResolution> {
    if (this.options.voiceTargetResolver) {
      try {
        const resolved = await this.options.voiceTargetResolver(task, route);
        if (resolved?.to) return resolved;
      } catch (err: any) {
        console.warn(`[UHC Reminder Daemon] voiceTargetResolver failed for task '${task.id}': ${err?.message || err}`);
      }
    }

    const metadataTo = task.metadata['voice-to'] || task.metadata['subject-phone'] || task.metadata['owner-phone'];
    if (metadataTo) {
      return { to: metadataTo, source: 'task-metadata' };
    }
    return { source: 'none', reason: 'voice-to/subject-phone/owner-phone not found and subject resolver returned none' };
  }

  start(): void {
    if (!this.options.enabled) {
      console.log('[UHC Reminder Daemon] disabled (CALL_REMINDER_DAEMON_ENABLED=false).');
      return;
    }
    if (!this.options.voiceEnabled) {
      console.log('[UHC Reminder Daemon] voice disabled (CALL_VOICE_ENABLED=false).');
      return;
    }
    if (this.timer) return;
    const pollMs = Math.max(5, this.options.pollSeconds || 30) * 1000;
    this.timer = setInterval(() => {
      void this.tick();
    }, pollMs);
    console.log(`[UHC Reminder Daemon] started (poll=${pollMs}ms).`);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
      console.log('[UHC Reminder Daemon] stopped.');
    }
  }

  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const now = new Date();
      const scheduledTasks = await this.options.taskService.listTasks({ status: 'scheduled' });
      const rootTasks = scheduledTasks.filter((task) => this.taskOrchestrator.isRootTask(task));
      // TODO(reminders-capacity): enforce host-global and per-tenant concurrent call limits here
      // before launching new provider calls. Current behavior is functional-first (no explicit limiter).
      for (const rootTask of rootTasks) {
        const due = toDate(rootTask.scheduledFor);
        if (!due || due > now) continue;
        const subjectTasksNow = await this.options.taskService.listTasks({ subjectId: rootTask.subjectId });
        if (this.hasOpenVoiceCall(subjectTasksNow)) continue;
        const selection = await this.taskOrchestrator.selectNextCallTask(rootTask);
        if (!('callTask' in selection)) continue;
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
          console.warn(
            `[UHC Reminder Daemon] task '${task.id}' denied for voice assistant `
            + `(reason=${permissionEvaluation.reason}).`,
          );
          continue;
        }

        const route = resolveRoutingContext(task);
        const target = await this.resolveVoiceTarget(task, route);
        const to = target.to;
        if (!to) {
          console.warn(`[UHC Reminder Daemon] task '${task.id}' has no voice target (${target.reason || 'unresolved target'}).`);
          continue;
        }

        try {
          const base = this.options.apiBaseUrl.replace(/\/$/, '');
          const taskBase = `${base}/${encodeURIComponent(route.tenantId)}/cds-${encodeURIComponent(route.jurisdiction)}/v1/${encodeURIComponent(route.sector)}/individual/${encodeURIComponent(route.format)}/Task`;
          const taskType = resolveTaskType(task);
          const timingState = resolveTimingState(task);
          const locale = resolveLocale(task, this.options.defaultLocale);
          const medicationName = resolveMedicationName(task);
          const subjectAlias = resolveSubjectAlias(task.metadata || {});
          const assistantName = String(task.metadata['assistant-name'] || 'Unid').trim() || 'Unid';
          const voice = String(task.metadata.voice || task.metadata['tts-voice'] || this.options.defaultTtsVoice || 'alice').trim() || 'alice';
          const eventAt = String(task.metadata['event-at'] || task.metadata['due-at'] || task.scheduledFor || '').trim() || undefined;
          const scheduledAtLabel = toSpokenTimeLabel(eventAt, locale) || '';
          const voiceBundle = getVoiceBundle(locale);
          const groupedRootIds = await this.collectGroupedRootIds(selection.rootTask);
          const introReminderCount = Math.max(selection.pendingReminderCount, groupedRootIds.length || 0);
          const introText = buildCallIntroduction(locale, subjectAlias, introReminderCount);
          const promptText = `${introText} ${stripLeadingGreetingFromPrompt(
            locale,
            voiceBundle.defaultPrompt({
              subjectAlias,
              medicationName,
              assistantName,
              taskType,
              timingState,
              scheduledAtLabel,
            }),
          )}`.replace(/\s+/g, ' ').trim();
          // Keep daemon and manual-call behavior aligned:
          // pass the same semantic context expected by /voice/dtmf classification
          // so DTMF 2 on medication due/past is treated as "scheduled" (retry later), not generic "acknowledged".
          const promptUrl = `${taskBase}/voice/prompt?taskId=${encodeURIComponent(task.id)}`
            + `&prompt=${encodeURIComponent(promptText)}`
            + `&language=${encodeURIComponent(locale)}`
            + `&attempt=1`
            + `&maxAttempts=${Math.max(1, this.options.maxAttempts)}`
            + `&medicationName=${encodeURIComponent(medicationName)}`
            + `&taskType=${encodeURIComponent(taskType)}`
            + `&timingState=${encodeURIComponent(timingState)}`
            + `&subjectAlias=${encodeURIComponent(subjectAlias)}`
            + `&assistantName=${encodeURIComponent(assistantName)}`
            + `&scheduledAtLabel=${encodeURIComponent(scheduledAtLabel)}`
            + `&voice=${encodeURIComponent(voice)}`;
          const statusCallbackUrl = `${taskBase}/voice/status?taskId=${encodeURIComponent(task.id)}`;
          const result = await this.options.phoneAdapter.startVoiceReminderCall({
            to,
            twimlUrl: promptUrl,
            statusCallbackUrl,
            correlationId: task.id,
          });
          const attemptCount = Math.max(0, parseInt(String(task.metadata['voice-attempt-count'] || '0'), 10) || 0) + 1;
          task.metadata['voice-attempt-count'] = String(attemptCount);
          task.metadata['voice-max-attempts'] = String(Math.max(1, this.options.maxAttempts));
          task.metadata['voice-call-sid'] = result.sid;
          task.metadata['voice-call-status'] = result.status;
          task.metadata['voice-call-to'] = to;
          task.metadata['voice-call-root-task-id'] = selection.rootTask.id;
          task.metadata['voice-call-target-source'] = target.source;
          task.metadata['voice-call-started-at'] = new Date().toISOString();
          task.metadata['voice-call-open'] = 'true';
          task.metadata['voice-call-locale'] = locale;
          task.metadata['voice-call-task-type'] = taskType;
          task.metadata['voice-call-timing-state'] = timingState;
          task.metadata['voice-call-group-root-ids'] = groupedRootIds.join(',');
          task.metadata['voice-call-group-current-root-id'] = selection.rootTask.id;
          task.metadata['voice-call-group-window-minutes'] = String(Math.max(0, this.options.groupWindowMinutes || 0));
          task.updatedAt = new Date().toISOString();

          await this.options.taskService.getRepository().save(task);

          const root = selection.rootTask;
          const rootAttempts = Math.max(0, parseInt(String(root.metadata['voice-call-attempt-count'] || '0'), 10) || 0) + 1;
          root.metadata['voice-call-attempt-count'] = String(rootAttempts);
          root.metadata['voice-call-max-attempts'] = String(resolveRootMaxAttempts(root, this.options.maxAttempts));
          root.metadata['voice-call-last-started-at'] = new Date().toISOString();
          root.updatedAt = new Date().toISOString();
          await this.options.taskService.getRepository().save(root);
          console.log(
            `[${new Date().toISOString()}] [UHC Reminder Daemon] voice call started `
            + `(root='${selection.rootTask.id}', task='${task.id}', sid=${result.sid}).`,
          );
        } catch (err: any) {
          console.error(`[${new Date().toISOString()}] [UHC Reminder Daemon] failed to start call for task '${task.id}': ${err?.message || err}`);
        }
      }
    } finally {
      this.running = false;
    }
  }
}
