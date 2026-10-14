// Flow contract: reuse shared test fixtures and canonical types; do not introduce duplicated literals.
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
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
  EMPLOYEE_DISABLE_REQUEST,
  EMPLOYEE_PURGE_REQUEST,
  EMPLOYEE_REGISTRATION_REQUEST,
} from '../data/example-payloads';
import { ORGANIZATION_ORDER_REQUEST } from '../data/example-payloads';
import { ClaimsOfferSchemaorg, ClaimsOrderSchemaorg } from 'gdc-common-utils-ts/constants/schemaorg';
import { EXAMPLE_LICENSE_INVOICE_ID, EXAMPLE_LICENSE_PAYMENT_METHOD_STRIPE } from 'gdc-common-utils-ts/examples/shared';
import { withCanonicalEntryClaims } from '../helpers/canonical-bundle-entry';

/**
 * Route flow contract: Employee/_batch POST must return a host Offer rather
 * than persist an unlicensed employee. Order/_batch then materializes a seat;
 * import is a future, separate operation and is not encoded in Person claims.
 */

describe('Employee create/disable/re-enable route story', () => {
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

  it('returns a commercial Offer before creating an interactive employee when no seat is free', async () => {
    const employeeUrl = `/${tenantId}/cds-es/v1/health-care/entity/org.schema/Employee/_batch`;
    const payload = structuredClone(EMPLOYEE_REGISTRATION_REQUEST) as any;
    payload.thid = 'employee-strict-license-offer-story-thid';
    payload.jti = 'employee-strict-license-offer-story-jti';
    payload.body.data[0] = withCanonicalEntryClaims(payload.body.data[0], {});
    payload.body.data[0].request = { method: 'POST' };

    const submit = await invokeExpress(harness.app, {
      method: 'POST', url: employeeUrl,
      headers: { 'content-type': 'application/json' }, body: payload,
    });
    expect(submit.status).toBe(202);
    await harness.queueAdapter.waitForEmptyQueue();

    const poll = await pollJsonBody(harness.app, submit.headers.location, payload.thid);
    expect(poll.status).toBe(200);
    expect(poll.body.data[0].type).toBe('Employee-license-offer-v1.0');
    expect(poll.body.data[0].resource?.meta?.claims?.[ClaimsOfferSchemaorg.identifier]).toBeTruthy();
    expect(poll.body.data[0].resource?.id).toBeUndefined();

    // Confirm the exact Offer through the same auditable zero-price Order path
    // used by staging; the following lifecycle tests then consume that seat.
    const offerId = poll.body.data[0].resource.meta.claims[ClaimsOfferSchemaorg.identifier];
    const orderPayload = structuredClone(ORGANIZATION_ORDER_REQUEST) as any;
    orderPayload.body.data[0].meta = {};
    orderPayload.body.data[0].resource = { meta: { claims: {
      [ClaimsOrderSchemaorg.acceptedOfferIdentifier]: offerId,
      [ClaimsOrderSchemaorg.paymentMethod]: EXAMPLE_LICENSE_PAYMENT_METHOD_STRIPE,
      [ClaimsOrderSchemaorg.partOfInvoice]: EXAMPLE_LICENSE_INVOICE_ID,
    } } };
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
  });

  it('creates an employee, disables it, and re-enables the same business identity', async () => {
    const employeeUrl = `/${tenantId}/cds-es/v1/health-care/entity/org.schema/Employee/_batch`;

    const createPayload = structuredClone(EMPLOYEE_REGISTRATION_REQUEST) as any;
    createPayload.thid = 'employee-create-story-thid';
    createPayload.jti = 'employee-create-story-jti';
    createPayload.body.data[0] = withCanonicalEntryClaims(createPayload.body.data[0], {});
    createPayload.body.data[0].request = { method: 'POST' };

    const createSubmit = await invokeExpress(harness.app, {
      method: 'POST',
      url: employeeUrl,
      headers: { 'content-type': 'application/json' },
      body: createPayload,
    });

    expect(createSubmit.status).toBe(202);
    await harness.queueAdapter.waitForEmptyQueue();

    const createPoll = await pollJsonBody(harness.app, createSubmit.headers.location, createPayload.thid);
    expect(createPoll.status).toBe(200);

    const createdEntry = createPoll.body.data[0];
    const employeeId = String(createdEntry.resource?.id || '');
    expect(createdEntry.response.status).toBe('201');
    expect(employeeId).toBeTruthy();

    const occupationId = String(createdEntry.resource?.contained?.[0]?.id || '');
    expect(occupationId).toBeTruthy();
    const searchPayload = structuredClone(createPayload) as any;
    searchPayload.thid = 'employee-search-with-occupation-story-thid';
    searchPayload.jti = 'employee-search-with-occupation-story-jti';
    searchPayload.body = {
      resourceType: 'Bundle',
      type: 'batch',
      entry: [{
        request: { method: 'POST', url: 'Employee/_search' },
        resource: { resourceType: 'Parameters' },
      }],
    };
    const searchSubmit = await invokeExpress(harness.app, {
      method: 'POST',
      url: employeeUrl.replace('/_batch', '/_search'),
      headers: { 'content-type': 'application/json' },
      body: searchPayload,
    });
    expect(searchSubmit.status).toBe(202);
    await harness.queueAdapter.waitForEmptyQueue();
    const searchPoll = await pollJsonBody(harness.app, searchSubmit.headers.location, searchPayload.thid);
    const searchedEmployee = searchPoll.body.data
      .flatMap((entry: any) => Array.isArray(entry.resource?.data) ? entry.resource.data : [entry.resource])
      .find((resource: any) => resource?.id === employeeId);
    expect(searchedEmployee?.contained).toEqual([expect.objectContaining({
      id: occupationId,
      type: 'Occupation',
      employeeId,
    })]);

    const disablePayload = structuredClone(EMPLOYEE_DISABLE_REQUEST) as any;
    disablePayload.thid = 'employee-disable-story-thid';
    disablePayload.jti = 'employee-disable-story-jti';
    disablePayload.body.data[0].resource.id = employeeId;

    const disableSubmit = await invokeExpress(harness.app, {
      method: 'POST',
      url: employeeUrl,
      headers: { 'content-type': 'application/json' },
      body: disablePayload,
    });

    expect(disableSubmit.status).toBe(202);
    await harness.queueAdapter.waitForEmptyQueue();

    const disablePoll = await pollJsonBody(harness.app, disableSubmit.headers.location, disablePayload.thid);
    expect(disablePoll.status).toBe(200);

    const disabledEntry = disablePoll.body.data[0];
    expect(disabledEntry.response.status).toBe('200');
    expect(disabledEntry.resource?.id).toBe(employeeId);

    const reenablePayload = structuredClone(EMPLOYEE_REGISTRATION_REQUEST) as any;
    reenablePayload.thid = 'employee-reenable-story-thid';
    reenablePayload.jti = 'employee-reenable-story-jti';
    reenablePayload.body.data[0] = withCanonicalEntryClaims(reenablePayload.body.data[0], {});
    reenablePayload.body.data[0].resource.id = employeeId;
    reenablePayload.body.data[0].request = { method: 'POST' };

    const reenableSubmit = await invokeExpress(harness.app, {
      method: 'POST',
      url: employeeUrl,
      headers: { 'content-type': 'application/json' },
      body: reenablePayload,
    });

    expect(reenableSubmit.status).toBe(202);
    await harness.queueAdapter.waitForEmptyQueue();

    const reenablePoll = await pollJsonBody(harness.app, reenableSubmit.headers.location, reenablePayload.thid);
    expect(reenablePoll.status).toBe(200);

    const reenabledEntry = reenablePoll.body.data[0];
    expect(reenabledEntry.response.status).toBe('200');
    expect(reenabledEntry.resource?.id).toBe(employeeId);
  });

  it('disables and purges an employee using resource.id even when the identifier claim is not a UUID', async () => {
    const employeeUrl = `/${tenantId}/cds-es/v1/health-care/entity/org.schema/Employee/_batch`;

    const createPayload = structuredClone(EMPLOYEE_REGISTRATION_REQUEST) as any;
    createPayload.thid = 'employee-create-purge-story-thid';
    createPayload.jti = 'employee-create-purge-story-jti';
    createPayload.body.data[0] = withCanonicalEntryClaims(createPayload.body.data[0], {});
    createPayload.body.data[0].request = { method: 'POST' };

    const createSubmit = await invokeExpress(harness.app, {
      method: 'POST',
      url: employeeUrl,
      headers: { 'content-type': 'application/json' },
      body: createPayload,
    });

    expect(createSubmit.status).toBe(202);
    await harness.queueAdapter.waitForEmptyQueue();

    const createPoll = await pollJsonBody(harness.app, createSubmit.headers.location, createPayload.thid);
    expect(createPoll.status).toBe(200);

    const employeeId = String(createPoll.body.data[0].resource?.id || '');
    expect(employeeId).toBeTruthy();

    const disablePayload = structuredClone(EMPLOYEE_DISABLE_REQUEST) as any;
    disablePayload.thid = 'employee-disable-purge-story-thid';
    disablePayload.jti = 'employee-disable-purge-story-jti';
    disablePayload.body.data[0].resource.id = employeeId;

    const disableSubmit = await invokeExpress(harness.app, {
      method: 'POST',
      url: employeeUrl,
      headers: { 'content-type': 'application/json' },
      body: disablePayload,
    });

    expect(disableSubmit.status).toBe(202);
    await harness.queueAdapter.waitForEmptyQueue();

    const disablePoll = await pollJsonBody(harness.app, disableSubmit.headers.location, disablePayload.thid);
    expect(disablePoll.status).toBe(200);
    expect(disablePoll.body.data[0].response.status).toBe('200');

    const purgePayload = structuredClone(EMPLOYEE_PURGE_REQUEST) as any;
    purgePayload.thid = 'employee-purge-story-thid';
    purgePayload.jti = 'employee-purge-story-jti';
    purgePayload.body.data[0].resource.id = employeeId;

    const purgeSubmit = await invokeExpress(harness.app, {
      method: 'POST',
      url: employeeUrl.replace('/_batch', '/_purge'),
      headers: { 'content-type': 'application/json' },
      body: purgePayload,
    });

    expect(purgeSubmit.status).toBe(202);
    await harness.queueAdapter.waitForEmptyQueue();

    const purgePoll = await pollJsonBody(harness.app, purgeSubmit.headers.location, purgePayload.thid);
    expect(purgePoll.status).toBe(200);
    expect(purgePoll.body.data[0].response.status).toBe('200');
    expect(purgePoll.body.data[0].resource?.id).toBe(employeeId);
  });
});
