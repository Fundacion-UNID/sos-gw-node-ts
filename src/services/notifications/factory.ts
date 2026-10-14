import { ConsoleEmailNotificationAdapter } from './ConsoleEmailNotificationAdapter.js';
import type { IEmailNotificationAdapter } from './IEmailNotificationAdapter.js';
import { SendGridEmailNotificationAdapter } from './SendGridEmailNotificationAdapter.js';
import { NotificationManager } from './NotificationManager.js';

export function createEmailNotificationAdapterFromEnv(env: NodeJS.ProcessEnv = process.env): IEmailNotificationAdapter {
  const provider = String(env.EMAIL_NOTIFICATION_PROVIDER || 'console').trim().toLowerCase();
  if (provider === 'sendgrid') {
    return new SendGridEmailNotificationAdapter(
      String(env.SENDGRID_API_KEY || ''),
      String(env.EMAIL_FROM || ''),
      String(env.EMAIL_FROM_NAME || '').trim() || undefined,
    );
  }
  return new ConsoleEmailNotificationAdapter();
}

export function createNotificationManagerFromEnv(env: NodeJS.ProcessEnv = process.env): NotificationManager {
  return new NotificationManager(createEmailNotificationAdapterFromEnv(env));
}

