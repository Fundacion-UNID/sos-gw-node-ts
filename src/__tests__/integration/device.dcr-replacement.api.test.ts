// Flow contract: reuse shared test fixtures and canonical types; do not introduce duplicated literals.
import { resolveHostPhysicalCollectionName } from '../../config/storage-layout';
import { HttpRequestMethods } from 'gdc-common-utils-ts/constants/http';
// TDD contract: Device DCR accepts only verified initial-access claims and a valid nested signature.
process.env.DEV_SEED = 'true';
process.env.NODE_ENV = 'test';
process.env.SECURITY_MODE = 'demo';
process.env.NETWORK_MODE = 'local-network';
process.env.JSON_LEGACY = 'true';
process.env.FHIR_LEGACY = 'true';
process.env.DIDCOMM_PLAIN = 'true';
process.env.DEMO_ALLOW_INSECURE_BEARER = 'true';
process.env.DB_PROVIDER = 'mem';
process.env.STORAGE_PROVIDER = 'mem';
process.env.QUEUE_PROVIDER = 'mem';
process.env.HOST_EXTERNAL_DOMAIN = 'host.example.com';
process.env.HOST_LEGAL_NAME = 'Test Host';
process.env.HOST_JURISDICTION = 'ES';
process.env.HOST_ID_TYPE = 'TAX';
process.env.HOST_ID_VALUE = 'VATES-B00000000';
process.env.HOST_ADMIN_EMAIL = 'host-admin@example.com';
process.env.HOST_ADMIN_UID = 'host-admin';
process.env.HOST_ADMIN_ROLE = 'RESPRSN';
process.env.HOST_TERMS_URL = 'https://host.example.com/terms';
process.env.LEDGER_ENABLED = 'true';
process.env.LEDGER_MSP_ID = 'Org1MSP';

import express from 'express';
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { createApiRouter } from '../../routes/api';
import { AsyncResponseStoreMem } from '../../adapters/async-response-store.mem';
import { QueueAdapterMem } from '../../adapters/queue-mem';
import { VaultMemRepository } from '../../database/repositories/vault/vault.mem.repository';
import { TenantsCacheManager } from '../../managers/TenantsCacheManager';
import { DeviceRegistrationManager } from '../../managers/DeviceRegistrationManager';
import { HostingManager } from '../../managers/HostingManager';
import { Worker } from '../../worker';
import { KmsService } from '../../services/KmsService';
import { CryptographyService } from 'gdc-common-utils-ts/CryptographyService';
import { AdapterCryptoSdkNode } from '../../gdc-backend-utils-node/adapters/node/crypto';
import { StorageMemAdapter } from '../../database/storage/mem.storage.adapter';
import { ConsoleLogger } from '../../loggers/ConsoleLogger';
import { generateTenantCollectionNameFromClaims, getTenantVaultId } from '../../utils/tenant';
import { getEnvSectionId } from '../../utils/section-env';
import { invokeExpress } from './helpers/invokeExpress';
import { testClaimsHostInitialization, testClaimsTenant1Registration } from '../data/end-to-end.data';
import { ClaimsPersonSchemaorg, ClaimsServiceSchemaorg } from 'gdc-common-utils-ts/constants/schemaorg';
import { EntityLifecycleStatus, EntityType } from '../../gdc-backend-utils-node/models/enums';
import type { ConfidentialStorageDoc } from 'gdc-common-utils-ts/models/confidential-storage';
import type { EntityConfig } from '../../gdc-backend-utils-node/models/entity';
import type { DeviceLicense } from 'gdc-common-utils-ts/models/device-license';
import { ManageAssetCryptographicKey } from '../../blockchain/fabric/v3/manageAssetCryptographicKey';
import { ManageAssetSubjectKeyBinding } from '../../blockchain/fabric/v3/manageAssetSubjectKeyBinding';
import { ManageAssetOrganization } from '../../blockchain/fabric/v3/manageAssetOrganization';
import { ManageAssetArtifact } from '../../blockchain/fabric/v3/manageAssetArtifact';
import { ManageAssetArtifactEvent } from '../../blockchain/fabric/v3/manageAssetArtifactEvent';
import { ClearingHouseService } from '../../services/ClearingHouseService';
import {
  EXAMPLE_EMAIL_CONTROLLER_INDIVIDUAL,
  EXAMPLE_KYC_CONTROLLER_USER_UUID,
  EXAMPLE_KYC_CONTROLLER_UUID,
  EXAMPLE_PRIVATE_INDIVIDUAL_UUID,
} from 'gdc-common-utils-ts/examples/shared';
import { normalizeSameAsHash } from 'gdc-common-utils-ts/utils/same-as';
import type { AppAuthorizationManager } from '../../managers/AppAuthorizationManager';
import {
  DEVICE_REGISTRATION_REQUEST,
  INITIAL_ACCESS_TOKEN_EXCHANGE_RESPONSE,
  INITIAL_ACCESS_TOKEN_VERIFIED_CLAIMS,
  deviceJwkMldsa,
  deviceJwkMlkem,
} from '../data/example-payloads';
import { DCR_REGISTRATION_JOB } from '../data/example-jobs';
import { testTenant1AlternateName, testTenant1IdValue } from '../data/organization.data';
import { testTenant1IdentifierUrn } from '../data/organization.constants';
import { HealthcareActorRoles } from 'gdc-common-utils-ts/constants/healthcare';
import { IdentityDcrMetadataFields } from 'gdc-common-utils-ts/constants/identity-auth';
import { createEmployeeUrnFromStableActorIdentifier } from '../../utils/urn';
import { FhirIpsCreatorKinds } from 'gdc-common-utils-ts/utils/fhir-ips-creator-identity';
import { testIndividualControllerDcrIdentity } from '../data/identity.data';
import { getClinicalCreatorBindingsSectionId } from '../../utils/clinical-creator-binding';

describe('Device DCR multi-device route story', () => {
  let app: express.Express;
  let queueAdapter: QueueAdapterMem;
  let vaultRepository: VaultMemRepository;
  let tenantManager: TenantsCacheManager;
  let kmsService: KmsService;
  let cryptographyService: CryptographyService;
  let tenantVaultId: string;
  let verifyInitialAccessToken: jest.MockedFunction<AppAuthorizationManager['verifyInitialAccessToken']>;

  const readStoredContent = async <T>(doc: ConfidentialStorageDoc | undefined): Promise<T> => {
    if (!doc) throw new Error('expected stored document');
    if ((doc as any).jwe) {
      return kmsService.unprotectConfidentialData<T>(doc, tenantVaultId);
    }
    return doc.content as T;
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    jest.spyOn(ManageAssetOrganization.prototype, 'ensureOrganization').mockResolvedValue({ created: true, asset: {} });
    jest.spyOn(ManageAssetCryptographicKey.prototype, 'registerKey').mockResolvedValue({} as any);
    jest.spyOn(ManageAssetCryptographicKey.prototype, 'ensureKey').mockResolvedValue({ created: true, asset: {} } as any);
    jest.spyOn(ManageAssetSubjectKeyBinding.prototype, 'upsertSubjectKeyBinding').mockResolvedValue({} as any);
    jest.spyOn(ManageAssetArtifact.prototype, 'upsertArtifact').mockResolvedValue({} as any);
    jest.spyOn(ManageAssetArtifactEvent.prototype, 'createArtifactEvent').mockResolvedValue({} as any);

    const logger = new ConsoleLogger();
    cryptographyService = new CryptographyService(new AdapterCryptoSdkNode());
    vaultRepository = new VaultMemRepository();
    const asyncResponseStore = new AsyncResponseStoreMem();

    const hostCollectionName = resolveHostPhysicalCollectionName();
    tenantManager = new TenantsCacheManager(vaultRepository, () => kmsService, hostCollectionName);
    kmsService = new KmsService(cryptographyService, tenantManager);
    await kmsService.init();

    const mockConfig: any = {
      securityMode: 'demo',
      networkMode: 'local-network',
      fhirLegacy: true,
      jsonLegacy: true,
      didcommPlainEnabled: true,
      demoAllowInsecureBearer: true,
      nodeEnv: 'test',
      port: 3000,
      apiHostname: 'host',
      hostExternalDomain: 'host.example.com',
      apiBaseUrl: 'http://host.example.com',
      namespace: 'test-namespace',
      sectorsAllowed: ['health-care', 'test'],
      allowedPaymentMethods: ['Stripe'],
      dbProvider: 'mem',
      queueProvider: 'mem',
      storageProvider: 'mem',
      host: { legalName: 'Test Host', jurisdiction: 'es', idType: 'TAX', idValue: 'VATES-B00000000' },
      mongo: { dbName: 'test' },
      firebase: {},
    };

    const hostingManager = new HostingManager(
      vaultRepository,
      kmsService,
      tenantManager,
      new StorageMemAdapter(),
      logger,
      mockConfig,
      { hostCollectionName, hostDid: 'did:web:host.example.com' },
      new ClearingHouseService(),
    );
    await hostingManager.bootstrapHost(testClaimsHostInitialization);
    await tenantManager.loadHost();

    tenantVaultId = getTenantVaultId(
      String(testClaimsTenant1Registration[ClaimsServiceSchemaorg.category]),
      String(testClaimsTenant1Registration['org.schema.Organization.alternateName']),
    );
    await kmsService.provisionKeys(tenantVaultId);
    const tenantKeys = await kmsService.getPublicJwks(tenantVaultId);
    const tenantDid = 'did:web:api.acme.org';
    const tenantEncKey = tenantKeys.keys.find((key: any) => key.kty === 'OKP');
    const tenantSigKey = tenantKeys.keys.find((key: any) => key.kty === 'AKP');
    const tenantConfig = {
      id: tenantVaultId,
      type: EntityType.Organization,
      status: EntityLifecycleStatus.Active,
      claims: testClaimsTenant1Registration,
      didDocument: {
        '@context': 'https://www.w3.org/ns/did/v1',
        id: tenantDid,
        verificationMethod: [
          {
            id: `${tenantDid}#${tenantSigKey?.kid}`,
            type: 'JsonWebKey2020',
            controller: tenantDid,
            publicKeyJwk: tenantSigKey as any,
          },
          {
            id: `${tenantDid}#${tenantEncKey?.kid}`,
            type: 'JsonWebKey2020',
            controller: tenantDid,
            publicKeyJwk: tenantEncKey as any,
          },
        ],
        keyAgreement: [`${tenantDid}#${tenantEncKey?.kid}`],
      },
      didConfig: {
        service: [
          {
            id: `${tenantDid}#identity:openid`,
            type: 'GatewayService',
            serviceEndpoint: 'Device',
            actions: ['_dcr'],
          },
        ],
      },
      meta: { lastUpdated: new Date().toISOString() },
    };
    const secureTenantRegistrationDoc = await kmsService.protectConfidentialData({
      id: tenantVaultId,
      status: EntityLifecycleStatus.Active,
      sequence: 0,
      content: tenantConfig,
    } as ConfidentialStorageDoc, 'host');
    await vaultRepository.put(hostCollectionName, [secureTenantRegistrationDoc], getEnvSectionId('tenants'));
    await tenantManager.refreshTenant(tenantVaultId);

    const deviceRegistrationManager = new DeviceRegistrationManager(
      mockConfig.apiBaseUrl,
      vaultRepository,
      kmsService,
      tenantManager,
    );
    const worker = new Worker({
      hostingManager: { process: async () => { throw new Error('not used'); } } as any,
      deviceRegistrationManager,
      tenantManager,
    }, mockConfig.apiBaseUrl, kmsService);
    queueAdapter = new QueueAdapterMem(asyncResponseStore, worker);

    app = express();
    app.use(express.json({ type: ['application/json', 'application/didcomm-plain+json', 'application/fhir+json'] }));
    app.use(express.urlencoded({ extended: false }));
    verifyInitialAccessToken = jest.fn<AppAuthorizationManager['verifyInitialAccessToken']>();
    verifyInitialAccessToken.mockResolvedValue(INITIAL_ACCESS_TOKEN_VERIFIED_CLAIMS);
    app.use(createApiRouter(
      queueAdapter,
      tenantManager,
      kmsService,
      asyncResponseStore,
      vaultRepository,
      cryptographyService,
      mockConfig.apiBaseUrl,
      { verifyInitialAccessToken } as Pick<AppAuthorizationManager, 'verifyInitialAccessToken'> as AppAuthorizationManager,
    ));
    jest.clearAllMocks();
  });

  afterEach(() => {
    queueAdapter?.stop();
  });

  it('accepts only verified initial-access claims and a valid nested signature for encrypted Device/_dcr', async () => {
    const initialAccessToken = INITIAL_ACCESS_TOKEN_EXCHANGE_RESPONSE.body.initial_access_token;
    const verifySignature = jest.spyOn(cryptographyService, 'verifyDetachedJws').mockResolvedValue(true);
    jest.spyOn(kmsService, 'decodeRequest').mockResolvedValue({
      content: {
        ...DEVICE_REGISTRATION_REQUEST,
        meta: {
          jws: {
            protected: {
              alg: deviceJwkMldsa.alg,
              kid: deviceJwkMldsa.kid,
              jwk: deviceJwkMldsa,
            },
            signature: DEVICE_REGISTRATION_REQUEST.jti,
          },
          jwe: { header: { jwk: deviceJwkMlkem } },
        },
      },
    } as any);
    const addJob = jest.spyOn(queueAdapter, 'addJob').mockResolvedValue(undefined);
    const tenantSector = String(testClaimsTenant1Registration[ClaimsServiceSchemaorg.category]);
    const dcrUrl = `/${testTenant1AlternateName}/cds-es/v1/${tenantSector}/${DCR_REGISTRATION_JOB.section}/${DCR_REGISTRATION_JOB.format}/${DCR_REGISTRATION_JOB.resourceType}/${DCR_REGISTRATION_JOB.action}`;

    const response = await invokeExpress(app, {
      method: 'POST',
      url: dcrUrl,
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        authorization: `Bearer ${initialAccessToken}`,
      },
      body: { request: JSON.stringify(DEVICE_REGISTRATION_REQUEST) },
    });

    expect(response.status).toBe(202);
    expect(verifyInitialAccessToken).toHaveBeenCalledWith(initialAccessToken);
    expect(addJob.mock.calls[0]?.[1]).toEqual(expect.objectContaining({
      content: expect.objectContaining({
        meta: expect.objectContaining({
          bearer: expect.objectContaining({
            jwt: { header: {}, payload: INITIAL_ACCESS_TOKEN_VERIFIED_CLAIMS },
          }),
        }),
      }),
    }));

    addJob.mockClear();
    verifyInitialAccessToken.mockRejectedValueOnce(new Error(INITIAL_ACCESS_TOKEN_EXCHANGE_RESPONSE.jti));
    const rejectedToken = await invokeExpress(app, {
      method: 'POST',
      url: dcrUrl,
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        authorization: `Bearer ${initialAccessToken}`,
      },
      body: { request: JSON.stringify(DEVICE_REGISTRATION_REQUEST) },
    });
    expect(rejectedToken.status).toBe(401);
    expect(addJob).not.toHaveBeenCalled();

    verifyInitialAccessToken.mockResolvedValue(INITIAL_ACCESS_TOKEN_VERIFIED_CLAIMS);
    verifySignature.mockResolvedValueOnce(false);
    const rejectedSignature = await invokeExpress(app, {
      method: 'POST',
      url: dcrUrl,
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        authorization: `Bearer ${initialAccessToken}`,
      },
      body: { request: JSON.stringify(DEVICE_REGISTRATION_REQUEST) },
    });
    expect(rejectedSignature.status).toBe(401);
    expect(addJob).not.toHaveBeenCalled();
  });

  it('adds a second employee device through Device/_dcr and keeps the same license seat', async () => {
    const registerKeySpy = jest.spyOn(ManageAssetCryptographicKey.prototype, 'registerKey').mockResolvedValue({} as any);
    const keySubmitSpy = jest.spyOn(ManageAssetCryptographicKey.prototype, 'submit').mockResolvedValue({} as any);
    const bindingSpy = jest.spyOn(ManageAssetSubjectKeyBinding.prototype, 'upsertSubjectKeyBinding').mockResolvedValue({} as any);

    const employeeId = 'employee-1';
    const tenantCollectionName = await tenantManager.getCollectionName(tenantVaultId);
    if (!tenantCollectionName) throw new Error('expected physical tenant collection');
    const employeeDid = 'did:web:api.acme.org:employee:veterinarian';
    const stableActorIdentifier = normalizeSameAsHash('doctor1@acme.org');
    const employeeUrn = createEmployeeUrnFromStableActorIdentifier({
      organizationUrn: testTenant1IdentifierUrn,
      stableActorIdentifier,
      role: HealthcareActorRoles.Veterinarian,
    });
    const employeeConfig: EntityConfig = {
      id: employeeId,
      type: EntityType.Person,
      status: EntityLifecycleStatus.Active,
      claims: {
        [ClaimsPersonSchemaorg.email]: 'doctor1@acme.org',
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
            publicKeyJwk: { kty: 'AKP', alg: 'ML-DSA-44', kid: 'sig-old', use: 'sig', pub: 'sig-old-pub' } as any,
          },
          {
            id: `${employeeDid}#enc-old`,
            type: 'JsonWebKey',
            controller: employeeDid,
            publicKeyJwk: { kty: 'OKP', crv: 'ML-KEM-768', kid: 'enc-old', use: 'enc', x: 'enc-old-x' } as any,
          },
        ],
        authentication: [`${employeeDid}#sig-old`],
        keyAgreement: [`${employeeDid}#enc-old`],
        service: [],
      },
      didConfig: { service: [] },
      meta: { lastUpdated: '2026-06-01T00:00:00.000Z' },
    };
    const secureEmployeeDoc = await kmsService.protectConfidentialData({
      id: employeeId,
      status: employeeConfig.status,
      sequence: 0,
      content: employeeConfig,
    } as ConfidentialStorageDoc, tenantVaultId);
    await vaultRepository.put(tenantCollectionName, [secureEmployeeDoc], getEnvSectionId('employees'));

    const previousDeviceId = 'old-device-001';
    const securePreviousProfile = await kmsService.protectConfidentialData({
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
    } as ConfidentialStorageDoc, tenantVaultId);
    await vaultRepository.put(tenantVaultId, [securePreviousProfile], getEnvSectionId('device-profiles'));

    const activationCode = 'lic-device-replacement-001';
    const license: DeviceLicense = {
      id: 'license-1',
      tenantId: 'acme',
      orderId: 'order-1',
      activationCode,
      userClass: 'employee',
      type: 'mobile',
      status: 'issued',
      plan: 'default',
      renewalCycle: '12m',
      reactivationEnabled: false,
      exp: Math.floor(Date.now() / 1000) + 3600,
      subjectId: employeeId,
      // Replacement DCR must remain bound to the already activated employee
      // seat; the stable normalized-email hash is authority, not the device id.
      activatedBy: stableActorIdentifier,
      ownerOrganizationId: testTenant1IdValue,
      issuedToRole: HealthcareActorRoles.Veterinarian,
      deviceId: previousDeviceId,
    } as any;
    await vaultRepository.put(tenantVaultId, [{
      id: license.id,
      status: license.status,
      sequence: 0,
      content: license,
    } as ConfidentialStorageDoc], getEnvSectionId('device-licenses'));
    verifyInitialAccessToken.mockResolvedValue({
      ...INITIAL_ACCESS_TOKEN_VERIFIED_CLAIMS,
      act_code: activationCode,
    });

    const submit = await invokeExpress(app, {
      method: 'POST',
      url: '/acme-id/cds-es/v1/health-care/identity/openid/Device/_dcr',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer initial-access-token-001',
      },
      body: {
        thid: 'device-dcr-replacement-thid',
        iss: 'did:web:frontend.example.com',
        aud: 'did:web:api.acme.org',
        type: 'application/json',
        body: {
          code: activationCode,
          [IdentityDcrMetadataFields.ActorDid]: employeeDid,
          [IdentityDcrMetadataFields.ProfileDid]: employeeDid,
          application_type: 'native',
          redirect_uris: ['com.acme.app:/callback'],
          jwks: {
            keys: [
              { kty: 'AKP', alg: 'ML-DSA-44', kid: 'sig-new', use: 'sig', pub: 'sig-new-pub' },
              { kty: 'OKP', crv: 'ML-KEM-768', kid: 'enc-new', use: 'enc', x: 'enc-new-x' },
            ],
          },
          ext_device_info: {
            device_id: 'iphone-17',
            device_name: 'Dr Phone',
            os: 'iOS',
            os_version: '18.0',
          },
        },
      },
    });

    expect(submit.status).toBe(202);
    expect(submit.headers.location).toContain('/_dcr-response');

    await queueAdapter.waitForEmptyQueue();

    const pollPath = new URL(submit.headers.location, 'http://localhost').pathname;
    const poll = await invokeExpress(app, {
      method: 'POST',
      url: pollPath,
      headers: { 'content-type': 'application/json' },
      body: { thid: 'device-dcr-replacement-thid' },
    });

    expect(poll.status).toBe(200);
    const entry = JSON.parse(poll.text).data[0];
    const newClientId = String(entry.resource?.client_id || '');
    expect(entry.response.status).toBe('201');
    expect(newClientId).toBeTruthy();
    expect(newClientId).not.toBe(previousDeviceId);

    const updatedLicenseDoc = await vaultRepository.get<ConfidentialStorageDoc>(
      tenantVaultId,
      'license-1',
      getEnvSectionId('device-licenses'),
    );
    const updatedLicense = await readStoredContent<any>(updatedLicenseDoc);
    expect(updatedLicense.deviceId).toBe(previousDeviceId);
    expect(updatedLicense.status).toBe('active');
    expect(updatedLicense.deviceBindings).toEqual(expect.arrayContaining([
      expect.objectContaining({ clientId: previousDeviceId, status: 'active' }),
      expect.objectContaining({ clientId: newClientId, clientInstanceId: 'iphone-17', status: 'active' }),
    ]));

    const revokedProfileDoc = await vaultRepository.get<ConfidentialStorageDoc>(
      tenantVaultId,
      previousDeviceId,
      getEnvSectionId('device-profiles'),
    );
    expect(revokedProfileDoc?.status).toBe('active');

    const updatedEmployeeDoc = await vaultRepository.get<ConfidentialStorageDoc>(
      tenantCollectionName,
      employeeId,
      getEnvSectionId('employees'),
    );
    const updatedEmployee = await readStoredContent<EntityConfig>(updatedEmployeeDoc);
    expect(updatedEmployee.didDocument?.verificationMethod?.map((method) => method.id)).toEqual(
      expect.arrayContaining([`${employeeDid}#sig-new`, `${employeeDid}#enc-new`]),
    );
    expect(updatedEmployee.didDocument?.verificationMethod?.map((method) => method.id)).toEqual(
      expect.arrayContaining([`${employeeDid}#sig-old`, `${employeeDid}#enc-old`]),
    );

    expect(registerKeySpy).toHaveBeenCalledTimes(2);
    expect(keySubmitSpy).not.toHaveBeenCalledWith('Org1MSP', 'UpdateKeyStatus', expect.any(String), 'revoked', expect.any(String));
    expect(bindingSpy).toHaveBeenCalled();
  });

  it('completes individual-controller DCR through the route and persists its exact member binding', async () => {
    const activationCode = String((DCR_REGISTRATION_JOB.content?.body as any)?.code);
    verifyInitialAccessToken.mockResolvedValue({
      sub: testIndividualControllerDcrIdentity.authenticatedSubject,
      act_code: activationCode,
      scope: testIndividualControllerDcrIdentity.scope,
    } as any);
    const license = {
      id: 'individual-controller-license-1',
      tenantId: testTenant1AlternateName,
      orderId: 'individual-controller-order-1',
      activationCode,
      userClass: 'individual',
      type: 'mobile',
      status: 'issued',
      plan: 'default',
      renewalCycle: '12m',
      reactivationEnabled: false,
      exp: Math.floor(Date.now() / 1000) + 3600,
      ownerOrganizationId: EXAMPLE_PRIVATE_INDIVIDUAL_UUID,
      issuedToEmail: EXAMPLE_EMAIL_CONTROLLER_INDIVIDUAL,
      issuedToRole: testIndividualControllerDcrIdentity.role,
    } as DeviceLicense;
    await vaultRepository.put(tenantVaultId, [{
      id: license.id,
      status: license.status,
      sequence: 0,
      content: license,
    } as ConfidentialStorageDoc], getEnvSectionId('device-licenses'));

    const dcrRequest = {
      ...DEVICE_REGISTRATION_REQUEST,
      thid: 'individual-controller-dcr-route-thid',
      body: {
        ...DEVICE_REGISTRATION_REQUEST.body,
        code: activationCode,
        [IdentityDcrMetadataFields.ActorDid]: testIndividualControllerDcrIdentity.actorDid,
        [IdentityDcrMetadataFields.ProfileDid]: testIndividualControllerDcrIdentity.actorDid,
        [IdentityDcrMetadataFields.ClinicalCreatorBinding]: {
          kind: FhirIpsCreatorKinds.IndividualMember,
          actorIdentifier: `urn:uuid:${EXAMPLE_KYC_CONTROLLER_USER_UUID}`,
          authorIdentifier: `urn:uuid:${EXAMPLE_KYC_CONTROLLER_UUID}`,
          ownerIdentifier: `urn:uuid:${EXAMPLE_PRIVATE_INDIVIDUAL_UUID}`,
          role: testIndividualControllerDcrIdentity.role,
        },
      },
    };
    jest.spyOn(cryptographyService, 'verifyDetachedJws').mockResolvedValue(true);
    jest.spyOn(kmsService, 'decodeRequest').mockResolvedValue({ content: dcrRequest } as any);

    const submit = await invokeExpress(app, {
      method: HttpRequestMethods.Post,
      url: '/acme-id/cds-es/v1/health-care/identity/openid/Device/_dcr',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        authorization: 'Bearer individual-controller-initial-access-token',
      },
      body: { request: JSON.stringify(dcrRequest) },
    });
    expect(submit.status).toBe(202);
    await queueAdapter.waitForEmptyQueue();

    const poll = await invokeExpress(app, {
      method: HttpRequestMethods.Post,
      url: new URL(submit.headers.location, 'http://localhost').pathname,
      headers: { 'content-type': 'application/json' },
      body: { thid: 'individual-controller-dcr-route-thid' },
    });
    expect(poll.status).toBe(200);
    expect(poll.text).toMatch(/^response=.+/);

    const storedBinding = await vaultRepository.get<any>(
      tenantVaultId,
      `urn:uuid:${EXAMPLE_KYC_CONTROLLER_UUID}`,
      getClinicalCreatorBindingsSectionId(),
    );
    expect(storedBinding).toEqual(expect.objectContaining({
      actorDids: [testIndividualControllerDcrIdentity.actorDid],
    }));
  });

});
