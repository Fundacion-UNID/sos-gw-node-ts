// Flow contract: reuse shared test fixtures and canonical types; do not introduce duplicated literals.
import { describe, expect, it, jest } from '@jest/globals';
import { ClaimsOfferSchemaorg } from 'gdc-common-utils-ts/constants/schemaorg';
import type { ConfidentialStorageDoc } from 'gdc-common-utils-ts/models/confidential-storage';
import { EntityLifecycleStatus } from '../../../gdc-backend-utils-node/models/enums';
import { createPendingTenantRegistration } from '../../../managers/hosting/create-pending-tenant-registration';
import { testClaimsRegisterTenantExpanded, testTenant1VaultId } from '../../data/organization.data';
import {
  testRegistrationControllerDid,
  testRegistrationEncrypterJwk,
  testRegistrationSignerJwk,
} from '../../data/organization-registration-replay.data';

describe('createPendingTenantRegistration restart continuation', () => {
  it('backfills verified controller keys while preserving the pending Offer after restart', async () => {
    let stored: ConfidentialStorageDoc | undefined;
    const offerIdentifier = 'urn:example:offer:restart-continuation';
    const repository = {
      vaultExists: jest.fn(async () => Boolean(stored)),
      get: jest.fn(async () => stored),
      put: jest.fn(async (_collection: string, docs: ConfidentialStorageDoc[]) => {
        [stored] = docs;
        return true;
      }),
    } as any;
    const kms = {
      protectConfidentialData: jest.fn(async (doc: ConfidentialStorageDoc) => ({ ...doc, jwe: { ciphertext: 'protected' } })),
      unprotectConfidentialData: jest.fn(async (doc: ConfidentialStorageDoc) => doc.content),
    } as any;
    const base = {
      claims: testClaimsRegisterTenantExpanded,
      config: { sectorsAllowed: [testClaimsRegisterTenantExpanded['org.schema.Service.category']], namespace: 'cds-ES' },
      vaultRepository: repository,
      kmsService: kms,
      hostRuntime: { hostCollectionName: 'host-collection' },
      applyLegalOrganizationIdentityCompatibility: (claims: any) => claims,
      extractResources: () => ({ organization: { id: testTenant1VaultId }, person: {}, service: {} }),
      handleServiceAttachment: async (service: any) => service,
      withHostedOrganizationOfferClaims: (claims: any) => ({
        ...claims,
        [ClaimsOfferSchemaorg.identifier]: offerIdentifier,
      }),
      getCurrentUrnNetwork: () => 'test-network',
    } as const;

    const firstClaims = await createPendingTenantRegistration({
      ...base,
      extractRegistrationKeys: () => ({}),
    } as any);
    const firstStored = stored;

    const resumedClaims = await createPendingTenantRegistration({
      ...base,
      registrationControllerDid: testRegistrationControllerDid,
      extractRegistrationKeys: () => ({
        signerJwk: testRegistrationSignerJwk,
        encrypterJwk: testRegistrationEncrypterJwk,
      }),
    } as any);

    expect(firstClaims[ClaimsOfferSchemaorg.identifier]).toBe(offerIdentifier);
    expect(resumedClaims[ClaimsOfferSchemaorg.identifier]).toBe(offerIdentifier);
    expect(stored?.id).toBe(testTenant1VaultId);
    expect(stored?.status).toBe(EntityLifecycleStatus.Pending);
    expect(stored?.sequence).toBe(Number(firstStored?.sequence || 0) + 1);
    expect((stored?.content as any).registrationControllerDid).toBe(testRegistrationControllerDid);
    expect((stored?.content as any).registrationKeys).toEqual({
      signerJwk: testRegistrationSignerJwk,
      encrypterJwk: testRegistrationEncrypterJwk,
    });
  });
});
