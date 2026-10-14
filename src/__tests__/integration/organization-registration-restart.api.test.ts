// Flow contract: reuse shared test fixtures and canonical types; do not introduce duplicated literals.
/**
 * Complete local restart journey:
 * 1. Submit and poll one reviewed organization transaction whose historical
 *    pending record lacks the pre-DCR communication-key projection.
 * 2. Stop the queue and reconstruct managers, cache, KMS and async state over
 *    the same durable repository.
 * 3. Replay the same reviewed transaction with its verified public keys and
 *    require the exact original Offer, never a replacement Offer.
 * 4. Confirm that Offer through Order and require the activation licence that
 *    precedes exchange and DCR.
 * Authorization invariant: only keys from the reverified transaction may fill
 * the pending binding; an Order envelope cannot self-attest authority.
 * Persistence invariant: restart discards process state while the protected
 * pending record and original Offer remain authoritative.
 */
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import {
  ClaimsIndividualProductSchemaorg,
  ClaimsOfferSchemaorg,
  ClaimsOrderSchemaorg,
  ClaimsOrganizationSchemaorg,
  ClaimsServiceSchemaorg,
} from 'gdc-common-utils-ts/constants/schemaorg';
import { VaultMemRepository } from '../../database/repositories/vault/vault.mem.repository';
import { getEnvSectionId } from '../../utils/section-env';
import { getTenantVaultId } from '../../utils/tenant';
import { ORGANIZATION_ORDER_REQUEST, ORGANIZATION_VERIFICATION_TRANSACTION_REQUEST } from '../data/example-payloads';
import { testAnimalResearchRegistrationClaims } from '../data/organization-registration-replay.data';
import { buildRestartableGateway, type RestartableGatewayHarness } from './helpers/restartable-gateway';
import { installIcaVerifyFetchMock, pollJsonBody } from './helpers/story-flow';
import { invokeExpress } from './helpers/invokeExpress';

describe('organization registration continuation across local GW restart', () => {
  let originalFetch: typeof global.fetch;
  let initial: RestartableGatewayHarness;
  let restarted: RestartableGatewayHarness;

  beforeAll(() => {
    process.env.DEV_SEED = 'true';
    process.env.NODE_ENV = 'development';
    process.env.SECURITY_MODE = 'demo';
    process.env.JSON_LEGACY = 'true';
    process.env.FHIR_LEGACY = 'true';
    process.env.DIDCOMM_PLAIN = 'true';
    process.env.DEMO_ALLOW_INSECURE_BEARER = 'true';
    originalFetch = installIcaVerifyFetchMock();
  });

  afterAll(() => {
    global.fetch = originalFetch;
    initial?.queueAdapter.stop();
    restarted?.queueAdapter.stop();
  });

  it('preserves Offer, recovers verified keys, and issues the activation licence', async () => {
    const repository = new VaultMemRepository();
    initial = await buildRestartableGateway(repository);
    const firstTransaction = structuredClone(ORGANIZATION_VERIFICATION_TRANSACTION_REQUEST) as any;
    firstTransaction.body.data[0].resource.meta.claims = {
      ...firstTransaction.body.data[0].resource.meta.claims,
      ...testAnimalResearchRegistrationClaims,
    };
    delete firstTransaction.meta.jws.protected.jwk;
    delete firstTransaction.meta.jwe.header.jwk;

    const firstSubmit = await invokeExpress(initial.app, {
      method: 'POST',
      url: '/host/cds-es/v1/test/registry/org.schema/Organization/_transaction',
      headers: { 'content-type': 'application/json' },
      body: firstTransaction,
    });
    expect(firstSubmit.status).toBe(202);
    await initial.queueAdapter.waitForEmptyQueue();
    const firstPoll = await pollJsonBody(initial.app, firstSubmit.headers.location, firstTransaction.thid);
    const firstClaims = firstPoll.body.data[0].resource.meta.claims;
    const offerId = String(firstClaims[ClaimsOfferSchemaorg.identifier] || '');
    expect(offerId).toContain(':Offer:');

    const vaultId = getTenantVaultId(
      firstClaims[ClaimsServiceSchemaorg.category],
      firstClaims[ClaimsOrganizationSchemaorg.alternateName],
    );
    const beforeRestart = await repository.get<any>(initial.hostCollectionName, vaultId, getEnvSectionId('tenants'));
    const historicalPending = await initial.kmsService.unprotectConfidentialData<any>(beforeRestart!, 'host');
    expect(historicalPending.registrationKeys).toBeUndefined();

    initial.queueAdapter.stop();
    restarted = await buildRestartableGateway(repository);
    const replayTransaction = structuredClone(ORGANIZATION_VERIFICATION_TRANSACTION_REQUEST) as any;
    replayTransaction.body.data[0].resource.meta.claims = {
      ...replayTransaction.body.data[0].resource.meta.claims,
      ...testAnimalResearchRegistrationClaims,
    };
    replayTransaction.jti = `${replayTransaction.jti}-restart`;
    replayTransaction.thid = `${replayTransaction.thid}-restart`;
    const replaySubmit = await invokeExpress(restarted.app, {
      method: 'POST',
      url: '/host/cds-es/v1/test/registry/org.schema/Organization/_transaction',
      headers: { 'content-type': 'application/json' },
      body: replayTransaction,
    });
    expect(replaySubmit.status).toBe(202);
    await restarted.queueAdapter.waitForEmptyQueue();
    const replayPoll = await pollJsonBody(restarted.app, replaySubmit.headers.location, replayTransaction.thid);
    expect(replayPoll.body.data[0].resource.meta.claims[ClaimsOfferSchemaorg.identifier]).toBe(offerId);

    const afterRestart = await repository.get<any>(restarted.hostCollectionName, vaultId, getEnvSectionId('tenants'));
    const resumedPending = await restarted.kmsService.unprotectConfidentialData<any>(afterRestart!, 'host');
    expect(resumedPending.registrationControllerDid).toBe(replayTransaction.iss);
    expect(resumedPending.registrationKeys?.signerJwk?.kid).toBe(replayTransaction.meta.jws.protected.kid);
    expect(resumedPending.registrationKeys?.encrypterJwk?.kid).toBe(replayTransaction.meta.jwe.header.skid);

    const order = structuredClone(ORGANIZATION_ORDER_REQUEST) as any;
    order.body.data[0].meta = {};
    order.body.data[0].resource = { meta: { claims: {
      [ClaimsOrderSchemaorg.acceptedOfferIdentifier]: offerId,
      [ClaimsOrderSchemaorg.paymentMethod]: 'Stripe',
      [ClaimsOrderSchemaorg.partOfInvoice]: 'restart-contract-invoice',
    } } };
    const orderSubmit = await invokeExpress(restarted.app, {
      method: 'POST',
      url: '/host/cds-es/v1/test/registry/org.schema/Order/_batch',
      headers: { 'content-type': 'application/json' },
      body: order,
    });
    expect(orderSubmit.status).toBe(202);
    await restarted.queueAdapter.waitForEmptyQueue();
    const orderPoll = await pollJsonBody(restarted.app, orderSubmit.headers.location, order.thid);
    expect(orderPoll.body.data[0].response.status).toBe('201');
    expect(orderPoll.body.data[0].resource.meta.claims[ClaimsOrderSchemaorg.acceptedOfferIdentifier]).toBe(offerId);
    expect(orderPoll.body.data[0].resource.meta.claims[ClaimsIndividualProductSchemaorg.serialNumber]).toBeTruthy();
  });
});
