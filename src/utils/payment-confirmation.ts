// Copyright 2026 Antifraud Services Inc. under the Apache License, Version 2.0.

import Stripe from 'stripe';
import { ClaimsOfferSchemaorg, ClaimsOrderSchemaorg } from 'gdc-common-utils-ts/constants/schemaorg';
import { ManagerError } from 'gdc-common-utils-ts/utils/manager-error';
import { IssueType } from 'gdc-common-utils-ts/models/issue';
import {
  PaymentProviderIds,
} from 'vet-data-utils-ts/payment';

export const PAYMENT_ORCHESTRATION_MODE_GW_CORE = 'gw-core';
export const PAYMENT_ORCHESTRATION_MODE_PORTAL_BFF = 'portal-bff';
export const PAYMENT_VERIFICATION_MODE_LIVE = 'live';
export const PAYMENT_VERIFICATION_MODE_MOCK = 'mock';
export const PAYMENT_METHOD_STRIPE = 'Stripe';
export const PAYMENT_METHOD_TEST_NETWORK_VIRTUAL = 'TestNetworkVirtual';
export const PAYMENT_METHOD_EVM_TRANSFER = PaymentProviderIds.EvmTransfer;

export type PaymentOrchestrationMode =
  typeof PAYMENT_ORCHESTRATION_MODE_GW_CORE
  | typeof PAYMENT_ORCHESTRATION_MODE_PORTAL_BFF;

export type PaymentVerificationMode =
  typeof PAYMENT_VERIFICATION_MODE_LIVE
  | typeof PAYMENT_VERIFICATION_MODE_MOCK;

export type PaymentConfirmationResult = Readonly<{
  verified: boolean;
  paymentMethod?: string;
  invoiceId?: string;
  paymentUrl?: string;
}>;

function normalizeText(value: unknown): string | undefined {
  const text = typeof value === 'string' ? value.trim() : '';
  return text || undefined;
}

function resolveOrderPrice(claims: Record<string, unknown>): number {
  const raw = claims[ClaimsOfferSchemaorg.price];
  const parsed = typeof raw === 'number' ? raw : Number(raw || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function resolvePaymentOrchestrationMode(): PaymentOrchestrationMode {
  const value = String(process.env.PAYMENT_ORCHESTRATION_MODE || '').trim().toLowerCase();
  if (value === PAYMENT_ORCHESTRATION_MODE_PORTAL_BFF) return PAYMENT_ORCHESTRATION_MODE_PORTAL_BFF;
  return PAYMENT_ORCHESTRATION_MODE_GW_CORE;
}

export function resolvePaymentVerificationMode(): PaymentVerificationMode {
  const value = String(process.env.PAYMENT_VERIFICATION_MODE || '').trim().toLowerCase();
  if (value === PAYMENT_VERIFICATION_MODE_LIVE) return PAYMENT_VERIFICATION_MODE_LIVE;
  return PAYMENT_VERIFICATION_MODE_MOCK;
}

function extractStripeReference(
  invoiceId: string | undefined,
  paymentUrl: string | undefined,
): Readonly<{ invoiceId?: string; checkoutSessionId?: string }> {
  const normalizedInvoiceId = normalizeText(invoiceId);
  const normalizedPaymentUrl = normalizeText(paymentUrl);
  if (normalizedInvoiceId?.startsWith('in_')) return { invoiceId: normalizedInvoiceId };
  if (normalizedInvoiceId?.startsWith('cs_')) return { checkoutSessionId: normalizedInvoiceId };
  if (normalizedPaymentUrl?.includes('/checkout/')) {
    const fragments = normalizedPaymentUrl.split('/');
    const checkoutSessionId = normalizeText(fragments[fragments.length - 1]);
    if (checkoutSessionId?.startsWith('cs_')) return { checkoutSessionId };
  }
  return {};
}

async function verifyStripePaymentLive(
  invoiceId: string | undefined,
  paymentUrl: string | undefined,
): Promise<void> {
  if (!process.env.STRIPE_SECRET_KEY) {
    throw new ManagerError('Stripe live payment verification requires STRIPE_SECRET_KEY.', IssueType.Required);
  }
  const stripeClient = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2026-02-25.clover' });
  const refs = extractStripeReference(invoiceId, paymentUrl);
  if (refs.invoiceId) {
    const invoice = await stripeClient.invoices.retrieve(refs.invoiceId);
    if (invoice.status !== 'paid') {
      throw new ManagerError(`Stripe invoice '${refs.invoiceId}' is not paid.`, IssueType.Conflict);
    }
    return;
  }
  if (refs.checkoutSessionId) {
    const session = await stripeClient.checkout.sessions.retrieve(refs.checkoutSessionId);
    if (session.payment_status !== 'paid') {
      throw new ManagerError(`Stripe checkout session '${refs.checkoutSessionId}' is not paid.`, IssueType.Conflict);
    }
    return;
  }
  throw new ManagerError(
    'Stripe payment confirmation requires an invoice id (`in_...`) or checkout session id (`cs_...`).',
    IssueType.Required,
  );
}

export async function verifyOrderPaymentConfirmation(input: {
  orderClaims: Record<string, unknown>;
  offerClaims: Record<string, unknown>;
}): Promise<PaymentConfirmationResult> {
  const { orderClaims, offerClaims } = input;
  const amount = resolveOrderPrice(offerClaims);
  if (amount <= 0 && resolvePaymentOrchestrationMode() === PAYMENT_ORCHESTRATION_MODE_GW_CORE) {
    return {
      verified: true,
      paymentMethod: normalizeText(orderClaims[ClaimsOrderSchemaorg.paymentMethod]),
      invoiceId: normalizeText(orderClaims[ClaimsOrderSchemaorg.partOfInvoice]),
      paymentUrl: normalizeText(orderClaims[ClaimsOrderSchemaorg.paymentUrl]),
    };
  }

  if (resolvePaymentOrchestrationMode() === PAYMENT_ORCHESTRATION_MODE_GW_CORE) {
    return {
      verified: true,
      paymentMethod: normalizeText(orderClaims[ClaimsOrderSchemaorg.paymentMethod]),
      invoiceId: normalizeText(orderClaims[ClaimsOrderSchemaorg.partOfInvoice]),
      paymentUrl: normalizeText(orderClaims[ClaimsOrderSchemaorg.paymentUrl]),
    };
  }

  const paymentMethod = normalizeText(orderClaims[ClaimsOrderSchemaorg.paymentMethod]);
  const invoiceId = normalizeText(orderClaims[ClaimsOrderSchemaorg.partOfInvoice]);
  const paymentUrl = normalizeText(orderClaims[ClaimsOrderSchemaorg.paymentUrl]);
  if (!paymentMethod) {
    throw new ManagerError(
      'Portal-managed payment confirmation requires Order.paymentMethod in the order claims.',
      IssueType.Required,
    );
  }
  if (!invoiceId && !paymentUrl) {
    throw new ManagerError(
      'Portal-managed payment confirmation requires Order.partOfInvoice or Order.paymentUrl.',
      IssueType.Required,
    );
  }

  if (paymentMethod === PAYMENT_METHOD_STRIPE) {
    if (resolvePaymentVerificationMode() === PAYMENT_VERIFICATION_MODE_LIVE) {
      await verifyStripePaymentLive(invoiceId, paymentUrl);
    }
    return { verified: true, paymentMethod, invoiceId, paymentUrl };
  }

  if (paymentMethod === PAYMENT_METHOD_EVM_TRANSFER) {
    if (paymentUrl) {
      throw new ManagerError(
        'BFF-reconciled EVM Orders must not send wallet or transaction data to GW.',
        IssueType.Forbidden,
      );
    }
    return { verified: true, paymentMethod, invoiceId };
  }

  if (paymentMethod === PAYMENT_METHOD_TEST_NETWORK_VIRTUAL) {
    const networkMode = String(process.env.NETWORK_MODE || '').trim().toLowerCase();
    const deploymentEnvironment = String(process.env.DEPLOYMENT_ENV || '').trim().toLowerCase();
    const virtualStage = networkMode === 'test-network'
      || (networkMode === 'test' && deploymentEnvironment === 'dev');
    if (!virtualStage || resolvePaymentVerificationMode() !== PAYMENT_VERIFICATION_MODE_MOCK) {
      throw new ManagerError(
        'The virtual payment provider is restricted to Test Network with mock verification.',
        IssueType.Forbidden,
      );
    }
    if (!invoiceId?.startsWith('virtual_test_network_')) {
      throw new ManagerError(
        'The virtual payment provider requires a server-generated Test Network payment reference.',
        IssueType.Required,
      );
    }
    return { verified: true, paymentMethod, invoiceId, paymentUrl };
  }

  if (String(process.env.ALLOW_NON_STRIPE_PAYMENT_CONFIRMATION || '').trim().toLowerCase() === 'true') {
    return { verified: true, paymentMethod, invoiceId, paymentUrl };
  }

  throw new ManagerError(
    `Unsupported payment method '${paymentMethod}' for portal-managed confirmation.`,
    IssueType.NotSupported,
  );
}
