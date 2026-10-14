export type EmailNotificationPayload = {
  to: string;
  subject: string;
  text?: string;
  html?: string;
  from?: string;
  replyTo?: string;
  metadata?: Record<string, string>;
};

export type EmailNotificationResult = {
  provider: 'console' | 'sendgrid';
  accepted: boolean;
  messageId?: string;
  statusCode?: number;
};

