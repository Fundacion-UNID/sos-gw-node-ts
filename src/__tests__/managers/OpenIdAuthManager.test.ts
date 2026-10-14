// Flow contract: reuse shared test fixtures and canonical types; do not introduce duplicated literals.
// private_key_jwt proves possession of the DCR-registered device key.
// Only the exact individual RESPRSN profile may continue without a vp_token;
// professional, delegated and member authorization keeps its credential proof.
// src/__tests__/managers/OpenIdAuthManager.test.ts

import { OpenIdAuthManager } from '../../managers/OpenIdAuthManager';
import { IKmsService } from '../../gdc-backend-utils-node/models/IKmsService';
import { TenantsCacheManager } from '../../managers/TenantsCacheManager';
import { JobRequest } from 'gdc-common-utils-ts/models/confidential-job';
import { IVaultRepository } from '../../database/repositories/vault/vault.repository';
import {
  testConsentRulePermitEmailWildcardRole,
  testConsentRulePermitJurisdiction,
  testConsentRulePermitOrgDid,
  testConsentRulePermitOrgDidMultiRole,
} from '../data/consent-rules.data';
import { IClearingHouseService } from '../../services/ClearingHouseService';
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
import {
  HealthcareActorRoles,
  getHealthcareRoleByClaim,
  HealthcareBasicSections,
  HealthcareConsentPurposes,
} from 'gdc-common-utils-ts/constants/healthcare';
import { buildSmartCompositionReadScope } from 'gdc-common-utils-ts/utils/smart-scope';
import {
  buildUnsignedIndividualControllerIdentityVpJwt,
  buildUnsignedIndividualMemberIdentityVpJwt,
  getIndividualControllerIdentityVC,
} from 'gdc-common-utils-ts/utils/individual-smart';
import { buildUnsignedProfessionalIdentityVpJwt } from 'gdc-common-utils-ts/utils/professional-smart';
import { buildHostedProviderDidWeb, buildProfessionalDidWeb } from 'gdc-common-utils-ts/utils/did';
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
  EXAMPLE_KYC_CONTROLLER_TELEPHONE,
  EXAMPLE_LICENSE_SUBJECT_ID_ACTIVE,
  EXAMPLE_SUBJECT_DID,
  EXAMPLE_TENANT_ROUTE_CONTEXT,
} from 'gdc-common-utils-ts/examples/shared';
import {
  IdentityAuthResourceTypes,
  SmartPostDcrActions,
} from 'gdc-common-utils-ts/constants/identity-auth';
import {
  GatewayRouteFormats,
  GatewayRouteSections,
} from 'gdc-common-utils-ts/constants/gateway-response';
import { DeviceBindingStatuses } from 'gdc-common-utils-ts/constants/device';
import { ClaimsOrganizationSchemaorg } from 'gdc-common-utils-ts/constants/schemaorg';
import { EXAMPLE_DEVICE_BOUND_SMART_DIDCOMM_MESSAGE } from 'gdc-common-utils-ts/examples/didcomm-identity';
import { buildStableActorIdentifier } from 'gdc-common-utils-ts/utils/actor-identifier';
import {
  RESEARCH_STUDY_ACCESS_FIXTURE,
  buildResearchStudyAccessScope,
} from '../data/research-study-access.data';
import {
  RESEARCH_STUDY_CONSENT_SECTION,
  RESEARCH_STUDY_SECTION,
} from '../../managers/ResearchStudyConsentManager';
import { getIndividualSectionId } from '../../utils/individual-sections';
import { parseProfessionalDidIdentity } from '../../utils/professional-did-identity';
import { LICENSE_USER_CLASS_INDIVIDUAL } from '../../constants/domain';
import {
  EXAMPLE_ORG_ACTIVATION_CONTROLLER_CREDENTIAL,
} from 'gdc-common-utils-ts/examples/ica-activation-proof';

const EXAMPLE_INTER_TENANT_DIGITAL_TWIN_SCOPE =
  `${ServiceCapability.DigitalTwinReader}?subject=${EXAMPLE_INTER_TENANT_ACCESS_CONTRACT_CONTEXT.subjectDid}`;

const SAME_TENANT_ID = '704457076';
const SAME_TENANT_EMPLOYEE_EMAIL = 'doctor@vetchain.example';
const SAME_TENANT_EMPLOYEE_ROLE = 'ISCO-08|2250';
const SAME_TENANT_RESEARCH_SUBJECT = 'did:web:api.acme.org:research-subject:any';
const SAME_TENANT_PUBLIC_ORGANIZATION_DID = buildHostedProviderDidWeb({
  hostDomain: 'vetchain.app', sector: 'animal-care', providerTaxId: SAME_TENANT_ID,
});
const SAME_TENANT_CONTROLLER_DID = buildProfessionalDidWeb({
  organizationDidWeb: SAME_TENANT_PUBLIC_ORGANIZATION_DID,
  email: SAME_TENANT_EMPLOYEE_EMAIL,
  role: HealthcareActorRoles.Controller,
});
const SAME_TENANT_EMPLOYEE_DID = buildProfessionalDidWeb({
  organizationDidWeb: SAME_TENANT_PUBLIC_ORGANIZATION_DID,
  email: SAME_TENANT_EMPLOYEE_EMAIL,
  role: SAME_TENANT_EMPLOYEE_ROLE,
});

const EXAMPLE_INTER_TENANT_DIGITAL_TWIN_CONTRACT_CREDENTIAL =
  buildInterTenantAccessContractCredential({
    claims: {
      ...EXAMPLE_INTER_TENANT_ACCESS_CONTRACT_CLAIMS,
      [ClaimInterTenantAccessContract.capability]: ServiceCapability.DigitalTwinReader,
    },
    issuer: EXAMPLE_CONTROLLER_DID,
    validFrom: EXAMPLE_INTER_TENANT_ACCESS_CONTRACT_VALID_FROM,
    validUntil: EXAMPLE_INTER_TENANT_ACCESS_CONTRACT_VALID_UNTIL,
    // The clearing-house mock represents cryptographic verification; retain
    // the shared fixture's two verified contractAgreement proof entries.
    additionalCredential: {
      id: EXAMPLE_INTER_TENANT_ACCESS_CONTRACT_ID,
      proof: EXAMPLE_INTER_TENANT_ACCESS_CONTRACT_CREDENTIAL.proof,
    },
  }) as unknown as Record<string, unknown>;

function buildMockCompactJws() {
  return jest.fn<Promise<string>, Parameters<IKmsService['createCompactJws']>>(async (payload: object) => (
    `eyJhbGciOiJFUzM4NCIsImtpZCI6InRlbmFudC1zaWcta2lkIiwidHlwIjoiSldUIn0.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.sig`
  ));
}

function buildAliasedIndividualSelfReadManager(): OpenIdAuthManager {
  // Test setup only: dependencies are mocked, but the real OpenIdAuthManager
  // executes VP extraction, trusted-issuer matching and Consent evaluation.
  const kmsService = {
    getPublicVerificationKey: jest.fn().mockResolvedValue({ kid: 'tenant-sig-kid' }),
    signWithManagedKey: jest.fn().mockResolvedValue({
      payload: '',
      signatures: [{ protected: 'p', signature: 'sig' }],
    }),
    createCompactJws: buildMockCompactJws(),
  } as unknown as jest.Mocked<IKmsService>;
  const tenants = {
    getDidDocument: jest.fn().mockResolvedValue({ id: EXAMPLE_HOSTING_OPERATOR_DID }),
    tenantExists: jest.fn().mockResolvedValue(true),
  } as unknown as jest.Mocked<TenantsCacheManager>;
  const vault = {
    getContainersInSection: jest.fn().mockResolvedValue([{
      '@context': 'org.hl7.fhir.api',
      [ClaimConsent.subject]: EXAMPLE_PORTAL_INDIVIDUAL_DID,
      [ClaimConsent.identifier]: 'urn:uuid:aliased-individual-self-read',
      [ClaimConsent.decision]: ConsentDecisions.Permit,
      [ClaimConsent.status]: ConsentStatuses.Active,
      [ClaimConsent.actorIdentifier]: EXAMPLE_PORTAL_INDIVIDUAL_DID,
      [ClaimConsent.action]: `${ServiceCapability.IndexReader}?section=*`,
      [ClaimConsent.purpose]: HealthcareConsentPurposes.Treatment,
    }]),
  } as unknown as jest.Mocked<IVaultRepository>;
  const clearingHouse = {
    verifyVpToken: jest.fn().mockResolvedValue({
      acr: 'urn:antifraud:acr:openid4vp:individual',
      amr: ['openid4vp', 'vc'],
      vpHash: 'hash',
      ledgerVerified: true,
    }),
  } as unknown as jest.Mocked<IClearingHouseService>;
  return new OpenIdAuthManager(kmsService, tenants, vault, clearingHouse);
}

function buildAliasedIndividualSelfReadJob(vpToken: string): JobRequest {
  return {
    tenantId: 'acme',
    jurisdiction: 'ES',
    sector: 'health-care',
    section: 'identity',
    format: 'openid',
    resourceType: 'smart',
    action: 'token',
    id: '',
    sequence: 0,
    status: 'DRAFT' as any,
    createdAtTimestamp: Date.now(),
    content: {
      thid: 'aliased-individual-self-read',
      iss: `${EXAMPLE_ALTERNATE_PORTAL_INDIVIDUAL_DID}:device:client`,
      aud: EXAMPLE_HOSTING_OPERATOR_DID,
      body: {
        sub: EXAMPLE_ALTERNATE_PORTAL_INDIVIDUAL_DID,
        scope: `${ServiceCapability.IndexReader}?subject=${EXAMPLE_PORTAL_INDIVIDUAL_DID}&section=*`,
        purpose: HealthcareConsentPurposes.Treatment,
        vp_token: vpToken,
        acr_values: 'urn:antifraud:acr:openid4vp:individual',
      },
    } as any,
  } as JobRequest;
}

function buildSameTenantResearchConsent(actorDid: string): Record<string, unknown> {
  return {
    [ClaimConsent.status]: ConsentStatuses.Active,
    [ClaimConsent.subject]: SAME_TENANT_RESEARCH_SUBJECT,
    [ClaimConsent.decision]: ConsentDecisions.Permit,
    [ClaimConsent.actorIdentifier]: actorDid,
    [ClaimConsent.actorRole]: SAME_TENANT_EMPLOYEE_ROLE,
    [ClaimConsent.action]: ServiceCapability.DigitalTwinReader,
    [ClaimConsent.purpose]: HealthcareConsentPurposes.Research,
  };
}

function buildSameTenantDigitalTwinManager(input: Readonly<{
  rules?: ReadonlyArray<Record<string, unknown>>;
  employeeStatus?: string;
  licenseStatus?: string;
}> = {}): OpenIdAuthManager {
  const stableActorIdentifier = buildStableActorIdentifier({
    contactKind: 'email',
    contact: SAME_TENANT_EMPLOYEE_EMAIL,
  });
  const kmsService = {
    getPublicVerificationKey: jest.fn().mockResolvedValue({ kid: 'tenant-sig-kid' }),
    signWithManagedKey: jest.fn().mockResolvedValue({ payload: '', signatures: [{ protected: 'p', signature: 'sig' }] }),
    createCompactJws: buildMockCompactJws(),
    unprotectConfidentialData: jest.fn(async (record: any) => record?.content || ({
      status: input.employeeStatus || 'active',
      claims: {
        'org.schema.Person.email': SAME_TENANT_EMPLOYEE_EMAIL,
        'org.schema.Person.hasOccupation': SAME_TENANT_EMPLOYEE_ROLE,
      },
    })),
  } as unknown as jest.Mocked<IKmsService>;
  const tenants = {
    getDidDocument: jest.fn().mockResolvedValue({ id: 'did:web:api.acme.org' }),
    tenantExists: jest.fn().mockResolvedValue(true),
    getCollectionName: jest.fn().mockResolvedValue(`animal-care_${SAME_TENANT_ID}`),
  } as unknown as jest.Mocked<TenantsCacheManager>;
  const vault = {
    getAllSections: jest.fn().mockResolvedValue([
      getIndividualSectionId(SAME_TENANT_RESEARCH_SUBJECT, 'rules'),
    ]),
    getContainersInSection: jest.fn().mockImplementation(async (_vaultId: string, sectionId: string) => {
      if (sectionId.includes('employees')) return [{ id: 'active-veterinarian' }];
      if (sectionId.includes('device-licenses')) return [{
        content: {
          status: input.licenseStatus || 'active',
          issuedToEmail: SAME_TENANT_EMPLOYEE_EMAIL,
          issuedToRole: SAME_TENANT_EMPLOYEE_ROLE,
          activatedBy: stableActorIdentifier,
        },
      }];
      return input.rules || [];
    }),
  } as unknown as jest.Mocked<IVaultRepository>;
  const clearingHouse = {
    verifyVpToken: jest.fn().mockResolvedValue({
      acr: 'urn:antifraud:acr:openid4vp:employee', amr: ['openid4vp', 'vc'], vpHash: 'hash', ledgerVerified: true,
    }),
  } as unknown as jest.Mocked<IClearingHouseService>;
  return new OpenIdAuthManager(kmsService, tenants, vault, clearingHouse);
}

function buildSameTenantDigitalTwinJob(
  actorDid: string,
  vpToken: string,
  subject: string = SAME_TENANT_RESEARCH_SUBJECT,
): JobRequest {
  return {
    tenantId: SAME_TENANT_ID, jurisdiction: 'CA-BC', sector: 'animal-care', section: 'identity', format: 'openid',
    resourceType: 'smart', action: 'token', id: '', sequence: 0, status: 'DRAFT' as any,
    createdAtTimestamp: Date.now(),
    content: {
      thid: 'same-tenant-digital-twin', iss: 'did:web:device.example', aud: 'did:web:api.acme.org',
      body: {
        sub: actorDid,
        scope: `${ServiceCapability.DigitalTwinReader}?subject=${subject}`,
        purpose: HealthcareConsentPurposes.Research, vp_token: vpToken, acr_values: 'urn:antifraud:acr:openid4vp:employee',
      },
    } as any,
  } as JobRequest;
}

function buildResearchStudyScopedManager(input: Readonly<{
  dcrComplete?: boolean;
  consentStatus?: string;
  consentStudyId?: string;
  consentActorRole?: string;
  bindingRole?: string;
  legacyNativeConsent?: boolean;
  activeLicense?: boolean;
  activeEmployee?: boolean;
}> = {}): OpenIdAuthManager {
  const fixture = RESEARCH_STUDY_ACCESS_FIXTURE;
  const stableActorIdentifier = buildStableActorIdentifier({
    contactKind: 'email', contact: SAME_TENANT_EMPLOYEE_EMAIL,
  });
  const practitionerRoleReference = `PractitionerRole/${fixture.practitionerRoleId}`;
  const consentStudyReference = `ResearchStudy/${input.consentStudyId || fixture.studyId}`;
  const consentClaims = {
    [ClaimConsent.status]: [input.consentStatus || ConsentStatuses.Active],
    [ClaimConsent.decision]: [ConsentDecisions.Permit],
    [ClaimConsent.sourceReference]: [consentStudyReference],
    [ClaimConsent.actorIdentifier]: [practitionerRoleReference],
    [ClaimConsent.actorRole]: [input.consentActorRole || SAME_TENANT_EMPLOYEE_ROLE],
    [ClaimConsent.action]: [buildResearchStudyAccessScope(input.consentStudyId || fixture.studyId)],
    [ClaimConsent.purpose]: [HealthcareConsentPurposes.Research],
  };
  const consentRecord = input.legacyNativeConsent
    ? { resourceType: 'Consent', id: fixture.consentId, status: ConsentStatuses.Active, claims: consentClaims }
    : { claims: consentClaims };
  const kmsService = {
    getPublicVerificationKey: jest.fn().mockResolvedValue({ kid: 'tenant-sig-kid' }),
    createCompactJws: buildMockCompactJws(),
    unprotectConfidentialData: jest.fn(async (record: any) => record?.content || {
      status: input.activeEmployee === false ? 'inactive' : 'active',
      claims: {
        'org.schema.Person.email': SAME_TENANT_EMPLOYEE_EMAIL,
        'org.schema.Person.hasOccupation': SAME_TENANT_EMPLOYEE_ROLE,
      },
    }),
  } as unknown as jest.Mocked<IKmsService>;
  const tenants = {
    getDidDocument: jest.fn().mockResolvedValue({ id: 'did:web:api.acme.org' }),
    tenantExists: jest.fn().mockResolvedValue(true),
    getCollectionName: jest.fn().mockResolvedValue(`animal-care_${SAME_TENANT_ID}`),
    getTenantJurisdiction: jest.fn().mockResolvedValue('CA-BC'),
  } as unknown as jest.Mocked<TenantsCacheManager>;
  const binding = {
    kind: 'professional',
    actorIdentifier: 'urn:uuid:bdb8c91f-5597-46a9-813e-a9242f938c31',
    authorIdentifier: `urn:uuid:${fixture.practitionerRoleId}`,
    ownerIdentifier: SAME_TENANT_ID,
    role: input.bindingRole || SAME_TENANT_EMPLOYEE_ROLE,
    actorDids: [SAME_TENANT_EMPLOYEE_DID],
    dcrClientIds: [fixture.clientId],
  };
  const vault = {
    getContainersInSection: jest.fn(async (_collection: string, section: string) => {
      if (section.includes('employees')) return [{ id: 'active-veterinarian' }];
      if (section.includes('device-licenses') && input.activeLicense !== false) return [{ content: {
        status: 'active', issuedToEmail: SAME_TENANT_EMPLOYEE_EMAIL,
        issuedToRole: SAME_TENANT_EMPLOYEE_ROLE, activatedBy: stableActorIdentifier,
      } }];
      return [];
    }),
    listContainersInSection: jest.fn(async (_collection: string, section: string) => {
      if (section === RESEARCH_STUDY_CONSENT_SECTION) return [{ id: fixture.consentId, content: consentRecord }];
      if (section.includes('clinical_author_identity_bindings')) return [binding];
      return [];
    }),
  } as unknown as jest.Mocked<IVaultRepository>;
  const clearingHouse = {
    verifyVpToken: jest.fn().mockResolvedValue({
      acr: 'urn:antifraud:acr:openid4vp:employee', amr: ['openid4vp', 'vc'], vpHash: 'hash', ledgerVerified: true,
    }),
  } as unknown as jest.Mocked<IClearingHouseService>;
  const manager = new OpenIdAuthManager(kmsService, tenants, vault, clearingHouse);
  (manager as any).validateClientAssertion = jest.fn().mockResolvedValue(
    input.dcrComplete === false ? undefined : { clientId: fixture.clientId },
  );
  return manager;
}

function buildResearchStudyScopedJob(actorDid: string, vpToken: string): JobRequest {
  const fixture = RESEARCH_STUDY_ACCESS_FIXTURE;
  return {
    tenantId: SAME_TENANT_ID, jurisdiction: 'CA-BC', sector: 'animal-care', section: 'identity', format: 'openid',
    resourceType: 'smart', action: 'token', id: '', sequence: 0, status: 'DRAFT' as any,
    createdAtTimestamp: Date.now(),
    content: {
      thid: 'research-study-smart-token', iss: 'did:web:device.example', aud: 'did:web:api.acme.org',
      body: {
        client_id: fixture.clientId,
        client_assertion: 'registered-private-key-jwt',
        client_assertion_type: 'private_key_jwt',
        sub: actorDid,
        scope: buildResearchStudyAccessScope(),
        purpose: HealthcareConsentPurposes.Research,
        vp_token: vpToken,
        acr_values: 'urn:antifraud:acr:openid4vp:employee',
      },
    } as any,
  } as JobRequest;
}

function buildControllerResearchStudyManager(): OpenIdAuthManager {
  const fixture = RESEARCH_STUDY_ACCESS_FIXTURE;
  const kmsService = {
    getPublicVerificationKey: jest.fn().mockResolvedValue({ kid: 'tenant-sig-kid' }),
    createCompactJws: buildMockCompactJws(),
    unprotectConfidentialData: jest.fn(async (record: any) => record?.content),
  } as unknown as jest.Mocked<IKmsService>;
  const tenants = {
    getDidDocument: jest.fn().mockResolvedValue({
      id: 'did:web:api.acme.org',
      controller: [SAME_TENANT_CONTROLLER_DID],
    }),
    tenantExists: jest.fn().mockResolvedValue(true),
    getCollectionName: jest.fn().mockResolvedValue(`animal-care_${SAME_TENANT_ID}`),
    getTenantJurisdiction: jest.fn().mockResolvedValue('CA-BC'),
    getTenantIdentifierUrn: jest.fn().mockResolvedValue(SAME_TENANT_ID),
  } as unknown as jest.Mocked<TenantsCacheManager>;
  const vault = {
    get: jest.fn(async (_collection: string, id: string, section: string) => (
      id === fixture.studyId && section === RESEARCH_STUDY_SECTION
        ? { id, content: { claims: { 'ResearchStudy.status': ['active'] } } }
        : undefined
    )),
    getContainersInSection: jest.fn().mockResolvedValue([]),
    listContainersInSection: jest.fn().mockResolvedValue([]),
  } as unknown as jest.Mocked<IVaultRepository>;
  const clearingHouse = {
    verifyVpToken: jest.fn().mockResolvedValue({
      acr: 'urn:antifraud:acr:openid4vp:organization',
      amr: ['openid4vp', 'vc'],
      vpHash: 'hash',
      ledgerVerified: true,
    }),
  } as unknown as jest.Mocked<IClearingHouseService>;
  return new OpenIdAuthManager(kmsService, tenants, vault, clearingHouse);
}

function buildControllerResearchStudyJob(
  studyId: string = RESEARCH_STUDY_ACCESS_FIXTURE.studyId,
): JobRequest {
  const study = `ResearchStudy/${studyId}`;
  const controllerCredential = {
    ...EXAMPLE_ORG_ACTIVATION_CONTROLLER_CREDENTIAL,
    credentialSubject: {
      ...EXAMPLE_ORG_ACTIVATION_CONTROLLER_CREDENTIAL.credentialSubject,
      id: SAME_TENANT_PUBLIC_ORGANIZATION_DID,
      provider: { identifier: { value: SAME_TENANT_ID } },
      owner: {
        ...EXAMPLE_ORG_ACTIVATION_CONTROLLER_CREDENTIAL.credentialSubject.owner,
        sameAs: parseProfessionalDidIdentity(SAME_TENANT_CONTROLLER_DID)?.stableActorIdentifier,
      },
    },
  };
  const controllerVp = addVC(
    createVP({ iss: SAME_TENANT_CONTROLLER_DID, sub: SAME_TENANT_CONTROLLER_DID }),
    controllerCredential,
  );
  return {
    tenantId: SAME_TENANT_ID, jurisdiction: 'CA-BC', sector: 'animal-care', section: 'identity', format: 'openid',
    resourceType: 'smart', action: 'token', id: '', sequence: 0, status: 'DRAFT' as any,
    createdAtTimestamp: Date.now(),
    content: {
      thid: 'controller-research-study-smart-token', iss: SAME_TENANT_CONTROLLER_DID, aud: 'did:web:api.acme.org',
      body: {
        sub: SAME_TENANT_CONTROLLER_DID,
        scope: `organization/ResearchSubject.c?study=${study}`,
        purpose: HealthcareConsentPurposes.Research,
        vp_token: JSON.stringify(controllerVp),
        acr_values: 'urn:antifraud:acr:openid4vp:organization',
      },
    } as any,
  } as JobRequest;
}

describe('OpenIdAuthManager', () => {
  it('fails closed when a consent expiry is malformed or has reached its boundary', () => {
    const now = Date.parse('2026-08-31T18:30:00Z');
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(now);
    try {
      const isRuleTimeActive = (OpenIdAuthManager.prototype as any).isRuleTimeActive;
      expect(isRuleTimeActive.call({}, {
        [ClaimConsent.status]: ConsentStatuses.Active,
        [ClaimConsent.periodEnd]: 'not-a-date',
      })).toBe(false);
      expect(isRuleTimeActive.call({}, {
        [ClaimConsent.status]: ConsentStatuses.Active,
        [ClaimConsent.periodEnd]: '2026-08-31T18:30:00Z',
      })).toBe(false);
      expect(isRuleTimeActive.call({}, {
        [ClaimConsent.status]: ConsentStatuses.Active,
        [ClaimConsent.periodEnd]: '2026-08-31T18:30:01Z',
      })).toBe(true);
      expect(isRuleTimeActive.call({}, { [ClaimConsent.status]: ConsentStatuses.Draft })).toBe(false);
      expect(isRuleTimeActive.call({}, {})).toBe(false);
    } finally {
      nowSpy.mockRestore();
    }
  });

  it('requires the stored CRUDS operation set to cover every requested SMART operation', () => {
    const parsePermissionExpression = (OpenIdAuthManager.prototype as any).parsePermissionExpression;
    const rulePermissionCoversRequest = (OpenIdAuthManager.prototype as any).rulePermissionCoversRequest;
    const parse = (value: string) => parsePermissionExpression.call({}, value, { allowLegacySectionList: false });

    expect(rulePermissionCoversRequest.call(
      {},
      parse(ServiceCapability.DigitalTwinReader),
      parse(ServiceCapability.DigitalTwinProvider),
    )).toBe(false);
    expect(rulePermissionCoversRequest.call(
      {},
      parse(ServiceCapability.DigitalTwinProvider),
      parse(ServiceCapability.DigitalTwinReader),
    )).toBe(true);
  });

  it('issues only consented sections to an accepted individual member VP', async () => {
    const subjectDid = 'did:web:api.acme.org:individual:subject-example';
    const actorId = 'firebase-member-001';
    const memberPhone = '+34600111222';
    const role = 'v3-RoleCode|RESPRSN';
    const actorDid = `did:web:api.acme.org:family:${actorId}:${role}`;
    const allergySection = HealthcareBasicSections.AllergiesAndIntolerances.attributeValue;
    const requestedScope = buildSmartCompositionReadScope({ subjectDid, sections: '*' });
    const vpToken = buildUnsignedIndividualMemberIdentityVpJwt({
      clientId: actorDid,
      actorDid,
      subjectDid,
      relationship: role,
      telephone: memberPhone,
      additionalPayload: { iss: subjectDid },
    });
    const rules = [{
      [ClaimConsent.subject]: subjectDid,
      [ClaimConsent.decision]: ConsentDecisions.Permit,
      [ClaimConsent.status]: ConsentStatuses.Active,
      [ClaimConsent.actorIdentifier]: `tel:${memberPhone}`,
      [ClaimConsent.actorRole]: role,
      [ClaimConsent.action]: allergySection,
      [ClaimConsent.purpose]: HealthcareConsentPurposes.Treatment,
    }];
    const licenses = [{ content: {
      status: 'active',
      subjectId: actorId,
      authorizedSubjectDid: subjectDid,
      issuedToRole: role,
      issuedToPhone: memberPhone,
    } }];
    const vault = {
      getContainersInSection: jest.fn()
        .mockResolvedValueOnce(licenses)
        .mockResolvedValueOnce(rules),
    } as unknown as jest.Mocked<IVaultRepository>;
    const manager = new OpenIdAuthManager(
      {
        getPublicVerificationKey: jest.fn().mockResolvedValue({ kid: 'tenant-sig-kid' }),
        signWithManagedKey: jest.fn().mockResolvedValue({
          payload: '',
          signatures: [{ protected: 'p', signature: 'sig' }],
        }),
        createCompactJws: buildMockCompactJws(),
      } as unknown as jest.Mocked<IKmsService>,
      {
        getDidDocument: jest.fn().mockResolvedValue({ id: 'did:web:api.acme.org' }),
        tenantExists: jest.fn().mockResolvedValue(true),
      } as unknown as jest.Mocked<TenantsCacheManager>,
      vault,
      { verifyVpToken: jest.fn().mockResolvedValue({
        acr: 'urn:antifraud:acr:openid4vp:individual',
        amr: ['openid4vp', 'vc'],
        vpHash: 'hash',
        ledgerVerified: true,
      }) } as unknown as jest.Mocked<IClearingHouseService>,
    );

    const response = await manager.process({
      tenantId: 'acme', jurisdiction: 'ES', sector: 'health-care',
      section: 'identity', format: 'openid', resourceType: 'smart', action: 'token',
      content: { thid: 'member-smart-token-test', iss: actorDid, aud: 'did:web:api.acme.org', body: {
        sub: actorDid,
        scope: requestedScope,
        purpose: HealthcareConsentPurposes.Treatment,
        vp_token: vpToken,
        acr_values: 'urn:antifraud:acr:openid4vp:individual',
      } },
    } as JobRequest);

    expect(response.body.scope).toBe(buildSmartCompositionReadScope({
      subjectDid,
      sections: allergySection,
    }));
  });

  it('permits a provider-issued controller VC only for its exact animal without a self-consent', async () => {
    const issuerDid = 'did:web:api.acme.org';
    const subjectDid = `${issuerDid}:individual:animal-001`;
    const role = 'v3-RoleCode|RESPRSN';
    const actorDid = `${subjectDid}:family:firebase-controller-001:${role}`;
    const requestedScope = buildSmartCompositionReadScope({ subjectDid, sections: '*' });
    const controllerCredential = {
      ...getIndividualControllerIdentityVC({
        actorDid,
        subjectDid,
        relationship: role,
        authorityBasis: 'animal-controller-onboarding',
        telephone: '+16045550123',
      }),
      issuer: issuerDid,
    };
    const vpToken = buildUnsignedIndividualControllerIdentityVpJwt({
      clientId: actorDid,
      actorDid,
      subjectDid,
      relationship: role,
      verifiableCredential: controllerCredential,
      additionalPayload: { iss: issuerDid, aud: issuerDid },
    });
    const manager = new OpenIdAuthManager(
      {
        getPublicVerificationKey: jest.fn().mockResolvedValue({ kid: 'tenant-sig-kid' }),
        signWithManagedKey: jest.fn().mockResolvedValue({
          payload: '', signatures: [{ protected: 'p', signature: 'sig' }],
        }),
        createCompactJws: buildMockCompactJws(),
      } as unknown as jest.Mocked<IKmsService>,
      {
        getDidDocument: jest.fn().mockResolvedValue({ id: issuerDid }),
        tenantExists: jest.fn().mockResolvedValue(true),
        getCollectionName: jest.fn().mockResolvedValue('tenant-collection'),
      } as unknown as jest.Mocked<TenantsCacheManager>,
      {
        // No Consent exists: exact controller authority is carried by the
        // provider-issued VC after the enclosing VP has been verified.
        getContainersInSection: jest.fn().mockResolvedValue([]),
      } as unknown as jest.Mocked<IVaultRepository>,
      {
        verifyVpToken: jest.fn().mockResolvedValue({
          acr: 'urn:antifraud:acr:openid4vp:individual',
          amr: ['openid4vp', 'vc'],
          vpHash: 'hash',
          ledgerVerified: true,
        }),
      } as unknown as jest.Mocked<IClearingHouseService>,
    );

    const response = await manager.process({
      tenantId: 'acme', jurisdiction: 'CA-BC', sector: 'animal-care',
      section: 'identity', format: 'openid', resourceType: 'smart', action: 'token',
      content: { thid: 'controller-smart-token-test', iss: actorDid, aud: issuerDid, body: {
        sub: actorDid,
        scope: requestedScope,
        purpose: HealthcareConsentPurposes.Treatment,
        vp_token: vpToken,
        acr_values: 'urn:antifraud:acr:openid4vp:individual',
      } },
    } as JobRequest);

    expect(response.body.scope).toBe(requestedScope);
  });

  it('should issue a signed access_token for a tenant (org did rule)', async () => {
    const consentPeriodEnd = new Date(Date.now() + 120_000).toISOString();
    const mockKmsService: jest.Mocked<IKmsService> = {
      init: jest.fn(),
      provisionKeys: jest.fn(),
      getPublicJwks: jest.fn(),
      getPublicVerificationKey: jest.fn().mockResolvedValue({ kid: 'tenant-sig-kid' } as any),
      getPublicEncryptionKey: jest.fn(),
      getHostPublicJwkSet: jest.fn(),
      decodeRequest: jest.fn(),
      signWithManagedKey: jest.fn().mockResolvedValue({
        payload: '',
        signatures: [{ protected: 'p', signature: 'sig' }],
      } as any),
      signWithReconstructedKey: jest.fn(),
      createDetachedJws: jest.fn(),
      createCompactJws: buildMockCompactJws(),
      encodeResponse: jest.fn(),
      protectConfidentialData: jest.fn(),
      unprotectConfidentialData: jest.fn(),
      getHmacBase64Url: jest.fn(),
      protectAttributesNameAndValue: jest.fn(),
    };

    const mockTenantsCacheManager: jest.Mocked<TenantsCacheManager> = {
      getDidDocument: jest.fn().mockResolvedValue({ id: 'did:web:api.acme.org' } as any),
      tenantExists: jest.fn().mockResolvedValue(true),
    } as any;

    const mockVaultRepository: jest.Mocked<IVaultRepository> = {
      createNewVault: jest.fn(),
      vaultExists: jest.fn().mockResolvedValue(true),
      getVaultConfig: jest.fn().mockResolvedValue({ id: 'vault' } as any),
      createNewSection: jest.fn(),
      updateSection: jest.fn(),
      getAllSections: jest.fn(),
      sectionExists: jest.fn(),
      getContainersListInSection: jest.fn(),
      listContainersInSection: jest.fn(),
      getContainersInSection: jest.fn().mockResolvedValue([
        { ...testConsentRulePermitOrgDid, [ClaimConsent.periodEnd]: consentPeriodEnd },
      ] as any),
      put: jest.fn(),
      get: jest.fn(),
      getHistory: jest.fn(),
      query: jest.fn(),
      delete: jest.fn(),
      purge: jest.fn(),
    };

    const mockClearingHouse: jest.Mocked<IClearingHouseService> = {
      verifyVpToken: jest.fn().mockResolvedValue({
        acr: 'urn:antifraud:acr:openid4vp:employee',
        amr: ['openid4vp', 'vc'],
        vpHash: 'hash',
        ledgerVerified: true,
      }),
    };

    const manager = new OpenIdAuthManager(
      mockKmsService,
      mockTenantsCacheManager,
      mockVaultRepository,
      mockClearingHouse,
    );

    const job: JobRequest = {
      tenantId: 'acme',
      jurisdiction: 'es',
      sector: 'health-care',
      section: 'identity',
      format: 'openid',
      resourceType: 'smart',
      action: 'token',
      id: '',
      sequence: 0,
      status: 'DRAFT' as any,
      createdAtTimestamp: Date.now(),
      content: {
        jti: 'jti',
        thid: 'thid',
        iss: 'did:web:device.example',
        aud: 'did:web:api.acme.org',
        body: {
          sub: 'did:web:api.acme.org:employee:doctor1@acme.org:ISCO-08|2211',
          scope: 'organization/Composition.rs?subject=did:web:api.acme.org:individual:123&section=*',
          purpose: 'TREAT',
          expires_in: 300,
          vp_token: 'vp',
          acr_values: 'urn:antifraud:acr:openid4vp:employee',
        },
      } as any,
    };

    const response = await manager.process(job);
    expect(response.body.access_token).toContain('.sig');
    expect(response.body.scope).toBe(buildSmartCompositionReadScope({
      subjectDid: EXAMPLE_INTER_TENANT_ACCESS_CONTRACT_CONTEXT.subjectDid,
      sections: HealthcareBasicSections.AllergiesAndIntolerances.attributeValue,
    }));
    expect(response.body.scope).not.toContain('section=*');
    expect(response.body.ledger_verified).toBe(true);
    expect(response.body.expires_in).toBeGreaterThan(0);
    expect(response.body.expires_in).toBeLessThanOrEqual(120);
    const accessTokenPayload = JSON.parse(Buffer.from(response.body.access_token.split('.')[1], 'base64url').toString('utf8'));
    expect(accessTokenPayload.exp).toBe(response.exp);
    expect(accessTokenPayload.exp).toBeLessThanOrEqual(Math.floor(Date.parse(consentPeriodEnd) / 1000));
    expect(mockKmsService.createCompactJws).toHaveBeenCalledWith(
      expect.objectContaining({
        iss: 'did:web:api.acme.org',
        aud: 'did:web:api.acme.org',
        scope: response.body.scope,
      }),
      'tenant-sig-kid',
      expect.any(String),
      'comm_sig',
      { typ: 'JWT' },
    );
    expect(mockKmsService.signWithManagedKey).not.toHaveBeenCalled();
    expect(mockClearingHouse.verifyVpToken).toHaveBeenCalled();
  });

  it('should match canonical persisted ISCO roles and normalized LOINC section tokens', async () => {
    const acceptedRole = String(testConsentRulePermitOrgDid[ClaimConsent.actorRole]);
    const canonicalRole = getHealthcareRoleByClaim(acceptedRole);
    expect(canonicalRole).toBeDefined();
    const mockKmsService: jest.Mocked<IKmsService> = {
      init: jest.fn(),
      provisionKeys: jest.fn(),
      getPublicJwks: jest.fn(),
      getPublicVerificationKey: jest.fn().mockResolvedValue({ kid: 'tenant-sig-kid' } as any),
      getPublicEncryptionKey: jest.fn(),
      getHostPublicJwkSet: jest.fn(),
      decodeRequest: jest.fn(),
      signWithManagedKey: jest.fn().mockResolvedValue({
        payload: '',
        signatures: [{ protected: 'p', signature: 'sig' }],
      } as any),
      signWithReconstructedKey: jest.fn(),
      createDetachedJws: jest.fn(),
      createCompactJws: buildMockCompactJws(),
      encodeResponse: jest.fn(),
      protectConfidentialData: jest.fn(),
      unprotectConfidentialData: jest.fn(),
      getHmacBase64Url: jest.fn(),
      protectAttributesNameAndValue: jest.fn(),
    };

    const mockTenantsCacheManager: jest.Mocked<TenantsCacheManager> = {
      getDidDocument: jest.fn().mockResolvedValue({ id: 'did:web:api.acme.org' } as any),
      tenantExists: jest.fn().mockResolvedValue(true),
    } as any;

    const mockVaultRepository: jest.Mocked<IVaultRepository> = {
      createNewVault: jest.fn(),
      vaultExists: jest.fn().mockResolvedValue(true),
      getVaultConfig: jest.fn().mockResolvedValue({ id: 'vault' } as any),
      createNewSection: jest.fn(),
      updateSection: jest.fn(),
      getAllSections: jest.fn(),
      sectionExists: jest.fn(),
      getContainersListInSection: jest.fn(),
      listContainersInSection: jest.fn(),
      getContainersInSection: jest.fn().mockResolvedValue([
        {
          ...testConsentRulePermitOrgDid,
          // Consent persistence expands this system alias while the verified
          // professional DID can retain the compact portable spelling.
          [ClaimConsent.actorRole]: `${canonicalRole!.codingSystem}|${canonicalRole!.code}`,
          'Consent.action': 'loinc|48765-2',
        },
      ] as any),
      put: jest.fn(),
      get: jest.fn(),
      getHistory: jest.fn(),
      query: jest.fn(),
      delete: jest.fn(),
      purge: jest.fn(),
    };

    const mockClearingHouse: jest.Mocked<IClearingHouseService> = {
      verifyVpToken: jest.fn().mockResolvedValue({
        acr: 'urn:antifraud:acr:openid4vp:employee',
        amr: ['openid4vp', 'vc'],
        vpHash: 'hash',
        ledgerVerified: true,
      }),
    };

    const manager = new OpenIdAuthManager(
      mockKmsService,
      mockTenantsCacheManager,
      mockVaultRepository,
      mockClearingHouse,
    );

    const response = await manager.process({
      tenantId: 'acme',
      jurisdiction: 'ES',
      sector: 'health-care',
      section: 'identity',
      format: 'openid',
      resourceType: 'smart',
      action: 'token',
      id: '',
      sequence: 0,
      status: 'DRAFT' as any,
      createdAtTimestamp: Date.now(),
      content: {
        thid: 'thid',
        iss: 'did:web:device.example',
        aud: 'did:web:api.acme.org',
        body: {
          sub: 'did:web:api.acme.org:employee:doctor1@acme.org:ISCO-08|2211',
          scope: 'organization/Composition.rs?subject=did:web:api.acme.org:individual:123&section=http://loinc.org|48765-2',
          purpose: 'TREAT',
          vp_token: 'vp',
          acr_values: 'urn:antifraud:acr:openid4vp:employee',
        },
      } as any,
    } as JobRequest);

    expect(response.body.access_token).toBeDefined();
  });

  it('should permit one canonical stored Composition action without organization prefix', async () => {
    const mockKmsService: jest.Mocked<IKmsService> = {
      init: jest.fn(),
      provisionKeys: jest.fn(),
      getPublicJwks: jest.fn(),
      getPublicVerificationKey: jest.fn().mockResolvedValue({ kid: 'tenant-sig-kid' } as any),
      getPublicEncryptionKey: jest.fn(),
      getHostPublicJwkSet: jest.fn(),
      decodeRequest: jest.fn(),
      signWithManagedKey: jest.fn().mockResolvedValue({ payload: '', signatures: [{ protected: 'p', signature: 'sig' }] } as any),
      signWithReconstructedKey: jest.fn(),
      createDetachedJws: jest.fn(),
      createCompactJws: buildMockCompactJws(),
      encodeResponse: jest.fn(),
      protectConfidentialData: jest.fn(),
      unprotectConfidentialData: jest.fn(),
      getHmacBase64Url: jest.fn(),
      protectAttributesNameAndValue: jest.fn(),
    };

    const mockTenantsCacheManager: jest.Mocked<TenantsCacheManager> = {
      getDidDocument: jest.fn().mockResolvedValue({ id: 'did:web:api.acme.org' } as any),
      tenantExists: jest.fn().mockResolvedValue(true),
    } as any;

    const mockVaultRepository: jest.Mocked<IVaultRepository> = {
      createNewVault: jest.fn(),
      vaultExists: jest.fn().mockResolvedValue(true),
      getVaultConfig: jest.fn().mockResolvedValue({ id: 'vault' } as any),
      createNewSection: jest.fn(),
      updateSection: jest.fn(),
      getAllSections: jest.fn(),
      sectionExists: jest.fn(),
      getContainersListInSection: jest.fn(),
      listContainersInSection: jest.fn(),
      getContainersInSection: jest.fn().mockResolvedValue([
        {
          ...testConsentRulePermitOrgDid,
          'Consent.action': 'Composition.rs?section=LOINC|48765-2,LOINC|10160-0',
        },
      ] as any),
      put: jest.fn(),
      get: jest.fn(),
      getHistory: jest.fn(),
      query: jest.fn(),
      delete: jest.fn(),
      purge: jest.fn(),
    };

    const mockClearingHouse: jest.Mocked<IClearingHouseService> = {
      verifyVpToken: jest.fn().mockResolvedValue({
        acr: 'urn:antifraud:acr:openid4vp:employee',
        amr: ['openid4vp', 'vc'],
        vpHash: 'hash',
        ledgerVerified: true,
      }),
    };

    const manager = new OpenIdAuthManager(
      mockKmsService,
      mockTenantsCacheManager,
      mockVaultRepository,
      mockClearingHouse,
    );

    const response = await manager.process({
      tenantId: 'acme',
      jurisdiction: 'ES',
      sector: 'health-care',
      section: 'identity',
      format: 'openid',
      resourceType: 'smart',
      action: 'token',
      id: '',
      sequence: 0,
      status: 'DRAFT' as any,
      createdAtTimestamp: Date.now(),
      content: {
        thid: 'thid',
        iss: 'did:web:device.example',
        aud: 'did:web:api.acme.org',
        body: {
          sub: 'did:web:api.acme.org:employee:doctor1@acme.org:ISCO-08|2211',
          scope: 'organization/Composition.rs?subject=did:web:api.acme.org:individual:123&section=LOINC|10160-0',
          purpose: 'TREAT',
          vp_token: 'vp',
          acr_values: 'urn:antifraud:acr:openid4vp:employee',
        },
      } as any,
    } as JobRequest);

    expect(response.body.access_token).toBeDefined();
  });

  it('should reject patient/Composition root scopes', async () => {
    const mockKmsService: jest.Mocked<IKmsService> = {
      init: jest.fn(),
      provisionKeys: jest.fn(),
      getPublicJwks: jest.fn(),
      getPublicVerificationKey: jest.fn().mockResolvedValue({ kid: 'tenant-sig-kid' } as any),
      getPublicEncryptionKey: jest.fn(),
      getHostPublicJwkSet: jest.fn(),
      decodeRequest: jest.fn(),
      signWithManagedKey: jest.fn(),
      signWithReconstructedKey: jest.fn(),
      createDetachedJws: jest.fn(),
      createCompactJws: buildMockCompactJws(),
      encodeResponse: jest.fn(),
      protectConfidentialData: jest.fn(),
      unprotectConfidentialData: jest.fn(),
      getHmacBase64Url: jest.fn(),
      protectAttributesNameAndValue: jest.fn(),
    };

    const mockTenantsCacheManager: jest.Mocked<TenantsCacheManager> = {
      getDidDocument: jest.fn().mockResolvedValue({ id: 'did:web:api.acme.org' } as any),
      tenantExists: jest.fn().mockResolvedValue(true),
    } as any;

    const mockVaultRepository: jest.Mocked<IVaultRepository> = {
      createNewVault: jest.fn(),
      vaultExists: jest.fn().mockResolvedValue(true),
      getVaultConfig: jest.fn().mockResolvedValue({ id: 'vault' } as any),
      createNewSection: jest.fn(),
      updateSection: jest.fn(),
      getAllSections: jest.fn(),
      sectionExists: jest.fn(),
      getContainersListInSection: jest.fn(),
      listContainersInSection: jest.fn(),
      getContainersInSection: jest.fn(),
      put: jest.fn(),
      get: jest.fn(),
      getHistory: jest.fn(),
      query: jest.fn(),
      delete: jest.fn(),
      purge: jest.fn(),
    } as any;

    const mockClearingHouse: jest.Mocked<IClearingHouseService> = {
      verifyVpToken: jest.fn(),
    };

    const manager = new OpenIdAuthManager(
      mockKmsService,
      mockTenantsCacheManager,
      mockVaultRepository,
      mockClearingHouse,
    );

    await expect(manager.process({
      tenantId: 'acme',
      jurisdiction: 'ES',
      sector: 'health-care',
      section: 'identity',
      format: 'openid',
      resourceType: 'smart',
      action: 'token',
      id: '',
      sequence: 0,
      status: 'DRAFT' as any,
      createdAtTimestamp: Date.now(),
      content: {
        thid: 'thid',
        iss: 'did:web:device.example',
        aud: 'did:web:api.acme.org',
        body: {
          sub: 'did:web:api.acme.org:employee:doctor1@acme.org:ISCO-08|2211',
          scope: 'patient/Composition.rs?subject=did:web:api.acme.org:individual:123&section=LOINC|48765-2',
          purpose: 'TREAT',
          vp_token: 'vp',
          acr_values: 'urn:antifraud:acr:openid4vp:employee',
        },
      } as any,
    } as JobRequest)).rejects.toThrow('patient/* scopes are not accepted');
  });

  it('should reject patient/ResearchSubject root scopes', async () => {
    const mockKmsService: jest.Mocked<IKmsService> = {
      init: jest.fn(),
      provisionKeys: jest.fn(),
      getPublicJwks: jest.fn(),
      getPublicVerificationKey: jest.fn().mockResolvedValue({ kid: 'tenant-sig-kid' } as any),
      getPublicEncryptionKey: jest.fn(),
      getHostPublicJwkSet: jest.fn(),
      decodeRequest: jest.fn(),
      signWithManagedKey: jest.fn(),
      signWithReconstructedKey: jest.fn(),
      createDetachedJws: jest.fn(),
      createCompactJws: buildMockCompactJws(),
      encodeResponse: jest.fn(),
      protectConfidentialData: jest.fn(),
      unprotectConfidentialData: jest.fn(),
      getHmacBase64Url: jest.fn(),
      protectAttributesNameAndValue: jest.fn(),
    };

    const mockTenantsCacheManager: jest.Mocked<TenantsCacheManager> = {
      getDidDocument: jest.fn().mockResolvedValue({ id: 'did:web:api.acme.org' } as any),
      tenantExists: jest.fn().mockResolvedValue(true),
    } as any;

    const mockVaultRepository: jest.Mocked<IVaultRepository> = {
      createNewVault: jest.fn(),
      vaultExists: jest.fn().mockResolvedValue(true),
      getVaultConfig: jest.fn().mockResolvedValue({ id: 'vault' } as any),
      createNewSection: jest.fn(),
      updateSection: jest.fn(),
      getAllSections: jest.fn(),
      sectionExists: jest.fn(),
      getContainersListInSection: jest.fn(),
      listContainersInSection: jest.fn(),
      getContainersInSection: jest.fn(),
      put: jest.fn(),
      get: jest.fn(),
      getHistory: jest.fn(),
      query: jest.fn(),
      delete: jest.fn(),
      purge: jest.fn(),
    } as any;

    const mockClearingHouse: jest.Mocked<IClearingHouseService> = {
      verifyVpToken: jest.fn(),
    };

    const manager = new OpenIdAuthManager(
      mockKmsService,
      mockTenantsCacheManager,
      mockVaultRepository,
      mockClearingHouse,
    );

    await expect(manager.process({
      tenantId: 'acme',
      jurisdiction: 'ES',
      sector: 'health-care',
      section: 'identity',
      format: 'openid',
      resourceType: 'smart',
      action: 'token',
      id: '',
      sequence: 0,
      status: 'DRAFT' as any,
      createdAtTimestamp: Date.now(),
      content: {
        thid: 'thid',
        iss: 'did:web:device.example',
        aud: 'did:web:api.acme.org',
        body: {
          sub: EXAMPLE_INTER_TENANT_ACCESS_CONTRACT_CONSUMER_PROFESSIONAL_DID,
          scope: `patient/ResearchSubject.rs?subject=${EXAMPLE_INTER_TENANT_ACCESS_CONTRACT_CONTEXT.subjectDid}`,
          purpose: HealthcareConsentPurposes.Research,
          vp_token: 'vp',
          acr_values: 'urn:antifraud:acr:openid4vp:employee',
        },
      } as any,
    } as JobRequest)).rejects.toThrow('patient/* scopes are not accepted');
  });

  it('should permit when rule is jurisdiction urn (ES)', async () => {
    const mockKmsService: jest.Mocked<IKmsService> = {
      init: jest.fn(),
      provisionKeys: jest.fn(),
      getPublicJwks: jest.fn(),
      getPublicVerificationKey: jest.fn().mockResolvedValue({ kid: 'tenant-sig-kid' } as any),
      getPublicEncryptionKey: jest.fn(),
      getHostPublicJwkSet: jest.fn(),
      decodeRequest: jest.fn(),
      signWithManagedKey: jest.fn().mockResolvedValue({ payload: '', signatures: [{ protected: 'p', signature: 'sig' }] } as any),
      signWithReconstructedKey: jest.fn(),
      createDetachedJws: jest.fn(),
      createCompactJws: buildMockCompactJws(),
      encodeResponse: jest.fn(),
      protectConfidentialData: jest.fn(),
      unprotectConfidentialData: jest.fn(),
      getHmacBase64Url: jest.fn(),
      protectAttributesNameAndValue: jest.fn(),
    };

    const mockTenantsCacheManager: jest.Mocked<TenantsCacheManager> = {
      getDidDocument: jest.fn().mockResolvedValue({ id: 'did:web:api.acme.org' } as any),
      tenantExists: jest.fn().mockResolvedValue(true),
    } as any;

    const mockVaultRepository: jest.Mocked<IVaultRepository> = {
      createNewVault: jest.fn(),
      vaultExists: jest.fn().mockResolvedValue(true),
      getVaultConfig: jest.fn().mockResolvedValue({ id: 'vault' } as any),
      createNewSection: jest.fn(),
      updateSection: jest.fn(),
      getAllSections: jest.fn(),
      sectionExists: jest.fn(),
      getContainersListInSection: jest.fn(),
      listContainersInSection: jest.fn(),
      getContainersInSection: jest.fn().mockResolvedValue([{ ...testConsentRulePermitJurisdiction }] as any),
      put: jest.fn(),
      get: jest.fn(),
      getHistory: jest.fn(),
      query: jest.fn(),
      delete: jest.fn(),
      purge: jest.fn(),
    };

    const mockClearingHouse: jest.Mocked<IClearingHouseService> = {
      verifyVpToken: jest.fn().mockResolvedValue({
        acr: 'urn:antifraud:acr:openid4vp:employee',
        amr: ['openid4vp', 'vc'],
        vpHash: 'hash',
        ledgerVerified: true,
      }),
    };

    const manager = new OpenIdAuthManager(
      mockKmsService,
      mockTenantsCacheManager,
      mockVaultRepository,
      mockClearingHouse,
    );
    const response = await manager.process({
      tenantId: 'acme',
      jurisdiction: 'ES',
      sector: 'health-care',
      section: 'identity',
      format: 'openid',
      resourceType: 'smart',
      action: 'token',
      id: '',
      sequence: 0,
      status: 'DRAFT' as any,
      createdAtTimestamp: Date.now(),
      content: {
        thid: 'thid',
        iss: 'did:web:device.example',
        aud: 'did:web:api.acme.org',
        body: {
          sub: 'did:web:api.acme.org:employee:doctor1@acme.org:ISCO-08|2211',
          scope: 'organization/Composition.rs?subject=did:web:api.acme.org:individual:123&section=LOINC|48765-2',
          purpose: 'TREAT',
          vp_token: 'vp',
          acr_values: 'urn:antifraud:acr:openid4vp:employee',
        },
      } as any,
    } as JobRequest);
    expect(response.body.access_token).toBeDefined();
  });

  it('should permit when rule is email with wildcard role', async () => {
    const mockKmsService: jest.Mocked<IKmsService> = {
      init: jest.fn(),
      provisionKeys: jest.fn(),
      getPublicJwks: jest.fn(),
      getPublicVerificationKey: jest.fn().mockResolvedValue({ kid: 'tenant-sig-kid' } as any),
      getPublicEncryptionKey: jest.fn(),
      getHostPublicJwkSet: jest.fn(),
      decodeRequest: jest.fn(),
      signWithManagedKey: jest.fn().mockResolvedValue({ payload: '', signatures: [{ protected: 'p', signature: 'sig' }] } as any),
      signWithReconstructedKey: jest.fn(),
      createDetachedJws: jest.fn(),
      createCompactJws: buildMockCompactJws(),
      encodeResponse: jest.fn(),
      protectConfidentialData: jest.fn(),
      unprotectConfidentialData: jest.fn(),
      getHmacBase64Url: jest.fn(),
      protectAttributesNameAndValue: jest.fn(),
    };

    const mockTenantsCacheManager: jest.Mocked<TenantsCacheManager> = {
      getDidDocument: jest.fn().mockResolvedValue({ id: 'did:web:api.acme.org' } as any),
      tenantExists: jest.fn().mockResolvedValue(true),
    } as any;

    const mockVaultRepository: jest.Mocked<IVaultRepository> = {
      createNewVault: jest.fn(),
      vaultExists: jest.fn().mockResolvedValue(true),
      getVaultConfig: jest.fn().mockResolvedValue({ id: 'vault' } as any),
      createNewSection: jest.fn(),
      updateSection: jest.fn(),
      getAllSections: jest.fn(),
      sectionExists: jest.fn(),
      getContainersListInSection: jest.fn(),
      listContainersInSection: jest.fn(),
      getContainersInSection: jest.fn().mockResolvedValue([{ ...testConsentRulePermitEmailWildcardRole }] as any),
      put: jest.fn(),
      get: jest.fn(),
      getHistory: jest.fn(),
      query: jest.fn(),
      delete: jest.fn(),
      purge: jest.fn(),
    };

    const mockClearingHouse: jest.Mocked<IClearingHouseService> = {
      verifyVpToken: jest.fn().mockResolvedValue({
        acr: 'urn:antifraud:acr:openid4vp:employee',
        amr: ['openid4vp', 'vc'],
        vpHash: 'hash',
        ledgerVerified: true,
      }),
    };

    const manager = new OpenIdAuthManager(
      mockKmsService,
      mockTenantsCacheManager,
      mockVaultRepository,
      mockClearingHouse,
    );
    const response = await manager.process({
      tenantId: 'acme',
      jurisdiction: 'ES',
      sector: 'health-care',
      section: 'identity',
      format: 'openid',
      resourceType: 'smart',
      action: 'token',
      id: '',
      sequence: 0,
      status: 'DRAFT' as any,
      createdAtTimestamp: Date.now(),
      content: {
        thid: 'thid',
        iss: 'did:web:device.example',
        aud: 'did:web:api.acme.org',
        body: {
          sub: 'did:web:api.acme.org:employee:doctor1@acme.org:ISCO-08|2211',
          scope: 'organization/Composition.rs?subject=did:web:api.acme.org:individual:123&section=LOINC|48765-2',
          purpose: 'TREAT',
          vp_token: 'vp',
          acr_values: 'urn:antifraud:acr:openid4vp:employee',
        },
      } as any,
    } as JobRequest);
    expect(response.body.access_token).toBeDefined();
  });

  it('should permit when rule actor-role is a comma-separated list and one role matches', async () => {
    const mockKmsService: jest.Mocked<IKmsService> = {
      init: jest.fn(),
      provisionKeys: jest.fn(),
      getPublicJwks: jest.fn(),
      getPublicVerificationKey: jest.fn().mockResolvedValue({ kid: 'tenant-sig-kid' } as any),
      getPublicEncryptionKey: jest.fn(),
      getHostPublicJwkSet: jest.fn(),
      decodeRequest: jest.fn(),
      signWithManagedKey: jest.fn().mockResolvedValue({ payload: '', signatures: [{ protected: 'p', signature: 'sig' }] } as any),
      signWithReconstructedKey: jest.fn(),
      createDetachedJws: jest.fn(),
      createCompactJws: buildMockCompactJws(),
      encodeResponse: jest.fn(),
      protectConfidentialData: jest.fn(),
      unprotectConfidentialData: jest.fn(),
      getHmacBase64Url: jest.fn(),
      protectAttributesNameAndValue: jest.fn(),
    };

    const mockTenantsCacheManager: jest.Mocked<TenantsCacheManager> = {
      getDidDocument: jest.fn().mockResolvedValue({ id: 'did:web:api.acme.org' } as any),
      tenantExists: jest.fn().mockResolvedValue(true),
    } as any;

    const mockVaultRepository: jest.Mocked<IVaultRepository> = {
      createNewVault: jest.fn(),
      vaultExists: jest.fn().mockResolvedValue(true),
      getVaultConfig: jest.fn().mockResolvedValue({ id: 'vault' } as any),
      createNewSection: jest.fn(),
      updateSection: jest.fn(),
      getAllSections: jest.fn(),
      sectionExists: jest.fn(),
      getContainersListInSection: jest.fn(),
      listContainersInSection: jest.fn(),
      getContainersInSection: jest.fn().mockResolvedValue([{ ...testConsentRulePermitOrgDidMultiRole }] as any),
      put: jest.fn(),
      get: jest.fn(),
      getHistory: jest.fn(),
      query: jest.fn(),
      delete: jest.fn(),
      purge: jest.fn(),
    };

    const mockClearingHouse: jest.Mocked<IClearingHouseService> = {
      verifyVpToken: jest.fn().mockResolvedValue({
        acr: 'urn:antifraud:acr:openid4vp:employee',
        amr: ['openid4vp', 'vc'],
        vpHash: 'hash',
        ledgerVerified: true,
      }),
    };

    const manager = new OpenIdAuthManager(
      mockKmsService,
      mockTenantsCacheManager,
      mockVaultRepository,
      mockClearingHouse,
    );

    const response = await manager.process({
      tenantId: 'acme',
      jurisdiction: 'ES',
      sector: 'health-care',
      section: 'identity',
      format: 'openid',
      resourceType: 'smart',
      action: 'token',
      id: '',
      sequence: 0,
      status: 'DRAFT' as any,
      createdAtTimestamp: Date.now(),
      content: {
        thid: 'thid',
        iss: 'did:web:device.example',
        aud: 'did:web:api.acme.org',
        body: {
          sub: 'did:web:api.acme.org:employee:doctor1@acme.org:ISCO-08|2211',
          scope: 'organization/Composition.rs?subject=did:web:api.acme.org:individual:123&section=LOINC|48765-2',
          purpose: 'TREAT',
          vp_token: 'vp',
          acr_values: 'urn:antifraud:acr:openid4vp:employee',
        },
      } as any,
    } as JobRequest);

    expect(response.body.access_token).toBeDefined();
  });

  it('should reject when vp_token is missing', async () => {
    const mockKmsService: jest.Mocked<IKmsService> = {
      init: jest.fn(),
      provisionKeys: jest.fn(),
      getPublicJwks: jest.fn(),
      getPublicVerificationKey: jest.fn().mockResolvedValue({ kid: 'tenant-sig-kid' } as any),
      getPublicEncryptionKey: jest.fn(),
      getHostPublicJwkSet: jest.fn(),
      decodeRequest: jest.fn(),
      signWithManagedKey: jest.fn(),
      signWithReconstructedKey: jest.fn(),
      createDetachedJws: jest.fn(),
      createCompactJws: buildMockCompactJws(),
      encodeResponse: jest.fn(),
      protectConfidentialData: jest.fn(),
      unprotectConfidentialData: jest.fn(),
      getHmacBase64Url: jest.fn(),
      protectAttributesNameAndValue: jest.fn(),
    };

    const mockTenantsCacheManager: jest.Mocked<TenantsCacheManager> = {
      getDidDocument: jest.fn().mockResolvedValue({ id: 'did:web:api.acme.org' } as any),
      tenantExists: jest.fn().mockResolvedValue(true),
    } as any;

    const mockVaultRepository: jest.Mocked<IVaultRepository> = {
      createNewVault: jest.fn(),
      vaultExists: jest.fn().mockResolvedValue(true),
      getVaultConfig: jest.fn().mockResolvedValue({ id: 'vault' } as any),
      createNewSection: jest.fn(),
      updateSection: jest.fn(),
      getAllSections: jest.fn(),
      sectionExists: jest.fn(),
      getContainersListInSection: jest.fn(),
      listContainersInSection: jest.fn(),
      getContainersInSection: jest.fn().mockResolvedValue([{ ...testConsentRulePermitOrgDid }] as any),
      put: jest.fn(),
      get: jest.fn(),
      getHistory: jest.fn(),
      query: jest.fn(),
      delete: jest.fn(),
      purge: jest.fn(),
    };

    const mockClearingHouse: jest.Mocked<IClearingHouseService> = {
      verifyVpToken: jest.fn(),
    };

    const manager = new OpenIdAuthManager(
      mockKmsService,
      mockTenantsCacheManager,
      mockVaultRepository,
      mockClearingHouse,
    );

    await expect(manager.process({
      tenantId: 'acme',
      jurisdiction: 'ES',
      sector: 'health-care',
      section: 'identity',
      format: 'openid',
      resourceType: 'smart',
      action: 'token',
      id: '',
      sequence: 0,
      status: 'DRAFT' as any,
      createdAtTimestamp: Date.now(),
      content: {
        thid: 'thid',
        iss: 'did:web:device.example',
        aud: 'did:web:api.acme.org',
        body: {
          sub: 'did:web:api.acme.org:employee:doctor1@acme.org:ISCO-08|2211',
          scope: 'organization/Composition.rs?subject=did:web:api.acme.org:individual:123&section=LOINC|48765-2',
          purpose: 'TREAT',
          acr_values: 'urn:antifraud:acr:openid4vp:employee',
        },
      } as any,
    } as JobRequest)).rejects.toThrow("Missing 'vp_token'");
  });

  it('should deny when a direct physician deny overrides a broader organization allow', async () => {
    const mockKmsService: jest.Mocked<IKmsService> = {
      init: jest.fn(),
      provisionKeys: jest.fn(),
      getPublicJwks: jest.fn(),
      getPublicVerificationKey: jest.fn().mockResolvedValue({ kid: 'tenant-sig-kid' } as any),
      getPublicEncryptionKey: jest.fn(),
      getHostPublicJwkSet: jest.fn(),
      decodeRequest: jest.fn(),
      signWithManagedKey: jest.fn(),
      signWithReconstructedKey: jest.fn(),
      createDetachedJws: jest.fn(),
      createCompactJws: buildMockCompactJws(),
      encodeResponse: jest.fn(),
      protectConfidentialData: jest.fn(),
      unprotectConfidentialData: jest.fn(),
      getHmacBase64Url: jest.fn(),
      protectAttributesNameAndValue: jest.fn(),
    };

    const mockTenantsCacheManager: jest.Mocked<TenantsCacheManager> = {
      getDidDocument: jest.fn().mockResolvedValue({ id: 'did:web:api.acme.org' } as any),
      tenantExists: jest.fn().mockResolvedValue(true),
    } as any;

    const mockVaultRepository: jest.Mocked<IVaultRepository> = {
      createNewVault: jest.fn(),
      vaultExists: jest.fn().mockResolvedValue(true),
      getVaultConfig: jest.fn().mockResolvedValue({ id: 'vault' } as any),
      createNewSection: jest.fn(),
      updateSection: jest.fn(),
      getAllSections: jest.fn(),
      sectionExists: jest.fn(),
      getContainersListInSection: jest.fn(),
      listContainersInSection: jest.fn(),
      getContainersInSection: jest.fn().mockResolvedValue([
        { ...testConsentRulePermitOrgDid },
        {
          ...testConsentRulePermitEmailWildcardRole,
          'Consent.decision': 'deny',
          'Consent.actor-role': 'ISCO-08|2211',
        },
      ] as any),
      put: jest.fn(),
      get: jest.fn(),
      getHistory: jest.fn(),
      query: jest.fn(),
      delete: jest.fn(),
      purge: jest.fn(),
    };

    const mockClearingHouse: jest.Mocked<IClearingHouseService> = {
      verifyVpToken: jest.fn().mockResolvedValue({
        acr: 'urn:antifraud:acr:openid4vp:employee',
        amr: ['openid4vp', 'vc'],
        vpHash: 'hash',
        ledgerVerified: true,
      }),
    };

    const manager = new OpenIdAuthManager(
      mockKmsService,
      mockTenantsCacheManager,
      mockVaultRepository,
      mockClearingHouse,
    );

    await expect(manager.process({
      tenantId: 'acme',
      jurisdiction: 'ES',
      sector: 'health-care',
      section: 'identity',
      format: 'openid',
      resourceType: 'smart',
      action: 'token',
      id: '',
      sequence: 0,
      status: 'DRAFT' as any,
      createdAtTimestamp: Date.now(),
      content: {
        thid: 'thid',
        iss: 'did:web:device.example',
        aud: 'did:web:api.acme.org',
        body: {
          sub: 'did:web:api.acme.org:employee:doctor1@acme.org:ISCO-08|2211',
          scope: 'organization/Composition.rs?subject=did:web:api.acme.org:individual:123&section=LOINC|48765-2',
          purpose: 'TREAT',
          vp_token: 'vp',
          acr_values: 'urn:antifraud:acr:openid4vp:employee',
        },
      } as any,
    } as JobRequest)).rejects.toThrow('No matching consent rule found for requested scope.');
  });

  it('should permit a related person targeted directly by email', async () => {
    const mockKmsService: jest.Mocked<IKmsService> = {
      init: jest.fn(),
      provisionKeys: jest.fn(),
      getPublicJwks: jest.fn(),
      getPublicVerificationKey: jest.fn().mockResolvedValue({ kid: 'tenant-sig-kid' } as any),
      getPublicEncryptionKey: jest.fn(),
      getHostPublicJwkSet: jest.fn(),
      decodeRequest: jest.fn(),
      signWithManagedKey: jest.fn().mockResolvedValue({ payload: '', signatures: [{ protected: 'p', signature: 'sig' }] } as any),
      signWithReconstructedKey: jest.fn(),
      createDetachedJws: jest.fn(),
      createCompactJws: buildMockCompactJws(),
      encodeResponse: jest.fn(),
      protectConfidentialData: jest.fn(),
      unprotectConfidentialData: jest.fn(),
      getHmacBase64Url: jest.fn(),
      protectAttributesNameAndValue: jest.fn(),
    };

    const mockTenantsCacheManager: jest.Mocked<TenantsCacheManager> = {
      getDidDocument: jest.fn().mockResolvedValue({ id: 'did:web:api.acme.org' } as any),
      tenantExists: jest.fn().mockResolvedValue(true),
    } as any;

    const mockVaultRepository: jest.Mocked<IVaultRepository> = {
      createNewVault: jest.fn(),
      vaultExists: jest.fn().mockResolvedValue(true),
      getVaultConfig: jest.fn().mockResolvedValue({ id: 'vault' } as any),
      createNewSection: jest.fn(),
      updateSection: jest.fn(),
      getAllSections: jest.fn(),
      sectionExists: jest.fn(),
      getContainersListInSection: jest.fn(),
      listContainersInSection: jest.fn(),
      getContainersInSection: jest.fn().mockResolvedValue([
        {
          ...testConsentRulePermitEmailWildcardRole,
          'Consent.actor-identifier': 'guardian@example.org',
          'Consent.actor-role': 'v3-RoleCode|RESPRSN',
        },
      ] as any),
      put: jest.fn(),
      get: jest.fn(),
      getHistory: jest.fn(),
      query: jest.fn(),
      delete: jest.fn(),
      purge: jest.fn(),
    };

    const mockClearingHouse: jest.Mocked<IClearingHouseService> = {
      verifyVpToken: jest.fn().mockResolvedValue({
        acr: 'urn:antifraud:acr:openid4vp:employee',
        amr: ['openid4vp', 'vc'],
        vpHash: 'hash',
        ledgerVerified: true,
      }),
    };

    const manager = new OpenIdAuthManager(
      mockKmsService,
      mockTenantsCacheManager,
      mockVaultRepository,
      mockClearingHouse,
    );

    const response = await manager.process({
      tenantId: 'acme',
      jurisdiction: 'ES',
      sector: 'health-care',
      section: 'identity',
      format: 'openid',
      resourceType: 'smart',
      action: 'token',
      id: '',
      sequence: 0,
      status: 'DRAFT' as any,
      createdAtTimestamp: Date.now(),
      content: {
        thid: 'thid',
        iss: 'did:web:device.example',
        aud: 'did:web:api.acme.org',
        body: {
          sub: 'did:web:api.acme.org:family:guardian@example.org:v3-RoleCode|RESPRSN',
          scope: 'organization/Composition.rs?subject=did:web:api.acme.org:individual:123&section=LOINC|48765-2',
          purpose: 'TREAT',
          vp_token: 'vp',
          acr_values: 'urn:antifraud:acr:openid4vp:employee',
        },
      } as any,
    } as JobRequest);

    expect(response.body.access_token).toBeDefined();
  });

  it('should require and accept a matching inter-tenant contract for a foreign organization actor', async () => {
    const mockKmsService: jest.Mocked<IKmsService> = {
      init: jest.fn(),
      provisionKeys: jest.fn(),
      getPublicJwks: jest.fn(),
      getPublicVerificationKey: jest.fn().mockResolvedValue({ kid: 'tenant-sig-kid' } as any),
      getPublicEncryptionKey: jest.fn(),
      getHostPublicJwkSet: jest.fn(),
      decodeRequest: jest.fn(),
      signWithManagedKey: jest.fn().mockResolvedValue({ payload: '', signatures: [{ protected: 'p', signature: 'sig' }] } as any),
      signWithReconstructedKey: jest.fn(),
      createDetachedJws: jest.fn(),
      createCompactJws: buildMockCompactJws(),
      encodeResponse: jest.fn(),
      protectConfidentialData: jest.fn(),
      unprotectConfidentialData: jest.fn(),
      getHmacBase64Url: jest.fn(),
      protectAttributesNameAndValue: jest.fn(),
    };

    const mockTenantsCacheManager: jest.Mocked<TenantsCacheManager> = {
      getDidDocument: jest.fn().mockResolvedValue({ id: 'did:web:api.acme.org' } as any),
      tenantExists: jest.fn().mockResolvedValue(true),
    } as any;

    const mockVaultRepository: jest.Mocked<IVaultRepository> = {
      createNewVault: jest.fn(),
      vaultExists: jest.fn().mockResolvedValue(true),
      getVaultConfig: jest.fn().mockResolvedValue({ id: 'vault' } as any),
      createNewSection: jest.fn(),
      updateSection: jest.fn(),
      getAllSections: jest.fn(),
      sectionExists: jest.fn(),
      getContainersListInSection: jest.fn(),
      listContainersInSection: jest.fn(),
      getContainersInSection: jest.fn().mockResolvedValue([
        {
          ...testConsentRulePermitOrgDid,
          'Consent.actor-identifier': EXAMPLE_INTER_TENANT_ACCESS_CONTRACT_CONTEXT.consumerOrganizationDid,
          'Consent.purpose': EXAMPLE_INTER_TENANT_ACCESS_CONTRACT_CONTEXT.purpose,
          'Consent.action': `${ServiceCapability.DigitalTwinReader}?subject=*`,
        },
      ] as any),
      put: jest.fn(),
      get: jest.fn(),
      getHistory: jest.fn(),
      query: jest.fn(),
      delete: jest.fn(),
      purge: jest.fn(),
    };

    const mockClearingHouse: jest.Mocked<IClearingHouseService> = {
      verifyVpToken: jest.fn().mockResolvedValue({
        acr: 'urn:antifraud:acr:openid4vp:employee',
        amr: ['openid4vp', 'vc'],
        vpHash: 'hash',
        ledgerVerified: true,
      }),
    };

    const vpPayload = createVP({
      iss: EXAMPLE_INTER_TENANT_ACCESS_CONTRACT_CONTEXT.consumerOrganizationDid,
      sub: EXAMPLE_INTER_TENANT_ACCESS_CONTRACT_CONSUMER_PROFESSIONAL_DID,
    });
    addVC(vpPayload, EXAMPLE_INTER_TENANT_DIGITAL_TWIN_CONTRACT_CREDENTIAL);

    const manager = new OpenIdAuthManager(
      mockKmsService,
      mockTenantsCacheManager,
      mockVaultRepository,
      mockClearingHouse,
    );

    const response = await manager.process({
      tenantId: 'acme',
      jurisdiction: 'ES',
      sector: 'health-care',
      section: 'identity',
      format: 'openid',
      resourceType: 'smart',
      action: 'token',
      id: '',
      sequence: 0,
      status: 'DRAFT' as any,
      createdAtTimestamp: Date.now(),
      content: {
        thid: 'thid',
        iss: 'did:web:device.example',
        aud: 'did:web:api.acme.org',
        body: {
          sub: EXAMPLE_INTER_TENANT_ACCESS_CONTRACT_CONSUMER_PROFESSIONAL_DID,
          scope: EXAMPLE_INTER_TENANT_DIGITAL_TWIN_SCOPE,
          purpose: EXAMPLE_INTER_TENANT_ACCESS_CONTRACT_CONTEXT.purpose,
          vp_token: JSON.stringify(vpPayload),
          acr_values: 'urn:antifraud:acr:openid4vp:employee',
        },
      } as any,
    } as JobRequest);

    expect(response.body.access_token).toBeDefined();
  });

  it('denies DigitalTwinReader to a verified employee of the provider tenant without a consent rule', async () => {
    const actorDid = SAME_TENANT_EMPLOYEE_DID;
    const vpToken = buildUnsignedProfessionalIdentityVpJwt({
      clientId: actorDid, actorDid, role: SAME_TENANT_EMPLOYEE_ROLE,
      email: SAME_TENANT_EMPLOYEE_EMAIL,
    });
    await expect(buildSameTenantDigitalTwinManager().process(
      buildSameTenantDigitalTwinJob(actorDid, vpToken),
    )).rejects.toThrow('No matching consent rule found');
  });

  it('issues DigitalTwinReader to a verified provider employee only with an active matching consent rule', async () => {
    const actorDid = SAME_TENANT_EMPLOYEE_DID;
    const vpToken = buildUnsignedProfessionalIdentityVpJwt({
      clientId: actorDid, actorDid, role: SAME_TENANT_EMPLOYEE_ROLE,
      email: SAME_TENANT_EMPLOYEE_EMAIL,
    });
    const response = await buildSameTenantDigitalTwinManager({
      rules: [buildSameTenantResearchConsent(actorDid)],
    }).process(buildSameTenantDigitalTwinJob(actorDid, vpToken));

    expect(response.body.access_token).toBeDefined();
    expect(response.body.scope).toContain(ServiceCapability.DigitalTwinReader);
  });

  it('issues wildcard DigitalTwinReader only when a subject-specific active permit targets the provider organization', async () => {
    const actorDid = SAME_TENANT_EMPLOYEE_DID;
    const vpToken = buildUnsignedProfessionalIdentityVpJwt({
      clientId: actorDid, actorDid, role: SAME_TENANT_EMPLOYEE_ROLE,
      email: SAME_TENANT_EMPLOYEE_EMAIL,
    });
    const response = await buildSameTenantDigitalTwinManager({
      rules: [{
        ...buildSameTenantResearchConsent(SAME_TENANT_PUBLIC_ORGANIZATION_DID),
        [ClaimConsent.subject]: SAME_TENANT_RESEARCH_SUBJECT,
        [ClaimConsent.actorRole]: '*',
      }],
    }).process(buildSameTenantDigitalTwinJob(actorDid, vpToken, '*'));

    expect(response.body.access_token).toBeDefined();
    expect(response.body.scope).toBe(`${ServiceCapability.DigitalTwinReader}?subject=*`);
  });

  it('denies wildcard DigitalTwinReader when subject-specific permits target another organization', async () => {
    const actorDid = SAME_TENANT_EMPLOYEE_DID;
    const vpToken = buildUnsignedProfessionalIdentityVpJwt({
      clientId: actorDid, actorDid, role: SAME_TENANT_EMPLOYEE_ROLE,
      email: SAME_TENANT_EMPLOYEE_EMAIL,
    });
    const manager = buildSameTenantDigitalTwinManager({
      rules: [buildSameTenantResearchConsent('did:web:another-provider.example')],
    });

    await expect(manager.process(buildSameTenantDigitalTwinJob(actorDid, vpToken, '*')))
      .rejects.toThrow('No matching consent rule found');
  });

  it('issues the exact study-scoped ResearchSubject crus token only to its DCR-bound PractitionerRole with active Consent', async () => {
    const actorDid = SAME_TENANT_EMPLOYEE_DID;
    const vpToken = buildUnsignedProfessionalIdentityVpJwt({
      clientId: actorDid, actorDid, role: SAME_TENANT_EMPLOYEE_ROLE,
      email: SAME_TENANT_EMPLOYEE_EMAIL,
    });
    const scope = buildResearchStudyAccessScope();
    const manager = buildResearchStudyScopedManager({ consentStatus: ConsentStatuses.Active });

    const response = await manager.process(buildResearchStudyScopedJob(actorDid, vpToken));

    expect(response.body.scope).toBe(scope);
    expect(response.body.subject).toBe(`ResearchStudy/${RESEARCH_STUDY_ACCESS_FIXTURE.studyId}`);
    const tokenPayload = JSON.parse(Buffer.from(
      String(response.body.access_token).split('.')[1],
      'base64url',
    ).toString('utf8'));
    expect(tokenPayload).toEqual(expect.objectContaining({
      sub: actorDid,
      purpose: HealthcareConsentPurposes.Research,
      study: `ResearchStudy/${RESEARCH_STUDY_ACCESS_FIXTURE.studyId}`,
    }));
  });

  it('issues exact ResearchSubject create scope to the current tenant controller for an existing study', async () => {
    const response = await buildControllerResearchStudyManager().process(
      buildControllerResearchStudyJob(),
    );

    expect(response.body.scope).toBe(
      `organization/ResearchSubject.c?study=ResearchStudy/${RESEARCH_STUDY_ACCESS_FIXTURE.studyId}`,
    );
    const tokenPayload = JSON.parse(Buffer.from(
      String(response.body.access_token).split('.')[1],
      'base64url',
    ).toString('utf8'));
    expect(tokenPayload).toEqual(expect.objectContaining({
      sub: SAME_TENANT_CONTROLLER_DID,
      purpose: HealthcareConsentPurposes.Research,
      study: `ResearchStudy/${RESEARCH_STUDY_ACCESS_FIXTURE.studyId}`,
    }));
  });

  it('denies controller ResearchSubject creation for a missing study or non-controller actor', async () => {
    await expect(buildControllerResearchStudyManager().process(
      buildControllerResearchStudyJob('missing-study'),
    )).rejects.toThrow('ResearchStudy');

    const request = buildControllerResearchStudyJob();
    await expect(buildControllerResearchStudyManager().process({
      ...request,
      content: {
        ...request.content,
        iss: SAME_TENANT_EMPLOYEE_DID,
        body: { ...(request.content as any).body, sub: SAME_TENANT_EMPLOYEE_DID },
      },
    } as JobRequest)).rejects.toThrow('controller');
  });

  it.each([
    ['missing DCR', { dcrComplete: false }],
    ['draft Consent', { consentStatus: ConsentStatuses.Draft }],
    ['wrong study Consent', { consentStudyId: 'another-study' }],
    ['legacy native Consent storage', { legacyNativeConsent: true }],
    ['Consent role different from the binding', { consentActorRole: 'ISCO-08|2211' }],
    ['inactive professional licence', { activeLicense: false }],
  ])('denies study-scoped SMART for %s', async (_caseName, options) => {
    const actorDid = SAME_TENANT_EMPLOYEE_DID;
    const vpToken = buildUnsignedProfessionalIdentityVpJwt({
      clientId: actorDid, actorDid, role: SAME_TENANT_EMPLOYEE_ROLE,
      email: SAME_TENANT_EMPLOYEE_EMAIL,
    });
    await expect(buildResearchStudyScopedManager(options).process(
      buildResearchStudyScopedJob(actorDid, vpToken),
    )).rejects.toThrow();
  });

  it('denies study-scoped SMART when delete is requested or route jurisdiction differs from the tenant', async () => {
    const actorDid = SAME_TENANT_EMPLOYEE_DID;
    const vpToken = buildUnsignedProfessionalIdentityVpJwt({
      clientId: actorDid, actorDid, role: SAME_TENANT_EMPLOYEE_ROLE,
      email: SAME_TENANT_EMPLOYEE_EMAIL,
    });
    await expect(buildResearchStudyScopedManager().process({
      ...buildResearchStudyScopedJob(actorDid, vpToken),
      content: {
        ...buildResearchStudyScopedJob(actorDid, vpToken).content,
        body: {
          ...(buildResearchStudyScopedJob(actorDid, vpToken).content as any).body,
          scope: buildResearchStudyAccessScope(RESEARCH_STUDY_ACCESS_FIXTURE.studyId, 'cruds'),
        },
      },
    } as JobRequest)).rejects.toThrow('delete');

    await expect(buildResearchStudyScopedManager().process({
      ...buildResearchStudyScopedJob(actorDid, vpToken), jurisdiction: 'CA-ON',
    } as JobRequest)).rejects.toThrow('jurisdiction');
  });

  it('denies study-scoped SMART when the requester does not explicitly use HRESCH', async () => {
    const actorDid = SAME_TENANT_EMPLOYEE_DID;
    const vpToken = buildUnsignedProfessionalIdentityVpJwt({
      clientId: actorDid, actorDid, role: SAME_TENANT_EMPLOYEE_ROLE,
      email: SAME_TENANT_EMPLOYEE_EMAIL,
    });
    const request = buildResearchStudyScopedJob(actorDid, vpToken);

    await expect(buildResearchStudyScopedManager().process({
      ...request,
      content: {
        ...request.content,
        body: { ...(request.content as any).body, purpose: HealthcareConsentPurposes.Treatment },
      },
    } as JobRequest)).rejects.toThrow('HRESCH');
  });

  it('denies a same-tenant employee whose employee record is inactive even when Consent remains active', async () => {
    const actorDid = SAME_TENANT_EMPLOYEE_DID;
    const vpToken = buildUnsignedProfessionalIdentityVpJwt({
      clientId: actorDid, actorDid, role: SAME_TENANT_EMPLOYEE_ROLE,
      email: SAME_TENANT_EMPLOYEE_EMAIL,
    });

    await expect(buildSameTenantDigitalTwinManager({
      rules: [buildSameTenantResearchConsent(actorDid)],
      employeeStatus: 'inactive',
    }).process(buildSameTenantDigitalTwinJob(actorDid, vpToken))).rejects.toThrow(
      'No active employee identity and applicable licence found',
    );
  });

  it('denies a same-tenant employee whose applicable licence is inactive even when Consent remains active', async () => {
    const actorDid = SAME_TENANT_EMPLOYEE_DID;
    const vpToken = buildUnsignedProfessionalIdentityVpJwt({
      clientId: actorDid, actorDid, role: SAME_TENANT_EMPLOYEE_ROLE,
      email: SAME_TENANT_EMPLOYEE_EMAIL,
    });

    await expect(buildSameTenantDigitalTwinManager({
      rules: [buildSameTenantResearchConsent(actorDid)],
      licenseStatus: 'inactive',
    }).process(buildSameTenantDigitalTwinJob(actorDid, vpToken))).rejects.toThrow(
      'No active employee identity and applicable licence found',
    );
  });

  it('denies same-tenant DigitalTwinReader when the VP does not identify the requesting employee', async () => {
    const actorDid = SAME_TENANT_EMPLOYEE_DID;
    const otherActorDid = buildProfessionalDidWeb({
      organizationDidWeb: SAME_TENANT_PUBLIC_ORGANIZATION_DID,
      email: 'other@vetchain.example',
      role: SAME_TENANT_EMPLOYEE_ROLE,
    });
    const vpToken = buildUnsignedProfessionalIdentityVpJwt({
      clientId: otherActorDid, actorDid: otherActorDid, role: SAME_TENANT_EMPLOYEE_ROLE,
      email: 'other@vetchain.example',
    });
    await expect(buildSameTenantDigitalTwinManager().process(
      buildSameTenantDigitalTwinJob(actorDid, vpToken),
    )).rejects.toThrow('No active employee identity and applicable licence found');
  });

  it('should issue an individual self-read token without requiring an inter-tenant research contract', async () => {
    const mockKmsService: jest.Mocked<IKmsService> = {
      init: jest.fn(),
      provisionKeys: jest.fn(),
      getPublicJwks: jest.fn(),
      getPublicVerificationKey: jest.fn().mockResolvedValue({ kid: 'tenant-sig-kid' } as any),
      getPublicEncryptionKey: jest.fn(),
      getHostPublicJwkSet: jest.fn(),
      decodeRequest: jest.fn(),
      signWithManagedKey: jest.fn().mockResolvedValue({ payload: '', signatures: [{ protected: 'p', signature: 'sig' }] } as any),
      signWithReconstructedKey: jest.fn(),
      createDetachedJws: jest.fn(),
      createCompactJws: buildMockCompactJws(),
      encodeResponse: jest.fn(),
      protectConfidentialData: jest.fn(),
      unprotectConfidentialData: jest.fn(),
      getHmacBase64Url: jest.fn(),
      protectAttributesNameAndValue: jest.fn(),
    };

    const mockTenantsCacheManager: jest.Mocked<TenantsCacheManager> = {
      getDidDocument: jest.fn().mockResolvedValue({ id: EXAMPLE_HOSTING_OPERATOR_DID } as any),
      tenantExists: jest.fn().mockResolvedValue(true),
    } as any;

    const mockVaultRepository: jest.Mocked<IVaultRepository> = {
      createNewVault: jest.fn(),
      vaultExists: jest.fn().mockResolvedValue(true),
      getVaultConfig: jest.fn().mockResolvedValue({ id: 'vault' } as any),
      createNewSection: jest.fn(),
      updateSection: jest.fn(),
      getAllSections: jest.fn(),
      sectionExists: jest.fn(),
      getContainersListInSection: jest.fn(),
      listContainersInSection: jest.fn(),
      getContainersInSection: jest.fn().mockResolvedValue([{
        '@context': 'org.hl7.fhir.api',
        [ClaimConsent.subject]: EXAMPLE_SUBJECT_DID,
        [ClaimConsent.identifier]: 'urn:uuid:individual-self-read',
        [ClaimConsent.decision]: ConsentDecisions.Permit,
        [ClaimConsent.status]: ConsentStatuses.Active,
        [ClaimConsent.actorIdentifier]: EXAMPLE_SUBJECT_DID,
        [ClaimConsent.action]: `${ServiceCapability.IndexReader}?section=*`,
        [ClaimConsent.purpose]: HealthcareConsentPurposes.Treatment,
      }] as any),
      put: jest.fn(),
      get: jest.fn(),
      getHistory: jest.fn(),
      query: jest.fn(),
      delete: jest.fn(),
      purge: jest.fn(),
    };

    const mockClearingHouse: jest.Mocked<IClearingHouseService> = {
      verifyVpToken: jest.fn().mockResolvedValue({
        acr: 'urn:antifraud:acr:openid4vp:individual',
        amr: ['openid4vp', 'vc'],
        vpHash: 'hash',
        ledgerVerified: true,
      }),
    };

    const manager = new OpenIdAuthManager(
      mockKmsService,
      mockTenantsCacheManager,
      mockVaultRepository,
      mockClearingHouse,
    );

    const response = await manager.process({
      tenantId: 'acme',
      jurisdiction: 'ES',
      sector: 'health-care',
      section: 'identity',
      format: 'openid',
      resourceType: 'smart',
      action: 'token',
      id: '',
      sequence: 0,
      status: 'DRAFT' as any,
      createdAtTimestamp: Date.now(),
      content: {
        thid: 'individual-self-read',
        iss: `${EXAMPLE_SUBJECT_DID}:device:client`,
        aud: EXAMPLE_HOSTING_OPERATOR_DID,
        body: {
          sub: EXAMPLE_SUBJECT_DID,
          scope: `${ServiceCapability.IndexReader}?subject=${EXAMPLE_SUBJECT_DID}&section=*`,
          purpose: HealthcareConsentPurposes.Treatment,
          vp_token: JSON.stringify(createVP({ iss: EXAMPLE_SUBJECT_DID, sub: EXAMPLE_SUBJECT_DID })),
          acr_values: 'urn:antifraud:acr:openid4vp:individual',
        },
      } as any,
    } as JobRequest);

    expect(response.body.access_token).toBeDefined();
    expect(response.body.subject).toBe(EXAMPLE_SUBJECT_DID);
  });

  it('should accept a trusted verified binding between two individual portal DIDs', async () => {
    // A physical card/support DID is deliberately absent. The client resolves
    // its DID Document `subject` before requesting SMART authorization.
    process.env.SUBJECT_IDENTITY_BINDING_TRUSTED_ISSUERS = EXAMPLE_TRUSTED_HEALTH_PORTAL_DID;
    const vp = addVC(
      createVP({
        iss: EXAMPLE_ALTERNATE_PORTAL_INDIVIDUAL_DID,
        sub: EXAMPLE_ALTERNATE_PORTAL_INDIVIDUAL_DID,
      }),
      EXAMPLE_SUBJECT_IDENTITY_BINDING_CREDENTIAL,
    );

    try {
      const response = await buildAliasedIndividualSelfReadManager().process(
        buildAliasedIndividualSelfReadJob(JSON.stringify(vp)),
      );
      expect(response.body.access_token).toBeDefined();
      expect(response.body.subject).toBe(EXAMPLE_PORTAL_INDIVIDUAL_DID);
    } finally {
      delete process.env.SUBJECT_IDENTITY_BINDING_TRUSTED_ISSUERS;
    }
  });

  it('should reject an individual DID binding whose issuer is not configured as trusted', async () => {
    // The same real credential path fails closed when deployment policy does
    // not trust its issuer; no helper bypass grants access.
    const vp = addVC(
      createVP({
        iss: EXAMPLE_ALTERNATE_PORTAL_INDIVIDUAL_DID,
        sub: EXAMPLE_ALTERNATE_PORTAL_INDIVIDUAL_DID,
      }),
      EXAMPLE_SUBJECT_IDENTITY_BINDING_CREDENTIAL,
    );

    await expect(
      buildAliasedIndividualSelfReadManager().process(
        buildAliasedIndividualSelfReadJob(JSON.stringify(vp)),
      ),
    ).rejects.toThrow('No trusted subject identity binding found');
  });

  it('should deny a foreign organization actor when no matching inter-tenant contract is presented', async () => {
    const mockKmsService: jest.Mocked<IKmsService> = {
      init: jest.fn(),
      provisionKeys: jest.fn(),
      getPublicJwks: jest.fn(),
      getPublicVerificationKey: jest.fn().mockResolvedValue({ kid: 'tenant-sig-kid' } as any),
      getPublicEncryptionKey: jest.fn(),
      getHostPublicJwkSet: jest.fn(),
      decodeRequest: jest.fn(),
      signWithManagedKey: jest.fn(),
      signWithReconstructedKey: jest.fn(),
      createDetachedJws: jest.fn(),
      createCompactJws: buildMockCompactJws(),
      encodeResponse: jest.fn(),
      protectConfidentialData: jest.fn(),
      unprotectConfidentialData: jest.fn(),
      getHmacBase64Url: jest.fn(),
      protectAttributesNameAndValue: jest.fn(),
    };

    const mockTenantsCacheManager: jest.Mocked<TenantsCacheManager> = {
      getDidDocument: jest.fn().mockResolvedValue({ id: 'did:web:api.acme.org' } as any),
      tenantExists: jest.fn().mockResolvedValue(true),
    } as any;

    const mockVaultRepository: jest.Mocked<IVaultRepository> = {
      createNewVault: jest.fn(),
      vaultExists: jest.fn().mockResolvedValue(true),
      getVaultConfig: jest.fn().mockResolvedValue({ id: 'vault' } as any),
      createNewSection: jest.fn(),
      updateSection: jest.fn(),
      getAllSections: jest.fn(),
      sectionExists: jest.fn(),
      getContainersListInSection: jest.fn(),
      listContainersInSection: jest.fn(),
      getContainersInSection: jest.fn().mockResolvedValue([
        {
          ...testConsentRulePermitOrgDid,
          'Consent.actor-identifier': EXAMPLE_INTER_TENANT_ACCESS_CONTRACT_CONTEXT.consumerOrganizationDid,
          'Consent.purpose': EXAMPLE_INTER_TENANT_ACCESS_CONTRACT_CONTEXT.purpose,
          'Consent.action': `${ServiceCapability.DigitalTwinReader}?subject=*`,
        },
      ] as any),
      put: jest.fn(),
      get: jest.fn(),
      getHistory: jest.fn(),
      query: jest.fn(),
      delete: jest.fn(),
      purge: jest.fn(),
    };

    const mockClearingHouse: jest.Mocked<IClearingHouseService> = {
      verifyVpToken: jest.fn().mockResolvedValue({
        acr: 'urn:antifraud:acr:openid4vp:employee',
        amr: ['openid4vp', 'vc'],
        vpHash: 'hash',
        ledgerVerified: true,
      }),
    };

    const manager = new OpenIdAuthManager(
      mockKmsService,
      mockTenantsCacheManager,
      mockVaultRepository,
      mockClearingHouse,
    );

    await expect(manager.process({
      tenantId: 'acme',
      jurisdiction: 'ES',
      sector: 'health-care',
      section: 'identity',
      format: 'openid',
      resourceType: 'smart',
      action: 'token',
      id: '',
      sequence: 0,
      status: 'DRAFT' as any,
      createdAtTimestamp: Date.now(),
      content: {
        thid: 'thid',
        iss: 'did:web:device.example',
        aud: 'did:web:api.acme.org',
        body: {
          sub: EXAMPLE_INTER_TENANT_ACCESS_CONTRACT_CONSUMER_PROFESSIONAL_DID,
          scope: EXAMPLE_INTER_TENANT_DIGITAL_TWIN_SCOPE,
          purpose: EXAMPLE_INTER_TENANT_ACCESS_CONTRACT_CONTEXT.purpose,
          vp_token: JSON.stringify(createVP({
            iss: EXAMPLE_INTER_TENANT_ACCESS_CONTRACT_CONTEXT.consumerOrganizationDid,
          })),
          acr_values: 'urn:antifraud:acr:openid4vp:employee',
        },
      } as any,
    } as JobRequest)).rejects.toThrow('No active inter-tenant access contract found');
  });

  it('should accept one trusted external research bearer instead of vp_token for inter-tenant research access', async () => {
    // In the external research profile:
    // - bearer token carries the external access proof (Pontus-X style)
    // - client_assertion still authenticates the registered researcher client
    process.env.EXTERNAL_RESEARCH_TOKEN_TRUSTED_ISSUERS = 'https://pontus-x.example';
    const clientId = 'did:web:lab.example:employee:researcher1@lab.org:device:client-002';
    const clientAssertion = await buildClientAssertionJwt({
      clientId,
      audience: 'did:web:api.acme.org',
    });

    const mockKmsService: jest.Mocked<IKmsService> = {
      init: jest.fn(),
      provisionKeys: jest.fn(),
      getPublicJwks: jest.fn(),
      getPublicVerificationKey: jest.fn().mockResolvedValue({ kid: 'tenant-sig-kid' } as any),
      getPublicEncryptionKey: jest.fn(),
      getHostPublicJwkSet: jest.fn(),
      decodeRequest: jest.fn(),
      signWithManagedKey: jest.fn().mockResolvedValue({ payload: '', signatures: [{ protected: 'p', signature: 'sig' }] } as any),
      signWithReconstructedKey: jest.fn(),
      createDetachedJws: jest.fn(),
      createCompactJws: buildMockCompactJws(),
      encodeResponse: jest.fn(),
      protectConfidentialData: jest.fn(),
      unprotectConfidentialData: jest.fn(),
      getHmacBase64Url: jest.fn(),
      protectAttributesNameAndValue: jest.fn(),
    };

    const mockTenantsCacheManager: jest.Mocked<TenantsCacheManager> = {
      getDidDocument: jest.fn().mockResolvedValue({ id: 'did:web:api.acme.org' } as any),
      tenantExists: jest.fn().mockResolvedValue(true),
    } as any;

    const mockVaultRepository: jest.Mocked<IVaultRepository> = {
      createNewVault: jest.fn(),
      vaultExists: jest.fn().mockResolvedValue(true),
      getVaultConfig: jest.fn().mockResolvedValue({ id: 'vault' } as any),
      createNewSection: jest.fn(),
      updateSection: jest.fn(),
      getAllSections: jest.fn(),
      sectionExists: jest.fn(),
      getContainersListInSection: jest.fn(),
      listContainersInSection: jest.fn(),
      getContainersInSection: jest.fn().mockResolvedValue([
        {
          ...testConsentRulePermitOrgDid,
          'Consent.actor-identifier': EXAMPLE_INTER_TENANT_ACCESS_CONTRACT_CONTEXT.consumerOrganizationDid,
          'Consent.purpose': HealthcareConsentPurposes.Research,
        },
      ] as any),
      put: jest.fn(),
      get: jest.fn(),
      getHistory: jest.fn(),
      query: jest.fn(),
      delete: jest.fn(),
      purge: jest.fn(),
    };

    const mockClearingHouse: jest.Mocked<IClearingHouseService> = {
      verifyVpToken: jest.fn(),
    };

    const manager = new OpenIdAuthManager(
      mockKmsService,
      mockTenantsCacheManager,
      mockVaultRepository,
      mockClearingHouse,
    );

    const response = await manager.process({
      tenantId: 'acme',
      jurisdiction: 'ES',
      sector: 'health-care',
      section: 'identity',
      format: 'openid',
      resourceType: 'smart',
      action: 'token',
      id: '',
      sequence: 0,
      status: 'DRAFT' as any,
      createdAtTimestamp: Date.now(),
      content: {
        thid: 'thid',
        iss: clientId,
        aud: 'did:web:api.acme.org',
        meta: {
          bearer: {
            token: 'Bearer external',
            jwt: {
              header: {},
              payload: {
                iss: 'https://pontus-x.example',
                aud: EXAMPLE_INTER_TENANT_ACCESS_CONTRACT_CONTEXT.providerOrganizationDid,
                consumerOrganizationDid: EXAMPLE_INTER_TENANT_ACCESS_CONTRACT_CONTEXT.consumerOrganizationDid,
                purpose: HealthcareConsentPurposes.Research,
                scope: EXAMPLE_INTER_TENANT_ACCESS_CONTRACT_SMART_SCOPE,
                amr: ['external_bearer'],
              },
            },
          },
        },
        body: {
          client_id: clientId,
          client_assertion: clientAssertion,
          client_assertion_type: 'client_assertion',
          sub: EXAMPLE_INTER_TENANT_ACCESS_CONTRACT_CONSUMER_PROFESSIONAL_DID,
          scope: EXAMPLE_INTER_TENANT_ACCESS_CONTRACT_SMART_SCOPE,
          purpose: HealthcareConsentPurposes.Research,
          acr_values: 'urn:antifraud:acr:openid4vp:employee',
        },
      } as any,
    } as JobRequest);

    expect(response.body.access_token).toBeDefined();
    expect(response.body.ledger_verified).toBe(true);
    expect(mockClearingHouse.verifyVpToken).not.toHaveBeenCalled();
  });

  it('should accept one trusted external research bearer for ResearchSubject scope when the stored action is canonical', async () => {
    process.env.EXTERNAL_RESEARCH_TOKEN_TRUSTED_ISSUERS = 'https://pontus-x.example';
    const researchSubjectScope = `organization/ResearchSubject.rs?subject=${EXAMPLE_INTER_TENANT_ACCESS_CONTRACT_CONTEXT.subjectDid}`;
    const clientId = 'did:web:lab.example:employee:researcher1@lab.org:device:client-rs-001';
    const clientAssertion = await buildClientAssertionJwt({
      clientId,
      audience: 'did:web:api.acme.org',
    });

    const mockKmsService: jest.Mocked<IKmsService> = {
      init: jest.fn(),
      provisionKeys: jest.fn(),
      getPublicJwks: jest.fn(),
      getPublicVerificationKey: jest.fn().mockResolvedValue({ kid: 'tenant-sig-kid' } as any),
      getPublicEncryptionKey: jest.fn(),
      getHostPublicJwkSet: jest.fn(),
      decodeRequest: jest.fn(),
      signWithManagedKey: jest.fn().mockResolvedValue({ payload: '', signatures: [{ protected: 'p', signature: 'sig' }] } as any),
      signWithReconstructedKey: jest.fn(),
      createDetachedJws: jest.fn(),
      createCompactJws: buildMockCompactJws(),
      encodeResponse: jest.fn(),
      protectConfidentialData: jest.fn(),
      unprotectConfidentialData: jest.fn(),
      getHmacBase64Url: jest.fn(),
      protectAttributesNameAndValue: jest.fn(),
    };

    const mockTenantsCacheManager: jest.Mocked<TenantsCacheManager> = {
      getDidDocument: jest.fn().mockResolvedValue({ id: 'did:web:api.acme.org' } as any),
      tenantExists: jest.fn().mockResolvedValue(true),
    } as any;

    const mockVaultRepository: jest.Mocked<IVaultRepository> = {
      createNewVault: jest.fn(),
      vaultExists: jest.fn().mockResolvedValue(true),
      getVaultConfig: jest.fn().mockResolvedValue({ id: 'vault' } as any),
      createNewSection: jest.fn(),
      updateSection: jest.fn(),
      getAllSections: jest.fn(),
      sectionExists: jest.fn(),
      getContainersListInSection: jest.fn(),
      listContainersInSection: jest.fn(),
      getContainersInSection: jest.fn().mockResolvedValue([
        {
          ...testConsentRulePermitOrgDid,
          'Consent.actor-identifier': EXAMPLE_INTER_TENANT_ACCESS_CONTRACT_CONTEXT.consumerOrganizationDid,
          'Consent.purpose': HealthcareConsentPurposes.Research,
          'Consent.action': 'ResearchSubject.rs',
        },
      ] as any),
      put: jest.fn(),
      get: jest.fn(),
      getHistory: jest.fn(),
      query: jest.fn(),
      delete: jest.fn(),
      purge: jest.fn(),
    };

    const mockClearingHouse: jest.Mocked<IClearingHouseService> = {
      verifyVpToken: jest.fn(),
    };

    const manager = new OpenIdAuthManager(
      mockKmsService,
      mockTenantsCacheManager,
      mockVaultRepository,
      mockClearingHouse,
    );

    const response = await manager.process({
      tenantId: 'acme',
      jurisdiction: 'ES',
      sector: 'health-care',
      section: 'identity',
      format: 'openid',
      resourceType: 'smart',
      action: 'token',
      id: '',
      sequence: 0,
      status: 'DRAFT' as any,
      createdAtTimestamp: Date.now(),
      content: {
        thid: 'thid',
        iss: clientId,
        aud: 'did:web:api.acme.org',
        meta: {
          bearer: {
            token: 'Bearer external',
            jwt: {
              header: {},
              payload: {
                iss: 'https://pontus-x.example',
                aud: EXAMPLE_INTER_TENANT_ACCESS_CONTRACT_CONTEXT.providerOrganizationDid,
                consumerOrganizationDid: EXAMPLE_INTER_TENANT_ACCESS_CONTRACT_CONTEXT.consumerOrganizationDid,
                purpose: HealthcareConsentPurposes.Research,
                scope: researchSubjectScope,
                amr: ['external_bearer'],
              },
            },
          },
        },
        body: {
          client_id: clientId,
          client_assertion: clientAssertion,
          client_assertion_type: 'client_assertion',
          sub: EXAMPLE_INTER_TENANT_ACCESS_CONTRACT_CONSUMER_PROFESSIONAL_DID,
          scope: researchSubjectScope,
          purpose: HealthcareConsentPurposes.Research,
          acr_values: 'urn:antifraud:acr:openid4vp:employee',
        },
      } as any,
    } as JobRequest);

    expect(response.body.access_token).toBeDefined();
    expect(response.body.ledger_verified).toBe(true);
  });

  it('should accept one research employee when the permit is role-specific and matches the requester role', async () => {
    process.env.EXTERNAL_RESEARCH_TOKEN_TRUSTED_ISSUERS = 'https://pontus-x.example';
    const researchSubjectScope = `organization/ResearchSubject.rs?subject=${EXAMPLE_INTER_TENANT_ACCESS_CONTRACT_CONTEXT.subjectDid}`;
    const clientId = 'did:web:lab.example:employee:researcher1@lab.org:device:client-role-allow';
    const clientAssertion = await buildClientAssertionJwt({
      clientId,
      audience: 'did:web:api.acme.org',
    });

    const mockKmsService: jest.Mocked<IKmsService> = {
      init: jest.fn(),
      provisionKeys: jest.fn(),
      getPublicJwks: jest.fn(),
      getPublicVerificationKey: jest.fn().mockResolvedValue({ kid: 'tenant-sig-kid' } as any),
      getPublicEncryptionKey: jest.fn(),
      getHostPublicJwkSet: jest.fn(),
      decodeRequest: jest.fn(),
      signWithManagedKey: jest.fn().mockResolvedValue({ payload: '', signatures: [{ protected: 'p', signature: 'sig' }] } as any),
      signWithReconstructedKey: jest.fn(),
      createDetachedJws: jest.fn(),
      createCompactJws: buildMockCompactJws(),
      encodeResponse: jest.fn(),
      protectConfidentialData: jest.fn(),
      unprotectConfidentialData: jest.fn(),
      getHmacBase64Url: jest.fn(),
      protectAttributesNameAndValue: jest.fn(),
    };

    const mockTenantsCacheManager: jest.Mocked<TenantsCacheManager> = {
      getDidDocument: jest.fn().mockResolvedValue({ id: 'did:web:api.acme.org' } as any),
      tenantExists: jest.fn().mockResolvedValue(true),
    } as any;

    const mockVaultRepository: jest.Mocked<IVaultRepository> = {
      createNewVault: jest.fn(),
      vaultExists: jest.fn().mockResolvedValue(true),
      getVaultConfig: jest.fn().mockResolvedValue({ id: 'vault' } as any),
      createNewSection: jest.fn(),
      updateSection: jest.fn(),
      getAllSections: jest.fn(),
      sectionExists: jest.fn(),
      getContainersListInSection: jest.fn(),
      listContainersInSection: jest.fn(),
      getContainersInSection: jest.fn().mockResolvedValue([
        {
          ...testConsentRulePermitOrgDid,
          'Consent.subject': EXAMPLE_INTER_TENANT_ACCESS_CONTRACT_CONTEXT.subjectDid,
          'Consent.actor-identifier': EXAMPLE_INTER_TENANT_ACCESS_CONTRACT_CONTEXT.consumerOrganizationDid,
          'Consent.actor-role': EXAMPLE_INTER_TENANT_ACCESS_CONTRACT_CONTEXT.actorRole,
          'Consent.purpose': HealthcareConsentPurposes.Research,
          'Consent.action': 'ResearchSubject.rs',
        },
      ] as any),
      put: jest.fn(),
      get: jest.fn(),
      getHistory: jest.fn(),
      query: jest.fn(),
      delete: jest.fn(),
      purge: jest.fn(),
    };

    const mockClearingHouse: jest.Mocked<IClearingHouseService> = {
      verifyVpToken: jest.fn(),
    };

    const manager = new OpenIdAuthManager(
      mockKmsService,
      mockTenantsCacheManager,
      mockVaultRepository,
      mockClearingHouse,
    );

    const response = await manager.process({
      tenantId: 'acme',
      jurisdiction: 'ES',
      sector: 'health-care',
      section: 'identity',
      format: 'openid',
      resourceType: 'smart',
      action: 'token',
      id: '',
      sequence: 0,
      status: 'DRAFT' as any,
      createdAtTimestamp: Date.now(),
      content: {
        thid: 'thid',
        iss: clientId,
        aud: 'did:web:api.acme.org',
        meta: {
          bearer: {
            token: 'Bearer external',
            jwt: {
              header: {},
              payload: {
                iss: 'https://pontus-x.example',
                aud: EXAMPLE_INTER_TENANT_ACCESS_CONTRACT_CONTEXT.providerOrganizationDid,
                consumerOrganizationDid: EXAMPLE_INTER_TENANT_ACCESS_CONTRACT_CONTEXT.consumerOrganizationDid,
                purpose: HealthcareConsentPurposes.Research,
                scope: researchSubjectScope,
                amr: ['external_bearer'],
              },
            },
          },
        },
        body: {
          client_id: clientId,
          client_assertion: clientAssertion,
          client_assertion_type: 'client_assertion',
          sub: EXAMPLE_INTER_TENANT_ACCESS_CONTRACT_CONSUMER_PROFESSIONAL_DID,
          scope: researchSubjectScope,
          purpose: HealthcareConsentPurposes.Research,
          acr_values: 'urn:antifraud:acr:openid4vp:employee',
        },
      } as any,
    } as JobRequest);

    expect(response.body.access_token).toBeDefined();
  });

  it('should reject one research employee when the permit role does not match the requester role', async () => {
    process.env.EXTERNAL_RESEARCH_TOKEN_TRUSTED_ISSUERS = 'https://pontus-x.example';
    const researchSubjectScope = `organization/ResearchSubject.rs?subject=${EXAMPLE_INTER_TENANT_ACCESS_CONTRACT_CONTEXT.subjectDid}`;
    const clientId = 'did:web:lab.example:employee:researcher2@lab.org:device:client-role-deny';
    const clientAssertion = await buildClientAssertionJwt({
      clientId,
      audience: 'did:web:api.acme.org',
    });

    const mockKmsService: jest.Mocked<IKmsService> = {
      init: jest.fn(),
      provisionKeys: jest.fn(),
      getPublicJwks: jest.fn(),
      getPublicVerificationKey: jest.fn().mockResolvedValue({ kid: 'tenant-sig-kid' } as any),
      getPublicEncryptionKey: jest.fn(),
      getHostPublicJwkSet: jest.fn(),
      decodeRequest: jest.fn(),
      signWithManagedKey: jest.fn().mockResolvedValue({ payload: '', signatures: [{ protected: 'p', signature: 'sig' }] } as any),
      signWithReconstructedKey: jest.fn(),
      createDetachedJws: jest.fn(),
      createCompactJws: buildMockCompactJws(),
      encodeResponse: jest.fn(),
      protectConfidentialData: jest.fn(),
      unprotectConfidentialData: jest.fn(),
      getHmacBase64Url: jest.fn(),
      protectAttributesNameAndValue: jest.fn(),
    };

    const mockTenantsCacheManager: jest.Mocked<TenantsCacheManager> = {
      getDidDocument: jest.fn().mockResolvedValue({ id: 'did:web:api.acme.org' } as any),
      tenantExists: jest.fn().mockResolvedValue(true),
    } as any;

    const mockVaultRepository: jest.Mocked<IVaultRepository> = {
      createNewVault: jest.fn(),
      vaultExists: jest.fn().mockResolvedValue(true),
      getVaultConfig: jest.fn().mockResolvedValue({ id: 'vault' } as any),
      createNewSection: jest.fn(),
      updateSection: jest.fn(),
      getAllSections: jest.fn(),
      sectionExists: jest.fn(),
      getContainersListInSection: jest.fn(),
      listContainersInSection: jest.fn(),
      getContainersInSection: jest.fn().mockResolvedValue([
        {
          ...testConsentRulePermitOrgDid,
          'Consent.subject': EXAMPLE_INTER_TENANT_ACCESS_CONTRACT_CONTEXT.subjectDid,
          'Consent.actor-identifier': EXAMPLE_INTER_TENANT_ACCESS_CONTRACT_CONTEXT.consumerOrganizationDid,
          'Consent.actor-role': EXAMPLE_INTER_TENANT_ACCESS_CONTRACT_CONTEXT.actorRole,
          'Consent.purpose': HealthcareConsentPurposes.Research,
          'Consent.action': 'ResearchSubject.rs',
        },
      ] as any),
      put: jest.fn(),
      get: jest.fn(),
      getHistory: jest.fn(),
      query: jest.fn(),
      delete: jest.fn(),
      purge: jest.fn(),
    };

    const mockClearingHouse: jest.Mocked<IClearingHouseService> = {
      verifyVpToken: jest.fn(),
    };

    const manager = new OpenIdAuthManager(
      mockKmsService,
      mockTenantsCacheManager,
      mockVaultRepository,
      mockClearingHouse,
    );

    await expect(manager.process({
      tenantId: 'acme',
      jurisdiction: 'ES',
      sector: 'health-care',
      section: 'identity',
      format: 'openid',
      resourceType: 'smart',
      action: 'token',
      id: '',
      sequence: 0,
      status: 'DRAFT' as any,
      createdAtTimestamp: Date.now(),
      content: {
        thid: 'thid',
        iss: clientId,
        aud: 'did:web:api.acme.org',
        meta: {
          bearer: {
            token: 'Bearer external',
            jwt: {
              header: {},
              payload: {
                iss: 'https://pontus-x.example',
                aud: EXAMPLE_INTER_TENANT_ACCESS_CONTRACT_CONTEXT.providerOrganizationDid,
                consumerOrganizationDid: EXAMPLE_INTER_TENANT_ACCESS_CONTRACT_CONTEXT.consumerOrganizationDid,
                purpose: HealthcareConsentPurposes.Research,
                scope: researchSubjectScope,
                amr: ['external_bearer'],
              },
            },
          },
        },
        body: {
          client_id: clientId,
          client_assertion: clientAssertion,
          client_assertion_type: 'client_assertion',
          sub: 'did:web:api.lab.org:employee:researcher2@lab.org:ISCO-08|2166',
          scope: researchSubjectScope,
          purpose: HealthcareConsentPurposes.Research,
          acr_values: 'urn:antifraud:acr:openid4vp:employee',
        },
      } as any,
    } as JobRequest)).rejects.toThrow('No matching consent rule found for requested scope.');
  });

  it('should accept one research employee when the permit targets the requester email directly', async () => {
    process.env.EXTERNAL_RESEARCH_TOKEN_TRUSTED_ISSUERS = 'https://pontus-x.example';
    const researchSubjectScope = `organization/ResearchSubject.rs?subject=${EXAMPLE_INTER_TENANT_ACCESS_CONTRACT_CONTEXT.subjectDid}`;
    const clientId = 'did:web:lab.example:employee:researcher1@lab.org:device:client-email-allow';
    const clientAssertion = await buildClientAssertionJwt({
      clientId,
      audience: 'did:web:api.acme.org',
    });

    const mockKmsService: jest.Mocked<IKmsService> = {
      init: jest.fn(),
      provisionKeys: jest.fn(),
      getPublicJwks: jest.fn(),
      getPublicVerificationKey: jest.fn().mockResolvedValue({ kid: 'tenant-sig-kid' } as any),
      getPublicEncryptionKey: jest.fn(),
      getHostPublicJwkSet: jest.fn(),
      decodeRequest: jest.fn(),
      signWithManagedKey: jest.fn().mockResolvedValue({ payload: '', signatures: [{ protected: 'p', signature: 'sig' }] } as any),
      signWithReconstructedKey: jest.fn(),
      createDetachedJws: jest.fn(),
      createCompactJws: buildMockCompactJws(),
      encodeResponse: jest.fn(),
      protectConfidentialData: jest.fn(),
      unprotectConfidentialData: jest.fn(),
      getHmacBase64Url: jest.fn(),
      protectAttributesNameAndValue: jest.fn(),
    };

    const mockTenantsCacheManager: jest.Mocked<TenantsCacheManager> = {
      getDidDocument: jest.fn().mockResolvedValue({ id: 'did:web:api.acme.org' } as any),
      tenantExists: jest.fn().mockResolvedValue(true),
    } as any;

    const mockVaultRepository: jest.Mocked<IVaultRepository> = {
      createNewVault: jest.fn(),
      vaultExists: jest.fn().mockResolvedValue(true),
      getVaultConfig: jest.fn().mockResolvedValue({ id: 'vault' } as any),
      createNewSection: jest.fn(),
      updateSection: jest.fn(),
      getAllSections: jest.fn(),
      sectionExists: jest.fn(),
      getContainersListInSection: jest.fn(),
      listContainersInSection: jest.fn(),
      getContainersInSection: jest.fn().mockResolvedValue([
        {
          ...testConsentRulePermitEmailWildcardRole,
          'Consent.subject': EXAMPLE_INTER_TENANT_ACCESS_CONTRACT_CONTEXT.subjectDid,
          'Consent.actor-identifier': 'researcher1@lab.org',
          'Consent.actor-role': '*',
          'Consent.purpose': HealthcareConsentPurposes.Research,
          'Consent.action': 'ResearchSubject.rs',
        },
      ] as any),
      put: jest.fn(),
      get: jest.fn(),
      getHistory: jest.fn(),
      query: jest.fn(),
      delete: jest.fn(),
      purge: jest.fn(),
    };

    const mockClearingHouse: jest.Mocked<IClearingHouseService> = {
      verifyVpToken: jest.fn(),
    };

    const manager = new OpenIdAuthManager(
      mockKmsService,
      mockTenantsCacheManager,
      mockVaultRepository,
      mockClearingHouse,
    );

    const response = await manager.process({
      tenantId: 'acme',
      jurisdiction: 'ES',
      sector: 'health-care',
      section: 'identity',
      format: 'openid',
      resourceType: 'smart',
      action: 'token',
      id: '',
      sequence: 0,
      status: 'DRAFT' as any,
      createdAtTimestamp: Date.now(),
      content: {
        thid: 'thid',
        iss: clientId,
        aud: 'did:web:api.acme.org',
        meta: {
          bearer: {
            token: 'Bearer external',
            jwt: {
              header: {},
              payload: {
                iss: 'https://pontus-x.example',
                aud: EXAMPLE_INTER_TENANT_ACCESS_CONTRACT_CONTEXT.providerOrganizationDid,
                consumerOrganizationDid: EXAMPLE_INTER_TENANT_ACCESS_CONTRACT_CONTEXT.consumerOrganizationDid,
                purpose: HealthcareConsentPurposes.Research,
                scope: researchSubjectScope,
                amr: ['external_bearer'],
              },
            },
          },
        },
        body: {
          client_id: clientId,
          client_assertion: clientAssertion,
          client_assertion_type: 'client_assertion',
          sub: 'did:web:api.lab.org:employee:researcher1@lab.org:ISCO-08|2166',
          scope: researchSubjectScope,
          purpose: HealthcareConsentPurposes.Research,
          acr_values: 'urn:antifraud:acr:openid4vp:employee',
        },
      } as any,
    } as JobRequest);

    expect(response.body.access_token).toBeDefined();
  });

  it('should reject one research employee when a direct-email permit targets another employee', async () => {
    process.env.EXTERNAL_RESEARCH_TOKEN_TRUSTED_ISSUERS = 'https://pontus-x.example';
    const researchSubjectScope = `organization/ResearchSubject.rs?subject=${EXAMPLE_INTER_TENANT_ACCESS_CONTRACT_CONTEXT.subjectDid}`;
    const clientId = 'did:web:lab.example:employee:researcher2@lab.org:device:client-email-deny';
    const clientAssertion = await buildClientAssertionJwt({
      clientId,
      audience: 'did:web:api.acme.org',
    });

    const mockKmsService: jest.Mocked<IKmsService> = {
      init: jest.fn(),
      provisionKeys: jest.fn(),
      getPublicJwks: jest.fn(),
      getPublicVerificationKey: jest.fn().mockResolvedValue({ kid: 'tenant-sig-kid' } as any),
      getPublicEncryptionKey: jest.fn(),
      getHostPublicJwkSet: jest.fn(),
      decodeRequest: jest.fn(),
      signWithManagedKey: jest.fn().mockResolvedValue({ payload: '', signatures: [{ protected: 'p', signature: 'sig' }] } as any),
      signWithReconstructedKey: jest.fn(),
      createDetachedJws: jest.fn(),
      createCompactJws: buildMockCompactJws(),
      encodeResponse: jest.fn(),
      protectConfidentialData: jest.fn(),
      unprotectConfidentialData: jest.fn(),
      getHmacBase64Url: jest.fn(),
      protectAttributesNameAndValue: jest.fn(),
    };

    const mockTenantsCacheManager: jest.Mocked<TenantsCacheManager> = {
      getDidDocument: jest.fn().mockResolvedValue({ id: 'did:web:api.acme.org' } as any),
      tenantExists: jest.fn().mockResolvedValue(true),
    } as any;

    const mockVaultRepository: jest.Mocked<IVaultRepository> = {
      createNewVault: jest.fn(),
      vaultExists: jest.fn().mockResolvedValue(true),
      getVaultConfig: jest.fn().mockResolvedValue({ id: 'vault' } as any),
      createNewSection: jest.fn(),
      updateSection: jest.fn(),
      getAllSections: jest.fn(),
      sectionExists: jest.fn(),
      getContainersListInSection: jest.fn(),
      listContainersInSection: jest.fn(),
      getContainersInSection: jest.fn().mockResolvedValue([
        {
          ...testConsentRulePermitEmailWildcardRole,
          'Consent.subject': EXAMPLE_INTER_TENANT_ACCESS_CONTRACT_CONTEXT.subjectDid,
          'Consent.actor-identifier': 'researcher1@lab.org',
          'Consent.actor-role': '*',
          'Consent.purpose': HealthcareConsentPurposes.Research,
          'Consent.action': 'ResearchSubject.rs',
        },
      ] as any),
      put: jest.fn(),
      get: jest.fn(),
      getHistory: jest.fn(),
      query: jest.fn(),
      delete: jest.fn(),
      purge: jest.fn(),
    };

    const mockClearingHouse: jest.Mocked<IClearingHouseService> = {
      verifyVpToken: jest.fn(),
    };

    const manager = new OpenIdAuthManager(
      mockKmsService,
      mockTenantsCacheManager,
      mockVaultRepository,
      mockClearingHouse,
    );

    await expect(manager.process({
      tenantId: 'acme',
      jurisdiction: 'ES',
      sector: 'health-care',
      section: 'identity',
      format: 'openid',
      resourceType: 'smart',
      action: 'token',
      id: '',
      sequence: 0,
      status: 'DRAFT' as any,
      createdAtTimestamp: Date.now(),
      content: {
        thid: 'thid',
        iss: clientId,
        aud: 'did:web:api.acme.org',
        meta: {
          bearer: {
            token: 'Bearer external',
            jwt: {
              header: {},
              payload: {
                iss: 'https://pontus-x.example',
                aud: EXAMPLE_INTER_TENANT_ACCESS_CONTRACT_CONTEXT.providerOrganizationDid,
                consumerOrganizationDid: EXAMPLE_INTER_TENANT_ACCESS_CONTRACT_CONTEXT.consumerOrganizationDid,
                purpose: HealthcareConsentPurposes.Research,
                scope: researchSubjectScope,
                amr: ['external_bearer'],
              },
            },
          },
        },
        body: {
          client_id: clientId,
          client_assertion: clientAssertion,
          client_assertion_type: 'client_assertion',
          sub: 'did:web:api.lab.org:employee:researcher2@lab.org:ISCO-08|2166',
          scope: researchSubjectScope,
          purpose: HealthcareConsentPurposes.Research,
          acr_values: 'urn:antifraud:acr:openid4vp:employee',
        },
      } as any,
    } as JobRequest)).rejects.toThrow('No matching consent rule found for requested scope.');
  });

  it('should accept one professional SMART request with vp_token plus client_assertion', async () => {
    // Professional SMART baseline:
    // - `client_assertion` proves possession of the device private key
    // - `vp_token` remains the authorization/holder-proof input for OIDC4VP
    const clientId = 'did:web:api.acme.org:employee:doctor1@acme.org:device:client-001';
    const clientAssertion = await buildClientAssertionJwt({
      clientId,
      audience: 'did:web:api.acme.org',
    });

    const mockKmsService: jest.Mocked<IKmsService> = {
      init: jest.fn(),
      provisionKeys: jest.fn(),
      getPublicJwks: jest.fn(),
      getPublicVerificationKey: jest.fn().mockResolvedValue({ kid: 'tenant-sig-kid' } as any),
      getPublicEncryptionKey: jest.fn(),
      getHostPublicJwkSet: jest.fn(),
      decodeRequest: jest.fn(),
      signWithManagedKey: jest.fn().mockResolvedValue({ payload: '', signatures: [{ protected: 'p', signature: 'sig' }] } as any),
      signWithReconstructedKey: jest.fn(),
      createDetachedJws: jest.fn(),
      createCompactJws: buildMockCompactJws(),
      encodeResponse: jest.fn(),
      protectConfidentialData: jest.fn(),
      unprotectConfidentialData: jest.fn(),
      getHmacBase64Url: jest.fn(),
      protectAttributesNameAndValue: jest.fn(),
    };

    const mockTenantsCacheManager: jest.Mocked<TenantsCacheManager> = {
      getDidDocument: jest.fn().mockResolvedValue({ id: 'did:web:api.acme.org' } as any),
      tenantExists: jest.fn().mockResolvedValue(true),
    } as any;

    const mockVaultRepository: jest.Mocked<IVaultRepository> = {
      createNewVault: jest.fn(),
      vaultExists: jest.fn().mockResolvedValue(true),
      getVaultConfig: jest.fn().mockResolvedValue({ id: 'vault' } as any),
      createNewSection: jest.fn(),
      updateSection: jest.fn(),
      getAllSections: jest.fn(),
      sectionExists: jest.fn(),
      getContainersListInSection: jest.fn(),
      listContainersInSection: jest.fn(),
      getContainersInSection: jest.fn().mockResolvedValue([{ ...testConsentRulePermitOrgDid }] as any),
      put: jest.fn(),
      get: jest.fn().mockResolvedValue(undefined),
      getHistory: jest.fn(),
      query: jest.fn(),
      delete: jest.fn(),
      purge: jest.fn(),
    };

    const mockClearingHouse: jest.Mocked<IClearingHouseService> = {
      verifyVpToken: jest.fn().mockResolvedValue({
        acr: 'urn:antifraud:acr:openid4vp:employee',
        amr: ['openid4vp', 'vc'],
        vpHash: 'hash',
        ledgerVerified: true,
      }),
    };

    const manager = new OpenIdAuthManager(
      mockKmsService,
      mockTenantsCacheManager,
      mockVaultRepository,
      mockClearingHouse,
    );

    const response = await manager.process({
      tenantId: 'acme',
      jurisdiction: 'ES',
      sector: 'health-care',
      section: 'identity',
      format: 'openid',
      resourceType: 'smart',
      action: 'token',
      id: '',
      sequence: 0,
      status: 'DRAFT' as any,
      createdAtTimestamp: Date.now(),
      content: {
        thid: 'thid',
        iss: clientId,
        aud: 'did:web:api.acme.org',
        body: {
          client_id: clientId,
          client_assertion: clientAssertion,
          client_assertion_type: 'private_key_jwt',
          sub: 'did:web:api.acme.org:employee:doctor1@acme.org:ISCO-08|2211',
          scope: 'organization/Composition.rs?subject=did:web:api.acme.org:individual:123&section=*',
          purpose: 'TREAT',
          expires_in: 300,
          vp_token: 'vp',
          acr_values: 'urn:antifraud:acr:openid4vp:employee',
        },
      } as any,
    } as JobRequest);

    expect(response.body.access_token).toBeDefined();
    expect(mockClearingHouse.verifyVpToken).toHaveBeenCalled();
  });

  it('accepts no vp_token only when the actor DID issuer uses its exact DCR client assertion', async () => {
    const issuerDid = EXAMPLE_HOSTING_OPERATOR_DID;
    const subjectDid = EXAMPLE_SUBJECT_DID;
    const actorDid = EXAMPLE_CONTROLLER_DID;
    const clientId = EXAMPLE_DEVICE_CLIENT_ID;
    const fixture = await buildClientAssertionFixture({ clientId, audience: issuerDid });
    const deviceProfile = {
      clientId, status: DeviceBindingStatuses.Active,
      actorDid, profileDid: actorDid, authorizedSubjectDid: subjectDid,
      authenticatedSubject: EXAMPLE_ACCOUNT_OWNER_ID,
      licenseId: EXAMPLE_LICENSE_SUBJECT_ID_ACTIVE,
      jwks: { keys: [fixture.publicJwk] },
    };
    const vault = {
      get: jest.fn().mockResolvedValue({
        id: clientId,
        status: DeviceBindingStatuses.Active,
        content: deviceProfile,
      }),
      getContainersInSection: jest.fn().mockResolvedValue([]),
    } as unknown as jest.Mocked<IVaultRepository>;
    const manager = new OpenIdAuthManager(
      {
        getPublicVerificationKey: jest.fn().mockResolvedValue({ kid: 'tenant-sig-kid' }),
        signWithManagedKey: jest.fn().mockResolvedValue({ payload: '', signatures: [{ protected: 'p', signature: 'sig' }] }),
        createCompactJws: buildMockCompactJws(),
        unprotectConfidentialData: jest.fn(async (doc: any) => doc.content),
      } as unknown as jest.Mocked<IKmsService>,
      {
        getDidDocument: jest.fn().mockResolvedValue({ id: issuerDid }),
        tenantExists: jest.fn().mockResolvedValue(true),
        getCollectionName: jest.fn().mockResolvedValue('tenant-collection'),
      } as unknown as jest.Mocked<TenantsCacheManager>,
      vault,
      { verifyVpToken: jest.fn() } as unknown as jest.Mocked<IClearingHouseService>,
    );

    const response = await manager.process({
      ...EXAMPLE_TENANT_ROUTE_CONTEXT,
      section: GatewayRouteSections.Identity,
      format: GatewayRouteFormats.OpenId,
      resourceType: IdentityAuthResourceTypes.Smart,
      action: SmartPostDcrActions.Token,
      content: {
        thid: EXAMPLE_DEVICE_BOUND_SMART_DIDCOMM_MESSAGE.thid,
        iss: actorDid,
        aud: issuerDid,
        body: {
        client_id: clientId,
        client_assertion: fixture.jwt,
        client_assertion_type: 'private_key_jwt',
        sub: actorDid,
        scope: buildSmartCompositionReadScope({ subjectDid, sections: '*' }),
        purpose: HealthcareConsentPurposes.Treatment,
        acr_values: 'urn:antifraud:acr:openid4vp:individual',
        },
      },
    } as JobRequest);

    expect(response.body.access_token).toBeDefined();
  });

  it('accepts the public card alias only when the registered controller license owns that individual', async () => {
    const issuerDid = EXAMPLE_HOSTING_OPERATOR_DID;
    const privateSubjectDid = EXAMPLE_SUBJECT_DID;
    const publicCardDid = `${EXAMPLE_SUBJECT_DID}:public-card`;
    const actorDid = EXAMPLE_CONTROLLER_DID;
    const clientId = EXAMPLE_DEVICE_CLIENT_ID;
    const subjectId = 'animal-subject-1';
    const fixture = await buildClientAssertionFixture({ clientId, audience: issuerDid });
    const deviceProfile = {
      clientId, status: DeviceBindingStatuses.Active,
      actorDid, profileDid: actorDid, authorizedSubjectDid: privateSubjectDid,
      authenticatedSubject: EXAMPLE_ACCOUNT_OWNER_ID,
      licenseId: EXAMPLE_LICENSE_SUBJECT_ID_ACTIVE,
      jwks: { keys: [fixture.publicJwk] },
    };
    const vault = {
      get: jest.fn(async (_collection: string, id: string, section: string) => {
        if (section.includes('device-profiles') && id === clientId) {
          return { id: clientId, status: DeviceBindingStatuses.Active, content: deviceProfile };
        }
        if (section.includes('device-licenses') && id === EXAMPLE_LICENSE_SUBJECT_ID_ACTIVE) {
          return {
            id,
            status: DeviceBindingStatuses.Active,
            content: {
              id,
              status: DeviceBindingStatuses.Active,
              subjectId,
              authorizedSubjectDid: privateSubjectDid,
            },
          };
        }
        if (section.includes('individual') && id === subjectId) {
          return {
            id,
            status: DeviceBindingStatuses.Active,
            content: {
              claims: { [ClaimsOrganizationSchemaorg.sameAs]: publicCardDid },
            },
          };
        }
        return undefined;
      }),
      getContainersInSection: jest.fn().mockResolvedValue([]),
    } as unknown as jest.Mocked<IVaultRepository>;
    const manager = new OpenIdAuthManager(
      {
        getPublicVerificationKey: jest.fn().mockResolvedValue({ kid: 'tenant-sig-kid' }),
        signWithManagedKey: jest.fn().mockResolvedValue({ payload: '', signatures: [{ protected: 'p', signature: 'sig' }] }),
        createCompactJws: buildMockCompactJws(),
        unprotectConfidentialData: jest.fn(async (doc: any) => doc.content),
      } as unknown as jest.Mocked<IKmsService>,
      {
        getDidDocument: jest.fn().mockResolvedValue({ id: issuerDid }),
        tenantExists: jest.fn().mockResolvedValue(true),
        getCollectionName: jest.fn().mockResolvedValue('tenant-collection'),
      } as unknown as jest.Mocked<TenantsCacheManager>,
      vault,
      { verifyVpToken: jest.fn() } as unknown as jest.Mocked<IClearingHouseService>,
    );

    const response = await manager.process({
      ...EXAMPLE_TENANT_ROUTE_CONTEXT,
      section: GatewayRouteSections.Identity,
      format: GatewayRouteFormats.OpenId,
      resourceType: IdentityAuthResourceTypes.Smart,
      action: SmartPostDcrActions.Token,
      content: {
        thid: EXAMPLE_DEVICE_BOUND_SMART_DIDCOMM_MESSAGE.thid,
        iss: actorDid,
        aud: issuerDid,
        body: {
          client_id: clientId,
          client_assertion: fixture.jwt,
          client_assertion_type: 'private_key_jwt',
          sub: actorDid,
          scope: buildSmartCompositionReadScope({ subjectDid: publicCardDid, sections: '*' }),
          purpose: HealthcareConsentPurposes.Treatment,
          acr_values: 'urn:antifraud:acr:openid4vp:individual',
        },
      },
    } as JobRequest);

    expect(response.body.subject).toBe(publicCardDid);
    expect(response.body.access_token).toBeDefined();
  });

  it('accepts a second exact subject only when its active controller seat belongs to the same registered actor', async () => {
    const issuerDid = EXAMPLE_HOSTING_OPERATOR_DID;
    const actorDid = EXAMPLE_CONTROLLER_DID;
    const clientId = EXAMPLE_DEVICE_CLIENT_ID;
    const requestedSubjectDid = EXAMPLE_PORTAL_INDIVIDUAL_DID;
    const stableActorIdentifier = buildStableActorIdentifier({
      contactKind: 'email',
      contact: SAME_TENANT_EMPLOYEE_EMAIL,
    });
    const linkedTelephoneActorIdentifier = buildStableActorIdentifier({
      contactKind: 'phone',
      contact: EXAMPLE_KYC_CONTROLLER_TELEPHONE,
    });
    const fixture = await buildClientAssertionFixture({ clientId, audience: issuerDid });
    const deviceProfile = {
      clientId,
      status: DeviceBindingStatuses.Active,
      actorDid,
      profileDid: actorDid,
      authorizedSubjectDid: EXAMPLE_SUBJECT_DID,
      authenticatedSubject: EXAMPLE_ACCOUNT_OWNER_ID,
      authenticatedEmail: SAME_TENANT_EMPLOYEE_EMAIL,
      authenticatedTelephone: EXAMPLE_KYC_CONTROLLER_TELEPHONE,
      licenseId: EXAMPLE_LICENSE_SUBJECT_ID_ACTIVE,
      jwks: { keys: [fixture.publicJwk] },
    };
    const originalControllerSeat = {
      id: EXAMPLE_LICENSE_SUBJECT_ID_ACTIVE,
      status: DeviceBindingStatuses.Active,
      userClass: LICENSE_USER_CLASS_INDIVIDUAL,
      subjectId: EXAMPLE_LICENSE_SUBJECT_ID_ACTIVE,
      authorizedSubjectDid: EXAMPLE_SUBJECT_DID,
      activatedBy: linkedTelephoneActorIdentifier,
      issuedToRole: HealthcareActorRoles.Controller,
    };
    const requestedSubjectControllerSeat = {
      id: `${EXAMPLE_LICENSE_SUBJECT_ID_ACTIVE}-related-subject`,
      status: DeviceBindingStatuses.Active,
      userClass: LICENSE_USER_CLASS_INDIVIDUAL,
      subjectId: `${EXAMPLE_LICENSE_SUBJECT_ID_ACTIVE}-related-subject`,
      authorizedSubjectDid: EXAMPLE_ALTERNATE_PORTAL_INDIVIDUAL_DID,
      authorizedSubjectAliases: [requestedSubjectDid],
      activatedBy: stableActorIdentifier,
      issuedToRole: HealthcareActorRoles.Controller,
    };
    const controllerSeatDocuments = [
      { id: originalControllerSeat.id, content: originalControllerSeat },
      { id: requestedSubjectControllerSeat.id, content: requestedSubjectControllerSeat },
    ];
    const vault = {
      get: jest.fn(async (_collection: string, id: string, section: string) => {
        if (section.includes('device-profiles') && id === clientId) {
          return { id: clientId, status: DeviceBindingStatuses.Active, content: deviceProfile };
        }
        if (section.includes('device-licenses') && id === EXAMPLE_LICENSE_SUBJECT_ID_ACTIVE) {
          return { id, status: DeviceBindingStatuses.Active, content: originalControllerSeat };
        }
        return undefined;
      }),
      getContainersInSection: jest.fn().mockResolvedValue(controllerSeatDocuments),
    } as unknown as jest.Mocked<IVaultRepository>;
    const manager = new OpenIdAuthManager(
      {
        getPublicVerificationKey: jest.fn().mockResolvedValue({ kid: 'tenant-sig-kid' }),
        signWithManagedKey: jest.fn().mockResolvedValue({ payload: '', signatures: [{ protected: 'p', signature: 'sig' }] }),
        createCompactJws: buildMockCompactJws(),
        unprotectConfidentialData: jest.fn(async (doc: any) => (
          controllerSeatDocuments.includes(doc) ? undefined : doc.content
        )),
      } as unknown as jest.Mocked<IKmsService>,
      {
        getDidDocument: jest.fn().mockResolvedValue({ id: issuerDid }),
        tenantExists: jest.fn().mockResolvedValue(true),
        getCollectionName: jest.fn().mockResolvedValue('tenant-collection'),
      } as unknown as jest.Mocked<TenantsCacheManager>,
      vault,
      { verifyVpToken: jest.fn() } as unknown as jest.Mocked<IClearingHouseService>,
    );

    const response = await manager.process({
      ...EXAMPLE_TENANT_ROUTE_CONTEXT,
      section: GatewayRouteSections.Identity,
      format: GatewayRouteFormats.OpenId,
      resourceType: IdentityAuthResourceTypes.Smart,
      action: SmartPostDcrActions.Token,
      content: {
        thid: EXAMPLE_DEVICE_BOUND_SMART_DIDCOMM_MESSAGE.thid,
        iss: actorDid,
        aud: issuerDid,
        meta: { bearer: { jwt: { payload: {
          sub: EXAMPLE_ACCOUNT_OWNER_ID,
          firebase: { sign_in_provider: 'custom' },
        } } } } as any,
        body: {
          client_id: clientId,
          client_assertion: fixture.jwt,
          client_assertion_type: 'private_key_jwt',
          sub: actorDid,
          scope: buildSmartCompositionReadScope({ subjectDid: requestedSubjectDid, sections: '*' }),
          purpose: HealthcareConsentPurposes.Treatment,
          acr_values: 'urn:antifraud:acr:openid4vp:individual',
        },
      },
    } as JobRequest);

    expect(response.body.subject).toBe(requestedSubjectDid);
    expect(response.body.access_token).toBeDefined();
    const smartPayload = JSON.parse(Buffer.from(
      String(response.body.access_token).split('.')[1]!,
      'base64url',
    ).toString('utf8'));
    expect(smartPayload.sub).toBe(actorDid);
    expect(smartPayload.sub).not.toBe(requestedSubjectDid);
  });

  it('accepts legacy controller seats only when both match the DCR-verified contact', async () => {
    const issuerDid = EXAMPLE_HOSTING_OPERATOR_DID;
    const actorDid = EXAMPLE_CONTROLLER_DID;
    const clientId = EXAMPLE_DEVICE_CLIENT_ID;
    const requestedSubjectDid = EXAMPLE_PORTAL_INDIVIDUAL_DID;
    const fixture = await buildClientAssertionFixture({ clientId, audience: issuerDid });
    const deviceProfile = {
      clientId, status: DeviceBindingStatuses.Active,
      actorDid, profileDid: actorDid, authorizedSubjectDid: EXAMPLE_SUBJECT_DID,
      authenticatedSubject: EXAMPLE_ACCOUNT_OWNER_ID,
      authenticatedEmail: EXAMPLE_EMAIL_CONTROLLER_INDIVIDUAL,
      licenseId: EXAMPLE_LICENSE_SUBJECT_ID_ACTIVE,
      jwks: { keys: [fixture.publicJwk] },
    };
    const originalLegacySeat = {
      id: EXAMPLE_LICENSE_SUBJECT_ID_ACTIVE,
      status: DeviceBindingStatuses.Active,
      userClass: LICENSE_USER_CLASS_INDIVIDUAL,
      subjectId: EXAMPLE_LICENSE_SUBJECT_ID_ACTIVE,
      authorizedSubjectDid: EXAMPLE_SUBJECT_DID,
      issuedToEmail: String(EXAMPLE_EMAIL_CONTROLLER_INDIVIDUAL),
      issuedToRole: HealthcareActorRoles.Controller,
    };
    const requestedLegacySeat = {
      id: `${EXAMPLE_LICENSE_SUBJECT_ID_ACTIVE}-legacy-related-subject`,
      status: DeviceBindingStatuses.Active,
      userClass: LICENSE_USER_CLASS_INDIVIDUAL,
      subjectId: `${EXAMPLE_LICENSE_SUBJECT_ID_ACTIVE}-legacy-related-subject`,
      // The seat owns the private individual DID. Channels select the public
      // Card alias stored on that individual, so SMART must resolve both
      // representations without treating a directory match as authority.
      authorizedSubjectDid: EXAMPLE_ALTERNATE_PORTAL_INDIVIDUAL_DID,
      issuedToEmail: String(EXAMPLE_EMAIL_CONTROLLER_INDIVIDUAL),
      issuedToRole: HealthcareActorRoles.Controller,
    };
    const vault = {
      get: jest.fn(async (_collection: string, id: string, section: string) => {
        if (section.includes('device-profiles') && id === clientId) {
          return { id: clientId, status: DeviceBindingStatuses.Active, content: deviceProfile };
        }
        if (section.includes('device-licenses') && id === EXAMPLE_LICENSE_SUBJECT_ID_ACTIVE) {
          return { id, status: DeviceBindingStatuses.Active, content: originalLegacySeat };
        }
        if (section.includes('individual') && id === requestedLegacySeat.subjectId) {
          return {
            id,
            status: DeviceBindingStatuses.Active,
            content: {
              claims: { [ClaimsOrganizationSchemaorg.sameAs]: requestedSubjectDid },
            },
          };
        }
        return undefined;
      }),
      getContainersInSection: jest.fn().mockResolvedValue([
        { id: originalLegacySeat.id, content: originalLegacySeat },
        { id: requestedLegacySeat.id, content: requestedLegacySeat },
      ]),
    } as unknown as jest.Mocked<IVaultRepository>;
    const manager = new OpenIdAuthManager(
      {
        getPublicVerificationKey: jest.fn().mockResolvedValue({ kid: 'tenant-sig-kid' }),
        signWithManagedKey: jest.fn().mockResolvedValue({ payload: '', signatures: [{ protected: 'p', signature: 'sig' }] }),
        createCompactJws: buildMockCompactJws(),
        unprotectConfidentialData: jest.fn(async (doc: any) => doc.content),
      } as unknown as jest.Mocked<IKmsService>,
      {
        getDidDocument: jest.fn().mockResolvedValue({ id: issuerDid }),
        tenantExists: jest.fn().mockResolvedValue(true),
        getCollectionName: jest.fn().mockResolvedValue('tenant-collection'),
      } as unknown as jest.Mocked<TenantsCacheManager>,
      vault,
      { verifyVpToken: jest.fn() } as unknown as jest.Mocked<IClearingHouseService>,
    );
    const request = {
      ...EXAMPLE_TENANT_ROUTE_CONTEXT,
      section: GatewayRouteSections.Identity,
      format: GatewayRouteFormats.OpenId,
      resourceType: IdentityAuthResourceTypes.Smart,
      action: SmartPostDcrActions.Token,
      content: {
        thid: EXAMPLE_DEVICE_BOUND_SMART_DIDCOMM_MESSAGE.thid,
        iss: actorDid,
        aud: issuerDid,
        meta: { bearer: { jwt: { payload: {
          sub: EXAMPLE_ACCOUNT_OWNER_ID,
          email: EXAMPLE_EMAIL_CONTROLLER_INDIVIDUAL,
          firebase: { sign_in_provider: 'custom', identities: {
            email: [EXAMPLE_EMAIL_CONTROLLER_INDIVIDUAL],
          } },
        } } } } as any,
        body: {
          client_id: clientId,
          client_assertion: fixture.jwt,
          client_assertion_type: 'private_key_jwt',
          sub: actorDid,
          scope: buildSmartCompositionReadScope({ subjectDid: requestedSubjectDid, sections: '*' }),
          purpose: HealthcareConsentPurposes.Treatment,
          acr_values: 'urn:antifraud:acr:openid4vp:individual',
        },
      },
    } as JobRequest;
    const response = await manager.process(request);

    expect(response.body.subject).toBe(requestedSubjectDid);
    expect(response.body.access_token).toBeDefined();

    requestedLegacySeat.issuedToEmail = SAME_TENANT_EMPLOYEE_EMAIL;
    await expect(manager.process(request)).rejects.toMatchObject({
      message: 'DCR-bound individual controller is not authorized for the requested subject.',
    });
  });

  it('rejects a second subject controller seat bound to a different registered actor', async () => {
    const issuerDid = EXAMPLE_HOSTING_OPERATOR_DID;
    const actorDid = EXAMPLE_CONTROLLER_DID;
    const clientId = EXAMPLE_DEVICE_CLIENT_ID;
    const requestedSubjectDid = EXAMPLE_ALTERNATE_PORTAL_INDIVIDUAL_DID;
    const registeredActorIdentifier = buildStableActorIdentifier({
      contactKind: 'email',
      contact: SAME_TENANT_EMPLOYEE_EMAIL,
    });
    const differentActorIdentifier = buildStableActorIdentifier({
      contactKind: 'email',
      contact: EXAMPLE_ACCOUNT_OWNER_ID,
    });
    const fixture = await buildClientAssertionFixture({ clientId, audience: issuerDid });
    const deviceProfile = {
      clientId,
      status: DeviceBindingStatuses.Active,
      actorDid,
      profileDid: actorDid,
      authorizedSubjectDid: EXAMPLE_SUBJECT_DID,
      authenticatedSubject: EXAMPLE_ACCOUNT_OWNER_ID,
      licenseId: EXAMPLE_LICENSE_SUBJECT_ID_ACTIVE,
      jwks: { keys: [fixture.publicJwk] },
    };
    const originalControllerSeat = {
      id: EXAMPLE_LICENSE_SUBJECT_ID_ACTIVE,
      status: DeviceBindingStatuses.Active,
      userClass: LICENSE_USER_CLASS_INDIVIDUAL,
      subjectId: EXAMPLE_LICENSE_SUBJECT_ID_ACTIVE,
      authorizedSubjectDid: EXAMPLE_SUBJECT_DID,
      activatedBy: registeredActorIdentifier,
      issuedToRole: HealthcareActorRoles.Controller,
    };
    const vault = {
      get: jest.fn(async (_collection: string, id: string, section: string) => {
        if (section.includes('device-profiles') && id === clientId) {
          return { id: clientId, status: DeviceBindingStatuses.Active, content: deviceProfile };
        }
        if (section.includes('device-licenses') && id === EXAMPLE_LICENSE_SUBJECT_ID_ACTIVE) {
          return { id, status: DeviceBindingStatuses.Active, content: originalControllerSeat };
        }
        return undefined;
      }),
      getContainersInSection: jest.fn().mockResolvedValue([{
        id: `${EXAMPLE_LICENSE_SUBJECT_ID_ACTIVE}-different-actor`,
        content: {
          status: DeviceBindingStatuses.Active,
          userClass: LICENSE_USER_CLASS_INDIVIDUAL,
          authorizedSubjectDid: requestedSubjectDid,
          activatedBy: differentActorIdentifier,
          issuedToRole: HealthcareActorRoles.Controller,
        },
      }]),
    } as unknown as jest.Mocked<IVaultRepository>;
    const manager = new OpenIdAuthManager(
      {
        unprotectConfidentialData: jest.fn(async (doc: any) => doc.content),
      } as unknown as jest.Mocked<IKmsService>,
      {
        getDidDocument: jest.fn().mockResolvedValue({ id: issuerDid }),
        tenantExists: jest.fn().mockResolvedValue(true),
        getCollectionName: jest.fn().mockResolvedValue('tenant-collection'),
      } as unknown as jest.Mocked<TenantsCacheManager>,
      vault,
      { verifyVpToken: jest.fn() } as unknown as jest.Mocked<IClearingHouseService>,
    );

    await expect(manager.process({
      ...EXAMPLE_TENANT_ROUTE_CONTEXT,
      section: GatewayRouteSections.Identity,
      format: GatewayRouteFormats.OpenId,
      resourceType: IdentityAuthResourceTypes.Smart,
      action: SmartPostDcrActions.Token,
      content: {
        thid: EXAMPLE_DEVICE_BOUND_SMART_DIDCOMM_MESSAGE.thid,
        iss: actorDid,
        aud: issuerDid,
        body: {
          client_id: clientId,
          client_assertion: fixture.jwt,
          client_assertion_type: 'private_key_jwt',
          sub: actorDid,
          scope: buildSmartCompositionReadScope({ subjectDid: requestedSubjectDid, sections: '*' }),
          purpose: HealthcareConsentPurposes.Treatment,
          acr_values: 'urn:antifraud:acr:openid4vp:individual',
        },
      },
    } as JobRequest)).rejects.toThrow('DCR-bound individual controller is not authorized for the requested subject.');
  });

  it('rejects an unowned public subject when the registered controller omits vp_token', async () => {
    const issuerDid = EXAMPLE_HOSTING_OPERATOR_DID;
    const actorDid = EXAMPLE_CONTROLLER_DID;
    const clientId = EXAMPLE_DEVICE_CLIENT_ID;
    const fixture = await buildClientAssertionFixture({ clientId, audience: issuerDid });
    const deviceProfile = {
      clientId, status: DeviceBindingStatuses.Active,
      actorDid, profileDid: actorDid, authorizedSubjectDid: EXAMPLE_SUBJECT_DID,
      authenticatedSubject: EXAMPLE_ACCOUNT_OWNER_ID,
      licenseId: EXAMPLE_LICENSE_SUBJECT_ID_ACTIVE,
      jwks: { keys: [fixture.publicJwk] },
    };
    const vault = {
      get: jest.fn(async (_collection: string, id: string, section: string) => {
        if (section.includes('device-profiles')) {
          return { id: clientId, status: DeviceBindingStatuses.Active, content: deviceProfile };
        }
        if (section.includes('device-licenses')) {
          return {
            id,
            status: DeviceBindingStatuses.Active,
            content: {
              id,
              status: DeviceBindingStatuses.Active,
              subjectId: 'animal-subject-1',
              authorizedSubjectDid: EXAMPLE_SUBJECT_DID,
            },
          };
        }
        if (section.includes('individual')) {
          return {
            id,
            status: DeviceBindingStatuses.Active,
            content: {
              claims: { [ClaimsOrganizationSchemaorg.sameAs]: `${EXAMPLE_SUBJECT_DID}:owned-card` },
            },
          };
        }
        return undefined;
      }),
      getContainersInSection: jest.fn().mockResolvedValue([]),
    } as unknown as jest.Mocked<IVaultRepository>;
    const manager = new OpenIdAuthManager(
      {
        unprotectConfidentialData: jest.fn(async (doc: any) => doc.content),
      } as unknown as jest.Mocked<IKmsService>,
      {
        getDidDocument: jest.fn().mockResolvedValue({ id: issuerDid }),
        tenantExists: jest.fn().mockResolvedValue(true),
        getCollectionName: jest.fn().mockResolvedValue('tenant-collection'),
      } as unknown as jest.Mocked<TenantsCacheManager>,
      vault,
      { verifyVpToken: jest.fn() } as unknown as jest.Mocked<IClearingHouseService>,
    );

    await expect(manager.process({
      ...EXAMPLE_TENANT_ROUTE_CONTEXT,
      section: GatewayRouteSections.Identity,
      format: GatewayRouteFormats.OpenId,
      resourceType: IdentityAuthResourceTypes.Smart,
      action: SmartPostDcrActions.Token,
      content: {
        thid: EXAMPLE_DEVICE_BOUND_SMART_DIDCOMM_MESSAGE.thid,
        iss: actorDid,
        aud: issuerDid,
        body: {
          client_id: clientId,
          client_assertion: fixture.jwt,
          client_assertion_type: 'private_key_jwt',
          sub: actorDid,
          scope: buildSmartCompositionReadScope({
            subjectDid: `${EXAMPLE_SUBJECT_DID}:unowned-card`,
            sections: '*',
          }),
          purpose: HealthcareConsentPurposes.Treatment,
          acr_values: 'urn:antifraud:acr:openid4vp:individual',
        },
      },
    } as JobRequest)).rejects.toThrow('DCR-bound individual controller is not authorized for the requested subject.');
  });
});
