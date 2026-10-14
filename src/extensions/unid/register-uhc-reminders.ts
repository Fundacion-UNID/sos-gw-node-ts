// Copyright 2025 Connecting Solution & Applications Ltd under the Apache License, Version 2.0.

import type * as express from 'express';
import type { TaskService } from 'tasks-core-node-ts';
import type { IServerConfig } from '../../config';
import type { IVaultRepository } from '../../database/repositories/vault/vault.repository';
import type { IKmsService } from '../../gdc-backend-utils-node/models/IKmsService';
import type { TenantsCacheManager } from '../../managers/TenantsCacheManager';
import { createUhcTaskReminderRouter } from '../../routes/uhc-task-reminders';
import { UhcReminderDaemon } from '../../services/UhcReminderDaemon';
import { createSubjectVaultVoiceTargetResolver } from '../../services/SubjectVaultVoiceTargetResolver';
import { TwilioPhoneAdapter } from '../../adapters/phone/TwilioPhoneAdapter';
import { MockPhoneAdapter } from '../../adapters/phone/MockPhoneAdapter';
import { registerAddonRouters } from '../../bootstrap/register-addon-routers';

export function registerUhcReminderExtension(options: {
  app: express.Express;
  config: IServerConfig;
  taskService: TaskService;
  vaultRepository: IVaultRepository;
  kmsService: IKmsService;
  tenantManager: TenantsCacheManager;
}): void {
  const { app, config, taskService, vaultRepository, kmsService, tenantManager } = options;

  if (!config.tasksCore?.enabled) {
    console.log('[GW-API] UHC reminders disabled (CALL_REMINDERS_ENABLED=false).');
    return;
  }

  const twilioCfg = config.uhcTelephony?.twilio;
  const phoneAdapter =
    config.uhcTelephony?.provider === 'twilio' && twilioCfg?.accountSid && twilioCfg?.authToken
      ? new TwilioPhoneAdapter({
          accountSid: twilioCfg.accountSid,
          authToken: twilioCfg.authToken,
          apiKeySid: twilioCfg.apiKeySid,
          apiKeySecret: twilioCfg.apiKeySecret,
          messagingServiceSid: twilioCfg.messagingServiceSid || '',
          verifyServiceSid: twilioCfg.verifyServiceSid,
          voiceFromNumber: twilioCfg.voiceFromNumber,
        })
      : new MockPhoneAdapter();

  console.log(
    `[GW-API] UHC Telephony: using ${config.uhcTelephony?.provider === 'twilio' ? 'TwilioPhoneAdapter' : 'MockPhoneAdapter'}.`,
  );

  const voiceTargetResolver = createSubjectVaultVoiceTargetResolver({
    vaultRepository,
    kmsService,
    tenantsCacheManager: {
      getCollectionName: async (vaultId: string) => tenantManager.getCollectionName(vaultId),
    },
  });

  if (config.tasksCore.apiEnabled || config.uhcTelephony?.reminderDebugApiEnabled) {
    const uhcReminderRouter = createUhcTaskReminderRouter({
      taskService,
      phoneAdapter,
      apiBaseUrl: config.apiBaseUrl,
      voiceEnabled: config.uhcTelephony?.voiceEnabled === true,
      debugApiEnabled: config.uhcTelephony?.reminderDebugApiEnabled === true,
      consoleLogsEnabled: config.uhcTelephony?.reminderConsoleLogsEnabled === true,
      defaultTtsVoice: config.uhcTelephony?.defaultTtsVoice,
      maxAttempts: config.uhcTelephony?.maxAttempts || 3,
      retryIntervalMinutes: config.uhcTelephony?.retryIntervalMinutes || 30,
      groupWindowMinutes: config.uhcTelephony?.groupWindowMinutes || 5,
      autoRescheduleOnNoResponse: config.uhcTelephony?.autoRescheduleOnNoResponse !== false,
    });
    registerAddonRouters(app, [
      {
        // Reminder runtime contract:
        // - UHC reminder `Task` routes are tenant-scoped and mounted under `/:tenantId/...`.
        // - They are not part of the host registry contract.
        // - This keeps tenant individual operations separate from `/host/...`, which is
        //   reserved for tenant/network bootstrap and registry onboarding.
        mountPath: '/:tenantId/cds-:jurisdiction/v1/:sector/individual/:format/Task',
        router: uhcReminderRouter,
      },
    ]);
  }

  if (config.tasksCore.workerEnabled) {
    const reminderDaemon = new UhcReminderDaemon({
      taskService,
      phoneAdapter,
      voiceTargetResolver,
      apiBaseUrl: config.apiBaseUrl,
      pollSeconds: config.uhcTelephony?.reminderDaemonPollSeconds || 30,
      enabled: config.uhcTelephony?.reminderDaemonEnabled === true,
      voiceEnabled: config.uhcTelephony?.voiceEnabled === true,
      maxAttempts: config.uhcTelephony?.maxAttempts || 3,
      groupWindowMinutes: config.uhcTelephony?.groupWindowMinutes || 5,
      defaultLocale: config.uhcTelephony?.defaultLocale || 'en',
      defaultTtsVoice: config.uhcTelephony?.defaultTtsVoice,
    });
    reminderDaemon.start();
  }
}
