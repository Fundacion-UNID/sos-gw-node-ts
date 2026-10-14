import type { IEmailNotificationAdapter } from './IEmailNotificationAdapter.js';
import type { EmailNotificationPayload, EmailNotificationResult } from './types.js';

export class ConsoleEmailNotificationAdapter implements IEmailNotificationAdapter {
  async send(payload: EmailNotificationPayload): Promise<EmailNotificationResult> {
    console.log('[EmailNotification][console]', JSON.stringify({
      to: payload.to,
      subject: payload.subject,
      from: payload.from,
      replyTo: payload.replyTo,
      metadata: payload.metadata,
      hasText: Boolean(payload.text),
      hasHtml: Boolean(payload.html),
    }));
    return { provider: 'console', accepted: true };
  }
}

