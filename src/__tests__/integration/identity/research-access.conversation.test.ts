// Flow contract: reuse shared test fixtures and canonical types; do not introduce duplicated literals.
// A verified author ingests IPS data before a contract-authorized researcher discovers its pseudonymous twin.
import { startServer, resetServerConfig } from '../../../server';
import {
  EXAMPLE_INTER_TENANT_ACCESS_CONTRACT_CONTEXT,
} from 'gdc-common-utils-ts/examples/inter-tenant-access-contract';
import {
  RESEARCH_ACCESS_REQUESTER_MATRIX,
  RESEARCH_ACCESS_DEMO_MEDICATION_CASES,
  RESEARCH_ACCESS_TEST_IDS,
  TestResearchDigitalTwinSdk,
  TestResearchOrgControllerSdk,
} from '../helpers/research-access-sdk';
import { configureAuthenticatedTestActor } from '../helpers/authenticated-test-actor';
import { extractBundleSearchResources } from 'gdc-common-utils-ts/utils/organization-employee-lifecycle';

/**
 * Didactic end-to-end research access conversation.
 *
 * The flow intentionally reads like the future SDK choreography:
 * 1. an organization-controller facade prepares provider and consumer tenants
 * 2. the provider ingests one IPS for Doraemon and grants the consumer organization permit
 * 3. the provider ingests two medication-only fixtures for Novita
 * 3. the controller facade materializes the contract VC presentation
 * 4. a digital-twin facade asks GW for a SMART token with that proof
 * 5. the same digital-twin facade performs `ResearchSubject/_search`; the API
 *    form mixes ResearchSubject and Composition claims, and strict FHIR would
 *    carry the translated Composition in `ResearchSubject.contained[]`
 *
 * Internal smart-contract, queue, and policy plumbing stay inside GW.
 */
describe('Research access conversation (integration)', () => {
  afterEach(() => {
    resetServerConfig();
  });

  it('runs the orgControllerSdk-style and digitalTwinSdk-style flow end to end', async () => {
    process.env.NODE_ENV = 'test';
    process.env.DB_PROVIDER = 'mem';
    process.env.STORAGE_PROVIDER = 'mem';
    process.env.QUEUE_PROVIDER = 'mem';
    process.env.SECTORS_ALLOWED = 'health-care,health-research';
    process.env.ORG_HOST_LEGAL_NAME = 'Gateway Host Services';
    process.env.ORG_HOST_JURISDICTION = 'ES';
    process.env.ORG_HOST_ID_TYPE = 'TAX';
    process.env.ORG_HOST_ID_VALUE = 'A0011223344';
    process.env.ORG_HOST_ADMIN_EMAIL = 'admin@host.com';
    process.env.ORG_HOST_ADMIN_UID = 'host-admin-001';
    process.env.ORG_HOST_ADMIN_ROLE = 'ISCO-08|1111';
    process.env.SECURITY_MODE = 'demo';
    process.env.JSON_LEGACY = 'true';
    const authenticatedActor = await configureAuthenticatedTestActor();

    resetServerConfig();

    const gateway = await startServer({ listen: false });
    const organizationControllerSdk = new TestResearchOrgControllerSdk(
      gateway,
      authenticatedActor.authorizationHeader,
    );
    const digitalTwinSdk = new TestResearchDigitalTwinSdk(
      gateway,
      authenticatedActor.authorizationHeader,
    );

    try {
      await organizationControllerSdk.registerProviderTenant();
      await organizationControllerSdk.registerConsumerResearchTenant();
      await organizationControllerSdk.grantResearchPermitForSubject();

      const communicationPayload = await organizationControllerSdk.ingestProviderIpsFixture();
      expect(communicationPayload?.data?.[0]?.response?.status).toBe('200');
      const novitaIbuprofenPayload = await organizationControllerSdk.ingestNovitaMedicationFixture({
        thidComm: 'research-access-novita-ibuprofen-comm-001',
        thidMedSearch: 'research-access-novita-ibuprofen-med-search-001',
        thidIpsSearch: 'research-access-novita-ibuprofen-ips-search-001',
        medicationCaseIndex: RESEARCH_ACCESS_DEMO_MEDICATION_CASES.ibuprofen.caseIndex,
      });
      const novitaParacetamolPayload = await organizationControllerSdk.ingestNovitaMedicationFixture({
        thidComm: 'research-access-novita-paracetamol-comm-001',
        thidMedSearch: 'research-access-novita-paracetamol-med-search-001',
        thidIpsSearch: 'research-access-novita-paracetamol-ips-search-001',
        medicationCaseIndex: RESEARCH_ACCESS_DEMO_MEDICATION_CASES.paracetamol.caseIndex,
      });

      expect(novitaIbuprofenPayload?.data?.[0]?.response?.status).toBe('200');
      expect(novitaParacetamolPayload?.data?.[0]?.response?.status).toBe('200');

      // Authoring above uses the verified controller id_token. Subsequent
      // calls exercise a GW-issued SMART token, whose signature and scope are
      // independently covered by the SMART integration suite.
      process.env.DEMO_ALLOW_INSECURE_BEARER = 'true';

      const contractVpToken = organizationControllerSdk.buildResearchAccessContractVpToken();
      const smartTokenPayload = await digitalTwinSdk.requestResearchSmartAccessToken(contractVpToken);

      expect(smartTokenPayload?.access_token).toBeDefined();
      expect(smartTokenPayload?.subject).toMatch(/^urn:uuid:/);

      const researchSubjectSearchPayload = await digitalTwinSdk.searchMedicationTwinsByText(
        String(smartTokenPayload?.access_token || ''),
      );

      expect(researchSubjectSearchPayload?.resourceType).toBe('Bundle');
      expect(researchSubjectSearchPayload?.data?.[0]?.type).toBe('ResearchSubject-search-response-v1.0');
      const researchSubjects = extractBundleSearchResources(researchSubjectSearchPayload) as any[];
      expect(researchSubjects.length).toBeGreaterThanOrEqual(1);

      const firstMatch = researchSubjects[0];
      expect(firstMatch?.resourceType).toBe('ResearchSubject');
      expect(firstMatch?.meta?.claims?.['ResearchSubject.identifier']).toMatch(/^urn:uuid:/);
      expect(firstMatch?.meta?.claims?.['Composition.subject']).toMatch(/^urn:uuid:/);
      expect(firstMatch).not.toHaveProperty('composition');

      const novitaIbuprofenSearchPayload = await digitalTwinSdk.searchMedicationTwinsByTextValue(
        String(smartTokenPayload?.access_token || ''),
        RESEARCH_ACCESS_DEMO_MEDICATION_CASES.ibuprofen.searchText,
      );
      const novitaParacetamolSearchPayload = await digitalTwinSdk.searchMedicationTwinsByTextValue(
        String(smartTokenPayload?.access_token || ''),
        RESEARCH_ACCESS_DEMO_MEDICATION_CASES.paracetamol.searchText,
      );

      for (const payload of [novitaIbuprofenSearchPayload, novitaParacetamolSearchPayload]) {
        expect(payload?.resourceType).toBe('Bundle');
        expect(payload?.data?.[0]?.type).toBe('ResearchSubject-search-response-v1.0');
        const matches = extractBundleSearchResources(payload) as any[];
        expect(matches).toHaveLength(1);
        const onlyMatch = matches[0];
        expect(onlyMatch?.meta?.claims?.['ResearchSubject.identifier']).toMatch(/^urn:uuid:/);
        expect(onlyMatch?.meta?.claims?.['Composition.subject']).toMatch(/^urn:uuid:/);
        expect(onlyMatch).not.toHaveProperty('composition');
      }

      await organizationControllerSdk.grantResearchPermitByRoleForSubjects([
        RESEARCH_ACCESS_TEST_IDS.doraemonSubjectDid,
      ]);
      const roleAllowedPayload = await digitalTwinSdk.requestResearchSmartAccessTokenForRequester({
        subjectDid: RESEARCH_ACCESS_TEST_IDS.doraemonSubjectDid,
        ...RESEARCH_ACCESS_REQUESTER_MATRIX.allowByRole,
      });
      expect(roleAllowedPayload?.access_token).toBeDefined();

      const roleDeniedPayload = await digitalTwinSdk.requestResearchSmartAccessTokenForRequester({
        subjectDid: RESEARCH_ACCESS_TEST_IDS.doraemonSubjectDid,
        ...RESEARCH_ACCESS_REQUESTER_MATRIX.denyByRole,
      });
      expect(roleDeniedPayload?.access_token).toBeUndefined();

      await organizationControllerSdk.grantResearchPermitByDirectEmailForSubjects([
        RESEARCH_ACCESS_TEST_IDS.emailOnlyPermitSubjectDid,
      ]);
      const emailAllowedPayload = await digitalTwinSdk.requestResearchSmartAccessTokenForRequester({
        subjectDid: RESEARCH_ACCESS_TEST_IDS.emailOnlyPermitSubjectDid,
        ...RESEARCH_ACCESS_REQUESTER_MATRIX.allowByEmail,
      });
      expect(emailAllowedPayload?.access_token).toBeDefined();

      const emailDeniedPayload = await digitalTwinSdk.requestResearchSmartAccessTokenForRequester({
        subjectDid: RESEARCH_ACCESS_TEST_IDS.emailOnlyPermitSubjectDid,
        ...RESEARCH_ACCESS_REQUESTER_MATRIX.denyByEmail,
      });
      expect(emailDeniedPayload?.access_token).toBeUndefined();
    } finally {
      gateway.queueAdapter.stop();
    }
  });
});
