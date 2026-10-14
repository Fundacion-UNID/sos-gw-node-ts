// src/adapters/phone/TwilioPhoneAdapter.ts
// Copyright 2025 Connecting Solution & Applications Ltd under the Apache License, Version 2.0.
//
// Real Twilio implementation of IPhoneAdapter.
// Credentials come from config (never hardcoded).
// Webhook signature validation uses Twilio's HMAC-SHA1 scheme.

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
import twilio from 'twilio';
import type { Twilio } from 'twilio';

export interface TwilioPhoneAdapterConfig {
  /** Twilio Account SID (AC…). */
  accountSid: string;
  /**
   * Auth Token used only for webhook signature validation and Verify API calls.
   * For outbound SMS, prefer apiKeySid + apiKeySecret.
   */
  authToken: string;
  /** Optional: API Key SID (SK…) — more secure than raw Auth Token for message sending. */
  apiKeySid?: string;
  /** Optional: API Key Secret — required when apiKeySid is set. */
  apiKeySecret?: string;
  /** Messaging Service SID (MG…) — used as the `From` for outbound SMS. */
  messagingServiceSid: string;
  /** Verify Service SID (VA…) — required for OTP verification flows. */
  verifyServiceSid?: string;
  /** Voice caller-id capable Twilio number (E.164), required for outbound voice reminders. */
  voiceFromNumber?: string;
  // TODO(reminders-multi-tenant): support tenant-level Twilio subaccounts/credential pools.
  // For now the adapter instance is host-scoped (single account credentials).
}

export class TwilioPhoneAdapter implements IPhoneAdapter {
  private readonly client: Twilio;
  private readonly config: TwilioPhoneAdapterConfig;

  constructor(config: TwilioPhoneAdapterConfig) {
    this.config = config;
    // Use API Key credentials when available (scoped, revocable; preferred in prod).
    if (config.apiKeySid && config.apiKeySecret) {
      this.client = twilio(config.apiKeySid, config.apiKeySecret, {
        accountSid: config.accountSid,
      });
    } else {
      this.client = twilio(config.accountSid, config.authToken);
    }
  }

  async sendSms(options: SendSmsOptions): Promise<SendSmsResult> {
    const params: Parameters<Twilio['messages']['create']>[0] = {
      to: options.to,
      messagingServiceSid: this.config.messagingServiceSid,
      body: options.body,
    };
    if (options.statusCallbackUrl) {
      params.statusCallback = options.statusCallbackUrl;
    }

    const message = await this.client.messages.create(params);
    return {
      sid: message.sid,
      status: message.status as string,
      to: message.to,
    };
  }

  async startVoiceReminderCall(options: StartVoiceReminderCallOptions): Promise<StartVoiceReminderCallResult> {
    if (!this.config.voiceFromNumber) {
      throw new Error('[TwilioPhoneAdapter] TWILIO_VOICE_FROM_NUMBER is not configured.');
    }
    // TODO(reminders-capacity): this call does not enforce provider/global concurrency limits.
    // Capacity control should live in a dedicated call-limiter service used by daemon/router before invoking the adapter.

    const call = await this.client.calls.create({
      to: options.to,
      from: this.config.voiceFromNumber,
      url: options.twimlUrl,
      method: 'POST',
      statusCallback: options.statusCallbackUrl,
      statusCallbackMethod: options.statusCallbackUrl ? 'POST' : undefined,
      statusCallbackEvent: options.statusCallbackUrl ? ['initiated', 'ringing', 'answered', 'completed'] : undefined,
    });

    return {
      sid: call.sid,
      status: call.status as string,
      to: call.to,
    };
  }

  async startVerify(options: StartVerifyOptions): Promise<StartVerifyResult> {
    if (!this.config.verifyServiceSid) {
      throw new Error('[TwilioPhoneAdapter] TWILIO_VERIFY_SERVICE_SID is not configured.');
    }
    const verification = await this.client.verify.v2
      .services(this.config.verifyServiceSid)
      .verifications.create({
        to: options.to,
        channel: options.channel ?? 'sms',
        locale: options.locale ?? 'en',
      });
    return { sid: verification.sid, status: verification.status };
  }

  async checkVerify(options: CheckVerifyOptions): Promise<CheckVerifyResult> {
    if (!this.config.verifyServiceSid) {
      throw new Error('[TwilioPhoneAdapter] TWILIO_VERIFY_SERVICE_SID is not configured.');
    }
    const check = await this.client.verify.v2
      .services(this.config.verifyServiceSid)
      .verificationChecks.create({
        to: options.to,
        code: options.code,
      });
    return {
      valid: check.status === 'approved',
      status: check.status as CheckVerifyResult['status'],
    };
  }

  validateWebhookSignature(webhookUrl: string, params: Record<string, string>, signature: string): boolean {
    return twilio.validateRequest(this.config.authToken, signature, webhookUrl, params);
  }
}
