// Flow contract: reuse shared test fixtures and canonical types; do not introduce duplicated literals.
// Contract: DCR binds one verified activation seat, authenticated account,
// controller role DID, authorized subject and registered device JWKS.
// Member roles and mismatched account/subject/key tuples must never inherit
// the individual-controller SMART shortcut.
// src/__tests__/managers/DeviceRegistrationManager.test.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

import cloneDeep from 'lodash.clonedeep';
import { validate as uuidValidate } from 'uuid';
import { BundleEntryResponse, BundleJsonApi, ErrorEntry } from 'gdc-common-utils-ts/models/bundle';
import { DeviceRegistrationManager } from '../../managers/DeviceRegistrationManager';
import { DCR_REGISTRATION_JOB } from '../data/example-jobs';
import { VaultMemRepository } from '../../database/repositories/vault/vault.mem.repository';
import { mockKmsService } from '../mocks/kms.mock';
import { getTenantVaultId } from '../../utils/tenant';
import { getEnvSectionId } from '../../utils/section-env';
import type { ConfidentialStorageDoc } from 'gdc-common-utils-ts/models/confidential-storage';
import type { DeviceLicense } from 'gdc-common-utils-ts/models/device-license';
import { EntityLifecycleStatus, EntityType } from '../../gdc-backend-utils-node/models/enums';
import type { EntityConfig } from '../../gdc-backend-utils-node/models/entity';
import { ClaimsPersonSchemaorg } from 'gdc-common-utils-ts/constants/schemaorg';
import { ManageAssetCryptographicKey } from '../../blockchain/fabric/v3/manageAssetCryptographicKey';
import { ManageAssetSubjectKeyBinding } from '../../blockchain/fabric/v3/manageAssetSubjectKeyBinding';
import { normalizeSameAsHash } from 'gdc-common-utils-ts/utils/same-as';
import { DeviceBindingStatuses } from 'gdc-common-utils-ts/constants/device';
import { IdentityAuthActions, IdentityAuthRequestFields, IdentityDcrMetadataFields } from 'gdc-common-utils-ts/constants/identity-auth';
import { HealthcareActorRoles } from 'gdc-common-utils-ts/constants/healthcare';
import { HttpStatusCodes } from 'gdc-common-utils-ts/constants/http';
import { DataspaceSectors } from 'gdc-common-utils-ts/constants/sectors';
import { createEmployeeUrn, createOrganizationUrn } from '../../utils/urn';
import { URN_NAMESPACE, URN_NETWORK, URN_VERSION } from '../data/urn.data';
import {
  EXAMPLE_EMPLOYEE_DEVICE_CLIENT_ID_PRIMARY,
  EXAMPLE_EMPLOYEE_DEVICE_INSTANCE_ID_TERTIARY,
  EXAMPLE_EMAIL_CONTROLLER_INDIVIDUAL,
  EXAMPLE_EMAIL_PROFESSIONAL,
  EXAMPLE_LEGAL_ORGANIZATION_TAX_ID,
  EXAMPLE_KYC_CONTROLLER_USER_UUID,
  EXAMPLE_KYC_CONTROLLER_UUID,
  EXAMPLE_PRIVATE_INDIVIDUAL_UUID,
  EXAMPLE_SUBJECT_DID,
  ExampleHttpStatusText,
} from 'gdc-common-utils-ts/examples/shared';
import {
  EXAMPLE_EMPLOYEE_ACTIVE_DEVICE_BINDINGS,
  EXAMPLE_LICENSE_ACTIVE_RECORD,
} from 'gdc-common-utils-ts/examples/license';
import { FhirIpsCreatorKinds } from 'gdc-common-utils-ts/utils/fhir-ips-creator-identity';
import { getClinicalCreatorBindingsSectionId } from '../../utils/clinical-creator-binding';
import { testIndividualControllerDcrIdentity } from '../data/identity.data';
import { buildStableActorIdentifier } from 'gdc-common-utils-ts/utils/actor-identifier';

const TEST_API_BASE_URL = 'http://localhost:3001';
const TEST_ORGANIZATION_URN = createOrganizationUrn({
  namespace: URN_NAMESPACE,
  network: URN_NETWORK,
  jurisdiction: 'CA-BC',
  version: URN_VERSION,
  sector: DataspaceSectors.AnimalCare,
  idType: 'tax',
  idValue: EXAMPLE_LEGAL_ORGANIZATION_TAX_ID,
});
const FABRIC_LEDGER_TEST_ENV = {
  NETWORK_MODE: 'local-network',
  LEDGER_ENABLED: 'true',
  LEDGER_PROVIDER_DEFAULT: 'mem',
  LEDGER_PROVIDER_MAP: 'local-network=fabric',
  LEDGER_MSP_ID: 'Org1MSP',
} as const;
const CANONICAL_INDIVIDUAL_CONTROLLER_SUBJECT_DID = testIndividualControllerDcrIdentity.subjectDid
  .replace(/:individual:[^:]+:(z[1-9A-HJ-NP-Za-km-z]+)$/, ':individual:multibase:$1');
const CANONICAL_INDIVIDUAL_CONTROLLER_ACTOR_DID = testIndividualControllerDcrIdentity.actorDid
  .replace(testIndividualControllerDcrIdentity.subjectDid, CANONICAL_INDIVIDUAL_CONTROLLER_SUBJECT_DID);

describe('DeviceRegistrationManager', () => {
  let manager: DeviceRegistrationManager;
  let vaultRepository: VaultMemRepository;
  const originalNetworkMode = process.env.NETWORK_MODE;
  const originalLedgerEnabled = process.env.LEDGER_ENABLED;
  const originalLedgerProviderDefault = process.env.LEDGER_PROVIDER_DEFAULT;
  const originalLedgerProviderMap = process.env.LEDGER_PROVIDER_MAP;
  const originalLedgerMspId = process.env.LEDGER_MSP_ID;
  
  beforeEach(() => {
    jest.clearAllMocks();
    vaultRepository = new VaultMemRepository();
    manager = new DeviceRegistrationManager(TEST_API_BASE_URL, vaultRepository, mockKmsService);
    delete process.env.NETWORK_MODE;
    delete process.env.LEDGER_ENABLED;
    delete process.env.LEDGER_PROVIDER_DEFAULT;
    delete process.env.LEDGER_PROVIDER_MAP;
    delete process.env.LEDGER_MSP_ID;
  });

  afterAll(() => {
    process.env.NETWORK_MODE = originalNetworkMode;
    process.env.LEDGER_ENABLED = originalLedgerEnabled;
    process.env.LEDGER_PROVIDER_DEFAULT = originalLedgerProviderDefault;
    process.env.LEDGER_PROVIDER_MAP = originalLedgerProviderMap;
    process.env.LEDGER_MSP_ID = originalLedgerMspId;
  });
  
  it('should be defined', () => {
    expect(manager).toBeDefined();
  });

  describe('process', () => {
    it('should process a valid web DCR job and return a success response with a client_id', async () => {
      // Arrange
      const job = cloneDeep(DCR_REGISTRATION_JOB);
      (job.content?.body as any).application_type = 'web';
      (job.content?.body as any).software_id = 'online.example.professional';
      (job.content?.body as any).software_version = '2.4.0';
      const activationCode = (job.content?.body as any)?.code as string;
      const vaultId = getTenantVaultId(job.sector as any, job.tenantId as string);
      const license: DeviceLicense = {
        id: 'license-1',
        tenantId: job.tenantId as string,
        orderId: 'order-1',
        activationCode,
        userClass: 'employee',
        type: 'mobile',
        status: 'issued',
        plan: 'default',
        renewalCycle: '12m',
        reactivationEnabled: false,
        exp: Math.floor(Date.now() / 1000) + 3600,
      };
      const licenseDoc: ConfidentialStorageDoc = {
        id: license.id,
        status: license.status,
        sequence: 0,
        content: license,
      };
      await vaultRepository.put(vaultId, [licenseDoc], getEnvSectionId('device-licenses'));

      // Act
      const result = await manager.process(job);

      // Assert
      const responseBody = result.body as BundleJsonApi;
      const responseEntry = responseBody.data[0] as BundleEntryResponse;
      expect(responseEntry.response.status).toEqual('201');
      
      const resource = responseEntry.resource as any;
      expect(resource.resourceType).toEqual('Device');
      expect(uuidValidate(resource.client_id)).toBe(true);
      expect(resource.client_id_issued_at).toBeCloseTo(Math.floor(Date.now() / 1000), -1);
      expect(resource.registration_client_uri).toBe(`${TEST_API_BASE_URL}/clients/${resource.client_id}`);

      const deviceProfileDoc = await vaultRepository.get<ConfidentialStorageDoc>(
        vaultId,
        resource.client_id,
        getEnvSectionId('device-profiles')
      );
      expect(deviceProfileDoc).toBeDefined();
      expect(deviceProfileDoc?.jwe).toBeDefined();
      const deviceProfile = await mockKmsService.unprotectConfidentialData<any>(deviceProfileDoc!, vaultId);
      expect(deviceProfile.software_id).toBe('online.example.professional');
      expect(deviceProfile.software_version).toBe('2.4.0');
      expect(deviceProfile.application_type).toBe('web');

      const updatedLicense = await vaultRepository.get<ConfidentialStorageDoc>(
        vaultId,
        license.id,
        getEnvSectionId('device-licenses')
      );
      expect(updatedLicense?.jwe).toBeDefined();
      const updatedContent = await mockKmsService.unprotectConfidentialData<DeviceLicense>(updatedLicense!, vaultId);
      expect(updatedContent.deviceId).toBe(resource.client_id);
      expect((updatedContent as any).maxDevices).toBe(5);
      expect((updatedContent as any).deviceBindings).toHaveLength(1);
      expect(updatedContent.status).toBe('active');
      expect(updatedLicense?.status).toBe('active');
    });

    it('uses the verified initial-access-token activation binding when the server-side professional flow omits the code from the DCR body', async () => {
      const job = cloneDeep(DCR_REGISTRATION_JOB);
      const activationCode = String((job.content?.body as any).code);
      delete (job.content?.body as any).code;
      job.content!.meta = {
        bearer: { jwt: { payload: { sub: 'verified-professional', act_code: activationCode, scope: 'dcr:register' } } },
      } as any;
      const vaultId = getTenantVaultId(job.sector as any, job.tenantId as string);
      await vaultRepository.put(vaultId, [{
        id: 'portable-professional-license', status: 'active', sequence: 1,
        content: {
          id: 'portable-professional-license', tenantId: job.tenantId, orderId: 'portable-professional-order',
          activationCode, userClass: 'employee', type: 'web', status: 'active',
          plan: 'default', renewalCycle: '12m', reactivationEnabled: false,
          exp: Math.floor(Date.now() / 1000) + 3600,
        } as DeviceLicense,
      }], getEnvSectionId('device-licenses'));

      const result = await manager.process(job);

      expect(((result.body as BundleJsonApi).data[0] as BundleEntryResponse).response.status).toBe('201');
    });

    it('accepts only the hosted professional DID that resolves to the licensed employee identity', async () => {
      const job = cloneDeep(DCR_REGISTRATION_JOB);
      job.jurisdiction = 'CA-BC';
      job.sector = DataspaceSectors.AnimalCare;
      const vaultId = getTenantVaultId(job.sector as any, job.tenantId as string);
      const employeeId = `urn:uuid:${EXAMPLE_KYC_CONTROLLER_USER_UUID}`;
      const differentProfessionalDid = 'did:web:api.acme.org:employee:different-veterinarian';
      const employeeUrn = createEmployeeUrn({
        namespace: URN_NAMESPACE,
        network: URN_NETWORK,
        jurisdiction: 'CA-BC',
        version: URN_VERSION,
        sector: DataspaceSectors.AnimalCare,
        idType: 'tax',
        idValue: EXAMPLE_LEGAL_ORGANIZATION_TAX_ID,
        email: EXAMPLE_EMAIL_PROFESSIONAL,
        role: HealthcareActorRoles.Veterinarian,
      });
      const licensedEmployeeDid = employeeUrn;
      const employeeCollectionName = 'physical-tenant-collection';
      await vaultRepository.put(employeeCollectionName, [{
        id: employeeId,
        status: EntityLifecycleStatus.Active,
        sequence: 0,
        content: {
          id: employeeId,
          type: EntityType.Person,
          status: EntityLifecycleStatus.Active,
          claims: {
            [ClaimsPersonSchemaorg.email]: EXAMPLE_EMAIL_PROFESSIONAL,
            [ClaimsPersonSchemaorg.hasOccupation]: HealthcareActorRoles.Veterinarian,
          },
          didDocument: {
            '@context': 'https://www.w3.org/ns/did/v1',
            id: licensedEmployeeDid,
            alsoKnownAs: [employeeUrn],
            verificationMethod: [],
            service: [],
          },
          didConfig: { service: [] },
          meta: { lastUpdated: '2026-10-04T00:00:00.000Z' },
        },
      } as ConfidentialStorageDoc], getEnvSectionId('employees'));
      manager = new DeviceRegistrationManager(
        TEST_API_BASE_URL,
        vaultRepository,
        undefined,
        {
          getCollectionName: jest.fn(async () => employeeCollectionName),
          getOrganizationIdentifierUrn: jest.fn(async () => TEST_ORGANIZATION_URN),
        } as any,
      );
      const registrationRequest = job.content!.body as any;
      registrationRequest[IdentityDcrMetadataFields.ActorDid] = differentProfessionalDid;
      registrationRequest[IdentityDcrMetadataFields.ProfileDid] = differentProfessionalDid;

      await expect((manager as any).prepareEmployeeDeviceIdentityContext({
        job,
        vaultId,
        registrationRequest,
        license: {
          subjectId: employeeId,
          activatedBy: normalizeSameAsHash(EXAMPLE_EMAIL_PROFESSIONAL),
          issuedToRole: HealthcareActorRoles.Veterinarian,
          ownerOrganizationId: EXAMPLE_LEGAL_ORGANIZATION_TAX_ID,
        },
        clientId: 'new-browser-installation',
      })).rejects.toThrow('Professional DCR actor and profile DID must match the licensed employee identity.');

      const employeeMemberId = employeeUrn.split(':employee:')[1].split(':role:')[0];
      const routedProfessionalDid = `did:web:localhost%3A3001:${job.tenantId}:cds-${job.jurisdiction}:v1:${job.sector}:employee:${employeeMemberId}:ISCO-08|2250`;
      registrationRequest[IdentityDcrMetadataFields.ActorDid] = routedProfessionalDid;
      registrationRequest[IdentityDcrMetadataFields.ProfileDid] = routedProfessionalDid;
      await expect((manager as any).prepareEmployeeDeviceIdentityContext({
        job,
        vaultId,
        registrationRequest,
        license: {
          subjectId: employeeId,
          activatedBy: normalizeSameAsHash(EXAMPLE_EMAIL_PROFESSIONAL),
          issuedToRole: HealthcareActorRoles.Veterinarian,
          ownerOrganizationId: EXAMPLE_LEGAL_ORGANIZATION_TAX_ID,
        },
        clientId: 'new-browser-installation',
      })).resolves.toEqual(expect.objectContaining({ subjectId: employeeId }));
    });

    it('links DCR client and key aliases only to an existing stable clinical creator assignment', async () => {
      const job = cloneDeep(DCR_REGISTRATION_JOB);
      const body = job.content?.body as any;
      const activationCode = String(body?.code);
      const vaultId = getTenantVaultId(job.sector as any, job.tenantId as string);
      const actorDid = 'did:web:clinic.example:employees:stable-practitioner';
      const binding = {
        id: `urn:uuid:${EXAMPLE_KYC_CONTROLLER_UUID}`,
        kind: FhirIpsCreatorKinds.Professional,
        actorIdentifier: `urn:uuid:${EXAMPLE_KYC_CONTROLLER_USER_UUID}`,
        authorIdentifier: `urn:uuid:${EXAMPLE_KYC_CONTROLLER_UUID}`,
        ownerIdentifier: 'did:web:clinic.example',
        role: HealthcareActorRoles.Veterinarian,
      };
      Object.assign(body, {
        [IdentityDcrMetadataFields.ActorDid]: actorDid,
        [IdentityDcrMetadataFields.ProfileDid]: actorDid,
        [IdentityDcrMetadataFields.ClinicalCreatorBinding]: {
          kind: binding.kind,
          actorIdentifier: binding.actorIdentifier,
          authorIdentifier: binding.authorIdentifier,
          ownerIdentifier: binding.ownerIdentifier,
          // The high-level SDK emits the governed canonical coding system,
          // while older employee records retain the accepted ISCO-08 alias.
          role: 'org.ilo.isco|2250',
        },
      });
      await vaultRepository.put(vaultId, [{
        id: 'license-clinical-creator',
        status: 'issued',
        sequence: 0,
        content: {
          id: 'license-clinical-creator',
          tenantId: job.tenantId,
          orderId: 'order-clinical-creator',
          activationCode,
          userClass: 'employee',
          type: 'web',
          status: 'issued',
          plan: 'default',
          renewalCycle: '12m',
          reactivationEnabled: false,
          exp: Math.floor(Date.now() / 1000) + 3600,
        },
      }], getEnvSectionId('device-licenses'));

      const rejected = await manager.process(job);
      expect(((rejected.body as BundleJsonApi).data[0] as ErrorEntry).response.status)
        .toBe(String(HttpStatusCodes.Forbidden));

      await vaultRepository.put(vaultId, [binding], getClinicalCreatorBindingsSectionId());
      const result = await manager.process(job);

      const entry = (result.body as BundleJsonApi).data[0] as BundleEntryResponse;
      expect(entry.response.status).toBe(String(HttpStatusCodes.Created));
      const clientId = String((entry.resource as any).client_id);
      const stored = await vaultRepository.get<any>(
        vaultId,
        binding.authorIdentifier,
        getClinicalCreatorBindingsSectionId(),
      );
      expect(stored).toEqual(expect.objectContaining({
        ...binding,
        actorDids: [actorDid],
        dcrClientIds: expect.arrayContaining([clientId, body.ext_device_info.device_id]),
        keyIds: expect.arrayContaining(body.jwks.keys.map((key: any) => key.kid)),
      }));

    });

    it.each([
      {
        label: 'canonical multibase',
        actorDid: CANONICAL_INDIVIDUAL_CONTROLLER_ACTOR_DID,
        subjectDid: CANONICAL_INDIVIDUAL_CONTROLLER_SUBJECT_DID,
        licensedSubjectDid: undefined,
      },
      {
        label: 'historical typed',
        actorDid: testIndividualControllerDcrIdentity.actorDid,
        subjectDid: testIndividualControllerDcrIdentity.subjectDid,
        licensedSubjectDid: testIndividualControllerDcrIdentity.subjectDid,
      },
      {
        // The controller is a RelatedPerson/RESPRSN actor. The animal remains
        // the distinct ONESELF subject; DCR must bind the relationship rather
        // than requiring the human actor DID to equal the animal DID.
        label: 'separate animal subject and controller actor',
        actorDid: testIndividualControllerDcrIdentity.actorDid,
        subjectDid: EXAMPLE_SUBJECT_DID,
        licensedSubjectDid: EXAMPLE_SUBJECT_DID,
      },
    ])('binds a $label individual-member controller and preserves compatibility with issued seats', async ({
      actorDid,
      subjectDid,
      licensedSubjectDid,
    }) => {
      const job = cloneDeep(DCR_REGISTRATION_JOB);
      const activationCode = (job.content?.body as any).code as string;
      Object.assign(job.content!.body as any, {
        actor_did: actorDid,
        profile_did: actorDid,
        [IdentityDcrMetadataFields.ClinicalCreatorBinding]: {
          kind: FhirIpsCreatorKinds.IndividualMember,
          actorIdentifier: `urn:uuid:${EXAMPLE_KYC_CONTROLLER_USER_UUID}`,
          authorIdentifier: `urn:uuid:${EXAMPLE_KYC_CONTROLLER_UUID}`,
          ownerIdentifier: `urn:uuid:${EXAMPLE_PRIVATE_INDIVIDUAL_UUID}`,
          role: testIndividualControllerDcrIdentity.role,
        },
      });
      job.content!.meta = {
        bearer: { jwt: { payload: {
          sub: testIndividualControllerDcrIdentity.authenticatedSubject,
          act_code: activationCode,
          scope: testIndividualControllerDcrIdentity.scope,
        } } },
      } as any;
      const vaultId = getTenantVaultId(job.sector as any, job.tenantId as string);
      await vaultRepository.put(vaultId, [{
        id: 'animal-controller-license', status: 'active', sequence: 1,
        content: {
          id: 'animal-controller-license', tenantId: job.tenantId, orderId: 'animal-order',
          activationCode, userClass: 'individual', type: 'mobile', status: 'active',
          plan: 'default', renewalCycle: '12m', reactivationEnabled: false,
          exp: Math.floor(Date.now() / 1000) + 3600,
          ownerOrganizationId: EXAMPLE_PRIVATE_INDIVIDUAL_UUID,
          subjectId: EXAMPLE_PRIVATE_INDIVIDUAL_UUID,
          issuedToEmail: EXAMPLE_EMAIL_CONTROLLER_INDIVIDUAL,
          issuedToRole: testIndividualControllerDcrIdentity.role,
          authorizedSubjectDid: licensedSubjectDid,
        } as DeviceLicense,
      }], getEnvSectionId('device-licenses'));

      const result = await manager.process(job);
      const entry = (result.body as BundleJsonApi).data[0] as BundleEntryResponse;
      expect(entry.response.status).toBe('201');
      const clientId = String((entry.resource as any).client_id);
      const stored = await vaultRepository.get<ConfidentialStorageDoc>(
        vaultId, clientId, getEnvSectionId('device-profiles'),
      );
      const profile = await mockKmsService.unprotectConfidentialData<any>(stored!, vaultId);
      expect(profile).toEqual(expect.objectContaining({
        actorDid,
        profileDid: actorDid,
        authorizedSubjectDid: subjectDid,
        authenticatedSubject: testIndividualControllerDcrIdentity.authenticatedSubject,
        authenticatedEmail: EXAMPLE_EMAIL_CONTROLLER_INDIVIDUAL,
        licenseId: 'animal-controller-license',
      }));
      const repairedLicenseDocument = await vaultRepository.get<ConfidentialStorageDoc>(
        vaultId, 'animal-controller-license', getEnvSectionId('device-licenses'),
      );
      const repairedLicense = await mockKmsService.unprotectConfidentialData<any>(
        repairedLicenseDocument!, vaultId,
      );
      expect(repairedLicense).toEqual(expect.objectContaining({
        subjectId: EXAMPLE_PRIVATE_INDIVIDUAL_UUID,
        authorizedSubjectDid: subjectDid,
        activatedBy: buildStableActorIdentifier({
          contactKind: 'email',
          contact: EXAMPLE_EMAIL_CONTROLLER_INDIVIDUAL,
        }),
      }));
      const creatorBinding = await vaultRepository.get<any>(
        vaultId, `urn:uuid:${EXAMPLE_KYC_CONTROLLER_UUID}`, getClinicalCreatorBindingsSectionId(),
      );
      expect(creatorBinding).toEqual(expect.objectContaining({
        kind: FhirIpsCreatorKinds.IndividualMember,
        actorDids: [actorDid],
      }));
    });

    it('does not promote a non-controller individual role into DCR controller authority', async () => {
      const job = cloneDeep(DCR_REGISTRATION_JOB);
      const authenticatedSubject = 'firebase-member-001';
      const actorDid = testIndividualControllerDcrIdentity.actorDid.replace(/:[^:]+$/, ':CHILD');
      const activationCode = (job.content?.body as any).code as string;
      Object.assign(job.content!.body as any, { actor_did: actorDid, profile_did: actorDid });
      job.content!.meta = {
        bearer: { jwt: { payload: { sub: authenticatedSubject, act_code: activationCode, scope: 'dcr:register' } } },
      } as any;
      const vaultId = getTenantVaultId(job.sector as any, job.tenantId as string);
      await vaultRepository.put(vaultId, [{
        id: 'animal-member-license', status: 'active', sequence: 1,
        content: {
          id: 'animal-member-license', tenantId: job.tenantId, orderId: 'animal-order',
          activationCode, userClass: 'individual', type: 'mobile', status: 'active',
          plan: 'default', renewalCycle: '12m', reactivationEnabled: false,
          exp: Math.floor(Date.now() / 1000) + 3600,
          issuedToEmail: EXAMPLE_EMAIL_CONTROLLER_INDIVIDUAL,
          issuedToRole: 'v3-RoleCode|CHILD',
          authorizedSubjectDid: testIndividualControllerDcrIdentity.subjectDid,
        } as DeviceLicense,
      }], getEnvSectionId('device-licenses'));

      const result = await manager.process(job);
      const entry = (result.body as BundleJsonApi).data[0] as ErrorEntry;
      expect(entry.response.status).toBe('403');
      expect(entry.response.outcome?.issue[0]?.diagnostics).toContain('controller role');
    });

    it('rejects DCR instead of persisting a phantom client when the licensed controller entity is missing', async () => {
      const job = cloneDeep(DCR_REGISTRATION_JOB);
      const activationCode = (job.content?.body as any).code as string;
      const vaultId = getTenantVaultId(job.sector as any, job.tenantId as string);
      const physicalCollectionName = 'physical-tenant-collection';
      manager = new DeviceRegistrationManager(
        TEST_API_BASE_URL,
        vaultRepository,
        mockKmsService,
        { getCollectionName: jest.fn(async () => physicalCollectionName) },
      );
      const license: DeviceLicense = {
        id: 'controller-license-without-entity',
        tenantId: job.tenantId as string,
        orderId: 'order-1',
        activationCode,
        userClass: 'employee',
        type: 'mobile',
        status: 'issued',
        plan: 'default',
        renewalCycle: '12m',
        reactivationEnabled: false,
        exp: Math.floor(Date.now() / 1000) + 3600,
        subjectId: 'missing-controller-entity',
        activatedBy: 'urn:multibase:zNeutralControllerActor',
      } as any;
      const protectedLicense = await mockKmsService.protectConfidentialData({
        id: license.id,
        status: license.status,
        sequence: 0,
        content: license,
      }, vaultId);
      await vaultRepository.put(vaultId, [protectedLicense], getEnvSectionId('device-licenses'));

      const result = await manager.process(job);
      const responseEntry = (result.body as BundleJsonApi).data[0] as ErrorEntry;

      expect(responseEntry.response.status).toBe('409');
      expect(responseEntry.response.outcome).toEqual(expect.objectContaining({
        resourceType: 'OperationOutcome',
      }));
      expect(await vaultRepository.getContainersInSection(
        vaultId,
        getEnvSectionId('device-profiles'),
      )).toHaveLength(0);
    });

    it('should keep two devices and both key sets active for the same employee seat', async () => {
      Object.assign(process.env, FABRIC_LEDGER_TEST_ENV);
      jest.mocked(mockKmsService.protectAttributesNameAndValue).mockImplementation(async (attributes: any[]) =>
        attributes.map((attribute) => ({
          name: `protected:${attribute.name}`,
          value: `protected:${attribute.value}`,
          unique: attribute.unique,
        })));

      const registerKeySpy = jest.spyOn(ManageAssetCryptographicKey.prototype, 'registerKey').mockResolvedValue({} as any);
      const keySubmitSpy = jest.spyOn(ManageAssetCryptographicKey.prototype, 'submit').mockResolvedValue({} as any);
      const bindingSpy = jest.spyOn(ManageAssetSubjectKeyBinding.prototype, 'upsertSubjectKeyBinding').mockResolvedValue({} as any);

      const job = cloneDeep(DCR_REGISTRATION_JOB);
      job.jurisdiction = 'ES';
      (job.content?.body as any).application_type = 'native';
      (job.content?.body as any).jwks = {
        keys: [
          {
            kty: 'AKP',
            alg: 'ML-DSA-44',
            kid: 'sig-new',
            use: 'sig',
            pub: 'sig-new-pub',
          },
          {
            kty: 'OKP',
            crv: 'ML-KEM-768',
            kid: 'enc-new',
            use: 'enc',
            x: 'enc-new-x',
          },
        ],
      };

      const activationCode = (job.content?.body as any)?.code as string;
      const vaultId = getTenantVaultId(job.sector as any, job.tenantId as string);
      const tenantCollectionName = 'physical-tenant-collection';
      manager = new DeviceRegistrationManager(
        TEST_API_BASE_URL,
        vaultRepository,
        mockKmsService,
        {
          getCollectionName: jest.fn(async () => tenantCollectionName),
          getOrganizationIdentifierUrn: jest.fn(async () => TEST_ORGANIZATION_URN),
        } as any,
      );

      const employeeId = `urn:uuid:${EXAMPLE_KYC_CONTROLLER_USER_UUID}`;
      const employeeUrn = createEmployeeUrn({
        namespace: URN_NAMESPACE,
        network: URN_NETWORK,
        jurisdiction: 'CA-BC',
        version: URN_VERSION,
        sector: DataspaceSectors.AnimalCare,
        idType: 'tax',
        idValue: EXAMPLE_LEGAL_ORGANIZATION_TAX_ID,
        email: EXAMPLE_EMAIL_PROFESSIONAL,
        role: HealthcareActorRoles.Veterinarian,
      });
      const employeeDid = 'did:web:api.acme.org:employee:veterinarian';
      Object.assign(job.content!.body as any, {
        [IdentityDcrMetadataFields.ActorDid]: employeeDid,
        [IdentityDcrMetadataFields.ProfileDid]: employeeDid,
      });
      const employeeConfig: EntityConfig = {
        id: employeeId,
        type: EntityType.Person,
        status: EntityLifecycleStatus.Active,
        claims: {
          [ClaimsPersonSchemaorg.email]: EXAMPLE_EMAIL_PROFESSIONAL,
          [ClaimsPersonSchemaorg.hasOccupation]: HealthcareActorRoles.Veterinarian,
        } as any,
        didDocument: {
          '@context': 'https://www.w3.org/ns/did/v1',
          id: employeeDid,
          alsoKnownAs: [employeeUrn],
          verificationMethod: [
            {
              id: `${employeeDid}#sig-old`,
              type: 'JsonWebKey',
              controller: employeeDid,
              publicKeyJwk: {
                kty: 'AKP',
                alg: 'ML-DSA-44',
                kid: 'sig-old',
                use: 'sig',
                pub: 'sig-old-pub',
              } as any,
            },
            {
              id: `${employeeDid}#enc-old`,
              type: 'JsonWebKey',
              controller: employeeDid,
              publicKeyJwk: {
                kty: 'OKP',
                crv: 'ML-KEM-768',
                kid: 'enc-old',
                use: 'enc',
                x: 'enc-old-x',
              } as any,
            },
          ],
          authentication: [`${employeeDid}#sig-old`],
          keyAgreement: [`${employeeDid}#enc-old`],
          service: [],
        },
        didConfig: { service: [] },
        meta: { lastUpdated: '2026-06-01T00:00:00.000Z' },
      };
      const protectedEmployeeDoc = await mockKmsService.protectConfidentialData({
        id: employeeId,
        status: employeeConfig.status,
        sequence: 0,
        content: employeeConfig,
      } as ConfidentialStorageDoc, vaultId);
      await vaultRepository.put(tenantCollectionName, [protectedEmployeeDoc], getEnvSectionId('employees'));

      const previousDeviceId = 'old-device-001';
      const protectedPreviousProfile = await mockKmsService.protectConfidentialData({
        id: previousDeviceId,
        status: 'active',
        sequence: 0,
        content: {
          type: 'DeviceProfile',
          clientId: previousDeviceId,
          jwks: {
            keys: [
              { kty: 'AKP', alg: 'ML-DSA-44', kid: 'sig-old', use: 'sig', pub: 'sig-old-pub' },
              { kty: 'OKP', crv: 'ML-KEM-768', kid: 'enc-old', use: 'enc', x: 'enc-old-x' },
            ],
          },
          verificationMethodIds: [`${employeeDid}#sig-old`, `${employeeDid}#enc-old`],
        },
      } as ConfidentialStorageDoc, vaultId);
      await vaultRepository.put(vaultId, [protectedPreviousProfile], getEnvSectionId('device-profiles'));

      const license: DeviceLicense = {
        id: 'license-1',
        tenantId: job.tenantId as string,
        orderId: 'order-1',
        activationCode,
        userClass: 'employee',
        type: 'mobile',
        status: 'issued',
        plan: 'default',
        renewalCycle: '12m',
        reactivationEnabled: false,
        exp: Math.floor(Date.now() / 1000) + 3600,
        ownerOrganizationId: EXAMPLE_LEGAL_ORGANIZATION_TAX_ID,
        issuedToRole: HealthcareActorRoles.Veterinarian,
        subjectId: employeeId,
        activatedBy: normalizeSameAsHash('employee@example.org'),
        deviceId: previousDeviceId,
      } as any;
      const licenseDoc: ConfidentialStorageDoc = {
        id: license.id,
        status: license.status,
        sequence: 0,
        content: license,
      };
      const protectedLicenseDoc = await mockKmsService.protectConfidentialData(licenseDoc, vaultId);
      await vaultRepository.put(vaultId, [protectedLicenseDoc], getEnvSectionId('device-licenses'));
      const clinicalCreatorBinding = {
        id: `urn:uuid:${EXAMPLE_KYC_CONTROLLER_UUID}`,
        kind: FhirIpsCreatorKinds.Professional,
        actorIdentifier: employeeId,
        authorIdentifier: `urn:uuid:${EXAMPLE_KYC_CONTROLLER_UUID}`,
        ownerIdentifier: TEST_ORGANIZATION_URN,
        role: HealthcareActorRoles.Veterinarian,
      };
      await vaultRepository.put(
        vaultId,
        [clinicalCreatorBinding],
        getClinicalCreatorBindingsSectionId(),
      );

      const result = await manager.process(job);
      const responseEntry = (result.body as BundleJsonApi).data[0] as BundleEntryResponse;
      const newClientId = String((responseEntry.resource as any).client_id || '');

      expect(responseEntry.response.status).toBe('201');
      expect(newClientId).toBeTruthy();
      expect(newClientId).not.toBe(previousDeviceId);

      const previousProfileDoc = await vaultRepository.get<ConfidentialStorageDoc>(
        vaultId,
        previousDeviceId,
        getEnvSectionId('device-profiles'),
      );
      expect(previousProfileDoc?.status).toBe('active');

      const updatedEmployeeDoc = await vaultRepository.get<ConfidentialStorageDoc>(
        tenantCollectionName,
        employeeId,
        getEnvSectionId('employees'),
      );
      const updatedEmployee = await mockKmsService.unprotectConfidentialData<EntityConfig>(updatedEmployeeDoc!, vaultId);
      expect(updatedEmployee.didDocument?.verificationMethod?.map((method) => method.id)).toEqual(
        expect.arrayContaining([`${employeeDid}#sig-new`, `${employeeDid}#enc-new`]),
      );
      expect(updatedEmployee.didDocument?.verificationMethod?.map((method) => method.id)).toEqual(
        expect.arrayContaining([`${employeeDid}#sig-old`, `${employeeDid}#enc-old`]),
      );
      // Secure resource routes resolve the signer by protected `kid`. DCR must
      // index each newly bound device key, not only add it inside encrypted DID
      // document content that the route cannot discover efficiently.
      const [protectedNewSignerKid] = await mockKmsService.protectAttributesNameAndValue([
        { name: 'kid', value: 'sig-new', unique: false, type: 'string' },
      ], vaultId);
      const signerDocuments = await vaultRepository.query(tenantCollectionName, {
        sectionId: getEnvSectionId('employees'),
        where: [{ name: protectedNewSignerKid.name, value: protectedNewSignerKid.value }],
      });
      expect(signerDocuments.map((document) => document.id)).toContain(employeeId);

      const updatedLicense = await vaultRepository.get<ConfidentialStorageDoc>(
        vaultId, license.id, getEnvSectionId('device-licenses'),
      );
      const updatedLicenseContent = await mockKmsService.unprotectConfidentialData<DeviceLicense & Record<string, any>>(
        updatedLicense!, vaultId,
      );
      expect(updatedLicenseContent.deviceId).toBe(previousDeviceId);
      expect((updatedLicenseContent.deviceBindings || []).filter((binding: any) => binding.status === 'active')).toHaveLength(2);

      expect(registerKeySpy).toHaveBeenCalledTimes(2);
      expect(keySubmitSpy).not.toHaveBeenCalled();
      expect(bindingSpy).toHaveBeenCalled();
      expect(bindingSpy).toHaveBeenCalledWith(
        expect.any(String),
        expect.stringContaining(employeeUrn),
        expect.objectContaining({
          subjectId: employeeUrn,
          licensedRole: HealthcareActorRoles.Veterinarian,
          roleLicenseId: expect.stringMatching(/^urn:multibase:/),
          meta: expect.objectContaining({
            attributes: expect.objectContaining({ did: employeeDid }),
          }),
        }),
      );
      const linkedClinicalCreator = await vaultRepository.get<any>(
        vaultId,
        clinicalCreatorBinding.authorIdentifier,
        getClinicalCreatorBindingsSectionId(),
      );
      expect(linkedClinicalCreator).toEqual(expect.objectContaining({
        ...clinicalCreatorBinding,
        actorDids: [employeeDid],
        dcrClientIds: expect.arrayContaining([newClientId, (job.content!.body as any).ext_device_info.device_id]),
        keyIds: expect.arrayContaining((job.content!.body as any).jwks.keys.map((key: any) => key.kid)),
      }));
    });

    it('should reject a third installation when the seat allowance is two', async () => {
      const job = cloneDeep(DCR_REGISTRATION_JOB);
      (job.content?.body as any).ext_device_info.device_id = EXAMPLE_EMPLOYEE_DEVICE_INSTANCE_ID_TERTIARY;
      const activationCode = (job.content?.body as any).code;
      const vaultId = getTenantVaultId(job.sector as any, job.tenantId as string);
      await vaultRepository.put(vaultId, [{
        id: 'license-full', status: 'active', sequence: 0, content: {
          id: 'license-full', tenantId: job.tenantId, orderId: 'order', activationCode,
          userClass: 'employee', type: 'web', status: 'active', plan: 'default',
          renewalCycle: '12m', reactivationEnabled: false, exp: Math.floor(Date.now() / 1000) + 3600,
          maxDevices: EXAMPLE_EMPLOYEE_ACTIVE_DEVICE_BINDINGS.length,
          deviceBindings: EXAMPLE_EMPLOYEE_ACTIVE_DEVICE_BINDINGS,
        },
      } as any], getEnvSectionId('device-licenses'));

      const result = await manager.process(job);
      expect(((result.body as BundleJsonApi).data[0] as ErrorEntry).response.status).toBe(ExampleHttpStatusText.Conflict);
    });

    it('revokes one selected installation and keeps the other device active on the same seat', async () => {
      const job = cloneDeep(DCR_REGISTRATION_JOB);
      job.action = IdentityAuthActions.Revoke;
      job.content!.body = {
        [IdentityAuthRequestFields.LicenseId]: EXAMPLE_LICENSE_ACTIVE_RECORD.id,
        [IdentityAuthRequestFields.ClientId]: EXAMPLE_EMPLOYEE_DEVICE_CLIENT_ID_PRIMARY,
      } as any;
      const vaultId = getTenantVaultId(job.sector as any, job.tenantId as string);
      const protectedLicense = await mockKmsService.protectConfidentialData({
        id: EXAMPLE_LICENSE_ACTIVE_RECORD.id, status: EXAMPLE_LICENSE_ACTIVE_RECORD.status, sequence: 0, content: {
          id: EXAMPLE_LICENSE_ACTIVE_RECORD.id, tenantId: job.tenantId, orderId: 'order', userClass: 'employee',
          type: 'web', status: 'active', plan: 'default', renewalCycle: '12m',
          reactivationEnabled: false, exp: Math.floor(Date.now() / 1000) + 3600, maxDevices: 2,
          deviceBindings: EXAMPLE_EMPLOYEE_ACTIVE_DEVICE_BINDINGS,
        },
      } as ConfidentialStorageDoc, vaultId);
      await vaultRepository.put(vaultId, [protectedLicense], getEnvSectionId('device-licenses'));
      const profile = await mockKmsService.protectConfidentialData({
        id: EXAMPLE_EMPLOYEE_DEVICE_CLIENT_ID_PRIMARY, status: DeviceBindingStatuses.Active, sequence: 0,
        content: { clientId: EXAMPLE_EMPLOYEE_DEVICE_CLIENT_ID_PRIMARY, verificationMethodIds: [] },
      } as ConfidentialStorageDoc, vaultId);
      await vaultRepository.put(vaultId, [profile], getEnvSectionId('device-profiles'));

      const result = await manager.process(job);
      expect(((result.body as BundleJsonApi).data[0] as BundleEntryResponse).response.status).toBe(ExampleHttpStatusText.Ok);
      const updated = await vaultRepository.get<ConfidentialStorageDoc>(
        vaultId, EXAMPLE_LICENSE_ACTIVE_RECORD.id, getEnvSectionId('device-licenses'),
      );
      const updatedContent = await mockKmsService.unprotectConfidentialData<DeviceLicense & Record<string, any>>(
        updated!, vaultId,
      );
      const updatedBindings = updatedContent.deviceBindings || [];
      expect(updatedBindings.filter((binding: any) => binding.status === DeviceBindingStatuses.Active))
        .toHaveLength(1);
      expect(updatedBindings.find((binding: any) => binding.clientId === EXAMPLE_EMPLOYEE_DEVICE_CLIENT_ID_PRIMARY)?.status)
        .toBe(DeviceBindingStatuses.Revoked);
      const revokedProfile = await vaultRepository.get<ConfidentialStorageDoc>(
        vaultId, EXAMPLE_EMPLOYEE_DEVICE_CLIENT_ID_PRIMARY, getEnvSectionId('device-profiles'),
      );
      expect(revokedProfile?.status).toBe(DeviceBindingStatuses.Revoked);
    });

    it('should return a 400 error if redirect_uris are missing', async () => {
      // Arrange
      const job = cloneDeep(DCR_REGISTRATION_JOB);
      delete (job.content?.body as any).redirect_uris;

      // Act
      const result = await manager.process(job);

      // Assert
      const errorEntry = (result.body as BundleJsonApi).data[0] as ErrorEntry;
      expect(errorEntry.response.status).toEqual('400');
      expect(errorEntry.response.outcome.issue[0].diagnostics).toContain(
        '`redirect_uris` is a required field and must be a non-empty array.'
      );
    });

    it('should return a 400 error if jwks is missing', async () => {
      // Arrange
      const job = cloneDeep(DCR_REGISTRATION_JOB);
      (job.content?.body as any).jwks = { keys: [] }; // Empty keys

      // Act
      const result = await manager.process(job);

      // Assert
      const errorEntry = (result.body as BundleJsonApi).data[0] as ErrorEntry;
      expect(errorEntry.response.status).toEqual('400');
      expect(errorEntry.response.outcome.issue[0].diagnostics).toContain(
        'Either `jwks` or `jwks_uri` is a required field.'
      );
    });
  });
});
