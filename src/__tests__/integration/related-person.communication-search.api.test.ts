// Flow contract: reuse shared test fixtures and canonical types; do not introduce duplicated literals.
import { resolveHostPhysicalCollectionName } from '../../config/storage-layout';
// TDD contract: a RelatedPerson created through Communication retains the verified local author boundary.
import { invokeExpress } from './helpers/invokeExpress';
import { startServer, resetServerConfig } from '../../server';
import { getTenantVaultId, generateTenantCollectionNameFromClaims } from '../../utils/tenant';
import { ClaimsOrganizationSchemaorg, ClaimsServiceSchemaorg } from 'gdc-common-utils-ts/constants/schemaorg';
import { testPayloadCreateTenant1 } from '../data/end-to-end.data';
import { testTenant1TenantId } from '../data/organization.data';
import { initializeTenantServicesConfig } from '../../utils/services';
import { Sector } from 'gdc-common-utils-ts/models/urlPath';
import { getEnvSectionId } from '../../utils/section-env';
import { configureAuthenticatedTestActor } from './helpers/authenticated-test-actor';
import { extractBundleSearchResources } from 'gdc-common-utils-ts/utils/organization-employee-lifecycle';

/**
 * Related-entity API flow:
 * Step 1. Store one professional related entity inside Communication.
 * Step 2. Query RelatedPerson with an explicit subject on the same real server.
 * Step 3. Prove relationship, functional roles and public email survive beside
 * the opaque resource id.
 */
describe('RelatedPerson Communication and search API', () => {
  afterEach(() => resetServerConfig());

  it('creates through Communication and reads through subject-scoped RelatedPerson/_search', async () => {
    Object.assign(process.env, {
      NODE_ENV: 'test', DB_PROVIDER: 'mem', STORAGE_PROVIDER: 'mem', QUEUE_PROVIDER: 'mem',
      SECTORS_ALLOWED: 'health-care', ORG_HOST_LEGAL_NAME: 'Gateway Host Services',
      ORG_HOST_JURISDICTION: 'ES', ORG_HOST_ID_TYPE: 'TAX', ORG_HOST_ID_VALUE: 'A0011223344',
      ORG_HOST_ADMIN_EMAIL: 'admin@host.com', ORG_HOST_ADMIN_UID: 'host-admin-001',
      ORG_HOST_ADMIN_ROLE: 'ISCO-08|1111', SECURITY_MODE: 'demo', JSON_LEGACY: 'true',
    });
    const authenticatedActor = await configureAuthenticatedTestActor();
    resetServerConfig();

    const { app, queueAdapter, tenantManager, vaultRepository, kmsService } = await startServer({ listen: false });
    try {
      const hostClaims = {
        [ClaimsOrganizationSchemaorg.addressCountry]: 'ES',
        [ClaimsOrganizationSchemaorg.identifierType]: 'TAX',
        [ClaimsOrganizationSchemaorg.identifierValue]: 'A0011223344',
        [ClaimsServiceSchemaorg.category]: Sector.SYSTEM,
      };
      const tenantClaims = testPayloadCreateTenant1.body.data[0].resource.meta.claims as any;
      const tenantVaultId = getTenantVaultId(tenantClaims[ClaimsServiceSchemaorg.category], testTenant1TenantId);
      await kmsService.provisionKeys(tenantVaultId);
      const protectedTenant = await kmsService.protectConfidentialData({
        id: tenantVaultId,
        sequence: 0,
        content: {
          claims: tenantClaims,
          didConfig: { service: initializeTenantServicesConfig(Sector.HEALTH_CARE) },
          didDocument: { id: 'did:web:api.acme.org', '@context': 'https://www.w3.org/ns/did/v1' },
        },
      } as any, 'host');
      await vaultRepository.put(
        resolveHostPhysicalCollectionName(),
        [protectedTenant as any],
        getEnvSectionId('tenants'),
      );
      await tenantManager.getTenant(tenantVaultId);

      const subject = 'did:web:unid.online:card:uhc:personal:subject-contact-test';
      const relatedPerson = {
        resourceType: 'RelatedPerson',
        id: 'contact-doctor',
        meta: { claims: {
          '@context': 'org.hl7.fhir.api',
          'RelatedPerson.identifier': 'urn:uuid:contact-doctor',
          'RelatedPerson.patient': subject,
          'RelatedPerson.name': 'Doctor Test',
          'RelatedPerson.relationship': 'v3-RoleCode|FRND',
          'RelatedPerson.role': 'CAREGIVER,ECON,DEPEN,BILL',
          'RelatedPerson.telecom': 'mailto:doctor@example.org',
          'RelatedPerson.related-entity-type': 'person',
          'RelatedPerson.actor-identifier': 'doctor@example.org',
          'RelatedPerson.active': 'true',
        } },
      };
      const communicationPath = `/${testTenant1TenantId}/cds-ES/v1/health-care/individual/org.hl7.fhir.r4/Communication`;
      const createThid = 'related-entity-create-test';
      expect((await invokeExpress(app, {
        method: 'POST', url: `${communicationPath}/_batch`,
        headers: { 'content-type': 'application/json', authorization: authenticatedActor.authorizationHeader },
        body: { thid: createThid, body: { resourceType: 'Bundle', type: 'batch', entry: [{
          resource: { resourceType: 'Communication', status: 'completed', subject: { reference: subject }, payload: [{
            contentAttachment: { contentType: 'application/fhir+json', data: Buffer.from(JSON.stringify(relatedPerson)).toString('base64') },
          }] },
        }] } },
      })).status).toBe(202);
      await poll(app, `${communicationPath}/_batch-response`, createThid);

      const searchPath = `/${testTenant1TenantId}/cds-ES/v1/health-care/individual/org.hl7.fhir.r4/RelatedPerson`;
      const searchThid = 'related-entity-search-test';
      expect((await invokeExpress(app, {
        method: 'POST', url: `${searchPath}/_search`,
        headers: { 'content-type': 'application/json', authorization: authenticatedActor.authorizationHeader },
        body: { thid: searchThid, body: { resourceType: 'Parameters', parameter: [{ name: 'patient', valueString: subject }] } },
      })).status).toBe(202);
      const result = await poll(app, `${searchPath}/_search-response`, searchThid);
      const responseEntries = result.body?.data || result.data;
      const records = extractBundleSearchResources(result) as any[];
      expect(records).toHaveLength(1);
      expect(records[0].resource.meta.claims).toMatchObject({
        'org.hl7.fhir.api.RelatedPerson.name': 'Doctor Test',
        'org.hl7.fhir.api.RelatedPerson.actor-identifier': 'doctor@example.org',
        'org.hl7.fhir.api.RelatedPerson.role': 'CAREGIVER,ECON,DEPEN,BILL',
      });
    } finally {
      queueAdapter.stop();
    }
  });
});

async function poll(app: any, url: string, thid: string): Promise<any> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const response = await invokeExpress(app, {
      method: 'POST', url, headers: { 'content-type': 'application/json' }, body: { thid },
    });
    if (response.status === 200) return JSON.parse(response.text);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out polling ${url}`);
}
