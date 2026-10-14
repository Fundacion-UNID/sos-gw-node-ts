import { describe, expect, it } from '@jest/globals';
import { ConsoleEmailNotificationAdapter } from '../../../../services/notifications/ConsoleEmailNotificationAdapter.js';
import { SendGridEmailNotificationAdapter } from '../../../../services/notifications/SendGridEmailNotificationAdapter.js';
import { createEmailNotificationAdapterFromEnv } from '../../../../services/notifications/factory.js';

describe('notifications factory', () => {
  it('builds console adapter by default', () => {
    const adapter = createEmailNotificationAdapterFromEnv({});
    expect(adapter).toBeInstanceOf(ConsoleEmailNotificationAdapter);
  });

  it('builds sendgrid adapter when configured', () => {
    const adapter = createEmailNotificationAdapterFromEnv({
      EMAIL_NOTIFICATION_PROVIDER: 'sendgrid',
      SENDGRID_API_KEY: 'sg-key',
      EMAIL_FROM: 'sender@example.org',
      EMAIL_FROM_NAME: 'Sender Name',
    });
    expect(adapter).toBeInstanceOf(SendGridEmailNotificationAdapter);
  });
});

