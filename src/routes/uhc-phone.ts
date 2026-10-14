// src/routes/uhc-phone.ts
// Copyright 2025 Connecting Solution & Applications Ltd under the Apache License, Version 2.0.
//
// UHC-specific endpoints for:
//   POST /uhc/phone/verify/start    — send OTP to subject's phone (enrollment)
//   POST /uhc/phone/verify/confirm  — validate OTP code submitted by caregiver
//
// These endpoints are UNID/UHC-only and not part of gwtemplate base.
// Authentication: Bearer token (demo or Firebase) via standard gateway middleware.

import * as express from 'express';
import type { IPhoneAdapter } from '../adapters/phone/IPhoneAdapter.js';

const E164_RE = /^\+[1-9]\d{6,14}$/;

function isValidE164(phone: string): boolean {
  return E164_RE.test(phone.trim());
}

export interface UhcPhoneRouterOptions {
  phoneAdapter: IPhoneAdapter;
  isVerifyEnabled: boolean;
  defaultLocale: string;
}

/**
 * Creates the UHC phone-verification router.
 * Mounted at `/uhc/phone` in server.ts when `CALL_VERIFY_ENABLED=true`.
 */
export function createUhcPhoneRouter(options: UhcPhoneRouterOptions): express.Router {
  const router = express.Router();

  if (!options.isVerifyEnabled) {
    console.warn('[UHC Phone] Phone verification is disabled (CALL_VERIFY_ENABLED=false).');
    return router;
  }

  /**
   * POST /uhc/phone/verify/start
   * Body: { phone: "+15140001234", channel?: "sms"|"call", locale?: "es"|"en"|"fr" }
   *
   * Initiates an OTP send to the subject's phone number.
   * The caregiver/guardian confirms the code physically with the subject.
   */
  router.post('/verify/start', express.json(), async (req: express.Request, res: express.Response) => {
    const { phone, channel, locale } = req.body ?? {};

    if (typeof phone !== 'string' || !isValidE164(phone)) {
      return res.status(400).json({
        error: 'invalid_phone',
        message: 'phone must be a valid E.164 number (e.g. +15140001234).',
      });
    }

    const allowedChannel = channel === 'call' ? 'call' : 'sms';
    const resolvedLocale = typeof locale === 'string' && locale.trim()
      ? locale.trim()
      : options.defaultLocale;

    try {
      const result = await options.phoneAdapter.startVerify({
        to: phone,
        channel: allowedChannel,
        locale: resolvedLocale,
      });
      console.log(`[UHC Phone] Verify started for ${phone} via ${allowedChannel} (sid=${result.sid})`);
      return res.status(200).json({
        status: result.status,
        sid: result.sid,
        channel: allowedChannel,
      });
    } catch (err: any) {
      console.error('[UHC Phone] startVerify error:', err.message);
      return res.status(502).json({
        error: 'provider_error',
        message: 'Could not send verification code. Check phone number and try again.',
      });
    }
  });

  /**
   * POST /uhc/phone/verify/confirm
   * Body: { phone: "+15140001234", code: "123456" }
   *
   * Validates the OTP. Returns verified=true on success.
   * Callers should persist `Person.phone-verified=true` and `Person.phone-verified-at`
   * in the subject's claims after a successful response.
   */
  router.post('/verify/confirm', express.json(), async (req: express.Request, res: express.Response) => {
    const { phone, code } = req.body ?? {};

    if (typeof phone !== 'string' || !isValidE164(phone)) {
      return res.status(400).json({
        error: 'invalid_phone',
        message: 'phone must be a valid E.164 number.',
      });
    }
    if (typeof code !== 'string' || !/^\d{4,8}$/.test(code.trim())) {
      return res.status(400).json({
        error: 'invalid_code',
        message: 'code must be 4–8 digits.',
      });
    }

    try {
      const result = await options.phoneAdapter.checkVerify({ to: phone, code: code.trim() });
      console.log(`[UHC Phone] Verify check for ${phone}: valid=${result.valid} status=${result.status}`);
      return res.status(200).json({
        verified: result.valid,
        status: result.status,
        phone,
        verifiedAt: result.valid ? new Date().toISOString() : undefined,
      });
    } catch (err: any) {
      console.error('[UHC Phone] checkVerify error:', err.message);
      return res.status(502).json({
        error: 'provider_error',
        message: 'Could not validate code. Please try again.',
      });
    }
  });

  return router;
}
