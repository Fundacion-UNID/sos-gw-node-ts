// src/adapters/phone/MockPhoneAdapter.ts
// Copyright 2025 Connecting Solution & Applications Ltd under the Apache License, Version 2.0.
//
// In-memory adapter used for test and demo environments.
// Stores sent messages and pending verifications so tests can assert outcomes
// without making real network calls.

import type {
  CheckVerifyOptions,
  CheckVerifyResult,
  IPhoneAdapter,
  SendSmsOptions,
  SendSmsResult,
  StartVoiceReminderCallOptions,
  StartVoiceReminderCallResult,
  StartVerifyOptions,
  StartVerifyResult,
} from './IPhoneAdapter.js';

let _idSeq = 0;
function nextId(prefix: string): string {
  return `${prefix}${String(++_idSeq).padStart(8, '0')}`;
}

export interface SentSmsRecord {
  sid: string;
  to: string;
  body: string;
  correlationId?: string;
  statusCallbackUrl?: string;
  sentAt: string;
}

export interface PendingVerification {
  to: string;
  code: string;
  channel: 'sms' | 'call';
  locale: string;
  createdAt: string;
}

export interface VoiceCallRecord {
  sid: string;
  to: string;
  twimlUrl: string;
  statusCallbackUrl?: string;
  correlationId?: string;
  createdAt: string;
}

/**
 * Mock phone adapter for unit/integration tests.
 *
 * Usage:
 *   const adapter = new MockPhoneAdapter({ fixedOtpCode: '123456' });
 *   // inspect sent messages:
 *   adapter.sentMessages
 *   // reset between tests:
 *   adapter.reset();
 */
export class MockPhoneAdapter implements IPhoneAdapter {
  readonly sentMessages: SentSmsRecord[] = [];
  readonly pendingVerifications: Map<string, PendingVerification> = new Map();
  readonly voiceCalls: VoiceCallRecord[] = [];

  private readonly fixedOtpCode: string;
  private readonly failNextSend: boolean;

  constructor(options: { fixedOtpCode?: string; failNextSend?: boolean } = {}) {
    this.fixedOtpCode = options.fixedOtpCode ?? '000000';
    this.failNextSend = options.failNextSend ?? false;
  }

  async sendSms(options: SendSmsOptions): Promise<SendSmsResult> {
    if (this.failNextSend) {
      throw new Error('[MockPhoneAdapter] Simulated send failure');
    }
    const sid = nextId('SM');
    this.sentMessages.push({
      sid,
      to: options.to,
      body: options.body,
      correlationId: options.correlationId,
      statusCallbackUrl: options.statusCallbackUrl,
      sentAt: new Date().toISOString(),
    });
    return { sid, status: 'queued', to: options.to };
  }

  async startVoiceReminderCall(options: StartVoiceReminderCallOptions): Promise<StartVoiceReminderCallResult> {
    const sid = nextId('CA');
    this.voiceCalls.push({
      sid,
      to: options.to,
      twimlUrl: options.twimlUrl,
      statusCallbackUrl: options.statusCallbackUrl,
      correlationId: options.correlationId,
      createdAt: new Date().toISOString(),
    });
    return { sid, status: 'queued', to: options.to };
  }

  async startVerify(options: StartVerifyOptions): Promise<StartVerifyResult> {
    const sid = nextId('VE');
    this.pendingVerifications.set(options.to, {
      to: options.to,
      code: this.fixedOtpCode,
      channel: options.channel ?? 'sms',
      locale: options.locale ?? 'en',
      createdAt: new Date().toISOString(),
    });
    return { sid, status: 'pending' };
  }

  async checkVerify(options: CheckVerifyOptions): Promise<CheckVerifyResult> {
    const pending = this.pendingVerifications.get(options.to);
    if (!pending) {
      return { valid: false, status: 'expired' };
    }
    const valid = pending.code === options.code;
    const status = valid ? 'approved' : 'pending';
    if (valid) {
      this.pendingVerifications.delete(options.to);
    }
    return { valid, status };
  }

  validateWebhookSignature(_url: string, _params: Record<string, string>, _signature: string): boolean {
    // In test mode always return true; tests can override by subclassing.
    return true;
  }

  reset(): void {
    this.sentMessages.length = 0;
    this.voiceCalls.length = 0;
    this.pendingVerifications.clear();
    _idSeq = 0;
  }
}
