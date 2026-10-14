// Flow contract: reuse shared test fixtures and canonical types; do not introduce duplicated literals.
import { resolveHostPhysicalCollectionName } from '../../config/storage-layout';
/**
 * 1. An authenticated current tenant controller creates an enumerated FHIR R5
 *    Group base through the organization endpoint.
 * 2. The controller adds each PractitionerRole as a separately persisted
 *    member PATCH, replaces the base and searches by the official `member`
 *    SearchParameter.
 * 3. The same boundary stores a frozen animal campaign cohort with Animal
 *    member projections, without treating membership as authorization.
 * 4. An explicit member DELETE removes only that projection; a later base
 *    DELETE removes the Group and every remaining member projection.
 *
 * Authorization invariant: Group membership is descriptive and does not grant
 * SMART access; only a current tenant controller may mutate the Group.
 * Persistence invariant: only canonical flat claims are encrypted inside the
 * tenant/sector/jurisdiction storage boundary; native FHIR JSON is never
 * retained and each batch entry succeeds or fails independently.
 */
import { afterEach, expect, it } from '@jest/globals';
import { ClaimsOrganizationSchemaorg, ClaimsServiceSchemaorg } from 'gdc-common-utils-ts/constants/schemaorg';
import type { Sector } from 'gdc-common-utils-ts/models/urlPath';
import {
  projectGroupPractitionerRoleMemberFlatClaimResources,
  projectGroupR5FlatClaimsResource,
} from 'vet-data-utils-ts';
import { buildGroupMemberSectionId } from '../../managers/GroupManager';
import { startServer, resetServerConfig } from '../../server';
import { getEnvSectionId } from '../../utils/section-env';
import { generateTenantCollectionNameFromClaims, getTenantVaultId } from '../../utils/tenant';
import { initializeTenantServicesConfig } from '../../utils/services';
import { testPayloadCreateTenant1 } from '../data/end-to-end.data';
import {
  researchGroupFixture,
  researchGroupRouteFixture,
  researchGroupSearchProjectionFixture,
} from '../data/research-group.data';
import { configureAuthenticatedTestActor } from './helpers/authenticated-test-actor';
import { invokeExpress } from './helpers/invokeExpress';
import { GATEWAY_PROFILE_TEST_SUBJECTS } from '../../config/gateway-capability-profile';

afterEach(() => resetServerConfig());

it('executes Group create, update, search and delete through the real asynchronous HTTP boundary', async () => {
  configureEnvironment();
  const authenticatedActor = await configureAuthenticatedTestActor();
  resetServerConfig();
  const { app, queueAdapter, tenantManager, vaultRepository, kmsService } = await startServer({ listen: false });

  try {
    const baseGroup = projectGroupR5FlatClaimsResource({ ...researchGroupSearchProjectionFixture, member: [] });
    const memberResources = projectGroupPractitionerRoleMemberFlatClaimResources({
      groupId: researchGroupFixture.id,
      members: researchGroupFixture.member.map((member) => ({
        ...member,
        entity: { ...member.entity, type: 'PractitionerRole' as const },
      })),
    });
    const projectedClaims = baseGroup.meta.claims;
    const tenantClaims = await provisionTenant({
      tenantManager,
      vaultRepository,
      kmsService,
      controllerDid: authenticatedActor.actorDid,
    });
    const created = await submitAndPoll({
      app,
      authorization: authenticatedActor.authorizationHeader,
      issuer: authenticatedActor.actorDid,
      thid: 'research-group-create-integration',
      action: '_batch',
      data: [{
        request: { method: 'POST', url: 'Group' },
        resource: baseGroup,
      }],
    });
    expect(created.data[0].response.status).toBe('201');
    const replayed = await submitAndPoll({
      app,
      authorization: authenticatedActor.authorizationHeader,
      issuer: authenticatedActor.actorDid,
      thid: 'research-group-create-replay-integration',
      action: '_batch',
      data: [{ request: { method: 'POST', url: 'Group' }, resource: baseGroup }],
    });
    expect(replayed.data[0].response.status).toBe('200');

    for (const memberResource of memberResources) {
      const memberAdded = await submitAndPoll({
        app,
        authorization: authenticatedActor.authorizationHeader,
        issuer: authenticatedActor.actorDid,
        thid: `research-group-member-${memberResource.meta.claims['Group.member'][0]}`,
        action: '_batch',
        data: [{
          request: { method: 'PATCH', url: `Group/${researchGroupFixture.id}` },
          resource: memberResource,
        }],
      });
      expect(memberAdded.data[0].response.status).toBe('200');
    }

    const updatedClaims = { ...projectedClaims, 'Group.name': ['Active study reviewers'] };
    const updatedGroup = claimsResource(researchGroupFixture.id, updatedClaims);
    const combinedUpdatedGroup = claimsResource(researchGroupFixture.id, {
      ...updatedClaims,
      'Group.member': memberResources.map((member) => member.meta.claims['Group.member'][0]),
    });
    const updated = await submitAndPoll({
      app,
      authorization: authenticatedActor.authorizationHeader,
      issuer: authenticatedActor.actorDid,
      thid: 'research-group-update-integration',
      action: '_batch',
      data: [{
        request: { method: 'PUT', url: `Group/${researchGroupFixture.id}` },
        resource: updatedGroup,
      }],
    });
    expect(updated.data[0].resource).toMatchObject(updatedGroup);

    const searched = await submitAndPoll({
      app,
      authorization: authenticatedActor.authorizationHeader,
      issuer: authenticatedActor.actorDid,
      thid: 'research-group-search-integration',
      action: '_search',
      data: [{
        resource: {
          resourceType: 'Parameters',
          meta: { claims: { 'Group.member': [researchGroupFixture.member[0].entity.reference] } },
        },
      }],
    });
    expect(searched.data).toHaveLength(1);
    expect(searched.data[0].resource).toEqual(combinedUpdatedGroup);

    const physicalCollection = generateTenantCollectionNameFromClaims(tenantClaims);
    const storedBeforeDelete = await vaultRepository.listContainersInSection<any>(physicalCollection, 'research-groups');
    expect(storedBeforeDelete).toHaveLength(1);
    expect(await kmsService.unprotectConfidentialData(storedBeforeDelete[0], getTenantVaultId(
      researchGroupRouteFixture.sector,
      researchGroupRouteFixture.tenantId,
    ))).toEqual({ claims: updatedClaims });
    const storedMembers = await vaultRepository.listContainersInSection<any>(
      physicalCollection,
      buildGroupMemberSectionId(researchGroupFixture.id),
    );
    expect(storedMembers).toHaveLength(memberResources.length);
    await expect(Promise.all(storedMembers.map((record) => kmsService.unprotectConfidentialData(
      record,
      getTenantVaultId(researchGroupRouteFixture.sector, researchGroupRouteFixture.tenantId),
    )))).resolves.toEqual(expect.arrayContaining(memberResources.map((member) => ({ claims: member.meta.claims }))));
    expect(JSON.stringify(storedBeforeDelete[0].indexed)).not.toContain(researchGroupSearchProjectionFixture.identifier[0].value);

    const searchedByCanonicalIdentifier = await submitAndPoll({
      app,
      authorization: authenticatedActor.authorizationHeader,
      issuer: authenticatedActor.actorDid,
      thid: 'research-group-identifier-search-integration',
      action: '_search',
      data: [{
        resource: {
          resourceType: 'Parameters',
          meta: { claims: { 'Group.identifier': projectedClaims['Group.identifier'] } },
        },
      }],
    });
    expect(searchedByCanonicalIdentifier.data).toHaveLength(1);

    const campaignGroupId = 'campaign-cohort-one';
    const campaignBaseClaims = {
      'Group.identifier': ['https://soschain.org/fhir/NamingSystem/alert-cohort|urn:uuid:11111111-1111-4111-8111-111111111111'],
      'Group.name': ['Frozen eligible animal cohort'],
      'Group.type': ['animal'],
      'Group.membership': ['enumerated'],
    };
    const campaignMemberClaims = {
      'Group.type': ['animal'],
      'Group.membership': ['enumerated'],
      'Group.member': [GATEWAY_PROFILE_TEST_SUBJECTS.veterinary],
    };
    const campaignCreated = await submitAndPoll({
      app,
      authorization: authenticatedActor.authorizationHeader,
      issuer: authenticatedActor.actorDid,
      thid: 'animal-campaign-group-create-integration',
      action: '_batch',
      data: [{ request: { method: 'POST', url: 'Group' }, resource: claimsResource(campaignGroupId, campaignBaseClaims) }],
    });
    expect(campaignCreated.data[0].response.status).toBe('201');
    const campaignMemberAdded = await submitAndPoll({
      app,
      authorization: authenticatedActor.authorizationHeader,
      issuer: authenticatedActor.actorDid,
      thid: 'animal-campaign-group-member-integration',
      action: '_batch',
      data: [{
        request: { method: 'PATCH', url: `Group/${campaignGroupId}` },
        resource: claimsResource(campaignGroupId, campaignMemberClaims),
      }],
    });
    expect(campaignMemberAdded.data[0].response.status).toBe('200');
    const campaignSearched = await submitAndPoll({
      app,
      authorization: authenticatedActor.authorizationHeader,
      issuer: authenticatedActor.actorDid,
      thid: 'animal-campaign-group-search-integration',
      action: '_search',
      data: [{ resource: { resourceType: 'Parameters', meta: { claims: { 'Group.member': [GATEWAY_PROFILE_TEST_SUBJECTS.veterinary] } } } }],
    });
    expect(campaignSearched.data[0].resource).toEqual(claimsResource(campaignGroupId, {
      ...campaignBaseClaims,
      'Group.member': [GATEWAY_PROFILE_TEST_SUBJECTS.veterinary],
    }));
    const campaignRemoved = await submitAndPoll({
      app,
      authorization: authenticatedActor.authorizationHeader,
      issuer: authenticatedActor.actorDid,
      thid: 'animal-campaign-group-delete-integration',
      action: '_batch',
      data: [{
        request: { method: 'DELETE', url: `Group/${campaignGroupId}` },
        resource: { resourceType: 'Group', id: campaignGroupId },
      }],
    });
    expect(campaignRemoved.data[0].response.status).toBe('204');

    const searchedByBareIdentifier = await submitAndPoll({
      app,
      authorization: authenticatedActor.authorizationHeader,
      issuer: authenticatedActor.actorDid,
      thid: 'research-group-bare-identifier-search-integration',
      action: '_search',
      data: [{
        resource: {
          resourceType: 'Parameters',
          meta: { claims: { 'Group.identifier': [researchGroupSearchProjectionFixture.identifier[0].value] } },
        },
      }],
    });
    expect(searchedByBareIdentifier.data).toHaveLength(0);

    const searchedByCharacteristicReference = await submitAndPoll({
      app,
      authorization: authenticatedActor.authorizationHeader,
      issuer: authenticatedActor.actorDid,
      thid: 'research-group-characteristic-reference-search-integration',
      action: '_search',
      data: [{
        resource: {
          resourceType: 'Parameters',
          meta: { claims: { 'Group.characteristic-reference': projectedClaims['Group.characteristic-reference'] } },
        },
      }],
    });
    expect(searchedByCharacteristicReference.data).toHaveLength(1);

    const referenceAsTokenValue = await submitAndPoll({
      app,
      authorization: authenticatedActor.authorizationHeader,
      issuer: authenticatedActor.actorDid,
      thid: 'research-group-reference-as-value-search-integration',
      action: '_search',
      data: [{
        resource: {
          resourceType: 'Parameters',
          meta: { claims: { 'Group.value': projectedClaims['Group.characteristic-reference'] } },
        },
      }],
    });
    expect(referenceAsTokenValue.data).toHaveLength(0);

    const searchedByCompositeValue = await submitAndPoll({
      app,
      authorization: authenticatedActor.authorizationHeader,
      issuer: authenticatedActor.actorDid,
      thid: 'research-group-composite-value-search-integration',
      action: '_search',
      data: [{
        resource: {
          resourceType: 'Parameters',
          meta: {
            claims: {
              'Group.characteristic-value': projectedClaims['Group.characteristic-value']?.slice(0, 1),
            },
          },
        },
      }],
    });
    expect(searchedByCompositeValue.data).toHaveLength(1);

    const removedMember = await submitAndPoll({
      app,
      authorization: authenticatedActor.authorizationHeader,
      issuer: authenticatedActor.actorDid,
      thid: 'research-group-member-delete-integration',
      action: '_batch',
      data: [{
        request: { method: 'DELETE', url: `Group/${researchGroupFixture.id}` },
        resource: memberResources[0],
      }],
    });
    expect(removedMember.data[0].response.status).toBe('204');
    expect(await vaultRepository.listContainersInSection(physicalCollection, 'research-groups')).toHaveLength(1);
    expect(await vaultRepository.listContainersInSection(
      physicalCollection,
      buildGroupMemberSectionId(researchGroupFixture.id),
    )).toHaveLength(1);

    const removed = await submitAndPoll({
      app,
      authorization: authenticatedActor.authorizationHeader,
      issuer: authenticatedActor.actorDid,
      thid: 'research-group-delete-integration',
      action: '_batch',
      data: [{
        request: { method: 'DELETE', url: `Group/${researchGroupFixture.id}` },
        resource: { resourceType: 'Group', id: researchGroupFixture.id },
      }],
    });
    expect(removed.data[0].response.status).toBe('204');

    expect(await vaultRepository.listContainersInSection(physicalCollection, 'research-groups')).toHaveLength(0);
    expect(await vaultRepository.listContainersInSection(
      physicalCollection,
      buildGroupMemberSectionId(researchGroupFixture.id),
    )).toHaveLength(0);
  } finally {
    queueAdapter.stop();
  }
});

function claimsResource(id: string, claims: Readonly<Record<string, readonly string[] | undefined>>) {
  return { resourceType: 'Group', id, meta: { claims } };
}

function configureEnvironment(): void {
  process.env.NODE_ENV = 'test';
  process.env.DB_PROVIDER = 'mem';
  process.env.STORAGE_PROVIDER = 'mem';
  process.env.QUEUE_PROVIDER = 'mem';
  process.env.SECTORS_ALLOWED = researchGroupRouteFixture.sector;
  process.env.ORG_HOST_LEGAL_NAME = 'Gateway Host Services';
  process.env.ORG_HOST_JURISDICTION = 'CA';
  process.env.ORG_HOST_ID_TYPE = 'BN';
  process.env.ORG_HOST_ID_VALUE = '700000001';
  process.env.ORG_HOST_ADMIN_EMAIL = 'admin@host.example';
  process.env.ORG_HOST_ADMIN_UID = 'host-admin';
  process.env.ORG_HOST_ADMIN_ROLE = 'ISCO-08|1111';
  process.env.SECURITY_MODE = 'demo';
  process.env.JSON_LEGACY = 'true';
}

async function provisionTenant(input: {
  tenantManager: any;
  vaultRepository: any;
  kmsService: any;
  controllerDid: string;
}) {
  const hostClaims = {
    [ClaimsOrganizationSchemaorg.addressCountry]: process.env.ORG_HOST_JURISDICTION,
    [ClaimsOrganizationSchemaorg.identifierType]: process.env.ORG_HOST_ID_TYPE,
    [ClaimsOrganizationSchemaorg.identifierValue]: process.env.ORG_HOST_ID_VALUE,
    [ClaimsServiceSchemaorg.category]: 'system',
  };
  const tenantClaims = {
    ...(testPayloadCreateTenant1.body.data[0].resource.meta.claims as any),
    [ClaimsOrganizationSchemaorg.alternateName]: researchGroupRouteFixture.tenantId,
    [ClaimsOrganizationSchemaorg.addressCountry]: 'CA',
    [ClaimsOrganizationSchemaorg.addressRegion]: researchGroupRouteFixture.jurisdiction,
    [ClaimsServiceSchemaorg.category]: researchGroupRouteFixture.sector,
  };
  const tenantVaultId = getTenantVaultId(researchGroupRouteFixture.sector, researchGroupRouteFixture.tenantId);
  await input.kmsService.provisionKeys(tenantVaultId);
  const secureTenant = await input.kmsService.protectConfidentialData({
    id: tenantVaultId,
    status: 'active',
    sequence: 0,
    content: {
      claims: tenantClaims,
      didConfig: { service: initializeTenantServicesConfig(researchGroupRouteFixture.sector as Sector) },
      didDocument: {
        '@context': 'https://www.w3.org/ns/did/v1',
        id: 'did:web:tenant.integration.example',
        controller: [input.controllerDid],
      },
    },
  } as any, 'host');
  await input.vaultRepository.put(
    resolveHostPhysicalCollectionName(),
    [secureTenant],
    getEnvSectionId('tenants'),
  );
  await input.tenantManager.getTenant(tenantVaultId);
  return tenantClaims;
}

async function submitAndPoll(input: {
  app: any;
  authorization: string;
  issuer: string;
  thid: string;
  action: '_batch' | '_search';
  data: unknown[];
}): Promise<any> {
  const base = `/${researchGroupRouteFixture.tenantId}/cds-${researchGroupRouteFixture.jurisdiction}`
    + `/v1/${researchGroupRouteFixture.sector}/organization/org.hl7.fhir.r5/Group`;
  const submitted = await invokeExpress(input.app, {
    method: 'POST',
    url: `${base}/${input.action}`,
    headers: { 'content-type': 'application/json', authorization: input.authorization },
    body: { thid: input.thid, iss: input.issuer, body: { data: input.data } },
  });
  expect(submitted.status).toBe(202);

  for (let attempt = 0; attempt < 50; attempt += 1) {
    const polled = await invokeExpress(input.app, {
      method: 'POST',
      url: `${base}/${input.action}-response`,
      headers: { 'content-type': 'application/json' },
      body: { thid: input.thid },
    });
    if (polled.status === 200) return JSON.parse(polled.text);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Group async response timed out for ${input.action}.`);
}
