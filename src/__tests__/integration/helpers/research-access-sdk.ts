// Flow contract: reuse shared test fixtures and canonical types; do not introduce duplicated literals.
import { readFileSync } from 'fs';
import path from 'path';
import { HealthcareBasicSections } from 'gdc-common-utils-ts/constants/index';
import { CompositionAttesterModes } from 'gdc-common-utils-ts';
import { EXAMPLE_KYC_CONTROLLER_UUID } from 'gdc-common-utils-ts/examples/shared';
import { ServiceCapability } from 'gdc-common-utils-ts/constants/service-capabilities';
import { ClaimsOrganizationSchemaorg, ClaimsServiceSchemaorg } from 'gdc-common-utils-ts/constants/schemaorg';
import { ClaimConsent } from 'gdc-common-utils-ts/models/consent-rule';
import { Sector } from 'gdc-common-utils-ts/models/urlPath';
import {
  EXAMPLE_INTER_TENANT_ACCESS_CONTRACT_CONTEXT,
  EXAMPLE_INTER_TENANT_ACCESS_CONTRACT_CONSUMER_PROFESSIONAL_DID,
} from 'gdc-common-utils-ts/examples/inter-tenant-access-contract';
import {
  buildDemoResearchPermitByEmailConsent,
  buildDemoResearchPermitByRoleConsent,
  buildDemoResearchRequesterMatrix,
  buildDemoResearchContractVpToken,
  buildDemoResearchSmartTokenRequest,
} from '../../data/demo-smart-access-local-network.data';
import { initializeTenantServicesConfig } from '../../../utils/services';
import { getIndividualSectionId } from '../../../utils/individual-sections';
import { getEnvSectionId } from '../../../utils/section-env';
import { getTenantVaultId } from '../../../utils/tenant';
import { resolveHostPhysicalCollectionName } from '../../../config/storage-layout';
import { invokeExpress } from './invokeExpress';
import { testPayloadCreateTenant1 } from '../../data/end-to-end.data';
import {
  buildDemoCommunicationBatchSubmitRequest,
  demoCommunicationMedicationIpsDefaults,
} from '../../data/demo-communication-medications-ips.data';
import { testTenant1AlternateName } from '../../data/organization.data';
import { submitConsentRuleAndPoll } from './consent-flow';

/**
 * Shared opaque ids used by the didactic research-access integration flow.
 *
 * Keeping these values together avoids inline literals inside the conversation
 * test and makes the high-level steps easier to read.
 */
export const RESEARCH_ACCESS_TEST_IDS = Object.freeze({
  providerTenantRegistration: 'research-access-provider-tenant-001',
  consumerTenantRegistration: 'research-access-consumer-tenant-001',
  subjectPermitRule: 'research-access-subject-permit-001',
  communicationThreadId: 'research-access-communication-001',
  smartTokenThreadId: 'research-access-smart-token-001',
  compositionSearchThreadId: 'research-access-composition-search-001',
  documentReferenceId: 'research-access-document-reference-001',
  documentReferenceIdentifier: 'urn:uuid:research-access-document-reference-001',
  deviceDid: 'did:web:device.lab.example',
  doraemonSubjectDid: EXAMPLE_INTER_TENANT_ACCESS_CONTRACT_CONTEXT.subjectDid,
  novitaSubjectDid: 'did:web:api.acme.org:individual:novita',
  emailOnlyPermitSubjectDid: 'did:web:api.acme.org:individual:email-only',
});

function getResearchAccessMedicationCode(): string {
  const bundle = loadResearchIpsAllSectionsFixture(RESEARCH_ACCESS_TEST_IDS.doraemonSubjectDid);
  const medication = bundle.entry
    ?.map((entry: any) => entry?.resource)
    .find((resource: any) => resource?.resourceType === 'MedicationStatement');
  const coding = medication?.medicationCodeableConcept?.coding?.[0];
  if (!coding?.system || !coding?.code) {
    throw new Error('The shared IPS fixture must expose one canonical MedicationStatement system|code.');
  }
  return `${coding.system}|${coding.code}`;
}

/**
 * Search fixture consumed by the digital-twin search facade.
 *
 * The section and canonical medication token are read from the IPS all-sections
 * fixture already proven in the composition search integration suite. Caller
 * display text is deliberately not treated as trusted research terminology.
 */
export const RESEARCH_ACCESS_SEARCH_FIXTURE = Object.freeze({
  section: HealthcareBasicSections.HistoryOfMedicationUse.attributeValue,
  text: getResearchAccessMedicationCode(),
});

/**
 * Canonical demo medication search cases reused by the research-access
 * conversation test.
 */
export const RESEARCH_ACCESS_DEMO_MEDICATION_CASES = Object.freeze({
  ibuprofen: Object.freeze({
    caseIndex: 0,
    searchText: demoCommunicationMedicationIpsDefaults.demoMedicationCases[0].demoMedicationCode,
  }),
  paracetamol: Object.freeze({
    caseIndex: 1,
    searchText: demoCommunicationMedicationIpsDefaults.demoMedicationCases[1].demoMedicationCode,
  }),
});

export const RESEARCH_ACCESS_REQUESTER_MATRIX = Object.freeze(buildDemoResearchRequesterMatrix());

/**
 * Minimal runtime dependencies from `startServer()` that the high-level test
 * facades need in order to orchestrate GW in memory.
 */
export type ResearchAccessGatewayDeps = {
  app: any;
  tenantManager: any;
  vaultRepository: any;
  kmsService: any;
};

/**
 * Polls a GW accepted operation until the batch/token response becomes
 * available.
 */
export async function pollAcceptedGatewayOperation(input: {
  app: any;
  url: string;
  thid: string;
}): Promise<any> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const pollResp = await invokeExpress(input.app, {
      method: 'POST',
      url: input.url,
      headers: { 'content-type': 'application/json' },
      body: { thid: input.thid },
    });
    if (pollResp.status === 200) {
      return JSON.parse(pollResp.text);
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return undefined;
}

/**
 * Loads the official HL7 IPS all-sections fixture and rewrites the patient
 * references to the requested research subject DID.
 */
export function loadResearchIpsAllSectionsFixture(subjectDid: string): any {
  const fixturePath = path.join(process.cwd(), 'node_modules', 'gdc-common-utils-ts', 'fixtures', 'fhir-ips-bundle-all-sections.json');
  const bundle = JSON.parse(readFileSync(fixturePath, 'utf8'));
  for (const entry of Array.isArray(bundle?.entry) ? bundle.entry : []) {
    const resource = entry?.resource;
    if (!resource || typeof resource !== 'object') continue;

    if (resource.resourceType === 'Composition') {
      resource.author = [{ reference: demoCommunicationMedicationIpsDefaults.externalAuthorUrn }];
      resource.attester = [{
        mode: CompositionAttesterModes.Professional,
        party: { reference: `urn:uuid:${EXAMPLE_KYC_CONTROLLER_UUID}` },
      }];
    }

    if (resource?.subject?.reference) {
      resource.subject.reference = subjectDid;
    }
    if (resource?.patient?.reference) {
      resource.patient.reference = subjectDid;
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

function buildLabTenantClaims(): Record<string, unknown> {
  const baseClaims = {
    ...(testPayloadCreateTenant1.body.data[0].resource.meta.claims as Record<string, unknown>),
  };
  return {
    ...baseClaims,
    [ClaimsOrganizationSchemaorg.legalName]: 'Lab Research Org SL',
    [ClaimsOrganizationSchemaorg.name]: 'Lab Research Org',
    [ClaimsOrganizationSchemaorg.alternateName]: EXAMPLE_INTER_TENANT_ACCESS_CONTRACT_CONTEXT.consumerTenantId,
    [ClaimsOrganizationSchemaorg.identifierValue]: EXAMPLE_INTER_TENANT_ACCESS_CONTRACT_CONTEXT.consumerTenantId,
    [ClaimsOrganizationSchemaorg.url]: 'api.lab.org',
    [ClaimsServiceSchemaorg.category]: 'health-research',
  };
}

function buildHostCollectionName(): string {
  return resolveHostPhysicalCollectionName();
}

/**
 * Test-only facade that mirrors the high-level responsibilities expected from
 * an organization-controller SDK:
 * - bootstrap provider/consumer hosted tenants
 * - ingest provider subject data
 * - define the subject-side permit rule
 * - materialize the inter-tenant contract proof presented later to SMART
 *
 * Smart-contract persistence, ledger anchoring, and other internal plumbing
 * still belong to GW. The facade only drives the externally visible flow.
 */
export class TestResearchOrgControllerSdk {
  constructor(
    private readonly deps: ResearchAccessGatewayDeps,
    private readonly authorizationHeader: string,
  ) {}

  /**
   * Registers the provider tenant (`acme`) directly in the in-memory host
   * registry used by the integration suite.
   */
  public async registerProviderTenant(): Promise<void> {
    const providerClaims = testPayloadCreateTenant1.body.data[0].resource.meta.claims as Record<string, unknown>;
    await this.registerHostedTenant({
      claims: providerClaims,
      didDocumentId: EXAMPLE_INTER_TENANT_ACCESS_CONTRACT_CONTEXT.providerOrganizationDid,
      sector: Sector.HEALTH_CARE,
    });
  }

  /**
   * Registers the consumer tenant (`lab`) directly in the in-memory host
   * registry used by the integration suite.
   */
  public async registerConsumerResearchTenant(): Promise<void> {
    await this.registerHostedTenant({
      claims: buildLabTenantClaims(),
      didDocumentId: EXAMPLE_INTER_TENANT_ACCESS_CONTRACT_CONTEXT.consumerOrganizationDid,
      sector: 'health-research' as Sector,
    });
  }

  /**
   * Seeds the provider-side subject access rule that allows the foreign
   * research organization to request a SMART token for the configured section.
   */
  public async grantResearchPermitForSubject(): Promise<void> {
    await this.grantResearchPermitForSubjects([
      RESEARCH_ACCESS_TEST_IDS.doraemonSubjectDid,
      RESEARCH_ACCESS_TEST_IDS.novitaSubjectDid,
    ]);
  }

  /**
   * Seeds provider-side permit rules for the requested subjects so the foreign
   * research organization can request access over each digital twin.
   */
  public async grantResearchPermitForSubjects(subjectDids: readonly string[]): Promise<void> {
    await Promise.all(subjectDids.map(async (subjectDid, index) => {
      await submitConsentRuleAndPoll({
        app: this.deps.app,
        tenantId: EXAMPLE_INTER_TENANT_ACCESS_CONTRACT_CONTEXT.providerTenantId,
        jurisdiction: 'ES',
        sector: String(Sector.HEALTH_CARE),
        format: 'org.hl7.fhir.api',
        thid: `${RESEARCH_ACCESS_TEST_IDS.subjectPermitRule}-${index + 1}`,
        authorization: this.authorizationHeader,
        claims: buildDemoResearchPermitByRoleConsent({ subjectDid }),
      });
    }));
  }

  /**
   * Seeds provider-side permit rules whose role constraint is evaluated against
   * the requester employee.
   */
  public async grantResearchPermitByRoleForSubjects(subjectDids: readonly string[]): Promise<void> {
    const providerVaultId = getTenantVaultId(
      String(Sector.HEALTH_CARE),
      EXAMPLE_INTER_TENANT_ACCESS_CONTRACT_CONTEXT.providerTenantId,
    );
    await Promise.all(subjectDids.map(async (subjectDid, index) => {
      await this.deps.vaultRepository.put(
        providerVaultId,
        [{
          ...buildDemoResearchPermitByRoleConsent({ subjectDid }),
          id: `${RESEARCH_ACCESS_TEST_IDS.subjectPermitRule}-role-${index + 1}`,
          [ClaimConsent.identifier]: `urn:uuid:${RESEARCH_ACCESS_TEST_IDS.subjectPermitRule}-role-${index + 1}`,
        }],
        getIndividualSectionId(subjectDid, 'rules'),
      );
    }));
  }

  /**
   * Seeds provider-side permit rules that directly target one allowed research
   * employee email.
   */
  public async grantResearchPermitByDirectEmailForSubjects(subjectDids: readonly string[]): Promise<void> {
    const providerVaultId = getTenantVaultId(
      String(Sector.HEALTH_CARE),
      EXAMPLE_INTER_TENANT_ACCESS_CONTRACT_CONTEXT.providerTenantId,
    );
    await Promise.all(subjectDids.map(async (subjectDid, index) => {
      await this.deps.vaultRepository.put(
        providerVaultId,
        [{
          ...buildDemoResearchPermitByEmailConsent({ subjectDid }),
          id: `${RESEARCH_ACCESS_TEST_IDS.subjectPermitRule}-email-${index + 1}`,
          [ClaimConsent.identifier]: `urn:uuid:${RESEARCH_ACCESS_TEST_IDS.subjectPermitRule}-email-${index + 1}`,
        }],
        getIndividualSectionId(subjectDid, 'rules'),
      );
    }));
  }

  /**
   * Ingests the shared IPS fixture through the same Communication flow used by
   * the rest of GW integration coverage so the digital-twin projections are
   * created by real backend processing.
   */
  public async ingestProviderIpsFixture(): Promise<any> {
    const ipsBundle = loadResearchIpsAllSectionsFixture(RESEARCH_ACCESS_TEST_IDS.doraemonSubjectDid);
    const documentReference = {
      resourceType: 'DocumentReference',
      id: RESEARCH_ACCESS_TEST_IDS.documentReferenceId,
      subject: { reference: RESEARCH_ACCESS_TEST_IDS.doraemonSubjectDid },
      date: '2026-06-29T10:00:00Z',
      description: 'Research access IPS fixture',
      identifier: [{ system: 'urn:ietf:rfc:3986', value: RESEARCH_ACCESS_TEST_IDS.documentReferenceIdentifier }],
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

    const submitResp = await invokeExpress(this.deps.app, {
      method: 'POST',
      url: `/${testTenant1AlternateName}/cds-ES/v1/health-care/individual/org.hl7.fhir.r4/Communication/_batch`,
      headers: { 'content-type': 'application/json', authorization: this.authorizationHeader },
      body: {
        thid: RESEARCH_ACCESS_TEST_IDS.communicationThreadId,
        body: {
          resourceType: 'Bundle',
          type: 'batch',
          entry: [
            {
              request: { method: 'POST', url: 'individual/org.hl7.fhir.r4/Communication' },
              resource: {
                resourceType: 'Communication',
                status: 'completed',
                subject: { reference: RESEARCH_ACCESS_TEST_IDS.doraemonSubjectDid },
                sent: '2026-06-29T10:00:00Z',
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

    if (submitResp.status !== 202) {
      return undefined;
    }

    return pollAcceptedGatewayOperation({
      app: this.deps.app,
      url: `/${testTenant1AlternateName}/cds-ES/v1/health-care/individual/org.hl7.fhir.r4/Communication/_batch-response`,
      thid: RESEARCH_ACCESS_TEST_IDS.communicationThreadId,
    });
  }

  /**
   * Ingests one medication-only IPS demo bundle for `Novita`, reusing the
   * shared Ibuprofen/Paracetamol fixture builders already covered elsewhere.
   */
  public async ingestNovitaMedicationFixture(input: {
    thidComm: string;
    thidMedSearch: string;
    thidIpsSearch: string;
    medicationCaseIndex: number;
  }): Promise<any> {
    const request = buildDemoCommunicationBatchSubmitRequest({
      ...demoCommunicationMedicationIpsDefaults,
      subjectId: RESEARCH_ACCESS_TEST_IDS.novitaSubjectDid as typeof demoCommunicationMedicationIpsDefaults.subjectId,
      ...input,
    });

    const submitResp = await invokeExpress(this.deps.app, {
      method: 'POST',
      url: `/${testTenant1AlternateName}/cds-ES/v1/health-care/individual/org.hl7.fhir.r4/Communication/_batch`,
      headers: { 'content-type': 'application/json', authorization: this.authorizationHeader },
      body: request,
    });

    if (submitResp.status !== 202) {
      return undefined;
    }

    return pollAcceptedGatewayOperation({
      app: this.deps.app,
      url: `/${testTenant1AlternateName}/cds-ES/v1/health-care/individual/org.hl7.fhir.r4/Communication/_batch-response`,
      thid: input.thidComm,
    });
  }

  /**
   * Builds the VP token that carries the inter-tenant contract VC.
   *
   * This is the proof later consumed by the SMART token endpoint. The contract
   * VC shape itself comes from `gdc-common-utils-ts`.
   */
  public buildResearchAccessContractVpToken(): string {
    return buildDemoResearchContractVpToken({
      tenantId: EXAMPLE_INTER_TENANT_ACCESS_CONTRACT_CONTEXT.providerTenantId,
      subjectDid: RESEARCH_ACCESS_TEST_IDS.doraemonSubjectDid,
      actorDid: EXAMPLE_INTER_TENANT_ACCESS_CONTRACT_CONSUMER_PROFESSIONAL_DID,
    });
  }

  private async registerHostedTenant(input: {
    claims: Record<string, unknown>;
    didDocumentId: string;
    sector: Sector;
  }): Promise<void> {
    const tenantId = String(input.claims[ClaimsOrganizationSchemaorg.alternateName] || '');
    const tenantVaultId = getTenantVaultId(String(input.sector), tenantId);
    await this.deps.kmsService.provisionKeys(tenantVaultId);
    const secureTenantRecord = await this.deps.kmsService.protectConfidentialData(
      {
        id: tenantVaultId,
        sequence: 0,
        content: {
          claims: input.claims,
          didConfig: { service: initializeTenantServicesConfig(input.sector) },
          didDocument: {
            id: input.didDocumentId,
            '@context': 'https://www.w3.org/ns/did/v1',
          },
        },
      },
      'host',
    );
    await this.deps.vaultRepository.put(
      buildHostCollectionName(),
      [secureTenantRecord],
      getEnvSectionId('tenants'),
    );
    await this.deps.tenantManager.getTenant(tenantVaultId);
  }
}

/**
 * Test-only facade that mirrors the high-level responsibilities expected from
 * a future `digitalTwinSdk`:
 * - obtain a SMART access token using the research contract proof
 * - search `digitaltwin/.../ResearchSubject/_search`; claims-first results mix
 *   ResearchSubject and Composition claims, while strict FHIR results carry
 *   the translated Composition in `ResearchSubject.contained[]`
 * - consume the asynchronous bundle-response contract
 */
export class TestResearchDigitalTwinSdk {
  constructor(
    private readonly deps: Pick<ResearchAccessGatewayDeps, 'app'>,
    private readonly authorizationHeader: string,
  ) {}

  /**
   * Requests a SMART token for the foreign `lab` member using the VP that
   * carries the inter-tenant contract VC.
   */
  public async requestResearchSmartAccessToken(vpToken: string): Promise<any> {
    const submitResp = await invokeExpress(this.deps.app, {
      method: 'POST',
      url: `/${testTenant1AlternateName}/cds-ES/v1/health-care/identity/openid/smart/token`,
      headers: { 'content-type': 'application/json', authorization: this.authorizationHeader },
      body: {
        thid: RESEARCH_ACCESS_TEST_IDS.smartTokenThreadId,
        iss: RESEARCH_ACCESS_TEST_IDS.deviceDid,
        aud: EXAMPLE_INTER_TENANT_ACCESS_CONTRACT_CONTEXT.providerOrganizationDid,
        body: {
          sub: EXAMPLE_INTER_TENANT_ACCESS_CONTRACT_CONSUMER_PROFESSIONAL_DID,
          purpose: EXAMPLE_INTER_TENANT_ACCESS_CONTRACT_CONTEXT.purpose,
          scope: `${ServiceCapability.DigitalTwinReader}?subject=${encodeURIComponent(RESEARCH_ACCESS_TEST_IDS.doraemonSubjectDid)}`,
          expires_in: 60,
          vp_token: vpToken,
          acr_values: 'urn:antifraud:acr:openid4vp:employee',
        },
      },
    });

    if (submitResp.status !== 202) {
      return undefined;
    }

    return pollAcceptedGatewayOperation({
      app: this.deps.app,
      url: `/${testTenant1AlternateName}/cds-ES/v1/health-care/identity/openid/smart/_batch-response`,
      thid: RESEARCH_ACCESS_TEST_IDS.smartTokenThreadId,
    });
  }

  /**
   * Requests one SMART token for the selected research employee variant using
   * the shared request builder.
   */
  public async requestResearchSmartAccessTokenForRequester(input: {
    subjectDid: string;
    actorDid: string;
    actorEmail: string;
    actorRole: string;
    clientSuffix: string;
    thid: string;
  }): Promise<any> {
    const requestPayload = await buildDemoResearchSmartTokenRequest({
      tenantId: EXAMPLE_INTER_TENANT_ACCESS_CONTRACT_CONTEXT.providerTenantId,
      subjectDid: input.subjectDid,
      actorDid: input.actorDid,
      actorEmail: input.actorEmail,
      actorRole: input.actorRole,
      clientSuffix: input.clientSuffix,
      thid: input.thid,
    });

    const submitResp = await invokeExpress(this.deps.app, {
      method: 'POST',
      url: `/${testTenant1AlternateName}/cds-ES/v1/health-care/identity/openid/smart/token`,
      headers: { 'content-type': 'application/json', authorization: this.authorizationHeader },
      body: requestPayload,
    });

    if (submitResp.status !== 202) {
      return undefined;
    }

    return pollAcceptedGatewayOperation({
      app: this.deps.app,
      url: `/${testTenant1AlternateName}/cds-ES/v1/health-care/identity/openid/smart/_batch-response`,
      thid: input.thid,
    });
  }

  /**
   * Searches public ResearchSubjects by medication display text.
   */
  public async searchMedicationTwinsByText(accessToken: string): Promise<any> {
    return this.searchMedicationTwinsByTextValue(accessToken, RESEARCH_ACCESS_SEARCH_FIXTURE.text);
  }

  /**
   * Searches through the resources joined by each ResearchSubject Composition.
   */
  public async searchMedicationTwinsByTextValue(
    accessToken: string,
    text: string,
  ): Promise<any> {
    const searchThreadId = `${RESEARCH_ACCESS_TEST_IDS.compositionSearchThreadId}-${String(text || '').toLowerCase()}`;
    const submitResp = await invokeExpress(this.deps.app, {
      method: 'POST',
      url: `/${testTenant1AlternateName}/cds-ES/v1/health-care/digitaltwin/org.hl7.fhir.api/ResearchSubject/_search`,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${accessToken}` },
      body: {
        thid: searchThreadId,
        body: {
          resourceType: 'Parameters',
          parameter: [
            { name: 'section', valueString: RESEARCH_ACCESS_SEARCH_FIXTURE.section },
            { name: 'date-from', valueDate: '2000-01-01' },
            { name: 'text', valueString: text },
          ],
        },
      },
    });

    if (submitResp.status !== 202) {
      return undefined;
    }

    return pollAcceptedGatewayOperation({
      app: this.deps.app,
      url: `/${testTenant1AlternateName}/cds-ES/v1/health-care/digitaltwin/org.hl7.fhir.api/ResearchSubject/_batch-response`,
      thid: searchThreadId,
    });
  }
}
