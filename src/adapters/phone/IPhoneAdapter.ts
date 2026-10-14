// src/adapters/phone/IPhoneAdapter.ts
// Copyright 2025 Connecting Solution & Applications Ltd under the Apache License, Version 2.0.
//
// Provider-agnostic contract for outbound SMS / voice and phone-number verification (OTP).
// All UHC telephony flows go through this interface so the underlying provider (Twilio,
// Sinch, etc.) can be swapped without touching business logic.

export interface SendSmsOptions {
  to: string;
  body: string;
  /** Provider-level tag to correlate message with a Task or enrollment record. */
  correlationId?: string;
  /** Absolute URL Twilio (or equivalent) must POST status updates to. */
  statusCallbackUrl?: string;
}

export interface SendSmsResult {
  /** Provider-assigned message identifier (e.g. Twilio MessageSID `SM…`). */
  sid: string;
  /** Delivery status at send time (queued, sent, delivered, failed…). */
  status: string;
  to: string;
}

export interface StartVoiceReminderCallOptions {
  /** E.164 destination number. */
  to: string;
  /** Absolute URL Twilio will request to fetch the TwiML instructions. */
  twimlUrl: string;
  /** Optional callback URL for call status events. */
  statusCallbackUrl?: string;
  /** Optional provider correlation tag. */
  correlationId?: string;
}

export interface StartVoiceReminderCallResult {
  sid: string;
  status: string;
  to: string;
}

export interface StartVerifyOptions {
  /** E.164 phone number to send the OTP to. */
  to: string;
  /** `sms` or `call`; defaults to `sms`. */
  channel?: 'sms' | 'call';
  /** BCP-47 locale for the OTP message (e.g. `es`, `en`, `fr`). */
  locale?: string;
}

export interface StartVerifyResult {
  /** Provider-assigned verification SID. */
  sid: string;
  status: string;
}

export interface CheckVerifyOptions {
  to: string;
  code: string;
}

export interface CheckVerifyResult {
  /** `true` if the code was correct and the check passed. */
  valid: boolean;
  status: 'approved' | 'pending' | 'expired' | 'max_attempts_reached';
}

export interface IPhoneAdapter {
  /**
   * Send an outbound SMS.
   * Used for care reminders (medication, appointment) and escalation notices.
   */
  sendSms(options: SendSmsOptions): Promise<SendSmsResult>;

  /**
   * Start an outbound voice reminder call.
   * The provider will fetch TwiML from `twimlUrl`, play the prompt and gather DTMF.
   */
  startVoiceReminderCall(options: StartVoiceReminderCallOptions): Promise<StartVoiceReminderCallResult>;

  /**
   * Initiate a phone-number verification (OTP).
   * Used during enrollment to verify the subject's phone number before
   * enabling SMS/voice reminders.
   */
  startVerify(options: StartVerifyOptions): Promise<StartVerifyResult>;

  /**
   * Check an OTP code submitted by the user/caregiver.
   */
  checkVerify(options: CheckVerifyOptions): Promise<CheckVerifyResult>;

  /**
   * Validate a Twilio (or provider) webhook signature.
   * MUST be called before processing any inbound webhook payload.
   *
   * @param webhookUrl  Full public URL of the receiving endpoint.
   * @param params      POST body as key-value map.
   * @param signature   Value of the `X-Twilio-Signature` header.
   */
  validateWebhookSignature(webhookUrl: string, params: Record<string, string>, signature: string): boolean;
}
