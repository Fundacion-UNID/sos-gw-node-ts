import { HttpRequestMethods } from 'gdc-common-utils-ts/constants/http';
import type { IEmailNotificationAdapter } from './IEmailNotificationAdapter.js';
import type { EmailNotificationPayload, EmailNotificationResult } from './types.js';

const SENDGRID_API_URL = 'https://api.sendgrid.com/v3/mail/send';

export class SendGridEmailNotificationAdapter implements IEmailNotificationAdapter {
  constructor(
    private readonly apiKey: string,
    private readonly defaultFromEmail: string,
    private readonly defaultFromName?: string,
  ) {
    if (!this.apiKey) throw new Error('Missing SENDGRID_API_KEY');
    if (!this.defaultFromEmail) throw new Error('Missing EMAIL_FROM');
  }

  async send(payload: EmailNotificationPayload): Promise<EmailNotificationResult> {
    if (!payload.to) throw new Error('Missing recipient email (to)');
    if (!payload.subject) throw new Error('Missing email subject');
    if (!payload.text && !payload.html) throw new Error('Email body is required (text or html)');

    const content: Array<{ type: 'text/plain' | 'text/html'; value: string }> = [];
    if (payload.text) content.push({ type: 'text/plain', value: payload.text });
    if (payload.html) content.push({ type: 'text/html', value: payload.html });

    const body: Record<string, unknown> = {
      personalizations: [
        {
          to: [{ email: payload.to }],
          subject: payload.subject,
          ...(payload.metadata && Object.keys(payload.metadata).length > 0
            ? { custom_args: payload.metadata }
            : {}),
        },
      ],
      from: this.defaultFromName
        ? { email: this.defaultFromEmail, name: this.defaultFromName }
        : { email: this.defaultFromEmail },
      content,
      ...(payload.replyTo ? { reply_to: { email: payload.replyTo } } : {}),
    };

    const response = await fetch(SENDGRID_API_URL, {
      method: HttpRequestMethods.Post,
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    const messageId = response.headers.get('x-message-id') || undefined;
    if (!response.ok) {
      const details = await response.text().catch(() => '');
      throw new Error(`SendGrid send failed (${response.status}): ${details}`);
    }

    return {
      provider: 'sendgrid',
      accepted: true,
      statusCode: response.status,
      messageId,
    };
  }
}
