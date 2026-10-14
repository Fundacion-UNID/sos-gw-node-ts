// Flow contract: reuse shared test fixtures and canonical types; do not introduce duplicated literals.
import { resolveHostPhysicalCollectionName } from '../../config/storage-layout';
// Ingest clinical sections, read the current summary, delete one
// exact authored resource through a batch, then prove operational and permitted
// Digital Twin readback no longer contains it.
// Authorization invariant: creator identity and Communication.subject match.
// Persistence invariant: delete changes current views while audit/history and
// the separate consent/offboarding lifecycle contracts remain intact.
// TDD contract: write this test red first; make it green only with complete behavior.
import { invokeExpress } from './helpers/invokeExpress';
import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import path from 'path';
import { getTenantVaultId, generateTenantCollectionNameFromClaims } from '../../utils/tenant';
import { ClaimsOrganizationSchemaorg, ClaimsServiceSchemaorg } from 'gdc-common-utils-ts/constants/schemaorg';
import { testPayloadCreateTenant1 } from '../data/end-to-end.data';
import { initializeTenantServicesConfig } from '../../utils/services';
import { Sector } from 'gdc-common-utils-ts/models/urlPath';
import { startServer, resetServerConfig } from '../../server';
import { getEnvSectionId } from '../../utils/section-env';
import { getSubjectScopedSectionId } from '../../utils/individual-sections';
import {
  HealthcareBasicSections,
  HealthcareConsentPurposes,
  ResourceTypesFhirR4,
} from 'gdc-common-utils-ts/constants/index';
import { CompositionAttesterModes } from 'gdc-common-utils-ts';
import { testTenant1TenantId } from '../data/organization.data';
import {
  getDigitalTwinSubjectAliasSectionId,
  getOrCreateDigitalTwinSubjectId,
} from '../../utils/digital-twin-research-projection';
import { buildOrganizationDidWeb, buildProfessionalDidWeb } from 'gdc-common-utils-ts/utils/did';
import {
  EXAMPLE_HOST_PUBLIC_HOSTNAME,
  EXAMPLE_ROUTE_VERSION,
  EXAMPLE_PROFESSIONAL_DID,
  EXAMPLE_HEALTHCARE_ACTOR_ROLE_PHYSICIAN,
  EXAMPLE_KYC_CONTROLLER_USER_UUID,
  EXAMPLE_KYC_CONTROLLER_UUID,
  EXAMPLE_SUBJECT_DID,
  EXAMPLE_TENANT_SERVICE_DID,
} from 'gdc-common-utils-ts/examples/shared';
import { FhirIpsCreatorKinds } from 'gdc-common-utils-ts/utils/fhir-ips-creator-identity';
import { getClinicalCreatorBindingsSectionId } from '../../utils/ips-bundle';
import { extractBundleSearchResources } from 'gdc-common-utils-ts/utils/organization-employee-lifecycle';
import { ExampleEmployeeEmails, ExampleEmployeeRoles } from 'gdc-common-utils-ts/examples/employee';
import { ClaimConsent, ConsentStatuses } from 'gdc-common-utils-ts/models/consent-rule';
import { CommunicationClaim } from 'gdc-common-utils-ts/models/interoperable-claims/communication-claims';
import { ServiceCapability } from 'gdc-common-utils-ts/constants/service-capabilities';
import { EXAMPLE_INTER_TENANT_ACCESS_CONTRACT_PROVIDER_ORGANIZATION_URN } from 'gdc-common-utils-ts/examples/inter-tenant-access-contract';
import {
  DEMO_SMART_ACCESS_LOCAL_IDS,
  buildDemoResearchPermitByRoleConsent,
} from '../data/demo-smart-access-local-network.data';
import { submitConsentRuleAndPoll } from './helpers/consent-flow';

describe('Composition Bundle _search API (integration)', () => {
  function createDemoBearer(payload: Record<string, unknown>): string {
    return [
      Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url'),
      Buffer.from(JSON.stringify(payload)).toString('base64url'),
      'demo',
    ].join('.');
  }

  function loadIpsAllSectionsFixture(subjectDid: string): any {
    // Official HL7 IPS fixture used to feed individual, mirror into digitaltwin,
    // and verify section-first `Composition/_search` behavior end to end:
    // https://build.fhir.org/ig/HL7/fhir-ips/en/Bundle-bundle-ips-all-sections.json.html
    const fixturePath = path.join(process.cwd(), 'node_modules', 'gdc-common-utils-ts', 'fixtures', 'fhir-ips-bundle-all-sections.json');
    const bundle = JSON.parse(readFileSync(fixturePath, 'utf8'));
    for (const entry of Array.isArray(bundle?.entry) ? bundle.entry : []) {
      const resource = entry?.resource;
      if (!resource || typeof resource !== 'object') continue;

      if (resource?.subject?.reference) {
        resource.subject.reference = subjectDid;
      }
      if (resource?.patient?.reference) {
        resource.patient.reference = subjectDid;
      }
      if (resource?.resourceType === 'Composition') {
        // Imported IPS provenance belongs to the external exporting source.
        // The local controller is deliberately not rewritten as its author.
        resource.author = [{ reference: EXAMPLE_INTER_TENANT_ACCESS_CONTRACT_PROVIDER_ORGANIZATION_URN }];
        resource.attester = [{
          mode: CompositionAttesterModes.Professional,
          party: { reference: `urn:uuid:${EXAMPLE_KYC_CONTROLLER_UUID}` },
        }];
      }
      if (resource?.medicationCodeableConcept?.coding?.[0]) {
        resource.medicationCodeableConcept.coding[0].userSelected = true;
        resource.medicationCodeableConcept.text ||= resource.medicationCodeableConcept.coding[0].display;
      }
      if (resource?.code?.coding?.[0]) {
        resource.code.coding[0].userSelected = true;
        resource.code.text ||= resource.code.coding[0].display;
      }
      if (resource?.vaccineCode?.coding?.[0]) {
        resource.vaccineCode.coding[0].userSelected = true;
        resource.vaccineCode.text ||= resource.vaccineCode.coding[0].display;
      }
      if (resource?.category?.[0]?.coding?.[0]) {
        resource.category[0].coding[0].userSelected = true;
        resource.category[0].text ||= resource.category[0].coding[0].display;
      }
    }
    return bundle;
  }

  /**
   * Veterinary document fixture for the research-summary boundary. The animal
   * is the individual subject; no human Patient fixture is repurposed. The
   * terminology fields deliberately carry three independent values: canonical
   * `system|code`, selected display, and confirmed local authored text. The
   * latter two are source evidence, not authoritative research terminology.
   */
  function buildVeterinaryResearchSummaryFixture(subjectDid: string): any {
    const medicationId = 'animal-medication-statement-001';
    const observationId = 'animal-temperature-observation-001';
    const compositionId = 'animal-clinical-composition-001';
    return {
      resourceType: ResourceTypesFhirR4.Bundle,
      type: 'document',
      timestamp: '2026-06-26T10:00:00Z',
      entry: [
        {
          fullUrl: `urn:uuid:${compositionId}`,
          resource: {
            resourceType: ResourceTypesFhirR4.Composition,
            id: compositionId,
            status: 'final',
            type: { coding: [{ system: 'http://loinc.org', code: '60591-5', display: 'Patient summary Document' }] },
            subject: { reference: subjectDid },
            date: '2026-06-26T10:00:00Z',
            author: [{ reference: EXAMPLE_INTER_TENANT_ACCESS_CONTRACT_PROVIDER_ORGANIZATION_URN }],
            attester: [{
              mode: CompositionAttesterModes.Professional,
              party: { reference: `urn:uuid:${EXAMPLE_KYC_CONTROLLER_UUID}` },
            }],
            title: 'Veterinary clinical summary',
            section: [
              {
                title: HealthcareBasicSections.HistoryOfMedicationUse.titleEn,
                code: { coding: [{
                  system: HealthcareBasicSections.HistoryOfMedicationUse.system,
                  code: HealthcareBasicSections.HistoryOfMedicationUse.code,
                }] },
                entry: [{ reference: `MedicationStatement/${medicationId}` }],
              },
              {
                title: HealthcareBasicSections.VitalSigns.titleEn,
                code: { coding: [{
                  system: HealthcareBasicSections.VitalSigns.system,
                  code: HealthcareBasicSections.VitalSigns.code,
                }] },
                entry: [{ reference: `Observation/${observationId}` }],
              },
            ],
          },
        },
        {
          fullUrl: `urn:uuid:${medicationId}`,
          resource: {
            resourceType: ResourceTypesFhirR4.MedicationStatement,
            id: medicationId,
            status: 'active',
            subject: { reference: subjectDid },
            effectiveDateTime: '2026-06-26T09:00:00Z',
            language: 'es',
            medicationCodeableConcept: {
              text: 'Ibuprofeno',
              coding: [{
                system: 'http://snomed.info/sct',
                code: '387207008',
                display: 'Ibuprofen',
                userSelected: true,
              }],
            },
          },
        },
        {
          fullUrl: `urn:uuid:${observationId}`,
          resource: {
            resourceType: ResourceTypesFhirR4.Observation,
            id: observationId,
            status: 'final',
            subject: { reference: subjectDid },
            effectiveDateTime: '2026-06-26T09:30:00Z',
            language: 'es',
            code: {
              text: 'Temperatura corporal',
              coding: [{
                system: 'http://loinc.org',
                code: '8310-5',
                display: 'Body temperature',
                userSelected: true,
              }],
            },
            valueQuantity: { value: 38.2, unit: 'Cel', system: 'http://unitsofmeasure.org', code: 'Cel' },
          },
        },
      ],
    };
  }

  afterEach(() => {
    resetServerConfig();
  });

  it('supports Bundle/_search over document bundles with composition.subject and composition.section', async () => {
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
    process.env.DEMO_ALLOW_INSECURE_BEARER = 'true';

    resetServerConfig();

    const { app, queueAdapter, tenantManager, vaultRepository, kmsService } = await startServer({ listen: false });
    try {
      const hostBootstrapClaims = {
        [ClaimsOrganizationSchemaorg.addressCountry]: process.env.ORG_HOST_JURISDICTION,
        [ClaimsOrganizationSchemaorg.identifierType]: process.env.ORG_HOST_ID_TYPE,
        [ClaimsOrganizationSchemaorg.identifierValue]: process.env.ORG_HOST_ID_VALUE,
        [ClaimsServiceSchemaorg.category]: Sector.SYSTEM,
      };
      const hostCollectionName = resolveHostPhysicalCollectionName();
      const tenantClaims = testPayloadCreateTenant1.body.data[0].resource.meta.claims as any;
      const tenantVaultId = getTenantVaultId(tenantClaims[ClaimsServiceSchemaorg.category], testTenant1TenantId);

      const tenantConfig = {
        claims: tenantClaims,
        didConfig: { service: initializeTenantServicesConfig(Sector.HEALTH_CARE) },
        didDocument: { id: 'did:web:api.acme.org', '@context': 'https://www.w3.org/ns/did/v1' },
      };

      await kmsService.provisionKeys(tenantVaultId);
      const secureTenantRecord = await kmsService.protectConfidentialData(
        { id: tenantVaultId, sequence: 0, content: tenantConfig } as any,
        'host',
      );
      await vaultRepository.put(hostCollectionName, [secureTenantRecord as any], getEnvSectionId('tenants'));
      await tenantManager.getTenant(tenantVaultId);

      const subjectDid = 'did:web:api.acme.org:individual:123';
      const sectionCode = 'LOINC|60591-5';
      const submittedComposition = {
        type: 'Composition',
        request: { method: 'POST' },
        resource: {
          resourceType: 'Composition',
          id: 'composition-001',
          meta: {
            claims: {
              '@context': 'org.hl7.fhir.r4',
              'Composition.identifier': 'urn:uuid:composition-001',
              'Composition.subject': subjectDid,
              'Composition.section': sectionCode,
              'Composition.author': EXAMPLE_INTER_TENANT_ACCESS_CONTRACT_PROVIDER_ORGANIZATION_URN,
              'Composition.date': '2026-05-16T10:00:00Z',
              'Composition.type': 'LOINC|60591-5',
            },
          },
        },
      };

      const thidBatch = 'composition-batch-001';
      const submitResp = await invokeExpress(app, {
        method: 'POST',
        url: `/${testTenant1TenantId}/cds-ES/v1/health-care/individual/org.hl7.fhir.r4/Composition/_batch`,
        headers: { 'content-type': 'application/json', authorization: 'Bearer demo-token' },
        body: {
          thid: thidBatch,
          body: {
            data: [submittedComposition],
          },
        },
      });
      expect(submitResp.status).toBe(202);

      let batchPayload: any;
      for (let i = 0; i < 50; i++) {
        const pollResp = await invokeExpress(app, {
          method: 'POST',
          url: `/${testTenant1TenantId}/cds-ES/v1/health-care/individual/org.hl7.fhir.r4/Composition/_batch-response`,
          headers: { 'content-type': 'application/json' },
          body: { thid: thidBatch },
        });
        if (pollResp.status === 200) {
          batchPayload = JSON.parse(pollResp.text);
          break;
        }
        await new Promise((r) => setTimeout(r, 50));
      }
      expect(batchPayload?.resourceType).toBe('Bundle');
      expect(batchPayload?.data?.[0]?.response?.status).toBe('201');

      const overwriteThid = 'composition-overwrite-001';
      const overwriteSubmit = await invokeExpress(app, {
        method: 'POST',
        url: `/${testTenant1TenantId}/cds-ES/v1/health-care/individual/org.hl7.fhir.r4/Composition/_batch`,
        headers: { 'content-type': 'application/json', authorization: 'Bearer demo-token' },
        body: { thid: overwriteThid, body: { data: [submittedComposition] } },
      });
      expect(overwriteSubmit.status).toBe(202);
      let overwritePayload: any;
      for (let i = 0; i < 50; i++) {
        const pollResp = await invokeExpress(app, {
          method: 'POST',
          url: `/${testTenant1TenantId}/cds-ES/v1/health-care/individual/org.hl7.fhir.r4/Composition/_batch-response`,
          headers: { 'content-type': 'application/json' },
          body: { thid: overwriteThid },
        });
        if (pollResp.status === 200) {
          overwritePayload = JSON.parse(pollResp.text);
          break;
        }
        await new Promise((r) => setTimeout(r, 50));
      }
      expect(overwritePayload?.data?.[0]?.response?.status).toBe('403');
      expect(JSON.stringify(overwritePayload)).toContain('repeated author URN');

      const thidSearch = 'bundle-search-001';
      const searchResp = await invokeExpress(app, {
        method: 'POST',
        url: `/${testTenant1TenantId}/cds-ES/v1/health-care/individual/org.hl7.fhir.r4/Bundle/_search`,
        headers: { 'content-type': 'application/json', authorization: 'Bearer demo-token' },
        body: {
          thid: thidSearch,
          body: {
            resourceType: 'Bundle',
            type: 'batch',
            entry: [
              {
                request: {
                  method: 'GET',
                  url: `Bundle?type=document&composition.subject=${encodeURIComponent(subjectDid)}&composition.section=${encodeURIComponent(sectionCode)}`,
                },
              },
            ],
          },
        },
      });
      expect(searchResp.status).toBe(202);

      let searchPayload: any;
      for (let i = 0; i < 50; i++) {
        const pollResp = await invokeExpress(app, {
          method: 'POST',
          url: `/${testTenant1TenantId}/cds-ES/v1/health-care/individual/org.hl7.fhir.r4/Bundle/_search-response`,
          headers: { 'content-type': 'application/json' },
          body: { thid: thidSearch },
        });
        if (pollResp.status === 200) {
          searchPayload = JSON.parse(pollResp.text);
          break;
        }
        await new Promise((r) => setTimeout(r, 50));
      }

      expect(searchPayload?.resourceType).toBe('Bundle');
      expect(searchPayload?.data?.[0]?.response?.status).toBe('200');
      expect(searchPayload?.total).toBeGreaterThanOrEqual(1);
      expect(extractBundleSearchResources(searchPayload).length).toBeGreaterThanOrEqual(1);
    } finally {
      queueAdapter.stop();
    }
  });

  it('supports Bundle/_search for IPS documents while excluding selected sections', async () => {
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
    process.env.DEMO_ALLOW_INSECURE_BEARER = 'true';

    resetServerConfig();

    const { app, queueAdapter, tenantManager, vaultRepository, kmsService } = await startServer({ listen: false });
    try {
      const hostBootstrapClaims = {
        [ClaimsOrganizationSchemaorg.addressCountry]: process.env.ORG_HOST_JURISDICTION,
        [ClaimsOrganizationSchemaorg.identifierType]: process.env.ORG_HOST_ID_TYPE,
        [ClaimsOrganizationSchemaorg.identifierValue]: process.env.ORG_HOST_ID_VALUE,
        [ClaimsServiceSchemaorg.category]: Sector.SYSTEM,
      };
      const hostCollectionName = resolveHostPhysicalCollectionName();
      const tenantClaims = testPayloadCreateTenant1.body.data[0].resource.meta.claims as any;
      const tenantVaultId = getTenantVaultId(tenantClaims[ClaimsServiceSchemaorg.category], testTenant1TenantId);

      const tenantConfig = {
        claims: tenantClaims,
        didConfig: { service: initializeTenantServicesConfig(Sector.HEALTH_CARE) },
        didDocument: { id: 'did:web:api.acme.org', '@context': 'https://www.w3.org/ns/did/v1' },
      };

      await kmsService.provisionKeys(tenantVaultId);
      const secureTenantRecord = await kmsService.protectConfidentialData(
        { id: tenantVaultId, sequence: 0, content: tenantConfig } as any,
        'host',
      );
      await vaultRepository.put(hostCollectionName, [secureTenantRecord as any], getEnvSectionId('tenants'));
      await tenantManager.getTenant(tenantVaultId);

      const subjectDid = 'did:web:api.acme.org:individual:ips-excluded-sections-001';
      const ipsType = `${HealthcareBasicSections.PatientSummaryDocument.system}|${HealthcareBasicSections.PatientSummaryDocument.code}`;
      const compositionSectionId = getSubjectScopedSectionId(subjectDid, 'individual', 'composition');
      const practitionerIdentifier = `urn:uuid:${EXAMPLE_KYC_CONTROLLER_USER_UUID}`;
      const practitionerRoleIdentifier = `urn:uuid:${EXAMPLE_KYC_CONTROLLER_UUID}`;

      await vaultRepository.put(tenantVaultId, [{
        id: practitionerRoleIdentifier,
        kind: FhirIpsCreatorKinds.Professional,
        actorIdentifier: practitionerIdentifier,
        authorIdentifier: practitionerRoleIdentifier,
        ownerIdentifier: EXAMPLE_TENANT_SERVICE_DID,
        role: EXAMPLE_HEALTHCARE_ACTOR_ROLE_PHYSICIAN,
        actorDids: [EXAMPLE_PROFESSIONAL_DID],
      } as any], getClinicalCreatorBindingsSectionId());

      await vaultRepository.put(
        tenantVaultId,
        [
          {
            id: 'composition-medications-001',
            '@context': 'org.hl7.fhir.r4',
            'Composition.identifier': 'urn:uuid:composition-medications-001',
            'Composition.subject': subjectDid,
            'Composition.section': HealthcareBasicSections.HistoryOfMedicationUse.attributeValue,
            'Composition.author': EXAMPLE_PROFESSIONAL_DID,
            'Composition.date': '2026-05-16T10:00:00Z',
            'Composition.type': ipsType,
          } as any,
          {
            id: 'composition-allergies-001',
            '@context': 'org.hl7.fhir.r4',
            'Composition.identifier': 'urn:uuid:composition-allergies-001',
            'Composition.subject': subjectDid,
            'Composition.section': HealthcareBasicSections.AllergiesAndIntolerances.attributeValue,
            'Composition.author': EXAMPLE_PROFESSIONAL_DID,
            'Composition.date': '2026-05-16T11:00:00Z',
            'Composition.type': ipsType,
          } as any,
        ],
        compositionSectionId,
      );

      const thidSearch = 'bundle-search-ips-exclude-001';
      const searchResp = await invokeExpress(app, {
        method: 'POST',
        url: `/${testTenant1TenantId}/cds-ES/v1/health-care/individual/org.hl7.fhir.r4/Bundle/_search`,
        headers: { 'content-type': 'application/json', authorization: 'Bearer demo-token' },
        body: {
          thid: thidSearch,
          body: {
            resourceType: 'Bundle',
            type: 'batch',
            entry: [
              {
                request: {
                  method: 'GET',
                  url:
                    `Bundle?type=document&composition.subject=${encodeURIComponent(subjectDid)}`
                    + `&composition.type=${encodeURIComponent(ipsType)}`
                    + `&composition.section:not=${encodeURIComponent(HealthcareBasicSections.AllergiesAndIntolerances.attributeValue)}`,
                },
              },
            ],
          },
        },
      });
      expect(searchResp.status).toBe(202);

      let searchPayload: any;
      for (let i = 0; i < 50; i++) {
        const pollResp = await invokeExpress(app, {
          method: 'POST',
          url: `/${testTenant1TenantId}/cds-ES/v1/health-care/individual/org.hl7.fhir.r4/Bundle/_search-response`,
          headers: { 'content-type': 'application/json' },
          body: { thid: thidSearch },
        });
        if (pollResp.status === 200) {
          searchPayload = JSON.parse(pollResp.text);
          break;
        }
        await new Promise((r) => setTimeout(r, 50));
      }

      expect(searchPayload?.resourceType).toBe('Bundle');
      expect(searchPayload?.data?.[0]?.response?.status).toBe('200');
      expect(searchPayload?.data?.[0]?.resource?.resourceType).toBe('Bundle');
      expect(searchPayload?.data?.[0]?.resource?.type).toBe('document');
      expect(searchPayload?.data?.[0]?.resource?.entry?.[0]?.resource?.resourceType).toBe('Composition');
      expect(searchPayload?.data?.[0]?.resource?.entry?.[0]?.resource?.section).toHaveLength(1);
      expect(
        searchPayload?.data?.[0]?.resource?.entry?.[0]?.resource?.section?.[0]?.code?.coding?.[0]?.code,
      ).toBe(HealthcareBasicSections.HistoryOfMedicationUse.code);
      expect(searchPayload?.data?.[0]?.resource?.entry?.[0]?.resource?.author)
        .toEqual([{ reference: EXAMPLE_TENANT_SERVICE_DID }]);
      expect(searchPayload?.data?.[0]?.resource?.entry?.[0]?.resource?.attester)
        .toEqual([{
          mode: CompositionAttesterModes.Professional,
          party: { reference: practitionerRoleIdentifier },
        }]);
      expect(searchPayload?.data?.[0]?.resource?.entry).toEqual(expect.arrayContaining([
        expect.objectContaining({
          fullUrl: practitionerIdentifier,
          resource: expect.objectContaining({ resourceType: ResourceTypesFhirR4.Practitioner }),
        }),
        expect.objectContaining({
          fullUrl: practitionerRoleIdentifier,
          resource: expect.objectContaining({ resourceType: ResourceTypesFhirR4.PractitionerRole }),
        }),
      ]));
    } finally {
      queueAdapter.stop();
    }
  });

  it('supports Bundle/_search for DocumentReference by contenthash', async () => {
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
    process.env.DEMO_ALLOW_INSECURE_BEARER = 'true';

    resetServerConfig();

    const { app, queueAdapter, tenantManager, vaultRepository, kmsService } = await startServer({ listen: false });
    try {
      const hostBootstrapClaims = {
        [ClaimsOrganizationSchemaorg.addressCountry]: process.env.ORG_HOST_JURISDICTION,
        [ClaimsOrganizationSchemaorg.identifierType]: process.env.ORG_HOST_ID_TYPE,
        [ClaimsOrganizationSchemaorg.identifierValue]: process.env.ORG_HOST_ID_VALUE,
        [ClaimsServiceSchemaorg.category]: Sector.SYSTEM,
      };
      const hostCollectionName = resolveHostPhysicalCollectionName();
      const tenantClaims = testPayloadCreateTenant1.body.data[0].resource.meta.claims as any;
      const tenantVaultId = getTenantVaultId(tenantClaims[ClaimsServiceSchemaorg.category], testTenant1TenantId);

      const tenantConfig = {
        claims: tenantClaims,
        didConfig: { service: initializeTenantServicesConfig(Sector.HEALTH_CARE) },
        didDocument: { id: 'did:web:api.acme.org', '@context': 'https://www.w3.org/ns/did/v1' },
      };

      await kmsService.provisionKeys(tenantVaultId);
      const secureTenantRecord = await kmsService.protectConfidentialData(
        { id: tenantVaultId, sequence: 0, content: tenantConfig } as any,
        'host',
      );
      await vaultRepository.put(hostCollectionName, [secureTenantRecord as any], getEnvSectionId('tenants'));
      await tenantManager.getTenant(tenantVaultId);

      const subjectDid = 'did:web:api.acme.org:individual:123';
      const cid = 'zb2rhfJk6M9MHiMagUhM6YJ6R7Sx9nN2m7r8cfDkQ2uYbGxZq';
      const sectionId = getEnvSectionId(`individual_document_references_${createHash('sha256').update(subjectDid, 'utf8').digest('hex')}`);
      await vaultRepository.put(
        tenantVaultId,
        [{
          id: 'documentreference-001',
          '@context': 'org.hl7.fhir.r4',
          'DocumentReference.subject': subjectDid,
          'DocumentReference.identifier': 'urn:uuid:docref-001',
          'DocumentReference.contenthash': cid,
          'DocumentReference.contenttype': 'application/pdf',
        } as any],
        sectionId,
      );

      const thidSearch = 'bundle-search-docref-hash-001';
      const searchResp = await invokeExpress(app, {
        method: 'POST',
        url: `/${testTenant1TenantId}/cds-ES/v1/health-care/individual/org.hl7.fhir.r4/Bundle/_search`,
        headers: { 'content-type': 'application/json', authorization: 'Bearer demo-token' },
        body: {
          thid: thidSearch,
          body: {
            resourceType: 'Bundle',
            type: 'batch',
            entry: [
              {
                request: {
                  method: 'GET',
                  url: `DocumentReference?subject=${encodeURIComponent(subjectDid)}&contenthash=${encodeURIComponent(cid)}`,
                },
              },
            ],
          },
        },
      });
      expect(searchResp.status).toBe(202);

      let searchPayload: any;
      for (let i = 0; i < 50; i++) {
        const pollResp = await invokeExpress(app, {
          method: 'POST',
          url: `/${testTenant1TenantId}/cds-ES/v1/health-care/individual/org.hl7.fhir.r4/Bundle/_search-response`,
          headers: { 'content-type': 'application/json' },
          body: { thid: thidSearch },
        });
        if (pollResp.status === 200) {
          searchPayload = JSON.parse(pollResp.text);
          break;
        }
        await new Promise((r) => setTimeout(r, 50));
      }

      expect(searchPayload?.resourceType).toBe('Bundle');
      expect(searchPayload?.data?.[0]?.response?.status).toBe('200');
      expect(searchPayload?.data?.[0]?.type).toBe('DocumentReference-search-response-v1.0');
      const matches = extractBundleSearchResources(searchPayload);
      expect(matches).toHaveLength(1);
      expect(matches[0]?.['DocumentReference.contenthash']).toBe(cid);
    } finally {
      queueAdapter.stop();
    }
  });

  it('supports Bundle/_search for Communication by identifier, thid, and linked DocumentReference contenthash', async () => {
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
    process.env.DEMO_ALLOW_INSECURE_BEARER = 'true';

    resetServerConfig();

    const { app, queueAdapter, tenantManager, vaultRepository, kmsService } = await startServer({ listen: false });
    try {
      const hostBootstrapClaims = {
        [ClaimsOrganizationSchemaorg.addressCountry]: process.env.ORG_HOST_JURISDICTION,
        [ClaimsOrganizationSchemaorg.identifierType]: process.env.ORG_HOST_ID_TYPE,
        [ClaimsOrganizationSchemaorg.identifierValue]: process.env.ORG_HOST_ID_VALUE,
        [ClaimsServiceSchemaorg.category]: Sector.SYSTEM,
      };
      const hostCollectionName = resolveHostPhysicalCollectionName();
      const tenantClaims = testPayloadCreateTenant1.body.data[0].resource.meta.claims as any;
      const tenantVaultId = getTenantVaultId(tenantClaims[ClaimsServiceSchemaorg.category], testTenant1TenantId);

      const tenantConfig = {
        claims: tenantClaims,
        didConfig: { service: initializeTenantServicesConfig(Sector.HEALTH_CARE) },
        didDocument: { id: 'did:web:api.acme.org', '@context': 'https://www.w3.org/ns/did/v1' },
      };

      await kmsService.provisionKeys(tenantVaultId);
      const secureTenantRecord = await kmsService.protectConfidentialData(
        { id: tenantVaultId, sequence: 0, content: tenantConfig } as any,
        'host',
      );
      await vaultRepository.put(hostCollectionName, [secureTenantRecord as any], getEnvSectionId('tenants'));
      await tenantManager.getTenant(tenantVaultId);

      const subjectDid = 'did:web:api.acme.org:individual:123';
      const cid = 'zb2rhfJk6M9MHiMagUhM6YJ6R7Sx9nN2m7r8cfDkQ2uYbGxZq';
      const communicationSectionId = getEnvSectionId(`individual_communications_${createHash('sha256').update(subjectDid, 'utf8').digest('hex')}`);
      const documentReferenceSectionId = getEnvSectionId(`individual_document_references_${createHash('sha256').update(subjectDid, 'utf8').digest('hex')}`);

      await vaultRepository.put(
        tenantVaultId,
        [{
          id: 'communication-001',
          type: 'CommMsgExtended',
          thid: 'permission-thread-001',
          'Communication.identifier': 'comm-permission-001',
          'Communication.subject': subjectDid,
          'Communication.content-reference': 'DocumentReference/documentreference-001',
        } as any],
        communicationSectionId,
      );
      await vaultRepository.put(
        tenantVaultId,
        [{
          id: 'documentreference-001',
          '@context': 'org.hl7.fhir.r4',
          'DocumentReference.subject': subjectDid,
          'DocumentReference.identifier': 'urn:uuid:docref-001',
          'DocumentReference.contenthash': cid,
        } as any],
        documentReferenceSectionId,
      );

      const searchCases = [
        {
          thid: 'bundle-search-communication-id-001',
          url: `Communication?subject=${encodeURIComponent(subjectDid)}&identifier=${encodeURIComponent('comm-permission-001')}`,
        },
        {
          thid: 'bundle-search-communication-thid-001',
          url: `Communication?subject=${encodeURIComponent(subjectDid)}&thid=${encodeURIComponent('permission-thread-001')}`,
        },
        {
          thid: 'bundle-search-communication-cid-001',
          url: `Communication?subject=${encodeURIComponent(subjectDid)}&contenthash=${encodeURIComponent(cid)}`,
        },
      ];

      for (const searchCase of searchCases) {
        const searchResp = await invokeExpress(app, {
          method: 'POST',
          url: `/${testTenant1TenantId}/cds-ES/v1/health-care/individual/org.hl7.fhir.r4/Bundle/_search`,
          headers: { 'content-type': 'application/json', authorization: 'Bearer demo-token' },
          body: {
            thid: searchCase.thid,
            body: {
              resourceType: 'Bundle',
              type: 'batch',
              entry: [
                {
                  request: {
                    method: 'GET',
                    url: searchCase.url,
                  },
                },
              ],
            },
          },
        });
        expect(searchResp.status).toBe(202);

        let searchPayload: any;
        for (let i = 0; i < 50; i++) {
          const pollResp = await invokeExpress(app, {
            method: 'POST',
            url: `/${testTenant1TenantId}/cds-ES/v1/health-care/individual/org.hl7.fhir.r4/Bundle/_search-response`,
            headers: { 'content-type': 'application/json' },
            body: { thid: searchCase.thid },
          });
          if (pollResp.status === 200) {
            searchPayload = JSON.parse(pollResp.text);
            break;
          }
          await new Promise((r) => setTimeout(r, 50));
        }

        expect(searchPayload?.resourceType).toBe('Bundle');
        expect(searchPayload?.data?.[0]?.response?.status).toBe('200');
        expect(searchPayload?.data?.[0]?.type).toBe('Communication-search-response-v1.0');
        const matches = extractBundleSearchResources(searchPayload) as any[];
        expect(matches).toHaveLength(1);
        expect(matches[0]?.['Communication.identifier']).toBe('comm-permission-001');
      }
    } finally {
      queueAdapter.stop();
    }
  });

  it('ingests one canonical Composition per IPS document and discovers its ResearchSubject', async () => {
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
    process.env.DEMO_ALLOW_INSECURE_BEARER = 'true';

    resetServerConfig();

    const { app, queueAdapter, tenantManager, vaultRepository, kmsService } = await startServer({ listen: false });
    try {
      const hostBootstrapClaims = {
        [ClaimsOrganizationSchemaorg.addressCountry]: process.env.ORG_HOST_JURISDICTION,
        [ClaimsOrganizationSchemaorg.identifierType]: process.env.ORG_HOST_ID_TYPE,
        [ClaimsOrganizationSchemaorg.identifierValue]: process.env.ORG_HOST_ID_VALUE,
        [ClaimsServiceSchemaorg.category]: Sector.SYSTEM,
      };
      const hostCollectionName = resolveHostPhysicalCollectionName();
      const tenantClaims = testPayloadCreateTenant1.body.data[0].resource.meta.claims as any;
      const tenantVaultId = getTenantVaultId(tenantClaims[ClaimsServiceSchemaorg.category], testTenant1TenantId);

      const tenantConfig = {
        claims: tenantClaims,
        didConfig: { service: initializeTenantServicesConfig(Sector.HEALTH_CARE) },
        didDocument: { id: 'did:web:api.acme.org', '@context': 'https://www.w3.org/ns/did/v1' },
      };

      await kmsService.provisionKeys(tenantVaultId);
      const secureTenantRecord = await kmsService.protectConfidentialData(
        { id: tenantVaultId, sequence: 0, content: tenantConfig } as any,
        'host',
      );
      await vaultRepository.put(hostCollectionName, [secureTenantRecord as any], getEnvSectionId('tenants'));
      await tenantManager.getTenant(tenantVaultId);

      const subjectDid = 'did:web:api.acme.org:individual:ips-all-sections-001';
      const ipsBundle = loadIpsAllSectionsFixture(subjectDid);
      const documentReference = {
        resourceType: 'DocumentReference',
        id: 'ips-all-sections-document-reference-001',
        subject: { reference: subjectDid },
        date: '2026-06-26T10:00:00Z',
        description: 'IPS with all sections',
        identifier: [{ system: 'urn:ietf:rfc:3986', value: 'urn:uuid:ips-all-sections-document-reference-001' }],
        content: [
          {
            attachment: {
              contentType: 'application/fhir+json',
              title: 'bundle-ips-all-sections.json',
              data: Buffer.from(JSON.stringify(ipsBundle), 'utf8').toString('base64'),
            },
          },
        ],
      };

      const submitResp = await invokeExpress(app, {
        method: 'POST',
        url: `/${testTenant1TenantId}/cds-ES/v1/health-care/individual/org.hl7.fhir.r4/Communication/_batch`,
        headers: { 'content-type': 'application/json', authorization: 'Bearer demo-token' },
        body: {
          thid: 'ips-all-sections-communication-001',
          body: {
            resourceType: 'Bundle',
            type: 'batch',
            entry: [
              {
                request: { method: 'POST', url: 'individual/org.hl7.fhir.r4/Communication' },
                resource: {
                  resourceType: 'Communication',
                  status: 'completed',
                  subject: { reference: subjectDid },
                  sent: '2026-06-26T10:00:00Z',
                  payload: [
                    {
                      contentAttachment: {
                        contentType: 'application/fhir+json',
                        title: 'ips-document-reference.json',
                        data: Buffer.from(JSON.stringify(documentReference), 'utf8').toString('base64'),
                      },
                    },
                  ],
                },
              },
            ],
          },
        },
      });
      expect(submitResp.status).toBe(202);

      let communicationPayload: any;
      for (let i = 0; i < 50; i++) {
        const pollResp = await invokeExpress(app, {
          method: 'POST',
          url: `/${testTenant1TenantId}/cds-ES/v1/health-care/individual/org.hl7.fhir.r4/Communication/_batch-response`,
          headers: { 'content-type': 'application/json' },
          body: { thid: 'ips-all-sections-communication-001' },
        });
        if (pollResp.status === 200) {
          communicationPayload = JSON.parse(pollResp.text);
          break;
        }
        await new Promise((r) => setTimeout(r, 50));
      }
      expect(communicationPayload?.data?.[0]?.response?.status).toBe('200');

      // Ingestion alone never publishes a research twin. The explicit permit
      // below is the independent authorization that creates the projection.
      expect(await vaultRepository.getContainersInSection<any>(
        tenantVaultId,
        getDigitalTwinSubjectAliasSectionId(),
      )).toHaveLength(0);
      await setResearchDecision('permit', 'initial-permit');

      const aliases = await vaultRepository.getContainersInSection<any>(tenantVaultId, getDigitalTwinSubjectAliasSectionId());
      const twinSubjectId = aliases.find((alias: any) =>
        alias.id === createHash('sha256').update(subjectDid).digest('hex'))?.twinSubjectId;
      const digitalTwinMedicationsSection = getSubjectScopedSectionId(twinSubjectId, 'digitaltwin', 'medications');
      const digitalTwinObservationsSection = getSubjectScopedSectionId(twinSubjectId, 'digitaltwin', 'observations');
      const digitalTwinCompositionSection = getSubjectScopedSectionId(twinSubjectId, 'digitaltwin', 'composition');
      const medicationRecords = await vaultRepository.getContainersInSection<any>(tenantVaultId, digitalTwinMedicationsSection);
      const observationRecords = await vaultRepository.getContainersInSection<any>(tenantVaultId, digitalTwinObservationsSection);
      const compositionRecords = await vaultRepository.getContainersInSection<any>(tenantVaultId, digitalTwinCompositionSection);
      expect(medicationRecords.length).toBeGreaterThan(0);
      expect(observationRecords.length).toBeGreaterThan(0);
      expect(JSON.stringify([...medicationRecords, ...observationRecords, ...compositionRecords])).not.toContain(subjectDid);
      expect(compositionRecords).toHaveLength(1);
      const indexedCompositionSections = compositionRecords.map((record: any) => String(
        record['Composition.section']
        || record['org.hl7.fhir.r4.Composition.section']
        || '',
      ));
      expect(indexedCompositionSections[0].split(',')).toEqual(expect.arrayContaining([
        HealthcareBasicSections.HistoryOfMedicationUse.attributeValue,
        HealthcareBasicSections.VitalSigns.attributeValue,
      ]));
      const researchMedicationCode = String(Object.entries(medicationRecords[0] || {})
        .find(([key]) => key.endsWith('MedicationStatement.code'))?.[1] || '');
      expect(researchMedicationCode).toContain('|');

      async function setResearchDecision(decision: 'permit' | 'deny', suffix: string) {
        const thid = `ips-secondary-use-${suffix}`;
        const claims = {
          '@context': 'org.hl7.fhir.r4',
          [ClaimConsent.subject]: subjectDid,
          [ClaimConsent.actorIdentifier]: 'did:web:research.example.org',
          [ClaimConsent.actorRole]: 'ISCO-08|221',
          [ClaimConsent.decision]: decision,
          [ClaimConsent.status]: ConsentStatuses.Active,
          [ClaimConsent.date]: '2026-08-26',
          [ClaimConsent.purpose]: HealthcareConsentPurposes.Research,
          [ClaimConsent.action]: ServiceCapability.DigitalTwinReader,
          [ClaimConsent.sourceReference]: DEMO_SMART_ACCESS_LOCAL_IDS.researchRoleConsentSourceReference,
        };
        const submit = await invokeExpress(app, {
          method: 'POST',
          url: `/${testTenant1TenantId}/cds-ES/v1/health-care/individual/org.hl7.fhir.r4/Consent/_batch`,
          headers: { 'content-type': 'application/json', authorization: 'Bearer demo-token' },
          body: {
            thid,
            body: {
              resourceType: 'Bundle',
              type: 'batch',
              entry: [{
                request: { method: 'POST', url: 'individual/org.hl7.fhir.r4/Consent' },
                resource: { resourceType: 'Consent', meta: { claims } },
              }],
            },
          },
        });
        expect(submit.status).toBe(202);
        for (let attempt = 0; attempt < 50; attempt++) {
          const poll = await invokeExpress(app, {
            method: 'POST',
            url: `/${testTenant1TenantId}/cds-ES/v1/health-care/individual/org.hl7.fhir.r4/Consent/_batch-response`,
            headers: { 'content-type': 'application/json' },
            body: { thid },
          });
          if (poll.status === 200) {
            expect(JSON.parse(poll.text).data[0].response.status).toBe('201');
            return;
          }
          await new Promise((resolve) => setTimeout(resolve, 25));
        }
        throw new Error(`Consent ${decision} polling did not complete.`);
      }

      await setResearchDecision('deny', 'deny');
      expect(await vaultRepository.getContainersInSection(tenantVaultId, digitalTwinCompositionSection)).toHaveLength(compositionRecords.length);
      expect((await vaultRepository.getContainersInSection(tenantVaultId, digitalTwinMedicationsSection)).length).toBeGreaterThan(0);

      await setResearchDecision('permit', 'permit');
      const rebuiltCompositions = await vaultRepository.getContainersInSection<any>(tenantVaultId, digitalTwinCompositionSection);
      const rebuiltMedications = await vaultRepository.getContainersInSection<any>(tenantVaultId, digitalTwinMedicationsSection);
      expect(rebuiltCompositions).toHaveLength(compositionRecords.length);
      expect(rebuiltCompositions.some((record: any) => String(
        record['Composition.section'] || record['org.hl7.fhir.r4.Composition.section'] || '',
      ).split(',').includes(HealthcareBasicSections.HistoryOfMedicationUse.attributeValue))).toBe(true);
      expect(rebuiltMedications.length).toBeGreaterThan(0);
      expect(rebuiltMedications.some((record) =>
        (record['MedicationStatement.code']
          || record['org.hl7.fhir.api.MedicationStatement.code']
          || record['org.hl7.fhir.r4.MedicationStatement.code'])
          === 'http://snomed.info/sct|108575001',
      )).toBe(true);

      // Step: read the complete fixture back through the authoritative public
      // Communication endpoint. Subject/$summary is only the operation
      // reference inside that request; this test deliberately performs no
      // direct HTTP call to the summary route.
      // Exact Composition references prove that shared Observation/Condition
      // collections do not bleed into unrelated IPS sections and that the
      // Flag and DeviceUseStatement sections survive persistence.
      const completeSummaryResp = await invokeExpress(app, {
        method: 'POST',
        url: `/${testTenant1TenantId}/cds-ES/v1/health-care/individual/org.hl7.fhir.r4/Communication/_batch`,
        headers: { 'content-type': 'application/json', authorization: 'Bearer demo-token' },
        body: {
          thid: 'ips-all-sections-summary-001',
          body: {
            resourceType: 'Bundle',
            type: 'batch',
            entry: [{
              request: { method: 'POST', url: 'individual/org.hl7.fhir.r4/Communication' },
              resource: {
                resourceType: 'Communication',
                status: 'completed',
                subject: { reference: subjectDid },
                payload: [{
                  contentReference: {
                    reference: `individual/org.hl7.fhir.r4/Subject/$summary?subject=${encodeURIComponent(subjectDid)}`,
                  },
                }],
              },
            }],
          },
        },
      });
      expect(completeSummaryResp.status).toBe(202);

      let completeSummaryPayload: any;
      for (let i = 0; i < 50; i++) {
        const pollResp = await invokeExpress(app, {
          method: 'POST',
          url: `/${testTenant1TenantId}/cds-ES/v1/health-care/individual/org.hl7.fhir.r4/Communication/_batch-response`,
          headers: { 'content-type': 'application/json' },
          body: { thid: 'ips-all-sections-summary-001' },
        });
        if (pollResp.status === 200) {
          completeSummaryPayload = JSON.parse(pollResp.text);
          break;
        }
        await new Promise((r) => setTimeout(r, 50));
      }

      const completeSummary = completeSummaryPayload?.data?.[0]?.resource;
      const completeComposition = completeSummary?.entry
        ?.find((bundleEntry: any) => bundleEntry?.resource?.resourceType === 'Composition')
        ?.resource;
      const expectedSectionTypes: Record<string, string[]> = {
        '11450-4': ['Condition', 'Condition'],
        '48765-2': ['AllergyIntolerance'],
        '10160-0': ['MedicationStatement', 'MedicationStatement', 'MedicationStatement'],
        '11369-6': Array(8).fill('Immunization'),
        '30954-2': Array(6).fill('Observation'),
        '47519-4': ['Procedure'],
        '46264-8': ['DeviceUseStatement'],
        '8716-3': Array(3).fill('Observation'),
        '29762-2': Array(2).fill('Observation'),
        '104605-1': ['Flag'],
        '81338-6': ['Consent', 'DocumentReference'],
        '42348-3': ['Consent', 'DocumentReference'],
        '47420-5': ['Condition'],
        '11348-0': ['Condition'],
        '10162-6': ['Observation'],
        '18776-5': ['CarePlan'],
      };
      const resourceTypeByReference = new Map(
        (completeSummary?.entry || []).flatMap((bundleEntry: any) => {
          const resource = bundleEntry?.resource;
          const aliases = [
            bundleEntry?.fullUrl,
            resource?.id,
            resource?.resourceType && resource?.id
              ? `${resource.resourceType}/${resource.id}`
              : undefined,
          ].filter(Boolean);
          return aliases.map((alias: string) => [alias, resource?.resourceType]);
        }),
      );
      expect(completeComposition?.section).toHaveLength(16);
      for (const section of completeComposition.section) {
        const code = section?.code?.coding?.[0]?.code;
        const types = (section?.entry || [])
          .map((item: any) => resourceTypeByReference.get(item?.reference))
          .filter(Boolean)
          .sort();
        expect(types).toEqual([...(expectedSectionTypes[code] || [])].sort());
      }

      const scopedSectionCodes = [
        HealthcareBasicSections.ProblemList.attributeValue,
        HealthcareBasicSections.HistoryOfMedicationUse.attributeValue,
      ];
      const requestedScopedSectionCodes = [
        ...scopedSectionCodes,
        HealthcareBasicSections.AllergiesAndIntolerances.attributeValue,
      ];
      const sectionScopedBearer = createDemoBearer({
        sub: EXAMPLE_SUBJECT_DID,
        scope: `organization/Composition.rs?subject=${encodeURIComponent(subjectDid)}&section=${scopedSectionCodes.join(',')}`,
      });
      const scopedSummaryResp = await invokeExpress(app, {
        method: 'POST',
        url: `/${testTenant1TenantId}/cds-ES/v1/health-care/individual/org.hl7.fhir.r4/Communication/_batch`,
        headers: { 'content-type': 'application/json', authorization: `Bearer ${sectionScopedBearer}` },
        body: {
          thid: 'ips-all-sections-scoped-summary-001',
          body: {
            resourceType: ResourceTypesFhirR4.Bundle,
            type: 'batch',
            entry: [{
              request: { method: 'POST', url: 'individual/org.hl7.fhir.r4/Communication' },
              resource: {
                resourceType: ResourceTypesFhirR4.Communication,
                status: 'completed',
                subject: { reference: subjectDid },
                payload: [{
                  contentReference: {
                    reference: `individual/org.hl7.fhir.r4/Subject/$summary?subject=${encodeURIComponent(subjectDid)}&section=${encodeURIComponent(requestedScopedSectionCodes.join(','))}`,
                  },
                }],
              },
            }],
          },
        },
      });
      expect(scopedSummaryResp.status).toBe(202);

      let scopedSummaryPayload: any;
      for (let i = 0; i < 50; i++) {
        const pollResp = await invokeExpress(app, {
          method: 'POST',
          url: `/${testTenant1TenantId}/cds-ES/v1/health-care/individual/org.hl7.fhir.r4/Communication/_batch-response`,
          headers: { 'content-type': 'application/json' },
          body: { thid: 'ips-all-sections-scoped-summary-001' },
        });
        if (pollResp.status === 200) {
          scopedSummaryPayload = JSON.parse(pollResp.text);
          break;
        }
        await new Promise((r) => setTimeout(r, 50));
      }

      const scopedSummary = scopedSummaryPayload?.data?.[0]?.resource;
      const scopedComposition = scopedSummary?.entry
        ?.find((bundleEntry: any) => bundleEntry?.resource?.resourceType === 'Composition')
        ?.resource;
      const returnedScopedSectionCodes = (scopedComposition?.section || [])
        .map((section: any) => section?.code?.coding?.[0]?.code)
        .sort();
      expect(returnedScopedSectionCodes).toEqual(['10160-0', '11450-4']);

      const returnedScopedResourceTypes = (scopedSummary?.entry || [])
        .map((bundleEntry: any) => bundleEntry?.resource?.resourceType);
      expect(returnedScopedResourceTypes).toEqual(expect.arrayContaining([
        ResourceTypesFhirR4.Composition,
        ResourceTypesFhirR4.Condition,
        ResourceTypesFhirR4.MedicationStatement,
      ]));
      expect(returnedScopedResourceTypes).not.toEqual(expect.arrayContaining([
        ResourceTypesFhirR4.AllergyIntolerance,
        ResourceTypesFhirR4.Immunization,
        ResourceTypesFhirR4.Observation,
        ResourceTypesFhirR4.CarePlan,
        ResourceTypesFhirR4.DocumentReference,
      ]));

      const allergiesSection = 'LOINC|48765-2';
      const sectionSubjectDid = 'did:web:api.acme.org:individual:section-only-allergy-001';
      const clinicalControllerDid = 'did:web:api.acme.org:individual:controller-section-allergy-001';
      const clinicalActorIdentifier = `urn:uuid:${EXAMPLE_KYC_CONTROLLER_USER_UUID}`;
      const clinicalAssignmentIdentifier = `urn:uuid:${EXAMPLE_KYC_CONTROLLER_UUID}`;
      await vaultRepository.put(tenantVaultId, [{
        id: clinicalAssignmentIdentifier,
        kind: FhirIpsCreatorKinds.Professional,
        actorIdentifier: clinicalActorIdentifier,
        authorIdentifier: clinicalAssignmentIdentifier,
        ownerIdentifier: EXAMPLE_TENANT_SERVICE_DID,
        role: EXAMPLE_HEALTHCARE_ACTOR_ROLE_PHYSICIAN,
        actorDids: [clinicalControllerDid],
      } as any], getClinicalCreatorBindingsSectionId());
      await submitConsentRuleAndPoll({
        app,
        tenantId: testTenant1TenantId,
        jurisdiction: 'ES',
        sector: 'health-care',
        format: 'org.hl7.fhir.r4',
        thid: 'allergy-section-explicit-research-permit-001',
        claims: buildDemoResearchPermitByRoleConsent({ subjectDid: sectionSubjectDid }),
      });
      const allergySectionBundle = {
        resourceType: 'Bundle',
        type: 'batch',
        data: [{
          type: 'AllergyIntolerance-edit-request-v1.0',
          resource: {
            resourceType: 'AllergyIntolerance',
            id: 'allergy-section-update-integration-001',
            meta: { claims: {
              '@context': 'org.hl7.fhir.api',
              'AllergyIntolerance.identifier': 'urn:uuid:allergy-section-update-integration-001',
              'AllergyIntolerance.subject': sectionSubjectDid,
              'AllergyIntolerance.category': allergiesSection,
              'AllergyIntolerance.criticality': 'high',
              'AllergyIntolerance.clinical-status': 'active',
              'AllergyIntolerance.onset-datetime': '2026-07-24T09:30:00Z',
            } },
          },
        }],
      };

      const submitSectionUpdate = async (status: 'preliminary' | 'final', suffix: string): Promise<any> => {
        const thid = `allergy-section-update-integration-${suffix}`;
        const sectionUpdateResp = await invokeExpress(app, {
          method: 'POST',
          url: `/${testTenant1TenantId}/cds-ES/v1/health-care/individual/org.hl7.fhir.r4/Communication/_batch`,
          headers: { 'content-type': 'application/json', authorization: 'Bearer demo-token' },
          body: {
            thid,
            iss: clinicalControllerDid,
            body: {
              resourceType: 'Bundle',
              type: 'batch',
              entry: [{
                request: { method: 'POST', url: 'individual/org.hl7.fhir.r4/Communication' },
                resource: {
                  resourceType: 'Communication',
                  status: 'completed',
                  meta: { claims: {
                    '@context': 'org.hl7.fhir.r4',
                    'Communication.subject': sectionSubjectDid,
                    'Composition.section': allergiesSection,
                    'Composition.status': status,
                    'Composition.author': EXAMPLE_TENANT_SERVICE_DID,
                    'Composition.attester': clinicalAssignmentIdentifier,
                    'Composition.attester-mode': CompositionAttesterModes.Professional,
                  } },
                  subject: { reference: sectionSubjectDid },
                  payload: [{ contentAttachment: {
                    contentType: 'application/fhir+json',
                    title: 'allergies-section.json',
                    data: Buffer.from(JSON.stringify(allergySectionBundle), 'utf8').toString('base64'),
                  } }],
                },
              }],
            },
          },
        });
        expect(sectionUpdateResp.status).toBe(202);
        for (let i = 0; i < 50; i++) {
          const pollResp = await invokeExpress(app, {
            method: 'POST',
            url: `/${testTenant1TenantId}/cds-ES/v1/health-care/individual/org.hl7.fhir.r4/Communication/_batch-response`,
            headers: { 'content-type': 'application/json' },
            body: { thid },
          });
          if (pollResp.status === 200) return JSON.parse(pollResp.text);
          await new Promise((r) => setTimeout(r, 50));
        }
        throw new Error(`Section update ${status} polling did not complete.`);
      };

      // Step 1: keep a preliminary section update in the individual plane only.
      const preliminarySectionPayload = await submitSectionUpdate('preliminary', 'preliminary');
      expect(preliminarySectionPayload?.data?.[0]?.response?.status).toBe('200');
      const sectionAliases = await vaultRepository.getContainersInSection<any>(tenantVaultId, getDigitalTwinSubjectAliasSectionId());
      const sectionTwinSubjectId = sectionAliases.find((alias: any) =>
        alias.id === createHash('sha256').update(sectionSubjectDid).digest('hex'))?.twinSubjectId;
      expect(await vaultRepository.getContainersInSection<any>(
        tenantVaultId,
        getSubjectScopedSectionId(sectionTwinSubjectId, 'digitaltwin', 'allergies'),
      )).toHaveLength(0);
      expect(await vaultRepository.getContainersInSection<any>(
        tenantVaultId,
        getSubjectScopedSectionId(sectionTwinSubjectId, 'digitaltwin', 'composition'),
      )).toHaveLength(0);

      // Step 2: finalization makes unchanged clinical content research-eligible.
      const sectionUpdatePayload = await submitSectionUpdate('final', 'final');
      expect(sectionUpdatePayload?.data?.[0]?.response?.status).toBe('200');
      const allergyRecords = await vaultRepository.getContainersInSection<any>(
        tenantVaultId,
        getSubjectScopedSectionId(sectionTwinSubjectId, 'digitaltwin', 'allergies'),
      );
      const updatedCompositionRecords = await vaultRepository.getContainersInSection<any>(
        tenantVaultId,
        getSubjectScopedSectionId(sectionTwinSubjectId, 'digitaltwin', 'composition'),
      );
      expect(allergyRecords.some((record: any) =>
        (record['AllergyIntolerance.subject'] || record['org.hl7.fhir.api.AllergyIntolerance.subject']) === sectionTwinSubjectId,
      )).toBe(true);
      expect(updatedCompositionRecords.some((record: any) =>
        record['Composition.section'] === allergiesSection
        || record['org.hl7.fhir.r4.Composition.section'] === allergiesSection,
      )).toBe(true);

      // Step 3: read the finalized section-only update through the canonical summary
      // contract and prove the claims-first AllergyIntolerance is returned.
      const summaryResp = await invokeExpress(app, {
        method: 'POST',
        url: `/${testTenant1TenantId}/cds-ES/v1/health-care/individual/org.hl7.fhir.api/Communication/_batch`,
        headers: { 'content-type': 'application/json', authorization: 'Bearer demo-token' },
        body: {
          thid: 'allergy-section-summary-integration-001',
          body: {
            resourceType: 'Bundle',
            type: 'batch',
            data: [{
              type: 'Communication',
              resource: {
                resourceType: 'Communication',
                meta: {
                  claims: {
                    '@context': 'org.hl7.fhir.api',
                    'Communication.status': 'completed',
                    'Communication.subject': sectionSubjectDid,
                    'Communication.sender': 'did:web:provider.example.org',
                    'Communication.content-reference':
                      'individual/org.hl7.fhir.api/Subject/$summary',
                    'Communication.content-attachment-type': 'application/fhir+json',
                    'Communication.content-attachment-data': Buffer.from(JSON.stringify({
                      resourceType: 'Parameters',
                      parameter: [
                        { name: 'subject', valueString: sectionSubjectDid },
                        { name: 'section', valueString: allergiesSection },
                      ],
                    }), 'utf8').toString('base64'),
                  },
                },
              },
            }],
          },
        },
      });
      expect(summaryResp.status).toBe(202);

      let summaryPayload: any;
      for (let i = 0; i < 50; i++) {
        const pollResp = await invokeExpress(app, {
          method: 'POST',
          url: `/${testTenant1TenantId}/cds-ES/v1/health-care/individual/org.hl7.fhir.api/Communication/_batch-response`,
          headers: { 'content-type': 'application/json' },
          body: { thid: 'allergy-section-summary-integration-001' },
        });
        if (pollResp.status === 200) {
          summaryPayload = JSON.parse(pollResp.text);
          break;
        }
        await new Promise((r) => setTimeout(r, 50));
      }

      expect(summaryPayload?.data?.[0]?.type).toBe('Bundle-summary-response-v1.0');
      expect(summaryPayload?.data?.[0]?.resource?.type).toBe('document');
      const allergySummaryEntry = summaryPayload?.data?.[0]?.resource?.entry
        ?.find((entry: any) => entry?.resource?.resourceType === 'AllergyIntolerance');
      expect(allergySummaryEntry?.resource?.meta?.claims).toMatchObject({
        'AllergyIntolerance.identifier': 'urn:uuid:allergy-section-update-integration-001',
        'AllergyIntolerance.subject': sectionSubjectDid,
        'AllergyIntolerance.criticality': 'high',
        'AllergyIntolerance.clinical-status': 'active',
        'AllergyIntolerance.onset-datetime': '2026-07-24T09:30:00Z',
      });

      const researchAliases = await vaultRepository.getContainersInSection<any>(tenantVaultId, getDigitalTwinSubjectAliasSectionId());
      const twinFor = (source: string) => researchAliases.find((alias: any) =>
        alias.id === createHash('sha256').update(source).digest('hex'))?.twinSubjectId;
      const searchCases = [
        {
          // Basic portal search: sections are repeated, text is
          // resource-agnostic and an omitted date-to is resolved by GW.
          thid: 'ips-all-sections-basic-text-date-search-001',
          expectedSubject: twinFor(subjectDid),
          parameters: [
            { name: 'section', valueString: HealthcareBasicSections.HistoryOfMedicationUse.attributeValue },
            { name: 'section', valueString: HealthcareBasicSections.Results.attributeValue },
            { name: 'date-from', valueDate: '2024-01-01' },
            { name: 'text', valueString: researchMedicationCode },
          ],
        },
        {
          thid: 'ips-all-sections-vs-search-001',
          expectedSubject: twinFor(subjectDid),
          parameters: [
            { name: 'section', valueString: HealthcareBasicSections.VitalSigns.attributeValue },
            { name: 'Observation.code', valueString: 'http://loinc.org|85354-9' },
          ],
        },
        {
          // One Parameters request intersects the subjects found in two
          // resource-family collections before the ResearchSubject response.
          thid: 'ips-multi-family-intersection-search-001',
          expectedSubject: twinFor(subjectDid),
          parameters: [
            { name: 'section', valueString: HealthcareBasicSections.HistoryOfMedicationUse.attributeValue },
            { name: 'section', valueString: HealthcareBasicSections.VitalSigns.attributeValue },
            { name: 'MedicationStatement.code', valueString: researchMedicationCode },
            { name: 'Observation.code', valueString: 'http://loinc.org|85354-9' },
          ],
        },
        {
          thid: 'allergy-section-update-search-001',
          expectedSubject: twinFor(sectionSubjectDid),
          parameters: [
            { name: 'section', valueString: allergiesSection },
            {
              name: 'AllergyIntolerance.criticality',
              valueString: 'high',
            },
          ],
        },
      ];

      for (const searchCase of searchCases) {
        const searchResp = await invokeExpress(app, {
          method: 'POST',
          url: `/${testTenant1TenantId}/cds-ES/v1/health-care/digitaltwin/org.hl7.fhir.r4/ResearchSubject/_search`,
          headers: { 'content-type': 'application/json', authorization: 'Bearer demo-token' },
          body: {
            thid: searchCase.thid,
            body: {
              resourceType: 'Parameters',
              parameter: searchCase.parameters,
            },
          },
        });
        expect(searchResp.status).toBe(202);

        let searchPayload: any;
        for (let i = 0; i < 50; i++) {
          const pollResp = await invokeExpress(app, {
            method: 'POST',
            url: `/${testTenant1TenantId}/cds-ES/v1/health-care/digitaltwin/org.hl7.fhir.r4/ResearchSubject/_batch-response`,
            headers: { 'content-type': 'application/json' },
            body: { thid: searchCase.thid },
          });
          if (pollResp.status === 200) {
            searchPayload = JSON.parse(pollResp.text);
            break;
          }
          await new Promise((r) => setTimeout(r, 50));
        }

        expect(searchPayload?.resourceType).toBe('Bundle');
        expect(searchPayload?.data?.[0]?.type).toBe('ResearchSubject-search-response-v1.0');
        const matches = extractBundleSearchResources(searchPayload) as any[];
        expect(matches.length).toBeGreaterThanOrEqual(1);
        const firstMatch = matches[0];
        const containedComposition = firstMatch?.contained?.find(
          (resource: any) => resource.resourceType === 'Composition',
        );
        expect(containedComposition?.resourceType).toBe('Composition');
        expect(
          containedComposition?.subject?.reference,
        ).toBe(searchCase.expectedSubject);
      }

      // Step 4: the authenticated actor for the stored assignment deletes one
      // exact version through
      // the normal FHIR batch DELETE entry; the request has no resource body.
      // Authorization invariant: both creator and Communication.subject match.
      // Persistence invariant: the next operational summary and synchronized
      // twin view omit the fact while their lifecycle contracts stay distinct.
      const individualAllergySectionId = getSubjectScopedSectionId(sectionSubjectDid, 'individual', 'allergies');
      const storedAllergy = await vaultRepository.get<any>(
        tenantVaultId,
        'allergy-section-update-integration-001',
        individualAllergySectionId,
      );
      expect(storedAllergy?.['Composition.author']).toBe(EXAMPLE_TENANT_SERVICE_DID);
      expect(storedAllergy?.['Composition.attester']).toBe(clinicalAssignmentIdentifier);
      const storedAllergyVersion = storedAllergy?.['AllergyIntolerance.meta.versionId'];
      expect(storedAllergyVersion).toBeTruthy();

      const deleteBundle = {
        resourceType: 'Bundle',
        type: 'batch',
        entry: [{
          request: {
            method: 'DELETE',
            url: 'AllergyIntolerance/allergy-section-update-integration-001',
            ifMatch: `W/"${storedAllergyVersion}"`,
          },
        }],
      };
      const deleteResp = await invokeExpress(app, {
        method: 'POST',
        url: `/${testTenant1TenantId}/cds-ES/v1/health-care/individual/org.hl7.fhir.r4/Communication/_batch`,
        headers: { 'content-type': 'application/json', authorization: 'Bearer demo-token' },
        body: {
          thid: 'allergy-section-delete-integration-001',
          iss: clinicalControllerDid,
          body: {
            resourceType: 'Bundle',
            type: 'batch',
            entry: [{
              request: { method: 'POST', url: 'individual/org.hl7.fhir.r4/Communication' },
              resource: {
                resourceType: 'Communication',
                status: 'completed',
                meta: { claims: {
                  '@context': 'org.hl7.fhir.r4',
                  'Communication.subject': sectionSubjectDid,
                  'Composition.section': allergiesSection,
                } },
                subject: { reference: sectionSubjectDid },
                payload: [{ contentAttachment: {
                  contentType: 'application/fhir+json',
                  title: 'allergies-section-delete.json',
                  data: Buffer.from(JSON.stringify(deleteBundle), 'utf8').toString('base64'),
                } }],
              },
            }],
          },
        },
      });
      expect(deleteResp.status).toBe(202);

      let deletePayload: any;
      for (let i = 0; i < 50; i++) {
        const pollResp = await invokeExpress(app, {
          method: 'POST',
          url: `/${testTenant1TenantId}/cds-ES/v1/health-care/individual/org.hl7.fhir.r4/Communication/_batch-response`,
          headers: { 'content-type': 'application/json' },
          body: { thid: 'allergy-section-delete-integration-001' },
        });
        if (pollResp.status === 200) {
          deletePayload = JSON.parse(pollResp.text);
          break;
        }
        await new Promise((r) => setTimeout(r, 50));
      }
      expect(deletePayload?.data).toEqual(expect.arrayContaining([
        expect.objectContaining({
          id: 'allergy-section-update-integration-001',
          response: { status: '204' },
        }),
      ]));
      expect(await vaultRepository.get<any>(
        tenantVaultId,
        'allergy-section-update-integration-001',
        individualAllergySectionId,
      )).toBeUndefined();
      expect((await vaultRepository.getContainersInSection<any>(
        tenantVaultId,
        getSubjectScopedSectionId(sectionTwinSubjectId, 'digitaltwin', 'allergies'),
      )).some((record: any) =>
        (record['AllergyIntolerance.identifier'] || record['org.hl7.fhir.api.AllergyIntolerance.identifier'])
          === 'urn:uuid:allergy-section-update-integration-001')).toBe(false);

      const summaryAfterDeleteResp = await invokeExpress(app, {
        method: 'POST',
        url: `/${testTenant1TenantId}/cds-ES/v1/health-care/individual/org.hl7.fhir.api/Communication/_batch`,
        headers: { 'content-type': 'application/json', authorization: 'Bearer demo-token' },
        body: {
          thid: 'allergy-section-summary-after-delete-integration-001',
          body: {
            resourceType: 'Bundle',
            type: 'batch',
            data: [{
              type: 'Communication',
              resource: {
                resourceType: 'Communication',
                meta: { claims: {
                  '@context': 'org.hl7.fhir.api',
                  'Communication.status': 'completed',
                  'Communication.subject': sectionSubjectDid,
                  'Communication.sender': 'did:web:provider.example.org',
                  'Communication.content-reference': 'individual/org.hl7.fhir.api/Subject/$summary',
                  'Communication.content-attachment-type': 'application/fhir+json',
                  'Communication.content-attachment-data': Buffer.from(JSON.stringify({
                    resourceType: 'Parameters',
                    parameter: [
                      { name: 'subject', valueString: sectionSubjectDid },
                      { name: 'section', valueString: allergiesSection },
                    ],
                  }), 'utf8').toString('base64'),
                } },
              },
            }],
          },
        },
      });
      expect(summaryAfterDeleteResp.status).toBe(202);
      let summaryAfterDeletePayload: any;
      for (let i = 0; i < 50; i++) {
        const pollResp = await invokeExpress(app, {
          method: 'POST',
          url: `/${testTenant1TenantId}/cds-ES/v1/health-care/individual/org.hl7.fhir.api/Communication/_batch-response`,
          headers: { 'content-type': 'application/json' },
          body: { thid: 'allergy-section-summary-after-delete-integration-001' },
        });
        if (pollResp.status === 200) {
          summaryAfterDeletePayload = JSON.parse(pollResp.text);
          break;
        }
        await new Promise((r) => setTimeout(r, 50));
      }
      expect(summaryAfterDeletePayload?.data?.[0]?.resource?.entry?.some((summaryEntry: any) =>
        summaryEntry?.resource?.resourceType === 'AllergyIntolerance'
        && summaryEntry?.resource?.id === 'allergy-section-update-integration-001')).toBe(false);

      const purgeThid = 'ips-index-provider-offboarding-001';
      const purgeSubmit = await invokeExpress(app, {
        method: 'POST',
        url: `/${testTenant1TenantId}/cds-ES/v1/health-care/individual/org.hl7.fhir.r4/ResearchSubject/_purge`,
        headers: { 'content-type': 'application/json', authorization: 'Bearer demo-token' },
        body: {
          thid: purgeThid,
          body: {
            resourceType: 'Parameters',
            parameter: [{ name: 'subject', valueString: subjectDid }],
          },
        },
      });
      expect(purgeSubmit.status).toBe(202);
      let purgePayload: any;
      for (let i = 0; i < 50; i++) {
        const poll = await invokeExpress(app, {
          method: 'POST',
          url: `/${testTenant1TenantId}/cds-ES/v1/health-care/individual/org.hl7.fhir.r4/ResearchSubject/_purge-response`,
          headers: { 'content-type': 'application/json' },
          body: { thid: purgeThid },
        });
        if (poll.status === 200) {
          purgePayload = JSON.parse(poll.text);
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      expect(purgePayload?.parameter).toEqual([{ name: 'purged', valueBoolean: true }]);
      expect(await vaultRepository.getContainersInSection(tenantVaultId, digitalTwinCompositionSection)).toHaveLength(compositionRecords.length);
      const aliasesAfterPurge = await vaultRepository.getContainersInSection<any>(tenantVaultId, getDigitalTwinSubjectAliasSectionId());
      expect(aliasesAfterPurge.some((alias: any) => alias.twinSubjectId === twinSubjectId)).toBe(false);

      await setResearchDecision('permit', 'permit-after-provider-return');
      const aliasesAfterReturn = await vaultRepository.getContainersInSection<any>(tenantVaultId, getDigitalTwinSubjectAliasSectionId());
      const replacementTwinSubjectId = aliasesAfterReturn.find((alias: any) =>
        alias.id === createHash('sha256').update(subjectDid).digest('hex'))?.twinSubjectId;
      expect(replacementTwinSubjectId).toMatch(/^urn:uuid:/);
      expect(replacementTwinSubjectId).not.toBe(twinSubjectId);
      expect(await vaultRepository.getContainersInSection(tenantVaultId, digitalTwinCompositionSection)).toHaveLength(compositionRecords.length);
    } finally {
      queueAdapter.stop();
    }
  });

  it('stores one researcher working-selection Composition and finds it by Composition.meta-tag', async () => {
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
    process.env.DEMO_ALLOW_INSECURE_BEARER = 'true';

    resetServerConfig();

    const { app, queueAdapter, tenantManager, vaultRepository, kmsService } = await startServer({ listen: false });
    try {
      const hostBootstrapClaims = {
        [ClaimsOrganizationSchemaorg.addressCountry]: process.env.ORG_HOST_JURISDICTION,
        [ClaimsOrganizationSchemaorg.identifierType]: process.env.ORG_HOST_ID_TYPE,
        [ClaimsOrganizationSchemaorg.identifierValue]: process.env.ORG_HOST_ID_VALUE,
        [ClaimsServiceSchemaorg.category]: Sector.SYSTEM,
      };
      const hostCollectionName = resolveHostPhysicalCollectionName();
      const tenantClaims = testPayloadCreateTenant1.body.data[0].resource.meta.claims as any;
      const tenantVaultId = getTenantVaultId(tenantClaims[ClaimsServiceSchemaorg.category], testTenant1TenantId);

      const tenantConfig = {
        claims: tenantClaims,
        didConfig: { service: initializeTenantServicesConfig(Sector.HEALTH_CARE) },
        didDocument: { id: 'did:web:api.acme.org', '@context': 'https://www.w3.org/ns/did/v1' },
      };

      await kmsService.provisionKeys(tenantVaultId);
      const secureTenantRecord = await kmsService.protectConfidentialData(
        { id: tenantVaultId, sequence: 0, content: tenantConfig } as any,
        'host',
      );
      await vaultRepository.put(hostCollectionName, [secureTenantRecord as any], getEnvSectionId('tenants'));
      await tenantManager.getTenant(tenantVaultId);

      const subjectDid = await getOrCreateDigitalTwinSubjectId({
        vaultRepository,
        tenantVaultId,
        sourceSubject: 'did:web:api.acme.org:individual:research-selection-subject-001',
      });
      const hostedOrganizationDid = buildOrganizationDidWeb({
        hostDidWeb: `did:web:${EXAMPLE_HOST_PUBLIC_HOSTNAME}`,
        tenantId: testTenant1TenantId,
        jurisdiction: 'ES',
        version: EXAMPLE_ROUTE_VERSION,
        sector: 'health-care',
      });
      const operationalEmployeeDid = buildProfessionalDidWeb({
        organizationDidWeb: hostedOrganizationDid,
        email: ExampleEmployeeEmails.SharedProfessional,
        role: ExampleEmployeeRoles.Doctor,
      });
      const selectionCompositionId = 'research-selection-01JZ4CV2G1X2M5Y8Y3V4W6Q7R8';
      const selectionTag = {
        id: 'Composition.meta.tag[0]',
        system: 'urn:research:tag:score',
        code: '10',
      };

      const saveResp = await invokeExpress(app, {
        method: 'POST',
        url: `/${testTenant1TenantId}/cds-ES/v1/health-care/digitaltwin/org.hl7.fhir.r4/Composition/_batch`,
        headers: { 'content-type': 'application/json', authorization: 'Bearer demo-token' },
        body: {
          thid: 'researcher-selection-composition-save-001',
          body: {
            resourceType: 'Bundle',
            type: 'batch',
            entry: [{
              type: 'Composition',
              request: {
                method: 'POST',
                url: 'digitaltwin/org.hl7.fhir.r4/Composition',
              },
              resource: {
                resourceType: 'Composition',
                id: selectionCompositionId,
                meta: {
                  claims: {
                    '@context': 'org.hl7.fhir.r4',
                    '@type': 'Composition:ResearcherWorkingSelection',
                    'Composition.identifier': selectionCompositionId,
                    'Composition.subject': subjectDid,
                    'Composition.section': HealthcareBasicSections.HistoryOfMedicationUse.attributeValue,
                    'Composition.type': HealthcareBasicSections.PatientSummaryDocument.attributeValue,
                    'Composition.author': operationalEmployeeDid,
                    'Composition.date': '2026-07-01T10:00:00Z',
                  },
                  tag: [selectionTag],
                },
              },
            }],
          },
        },
      });
      expect(saveResp.status).toBe(202);

      let savePayload: any;
      for (let i = 0; i < 50; i++) {
        const pollResp = await invokeExpress(app, {
          method: 'POST',
          url: `/${testTenant1TenantId}/cds-ES/v1/health-care/digitaltwin/org.hl7.fhir.r4/Composition/_batch-response`,
          headers: { 'content-type': 'application/json' },
          body: { thid: 'researcher-selection-composition-save-001' },
        });
        if (pollResp.status === 200) {
          savePayload = JSON.parse(pollResp.text);
          break;
        }
        await new Promise((r) => setTimeout(r, 50));
      }
      expect(savePayload?.data?.[0]?.response?.status).toBe('201');

      const searchResp = await invokeExpress(app, {
        method: 'POST',
        url: `/${testTenant1TenantId}/cds-ES/v1/health-care/digitaltwin/org.hl7.fhir.r4/ResearchSubject/_search`,
        headers: { 'content-type': 'application/json', authorization: 'Bearer demo-token' },
        body: {
          thid: 'researcher-selection-composition-search-001',
          body: {
            resourceType: 'Parameters',
            parameter: [
              { name: 'section', valueString: HealthcareBasicSections.HistoryOfMedicationUse.attributeValue },
              { name: 'Composition.meta-tag', valueCoding: { system: 'urn:research:tag:score', code: '10' } },
            ],
          },
        },
      });
      expect(searchResp.status).toBe(202);

      let searchPayload: any;
      for (let i = 0; i < 50; i++) {
        const pollResp = await invokeExpress(app, {
          method: 'POST',
          url: `/${testTenant1TenantId}/cds-ES/v1/health-care/digitaltwin/org.hl7.fhir.r4/ResearchSubject/_batch-response`,
          headers: { 'content-type': 'application/json' },
          body: { thid: 'researcher-selection-composition-search-001' },
        });
        if (pollResp.status === 200) {
          searchPayload = JSON.parse(pollResp.text);
          break;
        }
        await new Promise((r) => setTimeout(r, 50));
      }

      expect(searchPayload?.resourceType).toBe('Bundle');
      expect(searchPayload?.data?.[0]?.type).toBe('ResearchSubject-search-response-v1.0');
      const matches = extractBundleSearchResources(searchPayload) as any[];
      expect(matches).toHaveLength(1);
      expect(matches[0]?.resourceType).toBe('ResearchSubject');
      const containedSelection = matches[0]?.contained?.find((resource: any) => resource.resourceType === 'Composition');
      expect(containedSelection?.id).toBe(selectionCompositionId);
      expect(containedSelection?.meta?.tag?.[0]?.system).toBe('urn:research:tag:score');
      expect(containedSelection?.meta?.tag?.[0]?.code).toBe('10');
    } finally {
      queueAdapter.stop();
    }
  });

  // Journey: 1. ingest one veterinary document for an animal; 2. project it
  // under explicit research consent; 3. discover its ResearchSubject; 4.
  // materialize R4 and claims-first summaries.
  // Authorization invariant: only the consented pseudonymous animal subject is
  // materialized. Persistence invariant: exact codes survive; untrusted source
  // display/text and private search fields never surface. Retrospective
  // terminology reconciliation after consent enablement remains separate.
  it('materializes a veterinary digital twin through Communication -> ResearchSubject/$summary', async () => {
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
    process.env.DEMO_ALLOW_INSECURE_BEARER = 'true';

    resetServerConfig();

    const { app, queueAdapter, tenantManager, vaultRepository, kmsService } = await startServer({ listen: false });
    try {
      const hostBootstrapClaims = {
        [ClaimsOrganizationSchemaorg.addressCountry]: process.env.ORG_HOST_JURISDICTION,
        [ClaimsOrganizationSchemaorg.identifierType]: process.env.ORG_HOST_ID_TYPE,
        [ClaimsOrganizationSchemaorg.identifierValue]: process.env.ORG_HOST_ID_VALUE,
        [ClaimsServiceSchemaorg.category]: Sector.SYSTEM,
      };
      const hostCollectionName = resolveHostPhysicalCollectionName();
      const tenantClaims = testPayloadCreateTenant1.body.data[0].resource.meta.claims as any;
      const tenantVaultId = getTenantVaultId(tenantClaims[ClaimsServiceSchemaorg.category], testTenant1TenantId);

      const tenantConfig = {
        claims: tenantClaims,
        didConfig: { service: initializeTenantServicesConfig(Sector.HEALTH_CARE) },
        didDocument: { id: 'did:web:api.acme.org', '@context': 'https://www.w3.org/ns/did/v1' },
      };

      await kmsService.provisionKeys(tenantVaultId);
      const secureTenantRecord = await kmsService.protectConfidentialData(
        { id: tenantVaultId, sequence: 0, content: tenantConfig } as any,
        'host',
      );
      await vaultRepository.put(hostCollectionName, [secureTenantRecord as any], getEnvSectionId('tenants'));
      await tenantManager.getTenant(tenantVaultId);

      const subjectDid = 'did:web:api.acme.org:individual:twin-materialization-001';
      const ipsBundle = buildVeterinaryResearchSummaryFixture(subjectDid);
      const sourceMedication = ipsBundle.entry.find(
        (bundleEntry: any) => bundleEntry?.resource?.resourceType === ResourceTypesFhirR4.MedicationStatement,
      )?.resource;
      const sourceObservation = ipsBundle.entry.find(
        (bundleEntry: any) => bundleEntry?.resource?.resourceType === ResourceTypesFhirR4.Observation,
      )?.resource;
      const sourceMedicationCoding = sourceMedication?.medicationCodeableConcept?.coding?.[0];
      const sourceObservationCoding = sourceObservation?.code?.coding?.[0];
      const medicationCodeToken = `${sourceMedicationCoding.system}|${sourceMedicationCoding.code}`;
      const observationCodeToken = `${sourceObservationCoding.system}|${sourceObservationCoding.code}`;
      const documentReference = {
        resourceType: 'DocumentReference',
        id: 'animal-twin-materialization-document-reference-001',
        subject: { reference: subjectDid },
        date: '2026-06-26T10:00:00Z',
        description: 'Veterinary twin materialization source',
        identifier: [{ system: 'urn:ietf:rfc:3986', value: 'urn:uuid:animal-twin-materialization-document-reference-001' }],
        content: [
          {
            attachment: {
              contentType: 'application/fhir+json',
              title: 'veterinary-research-summary.json',
              data: Buffer.from(JSON.stringify(ipsBundle), 'utf8').toString('base64'),
            },
          },
        ],
      };

      const ingestResp = await invokeExpress(app, {
        method: 'POST',
        url: `/${testTenant1TenantId}/cds-ES/v1/health-care/individual/org.hl7.fhir.r4/Communication/_batch`,
        headers: { 'content-type': 'application/json', authorization: 'Bearer demo-token' },
        body: {
          thid: 'ips-twin-materialization-ingest-001',
          body: {
            resourceType: 'Bundle',
            type: 'batch',
            entry: [
              {
                request: { method: 'POST', url: 'individual/org.hl7.fhir.r4/Communication' },
                resource: {
                  resourceType: 'Communication',
                  status: 'completed',
                  subject: { reference: subjectDid },
                  sent: '2026-06-26T10:00:00Z',
                  payload: [
                    {
                      contentAttachment: {
                        contentType: 'application/fhir+json',
                        title: 'ips-document-reference.json',
                        data: Buffer.from(JSON.stringify(documentReference), 'utf8').toString('base64'),
                      },
                    },
                  ],
                },
              },
            ],
          },
        },
      });
      expect(ingestResp.status).toBe(202);

      for (let i = 0; i < 50; i++) {
        const pollResp = await invokeExpress(app, {
          method: 'POST',
          url: `/${testTenant1TenantId}/cds-ES/v1/health-care/individual/org.hl7.fhir.r4/Communication/_batch-response`,
          headers: { 'content-type': 'application/json' },
          body: { thid: 'ips-twin-materialization-ingest-001' },
        });
        if (pollResp.status === 200) break;
        await new Promise((r) => setTimeout(r, 50));
      }

      await submitConsentRuleAndPoll({
        app,
        tenantId: testTenant1TenantId,
        jurisdiction: 'ES',
        sector: 'health-care',
        format: 'org.hl7.fhir.r4',
        thid: 'ips-twin-materialization-explicit-permit-001',
        claims: buildDemoResearchPermitByRoleConsent({ subjectDid }),
      });

      const aliases = await vaultRepository.getContainersInSection<any>(tenantVaultId, getDigitalTwinSubjectAliasSectionId());
      const twinSubjectId = aliases.find((alias: any) =>
        alias.id === createHash('sha256').update(subjectDid).digest('hex'))?.twinSubjectId;

      const searchResp = await invokeExpress(app, {
        method: 'POST',
        url: `/${testTenant1TenantId}/cds-ES/v1/health-care/digitaltwin/org.hl7.fhir.r4/ResearchSubject/_search`,
        headers: { 'content-type': 'application/json', authorization: 'Bearer demo-token' },
        body: {
          thid: 'ips-twin-materialization-search-001',
          body: {
            resourceType: 'Parameters',
            parameter: [
              { name: 'section', valueString: HealthcareBasicSections.HistoryOfMedicationUse.attributeValue },
              { name: 'MedicationStatement.code', valueString: medicationCodeToken },
            ],
          },
        },
      });
      expect(searchResp.status).toBe(202);

      let searchPayload: any;
      for (let i = 0; i < 50; i++) {
        const pollResp = await invokeExpress(app, {
          method: 'POST',
          url: `/${testTenant1TenantId}/cds-ES/v1/health-care/digitaltwin/org.hl7.fhir.r4/ResearchSubject/_batch-response`,
          headers: { 'content-type': 'application/json' },
          body: { thid: 'ips-twin-materialization-search-001' },
        });
        if (pollResp.status === 200) {
          searchPayload = JSON.parse(pollResp.text);
          break;
        }
        await new Promise((r) => setTimeout(r, 50));
      }
      const matches = extractBundleSearchResources(searchPayload) as any[];
      expect(matches.length).toBeGreaterThanOrEqual(1);
      const matchedSubject = matches[0]?.contained?.find(
        (resource: any) => resource.resourceType === 'Composition',
      )?.subject?.reference;
      expect(matchedSubject).toBe(twinSubjectId);

      const r4MaterializeResp = await invokeExpress(app, {
        method: 'POST',
        url: `/${testTenant1TenantId}/cds-ES/v1/health-care/digitaltwin/org.hl7.fhir.r4/Communication/_batch`,
        headers: { 'content-type': 'application/json', authorization: 'Bearer demo-token' },
        body: {
          thid: 'ips-twin-materialization-r4-001',
          body: {
            resourceType: 'Bundle',
            type: 'batch',
            entry: [
              {
                request: { method: 'POST', url: 'digitaltwin/org.hl7.fhir.r4/Communication' },
                resource: {
                  resourceType: 'Communication',
                  status: 'completed',
                  subject: { reference: twinSubjectId },
                  sent: '2026-06-26T11:00:00Z',
                  payload: [
                    {
                      contentReference: {
                        reference: `digitaltwin/org.hl7.fhir.r4/ResearchSubject/$summary?subject=${encodeURIComponent(twinSubjectId)}`,
                      },
                    },
                  ],
                },
              },
            ],
          },
        },
      });
      expect(r4MaterializeResp.status).toBe(202);

      let r4Payload: any;
      for (let i = 0; i < 50; i++) {
        const pollResp = await invokeExpress(app, {
          method: 'POST',
          url: `/${testTenant1TenantId}/cds-ES/v1/health-care/digitaltwin/org.hl7.fhir.r4/Communication/_batch-response`,
          headers: { 'content-type': 'application/json' },
          body: { thid: 'ips-twin-materialization-r4-001' },
        });
        if (pollResp.status === 200) {
          r4Payload = JSON.parse(pollResp.text);
          break;
        }
        await new Promise((r) => setTimeout(r, 50));
      }

      expect(r4Payload?.data?.[0]?.type).toBe('Bundle-summary-response-v1.0');
      expect(r4Payload?.data?.[0]?.resource?.resourceType).toBe('Bundle');
      expect(r4Payload?.data?.[0]?.resource?.type).toBe('document');
      expect(r4Payload?.data?.[0]?.resource?.entry?.[0]?.fullUrl).toMatch(/^urn:uuid:/);
      expect(r4Payload?.data?.[0]?.resource?.entry?.[0]?.resource?.resourceType).toBe('Composition');
      expect(
        r4Payload?.data?.[0]?.resource?.entry?.some((entry: any) => entry?.resource?.resourceType === 'MedicationStatement'),
      ).toBe(true);
      expect(
        r4Payload?.data?.[0]?.resource?.entry?.some((entry: any) => entry?.resource?.resourceType === 'Observation'),
      ).toBe(true);
      const r4Medication = r4Payload?.data?.[0]?.resource?.entry
        ?.map((entry: any) => entry?.resource)
        .find((resource: any) => resource?.resourceType === ResourceTypesFhirR4.MedicationStatement);
      const r4Observation = r4Payload?.data?.[0]?.resource?.entry
        ?.map((entry: any) => entry?.resource)
        .find((resource: any) => resource?.resourceType === ResourceTypesFhirR4.Observation);
      expect(r4Medication?.medicationCodeableConcept).toEqual({
        coding: [{
          system: sourceMedicationCoding.system,
          code: sourceMedicationCoding.code,
          userSelected: sourceMedicationCoding.userSelected,
        }],
      });
      expect(r4Observation?.code).toEqual({
        coding: [{
          system: sourceObservationCoding.system,
          code: sourceObservationCoding.code,
          userSelected: sourceObservationCoding.userSelected,
        }],
      });

      const apiMaterializeResp = await invokeExpress(app, {
        method: 'POST',
        url: `/${testTenant1TenantId}/cds-ES/v1/health-care/digitaltwin/org.hl7.fhir.api/Communication/_batch`,
        headers: { 'content-type': 'application/json', authorization: 'Bearer demo-token' },
        body: {
          thid: 'ips-twin-materialization-api-001',
          body: {
            resourceType: 'Bundle',
            type: 'batch',
            entry: [
              {
                request: { method: 'POST', url: 'digitaltwin/org.hl7.fhir.api/Communication' },
                resource: {
                  resourceType: 'Communication',
                  id: 'ips-twin-materialization-api-request',
                  meta: {
                    claims: {
                      '@context': 'org.hl7.fhir.api',
                      [CommunicationClaim.Status]: 'completed',
                      [CommunicationClaim.Subject]: twinSubjectId,
                      [CommunicationClaim.Sent]: '2026-06-26T11:05:00Z',
                      [CommunicationClaim.ContentReference]: 'digitaltwin/org.hl7.fhir.api/ResearchSubject/$summary',
                      [CommunicationClaim.ContentAttachmentType]: 'application/fhir+json',
                      [CommunicationClaim.ContentAttachmentData]: Buffer.from(JSON.stringify({
                        resourceType: 'Parameters',
                        parameter: [
                          { name: 'subject', valueString: twinSubjectId },
                          {
                            name: 'section',
                            valueString: HealthcareBasicSections.HistoryOfMedicationUse.attributeValue,
                          },
                          {
                            name: 'section',
                            valueString: HealthcareBasicSections.VitalSigns.attributeValue,
                          },
                        ],
                      }), 'utf8').toString('base64'),
                    },
                  },
                },
              },
            ],
          },
        },
      });
      expect(apiMaterializeResp.status).toBe(202);

      let apiPayload: any;
      for (let i = 0; i < 50; i++) {
        const pollResp = await invokeExpress(app, {
          method: 'POST',
          url: `/${testTenant1TenantId}/cds-ES/v1/health-care/digitaltwin/org.hl7.fhir.api/Communication/_batch-response`,
          headers: { 'content-type': 'application/json' },
          body: { thid: 'ips-twin-materialization-api-001' },
        });
        if (pollResp.status === 200) {
          apiPayload = JSON.parse(pollResp.text);
          break;
        }
        await new Promise((r) => setTimeout(r, 50));
      }

      expect(apiPayload?.data?.[0]?.type).toBe('Bundle-summary-response-v1.0');
      expect(apiPayload?.data?.[0]?.resource?.resourceType).toBe('Bundle');
      expect(apiPayload?.data?.[0]?.resource?.entry?.[0]?.fullUrl).toMatch(/^urn:uuid:/);
      expect(apiPayload?.data?.[0]?.resource?.entry?.[0]?.resource?.section?.[0]?.entry?.length)
        .toBeGreaterThan(0);
      const apiMedication = apiPayload?.data?.[0]?.resource?.entry
        ?.find((entry: any) => entry?.resource?.resourceType === ResourceTypesFhirR4.MedicationStatement)
        ?.resource;
      const apiObservation = apiPayload?.data?.[0]?.resource?.entry
        ?.find((entry: any) => entry?.resource?.resourceType === ResourceTypesFhirR4.Observation)
        ?.resource;
      expect(apiMedication?.meta?.claims).toMatchObject({
        'MedicationStatement.code': medicationCodeToken,
      });
      expect(apiMedication?.meta?.claims).not.toHaveProperty('MedicationStatement.code-display');
      expect(apiMedication?.meta?.claims).not.toHaveProperty('MedicationStatement.code-text');
      expect(apiObservation?.meta?.claims).toMatchObject({
        'Observation.code': observationCodeToken,
      });
      expect(apiObservation?.meta?.claims).not.toHaveProperty('Observation.code-display');
      expect(apiObservation?.meta?.claims).not.toHaveProperty('Observation.code-text');
      for (const materializedResource of [apiMedication, apiObservation]) {
        expect(materializedResource?.meta?.claims).not.toHaveProperty('indexed');
        expect(JSON.stringify(materializedResource)).not.toContain('__digitalTwinSearch');
      }
      const apiMedicationEntry = apiPayload?.data?.[0]?.resource?.entry
        ?.find((entry: any) => entry?.resource?.resourceType === 'MedicationStatement');
      expect(Object.keys(apiMedicationEntry.resource).sort()).toEqual(['id', 'meta', 'resourceType']);
      expect(apiMedicationEntry.resource.meta.claims).toBeDefined();
      expect(apiMedicationEntry.resource.meta.claims['MedicationStatement.subject']).toBe(twinSubjectId);
    } finally {
      queueAdapter.stop();
    }
  });
});
