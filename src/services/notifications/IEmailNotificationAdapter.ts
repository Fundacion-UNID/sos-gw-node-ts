import type { EmailNotificationPayload, EmailNotificationResult } from './types.js';

export interface IEmailNotificationAdapter {
  send(payload: EmailNotificationPayload): Promise<EmailNotificationResult>;
}

