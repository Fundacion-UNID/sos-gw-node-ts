// Flow contract: reuse shared test fixtures and canonical types; do not introduce duplicated literals.
import { resolveHostPhysicalCollectionName } from '../../../config/storage-layout';
// Flow contract: individual and digital-twin routes reject SMART root scopes from the other authorization boundary.
import { invokeExpress } from '../helpers/invokeExpress';
import { getTenantVaultId } from '../../../utils/tenant';
import { ClaimsOrganizationSchemaorg, ClaimsServiceSchemaorg } from 'gdc-common-utils-ts/constants/schemaorg';
import { testPayloadCreateTenant1 } from '../../data/end-to-end.data';
import { generateTenantCollectionNameFromClaims } from '../../../utils/tenant';
import { initializeTenantServicesConfig } from '../../../utils/services';
import { Sector } from 'gdc-common-utils-ts/models/urlPath';
import { startServer, resetServerConfig } from '../../../server';
import { getEnvSectionId } from '../../../utils/section-env';
import { testTenant1AlternateName } from '../../data/organization.data';

function createDemoBearer(payload: Record<string, unknown>): string {
  return [
    Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url'),
    Buffer.from(JSON.stringify(payload)).toString('base64url'),
    'demo',
  ].join('.');
}

describe('SMART scope route gates (integration)', () => {
  async function bootstrapTenant(options: { legacyDigitalTwinServices?: boolean } = {}) {
    process.env.NODE_ENV = 'test';
    process.env.DB_PROVIDER = 'mem';
    process.env.STORAGE_PROVIDER = 'mem';
    process.env.QUEUE_PROVIDER = 'mem';
    process.env.SECTORS_ALLOWED = 'health-care';
    process.env.ORG_HOST_LEGAL_NAME = 'Gateway Host Services';
    process.env.ORG_HOST_JURISDICTION = 'ES';
    process.env.ORG_HOST_ID_TYPE = 'TAX';
    process.env.ORG_HOST_ID_VALUE = 'A0011223344';
    process.env.ORG_HOST_ADMIN_EMAIL = 'admin@host.com';
    process.env.ORG_HOST_ADMIN_UID = 'host-admin-001';
    process.env.ORG_HOST_ADMIN_ROLE = 'ISCO-08|1111';
    process.env.SECURITY_MODE = 'demo';
    process.env.JSON_LEGACY = 'true';
    process.env.DEMO_ALLOW_INSECURE_BEARER = 'false';
    process.env.AUTH_TOKEN_VERIFIER = 'demo';

    resetServerConfig();

    const { app, queueAdapter, tenantManager, vaultRepository, kmsService } = await startServer({ listen: false });

    const hostBootstrapClaims = {
      [ClaimsOrganizationSchemaorg.addressCountry]: process.env.ORG_HOST_JURISDICTION,
      [ClaimsOrganizationSchemaorg.identifierType]: process.env.ORG_HOST_ID_TYPE,
      [ClaimsOrganizationSchemaorg.identifierValue]: process.env.ORG_HOST_ID_VALUE,
      [ClaimsServiceSchemaorg.category]: Sector.SYSTEM,
    };
    const hostCollectionName = resolveHostPhysicalCollectionName();

    const tenantClaims = testPayloadCreateTenant1.body.data[0].resource.meta.claims as any;
    const tenantVaultId = getTenantVaultId(
      tenantClaims[ClaimsServiceSchemaorg.category],
      tenantClaims['org.schema.Organization.alternateName'],
    );

    const currentTenantServices = initializeTenantServicesConfig(Sector.HEALTH_CARE);
    const tenantServices = options.legacyDigitalTwinServices
      ? [
        ...currentTenantServices.filter((service: any) => service.selector?.section !== 'digitaltwin'),
        {
          id: '#digitaltwin:org.hl7.fhir.r4',
          type: 'ApiService',
          serviceEndpoint: 'Composition',
          actions: ['_search'],
          selector: { sector: Sector.HEALTH_CARE, section: 'digitaltwin', format: 'org.hl7.fhir.r4' },
        },
      ]
      : currentTenantServices;
    const tenantConfig = {
      claims: tenantClaims,
      didConfig: { service: tenantServices },
      didDocument: { id: 'did:web:api.acme.org', '@context': 'https://www.w3.org/ns/did/v1' },
    };

    await kmsService.provisionKeys(tenantVaultId);
    const secureTenantRecord = await kmsService.protectConfidentialData(
      { id: tenantVaultId, sequence: 0, content: tenantConfig } as any,
      'host',
    );
    await vaultRepository.put(hostCollectionName, [secureTenantRecord as any], getEnvSectionId('tenants'));
    await tenantManager.getTenant(tenantVaultId);

    return { app, queueAdapter };
  }

  it('rejects individual route requests when the SMART token is rooted at ResearchSubject', async () => {
    const { app, queueAdapter } = await bootstrapTenant();
    try {
      const bearer = createDemoBearer({
        iss: 'did:web:api.acme.org',
        scope: 'organization/ResearchSubject.rs?subject=did:web:api.acme.org:individual:123',
      });

      const response = await invokeExpress(app, {
        method: 'POST',
        url: `/${testTenant1AlternateName}/cds-ES/v1/health-care/individual/org.hl7.fhir.api/Communication/_batch`,
        headers: { 'content-type': 'application/json', authorization: `Bearer ${bearer}` },
        body: {
          thid: 'individual-scope-gate-001',
          body: { resourceType: 'Bundle', type: 'batch', data: [] },
        },
      });

      expect(response.status).toBe(403);
      expect(response.text).toContain('Individual endpoints require one SMART scope rooted at organization/Composition.');
    } finally {
      queueAdapter.stop();
    }
  });

  it('rejects digitaltwin route requests when the SMART token is rooted at Composition', async () => {
    const { app, queueAdapter } = await bootstrapTenant();
    try {
      const bearer = createDemoBearer({
        iss: 'did:web:api.acme.org',
        scope: 'organization/Composition.rs?subject=did:web:api.acme.org:individual:123&section=LOINC|48765-2',
      });

      const response = await invokeExpress(app, {
        method: 'POST',
        url: `/${testTenant1AlternateName}/cds-ES/v1/health-care/digitaltwin/org.hl7.fhir.api/ResearchSubject/_search`,
        headers: { 'content-type': 'application/json', authorization: `Bearer ${bearer}` },
        body: {
          thid: 'digitaltwin-scope-gate-001',
          body: { resourceType: 'Bundle', type: 'batch', data: [] },
        },
      });

      expect(response.status).toBe(403);
      expect(response.text).toContain('digitaltwin endpoints require one SMART scope rooted at organization/ResearchSubject.');
    } finally {
      queueAdapter.stop();
    }
  });

  it('accepts ResearchSubject search for a legacy tenant that published only Composition search', async () => {
    const { app, queueAdapter } = await bootstrapTenant({ legacyDigitalTwinServices: true });
    try {
      const bearer = createDemoBearer({
        iss: 'did:web:api.acme.org',
        scope: 'organization/ResearchSubject.rs?subject=*',
      });
      const response = await invokeExpress(app, {
        method: 'POST',
        url: `/${testTenant1AlternateName}/cds-ES/v1/health-care/digitaltwin/org.hl7.fhir.r4/ResearchSubject/_search`,
        headers: { 'content-type': 'application/json', authorization: `Bearer ${bearer}` },
        body: {
          thid: 'legacy-tenant-researchsubject-search-001',
          body: {
            resourceType: 'Parameters',
            parameter: [
              { name: 'section', valueString: 'http://loinc.org|10160-0' },
              { name: 'date-from', valueDate: '2024-01-01' },
              { name: 'text', valueString: 'lisinopril' },
            ],
          },
        },
      });

      expect(response.status).toBe(202);
    } finally {
      queueAdapter.stop();
    }
  });
});
