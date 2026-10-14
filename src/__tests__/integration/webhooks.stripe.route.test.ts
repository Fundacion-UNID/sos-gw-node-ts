// Flow contract: optional Stripe ingress fails closed before background work and preserves Offer-to-Order ownership.
import request from 'supertest';
import { startServer, resetServerConfig } from '../../server';
import { QueueAdapterMem } from '../../adapters/queue-mem';
import Stripe from 'stripe';
import express from 'express';
import { createWebhooksRouter } from '../../routes/webhooks';
import { QueueAdapter } from '../../adapters/queue';

describe('stripe webhook route', () => {
  const previousEnv = process.env;
  const queueAdapters: QueueAdapterMem[] = [];

  afterEach(async () => {
    for (const queueAdapter of queueAdapters.splice(0)) {
      queueAdapter.stop();
    }
    process.env = previousEnv;
    resetServerConfig();
  });

  it('mounts Stripe webhook at /webhooks/stripe', async () => {
    process.env = {
      ...previousEnv,
      STRIPE_ENABLED: 'true',
      STRIPE_SECRET_KEY: 'sk_test_dummy',
      STRIPE_WEBHOOK_SIGNING_SECRET: 'whsec_dummy',
    };
    resetServerConfig();

    const { app, queueAdapter } = await startServer({ listen: false });
    if (queueAdapter instanceof QueueAdapterMem) {
      queueAdapters.push(queueAdapter);
    }

    const response = await request(app)
      .post('/webhooks/stripe')
      .set('Content-Type', 'application/json')
      .send({ id: 'evt_dummy', type: 'checkout.session.completed', data: { object: {} } });

    // Route should exist and fail on signature verification (400), not on missing endpoint (404).
    expect(response.status).toBe(400);
  });

  it('records paid Checkout evidence without bypassing Offer and Order', async () => {
    const signingSecret = 'whsec_test_offer_order';
    process.env = {
      ...previousEnv,
      STRIPE_ENABLED: 'true',
      STRIPE_SECRET_KEY: 'sk_test_dummy',
      STRIPE_WEBHOOK_SIGNING_SECRET: signingSecret,
    };
    resetServerConfig();

    const { app, queueAdapter } = await startServer({ listen: false });
    if (queueAdapter instanceof QueueAdapterMem) queueAdapters.push(queueAdapter);
    const addJob = jest.spyOn(queueAdapter, 'addJob');
    const payload = JSON.stringify({
      id: 'evt_paid_offer',
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_test_paid_offer',
          client_reference_id: 'tenant-unid',
          metadata: { offerId: 'urn:offer:employee-seat', quantity: '1' },
          payment_status: 'paid',
        },
      },
    });
    const signature = Stripe.webhooks.generateTestHeaderString({ payload, secret: signingSecret });

    const response = await request(app)
      .post('/webhooks/stripe')
      .set('Content-Type', 'application/json')
      .set('Stripe-Signature', signature)
      .send(payload);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ received: true });
    expect(addJob).not.toHaveBeenCalled();
  });

  it('keeps Stripe disabled in production unless explicitly enabled', async () => {
    process.env = {
      ...previousEnv,
      NODE_ENV: 'production',
      STRIPE_ENABLED: 'false',
    };
    delete process.env.STRIPE_SECRET_KEY;
    delete process.env.STRIPE_WEBHOOK_SIGNING_SECRET;
    const app = express();
    app.use('/webhooks', createWebhooksRouter({} as QueueAdapter));

    const response = await request(app).post('/webhooks/stripe').send({});
    expect(response.status).toBe(404);
  });

  it('fails closed when Stripe is explicitly enabled without both secrets', async () => {
    process.env = {
      ...previousEnv,
      STRIPE_ENABLED: 'true',
      STRIPE_SECRET_KEY: '',
      STRIPE_WEBHOOK_SIGNING_SECRET: '',
    };
    resetServerConfig();

    const intervalSpy = jest.spyOn(global, 'setInterval');
    try {
      await expect(startServer({ listen: false })).rejects.toThrow(
        /STRIPE_ENABLED=true requires STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SIGNING_SECRET/,
      );
      expect(intervalSpy).not.toHaveBeenCalled();
    } finally {
      intervalSpy.mockRestore();
    }
  });


  it('keeps the optional Stripe route disabled when it has not been enabled', async () => {
    process.env = {
      ...previousEnv,
      STRIPE_ENABLED: 'false',
      STRIPE_SECRET_KEY: '',
      STRIPE_WEBHOOK_SIGNING_SECRET: '',
    };
    resetServerConfig();

    const { app, queueAdapter } = await startServer({ listen: false });
    if (queueAdapter instanceof QueueAdapterMem) queueAdapters.push(queueAdapter);

    const response = await request(app).post('/webhooks/stripe').send({});
    expect(response.status).toBe(404);
  });

});
