// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.
// File: src/__tests__/unit/managers/CredentialManager.test.ts

import { jest } from '@jest/globals';
import type { IVaultRepository } from '../../../database/repositories/vault/vault.repository';
import type { IKmsService } from '../../../gdc-backend-utils-node/models/IKmsService';
import { testClaimsTenant1Registration } from '../../data/end-to-end.data';
import { TenantsCacheManager } from '../../../managers/TenantsCacheManager';
import { VaultMemRepository } from '../../../database/repositories/vault/vault.mem.repository';
import { IServerConfig } from '../../../config';
import { testClaimsTenant1Receptionist1, testTenant1Receptionist1Email, testTenant1Receptionist1Urn } from '../../data/employee.data';
import { MldsaPublicJwk } from 'gdc-common-utils-ts/interfaces/Cryptography.types';
import { ProofEBSIv2, VerifiableCredentialV2 } from '../../../gdc-backend-utils-node/models/verifiable-credential';
import { JwsMultiSign } from 'gdc-common-utils-ts/models/jws';
import { testHostDidWeb, testHostDomain, testTenant1IdentifierUrn, testTenant1VaultId } from '../../data/organization.data';
import { ClaimsPersonSchemaorg } from 'gdc-common-utils-ts/constants/schemaorg';
import { ConfidentialStorageDoc } from 'gdc-common-utils-ts/models/confidential-storage';

const uuidMock = {
  v4: jest.fn(),
  validate: jest.fn(),
};

jest.unstable_mockModule('uuid', () => uuidMock);

const { v4: uuidv4 } = await import('uuid');
const { CredentialManager } = await import('../../../managers/CredentialManager');

const mockSignResult: JwsMultiSign = {
  payload: 'base64payload',
  signatures: [{ protected: 'base64protectedHeader', signature: 'base64signature' }],
};

const mockHostPublicKey: MldsaPublicJwk = {
  kid: 'host-key-1', kty: 'AKP', alg: 'ML-DSA-44', pub: '...',
};

const mockTenantPublicKey: MldsaPublicJwk = {
  kid: 'tenant-key-1', kty: 'AKP', alg: 'ML-DSA-44', pub: '...',
};

// Create a mock KMS service for testing, mirroring the pattern in other manager tests.
const mockKmsService: jest.Mocked<IKmsService> = {
  init: jest.fn<IKmsService['init']>(),
  provisionKeys: jest.fn<IKmsService['provisionKeys']>(),
  getPublicJwks: jest.fn<IKmsService['getPublicJwks']>(),
  decodeRequest: jest.fn<IKmsService['decodeRequest']>(),
  signWithManagedKey: jest.fn<IKmsService['signWithManagedKey']>().mockResolvedValue(mockSignResult),
  signWithReconstructedKey: jest.fn<IKmsService['signWithReconstructedKey']>(),
  createDetachedJws: jest.fn<IKmsService['createDetachedJws']>(),
  createCompactJws: jest.fn<IKmsService['createCompactJws']>(),
  encodeResponse: jest.fn<IKmsService['encodeResponse']>(),
  protectConfidentialData: jest.fn<IKmsService['protectConfidentialData']>(async (doc) => ({ ...doc, sequence: 0, jwe: {} })),
  unprotectConfidentialData: jest.fn(async (doc: ConfidentialStorageDoc, entityId: string) =>
    Promise.resolve(doc.content as any),
  ),
  getHostPublicJwkSet: jest.fn<IKmsService['getHostPublicJwkSet']>(),
  getPublicVerificationKey: jest.fn<IKmsService['getPublicVerificationKey']>().mockImplementation(async (entityId: string) => {
    if (entityId === 'host' || entityId.startsWith('did:web:')) {
      return mockHostPublicKey;
    }
    return mockTenantPublicKey;
  }),
  getPublicEncryptionKey: jest.fn<IKmsService['getPublicEncryptionKey']>(),
  getHmacBase64Url: jest.fn<IKmsService['getHmacBase64Url']>(),
  protectAttributesNameAndValue: jest.fn<IKmsService['protectAttributesNameAndValue']>(),
};

describe('CredentialManager', () => {
  let credentialManager: InstanceType<typeof CredentialManager>;
  let vaultRepository: IVaultRepository;
  let mockTenantsCacheManager: jest.Mocked<TenantsCacheManager>;
  let mockConfig: IServerConfig;

  const TENANT_ID = 'acme';
  const HOST_DID = 'did:web:test-host.com';

  beforeEach(() => {
    jest.clearAllMocks();
    (uuidv4 as jest.Mock).mockReturnValue('mocked-credential-uuid');

    vaultRepository = new VaultMemRepository();
    mockTenantsCacheManager = new TenantsCacheManager(vaultRepository, () => mockKmsService, 'test-host-collection') as jest.Mocked<TenantsCacheManager>;

    mockConfig = { hostExternalDomain: 'test-host.com' } as IServerConfig;

    credentialManager = new CredentialManager(
      vaultRepository,
      mockKmsService,
      mockTenantsCacheManager,
      testHostDomain,
    );
  });

  describe('issueOrganizationSelfDescription', () => {
    it('should issue a valid VC signed by the HOST', async () => {
      // --- ARRANGE ---
      const evidence = { type: 'DigitalSignature', verifier: HOST_DID };

      // --- ACT ---
      const vc = await credentialManager.issueOrganizationSelfDescription(
        testTenant1IdentifierUrn,
        testClaimsTenant1Registration,
        evidence,
      );

      // --- ASSERT ---
      expect(vc.issuer).toBe(testHostDidWeb);
      const subject = vc.credentialSubject as any;
      expect(subject.identifier).toBe(testTenant1IdentifierUrn);
      expect(subject['org.schema.Organization.legalName']).toBe(testClaimsTenant1Registration['org.schema.Organization.legalName']);
      expect(vc.evidence?.[0]).toEqual(evidence);

      expect(vc.proof).toBeDefined();
      expect((vc.proof as Array<ProofEBSIv2>)[0].verificationMethod).toBe(`${testHostDidWeb}#${mockHostPublicKey.kid}`);
      expect(mockKmsService.signWithManagedKey).toHaveBeenCalledWith(expect.any(Uint8Array), 'host', undefined, 'vc_sign');
    });
  });

  describe('issueEmployeeCredential', () => {
    it('should issue a valid VC signed by the TENANT', async () => {
      // --- ARRANGE ---
      const jobContext = { tenantId: TENANT_ID, tenantVaultId: testTenant1VaultId };
      const evidence = { type: 'InternalHRProcess', verifier: testTenant1IdentifierUrn };

      jest.spyOn(mockTenantsCacheManager, 'getTenantIdentifierUrn').mockResolvedValue(testTenant1IdentifierUrn);

      // --- ACT ---
      const vc = await credentialManager.issueEmployeeCredential(
        jobContext,
        testTenant1Receptionist1Urn,
        testClaimsTenant1Receptionist1,
        evidence,
      );

      // --- ASSERT ---
      expect(vc.issuer).toBe(testTenant1IdentifierUrn); // Issued by the Tenant
      const subject = vc.credentialSubject as any;
      expect(subject.identifier).toBe(testTenant1Receptionist1Urn);
      expect(subject[ClaimsPersonSchemaorg.email]).toBe(testTenant1Receptionist1Email);
      expect(vc.evidence?.[0]).toEqual(evidence);
      
      expect(vc.proof).toBeDefined();
      expect((vc.proof as Array<ProofEBSIv2>)[0].verificationMethod).toBe(`${testTenant1IdentifierUrn}#${mockTenantPublicKey.kid}`);
      expect(mockKmsService.signWithManagedKey).toHaveBeenCalledWith(expect.any(Uint8Array), jobContext.tenantVaultId, undefined, 'vc_sign');
    });

    it('should throw an error if the tenant URN cannot be resolved', async () => {
      // --- ARRANGE ---
      jest.spyOn(mockTenantsCacheManager, 'getTenantIdentifierUrn').mockResolvedValue(undefined);
      const jobContext = { tenantId: 'unknown-tenant', tenantVaultId: 'unknown-vault' };

      // --- ACT & ASSERT ---
      await expect(
        credentialManager.issueEmployeeCredential(jobContext, 'some-urn', {}, {})
      ).rejects.toThrow(`Could not resolve URN for tenant 'unknown-tenant'.`);
    });
  });

  describe('storeCredential', () => {
    it('should call KMS to protect indexes and content before storing', async () => {
      // --- ARRANGE ---
      const vc = { id: 'urn:uuid:vc-id-12T3' } as VerifiableCredentialV2;
      const collectionId = 'credentials';
      const decryptionEntityId = 'some-entity';
      const putSpy = jest.spyOn(vaultRepository, 'put');

      await vaultRepository.createNewVault({ id: testTenant1VaultId });
      
      // Simulate the KMS returning HMACed attributes
      mockKmsService.protectAttributesNameAndValue.mockResolvedValue([
        { name: 'identifier', value: 'hmac-protected-value', unique: true },
      ]);

      // --- ACT ---
      await credentialManager.storeCredential(vc, testTenant1VaultId, collectionId, testTenant1Receptionist1Urn, decryptionEntityId);

      // --- ASSERT ---
      // Verify HMAC protection was called for the index
      expect(mockKmsService.protectAttributesNameAndValue).toHaveBeenCalledWith(
        [{ name: 'identifier', value: testTenant1Receptionist1Urn, unique: true, type: 'uri' }],
        testTenant1VaultId
      );

      // Verify the document content was encrypted
      const docToProtect = mockKmsService.protectConfidentialData.mock.calls[0][0];
      expect(docToProtect.content).toEqual(vc);
      expect(docToProtect.indexed?.attributes[0].value).toBe('hmac-protected-value'); // Check that the HMACed value is used
      
      // Verify the final protected document was put in the vault
      expect(putSpy).toHaveBeenCalledWith(
        testTenant1VaultId,
        [expect.objectContaining({ jwe: {} })],
        collectionId
      );
    });
  });

  describe('searchCredential', () => {
    it('should find by attribute, unprotect, and return the credential', async () => {
      // --- ARRANGE ---
      const collectionId = 'credentials';
      const decryptionEntityId = TENANT_ID;
      const vc: VerifiableCredentialV2 = { id: 'urn:uuid:vc-id-12T3', issuer: 'test' } as any;

      const encryptedDoc: ConfidentialStorageDoc = {
        id: vc.id as string,
        status: 'active',
        sequence: 0,
        jwe: { ciphertext: 'encrypted-vc' },
        indexed: { attributes: [{ name: 'identifier', value: 'protected-urn', unique: true }] },
      };

      // Mock the repository and KMS responses
      const querySpy = jest.spyOn(vaultRepository, 'query').mockResolvedValue([encryptedDoc]);
      mockKmsService.unprotectConfidentialData.mockResolvedValue(vc);

      // --- ACT ---
      const result = await credentialManager.searchCredential(
        testTenant1VaultId,
        testTenant1Receptionist1Urn,
        collectionId,
        decryptionEntityId,
      );

      // --- ASSERT ---
      const expectedQuery = {
        sectionId: collectionId,
        where: [{ attribute: 'identifier', equals: testTenant1Receptionist1Urn }],
      };
      expect(querySpy).toHaveBeenCalledWith(testTenant1VaultId, expectedQuery);
      
      expect(mockKmsService.unprotectConfidentialData).toHaveBeenCalledWith(encryptedDoc, decryptionEntityId);
      expect(result).toEqual(vc);
    });

    it('should return null if no credential is found', async () => {
      // --- ARRANGE ---
      jest.spyOn(vaultRepository, 'query').mockResolvedValue([]);

      // --- ACT ---
      const result = await credentialManager.searchCredential('v', 'u', 'c', 'd');

      // --- ASSERT ---
      expect(result).toBeNull();
    });
  });
});
