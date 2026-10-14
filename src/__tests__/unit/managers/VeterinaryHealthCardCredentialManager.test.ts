// Flow contract: an authorized internal projection signs only an authoritative FHIR readback, uses the tenant ES256 credential key for standard SHC, and adds one exact-byte RFC 7797 ML-DSA companion proof per resolved attester key.
import { jest } from '@jest/globals';
import { ResourceTypesFhirR4 } from 'gdc-common-utils-ts/constants/fhir-resource-types';
import { BundleTypes } from 'gdc-common-utils-ts/models/bundle-editor-types';
import { Content } from 'gdc-common-utils-ts/utils/content';
import {
  PostQuantumCompanionProofPrefix,
  SmartHealthCardQrPrefix,
} from 'vet-data-utils-ts/shc';
import { VeterinaryHealthCardCredentialManager } from '../../../managers/VeterinaryHealthCardCredentialManager';

const CredentialAlgorithms = Object.freeze({
  SmartHealthCard: 'ES256',
  CompanionProof: 'ML-DSA-65',
});

describe('VeterinaryHealthCardCredentialManager', () => {
  it('issues SHC and one independent companion proof for each attester', async () => {
    const pqcHeader = Content.objectToRawBase64UrlSafe({
      alg: CredentialAlgorithms.CompanionProof, kid: 'attester-pqc', b64: false, crit: ['b64'],
    });
    const kms = {
      getPublicJwks: jest.fn(async (vaultId: string) => ({
        keys: vaultId === 'tenant-vault'
          ? [{ kty: 'EC', crv: 'P-256', alg: CredentialAlgorithms.SmartHealthCard, use: 'sig', kid: 'tenant-es256' }]
          : [{ kty: 'AKP', alg: CredentialAlgorithms.CompanionProof, use: 'sig', purpose: 'vc_sign', kid: 'attester-pqc' }],
      })),
      createCompactJwsFromEncodedPayload: jest.fn(async (payload: string) => `header.${payload}.signature`),
      createDetachedJwsForBytes: jest.fn(async () => `${pqcHeader}..signature`),
    };
    const manager = new VeterinaryHealthCardCredentialManager(kms as any);

    const result = await manager.issueFromAuthoritativeBundle({
      tenantVaultId: 'tenant-vault',
      issuer: 'https://issuer.example/tenant',
      notBefore: 1788825600,
      fhirVersion: '4.0.1',
      authoritativeBundle: {
        resourceType: ResourceTypesFhirR4.Bundle,
        type: BundleTypes.collection,
        entry: [{ resource: { resourceType: ResourceTypesFhirR4.Immunization, status: 'completed' } }],
      },
      attesters: [{ vaultId: 'attester-vault', keyId: 'attester-pqc' }],
    });

    expect(kms.createCompactJwsFromEncodedPayload).toHaveBeenCalledWith(
      expect.any(String), 'tenant-es256', 'tenant-vault', 'vc_sign', { zip: 'DEF' },
    );
    const exactPayload = (kms.createDetachedJwsForBytes.mock.calls as unknown as Array<[Uint8Array]>)[0][0];
    expect(JSON.parse(Content.bytesToStringUTF8(exactPayload))).toMatchObject({
      iss: 'https://issuer.example/tenant',
      vc: { credentialSubject: { fhirVersion: '4.0.1' } },
    });
    expect(kms.createDetachedJwsForBytes).toHaveBeenCalledWith(
      exactPayload, 'attester-pqc', 'attester-vault', 'vc_sign',
    );
    expect(result.shcQr.every(value => value.startsWith(SmartHealthCardQrPrefix))).toBe(true);
    expect(result.pqcCompanionProofs).toHaveLength(1);
    expect(result.pqcCompanionProofs[0]).toMatch(new RegExp(`^${PostQuantumCompanionProofPrefix}`));
    expect(result.pqcQr).toHaveLength(1);
    expect(result.pqcQr[0].every(value => value.startsWith(PostQuantumCompanionProofPrefix))).toBe(true);
  });

  it('fails closed when the tenant has no dedicated ES256 credential key', async () => {
    const manager = new VeterinaryHealthCardCredentialManager({
      getPublicJwks: jest.fn(async () => ({ keys: [{ alg: 'ES384', use: 'sig', kid: 'tenant-es384' }] })),
      createCompactJwsFromEncodedPayload: jest.fn(),
      createDetachedJwsForBytes: jest.fn(),
    } as any);
    await expect(manager.issueFromAuthoritativeBundle({
      tenantVaultId: 'tenant-vault', issuer: 'https://issuer.example/tenant', notBefore: 1,
      fhirVersion: '4.0.1', authoritativeBundle: { resourceType: ResourceTypesFhirR4.Bundle, entry: [{}] },
      attesters: [{ vaultId: 'attester-vault', keyId: 'attester-pqc' }],
    })).rejects.toThrow('veterinary_shc_tenant_es256_key_required');
  });
});
