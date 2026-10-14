// src/routes/uhc-twilio-webhooks.ts
// Copyright 2025 Connecting Solution & Applications Ltd under the Apache License, Version 2.0.
//
// Twilio webhook handlers for UHC telephony:
//   POST /webhooks/twilio/sms/inbound   — handle replies from subjects (YES/NO/1/2)
//   POST /webhooks/twilio/sms/status    — handle delivery status updates
//
// SECURITY: All requests are validated with Twilio's HMAC-SHA1 signature
// before any processing (unless TWILIO_WEBHOOK_SIGNATURE_VALIDATION=false for local dev).
//
// These routes are UNID/UHC-only and must NOT be added to gwtemplate.

import * as express from 'express';
import type { IPhoneAdapter } from '../adapters/phone/IPhoneAdapter.js';

/**
 * Normalises a raw inbound SMS body to one of the well-known response tokens.
 * Returns `'complete'` | `'not-complete'` | `'unknown'`.
 */
function parseInboundResponse(body: string): 'complete' | 'not-complete' | 'unknown' {
  const normalised = (body ?? '').trim().toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  if (['SI', 'YES', 'Y', '1', 'OK', 'DONE', 'COMPLETADA', 'COMPLETADO', 'TOMA', 'TOMADA'].includes(normalised)) {
    return 'complete';
  }
  if (['NO', 'N', '2', 'NO TOMADA', 'NO TOMADO', 'CANCEL'].includes(normalised)) {
    return 'not-complete';
  }
  return 'unknown';
}


export interface UhcTwilioWebhookOptions {
  phoneAdapter: IPhoneAdapter;
  /** Public base URL of this server (used to reconstruct the full webhook URL for sig validation). */
  apiBaseUrl: string;
  /** When false, skip HMAC signature validation (local dev only). */
  signatureValidation: boolean;
  /**
   * Optional callback invoked after parsing an inbound SMS response.
   * Use this to trigger Task state transitions without coupling the route to managers.
   */
  onInboundResponse?: (event: TwilioInboundSmsEvent) => Promise<void>;
  /**
   * Optional callback invoked when Twilio posts a delivery status update.
   */
  onSmsStatus?: (event: TwilioSmsStatusEvent) => Promise<void>;
}

export interface TwilioInboundSmsEvent {
  messageSid: string;
  from: string;
  to: string;
  body: string;
  /** Parsed response token. */
  response: 'complete' | 'not-complete' | 'unknown';
  rawParams: Record<string, string>;
}

export interface TwilioSmsStatusEvent {
  messageSid: string;
  to: string;
  status: string;
  errorCode?: string;
  rawParams: Record<string, string>;
}

/**
 * Creates the Twilio UHC webhook router.
 * Mounted at `/webhooks` in server.ts (i.e. routes register as /webhooks/twilio/…).
 */
export function createUhcTwilioWebhooksRouter(options: UhcTwilioWebhookOptions): express.Router {
  const router = express.Router();

  function extractParams(req: express.Request): Record<string, string> {
    const body = req.body ?? {};
    const result: Record<string, string> = {};
    for (const key of Object.keys(body)) {
      result[key] = String(body[key] ?? '');
    }
    return result;
  }

  function validateSignature(req: express.Request, path: string): boolean {
    if (!options.signatureValidation) return true;
    const sig = String(req.headers['x-twilio-signature'] ?? '');
    const queryString = req.originalUrl.includes('?') ? req.originalUrl.slice(req.originalUrl.indexOf('?')) : '';
    const url = `${options.apiBaseUrl.replace(/\/$/, '')}${path}${queryString}`;
    const params = extractParams(req);
    return options.phoneAdapter.validateWebhookSignature(url, params, sig);
  }

  /**
   * POST /webhooks/twilio/sms/inbound
   * Twilio posts here when the subject replies to a reminder SMS.
   * Body (form-encoded): MessageSid, From, To, Body, …
   */
  router.post(
    '/twilio/sms/inbound',
    express.urlencoded({ extended: false }),
    async (req: express.Request, res: express.Response) => {
      const path = '/webhooks/twilio/sms/inbound';
      if (!validateSignature(req, path)) {
        console.warn('[UHC Twilio Webhook] Invalid signature on inbound SMS');
        return res.status(403).send('Forbidden: invalid webhook signature');
      }

      const params = extractParams(req);
      const event: TwilioInboundSmsEvent = {
        messageSid: params.MessageSid ?? params.SmsSid ?? '',
        from: params.From ?? '',
        to: params.To ?? '',
        body: params.Body ?? '',
        response: parseInboundResponse(params.Body ?? ''),
        rawParams: params,
      };

      console.log(`[UHC Twilio Webhook] Inbound SMS from=${event.from} response=${event.response} body="${event.body}"`);

      try {
        if (options.onInboundResponse) {
          await options.onInboundResponse(event);
        }
      } catch (err: any) {
        console.error('[UHC Twilio Webhook] onInboundResponse handler error:', err.message);
      }

      // Reply with empty TwiML — no auto-response to subject.
      res.set('Content-Type', 'text/xml');
      return res.status(200).send('<Response></Response>');
    },
  );

  /**
   * POST /webhooks/twilio/sms/status
   * Twilio posts here with delivery status updates (sent, delivered, failed, undelivered).
   * Body (form-encoded): MessageSid, MessageStatus, To, ErrorCode, …
   */
  router.post(
    '/twilio/sms/status',
    express.urlencoded({ extended: false }),
    async (req: express.Request, res: express.Response) => {
      const path = '/webhooks/twilio/sms/status';
      if (!validateSignature(req, path)) {
        console.warn('[UHC Twilio Webhook] Invalid signature on SMS status callback');
        return res.status(403).send('Forbidden: invalid webhook signature');
      }

      const params = extractParams(req);
      const event: TwilioSmsStatusEvent = {
        messageSid: params.MessageSid ?? '',
        to: params.To ?? '',
        status: params.MessageStatus ?? '',
        errorCode: params.ErrorCode || undefined,
        rawParams: params,
      };

      console.log(`[UHC Twilio Webhook] SMS status sid=${event.messageSid} status=${event.status}`);

      try {
        if (options.onSmsStatus) {
          await options.onSmsStatus(event);
        }
      } catch (err: any) {
        console.error('[UHC Twilio Webhook] onSmsStatus handler error:', err.message);
      }

      return res.status(204).end();
    },
  );

  return router;
}
