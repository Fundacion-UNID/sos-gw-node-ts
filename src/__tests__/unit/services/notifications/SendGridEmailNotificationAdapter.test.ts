import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { SendGridEmailNotificationAdapter } from '../../../../services/notifications/SendGridEmailNotificationAdapter.js';

describe('SendGridEmailNotificationAdapter', () => {
  beforeEach(() => {
    (globalThis as any).fetch = undefined;
  });

  it('throws on missing constructor config', () => {
    expect(() => new SendGridEmailNotificationAdapter('', 'sender@example.org'))
      .toThrow('Missing SENDGRID_API_KEY');
    expect(() => new SendGridEmailNotificationAdapter('sg-key', ''))
      .toThrow('Missing EMAIL_FROM');
  });

  it('sends email payload to SendGrid and returns status/message id', async () => {
    const mockFetch = jest.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? '{}'));
      expect(body.personalizations[0].to[0].email).toBe('person@example.org');
      expect(body.personalizations[0].subject).toBe('Subject');
      expect(body.personalizations[0].custom_args).toEqual({ tenantId: 'tenant-a' });
      expect(body.from).toEqual({ email: 'sender@example.org', name: 'Sender Name' });
      expect(body.reply_to).toEqual({ email: 'reply@example.org' });
      expect(body.content).toEqual([
        { type: 'text/plain', value: 'Text body' },
        { type: 'text/html', value: '<p>HTML body</p>' },
      ]);
      return {
        ok: true,
        status: 202,
        headers: { get: (_key: string) => 'msg-123' },
      } as any;
    });
    (globalThis as any).fetch = mockFetch;

    const adapter = new SendGridEmailNotificationAdapter(
      'sg-key',
      'sender@example.org',
      'Sender Name',
    );
    const result = await adapter.send({
      to: 'person@example.org',
      subject: 'Subject',
      text: 'Text body',
      html: '<p>HTML body</p>',
      replyTo: 'reply@example.org',
      metadata: { tenantId: 'tenant-a' },
    });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.sendgrid.com/v3/mail/send',
      expect.objectContaining({
        method: 'POST',
        headers: {
          Authorization: 'Bearer sg-key',
          'Content-Type': 'application/json',
        },
      }),
    );
    expect(result).toEqual({
      provider: 'sendgrid',
      accepted: true,
      statusCode: 202,
      messageId: 'msg-123',
    });
  });

  it('throws on invalid payloads before network call', async () => {
    const mockFetch = jest.fn();
    (globalThis as any).fetch = mockFetch;
    const adapter = new SendGridEmailNotificationAdapter('sg-key', 'sender@example.org');

    await expect(adapter.send({ to: '', subject: 's', text: 'body' }))
      .rejects.toThrow('Missing recipient email (to)');
    await expect(adapter.send({ to: 'a@b.c', subject: '', text: 'body' }))
      .rejects.toThrow('Missing email subject');
    await expect(adapter.send({ to: 'a@b.c', subject: 's' }))
      .rejects.toThrow('Email body is required (text or html)');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('throws when SendGrid responds with error', async () => {
    const mockFetch = jest.fn(async () => ({
      ok: false,
      status: 400,
      text: async () => 'bad request',
      headers: { get: () => null },
    }));
    (globalThis as any).fetch = mockFetch;
    const adapter = new SendGridEmailNotificationAdapter('sg-key', 'sender@example.org');

    await expect(
      adapter.send({
        to: 'person@example.org',
        subject: 'Subject',
        text: 'Text',
      }),
    ).rejects.toThrow('SendGrid send failed (400): bad request');
  });
});

