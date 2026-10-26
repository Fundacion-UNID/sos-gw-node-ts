// Flow contract: reuse shared test fixtures and canonical types; do not introduce duplicated literals.
// src/__tests__/managers/AuthorizationManager.test.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.
import { AppAuthorizationManager } from '../../managers/AppAuthorizationManager';
import { IVaultRepository } from '../../database/repositories/vault/vault.repository';
import { ITokenVerifier } from '../../auth/ITokenVerifier';
import { IKmsService } from '../../gdc-backend-utils-node/models/IKmsService';
import { ICryptography } from 'gdc-common-utils-ts/interfaces/ICryptography';
import { DeviceLicense } from 'gdc-common-utils-ts/models/device-license';
import { ConfidentialStorageDoc } from 'gdc-common-utils-ts/models/confidential-storage';
import { normalizeSameAsHash } from 'gdc-common-utils-ts/utils/same-as';
import { getTenantVaultId } from '../../utils/tenant';
import { getEnvSectionId } from '../../utils/section-env';
import { encodeHexToMultibase58btc } from 'gdc-common-utils-ts/utils/multibase58';
import {
  buildDeterministicIdTokenFixture,
  buildDeterministicSignedJwt,
  buildDeterministicVpTokenFixture,
  DeterministicJwtTokenVerifier,
} from '../utils/deterministic-jwt-fixtures';

// --- Mocks ---

const mockVaultRepository: jest.Mocked<IVaultRepository> = {
  get: jest.fn(),
  put: jest.fn(),
  // Other methods required by the interface
  createNewVault: jest.fn(), vaultExists: jest.fn(), getVaultConfig: jest.fn(),
  createNewSection: jest.fn(), updateSection: jest.fn(), getAllSections: jest.fn(),
  sectionExists: jest.fn(), getContainersListInSection: jest.fn(), listContainersInSection: jest.fn(), getContainersInSection: jest.fn(),
  getHistory: jest.fn(), query: jest.fn(), delete: jest.fn(), purge: jest.fn(),
};

const mockTokenVerifier: jest.Mocked<ITokenVerifier> = {
  verify: jest.fn(),
};

const mockKmsService: jest.Mocked<IKmsService> = {
    getPublicVerificationKey: jest.fn(),
    // Add other methods as needed, satisfying the interface
    init: jest.fn(), provisionKeys: jest.fn(), getPublicJwks: jest.fn(),
    getPublicEncryptionKey: jest.fn(), getHostPublicJwkSet: jest.fn(),
    decodeRequest: jest.fn(), signWithManagedKey: jest.fn(),
    signWithReconstructedKey: jest.fn(), encodeResponse: jest.fn(),
    createDetachedJws: jest.fn(),
    createCompactJws: jest.fn(),
    protectConfidentialData: jest.fn(), unprotectConfidentialData: jest.fn(),
    getHmacBase64Url: jest.fn(), protectAttributesNameAndValue: jest.fn(),
};

// A mock for the low-level crypto service, needed for signature verification
const mockCryptographyService: jest.Mocked<ICryptography> = {
    verifyJws: jest.fn(),
} as any;


// --- Tests ---

describe('AppAuthorizationManager', () => {
  let manager: AppAuthorizationManager;
  const now = Math.floor(Date.now() / 1000);

  beforeEach(() => {
    jest.clearAllMocks();
    mockKmsService.protectConfidentialData.mockImplementation(async (doc) => doc);
    manager = new AppAuthorizationManager(
        mockVaultRepository, 
        mockTokenVerifier, 
        mockKmsService, 
        mockCryptographyService
    );
  });

  describe('verifyIdToken', () => {
    it('should return a valid result for a correct id_token', async () => {
      // Arrange
      const mockPayload = { sub: 'user-123', email: 'test@example.com' };
      mockTokenVerifier.verify.mockResolvedValue({ valid: true, payload: mockPayload });

      // Act
      const result = await manager.verifyIdToken('valid.id.token');

      // Assert
      expect(result.valid).toBe(true);
      expect(result.payload).toEqual(mockPayload);
    });

    it('should throw a ManagerError for an invalid id_token', async () => {
        // Arrange
        mockTokenVerifier.verify.mockResolvedValue({ valid: false, error: 'Invalid signature' });
  
        // Act & Assert
        await expect(manager.verifyIdToken('invalid.id.token'))
            .rejects.toThrow('ID token is invalid: Invalid signature');
    });

    it('should validate one deterministically signed id_token through a local virtual BFF verifier', async () => {
      const fixture = await buildDeterministicIdTokenFixture({
        seed: 'gw-auth-manager-seed-001',
        issuer: 'did:web:bff.demo.example',
        audience: 'gw-demo-audience',
        subject: 'controller-sub-001',
        email: 'controller@example.org',
      });
      const verifier = new DeterministicJwtTokenVerifier({
        issuer: 'did:web:bff.demo.example',
        audience: 'gw-demo-audience',
        publicJwk: fixture.publicJwk,
      });
      manager = new AppAuthorizationManager(
        mockVaultRepository,
        verifier,
        mockKmsService,
        mockCryptographyService,
      );

      const result = await manager.verifyIdToken(fixture.compactToken);

      expect(result.valid).toBe(true);
      expect(result.payload).toMatchObject({
        email: 'controller@example.org',
        sub: 'controller-sub-001',
      });
    });
  });

  describe('verifyBearerToken', () => {
    it('accepts a tenant-signed SMART access token only when a data route opts in', async () => {
      const fixture = await buildDeterministicSignedJwt({
        seed: 'gw-tenant-smart-es384-seed-001',
        purpose: 'tenant-smart-access-token',
        alg: 'ES384',
        payload: {
          iss: 'did:web:beta-gw.vetchain.app:animal-care:tenant-001',
          sub: 'did:web:controller.example:member:abc',
          aud: 'did:web:beta-gw.vetchain.app:animal-care:tenant-001',
          scope: 'organization/Composition.cruds?subject=did:web:animal.example:individual:001&section=*',
          iat: now,
          nbf: now,
          exp: now + 300,
        },
      });
      mockTokenVerifier.verify.mockResolvedValue({ valid: false, error: 'not an id token' });
      mockKmsService.getPublicVerificationKey.mockResolvedValue(fixture.publicJwk as any);
      mockCryptographyService.verifyJws.mockRejectedValue(new Error('Unsupported ML-DSA algorithm: ES384'));

      const result = await (manager.verifyBearerToken as any)(
        fixture.compactToken,
        undefined,
        { vaultId: 'animal-care_tenant-001' },
        { acceptSmartAccessToken: true },
      );

      expect(result).toEqual({
        valid: true,
        payload: expect.objectContaining({
          iss: 'did:web:beta-gw.vetchain.app:animal-care:tenant-001',
          sub: 'did:web:controller.example:member:abc',
        }),
      });
      expect(mockKmsService.getPublicVerificationKey).toHaveBeenCalledWith(
        'animal-care_tenant-001',
        'ES384',
        'comm_sig',
      );
      expect(mockCryptographyService.verifyJws).not.toHaveBeenCalled();
    });

    it('should fall back to one signed controller proof bearer when id_token verification fails', async () => {
      const fixture = await buildDeterministicVpTokenFixture({
        seed: 'gw-controller-proof-bearer-seed-001',
        issuerDid: 'did:web:controller.demo.example',
        audience: 'did:web:gw.demo.example#tenant_lifecycle',
        credentials: [
          {
            credential: {
              '@context': ['https://www.w3.org/2018/credentials/v1'],
              type: ['VerifiableCredential', 'LegalParticipantCredential'],
              issuer: 'did:web:ica.demo.example',
              issuanceDate: '2040-01-01T00:00:00.000Z',
              credentialSubject: {
                id: 'did:web:controller.demo.example',
              },
            },
          },
        ],
      });

      mockTokenVerifier.verify.mockResolvedValue({ valid: false, error: 'not an id token' });

      const result = await manager.verifyBearerToken(fixture.compactToken);

      expect(result.valid).toBe(true);
      expect(result.payload).toMatchObject({
        iss: 'did:web:controller.demo.example',
      });
      expect((result.payload as any).vp).toBeDefined();
    });
    it('keeps projected public JWK verification only outside tenant DCR scope', async () => {
      const fixture = await buildDeterministicVpTokenFixture({
        seed: 'gw-controller-proof-request-meta-seed-001',
        issuerDid: 'did:web:controller.demo.example',
        audience: 'did:web:gw.demo.example',
        includePublicJwkInHeader: false,
        credentials: [{ credential: {
          '@context': ['https://www.w3.org/2018/credentials/v1'],
          type: ['VerifiableCredential', 'LegalParticipantCredential'],
          issuer: 'did:web:ica.demo.example',
          issuanceDate: '2040-01-01T00:00:00.000Z',
          credentialSubject: { id: 'did:web:controller.demo.example' },
        } }],
      });
      mockTokenVerifier.verify.mockResolvedValue({ valid: false, error: 'not an id token' });

      const result = await manager.verifyBearerToken(fixture.compactToken, fixture.publicJwk);

      expect(result.valid).toBe(true);
      expect(result.payload).toMatchObject({ iss: 'did:web:controller.demo.example' });
    });

    it('verifies a post-DCR controller proof with the registered key', async () => {
      const fixture = await buildDeterministicVpTokenFixture({
        seed: 'gw-controller-proof-registered-seed-001',
        issuerDid: 'did:web:controller.registered.example',
        audience: 'did:web:gw.demo.example',
        includePublicJwkInHeader: false,
        credentials: [{ credential: {
          '@context': ['https://www.w3.org/2018/credentials/v1'],
          type: ['VerifiableCredential', 'LegalParticipantCredential'],
          issuer: 'did:web:ica.demo.example',
          issuanceDate: '2040-01-01T00:00:00.000Z',
          credentialSubject: { id: 'did:web:controller.registered.example' },
        } }],
      });
      mockTokenVerifier.verify.mockResolvedValue({ valid: false, error: 'not an id token' });
      mockKmsService.getHmacBase64Url
        .mockResolvedValueOnce('protected-kid-name')
        .mockResolvedValueOnce('protected-kid-value');
      mockVaultRepository.query.mockResolvedValue([{ id: 'controller-record' }] as any);
      mockKmsService.unprotectConfidentialData.mockResolvedValue({
        didDocument: {
          id: 'did:web:controller.registered.example',
          verificationMethod: [{
            id: `did:web:controller.registered.example#${fixture.publicJwk.kid}`,
            type: 'JsonWebKey2020',
            controller: 'did:web:controller.registered.example',
            publicKeyJwk: fixture.publicJwk,
          }],
        },
      } as any);

      const result = await manager.verifyBearerToken(
        fixture.compactToken,
        undefined,
        { vaultId: 'onehealth-research_registered', collectionName: 'registered_collection' },
      );

      expect(result.valid).toBe(true);
      expect(mockVaultRepository.query).toHaveBeenCalledWith('registered_collection', {
        sectionId: getEnvSectionId('employees'),
        where: [{ name: 'protected-kid-name', value: 'protected-kid-value' }],
      });
    });

    it('verifies the stored legacy _activate bootstrap key when the proof issuer is its DID alias', async () => {
      const portalControllerDid = 'did:web:controller-portal.unid.example';
      const operationalControllerDid = 'did:web:sos-gw.unid.online:controller:bootstrap';
      const fixture = await buildDeterministicVpTokenFixture({
        seed: 'sos-controller-proof-legacy-activate-alias-seed-001',
        issuerDid: portalControllerDid,
        audience: 'did:web:sos-gw.unid.online',
        includePublicJwkInHeader: false,
        credentials: [{ credential: {
          '@context': ['https://www.w3.org/2018/credentials/v1'],
          type: ['VerifiableCredential', 'LegalRepresentativeCredential'],
          issuer: 'did:web:ica.demo.example',
          issuanceDate: '2040-01-01T00:00:00.000Z',
          credentialSubject: { id: portalControllerDid },
        } }],
      });
      mockTokenVerifier.verify.mockResolvedValue({ valid: false, error: 'not an id token' });
      mockKmsService.getHmacBase64Url
        .mockResolvedValueOnce('protected-kid-name')
        .mockResolvedValueOnce('protected-kid-value');
      mockVaultRepository.query.mockResolvedValue([]);
      mockVaultRepository.getContainersInSection.mockResolvedValue([{
        id: operationalControllerDid,
        public: { role: 'host-bootstrap-controller' },
      }] as any);
      mockKmsService.unprotectConfidentialData.mockResolvedValue({
        didDocument: {
          id: operationalControllerDid,
          alsoKnownAs: [portalControllerDid],
          verificationMethod: [{
            id: `${operationalControllerDid}#${fixture.publicJwk.kid}`,
            type: 'JsonWebKey2020',
            controller: operationalControllerDid,
            publicKeyJwk: fixture.publicJwk,
          }],
        },
      } as any);

      process.env.HOST_LEGACY_REPRESENTATIVE_CONTROLLER = 'true';
      try {
        const result = await manager.verifyBearerToken(
          fixture.compactToken,
          undefined,
          { vaultId: 'onehealth-research_VATES-B42215152', collectionName: 'registered_collection' },
        );
        expect(result.valid).toBe(true);
      } finally {
        delete process.env.HOST_LEGACY_REPRESENTATIVE_CONTROLLER;
      }
    });

    it('rejects a tenant-scoped proof when its kid is not registered by DCR', async () => {
      const fixture = await buildDeterministicVpTokenFixture({
        seed: 'gw-controller-proof-unregistered-seed-001',
        issuerDid: 'did:web:controller.unregistered.example',
        audience: 'did:web:gw.demo.example',
        credentials: [{ credential: {
          '@context': ['https://www.w3.org/2018/credentials/v1'],
          type: ['VerifiableCredential', 'LegalParticipantCredential'],
          issuer: 'did:web:ica.demo.example',
          issuanceDate: '2040-01-01T00:00:00.000Z',
          credentialSubject: { id: 'did:web:controller.unregistered.example' },
        } }],
      });
      mockTokenVerifier.verify.mockResolvedValue({ valid: false, error: 'not an id token' });
      mockKmsService.getHmacBase64Url
        .mockResolvedValueOnce('protected-kid-name')
        .mockResolvedValueOnce('protected-kid-value');
      mockVaultRepository.query.mockResolvedValue([]);

      await expect(manager.verifyBearerToken(
        fixture.compactToken,
        fixture.publicJwk,
        { vaultId: 'onehealth-research_registered', collectionName: 'registered_collection' },
      )).rejects.toThrow('kid is not registered for this tenant');
    });
  });
  
  describe('verifyAndConsumeActivationCode', () => {
    it('should return a valid license and mark it as active', async () => {
        // Arrange
        const activationCode = 'valid-code';
        const tenantId = 'acme';
        const vaultId = getTenantVaultId('health-care', tenantId);
        const mockLicense: DeviceLicense = {
          id: 'license-1', tenantId: tenantId, status: 'issued', plan: 'annual',
          orderId: 'order-123', userClass: 'employee', type: 'mobile',
          renewalCycle: '12m', reactivationEnabled: true, exp: now + 3600,
          activationCode, issuedToEmail: 'person@example.org',
        };
        const mockDoc: ConfidentialStorageDoc = { id: activationCode, status: mockLicense.status, sequence: 0, content: mockLicense };
        mockKmsService.getHmacBase64Url.mockResolvedValueOnce('hmac-name').mockResolvedValueOnce('hmac-value');
        mockVaultRepository.query.mockResolvedValue([mockDoc]);
  
        // Act
        const result = await manager.verifyAndConsumeActivationCode(
          activationCode, tenantId, 'health-care',
          { subject: 'portal-sub', email: 'person@example.org', emailVerified: true },
        );
  
        // Assert
        expect(result.valid).toBe(true);
        if (result.valid) {
            expect(result.license.activationCode).toBe(activationCode);
        }
        expect(mockVaultRepository.query).toHaveBeenCalledWith(
          vaultId,
          expect.objectContaining({ sectionId: getEnvSectionId('device-licenses') }),
        );
        
        // Verify it updated the license status to 'active'
        const [updatedVaultId, updatedDocs] = (mockVaultRepository.put as jest.Mock).mock.calls[0];
        expect(updatedVaultId).toBe(vaultId);
        expect(updatedDocs[0].content.status).toBe('active');
        expect(updatedDocs[0].sequence).toBe(1);
      });

      it('should throw an error if activation code is not found', async () => {
        // Arrange
        mockKmsService.getHmacBase64Url.mockResolvedValueOnce('hmac-name').mockResolvedValueOnce('hmac-value');
        mockVaultRepository.query.mockResolvedValue([]);
        mockVaultRepository.getContainersInSection.mockResolvedValue([]);
  
        // Act & Assert
        await expect(manager.verifyAndConsumeActivationCode('not-found', 'acme', 'health-care'))
            .rejects.toThrow('Activation code not found or invalid.');
      });

      it('should reuse an active seat for a second installation of the same authenticated user', async () => {
        // Arrange
        const mockLicense = {
          id: 'license-2', tenantId: 'acme', status: 'active', plan: 'annual',
          orderId: 'order-456', userClass: 'employee', type: 'web',
          renewalCycle: null, reactivationEnabled: false, exp: now + 3600,
          activationCode: 'used-code',
          issuedToEmail: 'professional@example.org',
          activatedBy: normalizeSameAsHash('professional@example.org'),
          maxDevices: 5,
          deviceBindings: [{
            clientId: 'client-one', clientInstanceId: 'install-one', status: 'active',
            deviceInfo: { clientInstanceId: 'install-one' }, activatedAt: now,
          }],
        } as DeviceLicense & Record<string, any>;
        mockKmsService.getHmacBase64Url.mockResolvedValueOnce('hmac-name').mockResolvedValueOnce('hmac-value');
        mockVaultRepository.query.mockResolvedValue([{ id: 'used-code', content: mockLicense, sequence: 0 }]);

        await expect(manager.verifyAndConsumeActivationCode(
          'used-code', 'acme', 'health-care',
          { subject: 'portal-a-sub', email: 'professional@example.org', emailVerified: true }, 'install-two',
        )).resolves.toMatchObject({ valid: true });
        await expect(manager.verifyAndConsumeActivationCode(
          'used-code', 'acme', 'health-care',
          { subject: 'portal-b-sub', email: 'other@example.org', emailVerified: true }, 'install-two',
        )).rejects.toThrow('does not match the licensed email');
      });

      it('should decrypt an active seat before authorizing a second installation', async () => {
        const activationCode = 'encrypted-active-code';
        const tenantId = 'acme';
        const sector = 'health-care';
        const vaultId = getTenantVaultId(sector, tenantId);
        const activeLicense = {
          id: 'encrypted-license', tenantId, status: 'active', plan: 'annual',
          orderId: 'encrypted-order', userClass: 'employee', type: 'web',
          renewalCycle: null, reactivationEnabled: false, exp: now + 3600,
          activationCode, issuedToEmail: 'professional@example.org',
          activatedBy: normalizeSameAsHash('professional@example.org'),
          maxDevices: 5,
          deviceBindings: [{
            clientId: 'client-one', clientInstanceId: 'install-one', status: 'active',
            deviceInfo: { clientInstanceId: 'install-one' }, activatedAt: now,
          }],
        } as DeviceLicense & Record<string, any>;
        const protectedDoc = {
          id: activeLicense.id,
          status: activeLicense.status,
          sequence: 1,
          jwe: { protected: 'header', ciphertext: 'ciphertext', iv: 'iv', tag: 'tag' },
        } as ConfidentialStorageDoc;
        mockKmsService.getHmacBase64Url.mockResolvedValueOnce('hmac-name').mockResolvedValueOnce('hmac-value');
        mockKmsService.unprotectConfidentialData.mockResolvedValue(activeLicense);
        mockVaultRepository.query.mockResolvedValue([protectedDoc]);

        await expect(manager.verifyAndConsumeActivationCode(
          activationCode,
          tenantId,
          sector,
          { subject: 'portal-sub', email: 'professional@example.org', emailVerified: true },
          'install-two',
        )).resolves.toMatchObject({ valid: true, license: activeLicense });
        expect(mockKmsService.unprotectConfidentialData).toHaveBeenCalledWith(protectedDoc, vaultId);
      });

      it('should bind a legacy active seat to its first authenticated reuse', async () => {
        const mockLicense = {
          id: 'legacy-license', tenantId: 'acme', status: 'active', plan: 'annual',
          orderId: 'legacy-order', userClass: 'employee', type: 'web',
          renewalCycle: null, reactivationEnabled: false, exp: now + 3600,
          activationCode: 'legacy-code', issuedToEmail: 'professional@example.org',
          activatedBy: 'legacy-firebase-subject',
        } as DeviceLicense & Record<string, any>;
        mockKmsService.getHmacBase64Url.mockResolvedValueOnce('hmac-name').mockResolvedValueOnce('hmac-value');
        mockVaultRepository.query.mockResolvedValue([{ id: 'legacy-code', content: mockLicense, sequence: 0 }]);

        await manager.verifyAndConsumeActivationCode(
          'legacy-code', 'acme', 'health-care',
          { subject: 'new-portal-subject', email: 'professional@example.org', emailVerified: true }, 'install-one',
        );

        expect(mockLicense).toMatchObject({
          activatedBy: normalizeSameAsHash('professional@example.org'),
          maxDevices: 5,
        });
        expect(mockVaultRepository.put).toHaveBeenCalled();
      });
  });

  describe('resolveEmployeeActivationCode', () => {
    it('resolves one active employee licence by sector-routed portable URN and verified email', async () => {
      const employeeUuid = '00112233-4455-6677-8899-aabbccddeeff';
      const employeeMemberId = encodeHexToMultibase58btc(employeeUuid);
      const employeeRoleCode = '2250';
      const organizationOfficialId = 'Example-123';
      const professionalEmail = 'veterinarian.doe@example.org';
      const activationCode = 'existing-professional-activation';
      const portableEmployeeUrn = `urn:cds-ca-bc:v1:organization:bn:${organizationOfficialId}:member:${employeeMemberId}:${employeeRoleCode}`;
      const license = {
        id: 'employee-license', tenantId: 'animal-provider', status: 'active', plan: 'annual',
        orderId: 'employee-order', userClass: 'employee', type: 'web', renewalCycle: null,
        reactivationEnabled: false, exp: now + 3600, activationCode,
        ownerOrganizationId: organizationOfficialId, subjectId: employeeUuid,
        issuedToEmail: professionalEmail, issuedToRole: `ISCO-08|${employeeRoleCode}`,
      } as DeviceLicense & Record<string, any>;
      mockVaultRepository.getContainersInSection.mockResolvedValue([{ id: license.id, content: license }] as any);

      await expect(manager.resolveEmployeeActivationCode(
        portableEmployeeUrn,
        'animal-provider',
        'ca-bc',
        'animal-care',
        { subject: 'firebase-professional', email: professionalEmail, emailVerified: true },
      )).resolves.toBe(activationCode);

      expect(mockVaultRepository.getContainersInSection).toHaveBeenCalledWith(
        getTenantVaultId('animal-care', 'animal-provider'),
        getEnvSectionId('device-licenses'),
      );
    });

    it('does not resolve a licence when the neutral organization, employee, role or verified contact differs', async () => {
      const employeeUuid = '00112233-4455-6677-8899-aabbccddeeff';
      const portableEmployeeUrn = `urn:cds-ca-bc:v1:organization:bn:Different-Organization:member:${encodeHexToMultibase58btc(employeeUuid)}:2250`;
      const license = {
        id: 'employee-license', tenantId: 'animal-provider', status: 'active', plan: 'annual',
        orderId: 'employee-order', userClass: 'employee', type: 'web', renewalCycle: null,
        reactivationEnabled: false, exp: now + 3600, activationCode: 'must-not-leak',
        ownerOrganizationId: 'Canonical-Organization', subjectId: employeeUuid,
        issuedToEmail: 'veterinarian.doe@example.org', issuedToRole: 'ISCO-08|2250',
      } as DeviceLicense & Record<string, any>;
      mockVaultRepository.getContainersInSection.mockResolvedValue([{ id: license.id, content: license }] as any);

      await expect(manager.resolveEmployeeActivationCode(
        portableEmployeeUrn,
        'animal-provider',
        'ca-bc',
        'animal-care',
        { subject: 'firebase-professional', email: 'veterinarian.doe@example.org', emailVerified: true },
      )).rejects.toThrow('Professional licence not found');
    });

    it('rejects a neutral employee URN whose jurisdiction differs from the routed provider index', async () => {
      const employeeUuid = '00112233-4455-6677-8899-aabbccddeeff';
      const portableEmployeeUrn = `urn:cds-es:v1:organization:bn:Example-123:member:${encodeHexToMultibase58btc(employeeUuid)}:2250`;

      await expect(manager.resolveEmployeeActivationCode(
        portableEmployeeUrn,
        'animal-provider',
        'ca-bc',
        'animal-care',
        { subject: 'firebase-professional', email: 'veterinarian.doe@example.org', emailVerified: true },
      )).rejects.toThrow('Professional licence not found');
      expect(mockVaultRepository.getContainersInSection).not.toHaveBeenCalled();
    });
  });

  // Future tests for `verifyInitialAccessToken` will be added here
});
