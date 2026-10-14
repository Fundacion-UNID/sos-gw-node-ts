import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { VoiceLocale, VoiceLocaleBundle, VoicePromptContext, VoiceSystemKey, VoiceTaskType } from './types.js';

type VoiceLocaleJson = {
  noInput: string;
  missingTaskId: string;
  invalidOption: string;
  acknowledged: string;
  completed: string;
  completedAll?: string;
  cancelled: string;
  updateError: string;
  goodbye?: string;
  introReminderSingular: string;
  introReminderPlural: string;
  retryAttemptPrefix2: string;
  retryAttemptPrefix3: string;
  retryGeneric: string;
  retryMedication: string;
  retryAppointment: string;
  promptGeneric: string;
  promptMedicationFuture: string;
  promptMedicationDueOrPast: string;
  promptAppointmentFuture: string;
  promptAppointmentDueOrPast: string;
};

function loadLocaleJson(relativePath: string): VoiceLocaleJson {
  const moduleDir = (() => {
    try {
      const metaUrl = Function('return import.meta.url')() as string;
      return dirname(fileURLToPath(metaUrl));
    } catch {
      if (typeof __dirname !== 'undefined') return __dirname;
      return join(process.cwd(), 'src/locales/voice');
    }
  })();
  const file = readFileSync(join(moduleDir, relativePath), 'utf8');
  return JSON.parse(file) as VoiceLocaleJson;
}

const localeJsonByLocale: Record<VoiceLocale, VoiceLocaleJson> = {
  'en-US': loadLocaleJson('../en-US/voice.json'),
  'es-ES': loadLocaleJson('../es-ES/voice.json'),
};

function renderTemplate(template: string, vars: Record<string, string | undefined>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, rawKey: string) => {
    const key = String(rawKey || '').trim();
    return String(vars[key] ?? '');
  });
}

function cleanupRenderedPrompt(text: string): string {
  return text
    .replace(/\bHola\s*,\s*/g, 'Hola ')
    .replace(/\bHello\s*,\s*/g, 'Hello ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseScheduledAtIso(value: string | undefined): Date | undefined {
  const raw = String(value || '').trim();
  if (!raw) return undefined;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return undefined;
  return parsed;
}

function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function relativeLocalDayOffset(date: Date): number {
  const oneDayMs = 24 * 60 * 60 * 1000;
  const now = new Date();
  const diff = startOfLocalDay(date).getTime() - startOfLocalDay(now).getTime();
  return Math.round(diff / oneDayMs);
}

function formatSpokenDate(locale: VoiceLocale, date: Date): string {
  if (locale === 'es-ES') {
    return new Intl.DateTimeFormat(locale, { weekday: 'long', day: '2-digit', month: 'long' }).format(date);
  }
  return new Intl.DateTimeFormat(locale, { weekday: 'long', month: 'long', day: 'numeric' }).format(date);
}

function formatSpokenTime(locale: VoiceLocale, date: Date): string {
  return new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' }).format(date);
}

function formatElapsedSince(locale: VoiceLocale, date: Date): string {
  const diffMs = Math.max(0, Date.now() - date.getTime());
  const totalMinutes = Math.floor(diffMs / 60_000);
  const days = Math.floor(totalMinutes / (24 * 60));
  const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
  const minutes = totalMinutes % 60;
  const parts: string[] = [];

  if (locale === 'es-ES') {
    if (days > 0) parts.push(`${days} ${days === 1 ? 'día' : 'días'}`);
    if (hours > 0) parts.push(`${hours} ${hours === 1 ? 'hora' : 'horas'}`);
    if (minutes > 0 || parts.length === 0) parts.push(`${minutes} ${minutes === 1 ? 'minuto' : 'minutos'}`);
    return `hace ${parts.join(', ')}`;
  }

  if (days > 0) parts.push(`${days} ${days === 1 ? 'day' : 'days'}`);
  if (hours > 0) parts.push(`${hours} ${hours === 1 ? 'hour' : 'hours'}`);
  if (minutes > 0 || parts.length === 0) parts.push(`${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`);
  return `${parts.join(', ')} ago`;
}

function buildScheduledAtClause(locale: VoiceLocale, ctx: VoicePromptContext): string {
  const scheduledAt = parseScheduledAtIso(ctx.scheduledAtIso);
  const timeLabel = ctx.scheduledAtLabel || (scheduledAt ? formatSpokenTime(locale, scheduledAt) : '');
  if (!timeLabel) return '';

  if (scheduledAt) {
    const dayOffset = relativeLocalDayOffset(scheduledAt);
    if (locale === 'es-ES') {
      if (ctx.timingState === 'future') {
        if (dayOffset === 1) return ` mañana a las ${timeLabel}`;
        return ` el ${formatSpokenDate(locale, scheduledAt)} a las ${timeLabel}`;
      }
      if (dayOffset === -1) return ` que fue ayer a las ${timeLabel} (${formatElapsedSince(locale, scheduledAt)})`;
      return ` que fue el ${formatSpokenDate(locale, scheduledAt)} a las ${timeLabel} (${formatElapsedSince(locale, scheduledAt)})`;
    }
    if (ctx.timingState === 'future') {
      if (dayOffset === 1) return ` tomorrow at ${timeLabel}`;
      return ` on ${formatSpokenDate(locale, scheduledAt)} at ${timeLabel}`;
    }
    if (dayOffset === -1) return ` which was yesterday at ${timeLabel} (${formatElapsedSince(locale, scheduledAt)})`;
    return ` which was on ${formatSpokenDate(locale, scheduledAt)} at ${timeLabel} (${formatElapsedSince(locale, scheduledAt)})`;
  }

  if (locale === 'es-ES') {
    return ctx.timingState === 'future'
      ? ` a las ${timeLabel}`
      : ` que era a las ${timeLabel}`;
  }
  return ctx.timingState === 'future'
    ? ` at ${timeLabel}`
    : ` which was at ${timeLabel}`;
}

function getDefaultPromptTemplate(localeJson: VoiceLocaleJson, ctx: VoicePromptContext): string {
  if (ctx.taskType === 'medication' && ctx.timingState === 'future') return localeJson.promptMedicationFuture;
  if (ctx.taskType === 'medication') return localeJson.promptMedicationDueOrPast;
  if (ctx.taskType === 'appointment' && ctx.timingState === 'future') return localeJson.promptAppointmentFuture;
  if (ctx.taskType === 'appointment') return localeJson.promptAppointmentDueOrPast;
  return localeJson.promptGeneric;
}

function getRetryOptions(localeJson: VoiceLocaleJson, taskType: VoiceTaskType): string {
  if (taskType === 'medication') return localeJson.retryMedication;
  if (taskType === 'appointment') return localeJson.retryAppointment;
  return localeJson.retryGeneric;
}

function createVoiceLocaleBundle(locale: VoiceLocale): VoiceLocaleBundle {
  const localeJson = localeJsonByLocale[locale];
  const system: Record<VoiceSystemKey, string> = {
    'no-input': localeJson.noInput,
    'missing-task-id': localeJson.missingTaskId,
    'invalid-option': localeJson.invalidOption,
    acknowledged: localeJson.acknowledged,
    completed: localeJson.completed,
    'completed-all': localeJson.completedAll || localeJson.completed,
    cancelled: localeJson.cancelled,
    'update-error': localeJson.updateError,
    'next-reminder': (localeJson as any).nextReminder || (locale === 'es-ES' ? 'Siguiente recordatorio' : 'Next reminder'),
    rescheduled: (localeJson as any).rescheduled || (locale === 'es-ES' ? 'Agenda actualizada. Volveré a llamar más adelante.' : 'Schedule updated. I will call you again later.'),
    'medication-issue-notified': (localeJson as any).medicationIssueNotified || (locale === 'es-ES' ? 'Se notificará el problema con la medicación.' : 'The medication issue will be notified.'),
    'medication-taken-other-time-ask-hhmm': (localeJson as any).medicationTakenOtherTimeAskHhmm
      || (locale === 'es-ES'
        ? 'Entendido. Indique la hora en que la tomó con 4 dígitos.'
        : 'Understood. Enter the time you took it using 4 digits.'),
    'medication-taken-other-time-ask-meridiem': (localeJson as any).medicationTakenOtherTimeAskMeridiem
      || (locale === 'es-ES'
        ? 'Si fue antes del mediodía pulse 1. Si fue después del mediodía pulse 2.'
        : 'If it was before noon, press 1. If it was after noon, press 2.'),
    'medication-taken-other-time-recorded': (localeJson as any).medicationTakenOtherTimeRecorded
      || (locale === 'es-ES'
        ? 'Gracias. He registrado que la tomó en una hora distinta.'
        : 'Thank you. I recorded that you took it at a different time.'),
    'medication-taken-other-time-invalid': (localeJson as any).medicationTakenOtherTimeInvalid
      || (locale === 'es-ES'
        ? 'No se pudo interpretar la hora indicada.'
        : 'I could not understand the time entered.'),
    goodbye: localeJson.goodbye || (locale === 'es-ES' ? '¡Hasta luego!' : 'Goodbye.'),
  };
  return {
    locale,
    system,
    defaultPrompt: (ctx: VoicePromptContext) => cleanupRenderedPrompt(renderTemplate(
      getDefaultPromptTemplate(localeJson, ctx),
      {
        subjectAlias: ctx.subjectAlias,
        assistantName: ctx.assistantName,
        medicationName: ctx.medicationName,
        scheduledAtClause: buildScheduledAtClause(locale, ctx),
      },
    )),
    retryPrompt: (attempt: number, ctx: VoicePromptContext) => {
      const options = getRetryOptions(localeJson, ctx.taskType);
      if (attempt <= 1) return options;
      if (attempt === 2) return `${localeJson.retryAttemptPrefix2}${options}`;
      return `${localeJson.retryAttemptPrefix3}${options}`;
    },
  };
}

const bundles: Record<VoiceLocale, VoiceLocaleBundle> = {
  'en-US': createVoiceLocaleBundle('en-US'),
  'es-ES': createVoiceLocaleBundle('es-ES'),
};

export function resolveVoiceLocale(value: string | undefined): VoiceLocale {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized.startsWith('es')) return 'es-ES';
  return 'en-US';
}

export function getVoiceBundle(locale: VoiceLocale): VoiceLocaleBundle {
  return bundles[locale] || bundles['en-US'];
}

export function getVoiceSystemText(locale: VoiceLocale, key: VoiceSystemKey): string {
  return getVoiceBundle(locale).system[key];
}

export function getVoiceReminderCountIntro(locale: VoiceLocale, pendingCount: number): string {
  const localeJson = localeJsonByLocale[locale] || localeJsonByLocale['en-US'];
  const count = Number.isFinite(pendingCount) ? Math.max(1, Math.floor(pendingCount)) : 1;
  if (count === 1) return localeJson.introReminderSingular;
  return cleanupRenderedPrompt(renderTemplate(localeJson.introReminderPlural, { count: String(count) }));
}
