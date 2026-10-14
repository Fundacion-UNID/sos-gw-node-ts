// Flow contract: reuse shared test fixtures and canonical types; do not introduce duplicated literals.
import { resolveHostPhysicalCollectionName } from '../../config/storage-layout';
/**
 * 1. A cryptographically authenticated current tenant controller submits one
 *    claims-first FHIR R5 ResearchStudy to the tenant organization route.
 * 2. Replaying the same deterministic POST returns 200 without duplicating
 *    claims-only encrypted tenant storage.
 * 3. The same controller stores one correlated PractitionerRole party as a
 *    separate flat projection without mutating the study claims.
 * 4. Search returns the base and one separately correlated party entry, and a
 *    party-claim filter returns that exact pair without parallel arrays.
 * 5. The controller replaces the base claims and explicitly removes that one
 *    party projection without deleting the study.
 * 6. A later search returns only the claims-first base resource, while tenant,
 *    sector and jurisdiction remain isolated.
 *
 * Authorization invariant: DID controller membership is required for writes.
 * Persistence invariant: base and party documents encrypt only flat claims;
 * only official ResearchStudy SearchParameters are HMAC-indexed.
 */
import { afterEach, expect, it } from '@jest/globals';
import { ClaimsOrganizationSchemaorg, ClaimsServiceSchemaorg } from 'gdc-common-utils-ts/constants/schemaorg';
import type { Sector } from 'gdc-common-utils-ts/models/urlPath';
import { projectResearchStudyR5SearchClaims } from 'vet-data-utils-ts';
import {
  buildResearchStudyPartySectionId,
} from '../../managers/ResearchStudyManager';
import { startServer, resetServerConfig } from '../../server';
import { getEnvSectionId } from '../../utils/section-env';
import { generateTenantCollectionNameFromClaims, getTenantVaultId } from '../../utils/tenant';
import { initializeTenantServicesConfig } from '../../utils/services';
import { testPayloadCreateTenant1 } from '../data/end-to-end.data';
import { configureAuthenticatedTestActor } from './helpers/authenticated-test-actor';
import { invokeExpress } from './helpers/invokeExpress';

const tenantId = 'research-clinic';
const sector = 'animal-research';
const jurisdiction = 'CA-BC';
const studyId = 'study-integration-one';

afterEach(() => resetServerConfig());

it('executes controller create, correlated party PATCH and official-claim search through the HTTP async boundary', async () => {
  configureEnvironment();
  const authenticatedActor = await configureAuthenticatedTestActor();
  resetServerConfig();
  const { app, queueAdapter, tenantManager, vaultRepository, kmsService } = await startServer({ listen: false });

  try {
    const hostClaims = {
      [ClaimsOrganizationSchemaorg.addressCountry]: process.env.ORG_HOST_JURISDICTION,
      [ClaimsOrganizationSchemaorg.identifierType]: process.env.ORG_HOST_ID_TYPE,
      [ClaimsOrganizationSchemaorg.identifierValue]: process.env.ORG_HOST_ID_VALUE,
      [ClaimsServiceSchemaorg.category]: 'system',
    };
    const hostCollection = resolveHostPhysicalCollectionName();
    const tenantClaims = {
      ...(testPayloadCreateTenant1.body.data[0].resource.meta.claims as any),
      [ClaimsOrganizationSchemaorg.alternateName]: tenantId,
      [ClaimsOrganizationSchemaorg.addressCountry]: 'CA',
      [ClaimsOrganizationSchemaorg.addressRegion]: jurisdiction,
      [ClaimsServiceSchemaorg.category]: sector,
    };
    const tenantVaultId = getTenantVaultId(sector, tenantId);
    const tenantConfig = {
      claims: tenantClaims,
      didConfig: { service: initializeTenantServicesConfig(sector as Sector) },
      didDocument: {
        '@context': 'https://www.w3.org/ns/did/v1',
        id: 'did:web:tenant.integration.example',
        controller: [authenticatedActor.actorDid],
      },
    };
    await kmsService.provisionKeys(tenantVaultId);
    const secureTenant = await kmsService.protectConfidentialData(
      { id: tenantVaultId, status: 'active', sequence: 0, content: tenantConfig } as any,
      'host',
    );
    await vaultRepository.put(hostCollection, [secureTenant as any], getEnvSectionId('tenants'));
    await tenantManager.getTenant(tenantVaultId);

    const study = {
      resourceType: 'ResearchStudy',
      id: studyId,
      status: 'draft',
      title: 'Veterinary cohort',
      period: { start: '2026-01-01', end: '2026-12-31' },
    };
    const studyClaims = projectResearchStudyR5SearchClaims(study);
    const createPayload = await submitAndPoll({
      app,
      authorization: authenticatedActor.authorizationHeader,
      thid: 'research-study-create-integration',
      action: '_batch',
      content: {
        data: [{
          type: 'ResearchStudy-v5.0.0',
          request: { method: 'POST', url: 'ResearchStudy' },
          resource: claimsResource(studyId, studyClaims),
        }],
      },
      issuer: authenticatedActor.actorDid,
    });
    expect(createPayload.data[0].response.status).toBe('201');
    const replayPayload = await submitAndPoll({
      app,
      authorization: authenticatedActor.authorizationHeader,
      thid: 'research-study-create-replay-integration',
      action: '_batch',
      content: {
        data: [{
          type: 'ResearchStudy-v5.0.0',
          request: { method: 'POST', url: 'ResearchStudy' },
          resource: claimsResource(studyId, studyClaims),
        }],
      },
      issuer: authenticatedActor.actorDid,
    });
    expect(replayPayload.data[0].response.status).toBe('200');

    const partyClaims = {
      'ResearchStudy.party-name': ['Clinical reviewer'],
      'ResearchStudy.party-role': ['http://hl7.org/fhir/research-study-party-role|sub-investigator'],
      'ResearchStudy.party': ['PractitionerRole/reviewer-one'],
    };
    const patchPayload = await submitAndPoll({
      app,
      authorization: authenticatedActor.authorizationHeader,
      thid: 'research-study-patch-integration',
      action: '_batch',
      content: {
        data: [{
          type: 'ResearchStudy-v5.0.0',
          request: { method: 'PATCH', url: `ResearchStudy/${studyId}` },
          resource: claimsResource(studyId, partyClaims),
        }],
      },
      issuer: authenticatedActor.actorDid,
    });
    expect(patchPayload.data[0].resource).toEqual(claimsResource(studyId, partyClaims));

    const searchWithPartyPayload = await submitAndPoll({
      app,
      authorization: authenticatedActor.authorizationHeader,
      thid: 'research-study-search-with-party-integration',
      action: '_search',
      content: { data: [{
        resource: {
          resourceType: 'Parameters',
          meta: { claims: { 'ResearchStudy.title': ['Veterinary cohort'] } },
        },
      }] },
      issuer: authenticatedActor.actorDid,
    });
    expect(searchWithPartyPayload.data).toEqual([
      expect.objectContaining({
        type: 'ResearchStudy-search-response-v5.0.0',
        resource: claimsResource(studyId, studyClaims),
      }),
      expect.objectContaining({
        type: 'ResearchStudy-associated-party-search-response-v5.0.0',
        resource: claimsResource(studyId, partyClaims),
      }),
    ]);

    const searchByPartyPayload = await submitAndPoll({
      app,
      authorization: authenticatedActor.authorizationHeader,
      thid: 'research-study-search-by-party-integration',
      action: '_search',
      content: { data: [{
        resource: {
          resourceType: 'Parameters',
          meta: { claims: { 'ResearchStudy.party': partyClaims['ResearchStudy.party'] } },
        },
      }] },
      issuer: authenticatedActor.actorDid,
    });
    expect(searchByPartyPayload.data).toHaveLength(2);
    expect(searchByPartyPayload.data[1].resource).toEqual(claimsResource(studyId, partyClaims));

    const activeStudyClaims = { ...studyClaims, 'ResearchStudy.status': ['active'] };
    const updatePayload = await submitAndPoll({
      app,
      authorization: authenticatedActor.authorizationHeader,
      thid: 'research-study-update-integration',
      action: '_batch',
      content: { data: [{
        type: 'ResearchStudy-v5.0.0',
        request: { method: 'PUT', url: `ResearchStudy/${studyId}` },
        resource: claimsResource(studyId, activeStudyClaims),
      }] },
      issuer: authenticatedActor.actorDid,
    });
    expect(updatePayload.data[0].response.status).toBe('200');

    const removePartyPayload = await submitAndPoll({
      app,
      authorization: authenticatedActor.authorizationHeader,
      thid: 'research-study-remove-party-integration',
      action: '_batch',
      content: { data: [{
        type: 'ResearchStudy-v5.0.0',
        request: { method: 'DELETE', url: `ResearchStudy/${studyId}` },
        resource: claimsResource(studyId, partyClaims),
      }] },
      issuer: authenticatedActor.actorDid,
    });
    expect(removePartyPayload.data[0].response.status).toBe('204');

    const searchPayload = await submitAndPoll({
      app,
      authorization: authenticatedActor.authorizationHeader,
      thid: 'research-study-search-integration',
      action: '_search',
      content: {
        data: [{
          resource: {
            resourceType: 'Parameters',
            meta: { claims: { 'ResearchStudy.title': ['Veterinary cohort'] } },
          },
        }],
      },
      issuer: authenticatedActor.actorDid,
    });
    expect(searchPayload.data).toHaveLength(1);
    expect(searchPayload.data[0].resource).toEqual(claimsResource(studyId, activeStudyClaims));

    const physicalCollection = generateTenantCollectionNameFromClaims(tenantClaims);
    const records = await vaultRepository.listContainersInSection<any>(physicalCollection, 'research-studies');
    expect(records).toHaveLength(1);
    expect(records[0].jwe).toBeDefined();
    expect(records[0].content).toBeUndefined();
    expect(await kmsService.unprotectConfidentialData(records[0], tenantVaultId)).toEqual({ claims: activeStudyClaims });
    const partyRecords = await vaultRepository.listContainersInSection<any>(
      physicalCollection,
      buildResearchStudyPartySectionId(studyId),
    );
    expect(partyRecords).toHaveLength(0);
  } finally {
    queueAdapter.stop();
  }
});

function claimsResource(id: string, claims: Readonly<Record<string, readonly string[] | undefined>>) {
  return { resourceType: 'ResearchStudy', id, meta: { claims } };
}

function configureEnvironment(): void {
  process.env.NODE_ENV = 'test';
  process.env.DB_PROVIDER = 'mem';
  process.env.STORAGE_PROVIDER = 'mem';
  process.env.QUEUE_PROVIDER = 'mem';
  process.env.SECTORS_ALLOWED = sector;
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

async function submitAndPoll(input: {
  app: any;
  authorization: string;
  thid: string;
  action: '_batch' | '_search';
  content: Record<string, unknown>;
  issuer: string;
}): Promise<any> {
  const base = `/${tenantId}/cds-${jurisdiction}/v1/${sector}/organization/org.hl7.fhir.r5/ResearchStudy`;
  const submitted = await invokeExpress(input.app, {
    method: 'POST',
    url: `${base}/${input.action}`,
    headers: { 'content-type': 'application/json', authorization: input.authorization },
    body: { thid: input.thid, iss: input.issuer, body: input.content },
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
  throw new Error(`ResearchStudy async response timed out for ${input.action}.`);
}
