import type { IEmailNotificationAdapter } from './IEmailNotificationAdapter.js';
import type { EmailNotificationPayload, EmailNotificationResult } from './types.js';

export class NotificationManager {
  constructor(private readonly emailAdapter: IEmailNotificationAdapter) {}

  async sendEmail(payload: EmailNotificationPayload): Promise<EmailNotificationResult> {
    return this.emailAdapter.send(payload);
  }
}

