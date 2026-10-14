import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { ConsoleEmailNotificationAdapter } from '../../../../services/notifications/ConsoleEmailNotificationAdapter.js';

describe('ConsoleEmailNotificationAdapter', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('logs normalized payload data and accepts the message', async () => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    const adapter = new ConsoleEmailNotificationAdapter();

    const result = await adapter.send({
      to: 'employee@example.org',
      subject: 'Welcome',
      text: 'Body',
      metadata: { tenantId: 'tenant-a' },
    });

    expect(result).toEqual({ provider: 'console', accepted: true });
    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(logSpy).toHaveBeenCalledWith(
      '[EmailNotification][console]',
      expect.stringContaining('"to":"employee@example.org"'),
    );
  });
});

