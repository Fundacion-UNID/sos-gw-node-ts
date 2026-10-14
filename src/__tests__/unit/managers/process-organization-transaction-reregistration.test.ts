import { describe, expect, it, jest } from '@jest/globals';
import { ClaimsOrganizationSchemaorg, ClaimsServiceSchemaorg } from 'gdc-common-utils-ts/constants/schemaorg';
import { processOrganizationVerificationTransaction } from '../../../managers/hosting/process-organization-verification';

describe('processOrganizationVerificationTransaction legacy re-registration', () => {
  it('uses the existing-tenant controller upsert and does not create a new Offer', async () => {
    const claims = {
      [ClaimsOrganizationSchemaorg.alternateName]: 'VATES-G00000000',
      [ClaimsServiceSchemaorg.category]: 'onehealth-research',
    };
    const representativeCredential = {
      id: 'urn:example:credential:historical-representative',
      issuer: 'did:web:ica.example.test',
      type: ['VerifiableCredential', 'LegalRepresentativeCredential'],
    };
    const createPendingTenantRegistrationFromClaims = jest.fn(async () => {
      throw new Error('must not create a second pending registration');
    });
    const reregisterExistingLegacyRepresentativeController = jest.fn(async (_input: unknown) => ({
      ...claims,
      [ClaimsOrganizationSchemaorg.identifier]: 'urn:example:organization:existing',
    }));

    const response = await processOrganizationVerificationTransaction({
      job: {
        tenantId: 'host',
        jurisdiction: 'es',
        sector: 'network',
        action: '_transaction',
        content: {
          thid: 'transaction-thread-001',
          iss: 'did:web:historical-portal.example.test',
          meta: { jws: { protected: { kid: 'historical-portal-public-key' } } },
          body: { data: [{ resource: { meta: { claims }, verification: { resourceType: 'contract' } } }] },
        },
      } as any,
      issuerDid: 'did:web:gateway.example.test',
      config: { sectorsAllowed: ['onehealth-research'], namespace: 'cds-ES', networkMode: 'network' } as any,
      normalizeClaims: value => value,
      createPendingTenantRegistrationFromClaims,
      createOrganizationIssueClaimsFromClaims: jest.fn() as any,
      forwardOrganizationVerificationTransactionToIca: jest.fn(async () => ({ resourceType: 'Bundle' })),
      extractCredentialResourcesFromIcaPayload: jest.fn(() => [representativeCredential]),
      reregisterExistingLegacyRepresentativeController,
    });

    expect(reregisterExistingLegacyRepresentativeController).toHaveBeenCalledWith(expect.objectContaining({
      claims,
      credentials: [representativeCredential],
    }));
    expect(createPendingTenantRegistrationFromClaims).not.toHaveBeenCalled();
    expect((response.body.data[0].resource as any).next).toBeUndefined();
    expect((response.body.data[0].resource as any).meta.claims[ClaimsOrganizationSchemaorg.identifier])
      .toBe('urn:example:organization:existing');
  });
});
