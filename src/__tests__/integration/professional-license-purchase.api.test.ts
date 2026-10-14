// Flow contract: reuse shared test fixtures and canonical types; do not introduce duplicated literals.
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { extractBundleSearchResources } from 'gdc-common-utils-ts/utils/organization-employee-lifecycle';
import {
  ClaimsOfferSchemaorg,
  ClaimsOrderSchemaorg,
} from 'gdc-common-utils-ts/constants/schemaorg';
import {
  EXAMPLE_API_ORGANIZATION_DID,
  EXAMPLE_LICENSE_INVOICE_ID,
  EXAMPLE_LICENSE_PAYMENT_METHOD_INVOICE,
  EXAMPLE_LICENSE_PURCHASE_INPUT,
} from 'gdc-common-utils-ts';
import type { StoryHarness } from './helpers/story-flow';
import {
  installBasicJsonFetchMock,
  onboardTenantViaActivateAndOrder,
  pollJsonBody,
  startStoryServer,
  stopStoryServer,
} from './helpers/story-flow';
import { invokeExpress } from './helpers/invokeExpress';
import {
  ORGANIZATION_LICENSE_OFFER_REQUEST,
  ORGANIZATION_LICENSE_SEARCH_REQUEST,
  ORGANIZATION_ORDER_REQUEST,
} from '../data/example-payloads';

/**
 * HTTP route contract for buying professional seats. This intentionally starts
 * at `Offer/_create`; calling the License manager or ledger directly would not
 * prove the portal-facing route, queue and Order continuation.
 */
describe('Professional license Offer/Order route story', () => {
  let harness: StoryHarness;
  let tenantId: string;
  let originalFetch: typeof global.fetch;

  beforeAll(async () => {
    originalFetch = installBasicJsonFetchMock();
    harness = await startStoryServer();
    tenantId = await onboardTenantViaActivateAndOrder(harness.app, harness.queueAdapter);
  });

  afterAll(async () => {
    global.fetch = originalFetch;
    await stopStoryServer(harness);
  });

  it('creates no serials in Offer and materializes the requested seats only after verified Order', async () => {
    const inventoryUrl = `/${tenantId}/cds-es/v1/health-care/entity/org.schema/License/_search`;
    const inventoryPayload = structuredClone(ORGANIZATION_LICENSE_SEARCH_REQUEST) as any;
    inventoryPayload.aud = tenantId;
    const inventoryBeforeSubmit = await invokeExpress(harness.app, {
      method: 'POST',
      url: inventoryUrl,
      headers: { 'content-type': 'application/json' },
      body: inventoryPayload,
    });
    expect(inventoryBeforeSubmit.status).toBe(202);
    await harness.queueAdapter.waitForEmptyQueue();
    const inventoryBeforePoll = await pollJsonBody(
      harness.app,
      inventoryBeforeSubmit.headers.location,
      inventoryPayload.thid,
    );
    const inventoryBefore = extractBundleSearchResources(inventoryBeforePoll.body).length;

    const offerPayload = structuredClone(ORGANIZATION_LICENSE_OFFER_REQUEST) as any;
    offerPayload.iss = EXAMPLE_API_ORGANIZATION_DID;
    offerPayload.aud = tenantId;
    const offerUrl = `/${tenantId}/cds-es/v1/health-care/entity/org.schema/Offer/_create`;

    const offerSubmit = await invokeExpress(harness.app, {
      method: 'POST',
      url: offerUrl,
      headers: { 'content-type': 'application/json' },
      body: offerPayload,
    });
    expect(offerSubmit.status).toBe(202);
    await harness.queueAdapter.waitForEmptyQueue();

    const offerPoll = await pollJsonBody(harness.app, offerSubmit.headers.location, offerPayload.thid);
    expect(offerPoll.status).toBe(200);
    const offerEntry = offerPoll.body.data[0];
    const offerClaims = offerEntry.resource?.meta?.claims;
    const offerId = String(offerClaims?.[ClaimsOfferSchemaorg.identifier] || '');
    expect(offerId).toBeTruthy();
    expect(offerClaims?.[ClaimsOfferSchemaorg.eligibleQuantityValue])
      .toBe(EXAMPLE_LICENSE_PURCHASE_INPUT.quantity);
    expect(offerClaims?.[ClaimsOfferSchemaorg.serialNumber]).toBeUndefined();

    const orderPayload = structuredClone(ORGANIZATION_ORDER_REQUEST) as any;
    orderPayload.iss = EXAMPLE_API_ORGANIZATION_DID;
    orderPayload.aud = tenantId;
    orderPayload.body.data[0].resource.meta.claims = {
      ...orderPayload.body.data[0].resource.meta.claims,
      [ClaimsOrderSchemaorg.acceptedOfferIdentifier]: offerId,
      [ClaimsOrderSchemaorg.paymentMethod]: EXAMPLE_LICENSE_PAYMENT_METHOD_INVOICE,
      [ClaimsOrderSchemaorg.partOfInvoice]: EXAMPLE_LICENSE_INVOICE_ID,
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
    expect(orderPoll.body.data[0].response.status).toBe('201');

    const inventoryAfterPayload = structuredClone(ORGANIZATION_LICENSE_SEARCH_REQUEST) as any;
    inventoryAfterPayload.thid = `${inventoryPayload.thid}-after-order`;
    inventoryAfterPayload.aud = tenantId;
    const inventoryAfterSubmit = await invokeExpress(harness.app, {
      method: 'POST',
      url: inventoryUrl,
      headers: { 'content-type': 'application/json' },
      body: inventoryAfterPayload,
    });
    expect(inventoryAfterSubmit.status).toBe(202);
    await harness.queueAdapter.waitForEmptyQueue();
    const inventoryAfterPoll = await pollJsonBody(
      harness.app,
      inventoryAfterSubmit.headers.location,
      inventoryAfterPayload.thid,
    );
    const inventoryAfter = extractBundleSearchResources(inventoryAfterPoll.body).length;
    expect(inventoryAfter - inventoryBefore).toBe(EXAMPLE_LICENSE_PURCHASE_INPUT.quantity);
  });
});
