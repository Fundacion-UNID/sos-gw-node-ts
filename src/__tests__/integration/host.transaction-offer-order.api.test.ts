import { afterAll, afterEach, beforeAll, describe, expect, it } from '@jest/globals';
import type { StoryHarness } from './helpers/story-flow';
import { installIcaVerifyFetchMock, pollJsonBody, startStoryServer, stopStoryServer } from './helpers/story-flow';
import { invokeExpress } from './helpers/invokeExpress';
import { ClaimsOfferSchemaorg, ClaimsOrderSchemaorg, ClaimsPersonSchemaorg } from 'gdc-common-utils-ts/constants/schemaorg';
import {
  HOST_ORDER_REQUIRED_INPUT_DISPLAY_CLAIMS,
  HOST_TRANSACTION_REQUIRED_INPUT_CLAIMS,
} from '../../managers/hosting/hosting-claim-contracts';
import {
  ORGANIZATION_ORDER_REQUEST,
  ORGANIZATION_VERIFICATION_TRANSACTION_REQUEST,
} from '../data/example-payloads';

describe('Host transaction Offer/Order route story', () => {
  let harness: StoryHarness;
  let originalFetch: typeof global.fetch;

  beforeAll(async () => {
    originalFetch = installIcaVerifyFetchMock();
    harness = await startStoryServer();
  });

  afterEach(() => {
    (global.fetch as any).mockClear?.();
  });

  afterAll(async () => {
    global.fetch = originalFetch;
    await stopStoryServer(harness);
  });

  /**
   * Canonical host onboarding contract guard.
   *
   * This test proves the producer side of `_transaction-response` through the
   * canonical claim path first: `resource.meta.claims['org.schema.Offer.identifier']`.
   * The `resource.next` helper may exist, but it is not the source of truth.
   */
  it('submit _transaction, poll Offer, submit Order, and poll commercial confirmation', async () => {
    const transactionPayload = structuredClone(ORGANIZATION_VERIFICATION_TRANSACTION_REQUEST) as any;
    transactionPayload.thid = 'host-transaction-story-thid';
    transactionPayload.jti = 'host-transaction-story-jti';
    transactionPayload.body.data[0].resource = transactionPayload.body.data[0].resource || {};
    transactionPayload.body.data[0].resource.meta = {
      claims: {
        ...(transactionPayload.body.data[0].resource?.meta?.claims || {}),
        [ClaimsPersonSchemaorg.email]: 'admin1@acme.org',
        'org.schema.Person.hasOccupation.identifier.value': 'RESPRSN',
      },
    };
    delete transactionPayload.body.data[0].meta;

    const transactionSubmit = await invokeExpress(harness.app, {
      method: 'POST',
      url: '/host/cds-es/v1/test/registry/org.schema/Organization/_transaction',
      headers: { 'content-type': 'application/json' },
      body: transactionPayload,
    });

    expect(transactionSubmit.status).toBe(202);
    expect(transactionSubmit.headers.location).toContain('/_transaction-response');

    await harness.queueAdapter.waitForEmptyQueue();

    const transactionPoll = await pollJsonBody(harness.app, transactionSubmit.headers.location, transactionPayload.thid);
    expect(transactionPoll.status).toBe(200);

    const transactionEntry = transactionPoll.body.data[0];
    const offerId = String(transactionEntry.resource?.meta?.claims?.[ClaimsOfferSchemaorg.identifier] || '');

    expect(transactionEntry.response.status).toBe('200');
    expect(transactionEntry.resource?.next?.action).toBe('Order/_batch');
    expect(transactionEntry.resource?.next?.acceptedOffer?.identifier).toBe(offerId);
    expect(offerId).toContain(':Offer:');

    const orderPayload = structuredClone(ORGANIZATION_ORDER_REQUEST) as any;
    orderPayload.thid = 'host-transaction-order-thid';
    orderPayload.jti = 'host-transaction-order-jti';
    orderPayload.body.data[0].resource = {
      meta: {
        claims: {
          '@context': 'org.schema',
          [ClaimsOrderSchemaorg.acceptedOfferIdentifier]: offerId,
          [ClaimsOrderSchemaorg.paymentMethod]: 'Stripe',
          [ClaimsOrderSchemaorg.partOfInvoice]: 'host-transaction-story-invoice',
        },
      },
    };

    const orderSubmit = await invokeExpress(harness.app, {
      method: 'POST',
      url: '/host/cds-es/v1/test/registry/org.schema/Order/_batch',
      headers: { 'content-type': 'application/json' },
      body: orderPayload,
    });

    expect(orderSubmit.status).toBe(202);
    expect(orderSubmit.headers.location).toContain('/_batch-response');

    await harness.queueAdapter.waitForEmptyQueue();

    const orderPoll = await pollJsonBody(harness.app, orderSubmit.headers.location, orderPayload.thid);
    expect(orderPoll.status).toBe(200);

    const orderEntry = orderPoll.body.data[0];
    expect(orderEntry.response.status).toBe('201');
    expect(orderEntry.resource?.meta?.claims?.[ClaimsOrderSchemaorg.acceptedOfferIdentifier]).toBe(offerId);
    expect(JSON.stringify(orderEntry.resource)).toContain(
      transactionPayload.body.data[0].resource.organization.did,
    );
  });

  /**
   * Consumer-side negative contract guard for the canonical host flow.
   *
   * If this ever stops failing with `400`, a missing Offer id from the producer
   * could be masked in staging/production instead of being surfaced clearly.
   */
  it('returns a required-field error when Order.acceptedOffer.identifier is missing', async () => {
    // Step 1: create a valid host Offer so the follow-up error can only come
    // from the missing Order claim, not from an unrelated onboarding failure.
    const transactionPayload = structuredClone(ORGANIZATION_VERIFICATION_TRANSACTION_REQUEST) as any;
    transactionPayload.thid = 'host-transaction-missing-offer-thid';
    transactionPayload.jti = 'host-transaction-missing-offer-jti';
    transactionPayload.body.data[0].resource = transactionPayload.body.data[0].resource || {};
    transactionPayload.body.data[0].resource.meta = {
      claims: {
        ...(transactionPayload.body.data[0].resource?.meta?.claims || {}),
        [ClaimsPersonSchemaorg.email]: 'admin1@acme.org',
        'org.schema.Person.hasOccupation.identifier.value': 'RESPRSN',
      },
    };
    delete transactionPayload.body.data[0].meta;

    const transactionSubmit = await invokeExpress(harness.app, {
      method: 'POST',
      url: '/host/cds-es/v1/test/registry/org.schema/Organization/_transaction',
      headers: { 'content-type': 'application/json' },
      body: transactionPayload,
    });

    expect(transactionSubmit.status).toBe(202);
    await harness.queueAdapter.waitForEmptyQueue();
    await pollJsonBody(harness.app, transactionSubmit.headers.location, transactionPayload.thid);

    const orderPayload = structuredClone(ORGANIZATION_ORDER_REQUEST) as any;
    orderPayload.thid = 'host-transaction-missing-order-offer-thid';
    orderPayload.jti = 'host-transaction-missing-order-offer-jti';
    orderPayload.body.data[0].resource = {
      meta: {
        claims: {
          '@context': 'org.schema',
          [ClaimsOrderSchemaorg.paymentMethod]: 'Stripe',
          [ClaimsOrderSchemaorg.partOfInvoice]: 'host-transaction-missing-offer',
        },
      },
    };

    const orderSubmit = await invokeExpress(harness.app, {
      method: 'POST',
      url: '/host/cds-es/v1/test/registry/org.schema/Order/_batch',
      headers: { 'content-type': 'application/json' },
      body: orderPayload,
    });

    expect(orderSubmit.status).toBe(202);
    await harness.queueAdapter.waitForEmptyQueue();

    const orderPoll = await pollJsonBody(harness.app, orderSubmit.headers.location, orderPayload.thid);
    expect(orderPoll.status).toBe(200);

    // Step 2: poll the failed commercial response and assert the exact public
    // claim contract that callers must provide on Order.
    const errorEntry = orderPoll.body.data[0];
    expect(errorEntry.response.status).toBe('400');
    expect(errorEntry.response.outcome.issue[0].diagnostics).toContain(
      `Missing required claim in Order: '${HOST_ORDER_REQUIRED_INPUT_DISPLAY_CLAIMS[0]}'`,
    );
  });

  it('returns a required-field error when _transaction omits Service.category', async () => {
    // Step 1: remove the host-required sector claim before submission.
    const transactionPayload = structuredClone(ORGANIZATION_VERIFICATION_TRANSACTION_REQUEST) as any;
    transactionPayload.thid = 'host-transaction-missing-category-thid';
    transactionPayload.jti = 'host-transaction-missing-category-jti';
    transactionPayload.body.data[0].resource = transactionPayload.body.data[0].resource || {};
    const claims = transactionPayload.body.data[0].resource.meta?.claims || {};
    delete claims[HOST_TRANSACTION_REQUIRED_INPUT_CLAIMS[1]];
    transactionPayload.body.data[0].resource.meta = {
      claims: {
        ...claims,
        [ClaimsPersonSchemaorg.email]: 'admin1@acme.org',
        'org.schema.Person.hasOccupation.identifier.value': 'RESPRSN',
      },
    };
    delete transactionPayload.body.data[0].meta;

    const transactionSubmit = await invokeExpress(harness.app, {
      method: 'POST',
      url: '/host/cds-es/v1/test/registry/org.schema/Organization/_transaction',
      headers: { 'content-type': 'application/json' },
      body: transactionPayload,
    });

    expect(transactionSubmit.status).toBe(202);
    await harness.queueAdapter.waitForEmptyQueue();

    const transactionPoll = await pollJsonBody(harness.app, transactionSubmit.headers.location, transactionPayload.thid);
    expect(transactionPoll.status).toBe(200);

    // Step 2: assert that `_transaction` fails on the producer side before any
    // Offer is generated, using the canonical host-required input claim path.
    const errorEntry = transactionPoll.body.data[0];
    expect(errorEntry.response.status).toBe('400');
    expect(errorEntry.response.outcome.issue[0].diagnostics).toContain(
      `Missing required claim: '${HOST_TRANSACTION_REQUIRED_INPUT_CLAIMS[1]}'`,
    );
  });
});
