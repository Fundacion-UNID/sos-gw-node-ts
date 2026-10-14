import { describe, expect, it, jest } from '@jest/globals';
import { Sector } from 'gdc-common-utils-ts/models/urlPath';
import { ClaimsOfferSchemaorg, ClaimsOrganizationSchemaorg, ClaimsServiceSchemaorg } from 'gdc-common-utils-ts/constants/schemaorg';
import { JobStatus, type JobRequest } from 'gdc-common-utils-ts/models/confidential-job';
import type { BundleEntry } from 'gdc-common-utils-ts/models/bundle';
import { FamilyRegistrationStatus, GatewayClaim } from '../../../../shared/gateway-claim-contract';
import {
  processIndividualOrganizationRegistrationEntry,
  processIndividualOrganizationSearchEntry,
} from '../../../../managers/hosting/process-individual-organization';

/**
 * Flow contract: hosted individual registration compatibility route
 *
 * 1. The route stores the individual Organization inside an active UNID
 *    tenant but does not pretend to complete wallet/device/controller crypto.
 * 2. It preserves the public sameAs CSV but indexes each alias independently.
 * 3. It creates the product baseline of two free member seats, assigning the
 *    first to the owner with the exact public card binding and leaving the
 *    second available.
 * 4. Repeated registration repairs a legacy controller seat that predates the
 *    card binding and must not create a second baseline pool.
 */
describe('processIndividualOrganizationRegistrationEntry', () => {
  function buildJob(): JobRequest {
    return {
      id: 'job-individual-registration-001',
      status: JobStatus.DRAFT,
      sequence: 0,
      createdAtTimestamp: Date.now(),
      tenantId: 'acme-health',
      sector: Sector.HEALTH_CARE,
      section: 'individual',
      format: 'org.schema',
      action: '_batch',
      resourceType: 'Organization',
      content: { body: { data: [] } } as any,
    } as JobRequest;
  }

  it('creates only the deprecated embedded administrative registration, not a controller-ready onboarding result', async () => {
    const protectConfidentialData = jest.fn(async (doc: unknown) => doc);
    const put = jest.fn(async (_collection: string, _documents: any[], _section: string) => undefined);

    const response = await processIndividualOrganizationRegistrationEntry({
      job: buildJob(),
      entry: {
        type: 'Family-registration-request-v1.0',
        resource: {
          resourceType: 'Organization',
          meta: { claims: {
            [ClaimsOrganizationSchemaorg.alternateName]: 'ana-story',
            'org.schema.Organization.owner.email': 'adult1@example.com',
            [ClaimsServiceSchemaorg.category]: Sector.HEALTH_CARE,
          } },
        },
      } as any,
      environment: 'test',
      tenantsCacheManager: {
        getTenant: jest.fn(async () => ({
          networkStatus: [{ networkName: 'test', status: 'active' }],
        })),
        getCollectionName: jest.fn(async () => 'health-care_acme-health'),
      },
      vaultRepository: {
        query: jest.fn(async () => []),
        getContainersInSection: jest.fn(async () => []),
        put,
      },
      kmsService: {
        protectConfidentialData,
      },
      extractResources: jest.fn((claims) => ({
        organization: {
          id: 'individual-org-001',
          meta: { claims },
        },
      })),
    });

    const responseClaims = (response as BundleEntry).resource?.meta?.claims || {};

    // Step 1: the deprecated embedded flow persists only the administrative
    // subject registration inside an existing tenant.
    expect(response.response?.status).toBe('201');
    expect(put).toHaveBeenCalledTimes(2);
    // Step 2: it signals lifecycle status only, not a commercial Offer.
    expect(responseClaims[GatewayClaim.FamilyRegistrationStatus]).toBe(FamilyRegistrationStatus.Created);
    expect(responseClaims[ClaimsOfferSchemaorg.identifier]).toBeUndefined();
    // Step 3: the absence of Offer is part of the contract, so callers must
    // not attempt a follow-up `Order/_batch`.
    expect((response as any).resource?.next).toBeUndefined();
    // Step 4: this also means the flow must not be misread as a full
    // controller onboarding with wallet/profile/device/key activation.
    // Step 5: product licensing is nevertheless explicit. The controller
    // consumes the first free member seat and one remains available.
    const licenseDocuments = put.mock.calls[1][1] as any[];
    expect(licenseDocuments).toHaveLength(2);
    expect(licenseDocuments.map((doc) => doc.content.status)).toEqual(['active', 'available']);
    expect(licenseDocuments.every((doc) => doc.content.ownerOrganizationId === 'individual-org-001')).toBe(true);
  });

  it('indexes every sameAs alias independently so cards and hashed documents resolve the individual', async () => {
    const protectConfidentialData = jest.fn(async (doc: any) => doc);
    const put = jest.fn(async (_collection: string, _documents: any[], _section: string) => undefined);
    const cardDidWeb = 'did:web:unid.online:card:uhc:personal:000-000-000-001';
    const nationalIdentifierCid = 'zb2rhindividualidentifiercid';
    const sameAsCsv = `${cardDidWeb},${nationalIdentifierCid}`;

    await processIndividualOrganizationRegistrationEntry({
      job: buildJob(),
      entry: {
        type: 'Family-registration-request-v1.0',
        resource: {
          resourceType: 'Organization',
          meta: { claims: {
            [ClaimsOrganizationSchemaorg.alternateName]: 'subject-example',
            'org.schema.Organization.owner.email': 'controller@example.com',
            'org.schema.Organization.sameAs': sameAsCsv,
            [ClaimsServiceSchemaorg.category]: Sector.HEALTH_CARE,
          } },
        },
      } as any,
      environment: 'test',
      tenantsCacheManager: {
        getTenant: jest.fn(async () => ({
          networkStatus: [{ networkName: 'test', status: 'active' }],
        })),
        getCollectionName: jest.fn(async () => 'health-care_acme-health'),
      },
      vaultRepository: {
        query: jest.fn(async () => []),
        getContainersInSection: jest.fn(async () => []),
        put,
      },
      kmsService: { protectConfidentialData },
      extractResources: jest.fn((claims) => ({
        organization: { id: 'individual-org-uhc-001', meta: { claims } },
      })),
    });

    // Step 1: the complete claim remains protected in the confidential document.
    const registrationDoc = protectConfidentialData.mock.calls[0][0];
    expect(registrationDoc.content.claims['org.schema.Organization.sameAs']).toBe(sameAsCsv);
    // Step 2: every alias is an independent indexed equality attribute. This
    // avoids decrypting every subject registration and never treats CSV as one id.
    expect(registrationDoc.indexed.attributes).toEqual(expect.arrayContaining([
      { name: 'org.schema.Organization.sameAs', value: cardDidWeb },
      { name: 'org.schema.Organization.sameAs', value: nationalIdentifierCid },
    ]));
    // Step 3: portal and telephone re-entry use the same active ONESELF grant.
    // The exact sameAs value is therefore persisted on the controller seat.
    const licenseDocuments = put.mock.calls[1][1] as any[];
    expect(licenseDocuments[0].content).toMatchObject({
      authorizedSubjectDid: cardDidWeb,
      issuedToEmail: 'controller@example.com',
      issuedToRole: 'v3-RoleCode|ONESELF',
    });
  });

  it('repairs the active controller seat when a repeated registration finds a legacy card', async () => {
    const cardDidWeb = 'did:web:unid.online:card:uhc:personal:legacy-controller';
    const legacyLicense = {
      id: 'license-controller-legacy',
      status: 'active',
      sequence: 0,
      content: {
        id: 'license-controller-legacy',
        tenantId: 'acme-health',
        ownerOrganizationId: 'individual-org-existing',
        userClass: 'individual',
        type: 'web',
        status: 'active',
        subjectId: 'controller@example.com',
        issuedToEmail: 'controller@example.com',
        issuedToRole: 'v3-RoleCode|ONESELF',
      },
    };
    const put = jest.fn(async (_collection: string, _documents: any[], _section: string) => undefined);

    const response = await processIndividualOrganizationRegistrationEntry({
      job: buildJob(),
      entry: { resource: { resourceType: 'Organization', meta: { claims: {
        [ClaimsOrganizationSchemaorg.alternateName]: 'subject-example',
        'org.schema.Organization.owner.email': 'controller@example.com',
        'org.schema.Organization.sameAs': cardDidWeb,
        [ClaimsServiceSchemaorg.category]: Sector.HEALTH_CARE,
      } } } } as any,
      tenantsCacheManager: {
        getTenant: jest.fn(async () => ({ networkStatus: [{ networkName: 'test', status: 'active' }] })),
        getCollectionName: jest.fn(async () => 'health-care_acme-health'),
      },
      vaultRepository: {
        query: jest.fn(async () => [{ id: 'individual-org-existing' }]),
        getContainersInSection: jest.fn(async () => [legacyLicense]),
        put,
      },
      kmsService: {
        unprotectConfidentialData: jest.fn(async () => ({ claims: {
          [ClaimsOrganizationSchemaorg.alternateName]: 'subject-example',
          'org.schema.Organization.owner.email': 'controller@example.com',
          'org.schema.Organization.sameAs': cardDidWeb,
          [ClaimsServiceSchemaorg.category]: Sector.HEALTH_CARE,
        } })),
      },
      extractResources: jest.fn((_claims: any) => ({ organization: {} })),
    });

    expect((response as BundleEntry).resource?.meta?.claims?.[GatewayClaim.FamilyRegistrationStatus]).toBe(FamilyRegistrationStatus.Existing);
    expect(put).toHaveBeenCalledWith('health-care_acme-health', expect.arrayContaining([expect.objectContaining({
      sequence: 1,
      content: expect.objectContaining({ authorizedSubjectDid: cardDidWeb }),
    })]), expect.any(String));
  });

  it('does not add an empty UHC sameAs index when no card identifier was issued', async () => {
    const protectConfidentialData = jest.fn(async (doc: any) => doc);

    await processIndividualOrganizationRegistrationEntry({
      job: buildJob(),
      entry: {
        type: 'Family-registration-request-v1.0',
        resource: {
          resourceType: 'Organization',
          meta: { claims: {
            [ClaimsOrganizationSchemaorg.alternateName]: 'doraemon',
            'org.schema.Organization.owner.telephone': '+34600000000',
            [ClaimsServiceSchemaorg.category]: Sector.HEALTH_CARE,
          } },
        },
      } as any,
      environment: 'test',
      tenantsCacheManager: {
        getTenant: jest.fn(async () => ({
          networkStatus: [{ networkName: 'test', status: 'active' }],
        })),
        getCollectionName: jest.fn(async () => 'health-care_acme-health'),
      },
      vaultRepository: {
        query: jest.fn(async () => []),
        getContainersInSection: jest.fn(async () => []),
        put: jest.fn(async () => undefined),
      },
      kmsService: { protectConfidentialData },
      extractResources: jest.fn((claims) => ({
        organization: { id: 'individual-org-no-uhc-001', meta: { claims } },
      })),
    });

    const registrationDoc = protectConfidentialData.mock.calls[0][0];
    expect(registrationDoc.indexed.attributes).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'org.schema.Organization.sameAs' }),
    ]));
  });

  it('resolves one authorized card by exact sameAs without an owner/nickname scan', async () => {
    const cardDidWeb = 'did:web:unid.online:card:uhc:personal:subject-example';
    const query = jest.fn(async (_collection: string, _query: unknown) => [{ id: 'subject-example-org', content: {} }]);

    // Step 1. The accepted license supplies the exact public card DID.
    const response = await processIndividualOrganizationSearchEntry({
      job: { ...buildJob(), action: '_search' },
      entry: { resource: { resourceType: 'Organization', meta: { claims: {
        '@context': 'org.schema',
        'org.schema.Organization.sameAs': cardDidWeb,
      } } } } as any,
      tenantsCacheManager: {
        getTenant: jest.fn(async () => ({ networkStatus: [{ networkName: 'test', status: 'active' }] })),
        getCollectionName: jest.fn(async () => 'health-care_acme-health'),
      },
      vaultRepository: { query },
      kmsService: { unprotectConfidentialData: jest.fn(async () => ({ claims: {
        'org.schema.Organization.sameAs': cardDidWeb,
        [ClaimsOrganizationSchemaorg.alternateName]: 'Tía Subject example',
      } })) },
    });

    // Step 2. GW performs one equality query and returns the compact source
    // claims; it never enumerates the individual section.
    expect(query).toHaveBeenCalledWith('health-care_acme-health', {
      sectionId: expect.any(String),
      where: [{ name: 'org.schema.Organization.sameAs', value: cardDidWeb }],
    });
    expect((response as any).resource).toMatchObject({ id: 'subject-example-org' });
    expect((response as BundleEntry).resource?.meta?.claims?.[ClaimsOrganizationSchemaorg.alternateName]).toBe('Tía Subject example');
  });
});
