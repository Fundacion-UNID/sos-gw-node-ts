// Flow contract: organization onboarding creates inventory through Offer -> Order and search readers accept both rollout envelopes.
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { extractBundleSearchResources } from 'gdc-common-utils-ts/utils/organization-employee-lifecycle';
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
  ClaimsIndividualProductSchemaorg,
  ClaimsOfferSchemaorg,
  ClaimsOrderSchemaorg,
  ClaimsOrganizationSchemaorg,
  ClaimsServiceSchemaorg,
} from 'gdc-common-utils-ts/constants/schemaorg';
import {
  FAMILY_ORDER_REQUEST,
  FAMILY_REGISTRATION_TRANSACTION_REQUEST,
} from '../data/example-payloads';
import { withCanonicalEntryClaims } from '../helpers/canonical-bundle-entry';
import {
  EXAMPLE_KYC_CONTROLLER_UUID,
  EXAMPLE_LICENSE_INVOICE_ID,
  EXAMPLE_LICENSE_PAYMENT_METHOD_STRIPE,
  EXAMPLE_PRIVATE_INDIVIDUAL_UUID,
} from 'gdc-common-utils-ts/examples/shared';
import { EXAMPLE_FAMILY_ORGANIZATION_SEARCH_RESPONSE_BODY } from 'gdc-common-utils-ts/examples/individual-controller';

describe('Family transaction Offer/Order route story', () => {
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

  it('submit family _transaction, poll Offer, submit Order, and poll family confirmation', async () => {
    const registrationPayload = structuredClone(FAMILY_REGISTRATION_TRANSACTION_REQUEST) as any;
    registrationPayload.thid = 'family-transaction-story-thid';
    registrationPayload.jti = 'family-transaction-story-jti';
    const familyClaims = {
      ...(registrationPayload.body.data[0].resource?.meta?.claims || {}),
      [ClaimsOrganizationSchemaorg.alternateName]: 'ana-story',
      [ClaimsOrganizationSchemaorg.identifier]: `urn:uuid:${EXAMPLE_KYC_CONTROLLER_UUID}`,
      [ClaimsOrganizationSchemaorg.identifierValue]: EXAMPLE_KYC_CONTROLLER_UUID,
      [ClaimsOrganizationSchemaorg.ownerEmail]: 'adult1@example.com',
      [ClaimsOrganizationSchemaorg.ownerIdentifierValue]: EXAMPLE_KYC_CONTROLLER_UUID,
      [ClaimsServiceSchemaorg.category]: 'health-care',
    };
    // An individual has no required country. The Offer jurisdiction/network
    // must be taken from `/cds-es/`, even when this claim is absent.
    delete familyClaims[ClaimsOrganizationSchemaorg.addressCountry];
    registrationPayload.body.data[0] = withCanonicalEntryClaims(
      registrationPayload.body.data[0],
      familyClaims,
    );
    delete registrationPayload.attachments;

    const transactionSubmit = await invokeExpress(harness.app, {
      method: 'POST',
      url: `/${tenantId}/cds-es/v1/health-care/individual/org.schema/Organization/_transaction`,
      headers: { 'content-type': 'application/json' },
      body: registrationPayload,
    });

    expect(transactionSubmit.status).toBe(202);
    expect(transactionSubmit.headers.location).toContain('/_transaction-response');

    await harness.queueAdapter.waitForEmptyQueue();

    const transactionPoll = await pollJsonBody(harness.app, transactionSubmit.headers.location, registrationPayload.thid);
    expect(transactionPoll.status).toBe(200);

    const registrationEntry = transactionPoll.body.data[0];
    const offerId = String(registrationEntry.resource?.meta?.claims?.[ClaimsOfferSchemaorg.identifier] || '');

    expect(registrationEntry.response.status).toBe('201');
    // The route, not an individual address claim, selects the Offer network.
    // This guards the live SDK/GW regression that produced `urn:cds:undefined`.
    expect(offerId).toMatch(/^urn:cds:ES:v1:health-care:product:org\.schema:Offer:/);
    expect(offerId).not.toContain('undefined');

    const orderPayload = structuredClone(FAMILY_ORDER_REQUEST) as any;
    orderPayload.thid = 'family-order-story-thid';
    orderPayload.jti = 'family-order-story-jti';
    orderPayload.body.data[0] = withCanonicalEntryClaims(orderPayload.body.data[0], {
      [ClaimsOrderSchemaorg.acceptedOfferIdentifier]: offerId,
      [ClaimsOrderSchemaorg.paymentMethod]: EXAMPLE_LICENSE_PAYMENT_METHOD_STRIPE,
      [ClaimsOrderSchemaorg.partOfInvoice]: EXAMPLE_LICENSE_INVOICE_ID,
    });

    const orderSubmit = await invokeExpress(harness.app, {
      method: 'POST',
      url: `/${tenantId}/cds-es/v1/health-care/individual/org.schema/Order/_batch`,
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
    expect(orderEntry.resource?.meta?.claims?.[ClaimsIndividualProductSchemaorg.serialNumber])
      .toEqual(expect.any(String));

    // A confirmed registration remains discoverable through its original
    // Offer projection. This catches pending -> active rewrites that preserve
    // encrypted content but accidentally drop non-hydrated `meta.claims`.
    const offerSearchPayload = {
      thid: 'family-offer-search-story-thid',
      jti: 'family-offer-search-story-jti',
      iss: 'did:web:controller.example.com',
      aud: 'did:web:api.acme.org',
      type: 'application/json',
      body: {
        data: [{
          type: 'Offer-search-request-v1.0',
          resource: { meta: { claims: { [ClaimsOfferSchemaorg.identifier]: offerId } } },
        }],
      },
    };
    const offerSearchSubmit = await invokeExpress(harness.app, {
      method: 'POST',
      url: `/${tenantId}/cds-es/v1/health-care/individual/org.schema/Offer/_search`,
      headers: { 'content-type': 'application/json' },
      body: offerSearchPayload,
    });
    expect(offerSearchSubmit.status).toBe(202);
    await harness.queueAdapter.waitForEmptyQueue();
    const offerSearchPoll = await pollJsonBody(
      harness.app,
      offerSearchSubmit.headers.location,
      offerSearchPayload.thid,
    );
    expect(offerSearchPoll.status).toBe(200);
    expect(offerSearchPoll.body.data[0].response.status).toBe('200');
    expect(extractBundleSearchResources(offerSearchPoll.body).length).toBeGreaterThanOrEqual(1);

    // Re-starting the same individual is a read/idempotency outcome, not a new
    // pending Order. Channels use this status to avoid reconfirming an active
    // Offer and triggering the historical "not in pending state" conflict.
    const repeatedRegistrationPayload = structuredClone(registrationPayload);
    repeatedRegistrationPayload.thid = 'family-transaction-repeat-story-thid';
    repeatedRegistrationPayload.jti = 'family-transaction-repeat-story-jti';
    const repeatedSubmit = await invokeExpress(harness.app, {
      method: 'POST',
      url: `/${tenantId}/cds-es/v1/health-care/individual/org.schema/Organization/_transaction`,
      headers: { 'content-type': 'application/json' },
      body: repeatedRegistrationPayload,
    });
    expect(repeatedSubmit.status).toBe(202);
    await harness.queueAdapter.waitForEmptyQueue();
    const repeatedPoll = await pollJsonBody(
      harness.app,
      repeatedSubmit.headers.location,
      repeatedRegistrationPayload.thid,
    );
    expect(repeatedPoll.status).toBe(200);
    expect(repeatedPoll.body.data[0].response.status).toBe('200');
    const repeatedClaims = repeatedPoll.body.data[0].resource.meta.claims;
    const sharedFamilySearchClaims = EXAMPLE_FAMILY_ORGANIZATION_SEARCH_RESPONSE_BODY.body.data[0].resource.meta.claims;
    expect(Object.values(repeatedClaims)).toContain(Object.values(sharedFamilySearchClaims)[0]);
    expect(repeatedClaims[ClaimsOfferSchemaorg.identifier]).toBe(offerId);
  });
});
