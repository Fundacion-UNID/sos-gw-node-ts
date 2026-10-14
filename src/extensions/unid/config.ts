// Copyright 2025 Connecting Solution & Applications Ltd under the Apache License, Version 2.0.

import type { IServerConfig } from '../../config';

function parseBooleanEnv(value: string | undefined, fallback = false): boolean {
  if (value === undefined) return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (normalized === 'true' || normalized === '1' || normalized === 'yes' || normalized === 'enabled') return true;
  if (normalized === 'false' || normalized === '0' || normalized === 'no' || normalized === 'disabled') return false;
  return fallback;
}

export function resolveUnidReminderConfig(nodeEnv: string): Pick<IServerConfig, 'tasksCore' | 'uhcTelephony'> {
  return {
    tasksCore: {
      enabled: parseBooleanEnv(process.env.CALL_REMINDERS_ENABLED, false),
      apiEnabled: parseBooleanEnv(process.env.CALL_REMINDERS_API_ENABLED, true),
      workerEnabled: parseBooleanEnv(process.env.CALL_REMINDERS_WORKER_ENABLED, true),
      fhirEnabled: parseBooleanEnv(process.env.CALL_REMINDERS_FHIR_ENABLED, true),
      csvEnabled: parseBooleanEnv(process.env.CALL_REMINDERS_CSV_ENABLED, true),
      defaultChannels: (process.env.CALL_REMINDERS_DEFAULT_CHANNELS || '')
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean),
      autoCloseMinutes: process.env.CALL_REMINDERS_AUTO_CLOSE_MINUTES
        ? parseInt(process.env.CALL_REMINDERS_AUTO_CLOSE_MINUTES, 10)
        : 120,
      confirmationRequiredDefault: parseBooleanEnv(process.env.CALL_REMINDERS_CONFIRMATION_REQUIRED_DEFAULT, true),
    },
    uhcTelephony: {
      provider: (process.env.CALL_TELEPHONY_PROVIDER === 'twilio' ? 'twilio' : 'mock') as 'twilio' | 'mock',
      smsEnabled: parseBooleanEnv(process.env.CALL_SMS_ENABLED, false),
      voiceEnabled: parseBooleanEnv(process.env.CALL_VOICE_ENABLED, false),
      verifyEnabled: parseBooleanEnv(process.env.CALL_VERIFY_ENABLED, false),
      maxAttempts: process.env.CALL_MAX_ATTEMPTS ? parseInt(process.env.CALL_MAX_ATTEMPTS, 10) : 3,
      retryIntervalMinutes: process.env.CALL_RETRY_INTERVAL_MINUTES
        ? parseInt(process.env.CALL_RETRY_INTERVAL_MINUTES, 10)
        : 30,
      autoRescheduleOnNoResponse: parseBooleanEnv(process.env.CALL_AUTO_RESCHEDULE_ON_NO_RESPONSE, true),
      escalationDelayMinutes: process.env.CALL_ESCALATION_DELAY_MINUTES
        ? parseInt(process.env.CALL_ESCALATION_DELAY_MINUTES, 10)
        : 60,
      reminderDebugApiEnabled: parseBooleanEnv(
        process.env.CALL_REMINDER_DEBUG_API_ENABLED,
        nodeEnv === 'demo' || nodeEnv === 'development',
      ),
      reminderConsoleLogsEnabled: parseBooleanEnv(process.env.CALL_REMINDER_CONSOLE_LOGS_ENABLED, false),
      reminderDaemonEnabled: parseBooleanEnv(process.env.CALL_REMINDER_DAEMON_ENABLED, false),
      reminderDaemonPollSeconds: process.env.CALL_REMINDER_DAEMON_POLL_SECONDS
        ? parseInt(process.env.CALL_REMINDER_DAEMON_POLL_SECONDS, 10)
        : 30,
      groupWindowMinutes: process.env.CALL_GROUP_WINDOW_MINUTES
        ? parseInt(process.env.CALL_GROUP_WINDOW_MINUTES, 10)
        : 5,
      defaultLocale: process.env.CALL_DEFAULT_LOCALE || 'en',
      defaultTtsVoice: process.env.CALL_TTS_VOICE || 'alice',
      twilio: {
        accountSid: process.env.TWILIO_ACCOUNT_SID,
        authToken: process.env.TWILIO_AUTH_TOKEN,
        apiKeySid: process.env.TWILIO_API_KEY_SID,
        apiKeySecret: process.env.TWILIO_API_KEY_SECRET,
        messagingServiceSid: process.env.TWILIO_MESSAGING_SERVICE_SID,
        voiceFromNumber: process.env.TWILIO_VOICE_FROM_NUMBER,
        voiceFlowSid: process.env.TWILIO_VOICE_FLOW_SID,
        verifyServiceSid: process.env.TWILIO_VERIFY_SERVICE_SID,
        webhookSignatureValidation: parseBooleanEnv(process.env.TWILIO_WEBHOOK_SIGNATURE_VALIDATION, true),
      },
    },
  };
}
