// src/utils/vc-signer.ts

import { IKmsService } from '../gdc-backend-utils-node/models/IKmsService';
import { canonicalize } from './json-canon';
import { createHash } from 'crypto';
import { p256, p384 } from '@noble/curves/nist.js';
import { Content } from 'gdc-common-utils-ts/utils/content';

/**
 * Creates the JWS detached payload by canonicalizing, hashing, and Base64Url-encoding the input object,
 * following a simplified Linked Data Proofs process.
 *
 * @param unsignedVc The VC object without the 'proof' property.
 * @returns The Base64Url-encoded SHA-256 hash, ready to be signed.
 */
function createLdpJwsPayload(unsignedVc: any): Uint8Array {
  // 1. Canonicalize the document to get a stable string representation.
  const canonicalVc = canonicalize(unsignedVc);

  // 2. Hash the canonical string with SHA-256.
  const hash = createHash('sha256').update(canonicalVc).digest();
  
  // The payload of the JWS is the hash of the canonicalized data.
  return hash;
}

function resolveEcdsaAlgFromJwk(jwk: any): 'ES256' | 'ES384' {
  if (jwk?.crv === 'P-384' || jwk?.alg === 'ES384') return 'ES384';
  return 'ES256';
}

async function signDetachedJwsWithEcPrivateJwk(payloadBytes: Uint8Array, privateJwk: any) {
  const alg = resolveEcdsaAlgFromJwk(privateJwk);
  const protectedHeader = { alg, kid: privateJwk.kid };
  const protectedHeaderB64Url = Content.objectToRawBase64UrlSafe(protectedHeader);
  const payloadB64Url = Content.bytesToRawBase64UrlSafe(payloadBytes);
  const signingInput = `${protectedHeaderB64Url}.${payloadB64Url}`;
  const signingInputBytes = Content.stringToBytesUTF8(signingInput);
  const secretKeyBytes = Buffer.from(privateJwk.d, 'base64url');
  const signatureBytes = (alg === 'ES384'
    ? p384.sign(signingInputBytes, secretKeyBytes, { format: 'compact' } as any)
    : p256.sign(signingInputBytes, secretKeyBytes, { format: 'compact' } as any)) as Uint8Array;
  return {
    protected: protectedHeaderB64Url,
    signature: Content.bytesToRawBase64UrlSafe(signatureBytes),
  };
}

/**
 * Signs a Verifiable Credential payload according to the JsonWebSignature2020 suite.
 * It canonicalizes the VC, hashes it, signs the hash, and then attaches the `proof`.
 * 
 * @param vcPayload The full, unsigned VC object.
 * @param verificationMethodId The full DID#key-id of the signing key.
 * @param kmsService The KMS service to perform the signing.
 * @param signerVaultId The vault ID of the signer (e.g., 'host').
 * @returns The signed Verifiable Credential with the `proof` section.
 */
export async function signVerifiableCredential(
  vcPayload: any,
  verificationMethodId: string,
  kmsService: IKmsService,
  signerVaultId: string,
  options?: {
    proofType?: string;
    proofPurpose?: string;
    signerAlg?: string;
    signerKeyPurpose?: 'comm_sig' | 'vc_sign';
    append?: boolean;
  }
): Promise<any> {
  
  // 1. Normalize: Create a copy of the VC without the 'proof' property for signing.
  const { proof, ...unsignedVc } = vcPayload;

  // 2. Create the JWS payload by canonicalizing and hashing the normalized VC.
  const payloadToSign = createLdpJwsPayload(unsignedVc);

  // 3. Sign the HASH using the KMS.
  const jws = await kmsService.signWithManagedKey(
    payloadToSign,
    signerVaultId,
    options?.signerAlg,
    options?.signerKeyPurpose || 'vc_sign',
  );
  const { protected: protectedHeader, signature } = jws.signatures[0];

  // 4. Construct the final 'proofValue' for the detached JWS.
  // It's `header..signature` because the payload is detached (the VC itself).
  const proofValue = `${protectedHeader}..${signature}`;

  // 5. Attach the proof to the original VC payload.
  const proofEntry = {
    type: options?.proofType || 'JsonWebSignature2020',
    created: new Date().toISOString(),
    verificationMethod: verificationMethodId,
    proofPurpose: options?.proofPurpose || 'assertionMethod',
    proofValue: proofValue,
  };

  const existingProofs = Array.isArray(vcPayload.proof)
    ? vcPayload.proof
    : (vcPayload.proof ? [vcPayload.proof] : []);

  const proofs = options?.append === false ? [proofEntry] : [...existingProofs, proofEntry];

  return {
    ...vcPayload,
    proof: proofs,
  };
}

export async function signVerifiableCredentialWithJwk(
  vcPayload: any,
  verificationMethodId: string,
  privateJwk: any,
  options?: {
    proofType?: string;
    proofPurpose?: string;
    append?: boolean;
  }
): Promise<any> {
  const { proof, ...unsignedVc } = vcPayload;
  const payloadToSign = createLdpJwsPayload(unsignedVc);
  const jws = await signDetachedJwsWithEcPrivateJwk(payloadToSign, privateJwk);
  const proofValue = `${jws.protected}..${jws.signature}`;
  const proofEntry = {
    type: options?.proofType || 'JsonWebSignature2020',
    created: new Date().toISOString(),
    verificationMethod: verificationMethodId,
    proofPurpose: options?.proofPurpose || 'assertionMethod',
    proofValue: proofValue,
  };

  const existingProofs = Array.isArray(vcPayload.proof)
    ? vcPayload.proof
    : (vcPayload.proof ? [vcPayload.proof] : []);
  const proofs = options?.append === false ? [proofEntry] : [...existingProofs, proofEntry];

  return {
    ...vcPayload,
    proof: proofs,
  };
}
