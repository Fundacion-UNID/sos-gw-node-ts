// Flow contract: reuse shared test fixtures and canonical types; do not introduce duplicated literals.
import { resolveHostPhysicalCollectionName } from '../../../config/storage-layout';
// SMART token issuance separates trusted individual self-read,
// same-tenant employee access and bilateral inter-tenant research access.

import { invokeExpress } from '../helpers/invokeExpress';
import { getTenantVaultId } from '../../../utils/tenant';
import { ClaimsOrganizationSchemaorg, ClaimsServiceSchemaorg } from 'gdc-common-utils-ts/constants/schemaorg';
import { testPayloadCreateTenant1 } from '../../data/end-to-end.data';
import { testConsentRulePermitOrgDid } from '../../data/consent-rules.data';
import { generateTenantCollectionNameFromClaims } from '../../../utils/tenant';
import { initializeTenantServicesConfig } from '../../../utils/services';
import { Sector } from 'gdc-common-utils-ts/models/urlPath';
import { getIndividualSectionId } from '../../../utils/individual-sections';
import { startServer, resetServerConfig } from '../../../server';
import { getEnvSectionId } from '../../../utils/section-env';
import { testTenant1AlternateName, testTenant1VaultId } from '../../data/organization.data';
import {
  EXAMPLE_INTER_TENANT_ACCESS_CONTRACT_CONSUMER_PROFESSIONAL_DID,
  EXAMPLE_INTER_TENANT_ACCESS_CONTRACT_CLAIMS,
  EXAMPLE_INTER_TENANT_ACCESS_CONTRACT_CREDENTIAL,
  EXAMPLE_INTER_TENANT_ACCESS_CONTRACT_CONTEXT,
  EXAMPLE_INTER_TENANT_ACCESS_CONTRACT_ID,
  EXAMPLE_INTER_TENANT_ACCESS_CONTRACT_SMART_SCOPE,
  EXAMPLE_INTER_TENANT_ACCESS_CONTRACT_VALID_FROM,
  EXAMPLE_INTER_TENANT_ACCESS_CONTRACT_VALID_UNTIL,
} from 'gdc-common-utils-ts/examples/inter-tenant-access-contract';
import { ClaimInterTenantAccessContract } from 'gdc-common-utils-ts/models/inter-tenant-access-contract';
import { buildInterTenantAccessContractCredential } from 'gdc-common-utils-ts/utils/inter-tenant-access-contract';
import { buildClientAssertionFixture, buildClientAssertionJwt } from 'gdc-common-utils-ts/utils/client-assertion';
import { addVC, createVP } from 'gdc-common-utils-ts/utils/vp-token';
import { ServiceCapability } from 'gdc-common-utils-ts/constants/service-capabilities';
import { HealthcareActorRoles, HealthcareConsentPurposes } from 'gdc-common-utils-ts/constants/healthcare';
import { ClaimConsent, ConsentDecisions, ConsentStatuses } from 'gdc-common-utils-ts/models/consent-rule';
import {
  EXAMPLE_ALTERNATE_PORTAL_INDIVIDUAL_DID,
  EXAMPLE_PORTAL_INDIVIDUAL_DID,
  EXAMPLE_SUBJECT_IDENTITY_BINDING_CREDENTIAL,
  EXAMPLE_TRUSTED_HEALTH_PORTAL_DID,
} from 'gdc-common-utils-ts/examples/subject-identity-binding';
import {
  EXAMPLE_ACCOUNT_OWNER_ID,
  EXAMPLE_CONTROLLER_DID,
  EXAMPLE_DEVICE_CLIENT_ID,
  EXAMPLE_EMAIL_CONTROLLER_INDIVIDUAL,
  EXAMPLE_HOSTING_OPERATOR_DID,
  EXAMPLE_LICENSE_SEAT_UUID_SECONDARY,
  EXAMPLE_LICENSE_SUBJECT_ID_ACTIVE,
  EXAMPLE_SUBJECT_DID,
  EXAMPLE_SUBJECT_DID_SECONDARY,
} from 'gdc-common-utils-ts/examples/shared';
import { OpenIdAuthManager } from '../../../managers/OpenIdAuthManager';
import { buildResearchStudyControllerImportScope } from '../../../managers/ResearchStudyConsentManager';
import { DeviceBindingStatuses } from 'gdc-common-utils-ts/constants/device';
import { buildStableActorIdentifier } from 'gdc-common-utils-ts/utils/actor-identifier';
import { LICENSE_USER_CLASS_INDIVIDUAL } from '../../../constants/domain';

const EXAMPLE_INTER_TENANT_DIGITAL_TWIN_SCOPE =
  `${ServiceCapability.DigitalTwinReader}?subject=${EXAMPLE_INTER_TENANT_ACCESS_CONTRACT_CONTEXT.subjectDid}`;

const EXAMPLE_INTER_TENANT_DIGITAL_TWIN_CONTRACT_CREDENTIAL =
  buildInterTenantAccessContractCredential({
    claims: {
      ...EXAMPLE_INTER_TENANT_ACCESS_CONTRACT_CLAIMS,
      [ClaimInterTenantAccessContract.capability]: ServiceCapability.DigitalTwinReader,
    },
    issuer: EXAMPLE_CONTROLLER_DID,
    validFrom: EXAMPLE_INTER_TENANT_ACCESS_CONTRACT_VALID_FROM,
    validUntil: EXAMPLE_INTER_TENANT_ACCESS_CONTRACT_VALID_UNTIL,
    // Keep the bilateral contractAgreement proof carried by the shared
    // fixture while specializing only the capability under test.
    additionalCredential: {
      id: EXAMPLE_INTER_TENANT_ACCESS_CONTRACT_ID,
      proof: EXAMPLE_INTER_TENANT_ACCESS_CONTRACT_CREDENTIAL.proof,
    },
  }) as unknown as Record<string, unknown>;

describe('SMART token issuance (integration)', () => {
  it('carries the exact controller ResearchStudy create scope through the HTTP and queue boundary', async () => {
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

    const studyReference = 'ResearchStudy/controller-route-contract';
    const exactScope = buildResearchStudyControllerImportScope(studyReference);
    let capturedJob: any;
    const processSpy = jest.spyOn(OpenIdAuthManager.prototype, 'process').mockImplementation(async (job) => {
      capturedJob = job;
      return {
        jti: job.content?.jti || job.content?.thid,
        thid: job.content?.thid,
        iss: EXAMPLE_HOSTING_OPERATOR_DID,
        aud: job.content?.iss,
        type: 'application/json',
        body: { access_token: 'route-contract-token', scope: exactScope },
      } as any;
    });
    const { app, queueAdapter, tenantManager, vaultRepository, kmsService } = await startServer({ listen: false });
    try {
      const hostClaims = {
        [ClaimsOrganizationSchemaorg.addressCountry]: process.env.ORG_HOST_JURISDICTION,
        [ClaimsOrganizationSchemaorg.identifierType]: process.env.ORG_HOST_ID_TYPE,
        [ClaimsOrganizationSchemaorg.identifierValue]: process.env.ORG_HOST_ID_VALUE,
        [ClaimsServiceSchemaorg.category]: Sector.SYSTEM,
      };
      const tenantClaims = testPayloadCreateTenant1.body.data[0].resource.meta.claims as any;
      const tenantVaultId = getTenantVaultId(
        tenantClaims[ClaimsServiceSchemaorg.category],
        tenantClaims['org.schema.Organization.alternateName'],
      );
      await kmsService.provisionKeys(tenantVaultId);
      const protectedTenant = await kmsService.protectConfidentialData({
        id: tenantVaultId,
        sequence: 0,
        content: {
          claims: tenantClaims,
          didConfig: { service: initializeTenantServicesConfig(Sector.HEALTH_CARE) },
          didDocument: { id: EXAMPLE_HOSTING_OPERATOR_DID, '@context': 'https://www.w3.org/ns/did/v1' },
        },
      } as any, 'host');
      await vaultRepository.put(
        resolveHostPhysicalCollectionName(),
        [protectedTenant as any],
        getEnvSectionId('tenants'),
      );
      await tenantManager.getTenant(tenantVaultId);

      const thid = 'controller-research-route-contract';
      const submit = await invokeExpress(app, {
        method: 'POST',
        url: `/${testTenant1AlternateName}/cds-ES/v1/health-care/identity/openid/smart/token`,
        headers: { 'content-type': 'application/json', authorization: 'Bearer mock' },
        body: {
          thid,
          iss: EXAMPLE_CONTROLLER_DID,
          body: {
            sub: EXAMPLE_CONTROLLER_DID,
            purpose: HealthcareConsentPurposes.Research,
            scope: exactScope,
          },
        },
      });
      expect(submit.status).toBe(202);
      for (let attempt = 0; attempt < 50 && !capturedJob; attempt += 1) {
        await new Promise(resolve => setTimeout(resolve, 20));
      }
      expect(capturedJob?.content?.body).toEqual(expect.objectContaining({
        sub: EXAMPLE_CONTROLLER_DID,
        purpose: HealthcareConsentPurposes.Research,
        scope: exactScope,
      }));
    } finally {
      processSpy.mockRestore();
      queueAdapter.stop();
    }
  });

  it('should issue individual self-read through a trusted cross-portal DID binding', async () => {
    process.env.NODE_ENV = 'test';
    process.env.DB_PROVIDER = 'mem';
    process.env.STORAGE_PROVIDER = 'mem';
    process.env.QUEUE_PROVIDER = 'mem';
    process.env.SECTORS_ALLOWED = 'health-care';

    // Minimal host bootstrap config required by startServer().
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
    process.env.SUBJECT_IDENTITY_BINDING_TRUSTED_ISSUERS = EXAMPLE_TRUSTED_HEALTH_PORTAL_DID;

    resetServerConfig();

    const { app, queueAdapter, tenantManager, vaultRepository, kmsService } = await startServer({ listen: false });
    try {
      // Create tenant "acme" directly in the host registry (avoid full crypto onboarding here).
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

      const tenantConfig = {
        claims: tenantClaims,
        didConfig: { service: initializeTenantServicesConfig(Sector.HEALTH_CARE) },
        didDocument: { id: EXAMPLE_HOSTING_OPERATOR_DID, '@context': 'https://www.w3.org/ns/did/v1' },
      };

      // Ensure the tenant has signing keys available for token issuance.
      await kmsService.provisionKeys(tenantVaultId);

      const secureTenantRecord = await kmsService.protectConfidentialData(
        { id: tenantVaultId, sequence: 0, content: tenantConfig } as any,
        'host',
      );
      await vaultRepository.put(hostCollectionName, [secureTenantRecord as any], getEnvSectionId('tenants'));
      await tenantManager.getTenant(tenantVaultId);

      // Create the individual's physical vault and rules
      const subject = EXAMPLE_PORTAL_INDIVIDUAL_DID;
      const actorDid = EXAMPLE_ALTERNATE_PORTAL_INDIVIDUAL_DID;
      const consentPeriodEnd = new Date(Date.now() + 30_000).toISOString();
      const individualRulesSectionId = getIndividualSectionId(subject, 'rules');
      await vaultRepository.put(tenantVaultId, [{
        id: 'individual-self-read-integration',
        '@context': 'org.hl7.fhir.api',
        [ClaimConsent.subject]: subject,
        [ClaimConsent.identifier]: 'urn:uuid:individual-self-read-integration',
        [ClaimConsent.decision]: ConsentDecisions.Permit,
        [ClaimConsent.status]: ConsentStatuses.Active,
        [ClaimConsent.actorIdentifier]: subject,
        [ClaimConsent.action]: `${ServiceCapability.IndexReader}?section=*`,
        [ClaimConsent.purpose]: HealthcareConsentPurposes.Treatment,
        [ClaimConsent.periodEnd]: consentPeriodEnd,
      } as any], individualRulesSectionId);

      // Exercise the real HTTP/queue/manager path with the production shared
      // binding credential shape; no test bridge pre-authorizes the aliases.
      const vp = addVC(
        createVP({ iss: actorDid, sub: actorDid }),
        EXAMPLE_SUBJECT_IDENTITY_BINDING_CREDENTIAL,
      );
      const clientId = `${actorDid}:device:client-001`;
      const clientAssertion = await buildClientAssertionJwt({
        clientId,
        audience: EXAMPLE_HOSTING_OPERATOR_DID,
      });
      const tokenUrl = `/${testTenant1AlternateName}/cds-ES/v1/health-care/identity/openid/smart/token`;
      const submitResp = await invokeExpress(app, {
        method: 'POST',
        url: tokenUrl,
        headers: { 'content-type': 'application/json', authorization: 'Bearer mock' },
        body: {
          thid: 'smart-token-thread-id',
          iss: clientId,
          aud: EXAMPLE_HOSTING_OPERATOR_DID,
        body: {
          client_id: clientId,
          client_assertion: clientAssertion,
          client_assertion_type: 'private_key_jwt',
          sub: actorDid,
          purpose: HealthcareConsentPurposes.Treatment,
          scope: `${ServiceCapability.IndexReader}?subject=${subject}&section=*`,
          expires_in: 60,
          vp_token: JSON.stringify(vp),
          acr_values: 'urn:antifraud:acr:openid4vp:individual',
        },
      },
    });
      expect(submitResp.status).toBe(202);

      // Poll for decrypted response
      let finalPayload: any;
      for (let i = 0; i < 50; i++) {
        const pollResp = await invokeExpress(app, {
          method: 'POST',
          url: `/${testTenant1AlternateName}/cds-ES/v1/health-care/identity/openid/smart/_batch-response`,
          headers: { 'content-type': 'application/json' },
          body: { thid: 'smart-token-thread-id' },
        });
        if (pollResp.status === 200) {
          finalPayload = JSON.parse(pollResp.text);
          break;
        }
        await new Promise((r) => setTimeout(r, 50));
      }

      expect(finalPayload?.access_token).toBeDefined();
      expect(finalPayload?.subject).toBe(subject);
      expect(finalPayload?.expires_in).toBeGreaterThan(0);
      expect(finalPayload?.expires_in).toBeLessThanOrEqual(30);
      const tokenPayload = JSON.parse(Buffer.from(finalPayload.access_token.split('.')[1], 'base64url').toString('utf8'));
      expect(tokenPayload.exp).toBeLessThanOrEqual(Math.floor(Date.parse(consentPeriodEnd) / 1000));
    } finally {
      queueAdapter.stop();
      delete process.env.SUBJECT_IDENTITY_BINDING_TRUSTED_ISSUERS;
    }
  });

  it('should issue token for a foreign tenant actor only when a matching inter-tenant contract VC is presented', async () => {
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
      const tenantVaultId = getTenantVaultId(
        tenantClaims[ClaimsServiceSchemaorg.category],
        tenantClaims['org.schema.Organization.alternateName'],
      );

      const tenantConfig = {
        claims: tenantClaims,
        didConfig: { service: initializeTenantServicesConfig(Sector.HEALTH_CARE) },
        didDocument: { id: EXAMPLE_INTER_TENANT_ACCESS_CONTRACT_CONTEXT.providerOrganizationDid, '@context': 'https://www.w3.org/ns/did/v1' },
      };

      await kmsService.provisionKeys(tenantVaultId);

      const secureTenantRecord = await kmsService.protectConfidentialData(
        { id: tenantVaultId, sequence: 0, content: tenantConfig } as any,
        'host',
      );
      await vaultRepository.put(hostCollectionName, [secureTenantRecord as any], getEnvSectionId('tenants'));
      await tenantManager.getTenant(tenantVaultId);

      const subject = 'did:web:api.acme.org:individual:123';
      const individualRulesSectionId = getIndividualSectionId(subject, 'rules');
      await vaultRepository.put(tenantVaultId, [{
        ...testConsentRulePermitOrgDid,
        'Consent.actor-identifier': EXAMPLE_INTER_TENANT_ACCESS_CONTRACT_CONTEXT.consumerOrganizationDid,
        'Consent.purpose': EXAMPLE_INTER_TENANT_ACCESS_CONTRACT_CONTEXT.purpose,
        'Consent.action': `${ServiceCapability.DigitalTwinReader}?subject=*`,
      } as any], individualRulesSectionId);

      // Research internal profile:
      // - `client_assertion` authenticates the researcher's registered client
      // - `vp_token` carries the inter-tenant contract VC inside the VP
      const vpPayload = createVP({
        iss: EXAMPLE_INTER_TENANT_ACCESS_CONTRACT_CONTEXT.consumerOrganizationDid,
        sub: EXAMPLE_INTER_TENANT_ACCESS_CONTRACT_CONSUMER_PROFESSIONAL_DID,
      });
      addVC(vpPayload, EXAMPLE_INTER_TENANT_DIGITAL_TWIN_CONTRACT_CREDENTIAL);
      const clientId = 'did:web:lab.example:employee:researcher1@lab.org:device:client-002';
      const clientAssertion = await buildClientAssertionJwt({
        clientId,
        audience: EXAMPLE_INTER_TENANT_ACCESS_CONTRACT_CONTEXT.providerOrganizationDid,
      });

      const tokenUrl = `/${testTenant1AlternateName}/cds-ES/v1/health-care/identity/openid/smart/token`;
      const submitResp = await invokeExpress(app, {
        method: 'POST',
        url: tokenUrl,
        headers: { 'content-type': 'application/json', authorization: 'Bearer mock' },
        body: {
          thid: 'smart-token-inter-tenant-thread-id',
          iss: clientId,
          aud: EXAMPLE_INTER_TENANT_ACCESS_CONTRACT_CONTEXT.providerOrganizationDid,
          body: {
            client_id: clientId,
            client_assertion: clientAssertion,
            client_assertion_type: 'client_assertion',
            sub: EXAMPLE_INTER_TENANT_ACCESS_CONTRACT_CONSUMER_PROFESSIONAL_DID,
            purpose: EXAMPLE_INTER_TENANT_ACCESS_CONTRACT_CONTEXT.purpose,
            scope: EXAMPLE_INTER_TENANT_DIGITAL_TWIN_SCOPE,
            expires_in: 60,
            vp_token: JSON.stringify(vpPayload),
            acr_values: 'urn:antifraud:acr:openid4vp:employee',
          },
        },
      });
      expect(submitResp.status).toBe(202);

      let finalPayload: any;
      for (let i = 0; i < 50; i++) {
        const pollResp = await invokeExpress(app, {
          method: 'POST',
          url: `/${testTenant1AlternateName}/cds-ES/v1/health-care/identity/openid/smart/_batch-response`,
          headers: { 'content-type': 'application/json' },
          body: { thid: 'smart-token-inter-tenant-thread-id' },
        });
        if (pollResp.status === 200) {
          finalPayload = JSON.parse(pollResp.text);
          break;
        }
        await new Promise((r) => setTimeout(r, 50));
      }

      expect(finalPayload?.access_token).toBeDefined();
      expect(finalPayload?.subject).toMatch(/^urn:uuid:/);
      expect(finalPayload?.subject).not.toBe(subject);
    } finally {
      queueAdapter.stop();
    }
  });

  it('should issue token for research access with one trusted external bearer instead of vp_token', async () => {
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
    process.env.EXTERNAL_RESEARCH_TOKEN_TRUSTED_ISSUERS = 'https://pontus-x.example';

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
      const tenantVaultId = getTenantVaultId(
        tenantClaims[ClaimsServiceSchemaorg.category],
        tenantClaims['org.schema.Organization.alternateName'],
      );

      const tenantConfig = {
        claims: tenantClaims,
        didConfig: { service: initializeTenantServicesConfig(Sector.HEALTH_CARE) },
        didDocument: { id: EXAMPLE_INTER_TENANT_ACCESS_CONTRACT_CONTEXT.providerOrganizationDid, '@context': 'https://www.w3.org/ns/did/v1' },
      };

      await kmsService.provisionKeys(tenantVaultId);

      const secureTenantRecord = await kmsService.protectConfidentialData(
        { id: tenantVaultId, sequence: 0, content: tenantConfig } as any,
        'host',
      );
      await vaultRepository.put(hostCollectionName, [secureTenantRecord as any], getEnvSectionId('tenants'));
      await tenantManager.getTenant(tenantVaultId);

      const subject = EXAMPLE_INTER_TENANT_ACCESS_CONTRACT_CONTEXT.subjectDid;
      const individualRulesSectionId = getIndividualSectionId(subject, 'rules');
      await vaultRepository.put(tenantVaultId, [{
        ...testConsentRulePermitOrgDid,
        'Consent.actor-identifier': EXAMPLE_INTER_TENANT_ACCESS_CONTRACT_CONTEXT.consumerOrganizationDid,
        'Consent.purpose': HealthcareConsentPurposes.Research,
      } as any], individualRulesSectionId);

      // Research external profile:
      // - `client_assertion` still proves possession of the client private key
      // - external bearer replaces only the internal contract-via-`vp_token`
      const bearerPayload = {
        iss: 'https://pontus-x.example',
        aud: EXAMPLE_INTER_TENANT_ACCESS_CONTRACT_CONTEXT.providerOrganizationDid,
        consumerOrganizationDid: EXAMPLE_INTER_TENANT_ACCESS_CONTRACT_CONTEXT.consumerOrganizationDid,
        purpose: HealthcareConsentPurposes.Research,
        scope: EXAMPLE_INTER_TENANT_ACCESS_CONTRACT_SMART_SCOPE,
      };
      const clientId = 'did:web:lab.example:employee:researcher1@lab.org:device:client-003';
      const clientAssertion = await buildClientAssertionJwt({
        clientId,
        audience: EXAMPLE_INTER_TENANT_ACCESS_CONTRACT_CONTEXT.providerOrganizationDid,
      });
      const bearerToken = [
        Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url'),
        Buffer.from(JSON.stringify(bearerPayload)).toString('base64url'),
        'demo',
      ].join('.');

      const tokenUrl = `/${testTenant1AlternateName}/cds-ES/v1/health-care/identity/openid/smart/token`;
      const submitResp = await invokeExpress(app, {
        method: 'POST',
        url: tokenUrl,
        headers: { 'content-type': 'application/json', authorization: `Bearer ${bearerToken}` },
        body: {
          thid: 'smart-token-external-research-thread-id',
          iss: clientId,
          aud: EXAMPLE_INTER_TENANT_ACCESS_CONTRACT_CONTEXT.providerOrganizationDid,
          body: {
            client_id: clientId,
            client_assertion: clientAssertion,
            client_assertion_type: 'private_key_jwt',
            sub: EXAMPLE_INTER_TENANT_ACCESS_CONTRACT_CONSUMER_PROFESSIONAL_DID,
            purpose: HealthcareConsentPurposes.Research,
            scope: EXAMPLE_INTER_TENANT_ACCESS_CONTRACT_SMART_SCOPE,
            expires_in: 60,
            acr_values: 'urn:antifraud:acr:openid4vp:employee',
          },
        },
      });
      expect(submitResp.status).toBe(202);

      let finalPayload: any;
      for (let i = 0; i < 50; i++) {
        const pollResp = await invokeExpress(app, {
          method: 'POST',
          url: `/${testTenant1AlternateName}/cds-ES/v1/health-care/identity/openid/smart/_batch-response`,
          headers: { 'content-type': 'application/json' },
          body: { thid: 'smart-token-external-research-thread-id' },
        });
        if (pollResp.status === 200) {
          finalPayload = JSON.parse(pollResp.text);
          break;
        }
        await new Promise((r) => setTimeout(r, 50));
      }

      expect(finalPayload?.access_token).toBeDefined();
      expect(finalPayload?.subject).toBe(subject);
      expect(finalPayload?.ledger_verified).toBe(true);
    } finally {
      queueAdapter.stop();
    }
  });

  it('should issue token for research access with one trusted external bearer and canonical ResearchSubject action', async () => {
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
    process.env.EXTERNAL_RESEARCH_TOKEN_TRUSTED_ISSUERS = 'https://pontus-x.example';

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
      const tenantVaultId = getTenantVaultId(
        tenantClaims[ClaimsServiceSchemaorg.category],
        tenantClaims['org.schema.Organization.alternateName'],
      );

      const tenantConfig = {
        claims: tenantClaims,
        didConfig: { service: initializeTenantServicesConfig(Sector.HEALTH_CARE) },
        didDocument: { id: EXAMPLE_INTER_TENANT_ACCESS_CONTRACT_CONTEXT.providerOrganizationDid, '@context': 'https://www.w3.org/ns/did/v1' },
      };

      await kmsService.provisionKeys(tenantVaultId);

      const secureTenantRecord = await kmsService.protectConfidentialData(
        { id: tenantVaultId, sequence: 0, content: tenantConfig } as any,
        'host',
      );
      await vaultRepository.put(hostCollectionName, [secureTenantRecord as any], getEnvSectionId('tenants'));
      await tenantManager.getTenant(tenantVaultId);

      const subject = EXAMPLE_INTER_TENANT_ACCESS_CONTRACT_CONTEXT.subjectDid;
      const individualRulesSectionId = getIndividualSectionId(subject, 'rules');
      await vaultRepository.put(tenantVaultId, [{
        ...testConsentRulePermitOrgDid,
        'Consent.actor-identifier': EXAMPLE_INTER_TENANT_ACCESS_CONTRACT_CONTEXT.consumerOrganizationDid,
        'Consent.purpose': HealthcareConsentPurposes.Research,
        'Consent.action': 'ResearchSubject.rs',
      } as any], individualRulesSectionId);

      const researchSubjectScope = `organization/ResearchSubject.rs?subject=${subject}`;
      const bearerPayload = {
        iss: 'https://pontus-x.example',
        aud: EXAMPLE_INTER_TENANT_ACCESS_CONTRACT_CONTEXT.providerOrganizationDid,
        consumerOrganizationDid: EXAMPLE_INTER_TENANT_ACCESS_CONTRACT_CONTEXT.consumerOrganizationDid,
        purpose: HealthcareConsentPurposes.Research,
        scope: researchSubjectScope,
      };
      const clientId = 'did:web:lab.example:employee:researcher1@lab.org:device:client-004';
      const clientAssertion = await buildClientAssertionJwt({
        clientId,
        audience: EXAMPLE_INTER_TENANT_ACCESS_CONTRACT_CONTEXT.providerOrganizationDid,
      });
      const bearerToken = [
        Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url'),
        Buffer.from(JSON.stringify(bearerPayload)).toString('base64url'),
        'demo',
      ].join('.');

      const tokenUrl = `/${testTenant1AlternateName}/cds-ES/v1/health-care/identity/openid/smart/token`;
      const submitResp = await invokeExpress(app, {
        method: 'POST',
        url: tokenUrl,
        headers: { 'content-type': 'application/json', authorization: `Bearer ${bearerToken}` },
        body: {
          thid: 'smart-token-external-research-rs-thread-id',
          iss: clientId,
          aud: EXAMPLE_INTER_TENANT_ACCESS_CONTRACT_CONTEXT.providerOrganizationDid,
          body: {
            client_id: clientId,
            client_assertion: clientAssertion,
            client_assertion_type: 'private_key_jwt',
            sub: EXAMPLE_INTER_TENANT_ACCESS_CONTRACT_CONSUMER_PROFESSIONAL_DID,
            purpose: HealthcareConsentPurposes.Research,
            scope: researchSubjectScope,
            expires_in: 60,
            acr_values: 'urn:antifraud:acr:openid4vp:employee',
          },
        },
      });
      expect(submitResp.status).toBe(202);

      let finalPayload: any;
      for (let i = 0; i < 50; i++) {
        const pollResp = await invokeExpress(app, {
          method: 'POST',
          url: `/${testTenant1AlternateName}/cds-ES/v1/health-care/identity/openid/smart/_batch-response`,
          headers: { 'content-type': 'application/json' },
          body: { thid: 'smart-token-external-research-rs-thread-id' },
        });
        if (pollResp.status === 200) {
          finalPayload = JSON.parse(pollResp.text);
          break;
        }
        await new Promise((r) => setTimeout(r, 50));
      }

      expect(finalPayload?.access_token).toBeDefined();
      expect(finalPayload?.subject).toMatch(/^urn:uuid:/);
      expect(finalPayload?.subject).not.toBe(subject);
      expect(finalPayload?.ledger_verified).toBe(true);
    } finally {
      queueAdapter.stop();
    }
  });

  it('selects a second controller-owned individual through its public Card alias across the real HTTP, queue, KMS and repository boundary', async () => {
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
      const tenantClaims = testPayloadCreateTenant1.body.data[0].resource.meta.claims as any;
      const tenantVaultId = getTenantVaultId(
        tenantClaims[ClaimsServiceSchemaorg.category],
        tenantClaims[ClaimsOrganizationSchemaorg.alternateName],
      );
      await kmsService.provisionKeys(tenantVaultId);
      const protectedTenant = await kmsService.protectConfidentialData({
        id: tenantVaultId,
        sequence: 0,
        content: {
          claims: tenantClaims,
          didConfig: { service: initializeTenantServicesConfig(Sector.HEALTH_CARE) },
          didDocument: { id: EXAMPLE_HOSTING_OPERATOR_DID, '@context': 'https://www.w3.org/ns/did/v1' },
        },
      } as any, 'host');
      await vaultRepository.put(
        resolveHostPhysicalCollectionName(),
        [protectedTenant as any],
        getEnvSectionId('tenants'),
      );
      await tenantManager.getTenant(tenantVaultId);

      const assertion = await buildClientAssertionFixture({
        clientId: EXAMPLE_DEVICE_CLIENT_ID,
        audience: EXAMPLE_HOSTING_OPERATOR_DID,
      });
      const stableActorIdentifier = buildStableActorIdentifier({
        contactKind: 'email',
        contact: EXAMPLE_EMAIL_CONTROLLER_INDIVIDUAL,
      });
      const profile = await kmsService.protectConfidentialData({
        id: EXAMPLE_DEVICE_CLIENT_ID,
        sequence: 0,
        content: {
          clientId: EXAMPLE_DEVICE_CLIENT_ID,
          status: DeviceBindingStatuses.Active,
          actorDid: EXAMPLE_CONTROLLER_DID,
          profileDid: EXAMPLE_CONTROLLER_DID,
          authorizedSubjectDid: EXAMPLE_SUBJECT_DID,
          authenticatedSubject: EXAMPLE_ACCOUNT_OWNER_ID,
          authenticatedEmail: EXAMPLE_EMAIL_CONTROLLER_INDIVIDUAL,
          licenseId: EXAMPLE_LICENSE_SUBJECT_ID_ACTIVE,
          jwks: { keys: [assertion.publicJwk] },
        },
      } as any, tenantVaultId);
      const controllerSeats = await Promise.all([
        {
          id: EXAMPLE_LICENSE_SUBJECT_ID_ACTIVE,
          sequence: 0,
          content: {
            id: EXAMPLE_LICENSE_SUBJECT_ID_ACTIVE,
            status: DeviceBindingStatuses.Active,
            userClass: LICENSE_USER_CLASS_INDIVIDUAL,
            subjectId: EXAMPLE_LICENSE_SUBJECT_ID_ACTIVE,
            authorizedSubjectDid: EXAMPLE_SUBJECT_DID,
            activatedBy: stableActorIdentifier,
            issuedToRole: HealthcareActorRoles.Controller,
          },
        },
        {
          id: EXAMPLE_LICENSE_SEAT_UUID_SECONDARY,
          sequence: 0,
          content: {
            id: EXAMPLE_LICENSE_SEAT_UUID_SECONDARY,
            status: DeviceBindingStatuses.Active,
            userClass: LICENSE_USER_CLASS_INDIVIDUAL,
            subjectId: EXAMPLE_LICENSE_SEAT_UUID_SECONDARY,
            authorizedSubjectDid: EXAMPLE_SUBJECT_DID_SECONDARY,
            activatedBy: stableActorIdentifier,
            issuedToRole: HealthcareActorRoles.Controller,
          },
        },
      ].map((record) => kmsService.protectConfidentialData(record as any, tenantVaultId)));
      await vaultRepository.put(tenantVaultId, [profile as any], getEnvSectionId('device-profiles'));
      await vaultRepository.put(tenantVaultId, controllerSeats as any[], getEnvSectionId('device-licenses'));

      const tenantCollectionName = generateTenantCollectionNameFromClaims(tenantClaims);
      const secondIndividual = await kmsService.protectConfidentialData({
        id: EXAMPLE_LICENSE_SEAT_UUID_SECONDARY,
        sequence: 0,
        content: {
          claims: {
            [ClaimsOrganizationSchemaorg.sameAs]: EXAMPLE_PORTAL_INDIVIDUAL_DID,
          },
        },
      } as any, tenantVaultId);
      await vaultRepository.put(
        tenantCollectionName,
        [secondIndividual as any],
        getEnvSectionId('individual'),
      );

      const submit = await invokeExpress(app, {
        method: 'POST',
        url: `/${testTenant1AlternateName}/cds-ES/v1/health-care/identity/openid/smart/token`,
        headers: { 'content-type': 'application/json', authorization: 'Bearer mock' },
        body: {
          thid: EXAMPLE_LICENSE_SEAT_UUID_SECONDARY,
          iss: EXAMPLE_CONTROLLER_DID,
          aud: EXAMPLE_HOSTING_OPERATOR_DID,
          body: {
            client_id: EXAMPLE_DEVICE_CLIENT_ID,
            client_assertion: assertion.jwt,
            client_assertion_type: 'private_key_jwt',
            sub: EXAMPLE_CONTROLLER_DID,
            purpose: HealthcareConsentPurposes.Treatment,
            scope: `${ServiceCapability.IndexReader}?subject=${EXAMPLE_PORTAL_INDIVIDUAL_DID}&section=*`,
            acr_values: 'urn:antifraud:acr:openid4vp:individual',
          },
        },
      });
      expect(submit.status).toBe(202);

      let finalPayload: any;
      for (let attempt = 0; attempt < 50; attempt += 1) {
        const poll = await invokeExpress(app, {
          method: 'POST',
          url: `/${testTenant1AlternateName}/cds-ES/v1/health-care/identity/openid/smart/_batch-response`,
          headers: { 'content-type': 'application/json' },
          body: { thid: EXAMPLE_LICENSE_SEAT_UUID_SECONDARY },
        });
        if (poll.status === 200) {
          finalPayload = JSON.parse(poll.text);
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
      }

      expect(finalPayload?.access_token).toBeDefined();
      expect(finalPayload?.subject).toBe(EXAMPLE_PORTAL_INDIVIDUAL_DID);
    } finally {
      queueAdapter.stop();
    }
  });
});
