// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.
// File: src/utils/order-communication.ts

import stripe from 'stripe';
import { v4 as uuidv4 } from 'uuid';
import { ClaimsOfferSchemaorg } from 'gdc-common-utils-ts/constants/schemaorg';

interface PaymentContext {
  offerId: string;
  tenantId: string;
  tenantDid: string;
  senderDid: string;
  quantity?: number;
  price?: string;
  currency?: string;
  now?: Date;
  email?: string;
  legalName?: string;
  addressCountry?: string;
  addressRegion?: string;
  addressLocality?: string;
  postalCode?: string;
  streetAddress?: string;
  activationCode?: string;
  activationCategory?: string;
  paymentMethod?: string;
  paymentUrl?: string;
  invoiceId?: string;
  paymentConfirmed?: boolean;
}

interface PaymentCommunicationResult {
  communicationId: string;
  paymentUrl: string;
  claims: Record<string, any>;
}

function stripeIsConfigured(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY);
}

function isStripeInvoiceEnabled(): boolean {
  return (process.env.INVOICE_PROVIDER || 'internal').toLowerCase() === 'stripe';
}

function isStripePaymentEnabled(): boolean {
  return (process.env.PAYMENT_PROVIDER || 'stripe').toLowerCase() === 'stripe';
}

function stripeTaxEnabled(): boolean {
  return String(process.env.STRIPE_TAX_ENABLED || '').toLowerCase() === 'true';
}

function invoiceFlow(): 'pre' | 'post' {
  return (process.env.INVOICE_FLOW || 'pre').toLowerCase() === 'post' ? 'post' : 'pre';
}

function toStripeAmount(price: string | undefined): number | undefined {
  if (!price) return undefined;
  const parsed = Number(price);
  if (!Number.isFinite(parsed) || parsed < 0) return undefined;
  return Math.round(parsed * 100);
}

async function createStripeCheckoutUrl(
  context: PaymentContext,
): Promise<string> {
  if (!stripeIsConfigured() || !isStripePaymentEnabled()) return '';
  if (!process.env.STRIPE_SUCCESS_URL || !process.env.STRIPE_CANCEL_URL) return '';
  const amount = toStripeAmount(context.price);
  if (!amount || amount <= 0) return '';

  const stripeClient = new stripe.Stripe(process.env.STRIPE_SECRET_KEY!, {
    apiVersion: '2026-02-25.clover',
  });

  const session = await stripeClient.checkout.sessions.create({
    mode: 'payment',
    success_url: process.env.STRIPE_SUCCESS_URL!,
    cancel_url: process.env.STRIPE_CANCEL_URL!,
    client_reference_id: context.tenantId,
    metadata: {
      quantity: String(context.quantity ?? 1),
      offerId: context.offerId,
    },
    automatic_tax: { enabled: stripeTaxEnabled() },
    line_items: [
      {
        quantity: context.quantity ?? 1,
        price_data: {
          currency: (context.currency || 'EUR').toLowerCase(),
          unit_amount: amount,
          product_data: {
            name: 'License purchase',
          },
        },
      },
    ],
  });

  return session.url || '';
}

async function createStripeInvoice(
  context: PaymentContext,
): Promise<{ paymentUrl: string; invoiceId: string; paymentDueDate?: string }> {
  if (!stripeIsConfigured() || !isStripeInvoiceEnabled()) {
    return { paymentUrl: '', invoiceId: '' };
  }
  const amount = toStripeAmount(context.price);
  if (!amount || amount <= 0) {
    return { paymentUrl: '', invoiceId: '' };
  }

  const stripeClient = new stripe.Stripe(process.env.STRIPE_SECRET_KEY!, {
    apiVersion: '2026-02-25.clover',
  });

  const customer = await stripeClient.customers.create({
    name: context.legalName || context.tenantId,
    email: context.email,
    address: context.addressCountry
      ? {
          country: context.addressCountry,
          state: context.addressRegion,
          city: context.addressLocality,
          postal_code: context.postalCode,
          line1: context.streetAddress,
        }
      : undefined,
    metadata: {
      tenantId: context.tenantId,
      offerId: context.offerId,
    },
  });

  await stripeClient.invoiceItems.create({
    customer: customer.id,
    currency: (context.currency || 'EUR').toLowerCase(),
    quantity: context.quantity ?? 1,
    amount: amount,
    description: 'License purchase',
  });

  const draftInvoice = await stripeClient.invoices.create({
    customer: customer.id,
    collection_method: 'send_invoice',
    days_until_due: 7,
    auto_advance: true,
    automatic_tax: { enabled: stripeTaxEnabled() },
    metadata: {
      tenantId: context.tenantId,
      offerId: context.offerId,
    },
  });

  const finalized = await stripeClient.invoices.finalizeInvoice(draftInvoice.id);
  const paymentUrl = finalized.hosted_invoice_url || '';
  const paymentDueDate = finalized.due_date
    ? new Date(finalized.due_date * 1000).toISOString()
    : undefined;
  return { paymentUrl, invoiceId: finalized.id, paymentDueDate };
}

export async function buildPaymentCommunication(
  context: PaymentContext,
): Promise<PaymentCommunicationResult> {
  const now = context.now || new Date();
  let paymentUrl = context.paymentUrl || '';
  let invoiceId = context.invoiceId || '';
  let paymentMethod = context.paymentMethod || '';
  let paymentDueDate: string | undefined;

  if (!context.paymentConfirmed && !paymentUrl && !invoiceId && isStripeInvoiceEnabled() && stripeIsConfigured() && invoiceFlow() === 'pre') {
    const stripeInvoice = await createStripeInvoice(context);
    paymentUrl = stripeInvoice.paymentUrl;
    invoiceId = stripeInvoice.invoiceId;
    paymentDueDate = stripeInvoice.paymentDueDate;
    paymentMethod = paymentUrl || invoiceId ? 'Stripe' : paymentMethod;
  }

  if (!context.paymentConfirmed && !paymentUrl && isStripePaymentEnabled() && stripeIsConfigured() && invoiceFlow() === 'post') {
    paymentUrl = await createStripeCheckoutUrl(context);
    paymentMethod = paymentUrl ? 'Stripe' : paymentMethod;
  }

  const communicationId = uuidv4();

  const claims: Record<string, any> = {
    '@context': 'org.schema',
    '@type': 'Order:Invoice',
    'org.schema.Order.acceptedOffer.identifier': context.offerId,
    'org.schema.Order.partOfInvoice': paymentUrl || invoiceId || undefined,
    'org.schema.Order.paymentMethod': paymentMethod || (paymentUrl ? 'Stripe' : undefined),
    'org.schema.Order.paymentDueDate': paymentDueDate,
    'org.schema.Order.paymentUrl': paymentUrl || undefined,
    'org.schema.Order.invoiceIssuedAt': now.toISOString(),
  };
  // Activation details are encoded as org.schema IndividualProduct claims to stay
  // aligned with the schema vocabulary used across Organization/Family flows.
  if (context.activationCode) {
    (claims as any)['org.schema.IndividualProduct.serialNumber'] = context.activationCode;
  }
  if (context.activationCategory) {
    (claims as any)['org.schema.IndividualProduct.category'] = context.activationCategory;
  }
  Object.keys(claims).forEach((key) => {
    if (claims[key] === undefined) delete claims[key];
  });
  return { communicationId, paymentUrl, claims };
}

export function readOfferPaymentContext(
  claims: Record<string, any>,
): Pick<PaymentContext, 'quantity' | 'price' | 'currency'> {
  return {
    quantity: Number(claims[ClaimsOfferSchemaorg.eligibleQuantityValue] || 1),
    price: claims[ClaimsOfferSchemaorg.price] as string | undefined,
    currency: claims[ClaimsOfferSchemaorg.priceCurrency] as string | undefined,
  };
}
