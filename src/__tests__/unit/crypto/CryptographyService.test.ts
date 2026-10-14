// src/__tests__/unit/crypto/CryptographyService.test.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

import { jest } from '@jest/globals';
import type { MlkemPrivateJwk, MlkemPublicJwk, MldsaPublicJwk } from 'gdc-common-utils-ts/interfaces/Cryptography.types';
import { Content } from 'gdc-common-utils-ts/utils/content';
import { randomBytes } from 'crypto';
import type { JweObject, RecipientDataJWE } from 'gdc-common-utils-ts/models/jwe';
import type { ProtectedDataAES } from 'gdc-common-utils-ts/models/aes';

const mlKemMock = {
  ml_kem768: {
    encapsulate: jest.fn(),
    decapsulate: jest.fn(),
    keygen: jest.fn(),
  },
};

const mlDsaMock = {
  // Make sure to mock all levels you might test against
  ml_dsa44: {
    sign: jest.fn(),
    verify: jest.fn(),
    keygen: jest.fn(),
  },
  ml_dsa65: {
    sign: jest.fn(),
    verify: jest.fn(),
    keygen: jest.fn(),
  },
  ml_dsa87: {
    sign: jest.fn(),
    verify: jest.fn(),
    keygen: jest.fn(),
  },
};

jest.unstable_mockModule('@noble/post-quantum/ml-kem.js', () => mlKemMock);
jest.unstable_mockModule('@noble/post-quantum/ml-dsa.js', () => mlDsaMock);

const { ml_kem768 } = await import('@noble/post-quantum/ml-kem.js');
const mlDsa = await import('@noble/post-quantum/ml-dsa.js');
const { CryptographyService } = await import('gdc-common-utils-ts/CryptographyService');
const { AdapterCryptoSdkNode } = await import('../../../gdc-backend-utils-node/adapters/node/crypto');
const { AesManager } = await import('gdc-common-utils-ts');

const mockMlKem768 = ml_kem768 as jest.Mocked<typeof ml_kem768>;
// Point the primary mock to the dsa44 variant, as it's our default
const mockMlDsa = mlDsa.ml_dsa44 as jest.Mocked<typeof mlDsa.ml_dsa44>;

describe('CryptographyService', () => {
  let cryptoService: InstanceType<typeof CryptographyService>;

  beforeEach(() => {
    jest.clearAllMocks();
    cryptoService = new CryptographyService(new AdapterCryptoSdkNode());
    jest.spyOn(cryptoService as any, 'loadMlKem').mockResolvedValue(mlKemMock);
    jest.spyOn(cryptoService as any, 'loadMlDsa').mockResolvedValue(mlDsaMock);
  });

  // --- Formatting & Parsing Utilities ---

  describe('Formatting & Parsing Utilities', () => {
    it('getRecipientKidsFromJwe should extract all kids from a JWE object', () => {
      // Arrange
      const mockJwe: JweObject = {
        protected: 'protected-header-b64',
        recipients: [
          { header: { alg: 'ML-KEM-768', kid: 'recipient-kid-1' } },
          { header: { alg: 'ML-KEM-768' } }, // Recipient without a kid
          { header: { alg: 'ML-KEM-768', kid: 'recipient-kid-3' } },
        ] as RecipientDataJWE[],
        iv: 'iv-b64', ciphertext: 'ciphertext-b64', tag: 'tag-b64',
      };
      
      // Act
      const kids = cryptoService.getRecipientKidsFromJwe(mockJwe);

      // Assert
      expect(kids).toHaveLength(2);
      expect(kids).toEqual(['recipient-kid-1', 'recipient-kid-3']);
    });

    it('parseCompactJwe should correctly parse a compact JWE string', () => {
      // Arrange
      const protectedHeader = { alg: 'ML-KEM-768', enc: 'A256GCM', kid: 'test-kid' };
      const protectedB64 = Content.objectToRawBase64UrlSafe(protectedHeader);
      const compactJwe = `${protectedB64}.encrypted_key.iv.ciphertext.tag`;
      
      // Act
      const jweObject = cryptoService.parseCompactJwe(compactJwe);

      // Assert
      expect(jweObject.protected).toBe(protectedB64);
      expect(jweObject.recipients[0].encrypted_key).toBe('encrypted_key');
      expect(jweObject.recipients[0].header.kid).toBe('test-kid');
      expect(jweObject.iv).toBe('iv');
      expect(jweObject.ciphertext).toBe('ciphertext');
      expect(jweObject.tag).toBe('tag');
    });

    it('parseCompactJws should correctly parse a compact JWS string', () => {
      const protectedHeader = { alg: 'ML-DSA-44', kid: 'signer-kid' };
      const protectedB64 = Content.objectToRawBase64UrlSafe(protectedHeader);
      const payload = { data: 'test' };
      const payloadB64 = Content.objectToRawBase64UrlSafe(payload);
      const compactJws = `${protectedB64}.${payloadB64}.signature`;

      // Act
      const jwsObject = cryptoService.parseCompactJws(compactJws);

      // Assert
      expect(jwsObject.protected).toEqual(protectedHeader);
      expect(jwsObject.payload).toEqual(payload);
      expect(jwsObject.signature).toBeInstanceOf(Uint8Array);
    });

  });

  // --- High-Level Workflows ---

  describe('encryptJwe', () => {
    it('should orchestrate AES encryption and Kyber key encapsulation for multiple recipients', async () => {
      // --- 1. Arrange ---
      const payload = { message: 'secret data' };
      const protectedHeader = { enc: 'A256GCM', kid: 'sender-kid' };
      const senderKeyPair: MlkemPrivateJwk = {
        kty: 'OKP', crv: 'ML-KEM-768', x: 'sender-pub-key', kid: 'sender-kid', dBytes: randomBytes(64)
      };
      const recipients: MlkemPublicJwk[] = [
        { kty: 'OKP', crv: 'ML-KEM-768', kid: 'recipient-1', x: Content.bytesToRawBase64UrlSafe(randomBytes(1184)) },
        // { kty: 'OKP', crv: 'ML-KEM-768', kid: 'recipient-2', x: Content.bytesToRawBase64UrlSafe(randomBytes(1184)) },
      ];

      const mockEncryptedComponents: ProtectedDataAES = {
        ciphertext: 'mock-ciphertext-base64url', iv: 'mock-iv-base64url', tag: 'mock-tag-base64url',
      };
      const aesEncryptSpy = jest.spyOn(AesManager.prototype, 'encrypt').mockResolvedValue(mockEncryptedComponents);

      const mockEncapsulation = { encapsulatedCekBytes: randomBytes(1088), derivedCekBytes: randomBytes(32) };
      // For this test, we can mock encapsulate to return the same value each time.
      const encapsulateSpy = jest.spyOn(cryptoService, 'encapsulate').mockResolvedValue(mockEncapsulation);

      // --- 2. Act ---
      const jweObject = await cryptoService.encryptJwe(payload, protectedHeader, senderKeyPair, recipients);

      // --- 3. Assert ---
      // One AES-GCM operation encrypts the payload and another wraps its
      // random CEK for the recipient under the confidential-pqc-v1 profile.
      expect(aesEncryptSpy).toHaveBeenCalledTimes(2);
      expect(encapsulateSpy).toHaveBeenCalledTimes(1);
      expect(encapsulateSpy).toHaveBeenCalledWith(expect.any(Uint8Array), senderKeyPair.dBytes, Content.base64ToBytes(recipients[0].x));
      // expect(encapsulateSpy).toHaveBeenCalledWith(expect.any(Uint8Array), senderKeyPair.dBytes, Content.base64ToBytes(recipients[1].x));

      expect(jweObject.iv).toBe(mockEncryptedComponents.iv);
      expect(jweObject.ciphertext).toBe(mockEncryptedComponents.ciphertext);
      expect(jweObject.recipients).toHaveLength(1);
      expect(jweObject.recipients[0].header.kid).toBe('recipient-1');
      expect(Content.base64UrlSafeToJSON(jweObject.recipients[0].encrypted_key!)).toMatchObject({
        v: 'gdc-mlkem-cek-wrap-v1',
        kem: 'ML-KEM-768',
        kdf: 'HKDF-SHA-256',
        wrap: 'A256GCM',
        kemCiphertext: Content.bytesToRawBase64UrlSafe(mockEncapsulation.encapsulatedCekBytes),
      });
    });
  });

  describe('encryptJweToCompact', () => {
    it('should return a valid 5-part compact JWE string', async () => {
      // --- 1. Arrange ---
      const payload = { message: 'secret data' };
      const protectedHeader = { enc: 'A256GCM' }; // Main header without recipient info
      const senderKeyPair: MlkemPrivateJwk = {
        kty: 'OKP', crv: 'ML-KEM-768', x: 'sender-pub-key', kid: 'sender-kid', dBytes: randomBytes(64)
      };
      const recipient: MlkemPublicJwk = {
        kty: 'OKP', crv: 'ML-KEM-768', kid: 'recipient-1', x: Content.bytesToRawBase64UrlSafe(randomBytes(1184))
      };

      const mockEncryptedComponents: ProtectedDataAES = {
        ciphertext: 'mock-ciphertext-base64url', iv: 'mock-iv-base64url', tag: 'mock-tag-base64url',
      };
      jest.spyOn(AesManager.prototype, 'encrypt').mockResolvedValue(mockEncryptedComponents);

      const mockEncapsulation = { encapsulatedCekBytes: randomBytes(1088), derivedCekBytes: randomBytes(32) };
      jest.spyOn(cryptoService, 'encapsulate').mockResolvedValue(mockEncapsulation);

      // --- 2. Act ---
      const compactJwe = await cryptoService.encryptJweToCompact(payload, protectedHeader, senderKeyPair, recipient);

      // --- 3. Assert ---
      expect(typeof compactJwe).toBe('string');
      const parts = compactJwe.split('.');
      expect(parts).toHaveLength(5);

      // Verify that the final protected header was merged correctly
      const finalProtectedHeader = Content.base64UrlSafeToJSON(parts[0]);
      expect((finalProtectedHeader as any).enc).toBe('A256GCM');
      expect((finalProtectedHeader as any).kid).toBe('recipient-1'); // The recipient kid is present
    });
  });  

  describe('decryptJwe', () => {
    it('should find the correct recipient by KID and successfully decrypt the JWE', async () => {
      // --- 1. Arrange ---
      const recipient2PrivKey: MlkemPrivateJwk = {
        kty: 'OKP', crv: 'ML-KEM-768', x: 'recipient2-pub-key-b64', kid: 'recipient-kid-2', dBytes: new Uint8Array([4, 5, 6]),
      };
      const mockJwe: JweObject = {
        protected: 'protected-header-b64',
        recipients: [
          { header: { alg: 'ML-KEM-768', kid: 'recipient-kid-1' }, encrypted_key: ['encrypted', 'key', '1', 'b64'].join('-') },
          { header: { alg: 'ML-KEM-768', kid: 'recipient-kid-2' }, encrypted_key: ['encrypted', 'key', '2', 'b64'].join('-') },
        ],
        iv: 'iv-b64', ciphertext: 'ciphertext-b64', tag: 'tag-b64',
      };
      const mockCek = new Uint8Array([7, 8, 9]);
      const mockDecryptedPayloadString = JSON.stringify({ message: 'This is a secret' });
      const mockDecryptedBytes = Content.stringToBytesUTF8(mockDecryptedPayloadString);
      const mockProtectedHeader = { enc: 'A256GCM' };

      const unwrapRecipientCekSpy = jest.spyOn(cryptoService as any, 'unwrapRecipientCek').mockResolvedValue(mockCek);
      const decryptSpy = jest.spyOn(cryptoService, 'decrypt').mockResolvedValue(mockDecryptedPayloadString);
      jest.spyOn(Content, 'base64UrlSafeToJSON').mockReturnValue(mockProtectedHeader);

      // --- 2. Act ---
      const { decryptedBytes, protectedHeader } = await cryptoService.decryptJwe(mockJwe, recipient2PrivKey);

      // --- 3. Assert ---
      expect(unwrapRecipientCekSpy).toHaveBeenCalledTimes(1);
      expect(unwrapRecipientCekSpy).toHaveBeenCalledWith('encrypted-key-2-b64', recipient2PrivKey, mockJwe.protected);
      expect(decryptSpy).toHaveBeenCalledTimes(1);
      expect(decryptSpy).toHaveBeenCalledWith(
        { ciphertext: mockJwe.ciphertext, iv: mockJwe.iv, tag: mockJwe.tag }, mockCek, mockJwe.protected
      );
      expect(decryptedBytes).toEqual(mockDecryptedBytes);
      expect(protectedHeader).toEqual(mockProtectedHeader);
    });
  });

  // --- Low-Level Primitives ---

  describe('Low-Level Primitives', () => {
    it('encapsulate should call noble ml_kem768.encapsulate', async () => {
      // Arrange
      const pubKey = randomBytes(1184);
      const data = randomBytes(32);
      // FIX: Explicitly create Uint8Array to match the strict mock type
      const mockReturn = { 
        sharedSecret: new Uint8Array(randomBytes(32)), 
        cipherText: new Uint8Array(randomBytes(1088))
      };
      (mockMlKem768.encapsulate as jest.Mock).mockReturnValue(mockReturn);
      
      // Act
      await cryptoService.encapsulate(data, randomBytes(64), pubKey);
      
      // Assert
      expect(mockMlKem768.encapsulate).toHaveBeenCalledWith(pubKey, data);
    });

    it('decapsulate should call noble ml_kem768.decapsulate', async () => {
      const cipherText = randomBytes(1088);
      const privKey = randomBytes(2400);
      (mockMlKem768.decapsulate as jest.Mock).mockReturnValue(randomBytes(32));
      await cryptoService.decapsulate(cipherText, privKey);
      expect(mockMlKem768.decapsulate).toHaveBeenCalledWith(cipherText, privKey);
    });

    it(`signBytes should call noble for level 2 'ML-DSA-44'`, async () => {
        const data = randomBytes(32);
        const privKey = randomBytes(2560); // Correct size for ML-DSA-44
        mockMlDsa.sign.mockReturnValue(randomBytes(2420) as any);
        await cryptoService.signBytes(data, privKey, 'ML-DSA-44');
        expect(mockMlDsa.sign).toHaveBeenCalledWith(data, privKey);
      });
  
      it(`verifyBytes should call noble for level 2 'ML-DSA-44'`, async () => {
        const sig = randomBytes(2144); // Correct size for ML-DSA-44
        const data = randomBytes(32);
        const pubKey: MldsaPublicJwk = { kty: 'AKP', alg: 'ML-DSA-44', pub: 'pub-key-b64' };
        mockMlDsa.verify.mockReturnValue(true as any);
        await cryptoService.verifyBytes(sig, data, pubKey);
        expect(mockMlDsa.verify).toHaveBeenCalledWith(sig, data, Content.base64ToBytes(pubKey.pub));
      });
  });

  // --- Key Generation ---

  describe('Key Generation', () => {
    beforeEach(() => {
      // Mock the key generation functions from @noble and the withKid utility
      // before each test in this block.
      // Use correct key sizes for ML-DSA-44: Pub=1312, Priv=2560
      mockMlDsa.keygen.mockReturnValue({ secretKey: randomBytes(2560), publicKey: randomBytes(1312) });
      mockMlKem768.keygen.mockReturnValue({ secretKey: randomBytes(2400), publicKey: randomBytes(1184) });
    });

    it('should generate a valid ML-DSA key pair', async () => {
      const { publicJWKey, secretKeyBytes } = await cryptoService.generateKeyPairMlDsa();
      expect(publicJWKey.kty).toBe('AKP');
      expect(publicJWKey.alg).toBe('ML-DSA-44'); // Assert the new default
      expect(publicJWKey.kid).toEqual(expect.any(String));
      expect(publicJWKey.kid.length).toBeGreaterThan(0);
      expect(secretKeyBytes).toBeInstanceOf(Uint8Array);
      expect(secretKeyBytes.length).toBe(2560);
    });

    it('should generate a valid ML-KEM key pair', async () => {
      const { publicJWKey, secretKeyBytes } = await cryptoService.generateKeyPairMlKem();
      expect(publicJWKey.kty).toBe('OKP');
      expect(publicJWKey.crv).toBe('ML-KEM-768');
      expect(publicJWKey.kid).toEqual(expect.any(String));
      expect(publicJWKey.kid.length).toBeGreaterThan(0);
      expect(secretKeyBytes).toBeInstanceOf(Uint8Array);
    });
  });

});
