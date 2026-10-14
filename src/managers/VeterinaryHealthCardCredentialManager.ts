import { ResourceTypesFhirR4 } from 'gdc-common-utils-ts/constants/fhir-resource-types';
import type { IKmsService } from '../gdc-backend-utils-node/models/IKmsService';
import {
  decodeSmartHealthCardPayloadBytes,
  encodePostQuantumCompanionProofUri,
  encodePostQuantumCompanionProofQr,
  encodeSmartHealthCardQr,
  prepareSmartHealthCard,
} from 'vet-data-utils-ts/shc';

type VeterinaryCredentialKms = Pick<IKmsService,
  'getPublicJwks' | 'createCompactJwsFromEncodedPayload' | 'createDetachedJwsForBytes'>;

const CredentialAlgorithms = Object.freeze({
  SmartHealthCard: 'ES256',
  CompanionProofPrefix: 'ML-DSA-',
});

/**
 * Internal veterinary projection from authoritative FHIR readback to portable
 * SHC and post-quantum companion proof transports.
 *
 * Authorization, Consent and profile resolution must complete before this
 * manager is called. Locator resolution or possession of a QR never grants
 * permission to invoke it.
 */
export class VeterinaryHealthCardCredentialManager {
  constructor(private readonly kms: VeterinaryCredentialKms) {}

  async issueFromAuthoritativeBundle(input: Readonly<{
    tenantVaultId: string;
    issuer: string;
    notBefore: number;
    fhirVersion: string;
    authoritativeBundle: Record<string, unknown>;
    attesters: readonly Readonly<{ vaultId: string; keyId: string }>[];
  }>): Promise<Readonly<{
    compactJws: string;
    shcQr: readonly string[];
    pqcCompanionProofs: readonly string[];
    pqcQr: readonly (readonly string[])[];
  }>> {
    if (!this.kms.createCompactJwsFromEncodedPayload || !this.kms.createDetachedJwsForBytes) {
      throw new Error('veterinary_health_card_exact_byte_kms_required');
    }
    if (input.authoritativeBundle.resourceType !== ResourceTypesFhirR4.Bundle
      || !Array.isArray(input.authoritativeBundle.entry)
      || input.authoritativeBundle.entry.length === 0) {
      throw new Error('veterinary_health_card_authoritative_bundle_required');
    }
    if (!input.attesters.length) throw new Error('veterinary_health_card_attester_required');
    const tenantKeys = await this.kms.getPublicJwks(input.tenantVaultId);
    const standardSigner = tenantKeys.keys.find(key => (
      key.alg === CredentialAlgorithms.SmartHealthCard && key.crv === 'P-256' && key.use === 'sig'
    ));
    if (!standardSigner?.kid) throw new Error('veterinary_shc_tenant_es256_key_required');

    const prepared = prepareSmartHealthCard({
      issuer: input.issuer,
      notBefore: input.notBefore,
      kid: standardSigner.kid,
      fhirVersion: input.fhirVersion,
      fhirBundle: input.authoritativeBundle,
      additionalTypes: ['https://smarthealth.cards#immunization'],
    });
    const compactJws = await this.kms.createCompactJwsFromEncodedPayload(
      prepared.encodedPayload,
      standardSigner.kid,
      input.tenantVaultId,
      'vc_sign',
      { zip: 'DEF' },
    );
    const exactPayload = decodeSmartHealthCardPayloadBytes(compactJws);
    const detached = await Promise.all(input.attesters.map(async attester => {
      const keySet = await this.kms.getPublicJwks(attester.vaultId);
      const key = keySet.keys.find(candidate => candidate.kid === attester.keyId);
      if (!key || !String(key.alg || '').startsWith(CredentialAlgorithms.CompanionProofPrefix) || key.use !== 'sig') {
        throw new Error('veterinary_attester_mldsa_credential_key_required');
      }
      return this.kms.createDetachedJwsForBytes!(exactPayload, attester.keyId, attester.vaultId, 'vc_sign');
    }));
    return {
      compactJws,
      shcQr: encodeSmartHealthCardQr(compactJws),
      pqcCompanionProofs: detached.map(encodePostQuantumCompanionProofUri),
      pqcQr: detached.map(proof => encodePostQuantumCompanionProofQr(proof)),
    };
  }
}
