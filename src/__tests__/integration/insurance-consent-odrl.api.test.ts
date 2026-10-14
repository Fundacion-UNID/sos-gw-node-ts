// Flow contract: reuse shared test fixtures and canonical types; do not introduce duplicated literals.
import { resolveHostPhysicalCollectionName } from '../../config/storage-layout';
/**
 * 1. An animal-insurance tenant receives one controller-approved claims-first Consent.
 * 2. The real HTTP queue and worker validate its attached ODRL before persistence.
 * 3. A second request tampers with the grantee claim while retaining the original ODRL.
 * 4. Polling reaches a failed terminal result and the protected rule count does not change.
 *
 * Authorization invariant: an InsurancePlan requirement never grants access; exact Consent plus matching ODRL does.
 * Persistence invariant: divergent ODRL/claims write neither a rule nor an attachment.
 */
import { afterEach, expect, it } from '@jest/globals';
import {
  ClaimsOrganizationSchemaorg,
  ClaimsServiceSchemaorg,
} from 'gdc-common-utils-ts/constants/schemaorg';
import { DataspaceSectors } from 'gdc-common-utils-ts/constants/sectors';
import { ClaimConsent } from 'gdc-common-utils-ts/models/consent-rule';
import { knownDomainsReversedEnum, type Sector } from 'gdc-common-utils-ts/models/urlPath';
import {
  ANIMAL_INSURANCE_CONSENT_TEST_DATA,
  ANIMAL_INSURANCE_CONSENT_TEST_INPUT,
  buildAnimalInsuranceEligibilityConsent,
} from 'vet-data-utils-ts/insurance-consent';
import { resetServerConfig, startServer } from '../../server';
import { getEnvSectionId } from '../../utils/section-env';
import { getIndividualSectionId } from '../../utils/individual-sections';
import { initializeTenantServicesConfig } from '../../utils/services';
import { generateTenantCollectionNameFromClaims, getTenantVaultId } from '../../utils/tenant';
import { testPayloadCreateTenant1 } from '../data/end-to-end.data';
import { configureAuthenticatedTestActor } from './helpers/authenticated-test-actor';
import { submitConsentRuleAndPoll } from './helpers/consent-flow';

const T = ANIMAL_INSURANCE_CONSENT_TEST_DATA;
const tenantId = T.managerReference.split('/').at(-1) as string;
const jurisdiction = T.jurisdiction;

afterEach(() => resetServerConfig());

it('fails closed through the HTTP queue when an insurance Consent claim diverges from ODRL', async () => {
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
    const tenantClaims = {
      ...(testPayloadCreateTenant1.body.data[0].resource.meta.claims as Record<string, unknown>),
      [ClaimsOrganizationSchemaorg.alternateName]: tenantId,
      [ClaimsOrganizationSchemaorg.addressCountry]: jurisdiction,
      [ClaimsServiceSchemaorg.category]: DataspaceSectors.AnimalInsurance,
    };
    const tenantVaultId = getTenantVaultId(DataspaceSectors.AnimalInsurance, tenantId);
    await kmsService.provisionKeys(tenantVaultId);
    const protectedTenant = await kmsService.protectConfidentialData({
      id: tenantVaultId,
      status: 'active',
      sequence: 0,
      content: {
        claims: tenantClaims,
        didConfig: { service: initializeTenantServicesConfig(DataspaceSectors.AnimalInsurance as Sector) },
        didDocument: {
          '@context': 'https://www.w3.org/ns/did/v1',
          id: 'did:web:animal-insurer.integration.example',
          controller: [authenticatedActor.actorDid],
        },
      },
    } as any, 'host');
    await vaultRepository.put(
      resolveHostPhysicalCollectionName(),
      [protectedTenant as any],
      getEnvSectionId('tenants'),
    );
    await tenantManager.getTenant(tenantVaultId);

    const consent = buildAnimalInsuranceEligibilityConsent(ANIMAL_INSURANCE_CONSENT_TEST_INPUT);
    const format = knownDomainsReversedEnum['org.hl7.fhir.r4'];
    await submitConsentRuleAndPoll({
      app,
      tenantId,
      jurisdiction,
      sector: DataspaceSectors.AnimalInsurance,
      format,
      thid: `${T.consentId}-valid`,
      authorization: authenticatedActor.authorizationHeader,
      claims: consent.meta.claims,
    });
    const rulesSection = getIndividualSectionId(T.subjectReference, 'rules');
    const attachmentsSection = getIndividualSectionId(T.subjectReference, 'attachments');
    const before = await vaultRepository.getContainersInSection(tenantVaultId, rulesSection);
    const attachmentsBefore = await vaultRepository.getContainersInSection(tenantVaultId, attachmentsSection);

    await expect(submitConsentRuleAndPoll({
      app,
      tenantId,
      jurisdiction,
      sector: DataspaceSectors.AnimalInsurance,
      format,
      thid: `${T.consentId}-divergent`,
      authorization: authenticatedActor.authorizationHeader,
      claims: {
        ...consent.meta.claims,
        [ClaimConsent.grantee]: T.divergentInsurerReference,
      },
    })).rejects.toThrow();
    const after = await vaultRepository.getContainersInSection(tenantVaultId, rulesSection);
    const attachmentsAfter = await vaultRepository.getContainersInSection(tenantVaultId, attachmentsSection);
    expect(after).toHaveLength(before.length);
    expect(attachmentsAfter).toHaveLength(attachmentsBefore.length);
  } finally {
    queueAdapter.stop();
  }
});

function configureEnvironment(): void {
  process.env.NODE_ENV = 'test';
  process.env.DB_PROVIDER = 'mem';
  process.env.STORAGE_PROVIDER = 'mem';
  process.env.QUEUE_PROVIDER = 'mem';
  process.env.SECTORS_ALLOWED = DataspaceSectors.AnimalInsurance;
  process.env.ORG_HOST_LEGAL_NAME = 'Gateway Host Services';
  process.env.ORG_HOST_JURISDICTION = jurisdiction;
  process.env.ORG_HOST_ID_TYPE = 'BN';
  process.env.ORG_HOST_ID_VALUE = '700000001';
  process.env.ORG_HOST_ADMIN_EMAIL = 'admin@host.example';
  process.env.ORG_HOST_ADMIN_UID = 'host-admin';
  process.env.ORG_HOST_ADMIN_ROLE = 'ISCO-08|1111';
  process.env.SECURITY_MODE = 'demo';
  process.env.JSON_LEGACY = 'true';
}
