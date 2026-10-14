// src/__tests__/managers/TokenManager.test.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

import { TokenManager } from '../../managers/TokenManager';
import { IKmsService } from '../../gdc-backend-utils-node/models/IKmsService';
import { TenantsCacheManager } from '../../managers/TenantsCacheManager';
import { DidDocument } from '../../gdc-backend-utils-node/models/did';
import { Content } from 'gdc-common-utils-ts/utils/content';

// --- Mocks ---

const mockKmsService: jest.Mocked<IKmsService> = {
  getPublicVerificationKey: jest.fn(),
  createCompactJws: jest.fn(),
  // Add other methods of IKmsService as jest.fn() to satisfy the interface
  init: jest.fn(), provisionKeys: jest.fn(), getPublicJwks: jest.fn(),
  getPublicEncryptionKey: jest.fn(), getHostPublicJwkSet: jest.fn(),
  decodeRequest: jest.fn(), signWithReconstructedKey: jest.fn(),
  createDetachedJws: jest.fn(),
  signWithManagedKey: jest.fn(), encodeResponse: jest.fn(), protectConfidentialData: jest.fn(),
  unprotectConfidentialData: jest.fn(), getHmacBase64Url: jest.fn(),
  protectAttributesNameAndValue: jest.fn(),
};

const mockTenantsCacheManager: jest.Mocked<TenantsCacheManager> = {
    getDidDocument: jest.fn(),
} as any;


// --- Tests ---

describe('TokenManager', () => {
  let manager: TokenManager;

  beforeEach(() => {
    jest.clearAllMocks();
    manager = new TokenManager(mockKmsService, mockTenantsCacheManager);
  });

  describe('createInitialAccessToken', () => {
    it('should construct and sign a JWT with the correct claims', async () => {
      // Arrange
      const mockHostDid = 'did:web:testhost.com';
      const mockHostDidDoc: DidDocument = { id: mockHostDid, verificationMethod: [] } as any;
      
      mockTenantsCacheManager.getDidDocument.mockResolvedValue(mockHostDidDoc);
      mockKmsService.getPublicVerificationKey.mockResolvedValue({ kid: 'host-key-1' } as any);
      mockKmsService.createCompactJws.mockImplementation(async (payload: any) => {
        const headerB64 = Content.stringToBase64Url(JSON.stringify({ alg: 'ML-DSA-44', kid: 'host-key-1' }));
        const payloadB64 = Content.stringToBase64Url(JSON.stringify(payload));
        const sigB64 = Content.stringToBase64Url('sig');
        return `${headerB64}.${payloadB64}.${sigB64}`;
      });

      const inputClaims = {
        sub: 'user-123',
        jti: 'tx-456',
        act_code: 'abc-123',
        tenant_id: 'acme',
      };
      const tokenLifetime = 60;

      // Act
      const token = await manager.createInitialAccessToken(inputClaims, tokenLifetime);

      // Assert
      expect(mockKmsService.createCompactJws).toHaveBeenCalledWith(expect.any(Object), 'host-key-1', 'host', 'comm_sig');
      expect(token).toContain('.'); // compact JWS

      // Decode the payload to verify its contents
      const payloadB64 = token.split('.')[1];
      const decodedPayload = JSON.parse(Content.bytesToStringUTF8(Content.base64ToBytes(payloadB64)));
      
      expect(decodedPayload.iss).toBe(mockHostDid);
      expect(decodedPayload.sub).toBe('user-123');
      expect(decodedPayload.aud).toBe('urn:gateway:dcr');
      expect(decodedPayload.scope).toBe('dcr:register');
      expect(decodedPayload.exp).toBeCloseTo(Math.floor(Date.now() / 1000) + tokenLifetime, -1);
    });

    it('should throw an error if host DID cannot be resolved', async () => {
      // Arrange
      mockTenantsCacheManager.getDidDocument.mockResolvedValue(undefined);

      // Act & Assert
      await expect(manager.createInitialAccessToken({}, 60))
        .rejects.toThrow('Could not resolve host DID. System not properly configured.');
    });
  });
});
