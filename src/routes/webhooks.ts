// src/routes/webhooks.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

import * as express from 'express';
import * as stripe from 'stripe';
import { QueueAdapter } from '../adapters/queue';

export function assertStripeWebhookConfig(): void {
  const stripeEnabled = String(process.env.STRIPE_ENABLED || '').trim().toLowerCase() === 'true';
  if (stripeEnabled && (!process.env.STRIPE_SECRET_KEY || !process.env.STRIPE_WEBHOOK_SIGNING_SECRET)) {
    throw new Error(
      'STRIPE_ENABLED=true requires STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SIGNING_SECRET.',
    );
  }
}

/**
 * Creates a router for handling third-party webhooks, like Stripe.
 * @param queueAdapter The queue adapter for adding jobs.
 */
export function createWebhooksRouter(_queueAdapter: QueueAdapter): express.Router {
  const router = express.Router();

  const stripeEnabled = String(process.env.STRIPE_ENABLED || '').trim().toLowerCase() === 'true';

  if (!stripeEnabled) {
    console.info('[Webhooks] Stripe is disabled. /webhooks/stripe will not be mounted.');
    return router;
  }

  // Stripe is an optional integration surface. Once explicitly enabled, its
  // signing material is mandatory in every environment. startServer invokes
  // the same preflight before creating background workers.
  assertStripeWebhookConfig();

  const stripeSecretKey = process.env.STRIPE_SECRET_KEY!;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SIGNING_SECRET!;
  const stripeClient = new stripe.Stripe(stripeSecretKey, { apiVersion: '2026-02-25.clover' });


  router.post('/stripe', async (req, res) => {
    const sig = req.headers['stripe-signature'];
    const rawBody = (req as express.Request & { rawBody?: Buffer }).rawBody;

    let event: stripe.Stripe.Event;
    try {
      if (!rawBody) throw new Error('Raw request body is unavailable.');
      event = stripeClient.webhooks.constructEvent(rawBody, sig!, webhookSecret);
    } catch (err: any) {
      console.error(`[Stripe Webhook] Signature verification failed: ${err.message}`);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as stripe.Stripe.Checkout.Session;
        const tenantId = session.client_reference_id;
        const offerId = session.metadata?.offerId;

        if (!tenantId || !offerId) {
          console.error('[Stripe Webhook] Paid Checkout Session is missing tenant or Offer correlation metadata.');
          return res.status(200).json({ received: true, correlated: false });
        }

        // Payment completion is evidence, never authority to materialize a
        // seat. The portal must submit the correlated Order; its synchronous
        // verifier retrieves this Checkout Session and only then continues the
        // canonical Offer -> Order -> licence -> ledger transaction.
        console.log(`[Stripe Webhook] Paid Checkout Session '${session.id}' correlated to Offer '${offerId}' for tenant '${tenantId}'. Awaiting Order confirmation.`);
        break;
      }
      default:
        console.log(`[Stripe Webhook] Received unhandled event type ${event.type}`);
    }

    res.status(200).json({ received: true });
  });

  return router;
}
