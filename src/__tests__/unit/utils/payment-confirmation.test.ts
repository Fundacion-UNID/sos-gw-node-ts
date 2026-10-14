// Flow contract: follow docs/LOCAL_FIRST_RELEASE_CONTRACT.md; GW accepts only BFF-reconciled provider-neutral EVM orders and never receives wallet or RPC evidence.
import { describe, expect, it, beforeEach, afterEach } from '@jest/globals';
import { ClaimsOfferSchemaorg, ClaimsOrderSchemaorg } from 'gdc-common-utils-ts/constants/schemaorg';
import { VET_PAYMENT_TEST_DATA } from 'vet-data-utils-ts/payment';
import {
  PAYMENT_METHOD_STRIPE,
  PAYMENT_METHOD_TEST_NETWORK_VIRTUAL,
  PAYMENT_METHOD_EVM_TRANSFER,
  PAYMENT_ORCHESTRATION_MODE_GW_CORE,
  PAYMENT_ORCHESTRATION_MODE_PORTAL_BFF,
  PAYMENT_VERIFICATION_MODE_MOCK,
  verifyOrderPaymentConfirmation,
} from '../../../utils/payment-confirmation';

describe('payment-confirmation', () => {
  const previousMode = process.env.PAYMENT_ORCHESTRATION_MODE;
  const previousVerificationMode = process.env.PAYMENT_VERIFICATION_MODE;
  const previousNetworkMode = process.env.NETWORK_MODE;
  const previousDeploymentEnvironment = process.env.DEPLOYMENT_ENV;

  beforeEach(() => {
    process.env.PAYMENT_VERIFICATION_MODE = PAYMENT_VERIFICATION_MODE_MOCK;
  });

  afterEach(() => {
    process.env.PAYMENT_ORCHESTRATION_MODE = previousMode;
    process.env.PAYMENT_VERIFICATION_MODE = previousVerificationMode;
    process.env.NETWORK_MODE = previousNetworkMode;
    process.env.DEPLOYMENT_ENV = previousDeploymentEnvironment;
  });

  it('accepts the virtual provider in the local in-memory test networkKind only in dev', async () => {
    process.env.PAYMENT_ORCHESTRATION_MODE = PAYMENT_ORCHESTRATION_MODE_PORTAL_BFF;
    process.env.NETWORK_MODE = 'test';
    process.env.DEPLOYMENT_ENV = 'dev';
    const input = {
      offerClaims: { [ClaimsOfferSchemaorg.price]: '0' },
      orderClaims: {
        [ClaimsOrderSchemaorg.paymentMethod]: PAYMENT_METHOD_TEST_NETWORK_VIRTUAL,
        [ClaimsOrderSchemaorg.partOfInvoice]: 'virtual_test_network_zero_local',
      },
    };

    await expect(verifyOrderPaymentConfirmation(input)).resolves.toMatchObject({ verified: true });
    process.env.DEPLOYMENT_ENV = 'staging';
    await expect(verifyOrderPaymentConfirmation(input)).rejects.toThrow('restricted to Test Network');
  });

  it('accepts paid Stripe confirmation in portal-bff mode when proof is present', async () => {
    process.env.PAYMENT_ORCHESTRATION_MODE = PAYMENT_ORCHESTRATION_MODE_PORTAL_BFF;

    const result = await verifyOrderPaymentConfirmation({
      offerClaims: {
        [ClaimsOfferSchemaorg.price]: '49.99',
      },
      orderClaims: {
        [ClaimsOrderSchemaorg.paymentMethod]: PAYMENT_METHOD_STRIPE,
        [ClaimsOrderSchemaorg.partOfInvoice]: 'in_test_001',
      },
    });

    expect(result.verified).toBe(true);
    expect(result.invoiceId).toBe('in_test_001');
    expect(result.paymentMethod).toBe(PAYMENT_METHOD_STRIPE);
  });

  it('accepts the explicit virtual provider only for Test Network zero-price Orders', async () => {
    process.env.PAYMENT_ORCHESTRATION_MODE = PAYMENT_ORCHESTRATION_MODE_PORTAL_BFF;
    process.env.NETWORK_MODE = 'test-network';

    await expect(verifyOrderPaymentConfirmation({
      offerClaims: { [ClaimsOfferSchemaorg.price]: '0' },
      orderClaims: {
        [ClaimsOrderSchemaorg.paymentMethod]: PAYMENT_METHOD_TEST_NETWORK_VIRTUAL,
        [ClaimsOrderSchemaorg.partOfInvoice]: 'virtual_test_network_zero_001',
      },
    })).resolves.toMatchObject({
      verified: true,
      paymentMethod: PAYMENT_METHOD_TEST_NETWORK_VIRTUAL,
      invoiceId: 'virtual_test_network_zero_001',
    });

    process.env.NETWORK_MODE = 'network';
    await expect(verifyOrderPaymentConfirmation({
      offerClaims: { [ClaimsOfferSchemaorg.price]: '0' },
      orderClaims: {
        [ClaimsOrderSchemaorg.paymentMethod]: PAYMENT_METHOD_TEST_NETWORK_VIRTUAL,
        [ClaimsOrderSchemaorg.partOfInvoice]: 'virtual_test_network_zero_001',
      },
    })).rejects.toThrow('restricted to Test Network');

    await expect(verifyOrderPaymentConfirmation({
      offerClaims: { [ClaimsOfferSchemaorg.price]: '0' },
      orderClaims: {},
    })).rejects.toThrow('Portal-managed payment confirmation requires Order.paymentMethod');
  });

  it('rejects portal-bff paid orders without proof', async () => {
    process.env.PAYMENT_ORCHESTRATION_MODE = PAYMENT_ORCHESTRATION_MODE_PORTAL_BFF;

    await expect(
      verifyOrderPaymentConfirmation({
        offerClaims: {
          [ClaimsOfferSchemaorg.price]: '49.99',
        },
        orderClaims: {},
      }),
    ).rejects.toThrow('Portal-managed payment confirmation requires Order.paymentMethod');
  });

  it('keeps gw-core mode backward compatible for paid offers without explicit proof', async () => {
    process.env.PAYMENT_ORCHESTRATION_MODE = PAYMENT_ORCHESTRATION_MODE_GW_CORE;

    const result = await verifyOrderPaymentConfirmation({
      offerClaims: {
        [ClaimsOfferSchemaorg.price]: '49.99',
      },
      orderClaims: {},
    });

    expect(result.verified).toBe(true);
  });

  it('accepts a BFF-reconciled EVM transfer without RPC or wallet claims', async () => {
    process.env.PAYMENT_ORCHESTRATION_MODE = PAYMENT_ORCHESTRATION_MODE_PORTAL_BFF;
    const result = await verifyOrderPaymentConfirmation({
      offerClaims: {
        [ClaimsOfferSchemaorg.price]: VET_PAYMENT_TEST_DATA.priceText,
        [ClaimsOfferSchemaorg.priceCurrency]: VET_PAYMENT_TEST_DATA.currency,
      },
      orderClaims: {
        [ClaimsOrderSchemaorg.paymentMethod]: PAYMENT_METHOD_EVM_TRANSFER,
        [ClaimsOrderSchemaorg.partOfInvoice]: VET_PAYMENT_TEST_DATA.invoiceId,
      },
    });
    expect(result).toEqual({
      verified: true,
      paymentMethod: PAYMENT_METHOD_EVM_TRANSFER,
      invoiceId: VET_PAYMENT_TEST_DATA.invoiceId,
      paymentUrl: undefined,
    });
    await expect(verifyOrderPaymentConfirmation({
      offerClaims: { [ClaimsOfferSchemaorg.price]: VET_PAYMENT_TEST_DATA.priceText },
      orderClaims: {
        [ClaimsOrderSchemaorg.paymentMethod]: PAYMENT_METHOD_EVM_TRANSFER,
        [ClaimsOrderSchemaorg.partOfInvoice]: VET_PAYMENT_TEST_DATA.invoiceId,
        [ClaimsOrderSchemaorg.paymentUrl]: VET_PAYMENT_TEST_DATA.transactionHash,
      },
    })).rejects.toThrow('must not send wallet or transaction data to GW');
  });
});
