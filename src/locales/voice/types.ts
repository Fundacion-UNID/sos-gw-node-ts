export type VoiceLocale = 'es-ES' | 'en-US';
export type VoiceTaskType = 'medication' | 'appointment' | 'generic';
export type VoiceTimingState = 'future' | 'due_or_past';

export type VoiceSystemKey =
  | 'no-input'
  | 'missing-task-id'
  | 'invalid-option'
  | 'acknowledged'
  | 'completed'
  | 'completed-all'
  | 'cancelled'
  | 'update-error'
  | 'next-reminder'
  | 'rescheduled'
  | 'medication-issue-notified'
  | 'medication-taken-other-time-ask-hhmm'
  | 'medication-taken-other-time-ask-meridiem'
  | 'medication-taken-other-time-recorded'
  | 'medication-taken-other-time-invalid'
  | 'goodbye';

export interface VoicePromptContext {
  subjectAlias: string;
  medicationName: string;
  assistantName: string;
  taskType: VoiceTaskType;
  timingState: VoiceTimingState;
  scheduledAtLabel?: string;
  scheduledAtIso?: string;
}

export interface VoiceLocaleBundle {
  locale: VoiceLocale;
  system: Record<VoiceSystemKey, string>;
  defaultPrompt: (ctx: VoicePromptContext) => string;
  retryPrompt: (attempt: number, ctx: VoicePromptContext) => string;
}
